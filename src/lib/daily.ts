import { readFile, writeFile, fileExists, join, ensureDir } from "./vault";
import { AtlasProfile } from "./atlasProfile";
import { logChangeDebounced } from "./changeLog";

/** Daily capture note: everything reviews write lands here, so the user's
 *  existing Claude automation processes it with zero changes. */

export function todayStamp(d = new Date()): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(stamp: string, n: number): string {
  const [y, m, d] = stamp.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return todayStamp(date);
}

export function captureNotePath(profile: AtlasProfile, d = new Date()): string {
  return join(profile.capture, `${todayStamp(d)}.md`);
}

export async function ensureCaptureNote(profile: AtlasProfile): Promise<string> {
  await ensureDir(profile.capture);
  const path = captureNotePath(profile);
  if (!(await fileExists(path))) {
    await writeFile(path, `# Daily Capture — ${todayStamp()}\n\n`);
  }
  return path;
}

export async function appendToCapture(profile: AtlasProfile, section: string): Promise<string> {
  const path = await ensureCaptureNote(profile);
  const current = await readFile(path);
  await writeFile(path, current.trimEnd() + "\n\n" + section.trim() + "\n");
  logChangeDebounced(profile, path, "Appended a review or pomodoro section to today's capture note.");
  return path;
}

const time = () => new Date().toTimeString().slice(0, 5);

export function morningSection(topThree: string[], note: string): string {
  const lines = [`## Morning Review (${time()})`, "", "Top three for today:"];
  topThree.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  if (note.trim()) lines.push("", `Intent: ${note.trim()}`);
  return lines.join("\n");
}

export function middaySection(status: string[], note: string): string {
  const lines = [`## Midday Check (${time()})`, ""];
  status.forEach((s) => lines.push(`- ${s}`));
  if (note.trim()) lines.push("", `Course correction: ${note.trim()}`);
  return lines.join("\n");
}

export function eveningSection(wins: string, friction: string, tomorrow: string, rolled: string[]): string {
  const lines = [`## Evening Recap (${time()})`, ""];
  if (wins.trim()) lines.push(`What went well: ${wins.trim()}`, "");
  if (friction.trim()) lines.push(`Friction: ${friction.trim()}`, "");
  if (tomorrow.trim()) lines.push(`Tomorrow matters most: ${tomorrow.trim()}`, "");
  if (rolled.length) {
    lines.push("Rolled forward:");
    rolled.forEach((r) => lines.push(`- ${r}`));
  }
  return lines.join("\n");
}

export function pomodoroSection(minutes: number, focus: string): string {
  return `- Pomodoro ${time()}: ${minutes}m${focus.trim() ? ` — ${focus.trim()}` : ""}`;
}
