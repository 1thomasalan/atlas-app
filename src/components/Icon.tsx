import { ReactNode } from "react";

/** Atlas's line-icon set: one detailed, stroke-based SVG per object type and
 *  per nav action, replacing the old single-glyph approach. Drawn on a 24×24
 *  grid, inherit `currentColor`, scale crisply from the 18px rail to the 72px
 *  cover. Keep them geometric and even-weighted — Swiss, not skeuomorphic. */

const G: Record<string, ReactNode> = {
  // ---- Object types ----
  daily: (<>
    <line x1="3.5" y1="19" x2="20.5" y2="19" /><path d="M7 19a5 5 0 0 1 10 0" />
    <line x1="12" y1="3.5" x2="12" y2="6" /><line x1="4.7" y1="9.7" x2="6.3" y2="11.3" />
    <line x1="19.3" y1="9.7" x2="17.7" y2="11.3" />
  </>),
  note: (<>
    <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
    <path d="M14 3.5V7.5h4" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="15.5" x2="15" y2="15.5" />
  </>),
  task: (<>
    <rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M8 12.2l2.6 2.6L16 9.4" />
  </>),
  project: (<>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" /><line x1="9" y1="5" x2="9" y2="19" />
    <rect x="5.2" y="8" width="2.2" height="5" rx="0.6" fill="currentColor" stroke="none" />
    <rect x="11.5" y="8" width="6.5" height="2.2" rx="0.6" fill="currentColor" stroke="none" />
    <rect x="11.5" y="12.2" width="4.5" height="2.2" rx="0.6" fill="currentColor" stroke="none" />
  </>),
  meeting: (<>
    <path d="M4 5.5h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5L5 20v-3.9a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
    <circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </>),
  person: (<>
    <circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </>),
  org: (<>
    <path d="M5 21V4.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V21" /><path d="M15 9.5h3a1 1 0 0 1 1 1V21" />
    <line x1="3.5" y1="21" x2="20.5" y2="21" />
    <line x1="8" y1="7.5" x2="9.5" y2="7.5" /><line x1="11.5" y1="7.5" x2="13" y2="7.5" />
    <line x1="8" y1="11" x2="9.5" y2="11" /><line x1="11.5" y1="11" x2="13" y2="11" />
    <line x1="8" y1="14.5" x2="9.5" y2="14.5" /><line x1="11.5" y1="14.5" x2="13" y2="14.5" />
  </>),
  place: (<>
    <path d="M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21z" />
    <circle cx="12" cy="10.5" r="2.4" />
  </>),
  weblink: (<>
    <path d="M9.5 14.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14.5 9.5a3.5 3.5 0 0 0-5 0L7 12a3.5 3.5 0 0 0 5 5l1-1" />
  </>),
  workout: (<>
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
    <rect x="3.5" y="8.5" width="3" height="7" rx="1" /><rect x="17.5" y="8.5" width="3" height="7" rx="1" />
    <line x1="2.5" y1="9.5" x2="2.5" y2="14.5" /><line x1="21.5" y1="9.5" x2="21.5" y2="14.5" />
  </>),
  meal: (<>
    <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.2" />
  </>),
  habit: (<>
    <path d="M5 12a7 7 0 0 1 11.9-5" /><path d="M19 12a7 7 0 0 1-11.9 5" />
    <path d="M16.5 3.5V7h-3.5" /><path d="M7.5 20.5V17h3.5" />
  </>),
  tag: (<>
    <path d="M4 4.5h6.6a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-5.3 5.3a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7V4.5z" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </>),

  // ---- Nav / actions ----
  home: (<>
    <path d="M4 11l8-7 8 7" /><path d="M6 9.5V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
    <path d="M10 21v-5.5h4V21" />
  </>),
  calendar: (<>
    <rect x="4" y="5" width="16" height="15.5" rx="1.5" /><line x1="4" y1="9" x2="20" y2="9" />
    <line x1="8.5" y1="3.5" x2="8.5" y2="6.5" /><line x1="15.5" y1="3.5" x2="15.5" y2="6.5" />
    <rect x="7" y="12" width="3" height="3" rx="0.6" fill="currentColor" stroke="none" />
  </>),
  search: (<>
    <circle cx="11" cy="11" r="6.2" /><line x1="16" y1="16" x2="20.5" y2="20.5" />
  </>),
  plus: (<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>),
  settings: (
    <path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z
      M19.3 13a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.7 15a1.6 1.6 0 0 0-1.47-.97H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.7 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.7a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 15 4.7a1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.3 9v.04a1.6 1.6 0 0 0 1.47.96H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.6.97z" />
  ),
  sun: (<>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2.5" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21.5" y2="12" />
    <line x1="5.2" y1="5.2" x2="7" y2="7" /><line x1="17" y1="17" x2="18.8" y2="18.8" />
    <line x1="18.8" y1="5.2" x2="17" y2="7" /><line x1="7" y1="17" x2="5.2" y2="18.8" />
  </>),
  moon: (<path d="M20 14.2A8.2 8.2 0 1 1 9.8 4 6.4 6.4 0 0 0 20 14.2z" />),
  habits: (<>
    <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </>),
  bluf: (<>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" /><rect x="6" y="7.5" width="12" height="3" rx="0.6" fill="currentColor" stroke="none" />
    <line x1="6" y1="13" x2="11.5" y2="13" /><line x1="6" y1="15.5" x2="11.5" y2="15.5" />
    <rect x="13.5" y="13" width="4.5" height="3.5" rx="0.6" />
  </>),
  local: (<>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" /><line x1="8.5" y1="5" x2="8.5" y2="19" />
    <line x1="11" y1="8.5" x2="18" y2="8.5" /><line x1="11" y1="12" x2="18" y2="12" /><line x1="11" y1="15.5" x2="15.5" y2="15.5" />
    <line x1="6" y1="8.5" x2="6" y2="8.5" />
  </>),
  pomodoro: (<>
    <circle cx="12" cy="13.5" r="7.5" /><line x1="12" y1="13.5" x2="12" y2="9" />
    <path d="M9.5 3.5h5" /><line x1="12" y1="3.5" x2="12" y2="6" />
    <line x1="18" y1="6.5" x2="19.5" y2="5" />
  </>),
  health: (<path d="M3 12.5h3.5l1.8-4.5 3 9 2-6 1.3 3h4.4" />),
  sync: (<>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
    <path d="M20 4v4.5h-4.5" /><path d="M4 20v-4.5h4.5" />
  </>),
  share: (<>
    <path d="M12 15V3.5" /><path d="M7.5 8L12 3.5 16.5 8" />
    <path d="M6 11.5H4.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4.5 20.5h15A1.5 1.5 0 0 0 21 19v-6a1.5 1.5 0 0 0-1.5-1.5H18" />
  </>),
  palette: (<>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2.1-.9 2.1-2 0-1.1-.9-1.7-.9-2.7 0-.8.6-1.4 1.5-1.4H17a4 4 0 0 0 4-4c0-4.1-4-6.4-9-6.4z" />
    <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
  </>),
};

export function hasIcon(name?: string): boolean {
  return !!name && name in G;
}

/** The subset that are object-type glyphs (not nav/action names like "settings"
 *  or "home"). Type-glyph call sites use this so a custom type whose key happens
 *  to collide with a nav icon name doesn't silently borrow the wrong icon. */
const TYPE_ICON_KEYS = new Set([
  "daily", "note", "task", "project", "meeting", "person", "org",
  "place", "weblink", "workout", "meal", "habit", "tag",
]);
export function hasTypeIcon(name?: string): boolean {
  return !!name && TYPE_ICON_KEYS.has(name);
}

export default function Icon(props: {
  name: string;
  size?: number;
  color?: string;
  stroke?: number;
  className?: string;
  title?: string;
}) {
  const { name, size = 18, color, stroke = 1.7, className, title } = props;
  return (
    <svg
      className={`icon${className ? " " + className : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {G[name] ?? <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />}
    </svg>
  );
}
