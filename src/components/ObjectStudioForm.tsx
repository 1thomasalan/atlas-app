import { useState } from "react";
import { ObjectStudioRequest } from "../lib/objectStudio";

const EMPTY: ObjectStudioRequest = {
  name: "",
  tracks: "",
  processing: "",
  goal: "",
  preferredProcessor: "codex",
};

export default function ObjectStudioForm(props: {
  agentZeroReady: boolean;
  onCreate: (request: ObjectStudioRequest) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ObjectStudioRequest>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ObjectStudioRequest>(key: K, value: ObjectStudioRequest[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const ready = draft.name.trim() && draft.tracks.trim() && draft.processing.trim() && draft.goal.trim();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await props.onCreate(draft);
      setDraft(EMPTY);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="object-studio-form">
      <div className="object-studio-grid">
        <div className="field">
          <label className="eyebrow">Object name</label>
          <input className="input" value={draft.name} placeholder="Instrument"
            onChange={(event) => set("name", event.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">Setup processor</label>
          <select className="input" value={draft.preferredProcessor}
            onChange={(event) => set("preferredProcessor", event.target.value as ObjectStudioRequest["preferredProcessor"])}>
            <option value="codex">Codex local</option>
            <option value="agent-zero" disabled={!props.agentZeroReady}>Agent Zero</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label className="eyebrow">What should it track?</label>
        <textarea className="input" rows={3} value={draft.tracks}
          placeholder="The information and relationships each object should preserve."
          onChange={(event) => set("tracks", event.target.value)} />
      </div>
      <div className="field">
        <label className="eyebrow">How should Atlas process it?</label>
        <textarea className="input" rows={3} value={draft.processing}
          placeholder="How captures become this object, required metadata, and review rules."
          onChange={(event) => set("processing", event.target.value)} />
      </div>
      <div className="field">
        <label className="eyebrow">What is the ultimate goal?</label>
        <textarea className="input" rows={3} value={draft.goal}
          placeholder="What this object should help the user understand, decide, or accomplish."
          onChange={(event) => set("goal", event.target.value)} />
      </div>
      <button className="btn primary" disabled={!ready || busy} onClick={submit}>
        {busy ? "Creating request…" : "Create setup request"}
      </button>
    </div>
  );
}
