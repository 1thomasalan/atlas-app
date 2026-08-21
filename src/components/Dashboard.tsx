import { useEffect, useState, useCallback, useMemo } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { Settings } from "../lib/settings";
import { Task, loadAllTasks, completeTask } from "../lib/tasks";
import { listMarkdownIn } from "../lib/vault";
import { ObjectIndex, AtlasObject, objectsOfType } from "../lib/objects";
import { ObjectTypeDef, typeByKey } from "../lib/objectTypes";
import { todayStamp } from "../lib/daily";
import { HabitDef, DayLog, habitDefs, readDayLog, setHabit } from "../lib/habits";
import { Reading, readReadings } from "../lib/metrics";
import { NewsSnapshot, newsSnapshot } from "../lib/news";
import { loadBrief } from "../lib/dailybrief";
import { Weather } from "../lib/weather";
import { coverSrc, hostOf } from "../lib/unfurl";
import { aiDailyBriefing } from "../lib/assist";
import { ReviewKind } from "./ReviewFlow";
import { Route } from "../lib/nav";
import WeatherGlyph, { weatherKindOf } from "./WeatherGlyph";
import Icon from "./Icon";

/** Home is the morning glance: greeting, the day's numbers, habits, health,
 *  the two front pages, weather, the latest clip, and the vault at large —
 *  every tile a doorway into its section. */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const dateLine = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

