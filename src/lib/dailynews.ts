import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { hostOf } from "./unfurl";
import { webSearchModel, tokenBudget } from "./aiModel";

/** Live news research for the Daily Brief, via OpenAI's web-search tool on the
 *  Responses API. The model searches the open web (past 24h), then returns a
 *  compact JSON list of high-signal items with real source URLs. Local news can
 *  be translated to English. Requires a key whose org has web search enabled —
 *  failures surface a clear message rather than fabricating stale "news". */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const RESPONSES = "https://api.openai.com/v1/responses";

export interface BriefStory {
  title: string;
  summary: string;
  source: string;
  url: string;
  date?: string;
}

interface RawResp {
  error?: { message?: string };
  output?: {
    type: string;
    content?: { type: string; text?: string; annotations?: { url?: string; title?: string }[] }[];
  }[];
  output_text?: string;
}

/** Pull the assistant's text out of a Responses API result. */
function extractText(j: RawResp): string {
  let text = "";
  for (const item of j.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) text += part.text;
    }
  }
  if (!text && typeof j.output_text === "string") text = j.output_text;
  return text;
}

interface RawStory { title?: string; headline?: string; summary?: string; gist?: string; source?: string; publication?: string; url?: string; link?: string; date?: string }

/** Find the first JSON array in the model's text (tolerant of code fences). */
function parseStories(text: string): RawStory[] {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("["), end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try { const a = JSON.parse(cleaned.slice(start, end + 1)); if (Array.isArray(a)) return a; } catch { /* */ }
  }
  try {
    const obj = JSON.parse(cleaned) as { stories?: RawStory[]; items?: RawStory[] };
    if (Array.isArray(obj.stories)) return obj.stories;
    if (Array.isArray(obj.items)) return obj.items;
  } catch { /* */ }
  return [];
}

function normalize(raw: RawStory[]): BriefStory[] {
  const out: BriefStory[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const title = String(r.title ?? r.headline ?? "").trim();
    if (!title) continue;
    // The item must carry its OWN live link. (We deliberately don't borrow an
    // arbitrary citation here — that mis-attributes a story to a wrong article.)
    const url = String(r.url ?? r.link ?? "").trim();
    if (!/^https?:\/\//.test(url)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      summary: String(r.summary ?? r.gist ?? "").trim(),
      source: String(r.source ?? r.publication ?? hostOf(url) ?? "").trim(),
      url,
      date: r.date ? String(r.date).slice(0, 10) : undefined,
    });
  }
  return out;
}

/** One web-search request → normalized stories. Tries the GA tool name and
 *  falls back to the preview name for older keys. */
async function webSearch(key: string, prompt: string): Promise<BriefStory[]> {
  if (!inTauri) throw new Error("Live news needs the desktop app (web requests are blocked in the browser demo).");
  // Try the user's chosen (web-search-capable) model first, then gpt-4o as a
  // dependable floor; each with the GA tool name then the legacy preview name.
  const models = [...new Set([webSearchModel(), "gpt-4o"])];
  let lastErr = "";
  for (const model of models) {
    for (const tool of ["web_search", "web_search_preview"]) {
      let res: Response;
      try {
        res = await doFetch(RESPONSES, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, tools: [{ type: tool }], input: prompt, max_output_tokens: tokenBudget(2000) }),
        });
      } catch (e) { lastErr = e instanceof Error ? e.message : "network error"; continue; }
      const j = (await res.json().catch(() => ({}))) as RawResp;
      if (!res.ok) {
        lastErr = j.error?.message ?? `OpenAI ${res.status}`;
        if (/web_search|tool|not supported|unsupported|unknown|model/i.test(lastErr)) continue; // tool/model unsupported — try next combo
        throw new Error(lastErr);
      }
      return normalize(parseStories(extractText(j)));
    }
  }
  throw new Error(lastErr || "web search failed");
}

const SHARED =
  "Editorial filter: prefer items that genuinely advance the field or make humanity better; prefer primary " +
  "sources and reputable reporting; avoid low-quality aggregation and duplicate rewrites; dedupe the same " +
  "underlying event. It is acceptable to return fewer items if there isn't enough high-signal news. " +
  'Respond with ONLY a JSON array, no prose, no markdown: ' +
  '[{"title":"","summary":"","source":"","url":"","date":"YYYY-MM-DD"}]. ' +
  "Each url must be the exact article link. The summary is one or two sentences on why it matters.";

/** Top developments in the past 24h for a topic. */
export async function researchTopic(key: string, topic: string, max = 3): Promise<BriefStory[]> {
  const prompt =
    `You are a sharp intelligence editor. Using web search, find the ${max} highest-signal developments ` +
    `from the PAST 24 HOURS on the topic: "${topic}". ${SHARED}`;
  return (await webSearch(key, prompt)).slice(0, max);
}

/** Top local news in the past 24h, translated to English when needed. */
export async function researchLocalNews(key: string, location: string, max = 4): Promise<BriefStory[]> {
  const prompt =
    `Using web search, find the ${max} most important LOCAL news stories from the PAST 24 HOURS for ` +
    `${location}. Prefer reputable local or regional outlets. If the local language is not English, TRANSLATE ` +
    `the title and summary into clear English (keep the original source url). ${SHARED}`;
  return (await webSearch(key, prompt)).slice(0, max);
}
