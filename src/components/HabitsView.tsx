import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { ObjectIndex, AtlasObject, createObject, objectsOfType } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { Route } from "../lib/nav";
import { Settings } from "../lib/settings";
import { todayStamp, addDays } from "../lib/daily";
import {
  HabitDef, DayLog, habitDefs, readRangeLogs, setHabit, streakFor, STARTER_HABITS,
} from "../lib/habits";
import { MetricKey, Reading, readReadings, appendReading, metricPath } from "../lib/metrics";
import {
  Ambient, AMBIENT_LABELS, playAmbient, stopAmbient, setAmbientVolume, chime,
} from "../lib/ambient";
import { PickedImage } from "../lib/vision";
import { saveHealthImport, formatHealthHistory, WorkoutDraft, MealDraft, ImportExtras } from "../lib/healthImport";
import { placesWithCoords } from "../lib/geo";
import ImportModal from "./ImportModal";
import ProgressRing from "./ProgressRing";

/** The tracker: habits ticked into the daily note, timers with generated
 *  ambient sound, and weight / blood-pressure logs with charts. One screen,
 *  Swiss bones, color only where it carries meaning. */

const HISTORY_DAYS = 35;

export default function HabitsView(props: {
  profile: AtlasProfile;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  settings: Settings;
  onNavigate: (r: Route) => void;
  onRefreshObject: (path: string) => void;
  toast: (m: string) => void;
}) {
  const { profile } = props;
  const today = todayStamp();
  const habits = useMemo(() => habitDefs(props.index), [props.index]);
  const habitType = typeByKey(props.types, "habit")!;

  const datesDesc = useMemo(
    () => Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -i)),
    [today],
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const week = useMemo(() => {
    const selectedIndex = Math.max(0, datesDesc.indexOf(selectedDate));
    const weekStart = Math.floor(selectedIndex / 7) * 7;
    return datesDesc.slice(weekStart, weekStart + 7).reverse();
  }, [datesDesc, selectedDate]);

  const [logs, setLogs] = useState<Map<string, DayLog>>(new Map());
  const [weight, setWeight] = useState<Reading[]>([]);
  const [bp, setBp] = useState<Reading[]>([]);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [importing, setImporting] = useState<"workout" | "meal" | null>(null);

  const workouts = useMemo(
    () => objectsOfType(props.index, "workout")
      .sort((a, b) => ((a.props.date ?? "") < (b.props.date ?? "") ? 1 : -1)),
    [props.index],
  );
  const meals = useMemo(
    () => objectsOfType(props.index, "meal")
      .sort((a, b) => ((a.props.date ?? "") < (b.props.date ?? "") ? 1 : -1)),
    [props.index],
  );

  const reload = useCallback(async () => {
    setLogs(await readRangeLogs(profile, datesDesc));
    setWeight(await readReadings(profile, "weight"));
    setBp(await readReadings(profile, "bp"));
  }, [profile, datesDesc]);
  useEffect(() => { reload(); }, [reload]);

  const selectedLog = logs.get(selectedDate) ?? new Map();
  const doneCount = habits.filter((h) => selectedLog.get(h.name)?.done).length;
  const selectedDateLabel = selectedDate === today
    ? "Today"
    : new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "long", month: "short", day: "numeric",
    });

  const tick = async (h: HabitDef, done: boolean, minutes?: number, date = selectedDate) => {
    const path = await setHabit(profile, date, h.name, done, minutes);
    setLogs((cur) => {
      const next = new Map(cur);
      const day = new Map(next.get(date) ?? []);
      day.set(h.name, { done, minutes });
      next.set(date, day);
      return next;
    });
    props.onRefreshObject(path);
  };

  const addMetric = async (metric: MetricKey, text: string) => {
    const path = await appendReading(profile, metric, text);
    if (metric === "weight") setWeight(await readReadings(profile, "weight"));
    else setBp(await readReadings(profile, "bp"));
    props.onRefreshObject(path);
    props.toast("Reading logged");
  };

  const createHabit = async (name: string, kind: "check" | "timer", minutes?: number) => {
    const path = await createObject(profile, habitType, name, {
      kind, minutes: String(minutes ?? 15), order: String(habits.length + 1),
    });
    props.onRefreshObject(path);
  };

  /** Shared with the Meals/Workouts browsers — see lib/healthImport. */
  const saveImport = async (draft: WorkoutDraft | MealDraft, images: PickedImage[], extras: ImportExtras) => {
    const r = await saveHealthImport(profile, props.types, props.index, importing!, draft, images, extras, props.settings.openaiKey.trim());
    props.toast(importing === "workout"
      ? `Workout saved${r.exerciseTicked ? " — Exercise ticked" : ""}${r.placePath ? " · place created" : ""}`
      : `Meal saved${r.placePath ? " · place created" : ""}`);
    props.onRefreshObject(r.objectPath);
    if (r.habitNotePath) props.onRefreshObject(r.habitNotePath);
    if (r.placePath) props.onRefreshObject(r.placePath);
    await reload();
  };

  const addStarters = async () => {
    for (let i = 0; i < STARTER_HABITS.length; i++) {
      const s = STARTER_HABITS[i];
      const path = await createObject(profile, habitType, s.name, {
        kind: s.kind, minutes: String(s.minutes ?? 15), order: String(i + 1),
      });
      props.onRefreshObject(path);
    }
    props.toast("Starter habits added — edit them like any object");
  };

  return (
    <div className="page habits-page">
      <div className="habits-content">
      <div className="page-head browser-head">
        <div>
          <span className="eyebrow">
            <span style={{ color: habitType.color }}>◎</span> {doneCount} of {habits.length} / {selectedDateLabel}
          </span>
          <h1 className="page-title">Habits</h1>
        </div>
        <ProgressRing done={doneCount} total={habits.length} />
      </div>

      <WeekStrip week={week} today={today} selected={selectedDate} logs={logs} habits={habits}
        onPick={setSelectedDate} />

      <div className="habits-grid">
      <section className="cal-section">
        <div className="habit-day-head">
          <h3 className="eyebrow">{selectedDateLabel}</h3>
          <div className="habit-day-actions">
            {selectedDate !== today && (
              <button className="quick-chip" onClick={() => setSelectedDate(today)}>Today</button>
            )}
            <input
              className="input habit-date-input"
              type="date"
              min={datesDesc[datesDesc.length - 1]}
              max={today}
              value={selectedDate}
              aria-label="Habit date"
              onChange={(event) => event.target.value && setSelectedDate(event.target.value)}
            />
            <button className="quick-chip" onClick={() => props.onNavigate({ kind: "calendar", date: selectedDate })}>
              Open daily note
            </button>
          </div>
        </div>
        {habits.length === 0 && (
          <div className="cal-empty">
            <strong>No habits yet.</strong>
            <p style={{ marginBottom: 14 }}>Each habit is a markdown object; completions are a checklist in your daily note.</p>
            <button className="btn primary" onClick={addStarters}>Add my starter six</button>
          </div>
        )}
        {habits.map((h) => (
          <HabitRow
            key={h.path}
            habit={h}
            entry={selectedLog.get(h.name)}
            streak={streakFor(datesDesc, logs, h.name)}
            week={week}
            logs={logs}
            today={today}
            onTick={(done) => tick(h, done)}
            allowTimer={selectedDate === today}
            onStart={() => setTimer({ habit: h, date: selectedDate, total: h.minutes * 60, left: h.minutes * 60, running: true })}
            onOpen={() => props.onNavigate({ kind: "object", path: h.path })}
          />
        ))}
        {habits.length > 0 && <NewHabitForm onAdd={createHabit} />}
      </section>

      <section className="cal-section">
        <div className="section-head">
          <h3 className="eyebrow">Exercise</h3>
          <button className="quick-chip" onClick={() => setImporting("workout")}>+ Import workout from screenshot</button>
        </div>
        <ExerciseSection workouts={workouts} today={today}
          onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
      </section>

      <section className="cal-section">
        <div className="section-head">
          <h3 className="eyebrow">Food</h3>
          <button className="quick-chip" onClick={() => setImporting("meal")}>+ Import meal from photo</button>
        </div>
        <FoodSection meals={meals} today={today}
          onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
      </section>

      <section className="cal-section">
        <h3 className="eyebrow">Health</h3>
        <div className="metric-grid">
          <WeightCard readings={weight} onAdd={(t) => addMetric("weight", t)}
            onOpen={() => props.onNavigate({ kind: "object", path: metricPath(profile, "weight") })} />
          <BpCard readings={bp} onAdd={(t) => addMetric("bp", t)}
            onOpen={() => props.onNavigate({ kind: "object", path: metricPath(profile, "bp") })} />
        </div>
      </section>
      </div>
      </div>

      {importing && (
        <ImportModal
          kind={importing}
          openaiKey={props.settings.openaiKey.trim()}
          history={formatHealthHistory(props.index, importing)}
          places={placesWithCoords(props.index).map(({ obj, coords }) => ({ title: obj.title, lat: coords.lat, lon: coords.lon }))}
          onSave={saveImport}
          onClose={() => setImporting(null)}
        />
      )}

      {timer && (
        <TimerOverlay
          state={timer}
          setState={setTimer}
          onFinish={async (minutes) => {
            chime();
            await tick(timer.habit, true, minutes, timer.date);
            props.toast(`${timer.habit.name}: ${minutes}m — logged to ${timer.date === today ? "today" : timer.date}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

interface TimerState { habit: HabitDef; date: string; total: number; left: number; running: boolean; }


function WeekStrip(props: {
  week: string[]; today: string; selected: string; logs: Map<string, DayLog>; habits: HabitDef[];
  onPick: (date: string) => void;
}) {
  if (props.habits.length === 0) return null;
  return (
    <div className="week-strip">
      {props.week.map((d) => {
        const log = props.logs.get(d);
        const done = props.habits.filter((h) => log?.get(h.name)?.done).length;
        const pct = props.habits.length ? done / props.habits.length : 0;
        const dayNum = Number(d.slice(8));
        const wd = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d + "T12:00").getDay()];
        return (
          <button
            key={d}
            className={`week-day ${d === props.today ? "today" : ""} ${d === props.selected ? "selected" : ""}`}
            onClick={() => props.onPick(d)}
            title={`Edit ${d}: ${done}/${props.habits.length} complete`}
            aria-pressed={d === props.selected}
          >
            <span className="week-day-wd">{wd}</span>
            <span className="week-day-num">{dayNum}</span>
            <span className="week-day-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></span>
          </button>
        );
      })}
    </div>
  );
}

function HabitRow(props: {
  habit: HabitDef;
  entry?: { done: boolean; minutes?: number };
  streak: number;
  week: string[];
  logs: Map<string, DayLog>;
  today: string;
  allowTimer: boolean;
  onTick: (done: boolean) => void;
  onStart: () => void;
  onOpen: () => void;
}) {
  const { habit, entry } = props;
  const done = entry?.done ?? false;
  return (
    <div className={`habit-row ${done ? "done" : ""}`}>
      <button
        className={`habit-check ${done ? "on" : ""}`}
        onClick={() => props.onTick(!done)}
        title={done ? "Mark not done" : "Mark done"}
      >{done ? "✓" : ""}</button>
      <button className="habit-name" onClick={props.onOpen} title="Open habit object">
        {habit.name}
        {habit.kind === "timer" && <span className="habit-goal"> · {entry?.minutes ?? habit.minutes}m</span>}
      </button>
      <span className="habit-dots">
        {props.week.map((d) => {
          const dDone = props.logs.get(d)?.get(habit.name)?.done ?? false;
          return <span key={d} className={`habit-dot ${dDone ? "on" : ""} ${d === props.today ? "today" : ""}`} />;
        })}
      </span>
      {props.streak > 1 && <span className="habit-streak">{props.streak}d</span>}
      {habit.kind === "timer" && !done && props.allowTimer && (
        <button className="btn habit-start" onClick={props.onStart}>Start</button>
      )}
    </div>
  );
}

function NewHabitForm(props: { onAdd: (name: string, kind: "check" | "timer", minutes?: number) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"check" | "timer">("check");
  const [minutes, setMinutes] = useState(15);
  if (!open) {
    return <button className="quick-chip" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>+ Habit</button>;
  }
  const add = () => {
    if (!name.trim()) return;
    props.onAdd(name.trim(), kind, minutes);
    setName(""); setOpen(false);
  };
  return (
    <div className="new-habit">
      <input className="input" autoFocus placeholder="Habit name…" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setOpen(false); }} />
      <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "check" | "timer")}>
        <option value="check">check off</option>
        <option value="timer">timed</option>
      </select>
      {kind === "timer" && (
        <input className="input" type="number" min={1} max={180} value={minutes}
          style={{ width: 70 }} onChange={(e) => setMinutes(Number(e.target.value) || 15)} />
      )}
      <button className="btn primary" onClick={add} disabled={!name.trim()}>Add</button>
      <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/* ---------- timer ---------- */

function TimerOverlay(props: {
  state: TimerState;
  setState: (s: TimerState | null) => void;
  onFinish: (minutes: number) => void;
}) {
  const { state } = props;
  const [ambient, setAmbient] = useState<Ambient>("none");
  const [volume, setVolume] = useState(0.5);
  const finished = useRef(false);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      props.setState(state.left <= 1
        ? { ...state, left: 0, running: false }
        : { ...state, left: state.left - 1 });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // natural completion
  useEffect(() => {
    if (state.left === 0 && !finished.current) {
      finished.current = true;
      stopAmbient();
      props.onFinish(Math.max(1, Math.round(state.total / 60)));
      props.setState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.left]);

  useEffect(() => () => stopAmbient(), []);

  const mm = String(Math.floor(state.left / 60)).padStart(2, "0");
  const ss = String(state.left % 60).padStart(2, "0");
  const pct = 1 - state.left / state.total;
  const elapsedMin = Math.max(1, Math.ceil((state.total - state.left) / 60));

  const pick = (a: Ambient) => { setAmbient(a); playAmbient(a); };

  return (
    <div className="overlay timer-overlay">
      <div className="timer-card">
        <span className="eyebrow" style={{ color: "var(--signal)" }}>{state.habit.name}</span>
        <div className="timer-time">{mm}:{ss}</div>
        <div className="pomo-bar timer-bar"><div style={{ width: `${pct * 100}%` }} /></div>

        <div className="timer-sounds">
          {(Object.keys(AMBIENT_LABELS) as Ambient[]).map((a) => (
            <button key={a} className={`quick-chip ${ambient === a ? "rhythm" : ""}`} onClick={() => pick(a)}>
              {AMBIENT_LABELS[a]}
            </button>
          ))}
          <input
            className="timer-volume" type="range" min={0} max={1} step={0.05} value={volume}
            title="Volume"
            onChange={(e) => { const v = Number(e.target.value); setVolume(v); setAmbientVolume(v); }}
          />
        </div>

        <div className="timer-actions">
          <button className="btn" onClick={() => props.setState({ ...state, running: !state.running })}>
            {state.running ? "Pause" : "Resume"}
          </button>
          <button className="btn" onClick={() => props.setState({ ...state, total: state.total + 300, left: state.left + 300 })}>
            +5 min
          </button>
          <button className="btn signal" onClick={() => {
            finished.current = true;
            stopAmbient();
            props.onFinish(elapsedMin);
            props.setState(null);
          }}>Finish — {elapsedMin}m</button>
          <button className="btn" onClick={() => { stopAmbient(); props.setState(null); }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- exercise & food ---------- */

function ExerciseSection(props: { workouts: AtlasObject[]; today: string; onOpen: (path: string) => void }) {
  const weekStart = addDays(props.today, -6);
  const thisWeek = props.workouts.filter((w) => (w.props.date as string) >= weekStart);
  const mins = thisWeek.reduce((s, w) => s + (Number(w.props.duration) || 0), 0);
  const kcal = thisWeek.reduce((s, w) => s + (Number(w.props.energy) || 0), 0);

  const days = Array.from({ length: 14 }, (_, i) => addDays(props.today, i - 13));
  const perDay = days.map((d) =>
    props.workouts.filter((w) => w.props.date === d).reduce((s, w) => s + (Number(w.props.duration) || 0), 0));

  return (
    <div>
      {props.workouts.length === 0 ? (
        <p className="empty">No workouts yet — import a screenshot from your exercise app and Atlas reads it for you.</p>
      ) : (
        <>
          <div className="stat-chips">
            <span className="stat-chip"><strong>{thisWeek.length}</strong> this week</span>
            <span className="stat-chip"><strong>{mins}</strong> min</span>
            <span className="stat-chip"><strong>{kcal}</strong> kcal</span>
          </div>
          <BarChart values={perDay} labels={days.map((d) => d.slice(8))} unit="min" />
          {props.workouts.slice(0, 5).map((w) => (
            <button key={w.path} className="obj-row" onClick={() => props.onOpen(w.path)}>
              <span className="rail-glyph" style={{ color: "#b3443f" }}>↯</span>
              <span className="obj-row-title">{w.title}</span>
              <span className="obj-row-meta">
                {[w.props.duration && `${w.props.duration}m`, w.props.energy && `${w.props.energy} kcal`,
                  w.props.heart_rate && `${w.props.heart_rate} bpm`].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function FoodSection(props: { meals: AtlasObject[]; today: string; onOpen: (path: string) => void }) {
  const todayMeals = props.meals.filter((m) => m.props.date === props.today);
  const sum = (k: string) => todayMeals.reduce((s, m) => s + (Number(m.props[k]) || 0), 0);
  return (
    <div>
      {props.meals.length === 0 ? (
        <p className="empty">No meals yet — snap a photo or a nutrition-app screenshot and import it.</p>
      ) : (
        <>
          <div className="stat-chips">
            <span className="stat-chip"><strong>{sum("calories")}</strong> kcal today</span>
            <span className="stat-chip"><strong>{sum("protein")}</strong> g protein</span>
            <span className="stat-chip"><strong>{sum("carbs")}</strong> g carbs</span>
            <span className="stat-chip"><strong>{sum("fat")}</strong> g fat</span>
          </div>
          {props.meals.slice(0, 5).map((m) => (
            <button key={m.path} className="obj-row" onClick={() => props.onOpen(m.path)}>
              <span className="rail-glyph" style={{ color: "#7a8a3a" }}>◐</span>
              <span className="obj-row-title">{m.title}</span>
              <span className="obj-row-meta">
                {[m.props.calories && `${m.props.calories} kcal`, m.props.protein && `${m.props.protein}g protein`]
                  .filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function BarChart(props: { values: number[]; labels: string[]; unit: string }) {
  const H = 90, W = 320, PAD = 6;
  const max = Math.max(...props.values, 1);
  const bw = (W - PAD * 2) / props.values.length;
  return (
    <svg className="metric-chart bar-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--signal)" />
          <stop offset="100%" stopColor="var(--done)" />
        </linearGradient>
      </defs>
      {props.values.map((v, i) => {
        const h = (v / max) * (H - 26);
        return (
          <g key={i}>
            <rect
              x={PAD + i * bw + 1.5} y={H - 16 - h}
              width={bw - 3} height={Math.max(h, v > 0 ? 2 : 0)}
              fill={v > 0 ? "url(#barGrad)" : "var(--rule)"}
            />
            {v === 0 && <rect x={PAD + i * bw + 1.5} y={H - 17} width={bw - 3} height={1} fill="var(--rule)" />}
            <text x={PAD + i * bw + bw / 2} y={H - 4} textAnchor="middle" className="metric-chart-label">
              {props.labels[i]}
            </text>
          </g>
        );
      })}
      <text x={W - PAD} y={10} textAnchor="end" className="metric-chart-label">{max} {props.unit}</text>
    </svg>
  );
}

/* ---------- metrics ---------- */

function LineChart(props: {
  series: { points: number[]; color: string; area?: boolean }[];
  labels?: { min: string; max: string };
  height?: number;
}) {
  const H = props.height ?? 110, W = 320, PAD = 8;
  const all = props.series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="empty">Two readings make a line — add another.</p>;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number, n: number) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const gid = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;

  return (
    <svg className="metric-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={props.series[0].color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={props.series[0].color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {props.series.map((s, si) => {
        const pts = s.points.map((v, i) => `${x(i, s.points.length)},${y(v)}`).join(" ");
        const last = s.points[s.points.length - 1];
        return (
          <g key={si}>
            {s.area && (
              <polygon
                fill={`url(#${gid})`}
                points={`${PAD},${H - PAD} ${pts} ${x(s.points.length - 1, s.points.length)},${H - PAD}`}
              />
            )}
            <polyline fill="none" stroke={s.color} strokeWidth="2" points={pts} />
            <circle cx={x(s.points.length - 1, s.points.length)} cy={y(last)} r="3" fill={s.color} />
          </g>
        );
      })}
      <text x={W - PAD} y={y(max) + 4} textAnchor="end" className="metric-chart-label">{props.labels?.max ?? max}</text>
      <text x={W - PAD} y={y(min) + 4} textAnchor="end" className="metric-chart-label">{props.labels?.min ?? min}</text>
    </svg>
  );
}

