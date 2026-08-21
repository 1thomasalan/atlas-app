import { useMemo } from "react";
import { ObjectIndex, AtlasObject } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { EmbeddingCache, semanticNeighbors } from "../lib/embeddings";

/** Semantic neighbours of the current object — the notes that *read* like this
 *  one even when nothing links them. Reuses the cached embeddings, so it's a
 *  pure in-memory cosine sweep with no API call. The "why" line is an honest
 *  heuristic (shared tags, else same type + similar themes); the relevance bar
 *  shows the cosine score relative to the strongest match. */
export default function RelatedPanel(props: {
  index: ObjectIndex;
  types: ObjectTypeDef[];
  obj: AtlasObject;
  cache: EmbeddingCache | null;
  exclude: Set<string>;
  onOpen: (path: string) => void;
}) {
  const hits = useMemo(() => {
    if (!props.cache) return [];
    return semanticNeighbors(props.cache, props.index, props.obj, {
      topK: 6,
      exclude: props.exclude,
    });
  }, [props.cache, props.index, props.obj, props.exclude]);

  if (!hits.length) return null;
  const max = hits[0].score || 1;
  const myTags = new Set(props.obj.tags.map((t) => t.toLowerCase()));

  return (
    <section className="backlinks related-panel">
      <h3 className="eyebrow">Related · {hits.length}</h3>
      {hits.map(({ o, score }) => {
        const t = typeByKey(props.types, o.typeKey);
        const shared = o.tags.filter((tg) => myTags.has(tg.toLowerCase())).slice(0, 3);
        const why = shared.length
          ? shared.map((s) => `#${s}`).join("  ")
          : `${t?.name ?? "Note"} · similar themes`;
        return (
          <button key={o.path} className="obj-row related-row" onClick={() => props.onOpen(o.path)}>
            <span className="rail-glyph" style={{ color: t?.color ?? "var(--ink-3)" }}>{t?.icon ?? "·"}</span>
            <span className="related-main">
              <span className="obj-row-title">{o.title}</span>
              <span className="related-why">{why}</span>
            </span>
            <span className="related-rel" title={`${Math.round(score * 100)}% similar`}>
              <span className="related-rel-bar" style={{ width: Math.round((score / max) * 100) + "%" }} />
            </span>
          </button>
        );
      })}
    </section>
  );
}
