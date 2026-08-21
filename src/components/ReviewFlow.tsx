import { useEffect, useState } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { Task, loadAllTasks, saveTask, moveTaskToLane } from "../lib/tasks";
import { appendToCapture, morningSection, middaySection, eveningSection } from "../lib/daily";

export type ReviewKind = "morning" | "midday" | "evening";

/** Three guided flows. Every one of them writes a section into today's
 *  capture note so the user's downstream Claude automation sees it. */

export default function ReviewFlow(props: {
  kind: ReviewKind;
  profile: AtlasProfile;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const { profile, kind } = props;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [picked, setPicked] = useState<string[]>([]); // task paths in top-three order
  const [note, setNote] = useState("");
  const [wins, setWins] = useState("");
  const [friction, setFriction] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAllTasks(profile).then((all) => {
      setTasks(all);
      if (kind !== "morning") {
        setPicked(all.filter((t) => t.top && t.lane !== "done").sort((a, b) => (a.top! < b.top! ? -1 : 1)).map((t) => t.path));
      }
    });
  }, [profile, kind]);

  const candidates = tasks
    .filter((t) => t.lane === "today" || t.lane === "week")
    .sort((a, b) => (a.lane === b.lane ? 0 : a.lane === "today" ? -1 : 1));

  const togglePick = (path: string) =>
    setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : p.length < 3 ? [...p, path] : p));

  const commit = async () => {
    setBusy(true);
    try {
      if (kind === "morning") {
        // Clear old top flags, set new ones, move picks into Today
        for (const t of tasks) {
          if (t.top && !picked.includes(t.path)) { t.top = undefined; await saveTask(t); }
        }
        const titles: string[] = [];
        for (let i = 0; i < picked.length; i++) {
          let t = tasks.find((x) => x.path === picked[i])!;
          if (t.lane !== "today") t = await moveTaskToLane(profile, t, "today");
          t.top = String(i + 1);
          await saveTask(t);
          titles.push(t.title);
        }
        await appendToCapture(profile, morningSection(titles, note));
      }

      if (kind === "midday") {
        const status = picked.map((p) => {
          const t = tasks.find((x) => x.path === p);
          return t ? `${t.title}: ${t.lane === "done" ? "done" : "in progress"}` : "";
        }).filter(Boolean);
        await appendToCapture(profile, middaySection(status, note));
      }

      if (kind === "evening") {
        const unfinished = tasks.filter((t) => t.lane === "today");
        const rolled: string[] = [];
        for (const t of unfinished) {
          await moveTaskToLane(profile, t, "week"); // roll forward into the active pool
          rolled.push(t.title);
        }
        await appendToCapture(profile, eveningSection(wins, friction, tomorrow, rolled));
      }

      props.toast("Logged to today's capture note");
      props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <span className="eyebrow" style={{ color: "var(--signal)" }}>
          {kind === "morning" ? "Start with clarity" : kind === "midday" ? "Course check" : "Close the day"}
        </span>
        <h2>{kind === "morning" ? "Morning review" : kind === "midday" ? "Midday check" : "Evening recap"}</h2>

        {kind === "morning" && (
          <>
            <p style={{ marginBottom: 14 }}>Pick up to three. These become today's top priorities — their files move to <code>01-Today</code>.</p>
            {candidates.length === 0 && <p className="empty">No tasks in Today or This Week. Add some on the Tasks board first.</p>}
            {candidates.map((t) => (
              <label key={t.path} className="pick-row" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={picked.includes(t.path)} onChange={() => togglePick(t.path)} />
                <span>{t.title}</span>
                {picked.includes(t.path) && <span className="top-badge">0{picked.indexOf(t.path) + 1}</span>}
              </label>
            ))}
            <div className="field" style={{ marginTop: 16 }}>
              <label className="eyebrow">Intent for the day (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}

        {kind === "midday" && (
          <>
            <p style={{ marginBottom: 14 }}>Sixty seconds. Are the top three still the right three?</p>
            {picked.length === 0 && <p className="empty">No top three set this morning.</p>}
            {picked.map((p, i) => {
              const t = tasks.find((x) => x.path === p);
              return t ? (
                <div key={p} className="pick-row">
                  <span className="top-badge" style={{ marginLeft: 0 }}>0{i + 1}</span>
                  <span>{t.title}</span>
                  <span style={{ marginLeft: "auto", color: "var(--ink-3)", fontSize: 12 }}>
                    {t.lane === "done" ? "done" : "open"}
                  </span>
                </div>
              ) : null;
            })}
            <div className="field" style={{ marginTop: 16 }}>
              <label className="eyebrow">Course correction (optional)</label>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="What changed, what you're dropping, what you're adding" />
            </div>
          </>
        )}

        {kind === "evening" && (
          <>
            <div className="field">
              <label className="eyebrow">What went well</label>
              <textarea className="input" value={wins} onChange={(e) => setWins(e.target.value)} />
            </div>
            <div className="field">
              <label className="eyebrow">Where the friction was</label>
              <textarea className="input" value={friction} onChange={(e) => setFriction(e.target.value)} />
            </div>
            <div className="field">
              <label className="eyebrow">What matters most tomorrow</label>
              <textarea className="input" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
            </div>
            <div className="signal-block" style={{ margin: "14px 0" }}>
              <span className="eyebrow">Roll forward</span>
              Unfinished tasks in Today will move back to This Week, ready for tomorrow's morning pick.
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="btn primary" onClick={commit} disabled={busy}>
            {busy ? "Writing…" : "Log it"}
          </button>
          <button className="btn" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
