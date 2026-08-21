import { openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "./demoFs";

/** Open a link in the user's default browser. Anchor target=_blank doesn't
 *  leave the webview in Tauri, so everything outward goes through here. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri) await openUrl(url);
  else window.open(url, "_blank", "noopener");
}
