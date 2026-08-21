import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";

/** YouTube link intelligence. The watch page serves a JS shell with no OG
 *  tags, and the InnerTube API 403s any request carrying the webview's
 *  Origin header — so everything YouTube goes through the Rust `yt_data`
 *  command (verified working with bare reqwest headers): captions via the
 *  iOS client, a directly playable muxed mp4 via the ANDROID client.
 *  Only oEmbed + thumbnails (plain GETs, origin-tolerant) stay in JS. */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/;

export const youtubeId = (url: string): string | undefined => YT_RE.exec(url)?.[1];

export interface YouTubeMeta { title?: string; author?: string; thumb: string; }

export async function fetchYouTubeMeta(url: string, id: string): Promise<YouTubeMeta> {
  let title: string | undefined;
  let author: string | undefined;
  try {
    const res = await doFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (res.ok) {
      const j = (await res.json()) as { title?: string; author_name?: string };
      title = j.title;
      author = j.author_name;
    }
  } catch { /* fall through to bare thumbnail */ }

  // maxres is crisp but not minted for every video — probe, fall back to hq
  let thumb = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  try {
    const probe = await doFetch(thumb);
    if (!probe.ok || (await probe.arrayBuffer()).byteLength < 4000) {
      thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  } catch {
    thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return { title, author, thumb };
}

interface YtData { captionsJson3: string | null; streamUrl: string | null; quality: string | null; }

// Stream URLs expire after a few hours; a session cache is plenty.
const ytCache = new Map<string, Promise<YtData>>();

function getYtData(id: string): Promise<YtData> {
  if (!inTauri) return Promise.resolve({ captionsJson3: null, streamUrl: null, quality: null });
  let p = ytCache.get(id);
  if (!p) {
    p = invoke<YtData>("yt_data", { videoId: id });
    p.catch(() => ytCache.delete(id));   // don't cache failures
    ytCache.set(id, p);
  }
  return p;
}

/** Returns the spoken text of the video, or null when it has no captions. */
export async function fetchYouTubeTranscript(id: string): Promise<string | null> {
  const data = await getYtData(id);
  if (!data.captionsJson3) return null;
  const cap = JSON.parse(data.captionsJson3) as { events?: { segs?: { utf8?: string }[] }[] };
  const text = (cap.events ?? [])
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8 ?? "")
    .join("");
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? clean : null;
}

export interface YouTubeStream { url: string; quality: string; }

/** A directly playable mp4 for the native <video> element, or null. */
export async function fetchYouTubeStream(id: string): Promise<YouTubeStream | null> {
  const data = await getYtData(id);
  return data.streamUrl ? { url: data.streamUrl, quality: data.quality ?? "" } : null;
}
