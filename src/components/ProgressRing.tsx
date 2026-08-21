import { useId } from "react";

/** The habit completion ring (done/total) with a signal→done gradient. Shared
 *  by the Habits page header and the calendar day view. */
export default function ProgressRing(props: { done: number; total: number }) {
  const gid = useId();
  const pct = props.total ? props.done / props.total : 0;
  const R = 26, C = 2 * Math.PI * R;
  return (
    <svg className="habit-ring" width="72" height="72" viewBox="0 0 64 64">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--signal)" />
          <stop offset="100%" stopColor="var(--done)" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--rule)" strokeWidth="5" />
      <circle
        cx="32" cy="32" r={R} fill="none"
        stroke={`url(#${gid})`} strokeWidth="5" strokeLinecap="butt"
        strokeDasharray={`${C * pct} ${C}`}
        transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dasharray 400ms ease" }}
      />
      <text x="32" y="36" textAnchor="middle" className="habit-ring-text">
        {props.done}/{props.total}
      </text>
    </svg>
  );
}
