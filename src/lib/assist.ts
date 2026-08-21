import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { chatModel, tokenBudget, chatContent } from "./aiModel";

/** Small text assists over the user's OpenAI key. Same rule as everywhere:
 *  the model proposes, the result lands in ordinary frontmatter the user
 *  can see and edit. The model is whatever the user picked in Settings. */

const doFetch = (input: string, init: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

/** Coerce a model JSON field to a clean string[] even if it came back as a
 *  string, null, or an array of non-strings. */
const arr = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);

async function chat(key: string, prompt: string, json = false): Promise<string> {
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: chatModel(),
      messages: [{ role: "user", content: prompt }],
      ...(json ? { response_format: { type: "json_object" } } : {}),
      max_completion_tokens: tokenBudget(300),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return chatContent(await res.json()).trim();
}

/** The Daily Brief's "bottom line up front": one signal connecting the day's
 *  headlines. Uses the chat model only (no web search) — cheap. */
export async function aiBriefLead(key: string, headlines: string[]): Promise<string> {
  const text = await chat(key,
    `These are today's intelligence-brief headlines:\n${headlines.map((h) => `- ${h}`).join("\n")}\n\n` +
    "Write a 2-3 sentence \"bottom line up front\" naming the single connecting signal beneath them — " +
    "the pattern a busy reader should take away. No preamble, no list, no headline, plain prose.");
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}

export async function aiSummary(key: string, title: string, body: string): Promise<string> {
  const text = await chat(key,
    `Summarize this note in one or two plain sentences (max 220 characters). No preamble, no quotes.\n\nTitle: ${title}\n\n${body.slice(0, 6000)}`);
  // single line — a newline in a frontmatter scalar would corrupt the YAML
  return text.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim().slice(0, 240);
}

export interface PageDigest { summary: string; key_points: string[]; }

export async function aiPageDigest(
  key: string, title: string, text: string,
): Promise<PageDigest> {
  const raw = await chatLong(key,
    `You summarize web pages. Return JSON: {"summary": string, "key_points": string[]}.\n` +
    `summary: 3-6 plain sentences covering what the page is and its key takeaways.\n` +
    `key_points: 3-8 short bullets with the most useful facts or claims; if the page teaches a ` +
    `procedure, the points are its steps in order. Ignore navigation/boilerplate.\n\n` +
    `Page title: ${title}\n\nPage text:\n${text.slice(0, 60_000)}`);
  const parsed = JSON.parse(raw) as Partial<PageDigest>;
  return {
    summary: (parsed.summary ?? "").trim() || "No summary produced.",
    key_points: arr(parsed.key_points).slice(0, 12),
  };
}

export interface VideoDigest { summary: string; steps: string[]; }

export async function aiVideoDigest(
  key: string, title: string, transcript: string,
): Promise<VideoDigest> {
  const raw = await chatLong(key,
    `You summarize video transcripts. Return JSON: {"summary": string, "steps": string[]}.\n` +
    `summary: 3-6 plain sentences covering what the video is about and its key takeaways.\n` +
    `steps: if the video teaches a procedure, recipe, workout, or any how-to, list ALL the steps ` +
    `in order as short imperative sentences. If it is not a step-by-step video, return an empty array.\n\n` +
    `Video title: ${title}\n\nTranscript:\n${transcript.slice(0, 60_000)}`);
  const parsed = JSON.parse(raw) as Partial<VideoDigest>;
  return {
    summary: (parsed.summary ?? "").trim() || "No summary produced.",
    steps: arr(parsed.steps).slice(0, 40),
  };
}

// Longer responses. JSON mode is on by default (most callers parse a JSON
// object), but OpenAI rejects json_object when the prompt never says "json",
// so prose callers (the daily briefing) must opt out with json=false.
async function chatLong(key: string, prompt: string, json = true): Promise<string> {
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: chatModel(),
      messages: [{ role: "user", content: prompt }],
      ...(json ? { response_format: { type: "json_object" } } : {}),
      max_completion_tokens: tokenBudget(1800),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return chatContent(await res.json()).trim();
}

/* ----------------------------------------------------------------------
   Object-aware enhancements. Each takes context gathered from the vault
   index and returns a structured result the caller formats into a
   markdown section. The model proposes; the user keeps editable markdown.
   ---------------------------------------------------------------------- */

export interface RelationshipRecap { recap: string; followups: string[]; }
export async function aiRelationshipRecap(
  key: string, name: string, context: string,
): Promise<RelationshipRecap> {
  const raw = await chatLong(key,
    `You help someone keep up with the people in their life. Using only the notes provided, write a warm, concise relationship recap. ` +
    `Return JSON {"recap": "3-5 plain sentences on who they are, recent interactions, and what matters", "followups": ["2-4 specific, doable follow-up ideas"]}. ` +
    `Do not invent facts beyond the notes. No preamble.\n\n` +
    `Person: ${name}\n\nNotes that mention them (meetings, pages, tasks):\n${context.slice(0, 14000) || "(no linked notes yet)"}`);
  const p = JSON.parse(raw) as Partial<RelationshipRecap>;
  return {
    recap: (p.recap ?? "").trim() || "Not enough linked notes yet to recap.",
    followups: arr(p.followups).slice(0, 5),
  };
}

