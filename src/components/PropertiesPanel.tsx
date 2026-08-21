import { useEffect, useMemo, useRef, useState } from "react";
import { ObjectIndex, AtlasObject, resolveLink, setObjectProp, createObject } from "../lib/objects";
import { ObjectTypeDef, typeByKey, PropDef } from "../lib/objectTypes";
import { AtlasProfile } from "../lib/atlasProfile";
import { Route } from "../lib/nav";
import { openExternal } from "../lib/open";
import { coverSrc } from "../lib/unfurl";
import { parseCoords, formatCoords, appleMapsUrl, reverseGeocode, forwardGeocode, GeoHit, Coords } from "../lib/geo";
import { searchPhoto, savePhotoFromUrl, savePhotoFromImage, attachmentsFor } from "../lib/photos";
import { generateCover } from "../lib/imagegen";
import { initialsOf, personContact, TIER_META, agoLabel } from "../lib/relations";
import Icon, { hasTypeIcon } from "./Icon";
import SearchModal from "./SearchModal";

/** Which object type a link-kind property should create, by its key. */
function linkTypeForKey(key: string): string {
  if (key === "org" || key === "organization") return "org";
  if (key === "project") return "project";
  if (key === "place" || key === "location") return "place";
  if (key === "attendees" || key === "person" || key === "people") return "person";
  return "note";
}

/** The typed-property form for one object, rendered in the global right rail.
 *  Edits are written as frontmatter, one key at a time, body untouched. */

