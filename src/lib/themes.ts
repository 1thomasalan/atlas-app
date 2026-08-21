/** Atlas ships a spectrum of themes — all share the same structure (mono
 *  eyebrows, the layout, the icon set) so they "feel like Atlas", and differ in
 *  canvas, accent, and how much colour/gradient they lean into. Two are quiet
 *  and minimal; four are vibrant. Each is just a `[data-theme]` token block in
 *  tokens.css; this file is the registry the picker and the cycle button read. */

export type ThemeId = "paper" | "ink" | "signal" | "ocean" | "aurora" | "sunset";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
  group: "Minimal" | "Vibrant";
}

export const THEMES: ThemeMeta[] = [
  { id: "paper",  name: "Paper",  blurb: "Clean light · minimal",      group: "Minimal" },
  { id: "ink",    name: "Ink",    blurb: "Clean dark · minimal",       group: "Minimal" },
  { id: "signal", name: "Signal", blurb: "Warm light · Atlas orange",  group: "Vibrant" },
  { id: "ocean",  name: "Ocean",  blurb: "Fresh light · blue → mint",  group: "Vibrant" },
  { id: "aurora", name: "Aurora", blurb: "Cool dark · indigo → teal",  group: "Vibrant" },
  { id: "sunset", name: "Sunset", blurb: "Warm dark · orange → violet", group: "Vibrant" },
];

export const THEME_IDS = THEMES.map((t) => t.id);

/** Coerce any stored value (incl. the legacy "light"/"dark") to a real theme. */
export function normTheme(t: string | undefined): ThemeId {
  if (t === "light") return "paper";
  if (t === "dark") return "ink";
  return (THEME_IDS as string[]).includes(t ?? "") ? (t as ThemeId) : "signal";
}

/** Next theme in the list — for the sidebar's quick cycle button. */
export function nextTheme(t: ThemeId): ThemeId {
  const i = THEME_IDS.indexOf(t);
  return THEME_IDS[(i + 1) % THEME_IDS.length];
}
