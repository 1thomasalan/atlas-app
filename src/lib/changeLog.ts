import { invoke } from "@tauri-apps/api/core";
import { AtlasProfile } from "./atlasProfile";
import { inTauri } from "./demoFs";

/** Vault writes are recorded in 00-System/Change-Log.md via the Rust shell,
 *  matching the convention every other Atlas agent follows. Generic
 *  (non-Atlas) vaults have no 00-System, so logging is skipped there. */

const LOG_COOLDOWN_MS = 10 * 60 * 1000;
const lastLogged = new Map<string, number>();

export function relativeToVault(profile: AtlasProfile, path: string): string {
  return path.startsWith(profile.root + "/") ? path.slice(profile.root.length + 1) : path;
}

export async function logChange(
  profile: AtlasProfile,
  files: string[],
  reason: string,
  approval = "direct-low-stakes-task",
): Promise<void> {
  if (!profile.isAtlas || !inTauri) return;
  try {
    await invoke("log_change", {
      vault: profile.root,
      files: files.map((f) => relativeToVault(profile, f)),
      reason,
      approval,
    });
  } catch (err) {
    console.error("Change log failed:", err);
  }
}

/** Autosave fires every ~900ms while typing — dedupe to one entry per file
 *  per cooldown window so the change log stays readable. */
export async function logChangeDebounced(
  profile: AtlasProfile,
  file: string,
  reason: string,
  approval?: string,
): Promise<void> {
  const now = Date.now();
  if (now - (lastLogged.get(file) ?? 0) < LOG_COOLDOWN_MS) return;
  lastLogged.set(file, now);
  await logChange(profile, [file], reason, approval);
}
