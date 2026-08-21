import { ObjectIndex, AtlasObject, objectsOfType, setObjectProp } from "./objects";
import { ObjectTypeDef, typeByKey } from "./objectTypes";
import { AtlasProfile } from "./atlasProfile";
import { readFile, writeFile, ensureDir, join } from "./vault";
import { splitRawFrontmatter } from "./frontmatter";
import { parseCoords } from "./geo";
import { todayStamp, addDays } from "./daily";
import { upsertSection, bullets } from "./sections";
import {
  aiSummary, aiTags, aiRelationshipRecap, aiPlaceNearby, aiProjectStatus,
  aiMeetingActions, aiNutritionWeek, aiReconnect,
} from "./assist";
import { personContact } from "./relations";

/** The "✨ Enhance" layer: type-aware AI actions that read the object plus
 *  its neighbours in the graph and write an editable markdown section back
 *  (or a frontmatter property). One dispatcher so every object page and the
 *  Meals coach share the same plumbing. */

export interface EnhanceAction { key: string; label: string; needsKey: boolean; }

const COMMON: EnhanceAction[] = [
  { key: "summary", label: "Summarize", needsKey: true },
  { key: "tags", label: "Suggest tags", needsKey: true },
];

export function actionsFor(typeKey: string): EnhanceAction[] {
  switch (typeKey) {
    case "person": return [
      { key: "recap", label: "Relationship recap", needsKey: true },
      { key: "reconnect", label: "Draft a check-in", needsKey: true },
      ...COMMON,
    ];
    case "org": return [{ key: "recap", label: "Overview", needsKey: true }, ...COMMON];
    case "place": return [{ key: "nearby", label: "Nearby & notable", needsKey: true }, ...COMMON];
    case "project": return [{ key: "status", label: "Status digest", needsKey: true }, ...COMMON];
    case "meeting": return [{ key: "actions", label: "Summary & action items", needsKey: true }, ...COMMON];
    default: return COMMON;
  }
}

/** Objects connected to this one: body backlinks plus frontmatter links
 *  (a task's project, a meeting's attendees, a meal's location, etc.). */
