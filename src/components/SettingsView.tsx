import { useEffect, useRef, useState } from "react";
import { Settings, FontScale, EditorFont } from "../lib/settings";
import { ObjectTypeDef, PropKind } from "../lib/objectTypes";
import { THEMES } from "../lib/themes";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, fetchAvailableModels, labelFor } from "../lib/aiModel";
import { agentZeroTokenStatus, saveAgentZeroToken } from "../lib/agentProcessing";
import { ObjectStudioRequest } from "../lib/objectStudio";
import ObjectStudioForm from "./ObjectStudioForm";

const TYPE_PALETTE = ["#4a6fa5", "#2e7d4f", "#b3590a", "#6f5bb5", "#3a7ca5", "#8a5a44", "#467fcf", "#ff4400"];
const PROP_KINDS: PropKind[] = ["text", "number", "date", "select", "tags", "url", "link"];
const CORE_TYPE_KEYS = new Set(["daily", "person", "place", "task"]);

export default function SettingsView(props: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  allTypes: ObjectTypeDef[];
  customTypes: ObjectTypeDef[];
  onSaveTypes: (types: ObjectTypeDef[]) => void;
  vaultPath: string;
  onPickVault: () => void;
  onApplyVaultPath: (path: string) => Promise<boolean>;
  onSyncEmbeddings: () => void;
  onOpenProcessing: () => void;
  onCreateObjectRequest: (request: ObjectStudioRequest) => Promise<void>;
  toast: (m: string) => void;
}) {
  const [s, setS] = useState<Settings>(props.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  // The model dropdown can pull the live list from the user's key, so new
  // models (GPT-5.5 and whatever's next) appear without an app update.
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [agentToken, setAgentToken] = useState("");
  const [agentTokenConfigured, setAgentTokenConfigured] = useState(false);
  const [agentTokenBusy, setAgentTokenBusy] = useState(false);
  const modelsBooted = useRef(false);
  const loadModels = async () => {
    const key = s.openaiKey.trim();
    if (!key) return;
    setModelsBusy(true);
    try { setModels(await fetchAvailableModels(key)); }
    catch (e) { props.toast(`Couldn't load models: ${e instanceof Error ? e.message : "unknown"}`); }
    finally { setModelsBusy(false); }
  };
  useEffect(() => {
    if (modelsBooted.current) return;
    modelsBooted.current = true;
    if (s.openaiKey.trim()) loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    agentZeroTokenStatus().then((status) => setAgentTokenConfigured(status.configured));
  }, []);
  // Never let the controlled <select> have a value with no matching option
  // (an empty chatModel — e.g. after clearing the custom input — desyncs it).
  const selectValue = s.chatModel.trim() || DEFAULT_CHAT_MODEL;
  const modelOptions = Array.from(
    new Set([...(models.length ? models : CHAT_MODELS.map((m) => m.id)), selectValue]),
  ).filter(Boolean);

  // Auto-save: nothing typed here should be lost to a missed button press.
  const booted = useRef(false);
  const saveRef = useRef(props.onSave);
  useEffect(() => { saveRef.current = props.onSave; }, [props.onSave]);
  useEffect(() => {
    if (!booted.current) { booted.current = true; return; }
    const t = window.setTimeout(() => {
      void saveRef.current(s).catch((error) => {
        props.toast(error instanceof Error ? error.message : "Atlas could not save settings");
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [s, props.toast]);

  const toggleType = (key: string) => {
    const disabled = new Set(s.disabledTypeKeys);
    if (disabled.has(key)) disabled.delete(key); else disabled.add(key);
    set("disabledTypeKeys", [...disabled]);
  };

  const saveAgentToken = async (clear = false) => {
    setAgentTokenBusy(true);
    try {
      const status = await saveAgentZeroToken(clear ? "" : agentToken);
      setAgentTokenConfigured(status.configured);
      setAgentToken("");
      props.toast(status.configured ? "Agent Zero token saved securely" : "Agent Zero token cleared");
    } catch (error) {
      props.toast(error instanceof Error ? error.message : "Atlas could not save the Agent Zero token");
    } finally {
      setAgentTokenBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Configuration</span>
        <h1 className="page-title">Settings</h1>
      </div>

      <VaultSection current={props.vaultPath} onPick={props.onPickVault} onApply={props.onApplyVaultPath} />

      <section className="settings-section">
        <h3>Appearance</h3>
        <p className="hint">Everything here applies live and saves automatically.</p>
        <div className="field">
          <label className="eyebrow">Theme</label>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} data-theme={t.id}
                className={`theme-card ${s.theme === t.id ? "on" : ""}`}
                onClick={() => set("theme", t.id)} title={t.blurb}>
                <span className="theme-card-preview">
                  <span className="theme-card-bar" />
                  <span className="theme-card-dot" />
                  <span className="theme-card-lines"><i /><i /></span>
                </span>
                <span className="theme-card-name">{t.name}{s.theme === t.id ? " ✓" : ""}</span>
                <span className="theme-card-blurb">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="eyebrow">Text size</label>
          <div className="seg">
            {(["compact", "comfortable", "large"] as FontScale[]).map((f) => (
              <button key={f} className={`seg-btn ${s.fontScale === f ? "on" : ""}`} onClick={() => set("fontScale", f)}>{f}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="eyebrow">Editor typeface</label>
          <div className="seg">
            {(["sans", "serif"] as EditorFont[]).map((f) => (
              <button key={f} className={`seg-btn ${s.editorFont === f ? "on" : ""}`} onClick={() => set("editorFont", f)}>{f}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>You</h3>
        <p className="hint">Used in the dashboard greeting.</p>
        <div className="field">
          <label className="eyebrow">Name</label>
          <input className="input" value={s.userName} onChange={(e) => set("userName", e.target.value)} />
        </div>
      </section>

      <section className="settings-section settings-section-wide">
        <h3>Processing &amp; agents</h3>
        <p className="hint">
          Codex uses your local ChatGPT subscription. Agent Zero uses a separate A2A token
          and receives only the Capture content assigned to its leased job.
        </p>
        <div className="field">
          <label className="eyebrow">Routing mode</label>
          <div className="seg">
            {(["codex", "agent-zero", "hybrid"] as const).map((mode) => (
              <button key={mode} className={`seg-btn ${s.processingMode === mode ? "on" : ""}`}
                disabled={mode !== "codex" && !agentTokenConfigured}
                onClick={() => set("processingMode", mode)}>
                {mode === "codex" ? "Codex" : mode === "agent-zero" ? "Agent Zero" : "Hybrid"}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-toggle-grid">
          <label className="setting-toggle">
            <input type="checkbox" checked={s.codexEnabled}
              onChange={(event) => set("codexEnabled", event.target.checked)} />
            <span><strong>Codex</strong><small>Local subscription handoff</small></span>
          </label>
          <label className="setting-toggle">
            <input type="checkbox" checked={s.agentZeroEnabled}
              onChange={(event) => set("agentZeroEnabled", event.target.checked)} />
            <span><strong>Agent Zero</strong><small>Scoped A2A proposals</small></span>
          </label>
        </div>
        <div className="object-studio-grid">
          <div className="field">
            <label className="eyebrow">Agent Zero instance</label>
            <input className="input" value={s.agentZeroBaseUrl} placeholder="http://127.0.0.1:50080"
              onChange={(event) => set("agentZeroBaseUrl", event.target.value)} />
          </div>
          <div className="field">
            <label className="eyebrow">Project</label>
            <input className="input" value={s.agentZeroProject} placeholder="Atlas"
              onChange={(event) => set("agentZeroProject", event.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="eyebrow">A2A token</label>
          <div className="secret-field-row">
            <input className="input" type="password" value={agentToken} placeholder={agentTokenConfigured ? "Token saved locally" : "Paste Agent Zero token"}
              onChange={(event) => setAgentToken(event.target.value)} />
            <button className="btn" disabled={agentTokenBusy || !agentToken.trim()} onClick={() => saveAgentToken(false)}>Save</button>
            {agentTokenConfigured && <button className="btn" disabled={agentTokenBusy} onClick={() => saveAgentToken(true)}>Clear</button>}
          </div>
          <p className="hint agent-status" style={{ marginTop: 6 }}>
            {agentTokenConfigured ? "Stored in your operating system credential manager" : "Not configured"}
          </p>
        </div>
        <div className="processing-boundary">
          <span>External publishing, spending, messaging, and account changes require approval.</span>
          <span>Durable processing-rule changes require approval.</span>
        </div>
        <button className="btn primary" onClick={props.onOpenProcessing}>Open processing center</button>
      </section>

      <section className="settings-section">
        <h3>Todoist</h3>
        <p className="hint">
          API token from Todoist → Settings → Integrations → Developer. Two-way sync;
          when both sides change the same task between syncs, your vault wins. The token
          is stored in your operating system credential manager.
        </p>
        <div className="field">
          <label className="eyebrow">API token</label>
          <input className="input" type="password" value={s.todoistToken}
            onChange={(e) => set("todoistToken", e.target.value)} placeholder="••••••••" />
        </div>
      </section>

      <section className="settings-section">
        <h3>OpenAI</h3>
        <p className="hint">
          Powers the AI layer: semantic search in ⌘K (embeddings, cached in{" "}
          <code>.atlas/embeddings.json</code>), screenshot import for workouts and meals,
          and the AI summary / AI tags buttons on object pages. The key is stored in your
          operating system credential manager (macOS Keychain on Mac), never inside your
          vault or settings file.
        </p>
        <div className="field">
          <label className="eyebrow">API key</label>
          <input className="input" type="password" value={s.openaiKey}
            onChange={(e) => set("openaiKey", e.target.value)} placeholder="sk-…" />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label className="eyebrow">AI model</label>
          {customModel ? (
            <input className="input" value={s.chatModel} autoFocus placeholder="model id, e.g. gpt-5.5"
              onChange={(e) => set("chatModel", e.target.value)} />
          ) : (
            <select className="input" value={selectValue}
              onChange={(e) => { if (e.target.value === "__custom__") setCustomModel(true); else set("chatModel", e.target.value); }}>
              {modelOptions.map((id) => <option key={id} value={id}>{labelFor(id)}</option>)}
              <option value="__custom__">Custom model id…</option>
            </select>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <button className="btn" disabled={modelsBusy || !s.openaiKey.trim()} onClick={loadModels}>
              {modelsBusy ? "Loading…" : "Load models from your key"}
            </button>
            {customModel
              ? <button className="btn" onClick={() => { if (!s.chatModel.trim()) set("chatModel", DEFAULT_CHAT_MODEL); setCustomModel(false); }}>Pick from list</button>
              : <span className="hint">{models.length ? `${models.length} available on your key` : "loads your account's models"}</span>}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            The model behind summaries, tags, the morning &amp; Daily Brief, and screenshot import.
            Higher tiers (GPT-5.5, etc.) are smarter but cost more per call. Embeddings and AI images use their own models.
          </p>
        </div>
        <button className="btn" onClick={props.onSyncEmbeddings}>Update embeddings now</button>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="eyebrow">Morning auto-brief</label>
          <div className="seg">
            {([["on", true], ["off", false]] as const).map(([label, val]) => (
              <button key={label} className={`seg-btn ${s.autoBrief === val ? "on" : ""}`}
                onClick={() => set("autoBrief", val)}>{label}</button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Writes a calm “what needs me today” section into today's daily note the first time
            you open it each day. Plain markdown you can edit or delete; written once per day.
          </p>
        </div>
      </section>

      <section className="settings-section">
        <h3>Daily Brief</h3>
        <p className="hint">
          A once-a-day news + weather brief, fetched automatically the first time you open Atlas
          each day and saved locally in <code>.atlas/briefs</code> — nothing is published. It
          researches the day's news with your OpenAI key (web search), so add that above first.
        </p>
        <div className="field">
          <label className="eyebrow">Daily Brief</label>
          <div className="seg">
            {([["on", true], ["off", false]] as const).map(([label, val]) => (
              <button key={label} className={`seg-btn ${s.dailyBrief === val ? "on" : ""}`}
                onClick={() => set("dailyBrief", val)}>{label}</button>
            ))}
          </div>
        </div>
        {s.dailyBrief && (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Brief name</label>
              <input className="input" value={s.briefName}
                onChange={(e) => set("briefName", e.target.value)} placeholder="Daily Brief" />
              <p className="hint" style={{ marginTop: 6 }}>Shown as the masthead and the sidebar label.</p>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Topics</label>
              <input className="input" value={s.briefTopics}
                onChange={(e) => set("briefTopics", e.target.value)} placeholder="AI, Robotics, Biotech, Energy" />
              <p className="hint" style={{ marginTop: 6 }}>Comma-separated — each becomes a section of the day's top stories.</p>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Location</label>
              <input className="input" value={s.briefLocation}
                onChange={(e) => set("briefLocation", e.target.value)} placeholder="Portland, Oregon" />
              <p className="hint" style={{ marginTop: 6 }}>
                Drives the local weather and local news. Non-English local news is translated to English.
              </p>
            </div>
          </>
        )}
      </section>

      <section className="settings-section">
        <h3>Local News</h3>
        <p className="hint">
          A source-linked local edition you can refresh on demand. Atlas researches the current
          edition with your OpenAI key, caches the live view in <code>.atlas/local-news</code>, and
          saves a readable Markdown copy inside your vault.
        </p>
        <div className="field">
          <label className="eyebrow">Local News</label>
          <div className="seg">
            {([["on", true], ["off", false]] as const).map(([label, val]) => (
              <button key={label} className={`seg-btn ${s.localNews === val ? "on" : ""}`}
                onClick={() => set("localNews", val)}>{label}</button>
            ))}
          </div>
        </div>
        {s.localNews && (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Publication name</label>
              <input className="input" value={s.localNewsName}
                onChange={(e) => set("localNewsName", e.target.value)} placeholder="Local News" />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Coverage area</label>
              <input className="input" value={s.localNewsLocation}
                onChange={(e) => set("localNewsLocation", e.target.value)} placeholder="City, region, or prefecture" />
              <p className="hint" style={{ marginTop: 6 }}>Used for both local research and current weather.</p>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Preferred sources</label>
              <textarea className="input" rows={3} value={s.localNewsSources}
                onChange={(e) => set("localNewsSources", e.target.value)}
                placeholder="Local newsrooms, government notices, weather and transport services" />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Editorial focus and exclusions</label>
              <textarea className="input" rows={4} value={s.localNewsFocus}
                onChange={(e) => set("localNewsFocus", e.target.value)}
                placeholder="What should this edition prioritize or leave out?" />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="eyebrow">Markdown archive folder</label>
              <input className="input" value={s.localNewsArchiveFolder}
                onChange={(e) => set("localNewsArchiveFolder", e.target.value)} placeholder="02-Library/Local News" />
              <p className="hint" style={{ marginTop: 6 }}>A path inside the connected vault. Absolute paths and parent traversal are rejected.</p>
            </div>
          </>
        )}
      </section>

      <section className="settings-section">
        <h3>Pomodoro</h3>
        <div style={{ display: "flex", gap: 14 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="eyebrow">Work (minutes)</label>
            <input className="input" type="number" min={5} max={90} value={s.pomodoroWork}
              onChange={(e) => set("pomodoroWork", Number(e.target.value) || 25)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="eyebrow">Break (minutes)</label>
            <input className="input" type="number" min={1} max={30} value={s.pomodoroBreak}
              onChange={(e) => set("pomodoroBreak", Number(e.target.value) || 5)} />
          </div>
        </div>
      </section>

      <section className="settings-section settings-section-wide">
        <h3>Object types</h3>
        <p className="hint">
          Built-in types (Pages, Tasks, People…) map onto your vault's folders. Add your
          own — each becomes a sidebar entry and a folder of plain markdown files. The
          schema lives in <code>.atlas/types.json</code> inside the vault.
        </p>
        <div className="object-type-settings-grid">
          {props.allTypes.map((t) => {
            const enabled = !s.disabledTypeKeys.includes(t.key);
            return (
              <div key={t.key} className={`object-type-setting ${enabled ? "on" : ""}`}>
                <button className="object-type-switch" role="switch" aria-checked={enabled}
                  onClick={() => toggleType(t.key)} title={`${enabled ? "Disable" : "Enable"} ${t.plural}`}>
                  <span />
                </button>
                <span className="object-type-mark" style={{ color: t.color }}>{t.icon}</span>
                <span className="object-type-copy">
                  <strong>{t.plural}</strong>
                  <small>{CORE_TYPE_KEYS.has(t.key) ? "Core object" : "Optional object"} · {t.folder}</small>
                </span>
                {t.custom && (
                  <button className="btn" onClick={() => props.onSaveTypes(props.customTypes.filter((x) => x.key !== t.key))}>Remove</button>
                )}
              </div>
            );
          })}
        </div>
        <div className="settings-subsection">
          <span className="eyebrow" style={{ color: "var(--signal)" }}>Object Studio</span>
          <h4>Design with an agent</h4>
          <p className="hint">
            Describe the object and Atlas will create a Capture request, then route it to your chosen processor for a review-gated setup proposal.
          </p>
          <ObjectStudioForm agentZeroReady={s.agentZeroEnabled && agentTokenConfigured} onCreate={props.onCreateObjectRequest} />
        </div>
        <div className="settings-subsection">
          <span className="eyebrow">Advanced</span>
          <h4>Define a type manually</h4>
        <NewTypeForm
          onAdd={(t) => {
            if (props.customTypes.some((x) => x.key === t.key)) { props.toast("A type with that name already exists"); return; }
            props.onSaveTypes([...props.customTypes, t]);
            props.toast(`Type "${t.plural}" added`);
          }}
        />
        </div>
      </section>

      <p className="eyebrow" style={{ marginTop: 8 }}>Changes save automatically.</p>
    </div>
  );
}

function VaultSection(props: {
  current: string;
  onPick: () => void;
  onApply: (path: string) => Promise<boolean>;
}) {
  const [path, setPath] = useState(props.current);
  const [applying, setApplying] = useState(false);
  useEffect(() => setPath(props.current), [props.current]);

  const changed = path.trim() !== "" && path.trim() !== props.current;
  const apply = async () => {
    setApplying(true);
    const ok = await props.onApply(path.trim());
    setApplying(false);
    if (!ok) setPath(props.current);
  };

  return (
    <section className="settings-section">
      <h3>Your files</h3>
      <p className="hint">
        The folder where everything you write lives — every page, task, and daily note
        is a plain markdown file inside it. Point this at an existing Obsidian vault and
        Atlas and Obsidian work on the same files, side by side. Nothing is ever stored
        anywhere else.
      </p>
      <div className="field">
        <label className="eyebrow">Folder</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            value={path}
            placeholder="/Users/you/Knowledge/My Vault"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changed && apply()}
          />
          <button className="btn" onClick={props.onPick}>Browse…</button>
        </div>
      </div>
      {changed && (
        <button className="btn primary" onClick={apply} disabled={applying}>
          {applying ? "Connecting…" : "Use this folder"}
        </button>
      )}
    </section>
  );
}

function NewTypeForm(props: { onAdd: (t: ObjectTypeDef) => void }) {
  const [name, setName] = useState("");
  const [plural, setPlural] = useState("");
  const [icon, setIcon] = useState("◇");
  const [color, setColor] = useState(TYPE_PALETTE[0]);
  const [folder, setFolder] = useState("");
  const [propLines, setPropLines] = useState("");

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const pl = plural.trim() || `${n}s`;
    const propDefs = propLines.split("\n").map((line) => {
      const [key, kind] = line.split(":").map((p) => p.trim());
      if (!key) return null;
      const k = (PROP_KINDS.includes(kind as PropKind) ? kind : "text") as PropKind;
      return { key: key.toLowerCase().replace(/\s+/g, "_"), label: key, kind: k };
    }).filter(Boolean) as ObjectTypeDef["props"];
    props.onAdd({
      key: n.toLowerCase().replace(/\s+/g, "-"),
      name: n,
      plural: pl,
      icon: icon.trim().slice(0, 2) || "◇",
      color,
      folder: (folder.trim() || pl).replace(/^\/+|\/+$/g, ""),
      props: [...propDefs, { key: "tags", label: "Tags", kind: "tags" }],
      custom: true,
    });
    setName(""); setPlural(""); setFolder(""); setPropLines("");
  };

  return (
    <div className="new-type-form">
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="eyebrow">Name</label>
          <input className="input" value={name} placeholder="e.g. Recipe" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="eyebrow">Plural</label>
          <input className="input" value={plural} placeholder="Recipes" onChange={(e) => setPlural(e.target.value)} />
        </div>
        <div className="field" style={{ width: 70 }}>
          <label className="eyebrow">Icon</label>
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label className="eyebrow">Folder (vault-relative)</label>
        <input className="input" value={folder} placeholder="02-Library/Recipes" onChange={(e) => setFolder(e.target.value)} />
      </div>
      <div className="field">
        <label className="eyebrow">Color</label>
        <div style={{ display: "flex", gap: 6 }}>
          {TYPE_PALETTE.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c, outline: color === c ? "2px solid var(--ink)" : "none" }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <label className="eyebrow">Properties — one per line, `Label: kind` ({PROP_KINDS.join(" / ")})</label>
        <textarea className="input" rows={3} value={propLines}
          placeholder={"Servings: number\nCuisine: select"} onChange={(e) => setPropLines(e.target.value)} />
      </div>
      <button className="btn" onClick={add} disabled={!name.trim()}>Add object type</button>
    </div>
  );
}
