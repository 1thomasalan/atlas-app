import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";

/** The user-selectable chat / reasoning model that powers Atlas's AI layer —
 *  summaries, tags, the morning brief, screenshot import (vision), and the
 *  Daily Brief synthesis. Set from Settings at boot and on change, then read
 *  lazily by the AI libs at call time. Embeddings and image generation use
 *  their own fixed models and are NOT affected by this choice.
 *
 *  The dropdown is seeded with this curated list, but Settings can also pull the
 *  live list straight from the user's key (`fetchAvailableModels`) so brand-new
 *  models (GPT-5.5 and whatever's next) show up without an app update. */

export interface ChatModelDef { id: string; label: string; note: string }

/** Curated seed list + the source of truth for friendly labels. Real OpenAI
 *  chat model ids (mid-2026). "Load models from your key" replaces this with
 *  exactly what the account can use. */
export const CHAT_MODELS: ChatModelDef[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "fast & economical (default)" },
  { id: "gpt-5-mini", label: "GPT-5 mini", note: "cheap, strong reasoning" },
  { id: "gpt-5", label: "GPT-5", note: "value workhorse" },
  { id: "gpt-4.1", label: "GPT-4.1", note: "capable, non-reasoning" },
  { id: "gpt-5.4", label: "GPT-5.4", note: "balanced flagship" },
  { id: "gpt-5.5", label: "GPT-5.5", note: "current flagship" },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", note: "max capability — costly" },
];

export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

/** Friendly label for a model id (known ones get a tier hint, others show raw). */
const LABELS: Record<string, string> = {
  "gpt-4o-mini": "GPT-4o mini · fast & economical",
  "gpt-4o": "GPT-4o · balanced",
  "gpt-4.1-mini": "GPT-4.1 mini · fast",
  "gpt-4.1": "GPT-4.1 · capable",
  "gpt-5-nano": "GPT-5 nano · cheapest",
  "gpt-5-mini": "GPT-5 mini · cheap, strong",
  "gpt-5": "GPT-5 · value workhorse",
  "gpt-5.1": "GPT-5.1",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.2-pro": "GPT-5.2 Pro",
  "gpt-5.4": "GPT-5.4 · balanced",
  "gpt-5.4-pro": "GPT-5.4 Pro",
  "gpt-5.5": "GPT-5.5 · current flagship",
  "gpt-5.5-pro": "GPT-5.5 Pro · max",
  "o3": "o3 · reasoning",
  "o3-pro": "o3-pro · reasoning",
  "o4-mini": "o4-mini · reasoning",
};
export const labelFor = (id: string): string => LABELS[id] ?? id;

/** GPT-5 family + o-series are reasoning models. They reject `max_tokens` and a
 *  non-default `temperature`, and spend hidden reasoning tokens against the
 *  output budget — so they need token headroom (see `tokenBudget`). */
export const isReasoningModel = (id: string): boolean =>
  /^o\d/.test(id) || /^gpt-5(\.|-|$)/.test(id);

/** A generous output cap. Reasoning models burn hidden tokens before any visible
 *  output, so add headroom or they return empty (finish_reason "length"). Cost
 *  is billed by tokens actually used, not the cap, so a high cap is free safety. */
export const tokenBudget = (visible: number): number =>
  isReasoningModel(active) ? visible + 4000 : visible;

let active = DEFAULT_CHAT_MODEL;

/** Point the AI layer at the user's chosen model (call when settings load/change). */
export function setChatModel(id: string | undefined): void {
  active = (id && id.trim()) || DEFAULT_CHAT_MODEL;
}

/** The active chat model for assist/vision calls. */
export const chatModel = (): string => active;

/** Pull the assistant text out of a chat/completions response, throwing a clear
 *  error when it's empty. A reasoning model can spend its whole token budget on
 *  hidden reasoning and return finish_reason "length" with no visible content —
 *  callers used to blindly `.trim()` / `JSON.parse` that and throw an opaque
 *  TypeError/SyntaxError. */
export function chatContent(json: unknown): string {
  const choice = (json as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] })?.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (!content) {
    throw new Error(choice?.finish_reason === "length"
      ? "The model hit its token limit before producing output — pick a non-reasoning model or a higher tier."
      : "The model returned no content.");
  }
  return content;
}

/** Does a model support the Responses-API web_search tool? (gpt-4o/4.1 series,
 *  gpt-5 family except nano, o3/o4 — per OpenAI's web-search guide.) */
const WS_OK = new Set(["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"]);
export const supportsWebSearch = (id: string): boolean =>
  WS_OK.has(id) || (/^gpt-5(\.|-|$)/.test(id) && !/nano/.test(id)) || /^o[34]/.test(id);

/** A web-search-capable model for the Daily Brief: the active model if it can
 *  search, else gpt-4o (the dependable floor). */
export const webSearchModel = (): string => (supportsWebSearch(active) ? active : "gpt-4o");

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

/** The chat-capable models the user's key can actually use, newest first.
 *  /v1/models is account-scoped and carries no capability metadata, so filter
 *  to chat ids by naming convention. Throws on failure (caller keeps the
 *  curated list). */
export async function fetchAvailableModels(key: string): Promise<string[]> {
  const res = await doFetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { data?: { id: string; created?: number }[] };
  const rows = (j.data ?? []).filter((m) => typeof m.id === "string");
  const chat = rows.filter(
    (m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) &&
      !/(embedding|image|dall-e|whisper|tts|audio|realtime|moderation|transcribe|search|computer-use|codex|instruct|davinci|babbage)/i.test(m.id),
  );
  chat.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return chat.map((m) => m.id);
}
