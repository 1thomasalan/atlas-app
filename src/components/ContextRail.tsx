import { useCallback, useEffect, useMemo, useState } from "react";
import { ObjectIndex } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { AtlasProfile } from "../lib/atlasProfile";
import { Route } from "../lib/nav";
import { todayStamp } from "../lib/daily";
import { Task, loadAllTasks, completeTask } from "../lib/tasks";
import { logChange } from "../lib/changeLog";
import MiniMonth from "./MiniMonth";
import PropertiesPanel from "./PropertiesPanel";

/** The third column. The month calendar lives at the top on every screen —
 *  Capacities' always-there corner — and the space below answers the current
 *  view: object properties on object pages, and on Home an interactive task
 *  list you can filter, check off, open, and drive from the calendar. */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "overdue-today", label: "Overdue + Today" },
  { key: "overdue-week", label: "Overdue + Week" },
] as const;
type FilterKey = typeof FILTERS[number]["key"];

const dueOf = (t: Task) => (t.due ?? "").slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); return todayStamp(d);
};

export default function ContextRail(props: {
  route: Route;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  profile: AtlasProfile;
  openaiKey: string;
  briefName: string;
  onNavigate: (r: Route) => void;
  onRefreshObject: (path: string) => void;
  onRefreshIndex: () => void;
  toast: (m: string) => void;
}) {
  const { route, index } = props;
  const today = todayStamp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterKey>("overdue-today");
  const [taskDate, setTaskDate] = useState<string | null>(null);

  const onHome = route.kind === "home";
  const taskEnabled = Boolean(typeByKey(props.types, "task"));
  // The big month grid already shows the calendar, so the mini-month is
  // redundant there — hide it and surface the task list instead.
  const showMini = route.kind !== "calendar";
  const showTasks = taskEnabled && (onHome || route.kind === "calendar");
  const selected = route.kind === "calendar" ? (route.date ?? today) : onHome ? (taskDate ?? today) : today;
  const [cursor, setCursor] = useState(() => {
    const [y, m] = selected.split("-").map(Number);
    return { y, m: m - 1 };
  });

  // Follow the selected day to another month
  useEffect(() => {
    const [y, m] = selected.split("-").map(Number);
    setCursor({ y, m: m - 1 });
  }, [selected]);

  const reloadTasks = useCallback(async () => setTasks(await loadAllTasks(props.profile)), [props.profile]);
  useEffect(() => { if (showTasks) reloadTasks(); }, [showTasks, index, reloadTasks]);

  const onComplete = async (task: Task) => {
    try {
      const done = await completeTask(props.profile, task);
      logChange(props.profile, [task.path, done.path], "Completed a task from the Home rail.");
      await reloadTasks();
      props.onRefreshIndex();
      props.toast(`Done · ${task.title}`);
    } catch (e) {
      props.toast(`Couldn't complete: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };
  const onPickDay = (date: string) => {
    if (onHome) setTaskDate((d) => (d === date ? null : date));
    else props.onNavigate({ kind: "calendar", date });
  };

  return (
    <aside className="context-rail">
      {showMini && (
        <MiniMonth
          cursor={cursor}
          selected={selected}
          today={today}
          hasNote={(s) => index.all.some((o) => o.typeKey === "daily" && o.stem.startsWith(s))}
          onMove={(y, m) => setCursor({ y, m })}
          onPick={onPickDay}
        />
      )}

      {route.kind === "object" && (
        <PropertiesPanel
          index={index}
          types={props.types}
          profile={props.profile}
          path={route.path}
          openaiKey={props.openaiKey}
          onNavigate={props.onNavigate}
          onRefreshObject={props.onRefreshObject}
          onRefreshIndex={props.onRefreshIndex}
          toast={props.toast}
        />
      )}

      {showTasks && (
        <TaskRail
          tasks={tasks} today={today} taskDate={taskDate} filter={filter}
          onFilter={setFilter} onClearDate={() => setTaskDate(null)}
          onOpen={(path) => props.onNavigate({ kind: "object", path })}
          onComplete={onComplete}
        />
      )}
    </aside>
  );
}

function dueLabel(due: string | undefined, today: string): string {
  const d = (due ?? "").slice(0, 10);
  if (!d) return "";
  if (d < today) return "overdue";
  if (d === today) return "today";
  if (d === addDays(today, 1)) return "tomorrow";
  const dd = new Date(d + "T00:00:00");
  const diff = Math.round((dd.getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  return diff <= 6
    ? dd.toLocaleDateString(undefined, { weekday: "short" })
    : dd.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const dueClass = (due: string | undefined, today: string) => {
  const d = (due ?? "").slice(0, 10);
  return !d ? "" : d < today ? "overdue" : d === today ? "today" : "";
};

function TaskRail(props: {
  tasks: Task[]; today: string; taskDate: string | null; filter: FilterKey;
  onFilter: (f: FilterKey) => void; onClearDate: () => void;
  onOpen: (path: string) => void; onComplete: (t: Task) => void;
}) {
  const { tasks, today, taskDate, filter } = props;
  const weekEnd = useMemo(() => addDays(today, 6), [today]);

  const list = useMemo(() => {
    const active = tasks.filter((t) => t.lane !== "done");
    let r: Task[];
    if (taskDate) r = active.filter((t) => dueOf(t) === taskDate);
    else switch (filter) {
      case "overdue": r = active.filter((t) => dueOf(t) && dueOf(t) < today); break;
      case "today": r = active.filter((t) => dueOf(t) === today); break;
      case "overdue-today": r = active.filter((t) => dueOf(t) && dueOf(t) <= today); break;
      case "overdue-week": r = active.filter((t) => dueOf(t) && dueOf(t) <= weekEnd); break;
      default: r = active;
    }
    return [...r].sort((a, b) => {
      const da = dueOf(a) || "9999-99-99", db = dueOf(b) || "9999-99-99";
      return da !== db ? (da < db ? -1 : 1) : a.title.localeCompare(b.title);
    });
  }, [tasks, taskDate, filter, today, weekEnd]);

  const dateLabel = taskDate
    ? new Date(taskDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";

  return (
    <div className="rail-tasks">
      <div className="rail-tasks-head">
        <span className="eyebrow">{taskDate ? `Tasks · ${dateLabel}` : "Tasks"}<span className="rail-tasks-count">{list.length}</span></span>
        {taskDate && <button className="rail-tasks-clear" onClick={props.onClearDate} title="Back to filters">✕</button>}
      </div>

      {!taskDate && (
        <select className="rail-filter-select" value={filter} aria-label="Filter tasks"
          onChange={(e) => props.onFilter(e.target.value as FilterKey)}>
          {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      )}

      <div className="rail-task-list">
        {list.length === 0 ? (
          <p className="rail-task-empty">{taskDate ? "Nothing due this day." : "Nothing here — you're clear."}</p>
        ) : list.map((t) => (
          <div key={t.path} className="rail-task" onClick={() => props.onOpen(t.path)} title="Open task">
            <button className="rail-task-check" title="Mark done"
              onClick={(e) => { e.stopPropagation(); props.onComplete(t); }} />
            <div className="rail-task-body">
              <div className="rail-task-titlerow">
                {t.priority === "high" && <span className="rail-task-prio" title="High priority" />}
                <span className="rail-task-title">{t.title}</span>
              </div>
              {t.due && <span className={`rail-task-due ${dueClass(t.due, today)}`}>{dueLabel(t.due, today)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
