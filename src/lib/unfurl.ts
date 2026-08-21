import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { convertFileSrc } from "@tauri-apps/api/core";
import { inTauri } from "./demoFs";
import { youtubeId, fetchYouTubeMeta } from "./youtube";
import { readFile, writeFile, writeBinaryFile, ensureDir, fileExists, join } from "./vault";
import { splitRawFrontmatter, setRawFrontmatterKey } from "./frontmatter";
import { todayStamp } from "./daily";
import { AtlasProfile } from "./atlasProfile";

/** Link unfurling, Notion-bookmark style. The contract is plain frontmatter,
 *  so a browser extension can write the very same fields when clipping:
 *    url:         the link
 *    site:        site name or hostname
 *    description: og/meta description
 *    image:       vault-relative path (Atlas downloads it) OR a remote URL
 *    favicon:     remote URL
 *  The card renderer accepts both image forms — extension writes remote,
 *  Atlas re-downloads into the vault whenever you hit Fetch preview. */

export interface Unfurled {
  title?: string;
  description?: string;
  site?: string;
  image?: string;     // absolute URL
  favicon?: string;   // absolute URL
}

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const meta = (doc: Document, sel: string) =>
  doc.querySelector(sel)?.getAttribute("content")?.trim() || undefined;

export async function unfurl(url: string): Promise<Unfurled> {
  // YouTube serves a JS shell with no OG tags — use its real endpoints
  const vid = youtubeId(url);
  if (vid) {
    const m = await fetchYouTubeMeta(url, vid);
    return {
      title: m.title,
      description: m.author ? `YouTube · ${m.author}` : "YouTube video",
      site: "youtube.com",
      image: m.thumb,
      favicon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=64",
    };
  }

  const res = await doFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AtlasPKM/2.0 (+link-preview)", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 600_000);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = new URL(url);
  const abs = (u?: string | null) => {
    if (!u) return undefined;
    try { return new URL(u, base).href; } catch { return undefined; }
  };

  const iconHref =
    doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    doc.querySelector('link[rel~="icon"]')?.getAttribute("href");

  return {
    title:
      meta(doc, 'meta[property="og:title"]') ??
      meta(doc, 'meta[name="twitter:title"]') ??
      (doc.querySelector("title")?.textContent?.trim() || undefined),
    description:
      meta(doc, 'meta[property="og:description"]') ??
      meta(doc, 'meta[name="description"]') ??
      meta(doc, 'meta[name="twitter:description"]'),
    site: meta(doc, 'meta[property="og:site_name"]') ?? base.hostname.replace(/^www\./, ""),
    image: abs(meta(doc, 'meta[property="og:image"]') ?? meta(doc, 'meta[name="twitter:image"]')),
    favicon: abs(iconHref) ?? `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=64`,
  };
}

/** Download the cover into the vault so previews survive dead links.
 *  Returns the vault-relative path, or undefined on any failure. */
async function downloadCover(
  profile: AtlasProfile, imageUrl: string, stem: string, weblinkFolder: string,
): Promise<string | undefined> {
  if (!inTauri) return undefined;          // demo mode keeps the remote URL
  try {
    const res = await doFetch(imageUrl);
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 8_000_000) return undefined;
    const ext = /\.png(\?|$)/i.test(imageUrl) ? "png" : /\.webp(\?|$)/i.test(imageUrl) ? "webp" : "jpg";
    const rel = `${weblinkFolder}/Attachments`;
    await ensureDir(join(profile.root, rel));
    let name = `${stem}.${ext}`;
    if (await fileExists(join(profile.root, rel, name))) name = `${stem} ${Date.now() % 10000}.${ext}`;
    await writeBinaryFile(join(profile.root, rel, name), buf);
    return `${rel}/${name}`;
  } catch {
    return undefined;
  }
}

/** Fetch metadata for a weblink object and write it into the frontmatter.
 *  The title is only overwritten when it still looks unset (equals the URL
 *  or the filename) — a name you typed yourself is never clobbered. */
export async function unfurlIntoObject(
  profile: AtlasProfile,
  objectPath: string,
  url: string,
  weblinkFolder: string,
): Promise<Unfurled> {
  const u = await unfurl(url);
  const raw = await readFile(objectPath);
  const { fmRaw, body: rawBody } = splitRawFrontmatter(raw);
  const stem = objectPath.split("/").pop()!.replace(/\.md$/, "");
  // an untouched auto-generated body (`# <stem>`) just repeats the title — drop it
  const body = rawBody.trim() === `# ${stem}` ? "\n" : rawBody;

  let next = fmRaw || "---\n---\n";
  next = setRawFrontmatterKey(next, "url", url);
  const currentTitle = /^title:\s*(.*)$/m.exec(fmRaw)?.[1]?.replace(/^["']|["']$/g, "").trim();
  const looksUnset = !currentTitle || currentTitle === url || currentTitle === stem ||
    currentTitle === hostOf(url) || currentTitle === "Weblink";
  if (u.title && looksUnset) next = setRawFrontmatterKey(next, "title", u.title);
  if (u.site) next = setRawFrontmatterKey(next, "site", u.site);
  if (u.description) next = setRawFrontmatterKey(next, "description", u.description.slice(0, 300));
  if (u.favicon) next = setRawFrontmatterKey(next, "favicon", u.favicon);
  if (u.image) {
    const local = await downloadCover(profile, u.image, stem, weblinkFolder);
    next = setRawFrontmatterKey(next, "image", local ?? u.image);
  }
  next = setRawFrontmatterKey(next, "updated", todayStamp());
  await writeFile(objectPath, next + body);
  return u;
}

/** Write an AI digest into the object: short `summary:` frontmatter plus a
 *  `## Summary` section and an optional list section in the body (replacing
 *  any previous digest, keeping everything the user wrote above it). */
export async function writeDigest(
  objectPath: string,
  summary: string,
  items: string[],
  itemsHeading: string,
  ordered: boolean,
): Promise<void> {
  const raw = await readFile(objectPath);
  const { fmRaw, body } = splitRawFrontmatter(raw);
  let next = setRawFrontmatterKey(fmRaw || "---\n---\n", "summary", summary.slice(0, 240));
  next = setRawFrontmatterKey(next, "updated", todayStamp());

  const cut = body.indexOf("## Summary");
  const kept = (cut === -1 ? body : body.slice(0, cut)).trimEnd();
  const sections = [`## Summary`, "", summary.trim()];
  if (items.length) {
    sections.push("", `## ${itemsHeading}`, "",
      ...items.map((s, i) => `${ordered ? `${i + 1}.` : "-"} ${s.trim()}`));
  }
  const out = (kept ? kept + "\n\n" : "\n") + sections.join("\n") + "\n";
  await writeFile(objectPath, next + out);
}

/** Readable text of a page for summarization — crude tag stripping is
 *  plenty for an LLM. */
export async function fetchPageText(url: string): Promise<string> {
  const res = await doFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AtlasPKM/2.0 (+link-preview)", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 900_000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return html
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();
}

export const looksLikeUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());

export const hostOf = (url: unknown): string | undefined => {
  if (typeof url !== "string" || !url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return undefined; }
};

/** Resolve an `image:` frontmatter value to something an <img> can load:
 *  remote URLs pass through; vault-relative paths go via the asset protocol. */
export function coverSrc(vaultRoot: string, image: unknown): string | undefined {
  if (typeof image !== "string" || !image) return undefined;
  if (/^(https?:|data:|blob:)/i.test(image)) return image;   // remote / inline / demo
  if (!inTauri) return undefined;
  return convertFileSrc(`${vaultRoot}/${image}`);
}
