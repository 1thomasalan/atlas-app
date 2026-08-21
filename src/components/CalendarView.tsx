import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { ObjectIndex, AtlasObject, createdOn, createObject, linkSuggestions } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { todayStamp } from "../lib/daily";
import { runMorningBriefing, hasBriefToday } from "../lib/briefing";
import { fileExists, writeFile, ensureDir, join } from "../lib/vault";
import { Route } from "../lib/nav";
import { ReviewKind } from "./ReviewFlow";
import { readDayLog, habitDefs, DayLog } from "../lib/habits";
import MarkdownEditor, { MarkdownEditorHandle } from "./editor/MarkdownEditor";
import ProgressRing from "./ProgressRing";
import Icon from "./Icon";

/** The Capacities calendar, Atlas edition: every day is an object, the daily
 *  note is the capture note your automations already read, and the daily
 *  rhythm reviews live right on today's page. */

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shiftDay = (s: string, days: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + days);
  return todayStamp(d);
};
const weekNumber = (date: Date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + 1) / 7);
};

export default function CalendarView(props: {
  profile: AtlasProfile;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  date?: string;
  onNavigate: (r: Route) => void;
  onRefreshIndex: () => void;
  onRefreshObject: (path: string) => void;
  onStartReview: (k: ReviewKind) => void;
  externalEdit?: { path: string; n: number };
  openaiKey: string;
  autoBrief: boolean;
  onExternalEdit: (path: string) => void;
  toast: (m: string) => void;
}) {
  const { profile, index } = props;
  const today = todayStamp();
  const [date, setDate] = useState(props.date ?? today);
  const [dailyPath, setDailyPath] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const briefTried = useRef("");

  useEffect(() => { if (props.date) setDate(props.date); }, [props.date]);

  const d = parse(date);
  const isToday = date === today;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const longDate = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const notePath = join(profile.capture, `${date}.md`);
  useEffect(() => {
    (async () => setDailyPath((await fileExists(notePath)) ? notePath : null))();
  }, [notePath]);

  // Habit awareness — a completion ring for the day, computed from the note's
  // `## Habits` checklist (which the day view itself hides; Habits owns it).
  const [habitLog, setHabitLog] = useState<DayLog>(new Map());
  const habits = useMemo(() => habitDefs(index), [index]);
  useEffect(() => { readDayLog(profile, date).then(setHabitLog).catch(() => setHabitLog(new Map())); }, [profile, date, index]);
  const habitsDone = habits.filter((h) => habitLog.get(h.name)?.done).length;

  // Morning auto-brief: the first time today's note is open in a session, write
  // a "what needs me today" section into it — once per day (the heading guards
  // re-runs), honoring the editor flush/pause rule so autosave can't clobber it.
  useEffect(() => {
    if (!isToday || !dailyPath || !props.autoBrief || !props.openaiKey) return;
    if (briefTried.current === today) return;
    briefTried.current = today;
    (async () => {
      if (await hasBriefToday(dailyPath)) return;   // already written today — no editor lock
      const ed = editorRef.current;   // the open daily-note editor instance, if mounted
      try {
        props.toast("Writing your morning brief…");
        await ed?.flush();
        ed?.pauseAutosave();
        const r = await runMorningBriefing(props.openaiKey, profile, index, dailyPath);
        props.onRefreshObject(dailyPath);
        if (r.wrote) { props.onExternalEdit(dailyPath); props.toast(r.toast); }
      } catch (err) {
        briefTried.current = "";   // let the next visit retry after a failure
        props.toast(`Brief failed: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        // Only re-enable the instance we actually paused; if the user switched
        // days mid-brief the editor now shows a different note (or is gone).
        if (editorRef.current === ed) ed?.resumeAutosave();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, dailyPath, today, props.autoBrief, props.openaiKey]);

  const createDaily = async () => {
    await ensureDir(profile.capture);
    await writeFile(notePath, `# Daily Capture — ${date}\n\n`);
    setDailyPath(notePath);
    props.onRefreshObject(notePath);
  };

  // Pull edits made on disk (Obsidian) into the open daily note. The file wins:
  // the editor reloads itself (pausing autosave so it can't clobber the pulled
  // content), and we re-index. Confirm before discarding any unsaved edits.
  const syncDaily = async () => {
    if (!dailyPath) return;
    if (editorRef.current?.isDirty() &&
        !window.confirm("You have unsaved edits in Atlas. Reload from the file on disk and discard them?")) return;
    await editorRef.current?.reloadFromDisk();
    props.onRefreshObject(dailyPath);
    props.toast("Synced from file");
  };

  const quickCreate = async (typeKey: string) => {
    const t = typeByKey(props.types, typeKey);
    if (!t) return;
    const title = `${t.name} ${date}`;
    const extra: Record<string, string> = { created: date };
    if (typeKey === "meeting") extra.date = date;
    if (typeKey === "task") extra.due = date;
    const path = await createObject(profile, t, title, extra);
    props.onRefreshObject(path);
    props.onNavigate({ kind: "object", path });
    props.toast(`${t.name} created in ${t.folder}`);
  };

  const created = useMemo(() => createdOn(index, date), [index, date]);
  const dueTasks = useMemo(
    () => index.all.filter((o) => o.typeKey === "task" && o.props.due === date && o.props.status !== "done"),
    [index, date],
  );

  const goto = (s: string) => props.onNavigate({ kind: "calendar", date: s });

  return (
    <div className="page cal-layout">
      <div className="cal-main">
        <div className="cal-controls">
          <button className="btn" onClick={() => props.onNavigate({ kind: "calendar" })} title="Back to the month">▦ Month</button>
          <span style={{ flex: "0 0 8px" }} />
          <button className="btn" onClick={() => goto(shiftDay(date, -1))} title="Previous day">‹</button>
          <button className="btn" onClick={() => goto(today)}>Today</button>
          <button className="btn" onClick={() => goto(shiftDay(date, 1))} title="Next day">›</button>
        </div>

        <div className="cal-head-row">
          <div>
            <span className="cal-weekday">{weekday}</span>
            <h1 className="page-title cal-date">
              {longDate}
              <span className="cal-week eyebrow">Week {weekNumber(d)}</span>
            </h1>
          </div>
          {habits.length > 0 && (
            <button className="cal-habit-ring" title={`${habitsDone} of ${habits.length} habits done · open Habits`}
              onClick={() => props.onNavigate({ kind: "habits" })}>
              <ProgressRing done={habitsDone} total={habits.length} />
              <span className="cal-habit-ring-label">Habits</span>
            </button>
          )}
        </div>

        <div className="cal-quick">
          <button className="quick-chip" onClick={() => quickCreate("meeting")}>+ ◉ Meeting</button>
          <button className="quick-chip" onClick={() => quickCreate("task")}>+ ☑ Task</button>
          <button className="quick-chip" onClick={() => quickCreate("note")}>+ ¶ Page</button>
          {isToday && (
            <>
              <span className="cal-quick-rule" />
              <button className="quick-chip rhythm" onClick={() => props.onStartReview("morning")}>Morning review</button>
              <button className="quick-chip rhythm" onClick={() => props.onStartReview("midday")}>Midday check</button>
              <button className="quick-chip rhythm" onClick={() => props.onStartReview("evening")}>Evening recap</button>
            </>
          )}
        </div>

        <section className="cal-section">
          <div className="section-head">
            <h3 className="eyebrow">Daily note</h3>
            {dailyPath && (
              <button className="tb-btn" onClick={syncDaily}
                title="Reload from disk — pulls in Obsidian edits and replaces any unsaved Atlas changes with the file's version">
                <Icon name="sync" size={13} /> Sync
              </button>
            )}
          </div>
          {dailyPath ? (
            <div className="cal-daily-editor">
              <MarkdownEditor
                ref={editorRef}
                path={dailyPath}
                reloadToken={props.externalEdit?.path === dailyPath ? props.externalEdit.n : undefined}
                minHeight={260}
                hideSections={["Habits"]}
                onLinkSearch={(q) => linkSuggestions(index, q, dailyPath ?? undefined).map((o) => ({ stem: o.stem, title: o.title, typeKey: o.typeKey }))}
                onSaved={(p) => props.onRefreshObject(p)}
                onOpenLink={(t) => openLink(t)}
              />
            </div>
          ) : (
            <button className="btn" onClick={createDaily}>+ Daily Note</button>
          )}
        </section>

        <hr className="cal-rule" />

        {dueTasks.length > 0 && (
          <section className="cal-section">
            <h3 className="eyebrow">Due this day · {dueTasks.length}</h3>
            {dueTasks.map((o) => (
              <ObjectRow key={o.path} o={o} types={props.types} onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
            ))}
          </section>
        )}

        <section className="cal-section">
          <h3 className="eyebrow">Created on this day · {created.length}</h3>
          {created.length === 0 && (
            <div className="cal-empty">
              <strong>There's nothing here (yet).</strong>
              <p>You can change this by creating a new object.</p>
            </div>
          )}
          {created.map((o) => (
            <ObjectRow key={o.path} o={o} types={props.types} onOpen={(p) => props.onNavigate({ kind: "object", path: p })} />
          ))}
        </section>
      </div>
    </div>
  );

  function openLink(target: string) {
    const hit = index.all.find(
      (o) => o.stem.toLowerCase() === target.toLowerCase() || o.title.toLowerCase() === target.toLowerCase(),
    );
    if (hit) props.onNavigate({ kind: "object", path: hit.path });
    else props.toast(`No object named “${target}” yet`);
  }
}
function ObjectRow(props: { o: AtlasObject; types: ObjectTypeDef[]; onOpen: (path: string) => void }) {
  const t = typeByKey(props.types, props.o.typeKey);
  return (
    <button className="obj-row" onClick={() => props.onOpen(props.o.path)}>
      <span className="rail-glyph" style={{ color: t?.color ?? "var(--ink-3)" }}>{t?.icon ?? "·"}</span>
      <span className="obj-row-title">{props.o.title}</span>
      <span className="obj-row-meta">{t?.name ?? "Markdown"}</span>
    </button>
  );
}
