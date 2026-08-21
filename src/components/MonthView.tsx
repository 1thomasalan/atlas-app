import { useMemo, useState } from "react";
import { AtlasProfile, LaneKey } from "../lib/atlasProfile";
import { ObjectIndex, AtlasObject } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { todayStamp } from "../lib/daily";
import { createTask } from "../lib/tasks";
import { logChange } from "../lib/changeLog";
import { Route } from "../lib/nav";

/** The month calendar: a full grid with each day's tasks (and meetings) shown
 *  in place. Double-click a day to open it; the + on a day adds a task due that
 *  day right from the grid. When you click "Calendar", you get a calendar. */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const laneForDue = (due: string, today: string): LaneKey => {
  if (due <= today) return "today";
  const diff = Math.round((parse(due).getTime() - parse(today).getTime()) / 86400000);
  return diff <= 7 ? "week" : "someday";
};

export default function MonthView(props: {
  profile: AtlasProfile;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  onNavigate: (r: Route) => void;
  onRefreshIndex: () => void;
  toast: (m: string) => void;
}) {
  const today = todayStamp();
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split("-").map(Number); return { y, m: m - 1 }; });
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Day → its tasks (by due) and meetings (by date), straight off the index.
  const byDate = useMemo(() => {
    const map = new Map<string, { task: AtlasObject[]; meeting: AtlasObject[] }>();
    const bucket = (d: string) => { let b = map.get(d); if (!b) { b = { task: [], meeting: [] }; map.set(d, b); } return b; };
    for (const o of props.index.all) {
      if (o.typeKey === "task" && o.props.status !== "done" && typeof o.props.due === "string") {
        bucket(o.props.due.slice(0, 10)).task.push(o);
      } else if (o.typeKey === "meeting" && typeof o.props.date === "string") {
        bucket(String(o.props.date).slice(0, 10)).meeting.push(o);
      }
    }
    return map;
  }, [props.index]);

  const { y, m } = cursor;
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const start = new Date(y, m, 1 - startOffset);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { date: todayStamp(d), inMonth: d.getMonth() === m, dow: (d.getDay() + 6) % 7 };
  });

  const move = (delta: number) => setCursor(({ y, m }) => {
    const nm = m + delta; return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });
  const goToday = () => { const [yy, mm] = today.split("-").map(Number); setCursor({ y: yy, m: mm - 1 }); };

  const openDay = (date: string) => props.onNavigate({ kind: "calendar", date });
  const beginAdd = (date: string) => { setAdding(date); setDraft(""); };
  const submitAdd = async (date: string) => {
    const title = draft.trim();
    setAdding(null); setDraft("");
    if (!title) return;
    try {
      const t = await createTask(props.profile, laneForDue(date, today), title, { due: date });
      logChange(props.profile, [t.path], "Added a task from the calendar.");
      props.onRefreshIndex();
      props.toast(`Task added · ${date}`);
    } catch (e) {
      props.toast(`Couldn't add task: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  return (
    <div className="page month-page">
      <div className="month-head">
        <div className="month-title-row">
          <h1 className="page-title month-title">{MONTHS[m]} <span className="month-year">{y}</span></h1>
          <div className="month-nav">
            <button className="btn" onClick={() => move(-1)} title="Previous month">‹</button>
            <button className="btn" onClick={goToday}>Today</button>
            <button className="btn" onClick={() => move(1)} title="Next month">›</button>
          </div>
        </div>
        <p className="month-hint">Double-click a day to open it · <span className="month-hint-plus">+</span> to add a task for that day</p>
      </div>

      <div className="month-grid">
        {WEEKDAYS.map((w) => <div key={w} className="month-dow">{w}</div>)}
        {cells.map((c) => {
          const items = byDate.get(c.date);
          const meetings = items?.meeting ?? [];
          const tasks = items?.task ?? [];
          const shown = [
            ...meetings.map((o) => ({ o, kind: "meeting" as const })),
            ...tasks.map((o) => ({ o, kind: "task" as const })),
          ].slice(0, 4);
          const more = meetings.length + tasks.length - shown.length;
          return (
            <div key={c.date}
              className={`month-cell ${c.inMonth ? "" : "out"} ${c.date === today ? "today" : ""} ${c.dow >= 5 ? "weekend" : ""}`}
              onDoubleClick={() => openDay(c.date)} title="Double-click to open this day">
              <div className="month-cell-head">
                <span className="month-day-num">{Number(c.date.slice(8))}</span>
                <button className="month-add" title="Add a task for this day"
                  onClick={(e) => { e.stopPropagation(); beginAdd(c.date); }}>+</button>
              </div>
              <div className="month-items">
                {shown.map(({ o, kind }) => {
                  const t = typeByKey(props.types, o.typeKey);
                  return (
                    <button key={o.path} className={`month-chip ${kind}`} title={o.title}
                      onClick={(e) => { e.stopPropagation(); props.onNavigate({ kind: "object", path: o.path }); }}>
                      <span className="month-chip-dot" style={{ background: t?.color ?? "var(--ink-3)" }} />
                      <span className="month-chip-text">{o.title}</span>
                    </button>
                  );
                })}
                {more > 0 && <button className="month-more" onClick={(e) => { e.stopPropagation(); openDay(c.date); }}>+{more} more</button>}
                {adding === c.date && (
                  <input className="month-add-input" autoFocus value={draft} placeholder="New task…"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAdd(c.date);
                      else if (e.key === "Escape") { setAdding(null); setDraft(""); }
                    }}
                    onBlur={() => submitAdd(c.date)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