export interface Reconnect { reason: string; opener: string; }
export async function aiReconnect(
  key: string, name: string, daysAgo: number | undefined, context: string,
): Promise<Reconnect> {
  const gap = daysAgo === undefined ? "a while" : daysAgo <= 1 ? "a day" : `${daysAgo} days`;
  const raw = await chatLong(key,
    `You help someone nurture the relationships that matter to them. It has been ${gap} since the vault last recorded contact with ${name}. ` +
    `Using only the notes provided, suggest a natural, low-pressure way to reconnect. ` +
    `Return JSON {"reason": "1 sentence — a genuine, specific reason to reach out now, grounded in the notes", "opener": "1-2 sentences they could actually send — warm, casual, specific, first person"}. ` +
    `Do not invent facts beyond the notes. No preamble.\n\n` +
    `Person: ${name}\n\nNotes that mention them (meetings, pages, tasks):\n${context.slice(0, 12000) || "(no linked notes yet)"}`);
  const p = JSON.parse(raw) as Partial<Reconnect>;
  return { reason: (p.reason ?? "").trim(), opener: (p.opener ?? "").trim() };
}

export interface PlaceNearby { intro: string; suggestions: string[]; }
export async function aiPlaceNearby(
  key: string, name: string, coords: { lat: number; lon: number } | null, locationText: string,
): Promise<PlaceNearby> {
  const raw = await chatLong(key,
    `You are a well-travelled local guide. Suggest notable things at or near this place — neighbourhoods, landmarks, food, nature, practical tips. ` +
    `Return JSON {"intro": "1-2 sentences orienting the area", "suggestions": ["4-7 short bullets, each a place/thing and why it's worth it"]}. ` +
    `Base it on general knowledge of the area; if you are unsure of a specific venue, stay general (areas, types of things) rather than inventing exact names. No preamble.\n\n` +
    `Place: ${name}\n` + (locationText ? `Location: ${locationText}\n` : "") +
    (coords ? `Coordinates: ${coords.lat}, ${coords.lon}\n` : ""));
  const p = JSON.parse(raw) as Partial<PlaceNearby>;
  return {
    intro: (p.intro ?? "").trim(),
    suggestions: arr(p.suggestions).slice(0, 8),
  };
}

export interface ProjectStatus { status: string; risks: string[]; next: string[]; }
export async function aiProjectStatus(
  key: string, name: string, context: string,
): Promise<ProjectStatus> {
  const raw = await chatLong(key,
    `You are a sharp project manager. From the linked tasks and meetings, write a status digest. ` +
    `Return JSON {"status": "2-4 sentences on where the project stands and momentum", "risks": ["0-3 risks or blockers, only if evident"], "next": ["2-4 concrete next steps"]}. ` +
    `Only use what's in the notes; don't invent. No preamble.\n\n` +
    `Project: ${name}\n\nLinked tasks and meetings:\n${context.slice(0, 14000) || "(nothing linked yet)"}`);
  const p = JSON.parse(raw) as Partial<ProjectStatus>;
  return {
    status: (p.status ?? "").trim() || "Nothing linked yet to summarize.",
    risks: arr(p.risks).slice(0, 4),
    next: arr(p.next).slice(0, 5),
  };
}

export interface NutritionWeek { summary: string; nudge: string; }
export async function aiNutritionWeek(
  key: string, mealsContext: string,
): Promise<NutritionWeek> {
  const raw = await chatLong(key,
    `You are a supportive, non-judgemental nutrition coach. From this week's logged meals, write a short digest. ` +
    `Return JSON {"summary": "2-4 sentences on patterns — calories, protein, balance, variety", "nudge": "one specific, kind, actionable suggestion for next week"}. ` +
    `No medical claims, no calorie prescriptions, no shaming. Base it only on the data. No preamble.\n\n` +
    `This week's meals:\n${mealsContext.slice(0, 14000) || "(no meals logged this week)"}`);
  const p = JSON.parse(raw) as Partial<NutritionWeek>;
  return {
    summary: (p.summary ?? "").trim() || "No meals logged this week yet.",
    nudge: (p.nudge ?? "").trim(),
  };
}

export interface MeetingActions { summary: string; actions: string[]; }
export async function aiMeetingActions(
  key: string, title: string, body: string,
): Promise<MeetingActions> {
  const raw = await chatLong(key,
    `Summarize this meeting note and extract action items. Return JSON {"summary": "2-4 sentences", "actions": ["each a clear task, with owner if stated"]}. ` +
    `Only use what's written. No preamble.\n\nMeeting: ${title}\n\n${body.slice(0, 12000)}`);
  const p = JSON.parse(raw) as Partial<MeetingActions>;
  return {
    summary: (p.summary ?? "").trim() || "Nothing to summarize.",
    actions: arr(p.actions).slice(0, 12),
  };
}

export async function aiDailyBriefing(key: string, context: string): Promise<string> {
  const raw = await chatLong(key,
    `You are a calm, sharp chief-of-staff. From the user's priorities, tasks, and recent notes, write a short "what needs me today" briefing: ` +
    `2-4 plain sentences naming the few things that genuinely matter today and why, then one short forward-looking nudge if useful. ` +
    `Warm and specific, no preamble, no headings. Use a short markdown list only if it truly helps.\n\n${context.slice(0, 12000)}`,
    false);  // prose, not JSON — json_object mode would 400 on this prompt
  // briefing is markdown shown in a panel (not frontmatter) — keep newlines
  return raw.replace(/^["']|["']$/g, "").trim();
}

export async function aiTags(
  key: string, title: string, body: string, vaultTags: string[],
): Promise<string[]> {
  const raw = await chat(key,
    `Suggest 2-4 tags for this note. Prefer reusing tags from the existing vocabulary when they fit; ` +
    `invent a new lowercase-kebab-case tag only when nothing fits. ` +
    `Return JSON: {"tags": ["..."]}\n\nExisting vocabulary: ${vaultTags.slice(0, 80).join(", ") || "(none yet)"}\n\n` +
    `Title: ${title}\n\n${body.slice(0, 5000)}`, true);
  const parsed = JSON.parse(raw) as { tags?: unknown };
  return arr(parsed.tags)
    .map((t) => t.replace(/^#/, "").toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean)
    .slice(0, 4);
}
