import { useMemo } from "react";
import { ObjectIndex, objectsOfType } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { Route } from "../lib/nav";
import { todayStamp } from "../lib/daily";
import CardCover from "./CardCover";

/** Every daily note as a card, newest first — Capacities' Daily Notes wall.
 *  Clicking a card opens that day in the calendar, where the note is
 *  editable in context. */

export default function DailyNotesView(props: {
  index: ObjectIndex;
  types: ObjectTypeDef[];
  vaultRoot: string;
  onNavigate: (r: Route) => void;
}) {
  const type = typeByKey(props.types, "daily");
  const today = todayStamp();

  const notes = useMemo(
    () => objectsOfType(props.index, "daily")
      .filter((o) => /^\d{4}-\d{2}-\d{2}/.test(o.stem))
      .sort((a, b) => (a.stem < b.stem ? 1 : -1)),
    [props.index],
  );

  const fmt = (stem: string) => {
    const [y, m, d] = stem.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return {
      weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
      long: date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };
  };

  return (
    <div className="page">
      <div className="page-head browser-head">
        <div>
          <span className="eyebrow">
            <span style={{ color: type?.color }}>{type?.icon ?? "◷"}</span>{" "}
            {notes.length} daily note{notes.length === 1 ? "" : "s"}
          </span>
          <h1 className="page-title">Daily Notes</h1>
        </div>
        <button className="btn primary" onClick={() => props.onNavigate({ kind: "calendar", date: today })}>
          Go to today
        </button>
      </div>

      {notes.length === 0 && (
        <div className="cal-empty" style={{ marginTop: 40 }}>
          <strong>No daily notes yet.</strong>
          <p>Open the calendar and press “+ Daily Note” — or run a morning review.</p>
        </div>
      )}

      <div className="obj-cards">
        {notes.map((o) => {
          const d = fmt(o.stem);
          const isToday = o.stem.slice(0, 10) === today;
          return (
            <button
              key={o.path}
              className="obj-card daily-card has-cover"
              onClick={() => props.onNavigate({ kind: "calendar", date: o.stem.slice(0, 10) })}
            >
              <CardCover vaultRoot={props.vaultRoot} image={o.props.image} type={type} title={o.title} />
              <span className="daily-card-weekday">
                {d.weekday}{isToday && <span className="daily-card-today"> · today</span>}
              </span>
              <span className="obj-card-title">{d.long}</span>
              {o.excerpt && <span className="obj-card-excerpt">{o.excerpt}</span>}
              <span className="obj-card-foot">
                {o.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
