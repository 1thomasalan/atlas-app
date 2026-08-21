import { ObjectIndex, AtlasObject } from "./objects";
import { todayStamp } from "./daily";

/** Derived relationships between objects — computed from the index, no API
 *  calls and no file reads, so they're cheap enough to run inline in cards
 *  and on every page render:
 *    - project progress from the completion state of its linked tasks
 *    - a person's "relationship strength" from how recently the vault
 *      touched them (meetings, daily notes, mentions).
 *  Kept free of the AI/enhance stack on purpose, so importing it into a card
 *  doesn't drag OpenAI calls along for the ride. */

/** A frontmatter link value (`[[Name]]`, `[[Name|alias]]`, `#tag`) → bare name. */
const normLink = (v: unknown) =>
  String(v ?? "").replace(/\[\[|\]\]|[#|].*$/g, "").trim().toLowerCase();

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Date of a genuine contact event. Deliberately does NOT fall back to a note's
 *  `updated` (the editor bumps that on any body edit) and only trusts `created`
 *  for event-like types — so "last contact" reflects real touches (a meeting, a
 *  dated daily note) rather than an incidental edit to a linked page. */
const contactDateOf = (o: AtlasObject): string | undefined => {
  const d = o.props.date;
  if (typeof d === "string" && DATE_RE.test(d)) return d.slice(0, 10);
  const stem = DATE_RE.exec(o.stem)?.[0];
  if (stem) return stem;
  if ((o.typeKey === "meeting" || o.typeKey === "daily") && o.created && DATE_RE.test(o.created)) return o.created.slice(0, 10);
  return undefined;
};

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00"), b = Date.parse(to + "T00:00:00");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/* ---------------------------------------------------------------- Projects */

export interface ProjectProgress {
  total: number;
  done: number;
  open: number;
  pct: number;                 // 0–100, rounded
  doneTasks: AtlasObject[];
  openTasks: AtlasObject[];
}

export const isTaskDone = (o: AtlasObject): boolean =>
  String(o.props.status ?? "").toLowerCase() === "done";

/** Every task whose `project:` link resolves to this project (by title or
 *  filename stem — links in Atlas are written against either). */
export function projectTasks(index: ObjectIndex, project: AtlasObject): AtlasObject[] {
  const keys = new Set([project.title.toLowerCase(), project.stem.toLowerCase()]);
  return index.all.filter((o) => o.typeKey === "task" && keys.has(normLink(o.props.project)));
}

export function projectProgress(index: ObjectIndex, project: AtlasObject): ProjectProgress {
  const tasks = projectTasks(index, project);
  const doneTasks = tasks.filter(isTaskDone);
  const openTasks = tasks.filter((t) => !isTaskDone(t));
  const total = tasks.length;
  return {
    total,
    done: doneTasks.length,
    open: openTasks.length,
    pct: total ? Math.round((doneTasks.length / total) * 100) : 0,
    doneTasks,
    openTasks,
  };
}

export function isProjectOverdue(project: AtlasObject, pct: number, today = todayStamp()): boolean {
  const due = typeof project.props.due === "string" ? project.props.due.slice(0, 10) : "";
  return pct < 100 && !!due && DATE_RE.test(due) && due < today;
}

/* ----------------------------------------------------------------- People  */

export type ContactTier = "fresh" | "warm" | "cooling" | "distant" | "none";

export interface PersonContact {
  lastDate?: string;
  daysAgo?: number;
  touches: number;                              // linked objects of any kind
  recent: { date: string; o: AtlasObject }[];   // dated touches, newest first
  tier: ContactTier;
}

/** Objects connected to this one: body backlinks plus the frontmatter links
 *  that don't show up as wiki-links (a meeting's `attendees`, a task's
 *  `project`, etc.). Mirrors enhance.gatherRelated, re-implemented here to
 *  keep this module free of the AI stack. */
export function relatedTo(index: ObjectIndex, obj: AtlasObject): AtlasObject[] {
  const keys = new Set([obj.title.toLowerCase(), obj.stem.toLowerCase()]);
  const out = new Map<string, AtlasObject>();
  for (const b of index.backlinks.get(obj.path) ?? []) out.set(b.path, b);
  for (const o of index.all) {
    if (o.path === obj.path) continue;
    const linkFm = ["project", "location", "org", "place", "organization"].some((k) =>
      keys.has(normLink(o.props[k])));
    const attendee = Array.isArray(o.props.attendees) &&
      o.props.attendees.some((a) => keys.has(normLink(a)));
    if (linkFm || attendee) out.set(o.path, o);
  }
  return [...out.values()];
}

const tierFor = (daysAgo: number): ContactTier =>
  daysAgo <= 7 ? "fresh" : daysAgo <= 30 ? "warm" : daysAgo <= 90 ? "cooling" : "distant";

export function personContact(index: ObjectIndex, person: AtlasObject, today = todayStamp()): PersonContact {
  const related = relatedTo(index, person);
  const dated = related
    .map((o) => { const date = contactDateOf(o); return date ? { date, o } : null; })
    .filter(Boolean) as { date: string; o: AtlasObject }[];
  dated.sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
  const touches = related.length;
  // Only past-or-today touches count as contact — an upcoming meeting must not
  // read as "in touch today".
  const past = dated.filter((d) => daysBetween(d.date, today) >= 0);
  if (!past.length) return { touches, recent: dated.slice(0, 8), tier: touches ? "distant" : "none" };
  const lastDate = past[0].date;
  const daysAgo = daysBetween(lastDate, today);   // >= 0 by construction
  return { lastDate, daysAgo, touches, recent: dated.slice(0, 8), tier: tierFor(daysAgo) };
}

export const TIER_META: Record<ContactTier, { glyph: string; label: string; color: string }> = {
  fresh:   { glyph: "●", label: "In touch",      color: "var(--done)" },
  warm:    { glyph: "◕", label: "Warm",          color: "#2e7d4f" },
  cooling: { glyph: "◑", label: "Cooling off",   color: "var(--warn)" },
  distant: { glyph: "○", label: "Out of touch",  color: "var(--signal)" },
  none:    { glyph: "·", label: "No contact yet", color: "var(--ink-3)" },
};

/** "today" / "3 days ago" / "in 2 days" from a day-count gap. */
export function agoLabel(daysAgo: number | undefined): string {
  if (daysAgo === undefined) return "never";
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 14) return `${daysAgo} days ago`;
  if (daysAgo < 60) return `${Math.round(daysAgo / 7)} weeks ago`;
  return `${Math.round(daysAgo / 30)} months ago`;
}

/** Two-letter monogram for a person (or any titled object) without a photo. */
export function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "·";
  // Spread iterates by code point, so a surrogate pair (CJK extension, emoji)
  // is never split into a lone-surrogate "�".
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  const first = [...words[0]][0] ?? "";
  const last = [...words[words.length - 1]][0] ?? "";
  return (first + last).toUpperCase();
}
