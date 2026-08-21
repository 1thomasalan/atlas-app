import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { readFile, writeFile, fileExists, ensureDir, join } from "./vault";
import { AtlasProfile } from "./atlasProfile";
import { AtlasObject, ObjectIndex } from "./objects";
import { splitRawFrontmatter } from "./frontmatter";

/** Semantic search over the vault. Embeddings are cached per file in
 *  .atlas/embeddings.json (vault-local, like everything else) and only
 *  changed objects are re-embedded. 512 dims keeps the cache small;
 *  vectors come back unit-length so similarity is a plain dot product. */

const MODEL = "text-embedding-3-small";
const DIMS = 512;
const CACHE_FILE = ".atlas/embeddings.json";
const MODEL_TAG = `${MODEL}@${DIMS}`;

export interface EmbeddingCache {
  model: string;
  items: Record<string, { h: string; v: number[] }>;   // vault-relative path -> hash + vector
}

const doFetch = (input: string, init: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

/** Cheap change detector from index metadata — no file read needed. Saves
 *  through Atlas bump `updated`, so edits re-embed at most once per day
 *  unless the excerpt/title/tags moved too. */
function hashOf(o: AtlasObject): string {
  const s = `${o.title}|${o.updated ?? ""}|${o.tags.join(",")}|${o.excerpt}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

async function callOpenAI(key: string, inputs: string[]): Promise<number[][]> {
  const res = await doFetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIMS }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const out: number[][] = new Array(inputs.length);
  for (const d of json.data) out[d.index] = d.embedding.map((x) => Math.round(x * 1e5) / 1e5);
  return out;
}

async function embedTextFor(o: AtlasObject): Promise<string> {
  let body = "";
  try { body = splitRawFrontmatter(await readFile(o.path)).body; } catch { /* moved */ }
  return [o.title, o.tags.map((t) => `#${t}`).join(" "), body.slice(0, 2000)]
    .filter(Boolean).join("\n").trim() || o.title;
}

export async function loadEmbeddingCache(profile: AtlasProfile): Promise<EmbeddingCache> {
  const path = join(profile.root, CACHE_FILE);
  if (await fileExists(path)) {
    try {
      const cache = JSON.parse(await readFile(path)) as EmbeddingCache;
      if (cache.model === MODEL_TAG && cache.items) return cache;
    } catch { /* corrupt — rebuild */ }
  }
  return { model: MODEL_TAG, items: {} };
}

/** Embed new/changed objects, prune deleted ones, persist the cache.
 *  Returns how much work was done so the UI can report it. */
export async function ensureEmbeddings(
  profile: AtlasProfile,
  index: ObjectIndex,
  key: string,
): Promise<{ cache: EmbeddingCache; embedded: number; total: number }> {
  const cache = await loadEmbeddingCache(profile);
  const live = new Set(index.all.map((o) => o.rel));

  for (const rel of Object.keys(cache.items)) {
    if (!live.has(rel)) delete cache.items[rel];
  }

  const changed = index.all.filter((o) => cache.items[o.rel]?.h !== hashOf(o));
  const BATCH = 64;
  for (let i = 0; i < changed.length; i += BATCH) {
    const slice = changed.slice(i, i + BATCH);
    const texts = await Promise.all(slice.map(embedTextFor));
    const vectors = await callOpenAI(key, texts);
    slice.forEach((o, j) => { cache.items[o.rel] = { h: hashOf(o), v: vectors[j] }; });
  }

  if (changed.length > 0) {
    await ensureDir(join(profile.root, ".atlas"));
    await writeFile(join(profile.root, CACHE_FILE), JSON.stringify(cache));
  }
  return { cache, embedded: changed.length, total: index.all.length };
}

export interface SemanticHit { o: AtlasObject; score: number; }

/** Nearest neighbours to an object using its OWN cached embedding — no API
 *  call, so the "Related" panel is instant and free whenever the object has
 *  already been embedded (the background sync keeps it so). Returns [] when
 *  the object isn't embedded yet; the panel just stays hidden until it is. */
export function semanticNeighbors(
  cache: EmbeddingCache,
  index: ObjectIndex,
  obj: AtlasObject,
  opts: { topK?: number; exclude?: Set<string>; minScore?: number } = {},
): SemanticHit[] {
  const self = cache.items[obj.rel]?.v;
  if (!self) return [];
  const { topK = 6, exclude, minScore = 0.3 } = opts;
  const byRel = new Map(index.all.map((o) => [o.rel, o]));
  const hits: SemanticHit[] = [];
  for (const [rel, item] of Object.entries(cache.items)) {
    if (rel === obj.rel) continue;
    const o = byRel.get(rel);
    if (!o || (exclude && exclude.has(o.path))) continue;
    let dot = 0;
    const v = item.v;
    const n = Math.min(v.length, self.length);
    for (let i = 0; i < n; i++) dot += v[i] * self[i];
    if (dot > minScore) hits.push({ o, score: dot });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

export async function semanticSearch(
  key: string,
  cache: EmbeddingCache,
  index: ObjectIndex,
  query: string,
  topK = 6,
): Promise<SemanticHit[]> {
  const [qv] = await callOpenAI(key, [query.slice(0, 500)]);
  const byRel = new Map(index.all.map((o) => [o.rel, o]));
  const hits: SemanticHit[] = [];
  for (const [rel, item] of Object.entries(cache.items)) {
    const o = byRel.get(rel);
    if (!o) continue;
    let dot = 0;
    const v = item.v;
    for (let i = 0; i < v.length && i < qv.length; i++) dot += v[i] * qv[i];
    if (dot > 0.25) hits.push({ o, score: dot });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}
