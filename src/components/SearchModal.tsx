import { useEffect, useMemo, useRef, useState } from "react";
import { ObjectIndex, AtlasObject, searchObjects } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { SemanticHit } from "../lib/embeddings";

/** ⌘K quick switcher across every object in the vault. Keyword matches come
 *  first; if an OpenAI key is set, meaning-matches follow (embeddings).
 *  Also serves as the object picker for inserting [[links]] (pick mode). */

export default function SearchModal(props: {
  index: ObjectIndex;
  types: ObjectTypeDef[];
  mode?: "open" | "pick";
  semantic?: (query: string) => Promise<SemanticHit[] | null>;
  onOpen: (o: AtlasObject) => void;
  onCreate?: (title: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [semHits, setSemHits] = useState<SemanticHit[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.trim()) return searchObjects(props.index, query, 30);
    return [...props.index.all]
      .sort((a, b) => ((a.updated ?? "") < (b.updated ?? "") ? 1 : -1))
      .slice(0, 12);
  }, [query, props.index]);

  // Meaning matches, debounced, deduped against the keyword list
  useEffect(() => {
    if (!props.semantic || query.trim().length < 3) { setSemHits([]); return; }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const hits = await props.semantic!(query.trim());
      if (!cancelled) setSemHits(hits ?? []);
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const keywordPaths = useMemo(() => new Set(results.map((r) => r.path)), [results]);
  const semantic = query.trim() ? semHits.filter((h) => !keywordPaths.has(h.o.path)) : [];

  const canCreate = !!props.onCreate && query.trim().length > 0 &&
    !results.some((r) => r.title.toLowerCase() === query.trim().toLowerCase());
  const total = results.length + semantic.length + (canCreate ? 1 : 0);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: number) => {
    if (i < results.length) props.onOpen(results[i]);
    else if (i < results.length + semantic.length) props.onOpen(semantic[i - results.length].o);
    else if (canCreate) props.onCreate!(query.trim());
  };

  const Row = (o: AtlasObject, i: number, score?: number) => {
    const t = typeByKey(props.types, o.typeKey);
    return (
      <button
        key={(score !== undefined ? "s:" : "k:") + o.path}
        className={`search-row ${i === sel ? "sel" : ""}`}
        onMouseEnter={() => setSel(i)}
        onClick={() => choose(i)}
      >
        <span className="rail-glyph" style={{ color: t?.color ?? "var(--ink-3)" }}>{t?.icon ?? "·"}</span>
        <span className="search-title">{o.title}</span>
        <span className="search-meta">
          {score !== undefined
            ? `${Math.round(score * 100)}% · ${t?.name ?? "Markdown"}`
            : `${t?.name ?? "Markdown"} · ${o.rel.replace(/\/[^/]*$/, "") || "/"}`}
        </span>
      </button>
    );
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal search-modal">
        <input
          className="input search-input" autoFocus
          placeholder={props.mode === "pick" ? "Link to an object…" : "Search every object…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(total - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter" && total > 0) choose(sel);
          }}
        />
        <div className="search-results" ref={listRef}>
          {!query.trim() && results.length > 0 && <span className="eyebrow search-section">Recently updated</span>}
          {results.map((o, i) => Row(o, i))}
          {semantic.length > 0 && (
            <span className="eyebrow search-section search-section-sem">Meaning matches</span>
          )}
          {semantic.map((h, j) => Row(h.o, results.length + j, h.score))}
          {canCreate && (
            <button
              className={`search-row ${sel === results.length + semantic.length ? "sel" : ""}`}
              onMouseEnter={() => setSel(results.length + semantic.length)}
              onClick={() => choose(results.length + semantic.length)}
            >
              <span className="rail-glyph" style={{ color: "var(--signal)" }}>+</span>
              <span className="search-title">Create page “{query.trim()}”</span>
            </button>
          )}
          {total === 0 && <p className="empty" style={{ padding: 12 }}>Nothing matches.</p>}
        </div>
      </div>
    </div>
  );
}
