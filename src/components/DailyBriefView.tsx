import { useEffect, useState, type MouseEvent } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { Settings } from "../lib/settings";
import { Route } from "../lib/nav";
import { coverSrc, hostOf } from "../lib/unfurl";
import { openExternal } from "../lib/open";
import { Weather } from "../lib/weather";
import { DailyBrief, BriefItem, BriefSection, loadBrief } from "../lib/dailybrief";
import { sharePublicationPdf } from "../lib/print";
import Icon from "./Icon";

/** The Daily Brief broadsheet: weather + local news + the user's topics, fetched
 *  once a day (App owns generation; this view typesets the cached result as a
 *  digital newspaper — masthead, dateline, BLUF lead, ruled story columns). */

const tzName = (): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
};

export default function DailyBriefView(props: {
  profile: AtlasProfile;
  settings: Settings;
  busy: boolean;
  status: string;
  version: number;
  onRefresh: () => void;
  onNavigate: (r: Route) => void;
}) {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadBrief(props.profile).then((b) => { if (alive) { setBrief(b); setLoading(false); } });
    return () => { alive = false; };
  }, [props.profile, props.version]);

  const name = props.settings.briefName.trim() || brief?.name || "Daily Brief";
  const dateStr = brief?.date || new Date().toISOString().slice(0, 10);
  const dateLabel = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const topics = props.settings.briefTopics.split(/[,\n;]+/).map((t) => t.trim()).filter(Boolean);
  const topicsLabel = (topics.join(" · ") || "Daily Intelligence Brief").toUpperCase();
  const enabled = props.settings.dailyBrief;
  const hasKey = !!props.settings.openaiKey.trim();
  const toSettings = () => props.onNavigate({ kind: "settings" });

  // Grouped by section — topics first, then local news. Same shape for every
  // reader; only the section names, content, and location vary.
  const sections: BriefSection[] = brief
    ? [...brief.sections, ...(brief.local ? [brief.local] : [])]
    : [];

  return (
    <div className="page paper">
      <div className="paper-inner">
        <div className="paper-toolbar">
          {props.busy && <span className="paper-fetching"><span className="brief-dot" /> {props.status || "Fetching today's news…"}</span>}
          {brief && (
            <button className="paper-btn paper-btn-secondary" title="Open the system PDF share sheet"
              onClick={() => {
                setPrintError("");
                sharePublicationPdf(`${name} - ${dateStr}`).catch((error) => setPrintError(error instanceof Error ? error.message : "PDF sharing failed."));
              }}>
              <Icon name="share" size={14} /> Share PDF
            </button>
          )}
          <button className="paper-btn" disabled={props.busy} onClick={props.onRefresh}>
            {!props.busy && <Icon name="sync" size={14} />}
            {props.busy ? "Fetching…" : brief ? "Refresh" : "Fetch today's brief"}
          </button>
        </div>
        {printError && <p className="paper-action-error">{printError}</p>}

        <header className="paper-masthead">
          <h1 className="paper-name">{name}</h1>
          <div className="paper-tagline">{topics.length ? "Technology Intelligence Brief" : "Your Daily Intelligence Brief"}</div>
        </header>

        <div className="paper-dateline">
          <span className="paper-dl-side">{dateLabel}</span>
          <span className="paper-dl-mid">{topicsLabel}</span>
          <span className="paper-dl-side paper-dl-right">Digital Edition{tzName() ? ` · ${tzName()}` : ""}</span>
        </div>

        {!enabled && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">The Daily Brief is off</span>
            <p>Turn it on in <button className="linklike" onClick={toSettings}>Settings → Daily Brief</button>, set your
              topics and location, and it fetches automatically the first time you open Atlas each day.</p>
          </div>
        )}
        {enabled && !hasKey && !brief && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">Add your OpenAI key</span>
            <p>The brief researches the day's news with your OpenAI key — add it in <button className="linklike" onClick={toSettings}>Settings</button>.</p>
          </div>
        )}
        {enabled && hasKey && !loading && !brief && !props.busy && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">No edition yet today</span>
            <p>Press <strong>Fetch today's brief</strong> to research and typeset it now.</p>
          </div>
        )}

        {brief && (
          <article className="news-body">
            {brief.weather && <WeatherStrip w={brief.weather} />}
            {brief.lead && <p className="news-lead">{brief.lead}</p>}

            {sections.map((s) => (
              <section key={s.title} className="news-section">
                <h2 className="news-section-head">{s.title}</h2>
                <div className="news-cards">
                  {s.items.map((item, i) => <NewsCard key={item.url + i} item={item} root={props.profile.root} />)}
                </div>
              </section>
            ))}

            {brief.notes.length > 0 && (
              <div className="news-notes">
                {brief.notes.map((n, i) => <p key={i} className="news-note">⚠ {n}</p>)}
              </div>
            )}
            <p className="news-foot">
              — Drafted {new Date(brief.generatedAt).toLocaleString()} · every item links to its source · saved locally, nothing published —
            </p>
          </article>
        )}
      </div>
    </div>
  );
}

