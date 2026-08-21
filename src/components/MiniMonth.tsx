import { todayStamp } from "../lib/daily";

/** The little month grid — Capacities keeps one in the corner at all times,
 *  so it's shared between Home and the Calendar. Monday-first, Swiss square. */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
export const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function MiniMonth(props: {
  cursor: { y: number; m: number };
  selected?: string;
  today: string;
  hasNote: (date: string) => boolean;
  onMove: (y: number, m: number) => void;
  onPick: (date: string) => void;
}) {
  const { y, m } = props.cursor;
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const cells: { date: string; inMonth: boolean }[] = [];
  const start = new Date(y, m, 1 - startOffset);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: todayStamp(d), inMonth: d.getMonth() === m });
  }

  return (
    <div className="mini-month">
      <div className="mini-head">
        <button className="tb-btn" onClick={() => props.onMove(m === 0 ? y - 1 : y, (m + 11) % 12)}>‹</button>
        <span className="mini-title">{MONTHS[m]} <span className="mini-year">{y}</span></span>
        <button className="tb-btn" onClick={() => props.onMove(m === 11 ? y + 1 : y, (m + 1) % 12)}>›</button>
      </div>
      <div className="mini-grid">
        {WEEKDAYS.map((w) => <span key={w} className="mini-dow">{w}</span>)}
        {cells.map((c) => (
          <button
            key={c.date}
            className={[
              "mini-day",
              c.inMonth ? "" : "out",
              c.date === props.selected ? "sel" : "",
              c.date === props.today ? "today" : "",
              props.hasNote(c.date) ? "noted" : "",
            ].join(" ")}
            onClick={() => props.onPick(c.date)}
          >
            {Number(c.date.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}
