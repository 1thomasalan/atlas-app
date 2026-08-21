import { parseFrontmatter, splitRawFrontmatter, setRawFrontmatterKey, yamlNeedsQuote, FM } from "./frontmatter";
import {
  readFile, writeFile, fileExists, ensureDir, moveFile, listTree, join, VaultFile,
} from "./vault";
import { AtlasProfile } from "./atlasProfile";
import { ObjectTypeDef, typeForPath, typeByKey } from "./objectTypes";
import { todayStamp } from "./daily";

/** The object index: every markdown file in the vault, parsed and typed.
 *  Capacities semantics, plain files underneath. Rebuilt on demand and
 *  cheap enough to refresh after every write. */

export interface AtlasObject {
  path: string;          // absolute
  rel: string;           // vault-relative
  stem: string;          // filename without .md
  typeKey: string;       // "" = untyped markdown
  title: string;
  created?: string;      // YYYY-MM-DD if known
  updated?: string;
  tags: string[];
  props: FM;
  excerpt: string;
  links: string[];       // outgoing [[wiki-link]] targets, raw inner text
}

export interface ObjectIndex {
  all: AtlasObject[];
  byPath: Map<string, AtlasObject>;
  backlinks: Map<string, AtlasObject[]>;   // object path -> objects linking to it
  tags: Map<string, AtlasObject[]>;        // tag -> objects
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) out.push(m[1].trim());
  return out;
}

const stripMd = (s: string) =>
  s.replace(/^---[\s\S]*?\n---\n/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")        // image embeds out entirely
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")       // links → their text
    .replace(/[#>*`\[\]|-]/g, " ")
    .replace(/\s+/g, " ").trim();

function flatten(nodes: VaultFile[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isDir) flatten(n.children ?? [], out);
    else out.push(n.path);
  }
  return out;
}

const DATE_STEM = /^(\d{4}-\d{2}-\d{2})/;

function toObject(profile: AtlasProfile, types: ObjectTypeDef[], path: string, raw: string): AtlasObject {
  const rel = path.slice(profile.root.length + 1);
  const stem = path.split("/").pop()!.replace(/\.md$/, "");
  const { fm, body } = parseFrontmatter(raw);

  let typeKey = "";
  const declared = typeof fm.type === "string" ? (fm.type as string) : undefined;
  if (declared && typeByKey(types, declared)) typeKey = declared;
  else if (declared === "note") typeKey = "note";
  else {
    const byFolder = typeForPath(types, rel);
    if (byFolder) typeKey = byFolder.key;
  }
  // A YYYY-MM-DD file in the capture folder is a daily note even untyped
  const dailyType = types.find((t) => t.special === "daily");
  if (dailyType && rel.startsWith(dailyType.folder + "/") && DATE_STEM.test(stem)) typeKey = "daily";

  // A task living in the Done lane is done, even if its frontmatter status is
  // stale or absent (e.g. dragged into 06-Done in Obsidian) — the kanban treats
  // the folder as the source of truth, so derived views (project progress) must
  // agree. Mutating the in-memory props only; the file on disk is untouched.
  if (typeKey === "task") {
    const doneRel = profile.lanes.done.startsWith(profile.root + "/")
      ? profile.lanes.done.slice(profile.root.length + 1)
      : profile.lanes.done;
    if (rel === doneRel || rel.startsWith(doneRel + "/")) fm.status = "done";
  }

  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === "string" && fm.tags ? [fm.tags] : [];
  const created =
    (typeof fm.created === "string" && fm.created.slice(0, 10)) ||
    (DATE_STEM.exec(stem)?.[1] ?? undefined) || undefined;

  return {
    path, rel, stem, typeKey,
    title: (typeof fm.title === "string" && fm.title) || stem,
    created: created || undefined,
    updated: typeof fm.updated === "string" ? fm.updated.slice(0, 10) : undefined,
    tags,
    props: fm,
    excerpt: stripMd(body).slice(0, 160),
    links: extractWikiLinks(body),
  };
}

export async function buildIndex(profile: AtlasProfile, types: ObjectTypeDef[]): Promise<ObjectIndex> {
  const paths = flatten(await listTree(profile.root, 6));
  const all: AtlasObject[] = [];
  const BATCH = 32;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = await Promise.all(
      paths.slice(i, i + BATCH).map(async (p) => {
        try { return toObject(profile, types, p, await readFile(p)); }
        catch { return null; }
      }),
    );
    for (const o of chunk) if (o) all.push(o);
  }
  return indexFromObjects(all);
}

/** Re-read a single file. Null if it vanished. */
export async function loadObject(
  profile: AtlasProfile, types: ObjectTypeDef[], path: string,
): Promise<AtlasObject | null> {
  try { return toObject(profile, types, path, await readFile(path)); }
  catch { return null; }
}

/** Pure swap of one object in an existing index — the cheap refresh used
 *  after editing a single file, so a 5,000-note vault isn't rescanned on
 *  every autosave or property change. */
export function replaceInIndex(index: ObjectIndex, path: string, fresh: AtlasObject | null): ObjectIndex {
  const all = index.all.filter((o) => o.path !== path);
  if (fresh) all.push(fresh);
  return indexFromObjects(all);
}

function indexFromObjects(all: AtlasObject[]): ObjectIndex {
  const byPath = new Map(all.map((o) => [o.path, o]));
  const byName = new Map<string, AtlasObject>();
  for (const o of all) {
    byName.set(o.stem.toLowerCase(), o);
    byName.set(o.title.toLowerCase(), o);
  }

  const backlinks = new Map<string, AtlasObject[]>();
  for (const o of all) {
    for (const target of o.links) {
      const hit = byName.get(target.toLowerCase());
      if (hit && hit.path !== o.path) {
        const arr = backlinks.get(hit.path) ?? [];
        if (!arr.includes(o)) arr.push(o);
        backlinks.set(hit.path, arr);
      }
    }
  }

  const tags = new Map<string, AtlasObject[]>();
  for (const o of all) {
    for (const tag of o.tags) {
      const t = tag.replace(/^#/, "");
      tags.set(t, [...(tags.get(t) ?? []), o]);
    }
  }

  return { all, byPath, backlinks, tags };
}

export function resolveLink(index: ObjectIndex, target: string): AtlasObject | undefined {
  const q = target.trim().toLowerCase();
  return index.all.find((o) => o.stem.toLowerCase() === q) ??
         index.all.find((o) => o.title.toLowerCase() === q);
}

export function objectsOfType(index: ObjectIndex, typeKey: string): AtlasObject[] {
  return index.all.filter((o) => o.typeKey === typeKey);
}

export function createdOn(index: ObjectIndex, date: string): AtlasObject[] {
  return index.all.filter((o) => o.created === date && o.typeKey !== "daily");
}

/** Candidates for the editor's live `[[` picker: matches for a query, or the
 *  most-recently-touched objects when the query is still empty. */
export function linkSuggestions(index: ObjectIndex, query: string, excludePath?: string, limit = 7): AtlasObject[] {
  const q = query.trim();
  const base = q
    ? searchObjects(index, q, limit + 4)
    : [...index.all].filter((o) => o.typeKey)
        .sort((a, b) => ((a.updated ?? a.created ?? "") < (b.updated ?? b.created ?? "") ? 1 : -1));
  return base.filter((o) => o.path !== excludePath).slice(0, limit);
}

export function searchObjects(index: ObjectIndex, query: string, limit = 40): AtlasObject[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = index.all
    .map((o) => {
      const title = o.title.toLowerCase();
      let score = -1;
      if (title === q) score = 100;
      else if (title.startsWith(q)) score = 80;
      else if (title.includes(q)) score = 60;
      else if (o.tags.some((t) => t.toLowerCase().includes(q))) score = 40;
      else if (o.rel.toLowerCase().includes(q)) score = 30;
      else if (o.excerpt.toLowerCase().includes(q)) score = 20;
      return { o, score };
    })
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.o.updated! < b.o.updated! ? 1 : -1));
  return scored.slice(0, limit).map((s) => s.o);
}

