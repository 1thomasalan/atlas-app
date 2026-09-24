import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./demoFs";

function safeTitle(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Atlas Edition";
}

/** Open the native print sheet with a useful default PDF filename. The print
 *  stylesheet removes Atlas chrome and preserves the newspaper itself. */
export async function sharePublicationPdf(title: string): Promise<void> {
  const previousTitle = document.title;
  document.title = safeTitle(title);
  try {
    if (inTauri) await invoke("print_webview");
    else window.print();
  } finally {
    window.setTimeout(() => { document.title = previousTitle; }, 1200);
  }
}