export default function PropertiesPanel(props: {
  index: ObjectIndex;
  types: ObjectTypeDef[];
  profile: AtlasProfile;
  path: string;
  openaiKey: string;
  onNavigate: (r: Route) => void;
  onRefreshObject: (path: string) => void;
  onRefreshIndex: () => void;
  toast: (m: string) => void;
}) {
  const { index, path } = props;
  const obj = index.byPath.get(path);
  const type = typeByKey(props.types, obj?.typeKey);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [geoVerify, setGeoVerify] = useState<GeoHit | null>(null);
  const [geoBusy, setGeoBusy] = useState<"" | "reverse" | "forward">("");
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const creatingRef = useRef(false);

  // Extra frontmatter keys not covered by the type schema still get a row —
  // the file is the truth, the schema is just a lens.
  const HIDDEN = new Set(["type", "title", "created", "updated", "tags", "todoist_id", "top", "image", "favicon"]);
  const extraKeys = useMemo(() => {
    if (!obj) return [];
    const schema = new Set((type?.props ?? []).map((p) => p.key));
    return Object.keys(obj.props).filter((k) => !HIDDEN.has(k) && !schema.has(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, type]);

  if (!obj) return null;

  const saveProp = async (key: string, value: string | string[] | undefined) => {
    await setObjectProp(path, key, value);
    props.onRefreshObject(path);
  };

  /** On a Place, keep Location and Coordinates in sync (keyless geocoding):
   *  enter coordinates → fill the Location label; enter a Location → look up
   *  coordinates and ask the user to verify before they're written. */
  const onPropSave = async (key: string, value: string | string[] | undefined) => {
    await saveProp(key, value);
    if (!obj || obj.typeKey !== "place" || typeof value !== "string") return;
    const text = value.trim();
    if (key === "coordinates" && text) {
      const c = parseCoords(text);
      const hasLocation = typeof obj.props.location === "string" && obj.props.location.trim();
      if (c && !hasLocation) {
        setGeoBusy("reverse");
        const name = await reverseGeocode(c);
        setGeoBusy("");
        if (name) { await saveProp("location", name); props.toast(`Location: ${name}`); }
      }
    } else if (key === "location" && text) {
      setGeoVerify(null);
      setGeoBusy("forward");
      const hit = await forwardGeocode(text);
      setGeoBusy("");
      if (hit) setGeoVerify(hit);
      else props.toast("Couldn't find coordinates for that location");
    }
  };

  const followLink = (target: string) => {
    const hit = resolveLink(index, target);
    if (hit) props.onNavigate({ kind: "object", path: hit.path });
    else props.toast(`No object named “${target}” yet`);
  };

  /** Turn an unresolved link value (e.g. a typed org name) into a real object
   *  of the type the field implies, and link it. */
  const createAndLink = async (propKey: string, name: string) => {
    const base = name.split(/[|#]/)[0].trim();   // drop any alias/heading — link the base
    const t = typeByKey(props.types, linkTypeForKey(propKey));
    if (!base || !t || creatingRef.current) return;   // guard re-entry (double-click)
    creatingRef.current = true;
    setCreatingKey(propKey);
    try {
      await createObject(props.profile, t, base);
      await saveProp(propKey, `[[${base}]]`);
      props.onRefreshIndex();   // the new object must enter the index to resolve
      props.toast(`Created ${t.name} “${base}” and linked it`);
    } finally {
      creatingRef.current = false;
      setCreatingKey(null);
    }
  };

  return (
    <div className="obj-props">
      <h3 className="eyebrow">Properties</h3>
      <PhotoField profile={props.profile} type={type} obj={obj} openaiKey={props.openaiKey} onSaved={() => props.onRefreshObject(path)} toast={props.toast} />
      {obj.typeKey === "person" && <RelationshipRow index={index} obj={obj} />}
      <TagsRow
        value={obj.tags}
        onSave={(v) => saveProp("tags", v.length ? v : undefined)}
        onOpenTag={(t) => props.onNavigate({ kind: "tag", tag: t })}
      />
      {(type?.props ?? []).filter((p) => p.key !== "tags").map((p) => {
        const inner = p.kind === "link" ? String(obj.props[p.key] ?? "").replace(/^\[\[|\]\]$/g, "").trim() : "";
        const base = inner.split(/[|#]/)[0].trim();   // resolve against the base, not an alias/heading
        const unresolved = !!base && !resolveLink(index, base);
        const coords = obj.typeKey === "place" && p.key === "coordinates" ? parseCoords(obj.props.coordinates) : null;
        return (
          <PropRow
            key={p.key}
            def={p}
            value={obj.props[p.key]}
            onSave={(v) => onPropSave(p.key, v)}
            onPickLink={() => setPickingFor(p.key)}
            onFollowLink={followLink}
            unresolved={unresolved}
            creating={creatingKey === p.key}
            onCreateLink={(name) => createAndLink(p.key, name)}
            createLabel={typeByKey(props.types, linkTypeForKey(p.key))?.name}
            suffix={coords ? <CoordSuffix coords={coords} label={String(obj.props.location || obj.title)} /> : undefined}
          />
        );
      })}
      {extraKeys.map((k) => (
        <PropRow
          key={k}
          def={{ key: k, label: k, kind: "text" }}
          value={obj.props[k]}
          onSave={(v) => saveProp(k, v)}
        />
      ))}

      {geoBusy && (
        <p className="geo-hint">{geoBusy === "reverse" ? "Looking up the place name…" : "Looking up coordinates…"}</p>
      )}
      {geoVerify && (
        <div className="geo-verify">
          <span className="eyebrow">Found these coordinates — verify before using</span>
          <div className="geo-verify-coords">{formatCoords(geoVerify.coords)}</div>
          {geoVerify.label && <div className="geo-verify-label">{geoVerify.label}</div>}
          <div className="geo-verify-actions">
            <button className="btn primary" onClick={async () => { await saveProp("coordinates", formatCoords(geoVerify.coords)); props.toast("Coordinates set"); setGeoVerify(null); }}>Use these</button>
            <button className="tb-btn" onClick={() => openExternal(appleMapsUrl(geoVerify.coords, geoVerify.label))}>Check on map ↗</button>
            <button className="tb-btn" onClick={() => setGeoVerify(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {pickingFor && (
        <SearchModal
          index={index}
          types={props.types}
          mode="pick"
          onClose={() => setPickingFor(null)}
          onOpen={(o) => { saveProp(pickingFor, `[[${o.stem}]]`); setPickingFor(null); }}
          onCreate={(t) => { saveProp(pickingFor, `[[${t}]]`); setPickingFor(null); }}
        />
      )}
    </div>
  );
}

/** The photo a card and the page cover both draw from — a first-class field on
 *  every object. Add one from disk, fetch a fitting one from the web, or fall
 *  back to the type's monogram/icon. Writes the vault-relative path into the
 *  `image:` frontmatter (the same key the cover banner uses). */
function PhotoField(props: {
  profile: AtlasProfile;
  type?: ObjectTypeDef;
  obj: AtlasObject;
  openaiKey: string;
  onSaved: () => void;
  toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const src = coverSrc(props.profile.root, props.obj.props.image);
  const color = (props.type?.color || "").trim() || "var(--ink-3)";

  const write = async (val: string | undefined) => {
    await setObjectProp(props.obj.path, "image", val);
    props.onSaved();
  };
  const onPick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !props.type || !f.type.startsWith("image/")) return;
    setBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const saved = await savePhotoFromImage(props.profile, attachmentsFor(props.type.folder), props.obj.title, { b64: btoa(bin), mime: f.type, name: f.name });
      await write(saved);
      props.toast("Photo added");
    } catch (e) { props.toast(`Photo failed: ${e instanceof Error ? e.message : "unknown"}`); }
    finally { setBusy(false); }
  };
  const fetchWeb = async () => {
    if (!props.type) return;
    setBusy(true);
    props.toast("Finding a photo…");
    try {
      const q = [props.obj.title, props.obj.props.location, props.obj.props.org].filter(Boolean).map(String).join(" ");
      const url = await searchPhoto(q);
      if (url) {
        const saved = await savePhotoFromUrl(props.profile, attachmentsFor(props.type.folder), props.obj.title, url);
        await write(saved);
        props.toast("Photo added from the web");
        return;
      }
      // No real photo exists for this one — synthesize an abstract, fitting
      // cover so the object still gets a visual instead of a bare monogram.
      props.toast(props.openaiKey ? "No photo found — generating abstract art…" : "No photo found — creating a cover…");
      const { stored, ai } = await generateCover(props.profile, props.type, props.obj, props.openaiKey);
      await write(stored);
      props.toast(ai ? "Generated an abstract cover" : "Created an abstract cover");
    } catch (e) { props.toast(`Photo fetch failed: ${e instanceof Error ? e.message : "unknown"}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="prop-photo">
      <button className="prop-photo-preview" disabled={busy} onClick={() => fileRef.current?.click()}
        title={src ? "Change photo" : "Add a photo"}>
        {src
          ? <img src={src} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
          : props.obj.typeKey === "person"
            ? <span className="prop-photo-mono" style={{ color }}>{initialsOf(props.obj.title)}</span>
            : hasTypeIcon(props.type?.key)
              ? <Icon name={props.type!.key} size={30} color={color} />
              : <span style={{ color, fontFamily: "var(--font-mono)", fontSize: 26 }}>{props.type?.icon ?? "·"}</span>}
      </button>
      <div className="prop-photo-actions">
        <button className="tb-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "…" : src ? "Change" : "Add"}</button>
        <button className="tb-btn" disabled={busy} onClick={fetchWeb}>Fetch</button>
        {src && <button className="tb-btn" disabled={busy} onClick={() => write(undefined)}>Remove</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/** Optimistic: the chosen value shows immediately, the file write and index
 *  swap follow. The effect re-syncs if the write lands a different value. */
function SelectRow(props: { def: PropDef; display: string; commit: (v: string) => void }) {
  const [val, setVal] = useState(props.display);
  useEffect(() => setVal(props.display), [props.display]);
  return (
    <div className="prop-row">
      <span className="prop-label">{props.def.label}</span>
      <select
        className="input prop-input"
        value={val}
        onChange={(e) => { setVal(e.target.value); props.commit(e.target.value); }}
      >
        <option value="">—</option>
        {(props.def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TagsRow(props: { value: string[]; onSave: (v: string[]) => void; onOpenTag: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className="prop-row">
      <span className="prop-label">Tags</span>
      {editing ? (
        <input
          className="input prop-input" autoFocus
          value={draft}
          placeholder="comma, separated"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { props.onSave(draft.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean)); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
        />
      ) : (
        <span className="prop-value prop-tags" onClick={() => { setDraft(props.value.join(", ")); setEditing(true); }}>
          {props.value.length
            ? props.value.map((t) => (
                <button key={t} className="chip" onClick={(e) => { e.stopPropagation(); props.onOpenTag(t.replace(/^#/, "")); }}>#{t}</button>
              ))
            : <span className="prop-empty">add tags…</span>}
        </span>
      )}
    </div>
  );
}

function PropRow(props: {
  def: PropDef;
  value: string | string[] | undefined;
  onSave: (v: string | string[] | undefined) => void;
  onPickLink?: () => void;
  onFollowLink?: (target: string) => void;
  unresolved?: boolean;
  creating?: boolean;
  onCreateLink?: (name: string) => void;
  createLabel?: string;
  suffix?: React.ReactNode;
}) {
  const { def, value } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = Array.isArray(value) ? value.join(", ") : value ?? "";

  const commit = (raw: string) => {
    const v = raw.trim();
    if (def.kind === "tags") props.onSave(v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
    else props.onSave(v || undefined);
    setEditing(false);
  };

  if (def.kind === "select") {
    return <SelectRow def={def} display={display} commit={commit} />;
  }

  if (def.kind === "link") {
    const inner = display.replace(/^\[\[|\]\]$/g, "").trim();
    return (
      <div className="prop-row">
        <span className="prop-label">{def.label}</span>
        <span className="prop-value">
          {inner
            ? <button className="wikilink prop-link" onClick={() => props.onFollowLink?.(inner)}>{inner}</button>
            : <span className="prop-empty">none</span>}
          {inner && props.unresolved && props.onCreateLink && (
            <button className="tb-btn prop-create" disabled={props.creating} onClick={() => props.onCreateLink!(inner)}
              title={`Create ${props.createLabel ?? "object"} “${inner}” and link it`}>
              {props.creating ? "Creating…" : `+ Create${props.createLabel ? ` ${props.createLabel}` : ""}`}
            </button>
          )}
          {props.onPickLink && <button className="tb-btn" onClick={props.onPickLink}>pick</button>}
        </span>
      </div>
    );
  }

  return (
    <div className="prop-row">
      <span className="prop-label">{def.label}</span>
      {editing ? (
        <input
          className="input prop-input" autoFocus
          type={def.kind === "date" ? "date" : def.kind === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
        />
      ) : (
        <span className="prop-value" onClick={() => { setDraft(display); setEditing(true); }}>
          {def.kind === "url" && display
            ? <a href={display} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openExternal(display); }}>{display}</a>
            : display || <span className="prop-empty">set {def.label.toLowerCase()}…</span>}
          {props.suffix}
        </span>
      )}
    </div>
  );
}

/** Inline affordance on a valid Coordinates row: a ✓ and a Maps link. */
function CoordSuffix(props: { coords: Coords; label: string }) {
  return (
    <span className="prop-suffix">
      <span className="prop-ok" title="Valid coordinates">✓</span>
      <button className="tb-btn prop-maps"
        onClick={(e) => { e.stopPropagation(); openExternal(appleMapsUrl(props.coords, props.label)); }}>
        Maps ↗
      </button>
    </span>
  );
}

/** A glance-able relationship strip in the rail for a Person: tier + how long
 *  since the vault last touched them. */
function RelationshipRow(props: { index: ObjectIndex; obj: AtlasObject }) {
  const c = personContact(props.index, props.obj);
  const m = TIER_META[c.tier];
  return (
    <div className="prop-rel" style={{ borderLeftColor: m.color }}>
      <span className="prop-rel-tier" style={{ color: m.color }}>{m.glyph} {m.label}</span>
      <span className="prop-rel-meta">
        {c.lastDate
          ? <>last seen {agoLabel(c.daysAgo)} · {c.touches} mention{c.touches === 1 ? "" : "s"}</>
          : c.touches ? <>{c.touches} mention{c.touches === 1 ? "" : "s"} · none dated</> : <>no linked notes yet</>}
      </span>
    </div>
  );
}
