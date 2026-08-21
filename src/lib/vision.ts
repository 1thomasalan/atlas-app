import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { chatModel, tokenBudget, chatContent } from "./aiModel";
import type { WorkoutDraft, MealDraft } from "./healthImport";

/** Screenshot → structured data via the user's chosen GPT vision model. The
 *  model only proposes; the user reviews and edits before anything touches the
 *  vault. Multiple images are sent together (one workout often spans pages). */

export interface PickedImage { b64: string; mime: string; name: string; }

export interface WorkoutExtract {
  date: string | null;
  time: string | null;
  duration_minutes: number | null;
  workout_type: string | null;
  energy_kcal: number | null;
  heart_rate: string | null;
  exercises: { name: string; amount: string }[];
}

export interface MealExtract {
  date: string | null;
  meal: "breakfast" | "lunch" | "dinner" | "snack" | null;
  items: { name: string; quantity: string | null; calories: number | null }[];
  calories_total: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

const doFetch = (input: string, init: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const PROMPTS = {
  workout: `You read fitness-app screenshots. All images are pages of ONE workout session — combine them.
Return strict JSON only:
{"date": "YYYY-MM-DD" | null, "time": "HH:MM" | null, "duration_minutes": number | null,
 "workout_type": string | null, "energy_kcal": number | null, "heart_rate": string | null,
 "exercises": [{"name": string, "amount": string}]}
Keep amounts as shown ("9×", "15sec"). Deduplicate nothing — repeated exercises are separate sets, list each occurrence in order. Use null when a field is not visible.`,
  meal: `You read food photos and nutrition-app screenshots. All images are ONE meal — combine them.
Return strict JSON only:
{"date": "YYYY-MM-DD" | null, "meal": "breakfast" | "lunch" | "dinner" | "snack" | null,
 "items": [{"name": string, "quantity": string | null, "calories": number | null}],
 "calories_total": number | null, "protein_g": number | null, "carbs_g": number | null, "fat_g": number | null}
Estimate calories and macros from what is visible if the image is a photo of food rather than an app screen — estimates are acceptable. Use null when unknown.`,
};

export async function extractFromImages(
  key: string,
  kind: "workout" | "meal",
  images: PickedImage[],
  notes = "",
): Promise<WorkoutExtract | MealExtract> {
  const note = notes.trim();
  const text = PROMPTS[kind] + (note
    ? `\n\nThe user added context the image can't show — use it to fill in or correct fields ` +
      `(e.g. brand, portion size, how it was prepared, which numbers to trust):\n"""${note.slice(0, 2000)}"""`
    : "");
  const content: unknown[] = [{ type: "text", text }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.b64}`, detail: "high" },
    });
  }
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: chatModel(),
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_completion_tokens: tokenBudget(1200),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }
  return JSON.parse(chatContent(await res.json()));
}

/* ----------------------------------------------------------------------
   Place profile: a short, concise wiki-style write-up for a location,
   built from its name, coordinates, and (optionally) a photo of it.
   ---------------------------------------------------------------------- */

export interface PlaceProfile { summary: string; highlights: string[]; }

export async function aiPlaceProfile(
  key: string,
  name: string,
  coords: { lat: number; lon: number } | null,
  image?: PickedImage,
): Promise<PlaceProfile> {
  const text =
    `You write very short location profiles for a personal knowledge base. ` +
    `Write a concise, accurate profile of this place. Return JSON {"summary": "2-4 plain sentences", "highlights": ["2-5 short bullets"]}. ` +
    `Cover what and where it is and why someone notes it. If you are unsure of specifics, stay general — do NOT invent precise facts like hours, prices, or addresses. No preamble.\n\n` +
    `Name: ${name || "(unknown — infer from the photo if you can)"}\n` +
    (coords ? `Coordinates: ${coords.lat}, ${coords.lon}\n` : "");

  const content: unknown[] = [{ type: "text", text }];
  if (image) {
    content.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}`, detail: "low" } });
  }
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: chatModel(),
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_completion_tokens: tokenBudget(700),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = JSON.parse(chatContent(await res.json())) as Partial<PlaceProfile>;
  return {
    summary: (parsed.summary ?? "").trim() || "No profile produced.",
    highlights: (parsed.highlights ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
  };
}

/* ----------------------------------------------------------------------
   Refine pass: re-read the photo with the user's typed context in mind,
   correct the numbers if the note implies it, and add plain-language
   insights about this entry and any trend versus recent history. The
   user's note is their own context, treated as data the model weighs —
   nothing it returns is executed; it only fills fields the user reviews.
   ---------------------------------------------------------------------- */

