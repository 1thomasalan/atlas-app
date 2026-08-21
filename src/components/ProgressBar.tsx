/** A slim Swiss progress meter: a hairline track with a filled segment in the
 *  type colour (or signal when overdue). Shared by Project cards and pages. */
export default function ProgressBar(props: {
  pct: number;
  color?: string;
  danger?: boolean;
  thin?: boolean;
}) {
  const raw = Math.round(props.pct);
  const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const fill = props.danger ? "var(--signal)" : props.color ?? "var(--done)";
  return (
    <span className={`progress-bar ${props.thin ? "thin" : ""} ${pct >= 100 ? "complete" : ""}`}>
      <span className="progress-bar-fill" style={{ width: pct + "%", background: fill }} />
    </span>
  );
}
