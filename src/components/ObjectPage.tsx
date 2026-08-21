import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtlasProfile, LaneKey, LANE_LABELS } from "../lib/atlasProfile";
import { ObjectIndex, AtlasObject, resolveLink, setObjectProp, trashObject, createObject, linkSuggestions } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { Route } from "../lib/nav";
import { logChangeDebounced } from "../lib/changeLog";
import { coverSrc } from "../lib/unfurl";
import { youtubeId, fetchYouTubeStream, YouTubeStream } from "../lib/youtube";
import { openExternal } from "../lib/open";
import { runEnhance, actionsFor, gatherRelated } from "../lib/enhance";
import { searchPhoto, savePhotoFromUrl, savePhotoFromImage, attachmentsFor } from "../lib/photos";
import { createTask, loadLane } from "../lib/tasks";
import { readFile, writeFile } from "../lib/vault";
import { splitRawFrontmatter, bumpUpdated } from "../lib/frontmatter";
import { todayStamp } from "../lib/daily";
import { EmbeddingCache } from "../lib/embeddings";
import {
  projectProgress, isProjectOverdue, personContact, TIER_META, agoLabel, initialsOf,
  ProjectProgress, PersonContact,
} from "../lib/relations";
import MarkdownEditor, { MarkdownEditorHandle } from "./editor/MarkdownEditor";
import RelatedPanel from "./RelatedPanel";
import ProgressBar from "./ProgressBar";
import Icon, { hasTypeIcon } from "./Icon";
import SearchModal from "./SearchModal";

/** A single object: title, the markdown body, and every place the rest of
 *  the vault mentions it. Properties render in the global right rail; the
 *  file underneath stays a plain Obsidian note. */

// Reference-stable empty list: index.backlinks.get() returns undefined for a
// note with no backlinks, and a fresh `?? []` each render would bust the
// relatedExclude / RelatedPanel memos and re-run the embedding sweep on every
// keystroke. One shared instance keeps the identity stable.
const EMPTY_OBJECTS: AtlasObject[] = [];

