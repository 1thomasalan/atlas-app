import { Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { Node as PMNode } from "@tiptap/pm/model";

/** Obsidian-style heading folding, done entirely with view decorations so it
 *  never touches the document or the markdown round-trip. A folded heading
 *  hides every following top-level block until the next heading of the same or
 *  higher level; a chevron in the left margin toggles it. Fold state is
 *  ephemeral (per editing session) and is cleared whenever the doc is reloaded
 *  via `unfoldAllHeadings` — markdown carries no fold marks, exactly like the
 *  underlying .md file. */

export const foldPluginKey = new PluginKey<FoldState>("headingFold");

interface FoldState { folded: Set<number>; }

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingFold: {
      /** Clear all folds (used after a doc reload). */
      unfoldAllHeadings: () => ReturnType;
    };
  }
}

function chevron(view: EditorView, pos: number, isFolded: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "fold-toggle" + (isFolded ? " is-folded" : "");
  el.textContent = isFolded ? "▸" : "▾";   // ▸ / ▾
  el.setAttribute("contenteditable", "false");
  el.title = isFolded ? "Expand section" : "Collapse section";
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();   // keep the editor's selection where it is
    e.stopPropagation();
    view.dispatch(view.state.tr.setMeta(foldPluginKey, { toggle: pos }));
  });
  return el;
}

function build(doc: PMNode, folded: Set<number>): DecorationSet {
  const decos: Decoration[] = [];
  const children: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, offset) => children.push({ node, pos: offset }));

  for (let i = 0; i < children.length; i++) {
    const { node, pos } = children[i];
    if (node.type.name !== "heading") continue;
    const level = node.attrs.level as number;

    // What folding this heading would hide: blocks up to the next heading of
    // the same or higher level.
    const hidden: Decoration[] = [];
    for (let j = i + 1; j < children.length; j++) {
      const c = children[j];
      if (c.node.type.name === "heading" && (c.node.attrs.level as number) <= level) break;
      hidden.push(Decoration.node(c.pos, c.pos + c.node.nodeSize, { class: "pm-fold-hidden" }));
    }
    // A heading with nothing beneath it can't be folded — show no affordance.
    if (!hidden.length) continue;

    const isFolded = folded.has(pos);
    // Chevron just inside the heading start; CSS pulls it into the left margin.
    decos.push(Decoration.widget(pos + 1, (view) => chevron(view, pos, isFolded), {
      side: -1,
      key: `fold-${pos}-${isFolded}`,
      ignoreSelection: true,
    }));
    if (isFolded) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "pm-fold-head" }));
      decos.push(...hidden);
    }
  }
  return DecorationSet.create(doc, decos);
}

export const HeadingFold = Extension.create({
  name: "headingFold",

  addCommands() {
    return {
      unfoldAllHeadings: () => ({ state, dispatch }) => {
        dispatch?.(state.tr.setMeta(foldPluginKey, { unfoldAll: true }));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FoldState>({
        key: foldPluginKey,
        state: {
          init: () => ({ folded: new Set<number>() }),
          apply(tr: Transaction, value: FoldState): FoldState {
            let folded = value.folded;
            // Keep folds pinned to their headings as the user types above them.
            if (tr.docChanged) {
              const next = new Set<number>();
              for (const p of folded) {
                const mapped = tr.mapping.map(p, -1);
                const n = tr.doc.nodeAt(mapped);
                if (n && n.type.name === "heading") next.add(mapped);
              }
              folded = next;
            }
            const meta = tr.getMeta(foldPluginKey) as { toggle?: number; unfoldAll?: boolean } | undefined;
            if (meta?.unfoldAll) return { folded: new Set<number>() };
            if (meta?.toggle != null) {
              folded = new Set(folded);
              if (folded.has(meta.toggle)) folded.delete(meta.toggle);
              else folded.add(meta.toggle);
            }
            return { folded };
          },
        },
        props: {
          decorations(state: EditorState) {
            const s = foldPluginKey.getState(state);
            return s ? build(state.doc, s.folded) : null;
          },
        },
      }),
    ];
  },
});
