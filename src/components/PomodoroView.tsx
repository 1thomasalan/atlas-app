import { useEffect, useRef, useState } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { Settings } from "../lib/settings";
import { appendToCapture, pomodoroSection } from "../lib/daily";

type Phase = "work" | "break";

export default function PomodoroView(props: { profile: AtlasProfile; settings: Settings; toast: (m: string) => void }) {
  const work = props.settings.pomodoroWork * 60;
  const rest = props.settings.pomodoroBreak * 60;
  const [phase, setPhase] = useState<Phase>("work");
  const [left, setLeft] = useState(work);
  const [running, setRunning] = useState(false);
  const [focus, setFocus] = useState("");
  const [sessions, setSessions] = useState(0);
  const tick = useRef<number>();

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => window.clearInterval(tick.current);
  }, [running]);

  useEffect(() => {
    if (left > 0) return;
    if (phase === "work") {
      setSessions((n) => n + 1);
      appendToCapture(props.profile, pomodoroSection(props.settings.pomodoroWork, focus))
        .then(() => props.toast("Session logged to today's capture note"));
      setPhase("break"); setLeft(rest);
    } else {
      setPhase("work"); setLeft(work);
    }
    // eslint-disable-next-line
  }, [left]);

  const total = phase === "work" ? work : rest;
  const mm = String(Math.floor(Math.max(left, 0) / 60)).padStart(2, "0");
  const ss = String(Math.max(left, 0) % 60).padStart(2, "0");

  return (
    <div className="page pomo">
      <span className="eyebrow">
        {phase === "work" ? "Focus" : "Break"} · {sessions} session{sessions === 1 ? "" : "s"} today
      </span>
      <div className="pomo-time">{mm}:{ss}</div>
      <div className="pomo-phase">
        <input
          className="input" style={{ width: 320, textAlign: "center" }}
          placeholder="What is this session for?"
          value={focus} onChange={(e) => setFocus(e.target.value)}
        />
      </div>
      <div className="pomo-bar"><div style={{ width: `${(1 - left / total) * 100}%` }} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn primary" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Start"}
        </button>
        <button className="btn" onClick={() => { setRunning(false); setPhase("work"); setLeft(work); }}>
          Reset
        </button>
      </div>
    </div>
  );
}
