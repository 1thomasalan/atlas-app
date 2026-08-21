import { useState } from "react";
import { ObjectTypeDef } from "../lib/objectTypes";

/** The ⌘N moment: pick a type, name it, go. Mirrors Capacities' new-object
 *  flow — every type is one keystroke-and-a-title away. */

export default function NewObjectModal(props: {
  types: ObjectTypeDef[];
  initialType?: string;
  onCreate: (type: ObjectTypeDef, title: string) => void;
  onClose: () => void;
}) {
  const creatable = props.types.filter((t) => t.special !== "tag" && t.key !== "daily");
  const [typeKey, setTypeKey] = useState(props.initialType ?? "note");
  const [title, setTitle] = useState("");
  const selected = creatable.find((t) => t.key === typeKey) ?? creatable[0];

  const create = () => {
    if (!title.trim() || !selected) return;
    props.onCreate(selected, title.trim());
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={{ width: "min(540px, 92vw)" }}>
        <span className="eyebrow" style={{ color: "var(--signal)" }}>New object → {selected?.folder}</span>
        <h2>Create</h2>
        <div className="type-grid">
          {creatable.map((t) => (
            <button
              key={t.key}
              className={`type-pick ${t.key === selected?.key ? "on" : ""}`}
              style={{ ["--type-color" as string]: t.color }}
              onClick={() => setTypeKey(t.key)}
            >
              <span className="type-pick-icon">{t.icon}</span>
              {t.name}
            </button>
          ))}
        </div>
        <input
          className="input" autoFocus
          style={{ marginTop: 16 }}
          placeholder={selected?.key === "weblink"
            ? "Paste a URL — Atlas fetches title, image, and description…"
            : `Name this ${selected?.name.toLowerCase() ?? "object"}…`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") props.onClose();
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn primary" onClick={create} disabled={!title.trim()}>Create</button>
          <button className="btn" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
