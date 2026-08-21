import { Route } from "../lib/nav";
import { ObjectTypeDef } from "../lib/objectTypes";
import { ThemeId, THEMES, nextTheme } from "../lib/themes";
import Icon, { hasTypeIcon } from "./Icon";

/** Capacities-inspired layout: workspace at top, then New / Search /
 *  Calendar, the object-type list, and the Atlas tools that survived the
 *  pivot. Mono uppercase section labels, orange active rule, line icons drawn
 *  from the shared Atlas set (custom types fall back to their glyph). */

/** A type's icon: the detailed SVG when one exists, else the type's glyph. */
function TypeGlyph(props: { typeKey: string; glyph: string; color?: string; size?: number }) {
  return (
    <span className="rail-glyph" style={{ color: props.color }}>
      {hasTypeIcon(props.typeKey)
        ? <Icon name={props.typeKey} size={props.size ?? 18} />
        : props.glyph}
    </span>
  );
}

export default function Sidebar(props: {
  route: Route;
  onNavigate: (r: Route) => void;
  onNew: () => void;
  onSearch: () => void;
  types: ObjectTypeDef[];
  theme: ThemeId;
  onCycleTheme: () => void;
  vaultName: string;
  onChangeVault: () => void;
  briefName: string | null;
}) {
  const { route } = props;
  const is = (k: Route["kind"]) => route.kind === k;
  const current = THEMES.find((t) => t.id === props.theme);
  const upcoming = THEMES.find((t) => t.id === nextTheme(props.theme));
  const habitsEnabled = props.types.some((type) => type.key === "habit");

  return (
    <nav className="rail">
      <button className="rail-workspace" onClick={props.onChangeVault} title="Switch vault">
        <span className="rail-logo">ATLAS<span className="dot">.</span></span>
        <span className="rail-vault">{props.vaultName}</span>
      </button>

      <div className="rail-nav">
        <button className="rail-btn rail-new" onClick={props.onNew}>
          <span className="rail-glyph" style={{ color: "var(--signal)" }}><Icon name="plus" size={18} /></span> New
          <kbd className="rail-kbd">⌘N</kbd>
        </button>
        <button className="rail-btn" onClick={props.onSearch}>
          <span className="rail-glyph"><Icon name="search" size={18} /></span> Search
          <kbd className="rail-kbd">⌘K</kbd>
        </button>
        <button className={`rail-btn ${is("home") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "home" })}>
          <span className="rail-glyph"><Icon name="home" size={18} /></span> Home
        </button>
        <button className={`rail-btn ${is("calendar") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "calendar" })}>
          <span className="rail-glyph"><Icon name="calendar" size={18} /></span> Calendar
        </button>
      </div>

      <div className="rail-section">
        <span className="rail-label">Object types</span>
        {[...props.types.filter((t) => t.key !== "habit")]
          .sort((a, b) => a.plural.localeCompare(b.plural))
          .map((t) => (
          <button
            key={t.key}
            className={`rail-btn ${route.kind === "type" && route.typeKey === t.key ? "active" : ""}`}
            onClick={() => props.onNavigate({ kind: "type", typeKey: t.key })}
          >
            <TypeGlyph typeKey={t.key} glyph={t.icon} color={t.color} />
            {t.plural}
          </button>
        ))}
      </div>

      <div className="rail-section">
        <span className="rail-label">Atlas</span>
        {habitsEnabled && (
          <button className={`rail-btn ${is("habits") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "habits" })}>
            <span className="rail-glyph" style={{ color: "var(--done)" }}><Icon name="habits" size={18} /></span> Habits
          </button>
        )}
        <button className={`rail-btn ${is("brief") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "brief" })}>
          <span className="rail-glyph"><Icon name="bluf" size={18} /></span> {props.briefName ?? "Daily Brief"}
        </button>
        <button className={`rail-btn ${is("local") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "local" })}>
          <span className="rail-glyph"><Icon name="local" size={18} /></span> Local News
        </button>
        <button className={`rail-btn ${is("pomodoro") ? "active" : ""}`} onClick={() => props.onNavigate({ kind: "pomodoro" })}>
          <span className="rail-glyph"><Icon name="pomodoro" size={18} /></span> Pomodoro
        </button>
      </div>

      <div className="rail-foot">
        <button
          className={`rail-icon-btn ${is("settings") ? "active" : ""}`}
          onClick={() => props.onNavigate({ kind: "settings" })}
          title="Settings"
          aria-label="Settings"
        >
          <Icon name="settings" size={20} />
        </button>
        <button
          className="rail-icon-btn"
          onClick={props.onCycleTheme}
          title={`Theme: ${current?.name ?? props.theme}${upcoming ? ` — click for ${upcoming.name}` : ""}`}
          aria-label="Cycle theme"
        >
          <Icon name="palette" size={20} />
        </button>
      </div>
    </nav>
  );
}
