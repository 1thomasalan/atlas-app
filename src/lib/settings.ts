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

async function getStore(): Promise<Store> {
  if (!store) store = await load("atlas-settings.json", { autoSave: true, defaults: {} });
  return store;
}

export async function loadSettings(): Promise<Settings> {
  let saved: Partial<Settings> = {};
  let secure = { openaiKey: "", todoistToken: "" };
  if (!inTauri) {
    seedDemo();
    saved = demoStore.get<Partial<Settings>>("settings") ?? {};
    secure = await loadAppSecrets();
  } else {
    // Migration runs before plugin-store reads the file so its in-memory copy
    // can never write legacy plaintext credentials back to disk.
    secure = await loadAppSecrets();
    const s = await getStore();
    saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  }
  secureCache = { ...secure };
  const merged = { ...DEFAULTS, ...saved };
  merged.openaiKey = secure.openaiKey;
  merged.todoistToken = secure.todoistToken;
  merged.theme = normTheme(merged.theme as unknown as string);   // migrate legacy light/dark
  if (!["codex", "agent-zero", "hybrid"].includes(merged.processingMode)) {
    merged.processingMode = "codex";
  }
  if (!Array.isArray(merged.disabledTypeKeys)) merged.disabledTypeKeys = [];
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const nextSecrets = {
    openaiKey: settings.openaiKey,
    todoistToken: settings.todoistToken,
  };
  if (!secureCache ||
      secureCache.openaiKey !== nextSecrets.openaiKey ||
      secureCache.todoistToken !== nextSecrets.todoistToken) {
    secureCache = await saveAppSecrets(nextSecrets);
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