export default function Dashboard(props: {
  profile: AtlasProfile;
  settings: Settings;
  index: ObjectIndex;
  types: ObjectTypeDef[];
  onStartReview: (k: ReviewKind) => void;
  onNavigate: (r: Route) => void;
  onProcessInbox: () => void;
  onRefreshObject: (path: string) => void;
  toast: (m: string) => void;
}) {
  const { profile, index } = props;
  const go = props.onNavigate;
  const today = todayStamp();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [captureCount, setCaptureCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [dayLog, setDayLog] = useState<DayLog>(new Map());
  const [weight, setWeight] = useState<Reading[]>([]);
  const [bp, setBp] = useState<Reading[]>([]);
  const [news, setNews] = useState<NewsSnapshot>({ brief: null, local: null, weather: null });
  const [briefSnap, setBriefSnap] = useState<{ title: string; date: string } | null>(null);
  const [briefWeather, setBriefWeather] = useState<Weather | null>(null);
  const [briefing, setBriefing] = useState("");
  const [briefingBusy, setBriefingBusy] = useState(false);

  const habits = useMemo(() => habitDefs(index), [index]);
  const taskEnabled = Boolean(typeByKey(props.types, "task"));
  const habitsEnabled = Boolean(typeByKey(props.types, "habit"));

  const refresh = useCallback(async () => {
    setTasks(await loadAllTasks(profile));
    setCaptureCount((await listMarkdownIn(profile.capture)).length);
    setReviewCount(
      (await listMarkdownIn(profile.review)).filter((p) => !p.endsWith("00-Review Queue.md")).length,
    );
    setDayLog(await readDayLog(profile, today));
    setWeight(await readReadings(profile, "weight"));
    setBp(await readReadings(profile, "bp"));
    setNews(await newsSnapshot(profile));
    const b = await loadBrief(profile);
    const lead = b ? (b.local?.items[0] ?? b.sections[0]?.items[0]) : undefined;
    setBriefSnap(b && lead ? { title: lead.title, date: b.date } : null);
    setBriefWeather(b?.weather ?? null);
  }, [profile, today]);

  useEffect(() => { refresh(); }, [refresh]);

  const active = tasks.filter((t) => t.lane !== "done");
  const topThree = active
    .filter((t) => t.top)
    .sort((a, b) => (a.top! < b.top! ? -1 : 1))
    .slice(0, 3);
  const todayTasks = active.filter((t) => t.lane === "today" && !t.top);

  const finish = async (t: Task) => {
    await completeTask(profile, t);
    props.toast(`Done: ${t.title}`);
    refresh();
  };

  const tickHabit = async (h: HabitDef) => {
    const done = !(dayLog.get(h.name)?.done ?? false);
    const path = await setHabit(profile, today, h.name, done);
    setDayLog((cur) => {
      const next = new Map(cur);
      next.set(h.name, { done });
      return next;
    });
    props.onRefreshObject(path);
  };

  const runBriefing = async () => {
    const key = props.settings.openaiKey.trim();
    if (!key) { props.toast("Add your OpenAI key in Settings for the briefing"); return; }
    setBriefingBusy(true);
    try {
      const dueSoon = active.filter((t) => t.due && t.due <= today);
      const recentDaily = objectsOfType(index, "daily")
        .filter((o) => /^\d{4}-\d{2}-\d{2}/.test(o.stem))
        .sort((a, b) => (a.stem < b.stem ? 1 : -1)).slice(0, 2);
      const ctx = [
        topThree.length ? "Top three today:\n" + topThree.map((t) => `- ${t.title}`).join("\n") : "",
        dueSoon.length ? "Due today/overdue:\n" + dueSoon.map((t) => `- ${t.title} (${t.due})`).join("\n") : "",
        "Waiting on:\n" + (active.filter((t) => t.lane === "waiting").map((t) => `- ${t.title}`).join("\n") || "- (nothing)"),
        "This week:\n" + active.filter((t) => t.lane === "week").slice(0, 8).map((t) => `- ${t.title}`).join("\n"),
        recentDaily.length ? "Recent daily notes:\n" + recentDaily.map((o) => `- ${o.stem}: ${o.excerpt.slice(0, 200)}`).join("\n") : "",
      ].filter(Boolean).join("\n\n");
      setBriefing(await aiDailyBriefing(key, ctx));
    } catch (err) {
      props.toast(`Briefing failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBriefingBusy(false);
    }
  };

  const hour = new Date().getHours();
  const suggested: ReviewKind = hour < 11 ? "morning" : hour < 16 ? "midday" : "evening";

  const habitsDone = habits.filter((h) => dayLog.get(h.name)?.done).length;
  const lastWeight = weight[weight.length - 1];
  const prevWeight = weight[weight.length - 2];
  const lastBp = bp[bp.length - 1];

  const latestLink = useMemo(() => {
    const links = objectsOfType(index, "weblink")
      .sort((a, b) => ((a.updated ?? a.created ?? "") < (b.updated ?? b.created ?? "") ? 1 : -1));
    return links[0] as AtlasObject | undefined;
  }, [index]);
  const linkCover = latestLink ? coverSrc(profile.root, latestLink.props.image) : undefined;

  const vaultTiles = (["person", "org", "project", "meeting", "note", "weblink"] as const)
    .map((key) => {
      const t = typeByKey(props.types, key);
      return t ? { t, count: objectsOfType(index, key).length } : null;
    })
    .filter(Boolean) as { t: ObjectTypeDef; count: number }[];

  return (
    <div className="page">
      <button className="eyebrow dash-date" onClick={() => go({ kind: "calendar" })}>
        {dateLine()} · {profile.isAtlas ? "Atlas vault" : "Markdown vault"} · open in calendar →
      </button>
      <h1 className="dash-greeting">
        {props.settings.userName.trim() ? `${greeting()}, ${props.settings.userName.trim()}.` : `${greeting()}.`}
      </h1>

      <div className="dash-stats">
        <Stat label="Capture inbox" num={captureCount} onClick={props.onProcessInbox} />
        <Stat label="Review queue" num={reviewCount} onClick={() => go({ kind: "calendar" })} />
        {taskEnabled && <Stat label="Today" num={topThree.length + todayTasks.length} onClick={() => go({ kind: "type", typeKey: "task" })} />}
        {taskEnabled && <Stat label="This week" num={active.filter((t) => t.lane === "week").length} onClick={() => go({ kind: "type", typeKey: "task" })} />}
        {taskEnabled && <Stat label="Waiting" num={active.filter((t) => t.lane === "waiting").length} onClick={() => go({ kind: "type", typeKey: "task" })} />}
      </div>

      <div className="dash-rhythm">
        <span className="eyebrow">Daily rhythm</span>
        {(["morning", "midday", "evening"] as ReviewKind[]).map((k) => (
          <button
            key={k}
            className={`quick-chip rhythm ${suggested === k ? "now" : ""}`}
            onClick={() => props.onStartReview(k)}
          >
            {k === "morning" ? "Morning review" : k === "midday" ? "Midday check" : "Evening recap"}
          </button>
        ))}
      </div>

      {props.settings.openaiKey.trim() && (
        <div className={`dash-brief ${briefing ? "has-text" : ""}`}>
          <div className="dash-brief-head">
            <span className="eyebrow" style={{ color: "var(--signal)" }}>✨ What needs me today</span>
            <button className="quick-chip" disabled={briefingBusy} onClick={runBriefing}>
              {briefingBusy ? "Thinking…" : briefing ? "Refresh" : "Brief me"}
            </button>
          </div>
          {briefing && <p className="dash-brief-text">{briefing}</p>}
        </div>
      )}

      <div className="dash-main">
        {/* ---- Focus ---- */}
        {taskEnabled && <section>
          <div className="signal-block" style={{ marginBottom: 18 }}>
            <span className="eyebrow">Focus lens</span>
            <strong style={{ fontSize: 19 }}>Top three priorities</strong>
          </div>
          {topThree.length === 0 && (
            <p className="empty">No top three set. Run the morning review to choose what today is actually about.</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topThree.map((t) => (
              <div key={t.path} className={`prio-card ${t.status === "done" ? "prio-done" : ""}`}>
                <span className="prio-num">0{t.top}</span>
                <button style={{ flex: 1, textAlign: "left" }} onClick={() => go({ kind: "object", path: t.path })}>
                  <div className="prio-title">{t.title}</div>
                  {t.project && <span className="eyebrow">{t.project.replace(/[\[\]]/g, "")}</span>}
                </button>
                <button className="btn" onClick={() => finish(t)}>Done</button>
              </div>
            ))}
          </div>
          {todayTasks.length > 0 && (
            <>
              <h3 style={{ margin: "20px 0 6px" }} className="eyebrow">Also today</h3>
              {todayTasks.map((t) => (
                <div key={t.path} className="task-row">
                  <button className="btn" style={{ padding: "3px 8px" }} onClick={() => finish(t)}>✓</button>
                  <button style={{ textAlign: "left" }} onClick={() => go({ kind: "object", path: t.path })}>{t.title}</button>
                  <span className="meta">{t.due ?? ""}</span>
                </div>
              ))}
            </>
          )}
        </section>}

        {/* ---- Habits + Health ---- */}
        {habitsEnabled && <div className="dash-row dash-row-2-1">
          <button className="dash-tile" onClick={() => go({ kind: "habits" })}>
            <span className="dash-tile-head">
              <span className="eyebrow"><Icon name="habits" size={14} color="var(--done)" /> Habits · {habitsDone}/{habits.length}</span>
              <span className="dash-tile-go">→</span>
            </span>
            {habits.length === 0
              ? <p className="empty">No habits yet — open the tracker to add your starter six.</p>
              : (
                <span className="dash-habits">
                  {habits.map((h) => {
                    const done = dayLog.get(h.name)?.done ?? false;
                    return (
                      <span
                        key={h.path}
                        role="button"
                        className={`dash-habit ${done ? "on" : ""}`}
                        title={done ? "Mark not done" : "Mark done"}
                        onClick={(e) => { e.stopPropagation(); tickHabit(h); }}
                      >
                        <i className="dash-habit-box">{done ? "✓" : ""}</i>
                        {h.name}
                      </span>
                    );
                  })}
                </span>
              )}
          </button>

          <button className="dash-tile" onClick={() => go({ kind: "habits" })}>
            <span className="dash-tile-head">
              <span className="eyebrow"><Icon name="health" size={14} color="#b3443f" /> Health</span>
              <span className="dash-tile-go">→</span>
            </span>
            <span className="dash-health">
              <span className="dash-health-item">
                <span className="eyebrow">Weight</span>
                <strong>{lastWeight ? lastWeight.nums[0] : "—"}<i>{lastWeight ? ` ${lastWeight.text.replace(/[\d. ]+/g, "")}` : ""}</i></strong>
                {lastWeight && prevWeight && (
                  <span className={`dash-delta ${lastWeight.nums[0] <= prevWeight.nums[0] ? "good" : "bad"}`}>
                    {lastWeight.nums[0] === prevWeight.nums[0] ? "—" : lastWeight.nums[0] < prevWeight.nums[0] ? "▼" : "▲"}
                    {Math.abs(Math.round((lastWeight.nums[0] - prevWeight.nums[0]) * 10) / 10) || ""}
                  </span>
                )}
              </span>
              <span className="dash-health-item">
                <span className="eyebrow">Blood pressure</span>
                <strong>{lastBp ? `${lastBp.nums[0]}/${lastBp.nums[1]}` : "—"}{lastBp?.nums[2] ? <i> · {lastBp.nums[2]} bpm</i> : null}</strong>
                <span className="dash-health-when">{lastBp ? lastBp.date : "no readings"}</span>
              </span>
            </span>
          </button>
        </div>}

        {/* ---- The wire ---- */}
        <div className="dash-row dash-row-3">
          <button className="dash-tile" onClick={() => go({ kind: "brief" })}>
            <span className="dash-tile-head">
              <span className="eyebrow" style={{ color: "var(--signal)" }}>
                {props.settings.briefName.trim() || "Daily Brief"}
              </span>
              <span className="dash-tile-go">→</span>
            </span>
            <span className="dash-headline">{briefSnap?.title ?? "No brief yet — open to fetch today's."}</span>
            {briefSnap?.date && <span className="dash-tile-meta">{briefSnap.date}</span>}
          </button>
          <button className="dash-tile" onClick={() => go({ kind: "local" })}>
            <span className="dash-tile-head">
              <span className="eyebrow">Local news</span>
              <span className="dash-tile-go">→</span>
            </span>
            <span className="dash-headline">{news.local?.title ?? "No local edition yet."}</span>
            {news.local?.date && <span className="dash-tile-meta">{news.local.date}</span>}
          </button>
          <button className="dash-tile" onClick={() => go({ kind: "brief" })}>
            <span className="dash-tile-head">
              <span className="eyebrow">Weather</span>
              <span className="dash-tile-go">→</span>
            </span>
            <span className="dash-weather-wrap">
              {briefWeather
                ? <>
                    <span className="dash-weather-emoji">{briefWeather.current.emoji}</span>
                    <span className="dash-weather">
                      {briefWeather.current.tempC}°C / {briefWeather.current.tempF}°F · {briefWeather.current.label}
                      {" · "}H {briefWeather.today.hiC}° L {briefWeather.today.loC}° · {briefWeather.location}
                    </span>
                  </>
                : <>
                    {weatherKindOf(news.weather) && <WeatherGlyph kind={weatherKindOf(news.weather)!} />}
                    <span className="dash-weather">{news.weather ?? "No weather yet — open the Daily Brief to fetch today's."}</span>
                  </>}
            </span>
          </button>
        </div>

        {/* ---- Latest clip + the vault ---- */}
        <div className="dash-row dash-row-2">
          <button
            className="dash-tile"
            onClick={() => latestLink ? go({ kind: "object", path: latestLink.path }) : go({ kind: "type", typeKey: "weblink" })}
          >
            <span className="dash-tile-head">
              <span className="eyebrow"><Icon name="weblink" size={14} color="#467fcf" /> Latest weblink</span>
              <span className="dash-tile-go">→</span>
            </span>
            {latestLink ? (
              <span className="dash-link">
                <span className="dash-link-text">
                  <span className="weblink-site">
                    {typeof latestLink.props.favicon === "string" && latestLink.props.favicon && (
                      <img className="weblink-favicon" src={latestLink.props.favicon} alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {(latestLink.props.site as string) ?? hostOf(latestLink.props.url) ?? "weblink"}
                  </span>
                  <span className="dash-headline">{latestLink.title}</span>
                </span>
                {linkCover && <img className="dash-link-thumb" src={linkCover} alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              </span>
            ) : (
              <p className="empty">Nothing clipped yet — paste a URL into ⌘N → Weblink.</p>
            )}
          </button>

          <div className="dash-tile dash-tile-static">
            <span className="dash-tile-head">
              <span className="eyebrow">The vault</span>
            </span>
            <span className="dash-vault">
              {vaultTiles.map(({ t, count }) => (
                <button key={t.key} className="dash-vault-item" onClick={() => go({ kind: "type", typeKey: t.key })}>
                  <span className="dash-vault-num">{count}</span>
                  <span className="dash-vault-label"><Icon name={t.key} size={15} color={t.color} /> {t.plural}</span>
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat(props: { label: string; num: number; onClick: () => void }) {
  return (
    <button className="dash-stat" onClick={props.onClick}>
      <span className="eyebrow">{props.label}</span>
      <div className="num">{props.num}</div>
    </button>
  );
}
