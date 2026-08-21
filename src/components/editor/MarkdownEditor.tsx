import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, Editor, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Markdown } from "tiptap-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WikiLink } from "./WikiLink";
import { HeadingFold } from "./HeadingFold";
import { HideSection } from "./HideSection";
import { readFile, writeFile, writeBinaryFile, ensureDir, join } from "../../lib/vault";
import { inTauri } from "../../lib/demoFs";
import { splitRawFrontmatter, bumpUpdated } from "../../lib/frontmatter";
import { todayStamp } from "../../lib/daily";

/** Resolve a note-relative image path against the note's directory so the
 *  webview can load it via the asset protocol — while the model keeps the
 *  original markdown src, so saving round-trips exactly what Obsidian wrote. */
function resolveRelative(baseDir: string, rel: string): string {
  const parts = baseDir.split("/");
  for (const seg of decodeURI(rel).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The WYSIWYG-that-stays-markdown editor, extracted from the old NotesView
 *  so object pages and the calendar's daily note share one implementation.
 *  Frontmatter is carried as raw text and reattached on save; [[wiki links]]
 *  survive because we un-escape what the serializer protects. */

export interface MarkdownEditorHandle {
  flush: () => Promise<void>;
  insertText: (text: string) => void;
  pauseAutosave: () => void;   // lock + stop autosaving while an external write happens
  resumeAutosave: () => void;
  isDirty: () => boolean;
  /** Re-read this file from disk and replace the editor body (the disk version
   *  wins). Pauses autosave around the read so an in-flight save can't clobber
   *  the freshly-pulled content. */
  reloadFromDisk: () => Promise<void>;
}

/** prosemirror-markdown escapes [ and ] in text; undo just the wiki-link pairs. */
const unescapeWikiLinks = (md: string) =>
  md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]").replace(/\\(\[\[|\]\])/g, "$1");

export interface LinkItem { stem: string; title: string; typeKey: string; }

export default forwardRef(function MarkdownEditor(
  props: {
    path: string;                       // file to edit; component reloads when it changes
    reloadToken?: number;               // bump to re-read the file after an external write
    onSaved?: (path: string) => void;
    onOpenLink?: (target: string) => void;
    onLinkSearch?: (query: string) => LinkItem[];   // live [[ picker candidates
    minHeight?: number;
    placeholder?: string;
    hideSections?: string[];            // headings whose section is hidden from view (kept on disk)
  },
  ref: React.Ref<MarkdownEditorHandle>,
) {
  const { path } = props;
  const [dirty, setDirty] = useState(false);
  const fmRef = useRef("");
  const pathRef = useRef("");
  const autosaveOff = useRef(false);   // true while an AI/external write is in flight
  const noteDirRef = useRef("");
  const saveTimer = useRef<number>();

  // ---- Live [[ link picker ----
  const [linkMenu, setLinkMenu] = useState<{ from: number; query: string; x: number; y: number } | null>(null);
  const [linkSel, setLinkSel] = useState(0);
  const linkMenuRef = useRef<{ from: number; query: string; x: number; y: number } | null>(null);
  const linkItemsRef = useRef<LinkItem[]>([]);
  const linkSelRef = useRef(0);
  const chooseRef = useRef<() => void>(() => {});

  /** Detect an open `[[query` immediately before the cursor and place the menu. */
  const detectLink = (ed: Editor) => {
    const sel = ed.state.selection;
    // Not for collapsed selections in code (links are meaningless there).
    if (!sel.empty || ed.isActive("code") || ed.isActive("codeBlock")) { setLinkMenu(null); return; }
    const $from = sel.$from;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const m = before.match(/\[\[([^[\]\n]*)$/);
    if (!m) { setLinkMenu(null); return; }
    // Don't hijack the cursor when it's parked inside an already-closed [[link]].
    const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, "￼");
    if (/^[^[\n]*\]\]/.test(after)) { setLinkMenu(null); return; }
    let coords: { left: number; bottom: number };
    try { coords = ed.view.coordsAtPos(sel.from); } catch { setLinkMenu(null); return; }
    setLinkMenu({ from: sel.from - (m[1].length + 2), query: m[1], x: coords.left, y: coords.bottom });
    setLinkSel(0);
  };

  // Display src = resolved asset URL; stored attr stays the raw markdown src.
  // inline:true matches prosemirror-markdown's image node, so an image
  // followed by a heading round-trips through getMarkdown() without
  // corrupting the next block into escaped literal text.
  const VaultImage = useMemo(() => Image.extend({
    renderHTML({ HTMLAttributes }) {
      const raw = String(HTMLAttributes.src ?? "");
      let display = raw;
      if (raw && !/^(https?:|data:|blob:|asset:|tauri:)/i.test(raw) && inTauri && noteDirRef.current) {
        try { display = convertFileSrc(resolveRelative(noteDirRef.current, raw)); } catch { /* keep raw */ }
      }
      return ["img", mergeAttributes(HTMLAttributes, { src: display, class: "md-img" })];
    },
  }).configure({ inline: true }), []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      VaultImage,
      Highlight,
      WikiLink.configure({ onOpen: (t) => props.onOpenLink?.(t) }),
      HeadingFold,
      HideSection.configure({ headings: props.hideSections ?? [] }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ],
    editorProps: {
      // While the [[ picker is open, the arrow keys / Enter / Esc drive it
      // instead of the document.
      handleKeyDown: (_view, event) => {
        if (!linkMenuRef.current) return false;
        const n = linkItemsRef.current.length;
        if (event.key === "ArrowDown") { setLinkSel((i) => (n ? (i + 1) % n : 0)); return true; }
        if (event.key === "ArrowUp") { setLinkSel((i) => (n ? (i - 1 + n) % n : 0)); return true; }
        if (event.key === "Enter" || event.key === "Tab") { chooseRef.current(); return true; }
        if (event.key === "Escape") { setLinkMenu(null); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      detectLink(ed);
      if (autosaveOff.current) return;   // paused for an external write
      setDirty(true);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => save(), 900);
    },
    onSelectionUpdate: ({ editor: ed }) => detectLink(ed),
  });

  const save = useCallback(async () => {
    if (!editor || !pathRef.current || autosaveOff.current) return;
    const md = unescapeWikiLinks(editor.storage.markdown.getMarkdown());
    // The properties rail (and AI assists) rewrite frontmatter while the
    // editor is open — always re-read the current block instead of trusting
    // the copy cached at load time, or a body autosave would revert it.
    try {
      const fmNow = splitRawFrontmatter(await readFile(pathRef.current)).fmRaw;
      if (fmNow) fmRef.current = fmNow;
    } catch { /* file moved — keep the cached block */ }
    let out: string;
    if (fmRef.current) {
      fmRef.current = bumpUpdated(fmRef.current, todayStamp());
      out = fmRef.current.trimEnd() + "\n\n" + md.replace(/^\n+/, "").trimEnd() + "\n";
    } else {
      out = md.trimEnd() + "\n";
    }
    await writeFile(pathRef.current, out);
    setDirty(false);
    props.onSaved?.(pathRef.current);
  }, [editor, props]);

  // Flush a pending body edit when the editor unmounts (navigating to a
  // non-object route closes the page without a path change), and clear the
  // debounced timer — otherwise an in-flight autosave is dropped and the last
  // keystrokes are lost. This also makes out-of-band frontmatter writes (the
  // properties rail's photo / prop edits) safe: the in-memory body is always
  // persisted before the page goes away.
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    // Only flush genuine pending edits. Without the dirty gate this re-wrote
    // the file on every navigation away — bumping `updated` for notes the user
    // only viewed, and (worse) resurrecting a note that was just deleted, since
    // its editor unmounts and would re-write the old path.
    if (dirtyRef.current && !autosaveOff.current) void saveRef.current();
  }, []);

  useEffect(() => {
    (async () => {
      if (!editor || !path) return;
      // flush pending edits to the file we're leaving
      window.clearTimeout(saveTimer.current);
      if (dirty && pathRef.current && pathRef.current !== path) await save();
      const raw = await readFile(path);
      const { fmRaw, body } = splitRawFrontmatter(raw);
      fmRef.current = fmRaw;
      pathRef.current = path;
      noteDirRef.current = path.slice(0, path.lastIndexOf("/"));
      editor.commands.setContent(body, false);
      editor.commands.unfoldAllHeadings();   // fold state is per-document, not carried across files
      setLinkMenu(null);
      setDirty(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, editor]);

  // External writes (transcript digest, unfurl cleanup) land while the page
  // is open — a token bump re-reads the file so the body on screen is real.
  const lastReload = useRef(props.reloadToken ?? 0);
  useEffect(() => {
    if (props.reloadToken === undefined || props.reloadToken === lastReload.current) return;
    lastReload.current = props.reloadToken;
    (async () => {
      if (!editor || !pathRef.current) return;
      window.clearTimeout(saveTimer.current);
      const raw = await readFile(pathRef.current);
      const { fmRaw, body } = splitRawFrontmatter(raw);
      fmRef.current = fmRaw;
      editor.commands.setContent(body, false);
      editor.commands.unfoldAllHeadings();   // reloaded body → drop stale folds
      setLinkMenu(null);
      setDirty(false);
    })();
  }, [props.reloadToken, editor]);

  useImperativeHandle(ref, () => ({
    flush: save,
    insertText: (text: string) => { if (text && editor) editor.chain().focus().insertContent(editor.schema.text(text)).run(); },
    pauseAutosave: () => {
      autosaveOff.current = true;
      window.clearTimeout(saveTimer.current);
      editor?.setEditable(false);   // lock the surface while AI writes
    },
    resumeAutosave: () => {
      autosaveOff.current = false;
      editor?.setEditable(true);
    },
    isDirty: () => dirty,
    reloadFromDisk: async () => {
      if (!editor || !pathRef.current) return;
      autosaveOff.current = true;            // synchronously cancel any pending save
      window.clearTimeout(saveTimer.current);
      try {
        const raw = await readFile(pathRef.current);
        const { fmRaw, body } = splitRawFrontmatter(raw);
        fmRef.current = fmRaw;
        editor.commands.setContent(body, false);
        editor.commands.unfoldAllHeadings();
        setLinkMenu(null);
        setDirty(false);
      } finally {
        autosaveOff.current = false;
      }
    },
  }), [save, editor, dirty]);

  // Toolbar image button: copy the picked file into <note>/Attachments and
  // insert a note-relative embed (a data URL in browser demo mode).
  const imageInput = useRef<HTMLInputElement>(null);
  const onPickImage = useCallback(async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !editor || !f.type.startsWith("image/")) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    let src: string;
    if (inTauri && noteDirRef.current) {
      const dir = `${noteDirRef.current}/Attachments`;
      await ensureDir(dir);
      const ext = f.type.includes("png") ? "png" : f.type.includes("gif") ? "gif" : "jpg";
      const base = (f.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "image");
      const name = `${base}-${Math.abs(hashStr(f.name + buf.length))}.${ext}`;
      await writeBinaryFile(join(dir, name), buf);
      src = `Attachments/${name}`;
    } else {
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      src = `data:${f.type};base64,${btoa(bin)}`;
    }
    editor.chain().focus().setImage({ src, alt: f.name.replace(/\.[^.]+$/, "") }).run();
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), 200);
  }, [editor, save]);

  // Candidates for the open [[ query; selecting one replaces `[[query` with
  // the linked `[[Title]]`. Refs keep the editor's keydown handler current.
  const linkItems = linkMenu && props.onLinkSearch ? props.onLinkSearch(linkMenu.query).slice(0, 7) : [];
  const chooseLink = (item?: LinkItem) => {
    if (!editor || !linkMenu) return;
    const pick = item ?? linkItems[linkSel];
    const name = pick ? pick.stem : linkMenu.query.trim();
    setLinkMenu(null);
    if (!name) return;
    const to = editor.state.selection.from;
    // Insert a text NODE, not a string — a string is re-parsed by tiptap-markdown
    // (markdown-it), so a name with `_`, backtick, ~~, *, or a URL would be
    // structurally transformed and the wiki link broken.
    editor.chain().focus().insertContentAt({ from: linkMenu.from, to }, editor.schema.text(`[[${name}]]`)).run();
  };
  useEffect(() => {
    linkMenuRef.current = linkMenu;
    linkItemsRef.current = linkItems;
    linkSelRef.current = linkSel;
    chooseRef.current = () => chooseLink();
  });

  return (
    <div className="md-editor">
      <Toolbar editor={editor} onInsertImage={() => imageInput.current?.click()} />
      <input ref={imageInput} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { onPickImage(e.target.files); e.target.value = ""; }} />
      <div className="editor-scroll" style={{ minHeight: props.minHeight ?? 200 }}>
        <EditorContent editor={editor} />
      </div>
      <div className="editor-status">
        <span>{path ? path.split("/").pop() : "—"}</span>
        <span>{dirty ? "saving…" : "saved"}</span>
      </div>

      {linkMenu && (
        <div className="link-menu" style={{ left: linkMenu.x, top: linkMenu.y + 4 }}>
          {linkItems.length === 0 ? (
            <div className="link-menu-empty">↩ inserts <b>[[{linkMenu.query || "…"}]]</b></div>
          ) : linkItems.map((it, i) => (
            <button
              key={it.stem + i}
              className={`link-menu-item ${i === linkSel ? "on" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); chooseLink(it); }}
              onMouseEnter={() => setLinkSel(i)}
            >
              <span className="link-menu-title">{it.title}</span>
              <span className="link-menu-type">{it.typeKey || "note"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

const hashStr = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h % 100000;
};

function Toolbar(props: { editor: Editor | null; onInsertImage?: () => void }) {
  const e = props.editor;
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  if (!e) return null;
  const B = (label: string, on: boolean, fn: () => void, title: string) => (
    <button className={`tb-btn ${on ? "on" : ""}`} onMouseDown={(ev) => { ev.preventDefault(); fn(); }} title={title}>
      {label}
    </button>
  );
  const applyLink = () => {
    const href = url.trim();
    if (href) {
      const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
      e.chain().focus().extendMarkRange("link").setLink({ href: withScheme }).run();
    }
    setLinking(false);
    setUrl("");
  };
  return (
    <div className="editor-toolbar" style={{ flexWrap: "wrap" }}>
      {B("H1", e.isActive("heading", { level: 1 }), () => e.chain().focus().toggleHeading({ level: 1 }).run(), "Heading 1")}
      {B("H2", e.isActive("heading", { level: 2 }), () => e.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {B("H3", e.isActive("heading", { level: 3 }), () => e.chain().focus().toggleHeading({ level: 3 }).run(), "Heading 3")}
      {B("B", e.isActive("bold"), () => e.chain().focus().toggleBold().run(), "Bold")}
      {B("I", e.isActive("italic"), () => e.chain().focus().toggleItalic().run(), "Italic")}
      {B("S", e.isActive("strike"), () => e.chain().focus().toggleStrike().run(), "Strikethrough")}
      {B("◆", e.isActive("highlight"), () => e.chain().focus().toggleHighlight().run(), "Highlight")}
      {B("• List", e.isActive("bulletList"), () => e.chain().focus().toggleBulletList().run(), "Bullet list")}
      {B("1. List", e.isActive("orderedList"), () => e.chain().focus().toggleOrderedList().run(), "Numbered list")}
      {B("☑ List", e.isActive("taskList"), () => e.chain().focus().toggleTaskList().run(), "Checklist")}
      {B("Link", e.isActive("link"), () => {
        if (e.isActive("link")) e.chain().focus().unsetLink().run();
        else setLinking(true);
      }, "Add or remove link")}
      {B("[[ ]]", false, () => e.chain().focus().insertContent("[[").run(), "Wiki link — type the object name and close with ]]")}
      {props.onInsertImage && B("Photo", false, () => props.onInsertImage!(), "Insert a photo from your computer")}
      {B("Quote", e.isActive("blockquote"), () => e.chain().focus().toggleBlockquote().run(), "Quote")}
      {B("Code", e.isActive("codeBlock"), () => e.chain().focus().toggleCodeBlock().run(), "Code block")}
      {B("—", false, () => e.chain().focus().setHorizontalRule().run(), "Divider")}
      {linking && (
        <input
          className="input" autoFocus
          style={{ flexBasis: "100%", marginTop: 6 }}
          placeholder="Paste a URL and press Enter (Esc to cancel)"
          value={url}
          onChange={(ev) => setUrl(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") applyLink();
            if (ev.key === "Escape") { setLinking(false); setUrl(""); }
          }}
        />
      )}
    </div>
  );
}
