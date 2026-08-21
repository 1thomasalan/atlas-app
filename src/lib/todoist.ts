import { fetch } from "@tauri-apps/plugin-http";
import { Task, loadAllTasks, saveTask, createTask, moveTaskToLane, completeTask } from "./tasks";
import { AtlasProfile, LaneKey } from "./atlasProfile";
import { readFile, writeFile, fileExists, join, ensureDir } from "./vault";

/** Two-way Todoist sync.
 *
 *  Lane mapping (no folder restructure needed):
 *    Today     <-> due today (or overdue)
 *    This Week <-> due within 7 days
 *    Waiting   <-> label "waiting"
 *    Someday   <-> no due date
 *    Done      <-> completed
 *
 *  Conflict policy: last-writer-wins. We keep a snapshot of the remote state
 *  from the previous sync in .atlas/sync-state.json. If only one side changed,
 *  that side wins. If both changed since last sync, the local vault wins and
 *  the conflict is recorded in the sync report — your files are the source of
 *  truth (the Todoist API does not expose per-task modified timestamps).
 *
 *  Uses the unified Todoist API v1 (api.todoist.com/api/v1) — the older
 *  REST v2 API was retired by Todoist and returns 410 Gone.
 */

const API = "https://api.todoist.com/api/v1";

interface TodoistTask {
  id: string; content: string; description: string;
  project_id: string; labels: string[]; priority: number; // 4 = highest
  due?: { date: string } | null;
  checked?: boolean;        // unified API field
  is_completed?: boolean;   // legacy field, kept for safety
}
interface Paginated<T> { results: T[]; next_cursor: string | null; }
interface TodoistProject { id: string; name: string; }

interface SyncSnapshot { [todoistId: string]: { content: string; due: string; lane: string } }

export interface SyncReport { pulled: number; pushed: number; created: number; completed: number; conflicts: string[]; }

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tauri's HTTP client surfaces a transient connection failure as a thrown
 *  "error sending request for url …" — a single network blip would otherwise
 *  abort the whole sync. So give every call a hard connect timeout, retry the
 *  idempotent GETs a few times with backoff, and turn a transport failure into
 *  a clear, actionable message instead of leaking reqwest's raw error. Writes
 *  (POST) are NOT retried on a thrown error, so a lost response can't double a
 *  task; they still get the timeout and the friendly message. */
async function tdFetch(url: string, init: RequestInit, retry = false): Promise<Response> {
  const attempts = retry ? 3 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, connectTimeout: 15000 });
      if (retry && (res.status === 429 || res.status >= 500) && i < attempts - 1) {
        await sleep(500 * (i + 1) * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(500 * (i + 1) * (i + 1));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    /send|connect|timeout|dns|network|tcp|tls|reach|os error/i.test(msg)
      ? "Couldn't reach Todoist after retrying — check your internet connection, VPN, or firewall and try again."
      : `Todoist request failed: ${msg}`,
  );
}

