import { readFile, writeFile, fileExists, ensureDir, join } from "./vault";
import { AtlasProfile } from "./atlasProfile";
import { ObjectIndex, objectsOfType } from "./objects";
import { logChangeDebounced } from "./changeLog";

/** Habits are objects (type: habit); completions are a plain markdown
 *  checklist under `## Habits` in the day's capture note. Obsidian sees an
 *  ordinary checklist, your automations see the same daily note they always
 *  have, and Atlas computes streaks by reading the days back. */

export interface HabitDef {
  path: string;
  name: string;
  kind: "check" | "timer";
  minutes: number;       // timer goal
  order: number;
}

export interface DayEntry { done: boolean; minutes?: number; }
export type DayLog = Map<string, DayEntry>;          // habit name -> entry

const SECTION = "## Habits";

export function habitDefs(index: ObjectIndex): HabitDef[] {
  return objectsOfType(index, "habit")
    .map((o) => ({
      path: o.path,
      name: o.title,
      kind: (o.props.kind === "timer" ? "timer" : "check") as "check" | "timer",
      minutes: Math.max(1, Number(o.props.minutes) || 15),
      order: Number(o.props.order) || 999,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** The six from the user's own daily notes — offered when no habits exist. */
export const STARTER_HABITS: { name: string; kind: "check" | "timer"; minutes?: number }[] = [
  { name: "Gratitude", kind: "check" },
  { name: "Journal", kind: "check" },
  { name: "Meditate", kind: "timer", minutes: 15 },
  { name: "Exercise", kind: "timer", minutes: 30 },
  { name: "Morning Walk", kind: "check" },
  { name: "Afternoon Walk", kind: "check" },
];

function parseLog(raw: string): DayLog {
  const log: DayLog = new Map();
  let inSection = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) inSection = line.trim() === SECTION;
    if (!inSection) continue;
    const m = line.match(/^- \[( |x|X)\] (.+?)(?:\s+—\s+(\d+)m)?\s*$/);
    if (m) log.set(m[2].trim(), { done: m[1] !== " ", minutes: m[3] ? Number(m[3]) : undefined });
  }
  return log;
}

export async function readDayLog(profile: AtlasProfile, date: string): Promise<DayLog> {
  const path = join(profile.capture, `${date}.md`);
  if (!(await fileExists(path))) return new Map();
  try { return parseLog(await readFile(path)); } catch { return new Map(); }
}

export async function readRangeLogs(
  profile: AtlasProfile, dates: string[],
): Promise<Map<string, DayLog>> {
  const out = new Map<string, DayLog>();
  const BATCH = 16;
  for (let i = 0; i < dates.length; i += BATCH) {
    await Promise.all(dates.slice(i, i + BATCH).map(async (d) => {
      out.set(d, await readDayLog(profile, d));
    }));
  }
  return out;
}

/** Tick (or untick) a habit in the date's capture note. Touches only the
 *  one checklist line; everything else in the note survives untouched. */
export async function setHabit(
  profile: AtlasProfile, date: string, name: string, done: boolean, minutes?: number,
): Promise<string> {
  const path = join(profile.capture, `${date}.md`);
  await ensureDir(profile.capture);
  const raw = (await fileExists(path)) ? await readFile(path) : `# Daily Capture — ${date}\n`;
  const entry = `- [${done ? "x" : " "}] ${name}${done && minutes ? ` — ${minutes}m` : ""}`;
  const lines = raw.split("\n");

  let secStart = lines.findIndex((l) => l.trim() === SECTION);
  if (secStart === -1) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", SECTION);
    secStart = lines.length - 1;
  }
  let secEnd = lines.length;
  for (let i = secStart + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { secEnd = i; break; }
  }

  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRe = new RegExp(`^- \\[( |x|X)\\] ${esc}(\\s+—.*)?\\s*$`);
  let replaced = false;
  for (let i = secStart + 1; i < secEnd; i++) {
    if (lineRe.test(lines[i])) { lines[i] = entry; replaced = true; break; }
  }
  if (!replaced) {
    let at = secEnd;
    while (at > secStart + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, entry);
  }

  await writeFile(path, lines.join("\n").trimEnd() + "\n");
  logChangeDebounced(profile, path, "Updated the Habits checklist in a daily note from the tracker.");
  return path;
}

/** Consecutive done-days ending today (today itself may still be pending). */
export function streakFor(datesDesc: string[], logs: Map<string, DayLog>, name: string): number {
  let n = 0;
  for (let i = 0; i < datesDesc.length; i++) {
    const done = logs.get(datesDesc[i])?.get(name)?.done ?? false;
    if (done) n++;
    else if (i === 0) continue;   // today not done yet doesn't break the streak
    else break;
  }
  return n;
}