export function WeatherStrip({ w }: { w: Weather }) {
  const condition = w.current.label.toLowerCase();
  const tone = /thunder|storm/.test(condition) ? "storm"
    : /rain|drizzle|shower/.test(condition) ? "rain"
      : /snow|freez/.test(condition) ? "snow"
        : /clear|sun/.test(condition) ? "clear"
          : "cloud";
  const symbol = tone === "storm" ? "⛈️" : tone === "rain" ? "🌧️"
    : tone === "snow" ? "❄️" : tone === "clear" ? "☀️" : "☁️";
  return (
    <section className={`news-weather weather-${tone}`} aria-label={`Weather for ${w.location}`}>
      <div className="news-weather-primary">
        <span className="news-weather-emoji" aria-hidden="true">{symbol}</span>
        <div className="news-weather-now">
          <span className="news-weather-kicker">Current conditions</span>
          <strong className="news-weather-temp">{w.current.tempC}°C</strong>
          <span className="news-weather-fahrenheit">{w.current.tempF}°F</span>
        </div>
        <div className="news-weather-place">
          <strong className="news-weather-loc">{w.location}</strong>
          <span>{w.current.label}</span>
          <span className="news-weather-outlook">Today: {w.today.label}</span>
        </div>
      </div>
      <div className="news-weather-metrics">
        <WeatherMetric label="High / Low" value={`${w.today.hiC}° / ${w.today.loC}°`} detail={`${w.today.hiF}°F / ${w.today.loF}°F`} />
        <WeatherMetric label="Feels like" value={`${w.current.feelsC}°C`} detail={`${w.current.feelsF}°F`} />
        <WeatherMetric label="Rain" value={w.today.precipPct == null ? "--" : `${w.today.precipPct}%`} detail="chance today" />
        <WeatherMetric label="Humidity" value={`${w.current.humidity}%`} detail="current" />
        <WeatherMetric label="Wind" value={`${w.current.windKph}`} detail="km/h" />
      </div>
    </section>
  );
}

function WeatherMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <span className="news-weather-metric">
      <span className="news-weather-metric-label">{label}</span>
      <strong>{value}</strong>
      <span>{detail}</span>
    </span>
  );
}

export function NewsCard({ item, root }: { item: BriefItem; root: string }) {
  const src = coverSrc(root, item.image);
  const open = (e: MouseEvent) => { e.preventDefault(); openExternal(item.url); };
  return (
    <article className="news-card">
      {src && (
        <a className="news-card-media" href={item.url} onClick={open} title="Open source ↗">
          <img src={src} alt="" loading="lazy"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
          {item.imageAi && <span className="ai-badge">AI-generated</span>}
          {!item.imageAi && item.imageGenerated && <span className="ai-badge">Generated artwork</span>}
        </a>
      )}
      <h3 className="news-card-title"><a href={item.url} onClick={open}>{item.title}</a></h3>
      {item.summary && <p className="news-card-why"><em>Why it matters:</em> {item.summary}</p>}
      {(item.venue || item.photoOpportunity || item.logistics) && (
        <div className="news-card-field-notes">
          {item.venue && <p><strong>Venue</strong><span>{item.venue}</span></p>}
          {item.photoOpportunity && <p className="news-card-photo-angle"><strong>Photo story angle</strong><span>{item.photoOpportunity}</span></p>}
          {item.logistics && <p><strong>Plan ahead</strong><span>{item.logistics}</span></p>}
        </div>
      )}
      <a className="news-card-src" href={item.url} onClick={open}>
        {item.source || hostOf(item.url) || "source"} ↗
        {item.date ? ` · ${item.date}` : ""}{item.time ? ` · ${item.time}` : ""}
      </a>
    </article>
  );
}
