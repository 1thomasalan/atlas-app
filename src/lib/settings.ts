import { load, Store } from "@tauri-apps/plugin-store";
import { inTauri, demoStore, seedDemo } from "./demoFs";
import { hardenSettingsStore, loadAppSecrets, saveAppSecrets, type AppSecrets } from "./secrets";
import { ThemeId, normTheme } from "./themes";

export type FontScale = "compact" | "comfortable" | "large";
export type EditorFont = "sans" | "serif";
export type ProcessingMode = "codex" | "agent-zero" | "hybrid";

export interface Settings {
  vaultPath: string;
  theme: ThemeId;
  fontScale: FontScale;
  accent: string;          // the signal color
  editorFont: EditorFont;
  userName: string;
  todoistToken: string;
  openaiKey: string;
  pomodoroWork: number;   // minutes
  pomodoroBreak: number;
  autoBrief: boolean;     // write a morning brief into today's daily note on first open
  chatModel: string;      // the GPT model driving the AI layer (assist/vision/brief)
  // ---- Daily Brief: a configurable news/weather brief, auto-fetched once a day ----
  dailyBrief: boolean;    // feature on/off
  briefName: string;      // masthead the user picks (e.g. "Morning Brief")
  briefTopics: string;    // free text, e.g. "AI, Robotics, Biotech"
  briefLocation: string;  // city for local weather + local news (e.g. "Portland, Oregon")
  // ---- Local News: a dedicated, source-linked local newspaper ----
  localNews: boolean;
  localNewsName: string;
  localNewsLocation: string;
  localNewsSources: string;
  localNewsFocus: string;
  localNewsArchiveFolder: string; // vault-relative Markdown archive
  processingMode: ProcessingMode;
  codexEnabled: boolean;
  agentZeroEnabled: boolean;
  agentZeroBaseUrl: string;
  agentZeroProject: string;
  requireExternalApproval: boolean;
  requireRuleApproval: boolean;
  disabledTypeKeys: string[];
}

export const DEFAULTS: Settings = {
  vaultPath: "",
  theme: "signal",
  fontScale: "comfortable",
  accent: "#ff4400",
  editorFont: "sans",
  userName: "",
  todoistToken: "",
  openaiKey: "",
  pomodoroWork: 25,
  pomodoroBreak: 5,
  autoBrief: true,
  chatModel: "gpt-4o-mini",
  dailyBrief: false,
  briefName: "Daily Brief",
  briefTopics: "",
  briefLocation: "",
  localNews: false,
  localNewsName: "Local News",
  localNewsLocation: "",
  localNewsSources: "Local government notices, weather services, transport operators, and reputable local newsrooms",
  localNewsFocus: "Practical civic news, weather, transport, culture, economy, education, and grounded community stories",
  localNewsArchiveFolder: "02-Library/Local News",
  processingMode: "codex",
  codexEnabled: true,
  agentZeroEnabled: false,
  agentZeroBaseUrl: "http://127.0.0.1:50080",
  agentZeroProject: "Atlas",
  requireExternalApproval: true,
  requireRuleApproval: true,
  disabledTypeKeys: [],
};

/** One place that pushes appearance into the DOM. The theme owns the full
 *  palette (accent included) via its `[data-theme]` token block. */
export function applyAppearance(s: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.scale = s.fontScale;
  root.dataset.editorfont = s.editorFont;
}

let store: Store | null = null;
let secureCache: AppSecrets | null = null;
let secureLoaded = false;

async function getStore(): Promise<Store> {
  if (!store) store = await load("atlas-settings.json", { autoSave: true, defaults: {} });
  return store;
}

export async function loadSettings(): Promise<Settings> {
  let saved: Partial<Settings> = {};
  if (!inTauri) {
    seedDemo();
    saved = demoStore.get<Partial<Settings>>("settings") ?? {};
  } else {
    const s = await getStore();
    saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  }
  const merged = { ...DEFAULTS, ...saved };
  // Keychain access can show an OS authorization prompt after a locally built
  // app is replaced. Boot the interface first instead of leaving a blank
  // window while macOS waits for that prompt.
  merged.openaiKey = "";
  merged.todoistToken = "";
  merged.theme = normTheme(merged.theme as unknown as string);   // migrate legacy light/dark
  if (!["codex", "agent-zero", "hybrid"].includes(merged.processingMode)) {
    merged.processingMode = "codex";
  }
  if (!Array.isArray(merged.disabledTypeKeys)) merged.disabledTypeKeys = [];
  return merged;
}

/** Load secrets after the first frame. The native command also performs the
 *  one-time plaintext-to-Keychain migration before returning. */
export async function loadSettingsSecrets(): Promise<AppSecrets> {
  const secure = await loadAppSecrets();
  secureCache = { ...secure };
  secureLoaded = true;
  return secure;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const nextSecrets = {
    openaiKey: settings.openaiKey,
    todoistToken: settings.todoistToken,
  };
  // Do not erase existing Keychain values if the settings screen autosaves
  // while an OS authorization prompt is still pending.
  if ((!secureLoaded && (nextSecrets.openaiKey || nextSecrets.todoistToken)) ||
      (secureLoaded && (!secureCache ||
      secureCache.openaiKey !== nextSecrets.openaiKey ||
      secureCache.todoistToken !== nextSecrets.todoistToken))) {
    secureCache = await saveAppSecrets(nextSecrets);
    secureLoaded = true;
  }
  const persisted: Partial<Settings> = { ...settings };
  delete persisted.openaiKey;
  delete persisted.todoistToken;
  if (!inTauri) { demoStore.set("settings", persisted); return; }
  const s = await getStore();
  await s.set("settings", persisted);
  await s.save();
  await hardenSettingsStore();
}
