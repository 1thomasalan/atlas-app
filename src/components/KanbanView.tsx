import { useCallback, useEffect, useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { AtlasProfile, LaneKey, LANE_LABELS } from "../lib/atlasProfile";
import { Task, loadAllTasks, createTask, moveTaskToLane, completeTask } from "../lib/tasks";
import { syncTodoist } from "../lib/todoist";
import { Settings } from "../lib/settings";
import { logChange } from "../lib/changeLog";
import { ObjectIndex, resolveLink } from "../lib/objects";

const LANES: LaneKey[] = ["today", "week", "waiting", "someday", "done"];

export default function KanbanView(props: {
  profile: AtlasProfile;
  settings: Settings;
  index: ObjectIndex;
  onOpenTask: (path: string) => void;
  onRefreshIndex: () => void;
  toast: (m: string) => void;
}) {
  const { profile } = props;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Drag starts after 6px of travel, so plain clicks and double-clicks
  // still reach the card (double-click opens the task's object page).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const refresh = useCallback(async () => setTasks(await loadAllTasks(profile)), [profile]);
  useEffect(() => { refresh(); }, [refresh]);

  // After a move / add / sync the task FILES move on disk — reload the board AND
  // rebuild the global index, or opening a relocated task 404s ("not in index").
  const reload = useCallback(async () => { await refresh(); props.onRefreshIndex(); }, [refresh, props]);

  // The project chip on a card opens the project it belongs to — resolve the
  // task's `project:` [[link]] (base name) to a real object and navigate there.
  const openProject = useCallback((rawProject: string) => {
    const name = rawProject.replace(/\[\[|\]\]|[#|].*$/g, "").trim();
    const hit = name ? resolveLink(props.index, name) : undefined;
    if (hit) props.onOpenTask(hit.path);
    else props.toast(`No project named “${name}” in the vault`);
  }, [props]);

  const onDragEnd = async (e: DragEndEvent) => {
    const lane = e.over?.id as LaneKey | undefined;
    const path = e.active.id as string;
    const task = tasks.find((t) => t.path === path);
    if (!lane || !task || task.lane === lane) return;
    if (lane === "done") {
      const done = await completeTask(profile, task);
      logChange(profile, [task.path, done.path], "Marked an Atlas task done from the board (file moved to the Done lane).");
      props.toast(`Done: ${task.title} — Todoist will close it on next sync`);
    } else {
      const moved = await moveTaskToLane(profile, task, lane);
      logChange(profile, [task.path, moved.path], `Moved an Atlas task to ${LANE_LABELS[lane]} from the board.`);
      props.toast(`Moved to ${LANE_LABELS[lane]} — file relocated`);
    }
    reload();
  };

  const add = async () => {
    if (!newTitle.trim()) return;
    const t = await createTask(profile, "week", newTitle.trim());
    logChange(profile, [t.path], "Created a quick task from the Atlas board.");
    setNewTitle("");
    reload();
  };

  const sync = async () => {
    if (!props.settings.todoistToken) {
      props.toast("Add your Todoist token in Settings first");
      return;
    }
    setSyncing(true);
    try {
      const r = await syncTodoist(profile, props.settings.todoistToken.trim());
      if (r.pulled + r.pushed + r.created + r.completed > 0) {
        logChange(
          profile,
          ["05-Tasks/", ".atlas/sync-state.json"],
          `Todoist sync: ${r.pulled} pulled, ${r.pushed + r.created} pushed, ${r.completed} completed` +
          (r.conflicts.length ? `, ${r.conflicts.length} conflicts (vault won)` : "") + ".",
        );
      }
      props.toast(
        `Synced — ${r.pulled} pulled, ${r.pushed + r.created} pushed, ${r.completed} completed` +
        (r.conflicts.length ? `, ${r.conflicts.length} conflicts (vault won)` : ""),
      );
      reload();
    } catch (err) {
      console.error("Todoist sync error:", err);
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      props.toast(`Sync failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <span className="eyebrow">05-Tasks · drag a card to move its file</span>
          <h1 className="page-title">Tasks</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input" style={{ width: 260 }}
            placeholder="New task → This Week"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn primary" onClick={add}>Add</button>
          <button className="btn" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Todoist"}
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban">
          {LANES.map((lane) => (
            <Lane key={lane} lane={lane} tasks={tasks.filter((t) => t.lane === lane)}
              onOpen={props.onOpenTask} onOpenProject={openProject} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Lane(props: { lane: LaneKey; tasks: Task[]; onOpen: (path: string) => void; onOpenProject: (raw: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.lane });
  const isDone = props.lane === "done";
  const visible = isDone
    ? [...props.tasks].sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, 12)
    : props.tasks;
  return (
    <div className={`lane ${isOver ? "drag-over" : ""} ${isDone ? "done-lane" : ""}`}>
      <div className="lane-head">
        <span className="eyebrow" style={{ color: "var(--ink)" }}>{LANE_LABELS[props.lane]}</span>
        <span className="lane-count">{props.tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="lane-body">
        {visible.map((t) => <Card key={t.path} task={t} onOpen={props.onOpen} onOpenProject={props.onOpenProject} />)}
        {props.tasks.length === 0 && (
          <p className="empty">{isDone ? "Drop a card here to complete it." : "Drop a card here."}</p>
        )}
        {isDone && props.tasks.length > visible.length && (
          <p className="empty">+ {props.tasks.length - visible.length} more in 06-Done</p>
        )}
      </div>
    </div>
  );
}

function Card(props: { task: Task; onOpen: (path: string) => void; onOpenProject: (raw: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: props.task.path });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10, position: "relative" as const }
    : undefined;
  const t = props.task;
  return (
    <div
      ref={setNodeRef} style={style} className="card" {...listeners} {...attributes}
      onDoubleClick={() => props.onOpen(t.path)}
      title="Drag to move · double-click to open"
    >
      <button
        className="card-open" title="Open task"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); props.onOpen(t.path); }}
      >↗</button>
      <div className="card-title">{t.top && <span style={{ color: "var(--signal)", fontFamily: "var(--font-mono)" }}>0{t.top} · </span>}{t.title}</div>
      <div className="card-meta">
        {t.due && <span className="chip">{t.due}</span>}
        {t.priority && <span className={`chip ${t.priority === "high" ? "high" : ""}`}>{t.priority}</span>}
        {t.project && (
          <button
            className="chip chip-link" title="Open project"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); props.onOpenProject(t.project!); }}
          >{t.project.replace(/\[\[|\]\]|[#|].*$/g, "")}</button>
        )}
        {t.todoistId && <span title="Synced with Todoist">⇄</span>}
      </div>
    </div>
  );
}
