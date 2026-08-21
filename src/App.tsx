import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Settings, loadSettings, saveSettings, applyAppearance, DEFAULTS } from "./lib/settings";
import { setChatModel } from "./lib/aiModel";
import { nextTheme } from "./lib/themes";
import { AtlasProfile, detectProfile } from "./lib/atlasProfile";
import { pickVaultFolder, registerVault, join } from "./lib/vault";
import { todayStamp } from "./lib/daily";
import { ObjectTypeDef, loadAllTypes, loadCustomTypes, saveCustomTypes, typeByKey } from "./lib/objectTypes";
import { ObjectIndex, AtlasObject, buildIndex, createObject, loadObject, replaceInIndex, objectsOfType, setObjectProp } from "./lib/objects";
import { searchPhoto, savePhotoFromUrl, attachmentsFor } from "./lib/photos";
import { generateCover } from "./lib/imagegen";
import { generateDailyBrief, hasBriefToday } from "./lib/dailybrief";
import { unfurlIntoObject, writeDigest, fetchPageText, looksLikeUrl, hostOf } from "./lib/unfurl";
import { youtubeId, fetchYouTubeTranscript } from "./lib/youtube";
import { aiVideoDigest, aiPageDigest } from "./lib/assist";
import { EmbeddingCache, ensureEmbeddings, semanticSearch, SemanticHit } from "./lib/embeddings";
import { createTask } from "./lib/tasks";
import { Route, useHistory } from "./lib/nav";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import CalendarView from "./components/CalendarView";
import MonthView from "./components/MonthView";
import DailyNotesView from "./components/DailyNotesView";
import HabitsView from "./components/HabitsView";
import TypeBrowser from "./components/TypeBrowser";
import ObjectPage from "./components/ObjectPage";
import KanbanView from "./components/KanbanView";
import PomodoroView from "./components/PomodoroView";
import NewspaperView from "./components/NewspaperView";
import DailyBriefView from "./components/DailyBriefView";
import SettingsView from "./components/SettingsView";
import SearchModal from "./components/SearchModal";
import NewObjectModal from "./components/NewObjectModal";
import ImportModal from "./components/ImportModal";
import ContextRail from "./components/ContextRail";
import { saveHealthImport, formatHealthHistory } from "./lib/healthImport";
import { placesWithCoords } from "./lib/geo";
import { createPlaceObject } from "./lib/places";
import { runNutritionWeek } from "./lib/enhance";
import PlaceModal from "./components/PlaceModal";
import ReviewFlow, { ReviewKind } from "./components/ReviewFlow";
import InboxProcessingModal from "./components/InboxProcessingModal";
import { AgentSecretStatus, agentZeroTokenStatus, Processor } from "./lib/agentProcessing";
import { createObjectStudioRequest, ObjectStudioRequest } from "./lib/objectStudio";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [profile, setProfile] = useState<AtlasProfile | null>(null);
  const [types, setTypes] = useState<ObjectTypeDef[]>([]);
  const [customTypes, setCustomTypes] = useState<ObjectTypeDef[]>([]);
  const [index, setIndex] = useState<ObjectIndex | null>(null);
  const { route, push, back, forward, canBack, canForward } = useHistory({ kind: "home" });
  const [review, setReview] = useState<ReviewKind | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<null | { initialType?: string }>(null);
  const [importingHealth, setImportingHealth] = useState<"workout" | "meal" | null>(null);
  const [placeModalOpen, setPlaceModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [booted, setBooted] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefStatus, setBriefStatus] = useState("");
  const [briefVersion, setBriefVersion] = useState(0);
  const [processing, setProcessing] = useState<null | { preferredProcessor?: Processor }>(null);
  const [agentSecretStatus, setAgentSecretStatus] = useState<AgentSecretStatus>({ configured: false });

  const toastTimer = useRef<number>();
  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), ms);
  }, []);

  const loadVault = useCallback(async (p: AtlasProfile) => {
    const all = await loadAllTypes(p);
    setTypes(all);
    setCustomTypes(await loadCustomTypes(p));
    setIndex(await buildIndex(p, all));
  }, []);

  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      applyAppearance(s);
      setChatModel(s.chatModel);
      if (s.vaultPath) {
        try {
          const p = await detectProfile(s.vaultPath);
          setProfile(p);
          await loadVault(p);
        } catch { /* vault moved */ }
      }
      setBooted(true);
    })();
  }, [loadVault]);

  const refreshIndex = useCallback(async () => {
    if (profile && types.length) setIndex(await buildIndex(profile, types));
  }, [profile, types]);

  /** Cheap refresh after editing one file — no full vault rescan. */
  const refreshObject = useCallback(async (path: string) => {
    if (!profile || !types.length) return;
    const fresh = await loadObject(profile, types, path);
    setIndex((cur) => (cur ? replaceInIndex(cur, path, fresh) : cur));
  }, [profile, types]);

  /** Tells an open editor that its file changed on disk (enrichment etc.). */
  const [externalEdit, setExternalEdit] = useState({ path: "", n: 0 });
  const noteExternalEdit = useCallback((path: string) => {
    setExternalEdit((e) => ({ path, n: e.n + 1 }));
  }, []);

  /** Weekly nutrition coach → today's daily note, then open it. */
  const runNutritionCoach = useCallback(async () => {
    if (!profile || !index) return;
    const key = settings.openaiKey.trim();
    if (!key) { showToast("Add your OpenAI key in Settings for the coach"); return; }
    showToast("Reading this week's meals…");
    try {
      const r = await runNutritionWeek(key, profile, index);
      await refreshObject(r.notePath);
      noteExternalEdit(r.notePath);
      push({ kind: "calendar", date: undefined });
      showToast(r.toast);
    } catch (err) {
      showToast(`Coach failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [profile, index, settings.openaiKey, refreshObject, noteExternalEdit, push, showToast]);

  // ---- Embeddings: cached in .atlas/embeddings.json, synced in the background ----
  const embedCache = useRef<EmbeddingCache | null>(null);
  const embedBusy = useRef(false);
  // State mirror so the "Related" panel re-renders when a sync lands.
  const [embeddings, setEmbeddings] = useState<EmbeddingCache | null>(null);

  const syncEmbeddings = useCallback(async (announce = false): Promise<void> => {
    const key = settings.openaiKey.trim();
    if (!profile || !index || !key) {
      if (announce) showToast(key ? "Vault still indexing" : "Add your OpenAI key in Settings first");
      return;
    }
    if (embedBusy.current) {
      if (announce) showToast("Embedding sync already running…");
      return;
    }
    embedBusy.current = true;
    try {
      const r = await ensureEmbeddings(profile, index, key);
      embedCache.current = r.cache;
      setEmbeddings(r.cache);
      if (announce) {
        showToast(r.embedded
          ? `Embedded ${r.embedded} changed object${r.embedded === 1 ? "" : "s"} of ${r.total}`
          : `Embeddings up to date — ${r.total} objects`);
      }
    } catch (err) {
      console.error("Embedding sync failed:", err);
      if (announce) showToast(`Embeddings failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      embedBusy.current = false;
    }
  }, [profile, index, settings.openaiKey, showToast]);

  // One background sync when the vault finishes indexing
  const embedBooted = useRef(false);
  useEffect(() => {
    if (index && settings.openaiKey.trim() && !embedBooted.current) {
      embedBooted.current = true;
      syncEmbeddings();
    }
  }, [index, settings.openaiKey, syncEmbeddings]);

  // ---- Daily Brief: research today's weather + local + topic news once a day ----
  const runDailyBrief = useCallback(async (force: boolean) => {
    if (!profile || briefBusy) return;
    if (!settings.dailyBrief) { if (force) showToast("Turn on Daily Brief in Settings first"); return; }
    if (!settings.openaiKey.trim()) { if (force) showToast("Add your OpenAI key in Settings for the brief"); return; }
    setBriefBusy(true);
    setBriefStatus("Fetching today's brief…");
    try {
      const b = await generateDailyBrief(profile, settings, { onProgress: setBriefStatus });
      setBriefVersion((v) => v + 1);
      const n = (b.local ? b.local.items.length : 0) + b.sections.reduce((s, x) => s + x.items.length, 0);
      showToast(n ? `Today's brief is ready — ${n} stories` : "Brief ran, but nothing came back (check web-search access)");
    } catch (err) {
      showToast(`Brief failed: ${err instanceof Error ? err.message : "unknown"}`, 6000);
    } finally {
      setBriefBusy(false);
      setBriefStatus("");
    }
  }, [profile, settings, briefBusy, showToast]);

  // Auto-fetch on the first open of the day (once per app session)
  const briefBooted = useRef(false);
  useEffect(() => {
    if (!profile || !settings.dailyBrief || !settings.openaiKey.trim() || briefBooted.current) return;
    briefBooted.current = true;
    hasBriefToday(profile).then((has) => { if (!has) runDailyBrief(false); });
  }, [profile, settings.dailyBrief, settings.openaiKey, runDailyBrief]);

  const semantic = useCallback(async (query: string): Promise<SemanticHit[] | null> => {
    const key = settings.openaiKey.trim();
    if (!key || !embedCache.current || !index) return null;
    try { return await semanticSearch(key, embedCache.current, index, query); }
    catch { return null; }
  }, [settings.openaiKey, index]);

  // Keyboard handler is registered once; route the latest sync through a ref
  const syncRef = useRef(syncEmbeddings);
  useEffect(() => { syncRef.current = syncEmbeddings; }, [syncEmbeddings]);

  const updateSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    applyAppearance(next);
    setChatModel(next.chatModel);
    await saveSettings(next);
  }, []);

  const visibleTypes = useMemo(
    () => types.filter((type) => !settings.disabledTypeKeys.includes(type.key)),
    [types, settings.disabledTypeKeys],
  );

  const openProcessing = useCallback(async (preferredProcessor?: Processor) => {
    setAgentSecretStatus(await agentZeroTokenStatus());
    setProcessing({ preferredProcessor });
  }, []);

  const applyVaultPath = useCallback(async (path: string): Promise<boolean> => {
    try {
      await registerVault(path);
      const p = await detectProfile(path);
      setProfile(p);
      await loadVault(p);
      await updateSettings({ ...settings, vaultPath: path });
      showToast(p.isAtlas ? "Atlas vault detected" : "Vault connected");
      return true;
    } catch {
      showToast("That folder couldn't be opened — check the path");
      return false;
    }
  }, [settings, updateSettings, showToast, loadVault]);

  const chooseVault = useCallback(async () => {
    const path = await pickVaultFolder();
    if (!path) return;
    await applyVaultPath(path);
  }, [applyVaultPath]);

  const saveTypes = useCallback(async (next: ObjectTypeDef[]) => {
    if (!profile) return;
    setCustomTypes(next);
    await saveCustomTypes(profile, next);
    const all = await loadAllTypes(profile);
    setTypes(all);
    setIndex(await buildIndex(profile, all));
  }, [profile]);

  const createStudioRequest = useCallback(async (request: ObjectStudioRequest) => {
    if (!profile) return;
    const path = await createObjectStudioRequest(profile, request);
    await refreshObject(path);
    showToast(`Custom object request saved to Capture`);
    await openProcessing(request.preferredProcessor);
  }, [profile, refreshObject, showToast, openProcessing]);

  const createNew = useCallback(async (type: ObjectTypeDef, title: string) => {
    if (!profile) return;
    let path: string;
    if (type.special === "task") {
      path = (await createTask(profile, "week", title)).path; // lane semantics stay intact
    } else if (type.key === "weblink" && looksLikeUrl(title)) {
      // Paste a URL, get a bookmark: create immediately, enrich in the background
      const url = title.trim();
      path = await createObject(profile, type, hostOf(url) ?? "Weblink", { url }, "");
      setCreating(null);
      await refreshObject(path);
      push({ kind: "object", path });
      enrichWeblink(path, url);
      return;
    } else {
      path = await createObject(profile, type, title);
    }
    setCreating(null);
    await refreshIndex();
    push({ kind: "object", path });
    showToast(`${type.name} created in ${type.folder}`);
  }, [profile, refreshIndex, refreshObject, push, showToast]);

  /** Metadata + visuals for a weblink; for YouTube, also transcript → AI
   *  summary and steps. Fire-and-forget with its own toasts. */
  const enrichWeblink = useCallback(async (path: string, url: string) => {
    const wl = typeByKey(types, "weblink");
    if (!profile || !wl) return;

    // Stage 1 — metadata + visuals
    let title = hostOf(url) ?? "page";
    try {
      showToast("Fetching site info…");
      const u = await unfurlIntoObject(profile, path, url, wl.folder);
      if (u.title) title = u.title;
      await refreshObject(path);
      noteExternalEdit(path);
    } catch (err) {
      console.error("Unfurl failed:", err);
      showToast(`Preview failed: ${err instanceof Error ? err.message : "unknown error"}`, 7000);
      return;
    }

    const vid = youtubeId(url);
    const key = settings.openaiKey.trim();
    if (!key) { showToast("Preview fetched — add an OpenAI key for AI summaries", 5000); return; }

    // Stage 2 — source text: video transcript or readable page text
    let text: string | null = null;
    try {
      showToast(vid ? "Reading the video transcript…" : "Reading the page…");
      text = vid ? await fetchYouTubeTranscript(vid) : await fetchPageText(url);
    } catch (err) {
      console.error("Source text failed:", err);
      showToast(`Preview OK · ${vid ? "transcript" : "page read"} failed: ${err instanceof Error ? err.message : "unknown"}`, 7000);
      return;
    }
    if (vid && !text) { showToast("Preview fetched — this video has no captions", 5000); return; }
    if (!text || text.length < 400) { showToast("Preview fetched — not enough text to summarize", 5000); return; }

    // Stage 3 — AI digest into the body
    try {
      showToast(vid ? "Summarizing the transcript…" : "Summarizing the page…");
      if (vid) {
        const digest = await aiVideoDigest(key, title, text);
        await writeDigest(path, digest.summary, digest.steps, "Steps", true);
        showToast(digest.steps.length
          ? `Video summarized — ${digest.steps.length} steps captured`
          : "Video summarized");
      } else {
        const digest = await aiPageDigest(key, title, text);
        await writeDigest(path, digest.summary, digest.key_points, "Key points", false);
        showToast(`Page summarized — ${digest.key_points.length} key points`);
      }
      await refreshObject(path);
      noteExternalEdit(path);
    } catch (err) {
      console.error("Digest failed:", err);
      showToast(`Preview OK · summary failed: ${err instanceof Error ? err.message : "unknown"}`, 7000);
    }
  }, [profile, types, settings.openaiKey, refreshObject, noteExternalEdit, showToast]);

  /** Give a fitting web photo (Openverse → Wikipedia, downloaded into the vault)
   *  to every photo-less object in the set the browser is showing — scoped to
   *  the current search so it matches what's on screen. The per-object "Fetch"
   *  on the cover does one; this fills the visible gallery at once. */
  const fetchTypePhotos = useCallback(async (objs: AtlasObject[]) => {
    if (!profile) return;
    const targets = objs.filter((o) => !o.props.image);
    if (!targets.length) { showToast("Everything here already has a photo"); return; }
    showToast(`Finding ${targets.length} photo${targets.length === 1 ? "" : "s"}…`);
    let saved = 0, gen = 0;
    for (const o of targets) {
      const t = typeByKey(types, o.typeKey);
      if (!t) continue;
      try {
        const q = [o.title, o.props.location, o.props.org].filter(Boolean).map(String).join(" ");
        const url = await searchPhoto(q);
        if (url) {
          const stored = await savePhotoFromUrl(profile, attachmentsFor(t.folder), o.title, url);
          await setObjectProp(o.path, "image", stored);
          await refreshObject(o.path);
          if (stored !== url) saved++;   // count durable vault saves, not URL passthroughs
        } else {
          // No real photo — synthesize an abstract cover so it's not left blank.
          const { stored } = await generateCover(profile, t, o, settings.openaiKey.trim());
          await setObjectProp(o.path, "image", stored);
          await refreshObject(o.path);
          gen++;
        }
      } catch { /* skip this one */ }
    }
    const parts: string[] = [];
    if (saved) parts.push(`${saved} photo${saved === 1 ? "" : "s"}`);
    if (gen) parts.push(`${gen} generated cover${gen === 1 ? "" : "s"}`);
    showToast(parts.length ? `Added ${parts.join(" + ")} of ${targets.length}` : `Tried ${targets.length} — nothing landed`);
  }, [profile, types, settings.openaiKey, refreshObject, showToast]);

  /** Unfurl every weblink that still has no cover image. */
  const fetchAllPreviews = useCallback(async () => {
    if (!profile || !index) return;
    const wl = typeByKey(types, "weblink");
    if (!wl) return;
    const targets = objectsOfType(index, "weblink")
      .filter((o) => typeof o.props.url === "string" && o.props.url && !o.props.image);
    if (!targets.length) { showToast("Every weblink already has a preview"); return; }
    showToast(`Fetching ${targets.length} preview${targets.length === 1 ? "" : "s"}…`);
    let ok = 0;
    for (const o of targets) {
      try {
        await unfurlIntoObject(profile, o.path, o.props.url as string, wl.folder);
        await refreshObject(o.path);
        ok++;
      } catch { /* dead link — skip */ }
    }
    showToast(`Previews fetched: ${ok} of ${targets.length}`);
  }, [profile, index, types, refreshObject, showToast]);

  // ⌘K search, ⌘N new — the two Capacities reflexes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearching(true); syncRef.current(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); setCreating({}); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const crumb = useMemo(() => {
    if (!index) return "";
    switch (route.kind) {
      case "home": return "Home";
      case "calendar": return "Calendar";
      case "type": return typeByKey(types, route.typeKey)?.plural ?? route.typeKey;
      case "tag": return `# ${route.tag}`;
      case "habits": return "Habits";
      case "object": return index.byPath.get(route.path)?.title ?? route.path.split("/").pop()!.replace(/\.md$/, "");
      case "brief": return settings.briefName.trim() || "Daily Brief";
      case "local": return "Local News";
      case "pomodoro": return "Pomodoro";
      case "settings": return "Settings";
    }
  }, [route, index, types, settings.briefName]);

  if (!booted) return null;

  if (!profile) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "min(560px, 90vw)" }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 28 }}>
            ATLAS<span style={{ color: "var(--signal)" }}>.</span>
          </div>
          <div className="signal-block" style={{ marginBottom: 24 }}>
            <span className="eyebrow">First run</span>
            <p style={{ fontSize: 17, lineHeight: 1.5 }}>
              Point Atlas at your vault — the folder where your markdown files live.
              Atlas turns it into a studio of typed objects: pages, people, projects,
              meetings, daily notes. Your files stay plain markdown, fully
              Obsidian-compatible.
            </p>
          </div>
          <button className="btn primary" onClick={chooseVault}>Choose vault folder</button>
        </div>
      </div>
    );
  }

  const ready = index !== null;

  return (
    <div className="shell">
      <Sidebar
        route={route}
        onNavigate={push}
        onNew={() => setCreating({})}
        onSearch={() => { setSearching(true); syncEmbeddings(); }}
        types={visibleTypes}
        theme={settings.theme}
        onCycleTheme={() => updateSettings({ ...settings, theme: nextTheme(settings.theme) })}
        vaultName={profile.root.split("/").pop() ?? "vault"}
        onChangeVault={chooseVault}
        briefName={settings.dailyBrief ? (settings.briefName.trim() || "Daily Brief") : null}
      />
      <div className="main-col">
        <header className="topbar">
          <button className="topbar-btn" disabled={!canBack} onClick={back} title="Back">‹</button>
          <button className="topbar-btn" disabled={!canForward} onClick={forward} title="Forward">›</button>
          <span className="topbar-crumb">{crumb}</span>
          <button className="topbar-btn topbar-new" onClick={() => setCreating({})} title="New object (⌘N)">+</button>
        </header>
        <div className="content-row">
        <main className="main">
          {!ready && <div className="page"><p className="empty">Indexing vault…</p></div>}
          {ready && route.kind === "home" && (
            <Dashboard
              profile={profile} settings={settings} index={index} types={visibleTypes}
              onProcessInbox={() => openProcessing()}
              onStartReview={setReview} onNavigate={push} onRefreshObject={refreshObject} toast={showToast}
            />
          )}
          {ready && route.kind === "calendar" && (
            route.date
              ? <CalendarView
                  profile={profile} index={index} types={types} date={route.date}
                  onNavigate={push} onRefreshIndex={refreshIndex} onRefreshObject={refreshObject}
                  onStartReview={setReview} externalEdit={externalEdit}
                  openaiKey={settings.openaiKey.trim()} autoBrief={settings.autoBrief}
                  onExternalEdit={noteExternalEdit} toast={showToast}
                />
              : <MonthView
                  profile={profile} index={index} types={types}
                  onNavigate={push} onRefreshIndex={refreshIndex} toast={showToast}
                />
          )}
          {ready && route.kind === "type" && (
            typeByKey(types, route.typeKey)?.special === "task"
              ? <KanbanView profile={profile} settings={settings} index={index} onOpenTask={(p) => push({ kind: "object", path: p })} onRefreshIndex={refreshIndex} toast={showToast} />
              : typeByKey(types, route.typeKey)?.special === "daily"
                ? <DailyNotesView index={index} types={types} vaultRoot={profile.root} onNavigate={push} />
                : <TypeBrowser
                    index={index} types={types} typeKey={route.typeKey} vaultRoot={profile.root}
                    onNavigate={push} onNew={(t) => setCreating({ initialType: t })}
                    onFetchPreviews={fetchAllPreviews}
                    onFetchPhotos={fetchTypePhotos}
                    onImport={route.typeKey === "meal" || route.typeKey === "workout"
                      ? () => setImportingHealth(route.typeKey as "meal" | "workout")
                      : undefined}
                    onNewFromPhoto={route.typeKey === "place" ? () => setPlaceModalOpen(true) : undefined}
                    onCoach={route.typeKey === "meal" ? runNutritionCoach : undefined}
                  />
          )}
          {ready && route.kind === "tag" && (
            <TypeBrowser index={index} types={types} tag={route.tag} vaultRoot={profile.root} onNavigate={push} onNew={(t) => setCreating({ initialType: t })} />
          )}
          {ready && route.kind === "object" && (
            <ObjectPage
              profile={profile} index={index} types={types} path={route.path}
              openaiKey={settings.openaiKey.trim()} embeddings={embeddings}
              onNavigate={push} onRefreshIndex={refreshIndex} onRefreshObject={refreshObject}
              onEnrichWeblink={enrichWeblink} onExternalEdit={noteExternalEdit} externalEdit={externalEdit} toast={showToast}
            />
          )}
          {ready && route.kind === "habits" && (
            <HabitsView
              profile={profile} index={index} types={types} settings={settings}
              onNavigate={push} onRefreshObject={refreshObject} toast={showToast}
            />
          )}
          {route.kind === "brief" && (
            <DailyBriefView
              profile={profile} settings={settings}
              busy={briefBusy} status={briefStatus} version={briefVersion}
              onRefresh={() => runDailyBrief(true)} onNavigate={push}
            />
          )}
          {route.kind === "local" && <NewspaperView profile={profile} kind="local" />}
          {route.kind === "pomodoro" && <PomodoroView profile={profile} settings={settings} toast={showToast} />}
          {route.kind === "settings" && (
            <SettingsView
              settings={settings} onSave={updateSettings}
              allTypes={types}
              customTypes={customTypes} onSaveTypes={saveTypes}
              vaultPath={settings.vaultPath} onPickVault={chooseVault} onApplyVaultPath={applyVaultPath}
              onSyncEmbeddings={() => syncEmbeddings(true)}
              onOpenProcessing={() => openProcessing()}
              onCreateObjectRequest={createStudioRequest}
              toast={showToast}
            />
          )}
        </main>
        {ready && (
          <ContextRail
            route={route}
            index={index}
            types={visibleTypes}
            profile={profile}
            openaiKey={settings.openaiKey.trim()}
            briefName={settings.briefName.trim() || "Daily Brief"}
            onNavigate={push}
            onRefreshObject={refreshObject}
            onRefreshIndex={refreshIndex}
            toast={showToast}
          />
        )}
        </div>
      </div>

      {searching && index && (
        <SearchModal
          index={index} types={visibleTypes}
          semantic={settings.openaiKey.trim() ? semantic : undefined}
          onClose={() => setSearching(false)}
          onOpen={(o) => { setSearching(false); push({ kind: "object", path: o.path }); }}
          onCreate={(title) => {
            setSearching(false);
            const noteType = typeByKey(types, "note");
            if (noteType) createNew(noteType, title);
          }}
        />
      )}
      {creating && (
        <NewObjectModal
          types={visibleTypes}
          initialType={creating.initialType}
          onCreate={createNew}
          onClose={() => setCreating(null)}
        />
      )}
      {importingHealth && index && (
        <ImportModal
          kind={importingHealth}
          openaiKey={settings.openaiKey.trim()}
          history={formatHealthHistory(index, importingHealth)}
          places={placesWithCoords(index).map(({ obj, coords }) => ({ title: obj.title, lat: coords.lat, lon: coords.lon }))}
          onClose={() => setImportingHealth(null)}
          onSave={async (draft, images, extras) => {
            const r = await saveHealthImport(profile, types, index, importingHealth, draft, images, extras, settings.openaiKey.trim());
            await refreshObject(r.objectPath);
            if (r.habitNotePath) await refreshObject(r.habitNotePath);
            if (r.placePath) await refreshObject(r.placePath);
            showToast(importingHealth === "workout"
              ? `Workout saved${r.exerciseTicked ? " — Exercise ticked" : ""}${r.placePath ? " · place created" : ""}`
              : `Meal saved${r.placePath ? " · place created" : ""}`);
          }}
        />
      )}
      {placeModalOpen && profile && (
        <PlaceModal
          openaiKey={settings.openaiKey.trim()}
          onClose={() => setPlaceModalOpen(false)}
          onSave={async (data) => {
            const path = await createPlaceObject(profile, types, { ...data, openaiKey: settings.openaiKey.trim() || undefined });
            await refreshObject(path);
            push({ kind: "object", path });
            showToast(`Place created${settings.openaiKey.trim() ? " with AI profile" : ""}`);
          }}
        />
      )}
      {review && (
        <ReviewFlow kind={review} profile={profile} onClose={() => { setReview(null); refreshIndex(); noteExternalEdit(join(profile.capture, `${todayStamp()}.md`)); }} toast={showToast} />
      )}
      {processing && (
        <InboxProcessingModal
          vaultPath={profile.root}
          settings={settings}
          types={visibleTypes}
          tokenStatus={agentSecretStatus}
          preferredProcessor={processing.preferredProcessor}
          onClose={() => setProcessing(null)}
          onComplete={refreshIndex}
          toast={showToast}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      {briefBusy && route.kind !== "brief" && (
        <button className="brief-pill" onClick={() => push({ kind: "brief" })} title="Open the Daily Brief">
          <span className="brief-dot" /> {briefStatus || "Fetching today's brief…"}
        </button>
      )}
    </div>
  );
}
