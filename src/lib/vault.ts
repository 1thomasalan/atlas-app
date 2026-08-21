import {
  readTextFile, writeTextFile, writeFile as fsWriteBinary, readDir as fsReadDir, mkdir, exists, rename,
} from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { inTauri, demoFs, seedDemo, DEMO_ROOT } from "./demoFs";

export interface VaultFile { name: string; path: string; isDir: boolean; children?: VaultFile[]; }

export async function pickVaultFolder(): Promise<string | null> {
  if (!inTauri) { seedDemo(); return DEMO_ROOT; }
  const selected = await open({ directory: true, multiple: false, title: "Point Atlas at your vault" });
  return typeof selected === "string" ? selected : null;
}

/** The static fs scope no longer covers the whole disk — the Rust shell
 *  extends it to the chosen vault. Must run before any fs call on the vault. */
export async function registerVault(path: string): Promise<void> {
  if (!inTauri) return;
  await invoke("register_vault", { path });
}

export const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

export async function readFile(path: string): Promise<string> {
  return inTauri ? readTextFile(path) : demoFs.readTextFile(path);
}
export async function writeFile(path: string, content: string): Promise<void> {
  return inTauri ? writeTextFile(path, content) : demoFs.writeTextFile(path, content);
}
export async function fileExists(path: string): Promise<boolean> {
  return inTauri ? exists(path) : demoFs.exists(path);
}
export async function ensureDir(path: string): Promise<void> {
  if (!inTauri) return demoFs.mkdir(path);
  if (!(await exists(path))) await mkdir(path, { recursive: true });
}
export async function moveFile(from: string, to: string): Promise<void> {
  return inTauri ? rename(from, to) : demoFs.rename(from, to);
}

/** Binary write (screenshots into the vault). No-op in browser demo mode. */
export async function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  if (!inTauri) return;
  await fsWriteBinary(path, data);
}

async function readDir(path: string) {
  return inTauri ? fsReadDir(path) : demoFs.readDir(path);
}

const IGNORED = new Set([".obsidian", ".atlas", ".git", ".trash", "node_modules"]);

export async function listTree(root: string, depth = 3): Promise<VaultFile[]> {
  if (depth === 0) return [];
  let entries; try { entries = await readDir(root); } catch { return []; }
  const out: VaultFile[] = [];
  for (const e of entries) {
    if (!e.name || e.name.startsWith(".") || IGNORED.has(e.name)) continue;
    const path = join(root, e.name);
    if (e.isDirectory) {
      out.push({ name: e.name, path, isDir: true, children: await listTree(path, depth - 1) });
    } else if (e.name.endsWith(".md")) {
      out.push({ name: e.name, path, isDir: false });
    }
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return out;
}

export async function listMarkdownIn(dir: string): Promise<string[]> {
  let entries; try { entries = await readDir(dir); } catch { return []; }
  return entries
    .filter((e) => !e.isDirectory && e.name?.endsWith(".md"))
    .map((e) => join(dir, e.name!));
}