/** Obsidian-friendly filename: keep spaces, strip only what breaks links. */
export function safeStem(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 90) || "Untitled";
}

export async function createObject(
  profile: AtlasProfile,
  type: ObjectTypeDef,
  title: string,
  extraFm: Record<string, string | string[]> = {},
  body?: string,
): Promise<string> {
  const dir = join(profile.root, type.folder);
  await ensureDir(dir);
  let path = join(dir, `${safeStem(title)}.md`);
  if (await fileExists(path)) path = path.replace(/\.md$/, ` ${Date.now() % 10000}.md`);

  const today = todayStamp();
  const lines = ["---", `type: ${type.key}`, `title: ${quote(title)}`];
  for (const [k, v] of Object.entries(extraFm)) {
    if (Array.isArray(v)) { lines.push(`${k}:`); v.forEach((item) => lines.push(`  - ${quote(item)}`)); }
    else lines.push(`${k}: ${quote(v)}`);
  }
  if (!("created" in extraFm)) lines.push(`created: ${today}`);
  lines.push(`updated: ${today}`, "tags:", "---", "", body ?? `# ${title}`, "", "");
  await writeFile(path, lines.join("\n"));
  return path;
}

const quote = (s: string) => (yamlNeedsQuote(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s);

/** Obsidian's own convention: deleted notes go to <vault>/.trash. */
export async function trashObject(profile: AtlasProfile, path: string): Promise<void> {
  const trash = join(profile.root, ".trash");
  await ensureDir(trash);
  let dest = join(trash, path.split("/").pop()!);
  if (await fileExists(dest)) dest = dest.replace(/\.md$/, ` ${Date.now() % 10000}.md`);
  await moveFile(path, dest);
}

/** Update a single frontmatter property on disk, leaving body + the rest
 *  of the YAML untouched. */
export async function setObjectProp(
  path: string,
  key: string,
  value: string | string[] | undefined,
): Promise<void> {
  const raw = await readFile(path);
  const { fmRaw, body } = splitRawFrontmatter(raw);
  let next = setRawFrontmatterKey(fmRaw, key, value);
  next = setRawFrontmatterKey(next, "updated", todayStamp());
  await writeFile(path, next + body);
}