/** Unified API v1 lists are cursor-paginated: { results, next_cursor }. */
async function fetchAll<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = url.includes("?") ? "&" : "?";
    const page = `${url}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await tdFetch(page, { headers: authHeaders(token) }, true);
    if (!res.ok) throw new Error(`Todoist: ${res.status} ${res.statusText}`);
    const data: Paginated<T> | T[] = await res.json();
    if (Array.isArray(data)) { out.push(...data); break; } // defensive: non-paginated shape
    out.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);
  return out;
}

function laneForRemote(t: TodoistTask): LaneKey {
  if (t.checked ?? t.is_completed) return "done";
  if (t.labels.includes("waiting")) return "waiting";
  if (!t.due?.date) return "someday";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(t.due.date + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days <= 7) return "week";
  return "someday";
}

function remoteFieldsForLane(t: Task): { due_string?: string; labels?: string[] } {
  switch (t.lane) {
    case "today":   return { due_string: t.due ?? "today" };
    case "week":    return { due_string: t.due ?? "in 3 days" };
    case "waiting": return { labels: ["waiting"], due_string: t.due ?? "no date" };
    default:        return { due_string: t.due ?? "no date" };
  }
}

const prioMap: Record<string, number> = { high: 4, medium: 3, low: 2 };
const prioBack: Record<number, string | undefined> = { 4: "high", 3: "medium", 2: "low", 1: undefined };

async function loadSnapshot(profile: AtlasProfile): Promise<SyncSnapshot> {
  const p = join(profile.root, ".atlas/sync-state.json");
  if (!(await fileExists(p))) return {};
  try { return JSON.parse(await readFile(p)); } catch { return {}; }
}
async function saveSnapshot(profile: AtlasProfile, snap: SyncSnapshot): Promise<void> {
  await ensureDir(join(profile.root, ".atlas"));
  await writeFile(join(profile.root, ".atlas/sync-state.json"), JSON.stringify(snap, null, 2));
}

export async function syncTodoist(profile: AtlasProfile, token: string): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, created: 0, completed: 0, conflicts: [] };

  const remote = await fetchAll<TodoistTask>(`${API}/tasks`, token);
  let projects: TodoistProject[] = [];
  try { projects = await fetchAll<TodoistProject>(`${API}/projects`, token); } catch { /* non-fatal */ }
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name;

  const local = await loadAllTasks(profile);
  const snap = await loadSnapshot(profile);
  const nextSnap: SyncSnapshot = {};
  const localById = new Map(local.filter((t) => t.todoistId).map((t) => [t.todoistId!, t]));

  // --- Remote -> Local ---
  for (const r of remote) {
    const lane = laneForRemote(r);
    nextSnap[r.id] = { content: r.content, due: r.due?.date ?? "", lane };
    const mine = localById.get(r.id);
    if (!mine) {
      // New on Todoist -> create local file
      const t = await createTask(profile, lane, r.content, {
        due: r.due?.date, priority: prioBack[r.priority],
        project: projectName(r.project_id),
      });
      t.todoistId = r.id; await saveTask(t);
      report.pulled++;
      continue;
    }
    const prev = snap[r.id];
    const remoteChanged = !prev || prev.content !== r.content || prev.due !== (r.due?.date ?? "") || prev.lane !== lane;
    const localChanged = prev && (mine.title !== prev.content || (mine.due ?? "") !== prev.due || mine.lane !== prev.lane);

    if (remoteChanged && localChanged) {
      report.conflicts.push(`"${mine.title}" changed in both places — kept your vault's version.`);
      continue; // local wins; push pass below will update Todoist
    }
    if (remoteChanged) {
      mine.title = r.content;
      mine.due = r.due?.date ?? undefined;
      mine.priority = prioBack[r.priority];
      if (mine.lane !== lane) await moveTaskToLane(profile, mine, lane);
      else await saveTask(mine);
      report.pulled++;
    }
  }

  // --- Completions: the remote list only returns active tasks. A local-active
  // task whose id is missing remotely was either completed remotely (close it
  // here) or was just reopened locally (reopen it there). Local edits since the
  // last sync signal intent, so we try reopening first; if Todoist refuses,
  // we accept the remote completion. ---
  const remoteIds = new Set(remote.map((r) => r.id));
  for (const t of local) {
    if (t.todoistId && t.lane !== "done" && !remoteIds.has(t.todoistId)) {
      const prev = snap[t.todoistId];
      const localChangedSinceSnap =
        !!prev && (t.title !== prev.content || (t.due ?? "") !== prev.due || t.lane !== prev.lane);
      if (localChangedSinceSnap) {
        // e.g. dragged out of Done after Todoist closed it — reopen remotely
        const res = await tdFetch(`${API}/tasks/${t.todoistId}/reopen`, {
          method: "POST", headers: authHeaders(token),
        });
        if (res.ok) {
          remoteIds.add(t.todoistId); // active again; push pass below updates it
          nextSnap[t.todoistId] = { content: t.title, due: t.due ?? "", lane: t.lane };
          report.pushed++;
          continue;
        }
      }
      await completeTask(profile, t);
      report.completed++;
    }
  }

  // --- Local -> Remote ---
  const fresh = await loadAllTasks(profile);
  for (const t of fresh) {
    if (t.lane === "done") {
      if (t.todoistId && remoteIds.has(t.todoistId)) {
        await tdFetch(`${API}/tasks/${t.todoistId}/close`, { method: "POST", headers: authHeaders(token) });
        report.completed++;
      }
      continue;
    }
    if (!t.todoistId) {
      const res = await tdFetch(`${API}/tasks`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({
          content: t.title,
          priority: t.priority ? prioMap[t.priority] : undefined,
          ...remoteFieldsForLane(t),
        }),
      });
      if (res.ok) {
        const created: TodoistTask = await res.json();
        t.todoistId = created.id; await saveTask(t);
        nextSnap[created.id] = { content: t.title, due: t.due ?? "", lane: t.lane };
        report.created++;
      }
      continue;
    }
    const prev = snap[t.todoistId];
    const localChanged = !prev || prev.content !== t.title || prev.due !== (t.due ?? "") || prev.lane !== t.lane;
    if (localChanged && remoteIds.has(t.todoistId)) {
      await tdFetch(`${API}/tasks/${t.todoistId}`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({
          content: t.title,
          priority: t.priority ? prioMap[t.priority] : undefined,
          ...remoteFieldsForLane(t),
        }),
      });
      nextSnap[t.todoistId] = { content: t.title, due: t.due ?? "", lane: t.lane };
      report.pushed++;
    }
  }

  await saveSnapshot(profile, nextSnap);
  return report;
}