export interface RefineResult { draft: WorkoutDraft | MealDraft; insights: string; }

const refineInstructions = (kind: "workout" | "meal") =>
  kind === "meal"
    ? `You are refining a logged MEAL. You get the food photo(s), the values already extracted, the user's own note giving extra context, and their recent meals. ` +
      `Re-estimate the numbers ONLY where the note or photo justifies a change (e.g. "shared, ate half" → halve portions). ` +
      `Then write "insights": 2-4 warm, specific sentences about THIS meal and any trend vs the recent meals (protein balance, calories vs their average, repeated patterns). No medical claims, no preamble.\n` +
      `Return JSON: {"date","meal","items":[{"name","quantity","calories"}],"calories_total","protein_g","carbs_g","fat_g","insights"}.`
    : `You are refining a logged WORKOUT. You get the screenshot(s), the values already extracted, the user's own note, and their recent workouts. ` +
      `Adjust fields only where the note or image justifies it. ` +
      `Then write "insights": 2-4 warm, specific sentences about THIS session and any trend vs recent workouts (duration, energy, heart rate, consistency). No medical claims, no preamble.\n` +
      `Return JSON: {"date","time","duration_minutes","workout_type","energy_kcal","heart_rate","exercises":[{"name","amount"}],"insights"}.`;

export async function refineHealthImport(
  key: string,
  kind: "workout" | "meal",
  images: PickedImage[],
  draft: WorkoutDraft | MealDraft,
  notes: string,
  history: string,
): Promise<RefineResult> {
  const text =
    `${refineInstructions(kind)}\n\n` +
    `Already extracted (the user may have hand-edited these):\n${JSON.stringify(draft)}\n\n` +
    `User's note (context to weigh — may be empty):\n"""${notes.trim() || "(none)"}"""\n\n` +
    `Recent ${kind}s, newest first:\n${history || "(no earlier entries)"}`;

  const content: unknown[] = [{ type: "text", text }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.b64}`, detail: "high" },
    });
  }
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: chatModel(),
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_completion_tokens: tokenBudget(1400),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = JSON.parse(chatContent(await res.json())) as Record<string, unknown> & { insights?: string };
  const insights = typeof parsed.insights === "string" ? parsed.insights.trim() : "";

  const str = (v: unknown) => (v == null ? "" : String(v));
  if (kind === "meal") {
    const m = parsed as unknown as MealExtract;
    const MEALS = ["breakfast", "lunch", "dinner", "snack"];
    const next: MealDraft = {
      date: str(m.date) || (draft as MealDraft).date,
      // empty/invalid meal from the model must not blank the user's choice
      meal: MEALS.includes(str(m.meal).trim()) ? str(m.meal).trim() : (draft as MealDraft).meal,
      calories: m.calories_total != null ? String(m.calories_total) : (draft as MealDraft).calories,
      protein: m.protein_g != null ? String(m.protein_g) : (draft as MealDraft).protein,
      carbs: m.carbs_g != null ? String(m.carbs_g) : (draft as MealDraft).carbs,
      fat: m.fat_g != null ? String(m.fat_g) : (draft as MealDraft).fat,
      items: (m.items ?? []).map((i) =>
        `${i.name}${i.quantity ? ` (${i.quantity})` : ""}${i.calories != null ? ` — ${i.calories} kcal` : ""}`).join("\n")
        || (draft as MealDraft).items,
    };
    return { draft: next, insights };
  }
  const w = parsed as unknown as WorkoutExtract;
  const next: WorkoutDraft = {
    date: str(w.date) || (draft as WorkoutDraft).date,
    time: str(w.time) || (draft as WorkoutDraft).time,
    minutes: w.duration_minutes != null ? String(Math.round(w.duration_minutes)) : (draft as WorkoutDraft).minutes,
    workoutType: str(w.workout_type) || (draft as WorkoutDraft).workoutType,
    kcal: w.energy_kcal != null ? String(w.energy_kcal) : (draft as WorkoutDraft).kcal,
    heartRate: str(w.heart_rate) || (draft as WorkoutDraft).heartRate,
    exercises: (w.exercises ?? []).map((e) => `${e.name} — ${e.amount}`).join("\n") || (draft as WorkoutDraft).exercises,
  };
  return { draft: next, insights };
}
