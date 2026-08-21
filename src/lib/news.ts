import { readFile, listMarkdownIn } from "./vault";
import { AtlasProfile } from "./atlasProfile";

/** Finds the latest general brief or local-news edition in Capture.
 *  Automations can declare the kind in frontmatter or use the expected
 *  headings; Atlas only reads and typesets the resulting markdown. */

export interface Edition { path: string; title: string; date: string; markdown: string; kind: "brief" | "local"; }

function classify(name: string, content: string): "brief" | "local" | null {
  const hay = (name + "\n" + content.slice(0, 400)).toLowerCase();
  if (/^type:\s*local-news\s*$/m.test(hay) || hay.includes("## local briefs") || hay.includes("local news edition")) return "local";
  if (/^type:\s*(daily-brief|brief)\s*$/m.test(hay) || hay.includes("daily technology brief") || hay.includes("consolidated brief")) return "brief";
  return null;
}

export async function findLatestEdition(profile: AtlasProfile, kind: "brief" | "local"): Promise<Edition | null> {
  const files = await listMarkdownIn(profile.capture);
  const candidates: Edition[] = [];
  for (const path of files) {
    let content: string;
    try { content = await readFile(path); } catch { continue; }
    const name = path.split("/").pop()!;
    if (classify(name, content) !== kind) continue;
    const dateMatch = (name + content.slice(0, 300)).match(/(\d{4}-\d{2}-\d{2})|([A-Z][a-z]+ \d{1,2},? \d{4})/);
    const titleMatch = content.match(/^#\s+(.+)$/m);
    candidates.push({
      path, kind, markdown: content,
      title: titleMatch?.[1] ?? name.replace(/\.md$/, ""),
      date: dateMatch?.[0] ?? "",
    });
  }
  candidates.sort((a, b) => (a.path < b.path ? 1 : -1)); // date-stamped filenames sort newest-first
  return candidates[0] ?? null;
}

/** Compact front-page data for the dashboard: one headline per paper and
 *  the local weather line, extracted from the latest editions in Capture. */
export interface NewsSnapshot {
  brief: { title: string; date: string } | null;
  local: { title: string; date: string } | null;
  weather: string | null;
}

function headlineOf(ed: Edition): string {
  if (ed.kind === "brief") {
    const story = ed.markdown.match(/^[-*]\s+\*\*(.+?)\*\*/m)?.[1];
    if (story) return story;
  } else {
    const lead = ed.markdown.split(/^##\s+Lead\s*$/m)[1];
    const story = (lead ?? ed.markdown).match(/^###\s+(.+)$/m)?.[1];
    if (story) return story;
  }
  return ed.title;
}

export function extractWeather(markdown: string): string | null {
  const head = markdown.match(/^##\s+.*weather.*$/im);
  if (!head) return null;
  const section = markdown.slice(head.index! + head[0].length).split(/^##\s/m)[0];
  const lines = section.split("\n").map((l) => l.trim());
  const para = lines.find((l) =>
    l && !l.startsWith("-") && !l.startsWith("*") && !l.startsWith("#") && !/^source:/i.test(l));
  const bullets = lines.filter((l) => l.startsWith("- ")).slice(0, 2).map((l) => l.slice(2));
  const text = para ?? bullets.join(" · ");
  return text ? text.replace(/\*\*/g, "").slice(0, 220) : null;
}

export async function newsSnapshot(profile: AtlasProfile): Promise<NewsSnapshot> {
  const [brief, local] = await Promise.all([
    findLatestEdition(profile, "brief").catch(() => null),
    findLatestEdition(profile, "local").catch(() => null),
  ]);
  return {
    brief: brief ? { title: headlineOf(brief), date: brief.date } : null,
    local: local ? { title: headlineOf(local), date: local.date } : null,
    weather: local ? extractWeather(local.markdown) : null,
  };
}
