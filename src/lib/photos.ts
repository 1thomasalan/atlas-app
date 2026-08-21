import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { AtlasProfile } from "./atlasProfile";
import { writeBinaryFile, ensureDir, fileExists, join } from "./vault";
import { PickedImage } from "./vision";

/** Finding and saving photos for objects. Stock photos come from Openverse
 *  (CC-licensed, no key) with a Wikipedia thumbnail fallback. Anything we
 *  fetch is downloaded into the vault so previews survive offline / link rot;
 *  the frontmatter `image:` then holds a vault-relative path. */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

/** A real photo URL for a query, or null. */
export async function searchPhoto(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  // 1. Openverse — CC-licensed images, keyless
  try {
    const res = await doFetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=5&mature=false`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const j = (await res.json()) as { results?: { url?: string }[] };
      const hit = (j.results ?? []).find((r) => typeof r.url === "string" && /^https?:/.test(r.url!));
      if (hit?.url) return hit.url;
    }
  } catch { /* fall through */ }
  // 2. Wikipedia page thumbnail — good for named places/orgs
  try {
    const res = await doFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, "_"))}`,
      { headers: { "User-Agent": "AtlasPKM/2.0 (+atlas)" } },
    );
    if (res.ok) {
      const j = (await res.json()) as { thumbnail?: { source?: string } };
      if (j.thumbnail?.source) return j.thumbnail.source;
    }
  } catch { /* fall through */ }
  return null;
}

const extOf = (url: string, mime?: string) =>
  /\.png(\?|$)/i.test(url) || mime?.includes("png") ? "png"
    : /\.webp(\?|$)/i.test(url) || mime?.includes("webp") ? "webp"
    : /\.gif(\?|$)/i.test(url) || mime?.includes("gif") ? "gif"
    : /\.svg(\?|$)/i.test(url) || mime?.includes("svg") ? "svg" : "jpg";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "photo";

/** Download a remote image into <attachRel>; returns the vault-relative path,
 *  or the original URL if saving isn't possible (browser demo / failure) so
 *  the cover still shows. */
export async function savePhotoFromUrl(
  profile: AtlasProfile, attachRel: string, stem: string, url: string,
): Promise<string> {
  if (!inTauri) return url;
  try {
    const res = await doFetch(url);
    if (!res.ok) return url;
    // Don't download a 200 that isn't actually an image (error interstitials,
    // HTML pages) and write it into the vault as a .jpg.
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.startsWith("image/")) return url;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 500 || buf.length > 12_000_000) return url;
    const dir = join(profile.root, attachRel);
    await ensureDir(dir);
    const ext = extOf(url, res.headers.get("content-type") ?? undefined);
    let name = `${slug(stem)}.${ext}`;
    if (await fileExists(join(dir, name))) name = `${slug(stem)}-${Date.now() % 10000}.${ext}`;
    await writeBinaryFile(join(dir, name), buf);
    return `${attachRel}/${name}`;
  } catch {
    return url;
  }
}

/** Save a picked file into <attachRel>; returns vault-relative path (or a
 *  data URL in browser demo so it still renders). */
export async function savePhotoFromImage(
  profile: AtlasProfile, attachRel: string, stem: string, img: PickedImage,
): Promise<string> {
  if (!inTauri) return `data:${img.mime};base64,${img.b64}`;
  const dir = join(profile.root, attachRel);
  await ensureDir(dir);
  const ext = extOf("", img.mime);
  let name = `${slug(stem)}.${ext}`;
  if (await fileExists(join(dir, name))) name = `${slug(stem)}-${Date.now() % 10000}.${ext}`;
  const bin = atob(img.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await writeBinaryFile(join(dir, name), bytes);
  return `${attachRel}/${name}`;
}

/** Attachments folder for a type's objects, given the type's folder. */
export const attachmentsFor = (typeFolder: string) => `${typeFolder.replace(/\/$/, "")}/Attachments`;
