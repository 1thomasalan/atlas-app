import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/** [[Wiki links]] stay literal text in the document (and therefore in the
 *  markdown on disk — Obsidian reads them natively). This extension only
 *  decorates them on screen and routes clicks to the object graph. */

const WIKI_RE = /\[\[([^\]]+)\]\]/g;

export interface WikiLinkOptions {
  onOpen: (target: string) => void;
}

function findLinks(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(WIKI_RE)) {
      decos.push(
        Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, {
          class: "wikilink",
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const WikiLink = Extension.create<WikiLinkOptions>({
  name: "wikiLink",

  addOptions() {
    return { onOpen: () => {} };
  },

  addProseMirrorPlugins() {
    const onOpen = this.options.onOpen;
    return [
      new Plugin({
        key: new PluginKey("wikiLink"),
        state: {
          init: (_cfg, state) => findLinks(state.doc),
          apply: (tr, old) => (tr.docChanged ? findLinks(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(view, pos, event) {
            // Cmd/Ctrl-click (or plain click on the decorated span) opens the target
            const target = event.target as HTMLElement;
            if (!target.closest(".wikilink")) return false;
            const $pos = view.state.doc.resolve(pos);
            const child = $pos.parent.childAfter($pos.parentOffset).node
              ? $pos.parent.childAfter($pos.parentOffset)
              : $pos.parent.childBefore($pos.parentOffset);
            if (!child.node?.isText) return false;
            const text = child.node.text ?? "";
            // absolute doc position where this text node starts
            const nodeStart = pos - $pos.parentOffset + child.offset;
            for (const m of text.matchAll(WIKI_RE)) {
              const from = nodeStart + m.index!;
              const to = from + m[0].length;
              if (pos >= from && pos <= to) {
                onOpen(m[1].split(/[|#]/)[0].trim());
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
