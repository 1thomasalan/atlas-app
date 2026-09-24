import { useEffect, useState } from "react";
import { AtlasProfile } from "../lib/atlasProfile";
import { LocalNewsEdition, loadLocalNews } from "../lib/localnews";
import { Route } from "../lib/nav";
import { Settings } from "../lib/settings";
import { sharePublicationPdf } from "../lib/print";
import { NewsCard, WeatherStrip } from "./DailyBriefView";
import Icon from "./Icon";

const timezoneName = (): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
      .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value || "";
  } catch {
    return "";
  }
};

export default function LocalNewsView(props: {
  profile: AtlasProfile;
  settings: Settings;
  busy: boolean;
  status: string;
  version: number;
  onRefresh: () => void;
  onNavigate: (route: Route) => void;
}) {
  const [edition, setEdition] = useState<LocalNewsEdition | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadLocalNews(props.profile).then((next) => {
      if (alive) {
        setEdition(next);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [props.profile, props.version, reload]);

  const enabled = props.settings.localNews;
  const hasKey = !!props.settings.openaiKey.trim();
  const name = props.settings.localNewsName.trim() || edition?.name || "Local News";
  const location = props.settings.localNewsLocation.trim() || edition?.location || "Your community";
  const date = edition?.date ?? new Date().toISOString().slice(0, 10);
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const fullSections = edition?.sections.filter((section) => section.items.length > 1) ?? [];
  const singletonStories = edition?.sections
    .filter((section) => section.items.length === 1)
    .map((section) => section.items[0]) ?? [];
  const toSettings = () => props.onNavigate({ kind: "settings" });

  return (
    <div className="page paper">
      <div className="paper-inner">
        <div className="paper-toolbar">
          {props.busy && (
            <span className="paper-fetching">
              <span className="brief-dot" /> {props.status || "Refreshing local news..."}
            </span>
          )}
          {edition && (
            <button className="paper-btn paper-btn-secondary" title="Open the system PDF share sheet"
              onClick={() => {
                setPrintError("");
                sharePublicationPdf(`${name} - ${edition.edition} - ${date}`).catch((error) => setPrintError(error instanceof Error ? error.message : "PDF sharing failed."));
              }}>
              <Icon name="share" size={14} /> Share PDF
            </button>
          )}
          <button className="paper-btn paper-btn-secondary" disabled={props.busy} onClick={() => setReload((value) => value + 1)}>
            <Icon name="sync" size={14} /> Reload from disk
          </button>
          <button className="paper-btn" disabled={props.busy} onClick={props.onRefresh}>
            {!props.busy && <Icon name="sync" size={14} />}
            {props.busy ? "Refreshing..." : edition ? "Refresh edition" : "Create current edition"}
          </button>
        </div>
        {printError && <p className="paper-action-error">{printError}</p>}

        <header className="paper-masthead">
          <h1 className="paper-name">{name}</h1>
          <div className="paper-tagline">Local intelligence for {location}</div>
        </header>

        <div className="paper-dateline">
          <span className="paper-dl-side">{dateLabel}</span>
          <span className="paper-dl-mid">{edition ? `${edition.edition} edition` : "Current edition"}</span>
          <span className="paper-dl-side paper-dl-right">Digital Edition{timezoneName() ? ` · ${timezoneName()}` : ""}</span>
        </div>

        {!enabled && !edition && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">Local News is off</span>
            <p>Turn it on in <button className="linklike" onClick={toSettings}>Settings - Local News</button>, then choose the area and editorial focus.</p>
          </div>
        )}
        {enabled && !hasKey && !edition && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">Add your OpenAI key</span>
            <p>Native refresh uses web search through your OpenAI API key. Add it in <button className="linklike" onClick={toSettings}>Settings</button>.</p>
          </div>
        )}
        {enabled && hasKey && !loading && !edition && !props.busy && (
          <div className="paper-empty">
            <span className="paper-empty-eyebrow">No local edition yet</span>
            <p>Press <strong>Create current edition</strong> to research, verify, archive, and typeset it now.</p>
          </div>
        )}

        {edition && (
          <article className="news-body">
            {edition.weather && <WeatherStrip w={edition.weather} />}
            <h2 className="local-news-headline">{edition.headline}</h2>
            {edition.dek && <p className="news-lead local-news-dek">{edition.dek}</p>}

            {fullSections.map((section) => (
              <section key={section.title} className="news-section">
                <h2 className="news-section-head">{section.title}</h2>
                <div className="news-cards">
                  {section.items.map((item, index) => (
                    <NewsCard key={`${item.url}-${index}`} item={item} root={props.profile.root} />
                  ))}
                </div>
              </section>
            ))}

            {singletonStories.length > 0 && (
              <section className={`news-section news-roundup ${singletonStories.length === 1 ? "news-roundup-solo" : ""}`}>
                <div className="news-roundup-head">
                  <h2 className="news-section-head">Around Okinawa</h2>
                  <span>{singletonStories.map((item) => item.section).join(" / ")}</span>
                </div>
                <div className="news-cards news-cards-roundup">
                  {singletonStories.map((item, index) => (
                    <NewsCard key={`${item.url}-${index}`} item={item} root={props.profile.root} category={item.section} />
                  ))}
                </div>
              </section>
            )}

            {edition.events.length > 0 && (
              <section className="news-section local-events">
                <h2 className="news-section-head">Festival & Photo Story Watch</h2>
                <div className="news-cards">
                  {edition.events.map((item, index) => (
                    <NewsCard key={`${item.url}-${index}`} item={item} root={props.profile.root} />
                  ))}
                </div>
              </section>
            )}

            {edition.notes.length > 0 && (
              <section className="news-notes">
                <h2 className="news-section-head">Verification Notes</h2>
                {edition.notes.map((note, index) => <p key={index} className="news-note">{note}</p>)}
              </section>
            )}

            <p className="news-foot">
              Drafted {new Date(edition.generatedAt).toLocaleString()} · source-linked · archived as Markdown in your vault
            </p>
          </article>
        )}
      </div>
    </div>
  );
}
