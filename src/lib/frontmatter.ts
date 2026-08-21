/** Minimal YAML frontmatter parse/serialize — flat keys, strings/arrays only.
 *  Deliberately tiny: Atlas task/person/place records use flat frontmatter. */

export type FM = Record<string, string | string[] | undefined>;

export function parseFrontmatter(raw: string): { fm: FM; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: raw };
  const block = raw.slice(4, end);
  const body = raw.slice(raw.indexOf("\n", end + 1) + 1);
  const fm: FM = {};
  let currentKey: string | null = null;
  for (const line of block.split("\n")) {
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      const arr = (fm[currentKey] as string[]) ?? [];
      arr.push(unquote(listMatch[1]));
      fm[currentKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, val] = kv;
      if (val === "") { currentKey = key; fm[key] = fm[key] ?? []; }
      else { currentKey = null; fm[key] = unquote(val); }
    }
  }
  return { fm, body };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2)
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
    return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Plain scalars that contain YAML specials, or that START with a YAML
 *  indicator character, must be quoted so real parsers (Obsidian, a clipper)
 *  read them back unchanged. */
const YAML_NEEDS_QUOTE = /[:#[\]{}"']/;
const YAML_LEADING = /^[\s\-?:,&*!|>%@`]/;
export function yamlNeedsQuote(s: string): boolean {
  return s === "" || YAML_NEEDS_QUOTE.test(s) || YAML_LEADING.test(s);
}

function quoteIfNeeded(s: string): string {
  return yamlNeedsQuote(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;
}

/** Lossless split for the notes editor: the frontmatter block is kept as the
 *  exact raw text so nested YAML, comments, and unusual keys survive a save.
 *  Reassembling fmRaw + body reproduces the original file byte-for-byte. */
export function splitRawFrontmatter(raw: string): { fmRaw: string; body: string } {
  if (!raw.startsWith("---")) return { fmRaw: "", body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fmRaw: "", body: raw };
  const afterClose = raw.indexOf("\n", end + 1);
  if (afterClose === -1) return { fmRaw: raw, body: "" };
  return { fmRaw: raw.slice(0, afterClose + 1), body: raw.slice(afterClose + 1) };
}

/** Refreshes (or inserts) the `updated:` line inside a raw frontmatter block. */
export function bumpUpdated(fmRaw: string, stamp: string): string {
  if (!fmRaw) return fmRaw;
  if (/^updated:/m.test(fmRaw)) return fmRaw.replace(/^updated:.*$/m, `updated: ${stamp}`);
  const close = fmRaw.lastIndexOf("\n---");
  if (close === -1) return fmRaw;
  return fmRaw.slice(0, close) + `\nupdated: ${stamp}` + fmRaw.slice(close);
}

/** Surgical edit of one key inside a raw frontmatter block: the rest of the
 *  YAML (nested keys, comments, ordering) is left untouched. Arrays are
 *  written block-style to match serializeFrontmatter. Passing undefined
 *  removes the key. Creates the block if the file had none. */
export function setRawFrontmatterKey(
  fmRaw: string,
  key: string,
  value: string | string[] | undefined,
): string {
  const render = (): string[] => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return [`${key}:`, ...value.map((v) => `  - ${quoteIfNeeded(v)}`)];
    return [`${key}: ${quoteIfNeeded(value)}`];
  };

  if (!fmRaw) {
    const lines = render();
    return lines.length ? ["---", ...lines, "---", ""].join("\n") : "";
  }

  const lines = fmRaw.split("\n");
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`);
  const out: string[] = [];
  let i = 0;
  let replaced = false;
  while (i < lines.length) {
    if (!replaced && keyRe.test(lines[i])) {
      out.push(...render());
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) i++; // swallow old list items / nested lines
      replaced = true;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  if (!replaced && value !== undefined) {
    const close = out.lastIndexOf("---");
    if (close > 0) out.splice(close, 0, ...render());
  }
  return out.join("\n");
}

export function serializeFrontmatter(fm: FM, body: string): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${quoteIfNeeded(item)}`);
    } else {
      lines.push(`${k}: ${quoteIfNeeded(String(v))}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}
