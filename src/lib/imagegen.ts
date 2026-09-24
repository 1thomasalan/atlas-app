import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { AtlasProfile } from "./atlasProfile";
import { ObjectTypeDef } from "./objectTypes";
import { AtlasObject } from "./objects";
import { savePhotoFromImage, attachmentsFor } from "./photos";

/** Generating an abstract "cover" graphic for an object when no real photo can
 *  be found. The OpenAI image model (gpt-image-1, with a dall-e-3 fallback for
 *  accounts without access) paints a tasteful abstract piece evoking the
 *  object; if that's unavailable — no key, browser demo, or an API error — we
 *  fall back to a deterministic generative SVG seeded by the object so a fitting
 *  visual always lands. Either way the result is saved like any other photo: a
 *  vault file whose relative path goes into the `image:` frontmatter. */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const OPENAI_IMAGES = "https://api.openai.com/v1/images/generations";

export interface GenImage { b64: string; mime: string; }

/** An abstract-but-appropriate prompt drawn from the object. */
function coverPrompt(obj: AtlasObject, type: ObjectTypeDef): string {
  const subject = (obj.title || type.name).trim();
  const ctx = [obj.props.location, obj.props.org]
    .filter((v) => typeof v === "string" && (v as string).trim())
    .map((v) => String(v).replace(/^\[\[|\]\]$/g, "").trim())
    .join(", ");
  return (
    `Abstract, tasteful cover artwork evoking the ${type.name.toLowerCase()} "${subject}"` +
    (ctx ? ` (${ctx})` : "") + ". " +
    "Soft layered geometric shapes, gentle gradients, a refined modern editorial colour palette, " +
    "calm and contemporary, suitable as a banner background. Non-representational or only lightly " +
    "suggestive of the subject. Absolutely no text, words, letters, numbers, logos, signatures, or watermarks."
  );
}

/** Low-level: ask OpenAI to paint `prompt`; returns PNG base64. Throws on
 *  failure so callers can fall back to a procedural cover. Tries gpt-image-1
 *  first, then dall-e-3 for accounts that lack gpt-image-1 access. */
