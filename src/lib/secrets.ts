import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./demoFs";

export interface AppSecrets {
  openaiKey: string;
  todoistToken: string;
}

const EMPTY_SECRETS: AppSecrets = {
  openaiKey: "",
  todoistToken: "",
};

let demoSecrets = { ...EMPTY_SECRETS };

export async function loadAppSecrets(): Promise<AppSecrets> {
  if (!inTauri) return { ...demoSecrets };
  return invoke<AppSecrets>("load_app_secrets");
}

export async function saveAppSecrets(secrets: AppSecrets): Promise<AppSecrets> {
  if (!inTauri) {
    demoSecrets = { ...secrets };
    return { ...demoSecrets };
  }
  return invoke<AppSecrets>("save_app_secrets", {
    openaiKey: secrets.openaiKey,
    todoistToken: secrets.todoistToken,
  });
}

export async function hardenSettingsStore(): Promise<void> {
  if (!inTauri) return;
  await invoke("harden_settings_store");
}
