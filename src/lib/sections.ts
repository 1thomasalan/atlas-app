import { readFile, writeFile } from "./vault";
import { splitRawFrontmatter, setRawFrontmatterKey } from "./frontmatter";
import { todayStamp } from "./daily";

/** Serialize writes per file: upsertSection is a read-modify-write of the whole
 *  body, so two callers racing the same path (e.g. the morning brief and the
 *  nutrition coach both writing today's note) could each read the pre-other
 *  snapshot and the second write would drop the first's section. Chaining on a
 *  per-path promise makes each read observe the prior write. */
const writeLocks = new Map<string, Promise<unknown>>();

/** Insert or replace one `## Heading` section in a markdown file's body,
 *  leaving the frontmatter and every other section untouched. The section
 *  runs from its heading line to the next `## ` (or end of file). Used by
 *  the AI enhancements so re-running an action refreshes its block in place
 *  instead of stacking duplicates. */
export async function upsertSection(path: string, heading: string, markdown: string): Promise<void> {
  const prev = writeLocks.get(path) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doUpsertSection(path, heading, markdown));
  writeLocks.set(path, run);
  try { await run; }
  finally { if (writeLocks.get(path) === run) writeLocks.delete(path); }
}

async function doUpsertSection(path: string, heading: string, markdown: string): Promise<void> {
  const raw = await readFile(path);
  const { fmRaw, body } = splitRawFrontmatter(raw);
  const lines = body.split("\n");
  const headLine = `## ${heading}`;

  // A `## ` line only counts as a section boundary outside a fenced code block.
  const boundaries = new Set<number>();
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    else if (!fence && lines[i].startsWith("## ")) boundaries.add(i);
  }
  const start = lines.findIndex((l, i) => boundaries.has(i) && l.trim() === headLine);

  // The model can emit its own `## ` lines; demote them so they never become
  // false section boundaries that orphan content on the next re-run.
  const safe = markdown.trim().replace(/^(#{1,2})\s+/gm, "### ");
  const block = `${headLine}\n\n${safe}`;

  let nextBody: string;
  if (start === -1) {
    nextBody = `${body.trimEnd()}\n\n${block}\n`;
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (boundaries.has(i)) { end = i; break; }
    }
    const before = lines.slice(0, start).join("\n").trimEnd();
    const after = lines.slice(end).join("\n").trim();
    nextBody = `${before ? before + "\n\n" : ""}${block}${after ? "\n\n" + after : ""}\n`;
  }

  const fm = fmRaw ? setRawFrontmatterKey(fmRaw, "updated", todayStamp()) : "";
  await writeFile(path, (fm ? fm.trimEnd() + "\n\n" : "") + nextBody.replace(/^\n+/, ""));
}

/** Markdown bullet list helper. */
export const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
