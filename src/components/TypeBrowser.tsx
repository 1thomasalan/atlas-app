import { useMemo, useState } from "react";
import { ObjectIndex, AtlasObject, objectsOfType } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { Route } from "../lib/nav";
import { hostOf } from "../lib/unfurl";
import {
  projectProgress, personContact, isProjectOverdue, agoLabel, TIER_META,
  ProjectProgress, PersonContact,
} from "../lib/relations";
import CardCover from "./CardCover";
import ProgressBar from "./ProgressBar";
import Icon, { hasTypeIcon } from "./Icon";

/** One screen per object type — Capacities' database view in Swiss dress.
 *  Cards / table / list, search within the type, sort, and one-click new. */

type ViewMode = "cards" | "table" | "list";
type SortKey = "updated" | "created" | "title";

export default function TypeBrowser(props: {
  index: ObjectIndex;
  types: ObjectTypeDef[];
  typeKey?: string;          // undefined + tag set = tag browser
  tag?: string;
  vaultRoot: string;
  onNavigate: (r: Route) => void;
  onNew: (typeKey: string) => void;
  onFetchPreviews?: () => void;            // weblinks: unfurl everything missing a cover
  onFetchPhotos?: (objs: AtlasObject[]) => void;   // any type: web photo for the shown photo-less objects
  onImport?: () => void;          // meals/workouts: screenshot → AI import
  onNewFromPhoto?: () => void;    // places: photo → EXIF + AI profile
  onCoach?: () => void;           // meals: weekly nutrition digest
}) {
  const [mode, setMode] = useState<ViewMode>("cards");
  const [sort, setSort] = useState<SortKey>("updated");
  const [query, setQuery] = useState("");

  const type = typeByKey(props.types, props.typeKey);

  const objects = useMemo(() => {
    let list: AtlasObject[];
    if (props.tag) list = props.index.tags.get(props.tag) ?? [];
    else if (type?.special === "tag") list = [];
    else list = objectsOfType(props.index, props.typeKey ?? "");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (o) => o.title.toLowerCase().includes(q) ||
               o.excerpt.toLowerCase().includes(q) ||
               o.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const av = (sort === "updated" ? a.updated : a.created) ?? "";
      const bv = (sort === "updated" ? b.updated : b.created) ?? "";
      return av < bv ? 1 : -1;
    });
  }, [props.index, props.typeKey, props.tag, type, query, sort]);

  // Derived per-type signals. Keyed on the index + type (NOT the query-filtered
  // `objects`), so typing in the search box doesn't re-scan the whole vault on
  // every keystroke — these only rebuild when the index actually changes.
  // NOTE: must stay ABOVE the tag-index early return — all hooks run every render.
  const progressByPath = useMemo(() => {
    const m = new Map<string, ProjectProgress>();
    if (props.typeKey === "project") for (const o of objectsOfType(props.index, "project")) m.set(o.path, projectProgress(props.index, o));
    return m;
  }, [props.index, props.typeKey]);
  const contactByPath = useMemo(() => {
    const m = new Map<string, PersonContact>();
    if (props.typeKey === "person") for (const o of objectsOfType(props.index, "person")) m.set(o.path, personContact(props.index, o));
    return m;
  }, [props.index, props.typeKey]);

  // ---- Tag index screen ----
  if (type?.special === "tag" && !props.tag) {
    const tags = [...props.index.tags.entries()].sort((a, b) => b[1].length - a[1].length);
    return (
      <div className="page">
        <Head icon={type.icon} iconName="tag" color={type.color} title="Tags" count={tags.length} />
        <div className="tag-cloud">
          {tags.map(([tag, objs]) => (
            <button key={tag} className="tag-card" onClick={() => props.onNavigate({ kind: "tag", tag })}>
              <span className="tag-name"># {tag}</span>
              <span className="tag-count">{objs.length}</span>
            </button>
          ))}
          {tags.length === 0 && <p className="empty">No tags yet. Add a `tags:` list to any object.</p>}
        </div>
      </div>
    );
  }

  const title = props.tag ? `# ${props.tag}` : type?.plural ?? "Objects";
  const tableProps = (type?.props ?? []).filter((p) => p.kind !== "tags").slice(0, 3);

  return (
    <div className="page">
      <Head
        icon={props.tag ? "#" : type?.icon ?? "·"}
        iconName={props.tag ? undefined : props.typeKey}
        color={type?.color ?? "var(--ink-3)"}
        title={title}
        count={objects.length}
        right={
          <div className="browser-controls">
            <input
              className="input browser-search"
              placeholder={`Search ${title.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="seg">
              {(["cards", "table", "list"] as ViewMode[]).map((m) => (
                <button key={m} className={`seg-btn ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>{m}</button>
              ))}
            </div>
            <select className="input browser-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="updated">Updated</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
            </select>
            {props.onFetchPreviews && type?.key === "weblink" && !props.tag && (
              <button className="btn" onClick={props.onFetchPreviews}>Fetch previews</button>
            )}
            {props.onFetchPhotos && type && type.key !== "weblink" && !props.tag && objects.some((o) => !o.props.image) && (
              <button className="btn" onClick={() => props.onFetchPhotos!(objects)}
                title="Fetch a web photo for each shown object that doesn't have one">Fetch photos</button>
            )}
            {props.onImport && (type?.key === "meal" || type?.key === "workout") && !props.tag && (
              <button className="btn" onClick={props.onImport}>
                {type.key === "meal" ? "Import from photo" : "Import from screenshot"}
              </button>
            )}
            {props.onNewFromPhoto && type?.key === "place" && !props.tag && (
              <button className="btn" onClick={props.onNewFromPhoto}>New from photo</button>
            )}
            {props.onCoach && type?.key === "meal" && !props.tag && objects.length > 0 && (
              <button className="btn" onClick={props.onCoach}>✨ Week digest</button>
            )}
            {type && !props.tag && (
              <button className="btn primary" onClick={() => props.onNew(type.key)}>New {type.name}</button>
            )}
          </div>
        }
      />

      {objects.length === 0 && (
        <div className="cal-empty" style={{ marginTop: 40 }}>
          <strong>There's nothing here (yet).</strong>
          <p>You can change this by creating a new object.</p>
        </div>
      )}

      {mode === "cards" && (
        <div className="obj-cards">
          {objects.map((o) => {
            const t = typeByKey(props.types, o.typeKey);
            const site = o.typeKey === "weblink"
              ? ((o.props.site as string) || hostOf(o.props.url))
              : undefined;
            const blurb =
              (typeof o.props.summary === "string" && o.props.summary) ||
              (typeof o.props.description === "string" && o.props.description) ||
              o.excerpt;
            return (
              <button key={o.path} className="obj-card has-cover" onClick={() => props.onNavigate({ kind: "object", path: o.path })}>
                <CardCover vaultRoot={props.vaultRoot} image={o.props.image} type={t} title={o.title} />
                {site && (
                  <span className="weblink-site">
                    {typeof o.props.favicon === "string" && o.props.favicon && (
                      <img className="weblink-favicon" src={o.props.favicon} alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {site}
                  </span>
                )}
                <span className="obj-card-title">{o.title}</span>
                {blurb && <span className="obj-card-excerpt">{blurb}</span>}
                {(() => {
                  const pr = progressByPath.get(o.path);
                  return pr && pr.total > 0 ? (
                    <span className="card-progress">
                      <ProgressBar pct={pr.pct} danger={isProjectOverdue(o, pr.pct)} thin />
                      <span className="card-progress-text">{pr.done}/{pr.total} · {pr.pct}%</span>
                    </span>
                  ) : null;
                })()}
                <span className="obj-card-foot">
                  {(() => {
                    const c = contactByPath.get(o.path);
                    if (!c) return null;
                    const m = TIER_META[c.tier];
                    return (
                      <span className="card-contact" style={{ color: m.color }}
                        title={`${m.label}${c.lastDate ? ` · last contact ${agoLabel(c.daysAgo)}` : ""} · ${c.touches} mention${c.touches === 1 ? "" : "s"}`}>
                        <i>{m.glyph}</i> {c.lastDate ? agoLabel(c.daysAgo) : m.label}
                      </span>
                    );
                  })()}
                  {o.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
                  <span className="obj-card-date">{o.updated ?? o.created ?? ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "table" && (
        <table className="obj-table">
          <thead>
            <tr>
              <th>Title</th>
              {tableProps.map((p) => <th key={p.key}>{p.label}</th>)}
              {props.typeKey === "project" && <th>Progress</th>}
              {props.typeKey === "person" && <th>Contact</th>}
              <th>Tags</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((o) => (
              <tr key={o.path} onClick={() => props.onNavigate({ kind: "object", path: o.path })}>
                <td className="obj-table-title">{o.title}</td>
                {tableProps.map((p) => (
                  <td key={p.key}>{Array.isArray(o.props[p.key]) ? (o.props[p.key] as string[]).join(", ") : (o.props[p.key] as string) ?? ""}</td>
                ))}
                {props.typeKey === "project" && (() => {
                  const pr = progressByPath.get(o.path);
                  return (
                    <td>
                      {pr && pr.total > 0 ? (
                        <span className="table-progress">
                          <ProgressBar pct={pr.pct} danger={isProjectOverdue(o, pr.pct)} thin />
                          <span className="card-progress-text">{pr.done}/{pr.total}</span>
                        </span>
                      ) : <span className="obj-table-date">—</span>}
                    </td>
                  );
                })()}
                {props.typeKey === "person" && (() => {
                  const c = contactByPath.get(o.path);
                  const m = c ? TIER_META[c.tier] : null;
                  return (
                    <td>
                      {c && m ? (
                        <span className="card-contact" style={{ color: m.color }}>
                          <i>{m.glyph}</i> {c.lastDate ? agoLabel(c.daysAgo) : m.label}
                        </span>
                      ) : <span className="obj-table-date">—</span>}
                    </td>
                  );
                })()}
                <td>{o.tags.map((t) => `#${t}`).join(" ")}</td>
                <td className="obj-table-date">{o.updated ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mode === "list" && (
        <div>
          {objects.map((o) => (
            <button key={o.path} className="obj-row" onClick={() => props.onNavigate({ kind: "object", path: o.path })}>
              <span className="obj-row-title">{o.title}</span>
              <span className="obj-row-meta">{o.rel.replace(/\/[^/]*$/, "")} · {o.updated ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Head(props: { icon: string; iconName?: string; color: string; title: string; count: number; right?: React.ReactNode }) {
  return (
    <div className="page-head browser-head">
      <div>
        <span className="eyebrow">{props.count} object{props.count === 1 ? "" : "s"}</span>
        <h1 className="page-title">
          <span className="type-title-icon" style={{ color: props.color }}>
            {hasTypeIcon(props.iconName) ? <Icon name={props.iconName!} size={30} stroke={1.6} /> : props.icon}
          </span>
          {props.title}
        </h1>
      </div>
      {props.right}
    </div>
  );
}
