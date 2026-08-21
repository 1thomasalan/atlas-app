import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { AtlasProfile } from "../lib/atlasProfile";
import { Edition, findLatestEdition } from "../lib/news";

/** Typesets the latest brief dropped into Capture as a broadsheet.
 *  Your automation writes the markdown; Atlas does the typography. */

/** Newspaper polish on the rendered HTML:
 *  - links whose visible text is a bare URL become compact "domain →" chips
 *  - images get wrapped as story thumbnails
 *  - "Source:" / "Why it matters:" paragraphs get editorial classes */
function polish(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.querySelectorAll("a").forEach((a) => {
    const text = a.textContent?.trim() ?? "";
    if (/^https?:\/\//.test(text)) {
      try {
        const host = new URL(a.href).hostname.replace(/^www\./, "");
        a.textContent = `${host} →`;
        a.classList.add("src-chip");
      } catch { /* malformed URL — leave as is */ }
    }
  });

  doc.querySelectorAll("img").forEach((img) => {
    img.classList.add("story-thumb");
    img.loading = "lazy";
  });

  doc.querySelectorAll("p").forEach((p) => {
    const t = p.textContent?.trim().toLowerCase() ?? "";
    if (t === "source:" || t === "sources:") p.classList.add("src-label");
    if (t.startsWith("why it matters")) p.classList.add("why-matters");
  });

  return doc.body.innerHTML;
}

export default function NewspaperView(props: { profile: AtlasProfile; kind: "brief" | "local" }) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const ed = await findLatestEdition(props.profile, props.kind);
    setEdition(ed);
    if (ed) {
      const raw = await marked.parse(ed.markdown, { async: true });
      setHtml(polish(DOMPurify.sanitize(raw)));
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [props.kind, props.profile]);

  const masthead = props.kind === "brief" ? "Daily Brief" : "Local Edition";
  const tagline = props.kind === "brief"
    ? "A focused view of the topics you follow"
    : "Local reporting, translated and typeset when needed";
  const dateLabel = (edition?.date || new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  })).toUpperCase();

  return (
    <div className="page paper">
      <div className="paper-inner">
        <div className="paper-toolbar">
          <button className="paper-btn" onClick={load}>↻ Reload latest</button>
        </div>

        <header className="paper-masthead">
          <h1 className="paper-name">{masthead}</h1>
          <div className="paper-tagline">{tagline}</div>
        </header>

        <div className="paper-dateline">
          <span className="paper-dl-side">{dateLabel}</span>
          <span className="paper-dl-mid">{props.kind === "brief" ? "YOUR TOPICS" : "YOUR AREA"}</span>
          <span className="paper-dl-side paper-dl-right">Digital Edition</span>
        </div>

        {loading && <p className="paper-empty">Setting type…</p>}

        {!loading && !edition && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">No edition found</span>
            <p>
              Drop the latest {props.kind === "brief" ? "daily brief" : "local news edition"} markdown
              file into <code>01-Inbox/01-Capture</code> and reload. Atlas finds it by name and content.
            </p>
          </div>
        )}

        {!loading && edition && (
          <article className="paper-body" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