export default function ObjectPage(props: {
  profile: AtlasProfile;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  path: string;
  openaiKey: string;
  embeddings: EmbeddingCache | null;
  onNavigate: (r: Route) => void;
  onRefreshIndex: () => void;
  onRefreshObject: (path: string) => void;
  onEnrichWeblink: (path: string, url: string) => Promise<void>;
  onExternalEdit: (path: string) => void;
  externalEdit: { path: string; n: number };
  toast: (m: string) => void;
}) {
  const { index, path } = props;
  const obj = index.byPath.get(path);
  const type = typeByKey(props.types, obj?.typeKey);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [picking, setPicking] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [tasksBusy, setTasksBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(obj?.title ?? "");

  useEffect(() => setTitle(obj?.title ?? ""), [obj?.title, path]);

  // The path can be missing from a STALE index — e.g. the kanban moved a task's
  // file (drag / Todoist sync) and only rebuilt its own list. Rebuild the index
  // once for this path; if the file really exists it reappears and renders.
  const recoverRef = useRef("");
  useEffect(() => {
    if (!obj && recoverRef.current !== path) {
      recoverRef.current = path;
      props.onRefreshIndex();
    }
  }, [obj, path, props]);

  const backlinks = index.backlinks.get(path) ?? EMPTY_OBJECTS;
  const hereObjects = useMemo(
    () => (obj && obj.typeKey === "place" ? gatherRelated(index, obj) : []),
    [index, obj],
  );

  // Project / Person derived signals (cheap, no API) for the header bands.
  const progress = useMemo<ProjectProgress | null>(
    () => (obj && obj.typeKey === "project" ? projectProgress(index, obj) : null),
    [index, obj],
  );
  const contact = useMemo<PersonContact | null>(
    () => (obj && obj.typeKey === "person" ? personContact(index, obj) : null),
    [index, obj],
  );

  // What the "Related" panel should NOT repeat: itself, anything already shown
  // as a backlink / "here" item, and anything it explicitly links out to.
  const relatedExclude = useMemo(() => {
    const s = new Set<string>([path]);
    for (const b of backlinks) s.add(b.path);
    for (const h of hereObjects) s.add(h.path);
    if (obj) for (const target of obj.links) { const hit = resolveLink(index, target); if (hit) s.add(hit.path); }
    return s;
  }, [path, backlinks, hereObjects, obj, index]);

  const commitTitle = async () => {
    const t = title.trim();
    if (!obj || !t || t === obj.title) return;
    await setObjectProp(path, "title", t);
    props.onRefreshObject(path);
  };

  const openLink = useCallback(async (target: string) => {
    await editorRef.current?.flush();
    const hit = resolveLink(index, target);
    if (hit) props.onNavigate({ kind: "object", path: hit.path });
    else {
      const noteType = typeByKey(props.types, "note")!;
      const created = await createObject(props.profile, noteType, target);
      props.onRefreshIndex();
      props.onNavigate({ kind: "object", path: created });
      props.toast(`Created “${target}” in ${noteType.folder}`);
    }
  }, [index, props]);

  const trash = async () => {
    // Stop the editor from autosaving / unmount-flushing — otherwise navigating
    // away after the move re-writes the file at its old path and resurrects it.
    editorRef.current?.pauseAutosave();
    await trashObject(props.profile, path);
    props.onRefreshIndex();
    props.onNavigate(type ? { kind: "type", typeKey: type.key } : { kind: "home" });
    props.toast("Moved to .trash");
  };

  // Pull in edits made on disk (e.g. in Obsidian): the on-disk file wins. The
  // editor reloads itself (pausing autosave so an in-flight save can't clobber
  // the pulled content), and we re-index for frontmatter / backlinks. If there
  // are unsaved Atlas edits, confirm before discarding them.
  const syncFromDisk = async () => {
    if (editorRef.current?.isDirty() &&
        !window.confirm("You have unsaved edits in Atlas. Reload from the file on disk and discard them?")) return;
    await editorRef.current?.reloadFromDisk();
    props.onRefreshObject(path);
    props.toast("Synced from file");
  };

  const runAction = async (actionKey: string) => {
    if (!obj) return;
    setMenuOpen(false);
    setEnhanceBusy(actionKey);
    try {
      await editorRef.current?.flush();
      editorRef.current?.pauseAutosave();   // lock the editor so its autosave can't race the AI write
      const r = await runEnhance(actionKey, {
        openaiKey: props.openaiKey, profile: props.profile, index, types: props.types, obj,
      });
      props.onRefreshObject(path);
      if (r.wroteBody) props.onExternalEdit(path);   // reload the open editor with the new section
      props.toast(r.toast);
    } catch (err) {
      props.toast(`Enhance failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setEnhanceBusy(null);
      editorRef.current?.resumeAutosave();
    }
  };

  // ---- Photo property: file, web-fetch, or remove; placeholder when none ----
  // image: is frontmatter-only, but the open editor's autosave still does a
  // read-modify-write of the whole file, so lock it around the write.
  const setImage = async (value: string | undefined) => {
    await editorRef.current?.flush();
    editorRef.current?.pauseAutosave();
    try {
      await setObjectProp(path, "image", value);
      props.onRefreshObject(path);
    } finally {
      editorRef.current?.resumeAutosave();
    }
  };
  const onPickPhoto = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !obj || !type || !f.type.startsWith("image/")) return;
    setPhotoBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const saved = await savePhotoFromImage(props.profile, attachmentsFor(type.folder), obj.title, { b64: btoa(bin), mime: f.type, name: f.name });
      await setImage(saved);
      props.toast("Photo added");
    } catch (err) {
      props.toast(`Photo failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setPhotoBusy(false); }
  };
  const fetchPhoto = async () => {
    if (!obj || !type) return;
    setPhotoBusy(true);
    props.toast("Finding a photo…");
    try {
      const q = [obj.title, obj.props.location, obj.props.org].filter(Boolean).map(String).join(" ");
      const url = await searchPhoto(q);
      if (!url) { props.toast("No photo found for this one"); return; }
      const saved = await savePhotoFromUrl(props.profile, attachmentsFor(type.folder), obj.title, url);
      await setImage(saved);
      props.toast("Photo added from the web");
    } catch (err) {
      props.toast(`Photo fetch failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setPhotoBusy(false); }
  };

  // ---- Meeting → real Task objects from the extracted action items ----
  const createTasksFromMeeting = async () => {
    if (!obj) return;
    setTasksBusy(true);
    try {
      await editorRef.current?.flush();
      editorRef.current?.pauseAutosave();
      const raw = await readFile(path);
      const { fmRaw, body } = splitRawFrontmatter(raw);
      const lines = body.split("\n");

      // Scope to an action-items section when one exists, so unrelated
      // checkboxes elsewhere in the note aren't swept up as tasks.
      let lo = 0, hi = lines.length;
      const headIdx = lines.findIndex((l) => /^##\s+.*action/i.test(l));
      if (headIdx !== -1) {
        lo = headIdx + 1;
        for (let i = lo; i < lines.length; i++) { if (lines[i].startsWith("## ")) { hi = i; break; } }
      }

      const found: { i: number; indent: string; title: string }[] = [];
      for (let i = lo; i < hi; i++) {
        const m = lines[i].match(/^(\s*)-\s*\[ \]\s+(.+?)\s*$/);
        if (m) found.push({ i, indent: m[1], title: m[2].trim() });
      }
      if (!found.length) { props.toast("No open action items — run ✨ Enhance → Summary & action items first"); return; }

      // Don't recreate tasks that already exist for this meeting. Link by stem
      // (not the raw title) so it resolves the same way relations/resolveLink do.
      const link = `[[${obj.stem}]]`;
      const existing = new Set(
        (await loadLane(props.profile, "week"))
          .filter((t) => (t.project ?? "") === link)
          .map((t) => t.title.toLowerCase()),
      );
      let made = 0;
      for (const it of found) {
        lines[it.i] = `${it.indent}- [x] ${it.title}`;   // check every one off
        if (!existing.has(it.title.toLowerCase())) {
          await createTask(props.profile, "week", it.title, { project: link });
          made++;
        }
      }
      const fm2 = fmRaw ? bumpUpdated(fmRaw, todayStamp()) : "";
      await writeFile(path, (fm2 ? fm2.trimEnd() + "\n\n" : "") + lines.join("\n").replace(/^\n+/, ""));
      props.onRefreshIndex();
      props.onExternalEdit(path);   // reload the editor with the checked-off items
      props.toast(made
        ? `Created ${made} task${made > 1 ? "s" : ""} → This Week${found.length > made ? ` · ${found.length - made} already existed` : ""}`
        : "Those action items are already tasks");
    } catch (err) {
      props.toast(`Couldn't create tasks: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setTasksBusy(false); editorRef.current?.resumeAutosave(); }
  };

  // ---- Add a task straight to this project from its page. Link by the file's
  // STEM, not the raw title: relations.projectTasks / resolveLink key off the
  // stem (and normLink truncates a title at a literal '#'/'|'), so a stem link
  // is what reliably lands the task in this panel and on the board, tagged to
  // the project — even for titles containing # | [ ]. ----
  const addProjectTask = async (title: string, lane: LaneKey) => {
    if (!obj) return;
    await createTask(props.profile, lane, title, { project: `[[${obj.stem}]]` });
    props.onRefreshIndex();
    props.toast(`Added task → ${LANE_LABELS[lane]}`);
  };

  if (!obj) {
    return (
      <div className="page">
        <p className="empty">
          {recoverRef.current === path
            ? "This file is no longer in the index — it may have been moved or deleted."
            : "Loading…"}
        </p>
      </div>
    );
  }

  const cover = coverSrc(props.profile.root, obj.props.image);
  const videoId = obj.typeKey === "weblink" ? youtubeId(String(obj.props.url ?? "")) : undefined;

  return (
    <div className="page obj-page">
      {videoId ? (
        <InlineVideo videoId={videoId} poster={cover} onOpenExternal={() => openExternal(String(obj.props.url))} />
      ) : (
        <CoverBanner
          cover={cover} color={type?.color} icon={type?.icon} iconName={obj.typeKey} title={obj.title} busy={photoBusy}
          monogram={obj.typeKey === "person" ? initialsOf(obj.title) : undefined}
          onAdd={() => photoInput.current?.click()} onFetch={fetchPhoto}
          onRemove={cover ? () => setImage(undefined) : undefined}
        />
      )}
      <input ref={photoInput} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { onPickPhoto(e.target.files); e.target.value = ""; }} />
      <div className="obj-head">
        <span className="eyebrow">
          <span style={{ color: type?.color ?? "var(--ink-3)" }}>{type?.icon ?? "·"}</span>{" "}
          {type?.name ?? "Markdown"} · {obj.rel}
        </span>
        <input
          className="obj-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="obj-meta">
          {obj.created && <span>Created {obj.created}</span>}
          {obj.updated && <span>Updated {obj.updated}</span>}
          <button className="tb-btn" onClick={() => setPicking(true)}>[[ Link object</button>
          <button className="tb-btn" onClick={syncFromDisk}
            title="Reload from disk — pulls in Obsidian edits and replaces any unsaved Atlas changes with the file's version">
            <Icon name="sync" size={13} /> Sync
          </button>
          {props.openaiKey && (
            <span className="enhance-wrap">
              <button className={`tb-btn enhance-trigger ${menuOpen ? "on" : ""}`}
                disabled={enhanceBusy !== null} onClick={() => setMenuOpen((o) => !o)}>
                {enhanceBusy ? "Working…" : "✨ Enhance"}
              </button>
              {menuOpen && (
                <>
                  <span className="enhance-backdrop" onClick={() => setMenuOpen(false)} />
                  <span className="enhance-menu">
                    {actionsFor(obj.typeKey).map((a) => (
                      <button key={a.key} className="enhance-item" disabled={enhanceBusy !== null}
                        onClick={() => runAction(a.key)}>{a.label}</button>
                    ))}
                  </span>
                </>
              )}
            </span>
          )}
          {obj.typeKey === "weblink" && typeof obj.props.url === "string" && obj.props.url && (
            <>
              <button className="tb-btn" onClick={() => openExternal(obj.props.url as string)}>
                {videoId ? "Watch on YouTube ↗" : "Open site ↗"}
              </button>
              <button className="tb-btn" disabled={fetching} onClick={async () => {
                setFetching(true);
                try { await props.onEnrichWeblink(path, obj.props.url as string); }
                finally { setFetching(false); }
              }}>{fetching ? "Fetching…" : "Fetch preview"}</button>
            </>
          )}
          {obj.typeKey === "meeting" && (
            <button className="tb-btn" disabled={tasksBusy} onClick={createTasksFromMeeting}>
              {tasksBusy ? "Creating…" : "✓ Make tasks"}
            </button>
          )}
          <button className="tb-btn obj-trash" onClick={() => setConfirmTrash(true)}>Delete</button>
        </div>
      </div>

      {progress && progress.total > 0 && (
        <ProjectBand obj={obj} progress={progress} />
      )}
      {contact && (
        <PersonBand
          contact={contact}
          hasKey={!!props.openaiKey}
          busy={enhanceBusy === "reconnect"}
          onReconnect={() => runAction("reconnect")}
        />
      )}

      <div className="obj-body">
        <div className="obj-editor">
          {/* For a project the tasks ARE the page — show them right under the
              header (with the add row) instead of below a tall, often-empty
              body. The notes editor stays, but compact, beneath the list. The
              tasks slot is always present (null when not a project) so the
              editor keeps a stable child position and never remounts. */}
          {obj.typeKey === "project" && progress ? (
            <ProjectTasksPanel progress={progress} types={props.types}
              onOpen={(p) => props.onNavigate({ kind: "object", path: p })}
              onAddTask={addProjectTask} />
          ) : null}
          <MarkdownEditor
            ref={editorRef}
            path={path}
            reloadToken={props.externalEdit.path === path ? props.externalEdit.n : undefined}
            minHeight={obj.typeKey === "project" ? 160 : 360}
            onLinkSearch={(q) => linkSuggestions(index, q, path).map((o) => ({ stem: o.stem, title: o.title, typeKey: o.typeKey }))}
            onOpenLink={openLink}
            onSaved={(p) => {
              props.onRefreshObject(p);
              logChangeDebounced(props.profile, p, "Edited an object from the Atlas object page.", "approved");
            }}
          />

          {obj.typeKey === "place" ? (
            <HerePanel objects={hereObjects} types={props.types}
              onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
          ) : obj.typeKey === "project" ? (
            backlinks.filter((b) => b.typeKey !== "task").length > 0 ? (
              <section className="backlinks">
                <h3 className="eyebrow">Linked mentions · {backlinks.filter((b) => b.typeKey !== "task").length}</h3>
                {backlinks.filter((b) => b.typeKey !== "task").map((b) => (
                  <BacklinkRow key={b.path} o={b} types={props.types} onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
                ))}
              </section>
            ) : null
          ) : backlinks.length > 0 ? (
            <section className="backlinks">
              <h3 className="eyebrow">Linked mentions · {backlinks.length}</h3>
              {backlinks.map((b) => (
                <BacklinkRow key={b.path} o={b} types={props.types} onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
              ))}
            </section>
          ) : null}

          <RelatedPanel
            index={index} types={props.types} obj={obj}
            cache={props.embeddings} exclude={relatedExclude}
            onOpen={(p) => props.onNavigate({ kind: "object", path: p })}
          />
        </div>
      </div>

      {picking && (
        <SearchModal
          index={index}
          types={props.types}
          mode="pick"
          onClose={() => setPicking(false)}
          onOpen={(o) => { editorRef.current?.insertText(`[[${o.stem}]]`); setPicking(false); }}
          onCreate={(t) => { editorRef.current?.insertText(`[[${t}]]`); setPicking(false); }}
        />
      )}

      {confirmTrash && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setConfirmTrash(false)}>
          <div className="modal" style={{ width: "min(420px, 92vw)" }}>
            <span className="eyebrow" style={{ color: "var(--signal)" }}>Delete object</span>
            <h2 style={{ fontSize: 20 }}>Move “{obj.title}” to .trash?</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 14, marginBottom: 16 }}>
              The file goes to the vault's .trash folder (Obsidian's convention) — nothing is destroyed.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn signal" onClick={trash}>Move to .trash</button>
              <button className="btn" onClick={() => setConfirmTrash(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Native <video> over the ANDROID client's muxed mp4 — YouTube's iframe
 *  player refuses non-public origins (Error 153), a real stream doesn't. */
function InlineVideo(props: { videoId: string; poster?: string; onOpenExternal: () => void }) {
  const [stream, setStream] = useState<YouTubeStream | null | "loading">("loading");

  useEffect(() => {
    let live = true;
    setStream("loading");
    fetchYouTubeStream(props.videoId)
      .then((s) => { if (live) setStream(s); })
      .catch(() => { if (live) setStream(null); });
    return () => { live = false; };
  }, [props.videoId]);

  return (
    <div className="obj-video">
      {stream && stream !== "loading" ? (
        <video controls playsInline preload="metadata" poster={props.poster} src={stream.url} />
      ) : (
        <button className="obj-video-fallback" onClick={props.onOpenExternal} title="Watch on YouTube">
          {props.poster && <img src={props.poster} alt="" />}
          <span className="obj-video-overlay">
            {stream === "loading" ? "Loading player…" : "▶ Watch on YouTube"}
          </span>
        </button>
      )}
    </div>
  );
}

/** Cover banner: the object's photo, or a tinted placeholder, with controls
 *  to add a photo from disk, fetch one from the web, or remove it. */
function CoverBanner(props: {
  cover?: string; color?: string; icon?: string; iconName?: string; title: string; busy: boolean; monogram?: string;
  onAdd: () => void; onFetch: () => void; onRemove?: () => void;
}) {
  const color = (props.color || "").trim() || "var(--ink-3)";
  return (
    <div className="obj-cover-wrap">
      {props.cover ? (
        <div className="obj-cover">
          <img src={props.cover} alt=""
            onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
        </div>
      ) : (
        <div className="obj-cover generated"
          style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${color} 22%, var(--bg-raise)), color-mix(in srgb, ${color} 6%, var(--bg-raise)))` }}>
          {props.monogram
            ? <span className="cover-monogram" style={{ color }}>{props.monogram}</span>
            : hasTypeIcon(props.iconName)
              ? <Icon name={props.iconName!} size={84} stroke={1.3} color={color} className="cover-svg-glyph" />
              : <span className="cover-glyph" style={{ color }}>{props.icon ?? "·"}</span>}
        </div>
      )}
      <div className="obj-cover-actions">
        <button className="tb-btn" disabled={props.busy} onClick={props.onAdd}>{props.busy ? "…" : props.cover ? "Change" : "Add photo"}</button>
        <button className="tb-btn" disabled={props.busy} onClick={props.onFetch}>Fetch photo</button>
        {props.onRemove && <button className="tb-btn" disabled={props.busy} onClick={props.onRemove}>Remove</button>}
      </div>
    </div>
  );
}

/** "Here": everything in the vault linked to this place, grouped by type. */
function HerePanel(props: { objects: AtlasObject[]; types: ObjectTypeDef[]; onOpen: (path: string) => void }) {
  if (!props.objects.length) return null;
  const groups = new Map<string, AtlasObject[]>();
  for (const o of props.objects) groups.set(o.typeKey, [...(groups.get(o.typeKey) ?? []), o]);
  return (
    <section className="backlinks">
      <h3 className="eyebrow">Here · {props.objects.length}</h3>
      {[...groups.entries()].map(([tk, list]) => {
        const t = typeByKey(props.types, tk);
        return (
          <div key={tk} className="here-group">
            <span className="here-group-label">
              <i style={{ color: t?.color ?? "var(--ink-3)", fontStyle: "normal" }}>{t?.icon ?? "·"}</i> {t?.plural ?? tk} · {list.length}
            </span>
            {list.map((o) => <BacklinkRow key={o.path} o={o} types={props.types} onOpen={props.onOpen} />)}
          </div>
        );
      })}
    </section>
  );
}

function BacklinkRow(props: { o: AtlasObject; types: ObjectTypeDef[]; onOpen: (path: string) => void }) {
  const t = typeByKey(props.types, props.o.typeKey);
  return (
    <button className="obj-row" onClick={() => props.onOpen(props.o.path)}>
      <span className="rail-glyph" style={{ color: t?.color ?? "var(--ink-3)" }}>{t?.icon ?? "·"}</span>
      <span className="obj-row-title">{props.o.title}</span>
      <span className="obj-row-meta">{props.o.excerpt.slice(0, 60)}</span>
    </button>
  );
}

/** Project header band: a live progress meter fed by linked-task completion,
 *  with done/total, percent, and an overdue flag when the due date has passed. */
function ProjectBand(props: { obj: AtlasObject; progress: ProjectProgress }) {
  const { progress: p, obj } = props;
  const overdue = isProjectOverdue(obj, p.pct);
  const due = typeof obj.props.due === "string" ? obj.props.due.slice(0, 10) : "";
  const status = typeof obj.props.status === "string" ? obj.props.status : "";
  return (
    <div className={`project-band ${overdue ? "overdue" : ""} ${p.pct >= 100 ? "complete" : ""}`}>
      <div className="project-band-top">
        <span className="eyebrow">
          <i className="project-band-icon">{p.pct >= 100 ? "▣" : "▢"}</i>{" "}
          {p.pct >= 100 ? "Complete" : "Progress"}{status && p.pct < 100 ? ` · ${status}` : ""}
        </span>
        <span className="project-band-stat">
          <strong>{p.done}</strong>/{p.total} tasks · <strong>{p.pct}%</strong>
          {due && <span className={`project-due ${overdue ? "overdue" : ""}`}>{overdue ? " overdue " : " due "}{due}</span>}
        </span>
      </div>
      <ProgressBar pct={p.pct} danger={overdue} />
    </div>
  );
}

/** Person header band: relationship strength (how recently the vault touched
 *  this person) and, when contact is cooling, a one-tap AI check-in draft. */
function PersonBand(props: { contact: PersonContact; hasKey: boolean; busy: boolean; onReconnect: () => void }) {
  const c = props.contact;
  const meta = TIER_META[c.tier];
  const showReconnect = props.hasKey && (c.tier === "cooling" || c.tier === "distant");
  return (
    <div className="person-band" style={{ borderLeftColor: meta.color }}>
      <span className="person-strength" style={{ color: meta.color }} title={meta.label}>
        <span className="person-strength-glyph">{meta.glyph}</span>
        <span className="person-strength-label">{meta.label}</span>
      </span>
      <span className="person-band-meta">
        {c.lastDate
          ? <>Last contact <strong>{agoLabel(c.daysAgo)}</strong> · {c.touches} mention{c.touches === 1 ? "" : "s"}</>
          : c.touches
            ? <>{c.touches} mention{c.touches === 1 ? "" : "s"} · none dated</>
            : <>No linked notes yet</>}
      </span>
      {showReconnect && (
        <button className="tb-btn person-reconnect" disabled={props.busy} onClick={props.onReconnect}>
          {props.busy ? "Drafting…" : "✨ Draft a check-in"}
        </button>
      )}
    </div>
  );
}

/** Project body panel: the linked tasks themselves, split open vs done, each a
 *  doorway into the task object. */
function ProjectTasksPanel(props: {
  progress: ProjectProgress;
  types: ObjectTypeDef[];
  onOpen: (path: string) => void;
  onAddTask: (title: string, lane: LaneKey) => Promise<void>;
}) {
  const p = props.progress;
  const [title, setTitle] = useState("");
  const [lane, setLane] = useState<LaneKey>("week");
  const [busy, setBusy] = useState(false);
  const ADD_LANES: LaneKey[] = ["today", "week", "waiting", "someday"];

  const add = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await props.onAddTask(t, lane); setTitle(""); }
    finally { setBusy(false); }
  };

  return (
    <section className="backlinks project-tasks">
      <h3 className="eyebrow">Tasks · {p.done}/{p.total} done</h3>
      <div className="project-add-task">
        <input
          className="input" placeholder="Add a task to this project…" value={title} disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <select className="input project-add-lane" value={lane} disabled={busy}
          onChange={(e) => setLane(e.target.value as LaneKey)} title="Which board lane it lands in">
          {ADD_LANES.map((l) => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}
        </select>
        <button className="btn primary" disabled={busy || !title.trim()} onClick={add}>{busy ? "…" : "Add"}</button>
      </div>
      {p.openTasks.length > 0 && (
        <div className="here-group">
          <span className="here-group-label">Open · {p.open}</span>
          {p.openTasks.map((t) => <TaskLine key={t.path} o={t} done={false} onOpen={props.onOpen} />)}
        </div>
      )}
      {p.doneTasks.length > 0 && (
        <div className="here-group">
          <span className="here-group-label">Done · {p.done}</span>
          {p.doneTasks.map((t) => <TaskLine key={t.path} o={t} done onOpen={props.onOpen} />)}
        </div>
      )}
      {p.total === 0 && (
        <p className="empty">No tasks yet — add one above. It’ll appear on the board, tagged to this project.</p>
      )}
    </section>
  );
}

function TaskLine(props: { o: AtlasObject; done: boolean; onOpen: (path: string) => void }) {
  const due = props.o.props.due ? `due ${String(props.o.props.due).slice(0, 10)}` : "";
  const meta = due || (typeof props.o.props.status === "string" ? props.o.props.status : "");
  return (
    <button className={`obj-row task-line ${props.done ? "done" : ""}`} onClick={() => props.onOpen(props.o.path)}>
      <span className="task-line-box">{props.done ? "✓" : "○"}</span>
      <span className="obj-row-title">{props.o.title}</span>
      <span className="obj-row-meta">{meta}</span>
    </button>
  );
}