async function openaiImage(key: string, prompt: string): Promise<GenImage> {
  const attempts: Record<string, unknown>[] = [
    { model: "gpt-image-1", prompt, size: "1024x1024", quality: "low", n: 1 },
    { model: "dall-e-3", prompt, size: "1024x1024", response_format: "b64_json", n: 1 },
  ];
  let lastErr = "";
  for (const body of attempts) {
    let res: Response;
    try {
      res = await doFetch(OPENAI_IMAGES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch (e) { lastErr = e instanceof Error ? e.message : "network error"; continue; }
    if (!res.ok) { lastErr = `OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`; continue; }
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = j.data?.[0]?.b64_json;
    if (b64) return { b64, mime: "image/png" };
    lastErr = "OpenAI returned no image data";
  }
  throw new Error(lastErr || "image generation failed");
}

/** An abstract cover for an Atlas object (Fetch with no photo). */
export async function aiAbstractCover(key: string, obj: AtlasObject, type: ObjectTypeDef): Promise<GenImage> {
  return openaiImage(key, coverPrompt(obj, type));
}

/** An editorial illustration that fits a Daily-Brief news story. */
export async function aiStoryImage(key: string, title: string, summary: string): Promise<GenImage> {
  const prompt =
    `Editorial cover illustration for a news item titled "${title}". ` +
    (summary ? `Context: ${summary.slice(0, 300)}. ` : "") +
    "Tasteful modern editorial illustration, abstract or lightly illustrative, composed as a horizontal news image. " +
    "It must read as conceptual artwork rather than documentary photography and must not imply that it depicts the actual event. " +
    "Use clean forms and a varied editorial palette. Absolutely no text, words, letters, numbers, logos, signatures, or watermarks.";
  return openaiImage(key, prompt);
}

// ── Deterministic generative-SVG fallback ───────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Stable 32-bit hash of a string → a seed (same object, same artwork). */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Small seeded PRNG so a given object always paints the same cover. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let hue = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0)
      : max === g ? (b - r) / d + 2
      : (r - g) / d + 4;
    hue *= 60;
  }
  return [hue, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** UTF-8-safe base64 of an SVG string (chunked to avoid call-stack limits). */
function svgToB64(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A soft mesh-gradient abstract, seeded by `seed` and (optionally) tinted by a
 *  base hex colour. Pure SVG → no network, works in browser demo and the app. */
function proceduralCoverCore(seed: string, baseHex?: string): GenImage {
  const rnd = mulberry32(hashStr(seed));
  const base = (baseHex ? hexToHsl(baseHex) : null) ?? [Math.floor(rnd() * 360), 52, 52];
  const [bh, bsRaw] = base;
  const bs = clamp(bsRaw, 28, 78);
  const W = 1024, H = 1024;

  const bgA = hslToHex(bh, bs * 0.55, 27);
  const bgB = hslToHex(bh + 26, bs * 0.5, 15);

  // 8–10 soft blobs in an analogous palette, brighter than the ground so they
  // read as light pooling through the gradient.
  const n = 8 + Math.floor(rnd() * 3);
  let blobs = "";
  for (let i = 0; i < n; i++) {
    const hue = bh + (rnd() - 0.5) * 90;
    const sat = clamp(bs * (0.6 + rnd() * 0.5), 25, 90);
    const light = 46 + rnd() * 28;
    const fill = hslToHex(hue, sat, light);
    const op = (0.16 + rnd() * 0.34).toFixed(2);
    const cx = Math.round(rnd() * W);
    const cy = Math.round(rnd() * H);
    const r = Math.round(150 + rnd() * 360);
    if (rnd() < 0.32) {
      const w = r * (1.1 + rnd() * 0.8), h = r * (0.7 + rnd() * 0.6);
      const rot = Math.round(rnd() * 360);
      blobs += `<rect x="${Math.round(cx - w / 2)}" y="${Math.round(cy - h / 2)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(Math.min(w, h) * 0.5)}" fill="${fill}" fill-opacity="${op}" transform="rotate(${rot} ${cx} ${cy})"/>`;
    } else {
      const ry = Math.round(r * (0.7 + rnd() * 0.5));
      blobs += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry}" fill="${fill}" fill-opacity="${op}"/>`;
    }
  }

  // A faint focal highlight gives the composition a centre of gravity.
  const fhx = Math.round(W * (0.3 + rnd() * 0.4)), fhy = Math.round(H * (0.25 + rnd() * 0.35));
  const highlight = hslToHex(bh - 18, clamp(bs * 0.7, 20, 80), 74);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>` +
    `</linearGradient>` +
    `<radialGradient id="hl" cx="${(fhx / W).toFixed(2)}" cy="${(fhy / H).toFixed(2)}" r="0.6">` +
    `<stop offset="0" stop-color="${highlight}" stop-opacity="0.5"/><stop offset="1" stop-color="${highlight}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="vig" cx="0.5" cy="0.42" r="0.78">` +
    `<stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.34"/>` +
    `</radialGradient>` +
    `<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="36"/></filter>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<g filter="url(#soft)">${blobs}</g>` +
    `<rect width="${W}" height="${H}" fill="url(#hl)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#vig)"/>` +
    `</svg>`;

  return { b64: svgToB64(svg), mime: "image/svg+xml" };
}

/** Procedural cover for an Atlas object, tinted by its type colour. */
export function proceduralCover(obj: AtlasObject, type: ObjectTypeDef): GenImage {
  return proceduralCoverCore(`${type.key}:${obj.title || obj.stem || type.name}`, type.color);
}

/** Procedural cover for a news story, with a seeded hue (no type colour). */
export function proceduralStoryCover(title: string): GenImage {
  return proceduralCoverCore(`story:${title}`);
}

/** Make an abstract cover for an object that has no real photo and save it into
 *  the vault, returning the stored value for `image:` and whether a real AI
 *  model painted it (vs. the deterministic SVG fallback). */
export async function generateCover(
  profile: AtlasProfile, type: ObjectTypeDef, obj: AtlasObject, openaiKey: string,
): Promise<{ stored: string; ai: boolean }> {
  let img: GenImage | null = null;
  let ai = false;
  if (inTauri && openaiKey) {
    try { img = await aiAbstractCover(openaiKey, obj, type); ai = true; }
    catch (e) { console.warn("AI cover generation failed — using procedural fallback:", e); }
  }
  if (!img) img = proceduralCover(obj, type);
  const stored = await savePhotoFromImage(
    profile, attachmentsFor(type.folder), obj.title || type.name,
    { b64: img.b64, mime: img.mime, name: `${obj.title || type.name} cover` },
  );
  return { stored, ai };
}
