import { readFile, writeFile, fileExists, ensureDir, join } from "./vault";
import { AtlasProfile } from "./atlasProfile";
import { todayStamp } from "./daily";
import { logChangeDebounced } from "./changeLog";

/** Health metrics are append-only markdown logs — one file per metric,
 *  one line per reading. Greppable, chartable, Obsidian-readable:
 *    - 2026-06-12 07:01 — 82.4 kg
 *    - 2026-06-12 07:02 — 122/78 · 61 bpm
 */

export type MetricKey = "weight" | "bp";

export interface Reading {
  date: string;          // YYYY-MM-DD
  time?: string;         // HH:MM
  nums: number[];        // weight: [kg]; bp: [sys, dia, pulse?]
  text: string;          // the raw value text after the dash
}

const META: Record<MetricKey, { file: string; title: string }> = {
  weight: { file: "Weight.md", title: "Weight" },
  bp: { file: "Blood Pressure.md", title: "Blood Pressure" },
};

const healthDir = (profile: AtlasProfile) =>
  join(profile.root, profile.isAtlas ? "02-Library/Health" : "Health");

export const metricPath = (profile: AtlasProfile, metric: MetricKey) =>
  join(healthDir(profile), META[metric].file);

const LINE_RE = /^- (\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s+—\s+(.+?)\s*$/;

export async function readReadings(profile: AtlasProfile, metric: MetricKey): Promise<Reading[]> {
  const path = metricPath(profile, metric);
  if (!(await fileExists(path))) return [];
  const out: Reading[] = [];
  for (const line of (await readFile(path)).split("\n")) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const nums = (m[3].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (nums.length) out.push({ date: m[1], time: m[2], nums, text: m[3] });
  }
  out.sort((a, b) => (`${a.date} ${a.time ?? ""}` < `${b.date} ${b.time ?? ""}` ? -1 : 1));
  return out;
}

export async function appendReading(
  profile: AtlasProfile, metric: MetricKey, text: string,
): Promise<string> {
  const path = metricPath(profile, metric);
  await ensureDir(healthDir(profile));
  let raw: string;
  if (await fileExists(path)) {
    raw = (await readFile(path)).trimEnd() + "\n";
  } else {
    const t = META[metric].title;
    raw = `---\ntype: metric\ntitle: ${t}\ncreated: ${todayStamp()}\n---\n\n# ${t}\n\n`;
  }
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  await writeFile(path, raw + `- ${todayStamp()} ${hhmm} — ${text}\n`);
  logChangeDebounced(profile, path, `Logged a ${META[metric].title.toLowerCase()} reading from the habit tracker.`);
  return path;
}
