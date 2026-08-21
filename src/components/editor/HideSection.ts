import { Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Node as PMNode } from "@tiptap/pm/model";

/** Hide one or more heading sections entirely from view — the heading plus
 *  every block beneath it until the next heading of the same or higher level.
 *  View-only (decorations); the section stays in the document and the markdown
 *  round-trip, so saves never drop it. Used so the daily note's auto-managed
 *  `## Habits` checklist doesn't clutter the calendar day view (the Habits page
 *  owns it) — Atlas still stores completions in the note for Obsidian. */

const key = new PluginKey("hideSection");

function build(doc: PMNode, wanted: Set<string>): DecorationSet {
  if (!wanted.size) return DecorationSet.empty;
  const children: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, offset) => children.push({ node, pos: offset }));

  const decos: Decoration[] = [];
  for (let i = 0; i < children.length; i++) {
    const { node, pos } = children[i];
    if (node.type.name !== "heading") continue;
    if (!wanted.has(node.textContent.trim().toLowerCase())) continue;
    const level = node.attrs.level as number;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "pm-section-hidden" }));
    for (let j = i + 1; j < children.length; j++) {
      const c = children[j];
      if (c.node.type.name === "heading" && (c.node.attrs.level as number) <= level) break;
      decos.push(Decoration.node(c.pos, c.pos + c.node.nodeSize, { class: "pm-section-hidden" }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export const HideSection = Extension.create<{ headings: string[] }>({
  name: "hideSection",
  addOptions() { return { headings: [] }; },
  addProseMirrorPlugins() {
    const wanted = new Set(this.options.headings.map((h) => h.trim().toLowerCase()).filter(Boolean));
    return [
      new Plugin({
        key,
        props: { decorations: (state: EditorState) => build(state.doc, wanted) },
      }),
    ];
  },
});