function Delta(props: { now: number; prev: number; downIsGood?: boolean }) {
  const d = props.now - props.prev;
  if (Math.abs(d) < 0.001) return <span className="metric-delta flat">no change</span>;
  const good = props.downIsGood ? d < 0 : d > 0;
  return (
    <span className={`metric-delta ${good ? "good" : "bad"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(Math.round(d * 10) / 10)}
    </span>
  );
}

function WeightCard(props: { readings: Reading[]; onAdd: (text: string) => void; onOpen: () => void }) {
  const last = props.readings[props.readings.length - 1];
  const prev = props.readings[props.readings.length - 2];
  const unit = last?.text.replace(/[\d. ]+/g, "").trim() || "kg";
  const [val, setVal] = useState("");
  const [u, setU] = useState(unit);
  useEffect(() => setU(unit), [unit]);
  const add = () => {
    const n = parseFloat(val);
    if (!isFinite(n) || n <= 0) return;
    props.onAdd(`${n} ${u}`);
    setVal("");
  };
  const recent = props.readings.slice(-30);
  return (
    <div className="metric-card">
      <div className="metric-head">
        <button className="eyebrow metric-title" onClick={props.onOpen}>Weight</button>
        {last && prev && <Delta now={last.nums[0]} prev={prev.nums[0]} downIsGood />}
      </div>
      <div className="metric-value">
        {last ? <>{last.nums[0]}<span className="metric-unit"> {unit}</span></> : <span className="prop-empty">no readings</span>}
      </div>
      {last && <span className="metric-when">{last.date}{last.time ? ` · ${last.time}` : ""}</span>}
      <LineChart series={[{ points: recent.map((r) => r.nums[0]), color: "var(--calm)", area: true }]} />
      <div className="metric-input">
        <input className="input" type="number" step="0.1" placeholder="82.4" value={val}
          onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select className="input" style={{ width: 64 }} value={u} onChange={(e) => setU(e.target.value)}>
          <option value="kg">kg</option><option value="lb">lb</option>
        </select>
        <button className="btn" onClick={add} disabled={!val}>Log</button>
      </div>
    </div>
  );
}

function BpCard(props: { readings: Reading[]; onAdd: (text: string) => void; onOpen: () => void }) {
  const last = props.readings[props.readings.length - 1];
  const prev = props.readings[props.readings.length - 2];
  const [sys, setSys] = useState(""); const [dia, setDia] = useState(""); const [pulse, setPulse] = useState("");
  const add = () => {
    const s = parseInt(sys), d = parseInt(dia), p = parseInt(pulse);
    if (!isFinite(s) || !isFinite(d) || s <= 0 || d <= 0) return;
    props.onAdd(`${s}/${d}${isFinite(p) && p > 0 ? ` · ${p} bpm` : ""}`);
    setSys(""); setDia(""); setPulse("");
  };
  const recent = props.readings.slice(-30);
  return (
    <div className="metric-card">
      <div className="metric-head">
        <button className="eyebrow metric-title" onClick={props.onOpen}>Blood pressure</button>
        {last && prev && <Delta now={last.nums[0]} prev={prev.nums[0]} downIsGood />}
      </div>
      <div className="metric-value">
        {last
          ? <>{last.nums[0]}<span className="metric-unit">/</span>{last.nums[1]}
              {last.nums[2] && <span className="metric-unit"> · {last.nums[2]} bpm</span>}</>
          : <span className="prop-empty">no readings</span>}
      </div>
      {last && <span className="metric-when">{last.date}{last.time ? ` · ${last.time}` : ""}</span>}
      <LineChart series={[
        { points: recent.map((r) => r.nums[0]), color: "var(--signal)", area: true },
        { points: recent.map((r) => r.nums[1] ?? 0), color: "var(--calm)" },
      ]} />
      <div className="metric-legend">
        <span><i style={{ background: "var(--signal)" }} /> systolic</span>
        <span><i style={{ background: "var(--calm)" }} /> diastolic</span>
      </div>
      <div className="metric-input">
        <input className="input" type="number" placeholder="120" value={sys} onChange={(e) => setSys(e.target.value)} />
        <span className="metric-slash">/</span>
        <input className="input" type="number" placeholder="80" value={dia} onChange={(e) => setDia(e.target.value)} />
        <input className="input" type="number" placeholder="bpm" value={pulse}
          onChange={(e) => setPulse(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add} disabled={!sys || !dia}>Log</button>
      </div>
    </div>
  );
}