const normLink = (v: unknown) => String(v ?? "").replace(/\[\[|\]\]|[#|].*$/g, "").trim().toLowerCase();

export function gatherRelated(index: ObjectIndex, obj: AtlasObject): AtlasObject[] {
  // Links in this app are written against the stem (filename) or the title.
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

async function relatedContext(index: ObjectIndex, types: ObjectTypeDef[], obj: AtlasObject, limit = 10): Promise<string> {
  const related = gatherRelated(index, obj).slice(0, limit);
  const parts: string[] = [];
  for (const o of related) {
    const tn = typeByKey(types, o.typeKey)?.name ?? "Note";
    const meta = [o.props.date, o.props.status, o.props.due].filter(Boolean).join(" · ");
    let body = "";
    try { body = splitRawFrontmatter(await readFile(o.path)).body.replace(/\s+/g, " ").trim().slice(0, 500); } catch { /* skip */ }
    parts.push(`### ${tn}: ${o.title}${meta ? ` (${meta})` : ""}\n${body || o.excerpt}`);
  }
  return parts.join("\n\n");
}

export interface EnhanceResult { toast: string; wroteBody: boolean; }

/** Run an enhance action against an object. Returns whether the body changed
 *  (so the caller can reload an open editor) and a toast. */
export async function runEnhance(
  action: string,
  ctx: { openaiKey: string; profile: AtlasProfile; index: ObjectIndex; types: ObjectTypeDef[]; obj: AtlasObject },
): Promise<EnhanceResult> {
  const { openaiKey: key, index, types, obj } = ctx;
  const bodyOf = async () => { try { return splitRawFrontmatter(await readFile(obj.path)).body; } catch { return obj.excerpt; } };

  switch (action) {
    case "summary": {
      const s = await aiSummary(key, obj.title, await bodyOf());
      await setObjectProp(obj.path, "summary", s);
      return { toast: "Summary written", wroteBody: false };
    }
    case "tags": {
      const suggested = await aiTags(key, obj.title, await bodyOf(), [...index.tags.keys()]);
      const merged = [...new Set([...obj.tags, ...suggested])];
      await setObjectProp(obj.path, "tags", merged.length ? merged : undefined);
      return { toast: suggested.length ? `Tagged: ${suggested.map((t) => `#${t}`).join(" ")}` : "No new tags", wroteBody: false };
    }
    case "recap": {
      const r = await aiRelationshipRecap(key, obj.title, await relatedContext(index, types, obj));
      const md = r.followups.length ? `${r.recap}\n\n**Follow-ups**\n${bullets(r.followups)}` : r.recap;
      const heading = obj.typeKey === "org" ? "Overview" : "Relationship recap";
      await upsertSection(obj.path, heading, md);
      return { toast: `${heading} added`, wroteBody: true };
    }
    case "reconnect": {
      const c = personContact(index, obj);
      const r = await aiReconnect(key, obj.title, c.daysAgo, await relatedContext(index, types, obj));
      const md = [
        r.reason || "A good moment to check in.",
        r.opener ? `\n> ${r.opener}` : "",
        `\n*Last contact ${c.lastDate ?? "unknown"}${c.daysAgo !== undefined ? ` · ${c.daysAgo} days ago` : ""} · AI draft — make it yours.*`,
      ].filter(Boolean).join("\n");
      await upsertSection(obj.path, "Reach out", md);
      return { toast: "Check-in draft added", wroteBody: true };
    }
    case "nearby": {
      const coords = parseCoords(obj.props.coordinates);
      const r = await aiPlaceNearby(key, obj.title, coords, String(obj.props.location ?? ""));
      const md = `${r.intro}\n\n${bullets(r.suggestions)}\n\n*AI suggestions — verify specifics.*`;
      await upsertSection(obj.path, "Nearby & notable", md);
      return { toast: `Added ${r.suggestions.length} nearby ideas`, wroteBody: true };
    }
    case "status": {
      const r = await aiProjectStatus(key, obj.title, await relatedContext(index, types, obj));
      const md = [r.status, r.risks.length ? `**Risks**\n${bullets(r.risks)}` : "", r.next.length ? `**Next steps**\n${bullets(r.next)}` : ""]
        .filter(Boolean).join("\n\n");
      await upsertSection(obj.path, "Status", md);
      return { toast: "Status digest added", wroteBody: true };
    }
    case "actions": {
      const r = await aiMeetingActions(key, obj.title, await bodyOf());
      const md = `${r.summary}${r.actions.length ? `\n\n**Action items**\n${r.actions.map((a) => `- [ ] ${a}`).join("\n")}` : ""}`;
      await upsertSection(obj.path, "Summary & actions", md);
      return { toast: `${r.actions.length} action items extracted`, wroteBody: true };
    }
    default:
      return { toast: "Unknown action", wroteBody: false };
  }
}

/** Nutrition coach over the last 7 days of meals → today's daily note. */
export async function runNutritionWeek(
  key: string, profile: AtlasProfile, index: ObjectIndex,
): Promise<{ notePath: string; toast: string }> {
  const today = todayStamp();
  const since = addDays(today, -6);
  const meals = objectsOfType(index, "meal")
    .filter((m) => typeof m.props.date === "string" && (m.props.date as string) >= since)
    .sort((a, b) => ((a.props.date as string) < (b.props.date as string) ? -1 : 1));
  const ctx = meals.map((m) => {
    const macros = ["calories", "protein", "carbs", "fat"].map((k) => m.props[k] ? `${m.props[k]}${k === "calories" ? "kcal" : "g " + k}` : "").filter(Boolean).join(" ");
    const meal = m.props.meal ? `${m.props.meal}` : "meal";
    return `${m.props.date ?? ""} ${meal}: ${macros || "(no macros)"}${m.excerpt ? " — " + m.excerpt.slice(0, 120) : ""}`.trim();
  }).join("\n");

  const r = await aiNutritionWeek(key, ctx);
  const md = `${r.summary}${r.nudge ? `\n\n**This week, try:** ${r.nudge}` : ""}\n\n*${meals.length} meals · ${since} → ${today} · AI coach*`;
  const notePath = join(profile.capture, `${today}.md`);
  // ensure the daily note (and its folder) exist so the section has a home
  await ensureDir(profile.capture);
  try { await readFile(notePath); } catch { await writeFile(notePath, `# Daily Capture — ${today}\n`); }
  await upsertSection(notePath, "Nutrition", md);
  return { notePath, toast: `Nutrition digest from ${meals.length} meals → today's note` };
}
