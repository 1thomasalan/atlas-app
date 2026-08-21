import { AtlasProfile } from "./atlasProfile";
import { ObjectIndex, objectsOfType } from "./objects";
import { loadAllTasks } from "./tasks";
import { todayStamp } from "./daily";
import { readFile } from "./vault";
import { upsertSection } from "./sections";
import { aiDailyBriefing } from "./assist";

/** The morning auto-brief: on the first open of today's daily note, a calm
 *  "what needs me today" briefing writes itself into the note as an editable
 *  `## Morning Brief` section. Written once per day — the heading's presence
 *  is the guard, so re-opening the note (or another machine syncing it) won't
 *  re-spend the API call or stack duplicates. */

export const BRIEF_HEADING = "Morning Brief";
const HEAD_RE = new RegExp(`^##\\s+${BRIEF_HEADING}\\b`, "m");

/** True if today's note already carries a morning brief. */
export async function hasBriefToday(notePath: string): Promise<boolean> {
  try { return HEAD_RE.test(await readFile(notePath)); }
  catch { return false; }
}

export interface BriefResult { wrote: boolean; toast: string; }

/** Gather today's context and write the brief into `notePath`. Skips (without
 *  calling the model) when a brief is already present, unless `force`. */
export async function runMorningBriefing(
  key: string,
  profile: AtlasProfile,
  index: ObjectIndex,
  notePath: string,
  opts: { force?: boolean } = {},
): Promise<BriefResult> {
  if (!opts.force && (await hasBriefToday(notePath))) {
    return { wrote: false, toast: "Morning brief already written today" };
  }

  const today = todayStamp();
  const tasks = (await loadAllTasks(profile)).filter((t) => t.lane !== "done");
  const top = tasks.filter((t) => t.top).sort((a, b) => (a.top! < b.top! ? -1 : 1)).slice(0, 3);
  const dueSoon = tasks.filter((t) => t.due && t.due <= today);
  const waiting = tasks.filter((t) => t.lane === "waiting");
  const week = tasks.filter((t) => t.lane === "week");

  const todaysMeetings = index.all.filter(
    (o) => o.typeKey === "meeting" && String(o.props.date ?? "").slice(0, 10) === today,
  );
  const yesterday = objectsOfType(index, "daily")
    .filter((o) => /^\d{4}-\d{2}-\d{2}/.test(o.stem) && o.stem < today)
    .sort((a, b) => (a.stem < b.stem ? 1 : -1))[0];

  const ctx = [
    `Today is ${today}.`,
    top.length ? "Top three today:\n" + top.map((t) => `- ${t.title}`).join("\n") : "",
    todaysMeetings.length ? "Meetings scheduled today:\n" + todaysMeetings.map((m) => `- ${m.title}`).join("\n") : "",
    dueSoon.length ? "Due today / overdue:\n" + dueSoon.map((t) => `- ${t.title} (${t.due})`).join("\n") : "",
    waiting.length ? "Waiting on:\n" + waiting.map((t) => `- ${t.title}`).join("\n") : "",
    week.length ? "This week:\n" + week.slice(0, 8).map((t) => `- ${t.title}`).join("\n") : "",
    yesterday ? `Yesterday's note (${yesterday.stem}):\n${yesterday.excerpt.slice(0, 240)}` : "",
  ].filter(Boolean).join("\n\n");

  const text = await aiDailyBriefing(key, ctx);
  const md = `${text}\n\n*✨ Auto-brief · ${today}*`;
  await upsertSection(notePath, BRIEF_HEADING, md);
  return { wrote: true, toast: "Morning brief written into today's note" };
}
