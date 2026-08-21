import { parseFrontmatter, serializeFrontmatter, FM } from "./frontmatter";
import { readFile, writeFile, moveFile, listMarkdownIn, join, fileExists } from "./vault";
import { AtlasProfile, LaneKey } from "./atlasProfile";

export interface Task {
  path: string;
  lane: LaneKey;
  title: string;
  status: string;
  project?: string;
  due?: string;          // YYYY-MM-DD
  priority?: string;     // high | medium | low
  top?: string;          // "1" | "2" | "3" — today's top three
  todoistId?: string;
  created?: string;      // YYYY-MM-DD — feeds the calendar's created-on view
  updated: string;       // ISO
  body: string;
}

const nowIso = () => new Date().toISOString();

export function slugify(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 80) || "untitled-task";
}

function fmToTask(fm: FM, body: string, path: string, lane: LaneKey): Task {
  return {
    path, lane, body,
    title: (fm.title as string) ?? path.split("/").pop()!.replace(/\.md$/, ""),
    status: (fm.status as string) ?? lane,
    project: fm.project as string | undefined,
    due: fm.due as string | undefined,
    priority: fm.priority as string | undefined,
    top: fm.top as string | undefined,
    todoistId: fm.todoist_id as string | undefined,
    created: fm.created as string | undefined,
    updated: (fm.updated as string) ?? nowIso(),
  };
}

function taskToFm(t: Task): FM {
  return {
    type: "task",
    title: t.title,
    status: t.status,
    project: t.project,
    due: t.due,
    priority: t.priority,
    top: t.top,
    todoist_id: t.todoistId,
    created: t.created,
    updated: t.updated,
  };
}

export async function loadLane(profile: AtlasProfile, lane: LaneKey): Promise<Task[]> {
  const files = await listMarkdownIn(profile.lanes[lane]);
  const tasks: Task[] = [];
  for (const path of files) {
    try {
      const raw = await readFile(path);
      const { fm, body } = parseFrontmatter(raw);
      if (fm.type && fm.type !== "task") continue; // skip README etc. with explicit other types
      if (!fm.type && !fm.title && path.endsWith("README.md")) continue;
      tasks.push(fmToTask(fm, body, path, lane));
    } catch { /* unreadable file — skip */ }
  }
  return tasks;
}

export async function loadAllTasks(profile: AtlasProfile): Promise<Task[]> {
  const lanes: LaneKey[] = ["today", "week", "waiting", "someday", "done"];
  const all = await Promise.all(lanes.map((l) => loadLane(profile, l)));
  return all.flat();
}

export async function saveTask(t: Task): Promise<void> {
  t.updated = nowIso();
  await writeFile(t.path, serializeFrontmatter(taskToFm(t), t.body));
}

export async function createTask(
  profile: AtlasProfile, lane: LaneKey, title: string,
  opts: Partial<Pick<Task, "due" | "priority" | "project">> = {},
): Promise<Task> {
  let path = join(profile.lanes[lane], `${slugify(title)}.md`);
  if (await fileExists(path)) path = path.replace(/\.md$/, `-${Date.now() % 10000}.md`);
  const t: Task = {
    path, lane, title, status: lane, body: "",
    created: nowIso().slice(0, 10), updated: nowIso(), ...opts,
  };
  await saveTask(t);
  return t;
}

/** Move task to a new lane: physically moves the file AND updates frontmatter. */
export async function moveTaskToLane(profile: AtlasProfile, t: Task, lane: LaneKey): Promise<Task> {
  if (t.lane === lane) return t;
  const dest = join(profile.lanes[lane], t.path.split("/").pop()!);
  await moveFile(t.path, dest);
  const moved: Task = { ...t, path: dest, lane, status: lane, updated: nowIso() };
  if (lane !== "today") moved.top = undefined; // leaving Today clears top-three slot
  await saveTask(moved);
  return moved;
}

export async function completeTask(profile: AtlasProfile, t: Task): Promise<Task> {
  const done = await moveTaskToLane(profile, t, "done");
  done.status = "done";
  await saveTask(done);
  return done;
}
