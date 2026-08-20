const TASK_TABS = new Set(["today", "thisWeek", "waiting", "routines", "completed"]);

function readPreference(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePreference(key, value) {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // The Dashboard remains usable if browser storage is unavailable.
  }
}

const savedTaskTab = readPreference("atlas-task-tab", "thisWeek");
const AtlasApi = window.AtlasApi;

const state = {
  data: null,
  mode: "morning",
  taskTab: TASK_TABS.has(savedTaskTab) ? savedTaskTab : "thisWeek",
  activeRoutine: readPreference("atlas-active-routine"),
  activeTask: readPreference("atlas-active-task"),
  activeProject: "",
  todayOpen: readPreference("atlas-today-open") === "true",
  notes: {
    items: [],
    activePath: "",
    active: null,
    query: "",
    section: "",
    mode: "preview",
    dirty: false,
  },
  settings: {
    runtime: "browser",
    vaultPath: "",
    theme: readPreference("atlas-theme", "light"),
  },
};

const REQUEST_TYPES = {
  routine: {
    eyebrow: "Routine Studio",
    title: "Request a routine",
    label: "Routine request",
    intro: "Describe what you want to track and any initial entries. Atlas saves it to Capture for the next processing pass.",
    placeholder:
      "Example: Track weight metrics daily with separate Weight, Fat %, and BMI fields. Initial entry today: 231.6 lb, 28.4% fat, BMI 31.4.",
  },
  priority: {
    eyebrow: "Focus lens",
    title: "Request a priority change",
    label: "Priority request",
    intro: "Tell Atlas what to add, revise, or reconsider. The next processing pass will update tasks or prepare a review decision.",
    placeholder:
      "Example: Make the proposal follow-up my top priority this afternoon, and move the equipment checklist to tomorrow unless something changes.",
  },
  project: {
    eyebrow: "Active work",
    title: "Request a project update",
    label: "Project request",
    intro: "Describe the project change, note, next action, or new project. Atlas will process it into the right project shape.",
    placeholder:
      "Example: Add a project note to Atlas App: I want natural-language app requests to become part of the processing workflow.",
  },
  feature: {
    eyebrow: "Atlas App",
    title: "Request an app change",
    label: "App request",
    intro: "Describe the Atlas App change you want. Atlas saves it to Capture so the next processing pass can build or plan it.",
    placeholder:
      "Example: Add dark mode to the Dashboard with a simple toggle and remember my choice.",
  },
};

const MARKET_PLACEHOLDERS = [
  { symbol: "^DJI", label: "Dow", market: "New York", kind: "index" },
  { symbol: "^GSPC", label: "S&P 500", market: "New York", kind: "index" },
  { symbol: "^IXIC", label: "Nasdaq", market: "New York", kind: "index" },
  { symbol: "^N225", label: "Nikkei 225", market: "Tokyo", kind: "index" },
  { symbol: "^TOPX", label: "TOPIX", market: "Tokyo", kind: "index" },
  { symbol: "AAPL", label: "Apple", market: "Stock", kind: "equity" },
  { symbol: "JPY=X", label: "USD/JPY", market: "FX", kind: "currency" },
  { symbol: "TSLA", label: "Tesla", market: "Stock", kind: "equity" },
  { symbol: "INTC", label: "Intel", market: "Stock", kind: "equity" },
  { symbol: "QQQM", label: "QQQM", market: "ETF", kind: "fund" },
  { symbol: "VOO", label: "VOO", market: "ETF", kind: "fund" },
  { symbol: "ARKK", label: "ARKK", market: "ETF", kind: "fund" },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function obsidianUrl(relativePath) {
  const vaultName =
    (state.settings.vaultPath || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || "Atlas";
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

function resolvedTheme(theme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const selected = theme || "light";
  state.settings.theme = selected;
  document.documentElement.dataset.theme = resolvedTheme(selected);
  savePreference("atlas-theme", selected);
}

function renderSettings() {
  $("#settings-vault-path").value = state.settings.vaultPath || "";
  $("#vault-path-input").value = state.settings.vaultPath || "";
  $("#theme-select").value = state.settings.theme || "light";
}

function showVaultDialog() {
  renderSettings();
  if (!$("#vault-dialog").open) $("#vault-dialog").showModal();
}

async function saveVaultPath(vaultPath) {
  const cleaned = String(vaultPath || "").trim();
  if (!cleaned) {
    toast("Choose an Atlas folder first.");
    return null;
  }
  state.settings = await AtlasApi.setVaultFolder(cleaned);
  applyTheme(state.settings.theme);
  renderSettings();
  if ($("#vault-dialog").open) $("#vault-dialog").close();
  await loadDashboard();
  toast("Atlas folder saved.");
  return state.settings;
}

async function chooseVaultPath() {
  const settings = await AtlasApi.chooseVaultFolder();
  if (!settings) return;
  state.settings = settings;
  applyTheme(state.settings.theme);
  renderSettings();
  if ($("#vault-dialog").open) $("#vault-dialog").close();
  await loadDashboard();
  toast("Atlas folder saved.");
}

async function loadDashboard() {
  state.data = await AtlasApi.getDashboard();
  render();
  loadMarketTicker();
  loadWeather();
  if (state.activeRoutine && activeRoutine()) {
    renderRoutineDialog();
    if (!$("#routine-dialog").open) $("#routine-dialog").showModal();
  } else if (state.activeRoutine) {
    setActiveRoutine("");
  }
  if (state.todayOpen) {
    renderTodayDialog();
    if (!$("#today-dialog").open) $("#today-dialog").showModal();
  }
  if (state.activeTask && activeTask()) {
    renderTaskDialog();
    if (!$("#task-dialog").open) $("#task-dialog").showModal();
  } else if (state.activeTask) {
    setActiveTask("");
  }
}

function render() {
  renderDate();
  renderMode();
  renderStats();
  renderPriorities();
  renderInbox();
  renderProjects();
  renderTasks();
  renderRecent();
  syncTabs();
}

function renderDate() {
  const date = new Date(`${state.data.today}T00:00:00`);
  $("#weekday").textContent = date.toLocaleDateString("en-US", {
    weekday: "long",
  });
  $("#date-label").textContent = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

function salutation() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function renderWeather(weather = null) {
  const chip = $("#weather-chip");
  const temp = $("#weather-temp");
  const summary = $("#weather-summary");
  if (!weather || weather.temperature === null || weather.temperature === undefined) {
    chip.dataset.icon = weather?.icon || "cloud";
    temp.textContent = "--°";
    summary.textContent = weather?.summary || "Weather loading";
    return;
  }

  chip.dataset.icon = weather.icon || "cloud";
  temp.textContent = `${weather.temperature}°`;
  const range =
    weather.high !== null && weather.low !== null
      ? `H ${weather.high}° · L ${weather.low}°`
      : weather.apparent !== null
        ? `Feels ${weather.apparent}°`
        : weather.location || "Today";
  summary.textContent = `${weather.summary} · ${range}`;
}

async function loadWeather() {
  renderWeather();
  try {
    renderWeather(await AtlasApi.getWeather());
  } catch {
    renderWeather({ temperature: null, summary: "Weather unavailable", icon: "cloud" });
  }
}

function formatMarketPrice(item) {
  if (item.price === null || item.price === undefined || !Number.isFinite(Number(item.price))) {
    return "-";
  }
  const price = Number(item.price);
  const maximumFractionDigits = item.kind === "currency" ? 2 : price >= 1000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: item.kind === "currency" ? 2 : 0,
    maximumFractionDigits,
  }).format(price);
}

function formatMarketChange(item) {
  if (
    item.changePercent === null ||
    item.changePercent === undefined ||
    !Number.isFinite(Number(item.changePercent))
  ) {
    return "-";
  }
  const percent = Number(item.changePercent);
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function marketDirection(item) {
  const percent = Number(item.changePercent);
  if (!Number.isFinite(percent)) return "flat";
  if (percent > 0) return "up";
  if (percent < 0) return "down";
  return "flat";
}

function renderMarketTicker(items = MARKET_PLACEHOLDERS, status = "Live quotes loading") {
  const track = $("#market-ticker-track");
  const statusNode = $("#market-ticker-status");
  const displayItems = items.length ? items : MARKET_PLACEHOLDERS;
  const doubled = [...displayItems, ...displayItems];
  track.innerHTML = doubled
    .map((item) => {
      const direction = marketDirection(item);
      return `
        <span class="market-item" data-direction="${direction}" title="${escapeHtml(item.market || "")} ${escapeHtml(item.symbol || "")}">
          <span class="market-name">
            <strong>${escapeHtml(item.label || item.symbol)}</strong>
            <small>${escapeHtml(item.symbol || "")}</small>
          </span>
          <span class="market-price">${escapeHtml(formatMarketPrice(item))}</span>
          <span class="market-change">${escapeHtml(formatMarketChange(item))}</span>
        </span>
      `;
    })
    .join("");
  statusNode.textContent = status;
}

async function loadMarketTicker() {
  renderMarketTicker(MARKET_PLACEHOLDERS, "Live quotes loading");
  try {
    const data = await AtlasApi.getMarketTicker();
    const updated = data.generatedAt
      ? new Date(data.generatedAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
    renderMarketTicker(
      data.items || MARKET_PLACEHOLDERS,
      data.status ? "Market data unavailable" : updated ? `Quotes ${updated}` : "Live quotes",
    );
  } catch {
    renderMarketTicker(MARKET_PLACEHOLDERS, "Market data unavailable");
  }
}

function renderMode() {
  const modes = {
    morning: {
      kicker: "Start with clarity",
    },
    midday: {
      kicker: "Midday check-in",
    },
    evening: {
      kicker: "Close the loop",
    },
  };
  const mode = modes[state.mode] || modes.morning;
  $("#mode-kicker").textContent = mode.kicker;
  $("#hero-title").textContent = salutation();
  $("#task-panel-title").textContent =
    state.taskTab === "completed"
      ? "Completed"
      : state.taskTab === "waiting"
        ? "Waiting"
        : state.taskTab === "routines"
          ? "Routines"
        : state.taskTab === "today"
          ? "Today"
        : "This week";
}

function renderStats() {
  const stats = state.data.stats;
  $("#stat-notes").textContent = stats.totalNotes;
  $("#stat-relationships").textContent = stats.relationships;
  $("#relationship-detail").textContent =
    `${stats.people} people · ${stats.organizations} orgs · ${stats.interactions} ${stats.interactions === 1 ? "interaction" : "interactions"}`;
  $("#stat-capture").textContent = stats.captureToProcess;
  $("#stat-review").textContent = stats.reviewToDecide;
  $("#stat-projects").textContent = stats.activeProjects;
  $("#stat-tasks").textContent = stats.activeTasks;
  $("#task-detail").textContent =
    `${stats.waitingTasks} waiting · ${stats.activeRoutines} routine${stats.activeRoutines === 1 ? "" : "s"} · ${stats.completedTasks} completed`;
}

function renderPriorities() {
  const priorities = state.data.tasks.topThree;
  const manual = state.data.tasks.topThreeMode === "manual";
  $("#priority-mode-pill").textContent = manual ? "Your override" : "Atlas selected";
  $("#priority-list").innerHTML = priorities.length
    ? priorities
        .map(
          (task, index) => `
            <article class="priority-item">
              <span class="rank">0${index + 1}</span>
              <h4>${escapeHtml(task.title)}</h4>
              <p>${escapeHtml(task.summary || "Active Atlas task.")}</p>
              <span class="reason">${escapeHtml(task.reasons.join(" · "))}</span>
            </article>
          `,
        )
        .join("")
    : `<p class="panel-note">No active tasks. Atlas is giving you a little room.</p>`;

  renderFocusDialog();
}

function renderFocusDialog() {
  const tasks = state.data.tasks;
  const priorities = tasks.topThree;
  const selected = new Set(priorities.map((task) => task.relativePath));
  const explanationCards = priorities.length
    ? priorities
        .map(
          (task, index) => `
            <article class="dialog-priority">
              <strong>0${index + 1} · ${escapeHtml(task.title)}</strong>
              <dl class="priority-reasoning">
                <div><dt>Why now</dt><dd>${escapeHtml(task.explanation.whyNow)}</dd></div>
                <div><dt>If it waits</dt><dd>${escapeHtml(task.explanation.risk)}</dd></div>
                <div><dt>Next move</dt><dd>${escapeHtml(task.explanation.nextMove)}</dd></div>
              </dl>
            </article>
          `,
        )
        .join("")
    : `<p class="drawer-note">No active tasks need ranking right now.</p>`;
  const choices = tasks.topThreeCandidates.length
    ? tasks.topThreeCandidates
        .map(
          (task) => `
            <label class="top-three-choice">
              <input type="checkbox" name="topThree" value="${escapeHtml(task.relativePath)}" ${selected.has(task.relativePath) ? "checked" : ""} />
              <span>
                <strong>${escapeHtml(task.title)}</strong>
                <small>${escapeHtml(task.priority || "normal")}${task.due ? ` · Due ${escapeHtml(task.due)}` : ""}</small>
              </span>
            </label>
          `,
        )
        .join("")
    : `<p class="drawer-note">Add active tasks before shaping a Top Three.</p>`;

  $("#focus-dialog-list").innerHTML = `
    <p class="dialog-intro">Atlas chooses a default from live task signals. Override it when your judgment knows something the task metadata does not.</p>
    <div class="focus-explanation-list">${explanationCards}</div>
    <section class="focus-override">
      <div class="routine-section-heading">
        <h4>Adjust today's Top Three</h4>
        <span>${tasks.topThreeMode === "manual" ? "Your override is active" : "Atlas defaults are active"}</span>
      </div>
      <form id="top-three-form">
        <div class="top-three-choices">${choices}</div>
        <div class="focus-override-actions">
          <button class="primary-action compact-action" type="submit"><span class="button-icon">✓</span>Save override</button>
          <button class="quiet-action" type="button" data-reset-top-three>Use Atlas selection</button>
        </div>
      </form>
    </section>
  `;
}

function renderInbox() {
  const stats = state.data.stats;
  $("#flow-capture").textContent = stats.captureToProcess;
  $("#flow-review").textContent = stats.reviewToDecide;
  $("#flow-archive").textContent = stats.archivedReviews;
  $("#inbox-note").textContent =
    stats.reviewToDecide > 0
      ? `${stats.reviewToDecide} decision${stats.reviewToDecide === 1 ? "" : "s"} waiting in Review.`
      : "Review is clear. Capture naturally.";
  $("#review-link").href = obsidianUrl("01-Inbox/02-Review/00-Review Queue.md");
}

function renderProjects() {
  const visibleProjects = state.data.projects.slice(0, 4);
  $("#project-list").innerHTML = visibleProjects.length
    ? visibleProjects
        .map(
          (project) => `
            <article class="project-card">
              <button class="project-card-button" type="button" data-open-project="${escapeHtml(project.relativePath)}">
                <span class="project-topline">
                  <span>${escapeHtml(project.status)}</span>
                  <span class="project-detail-cue">Details</span>
                </span>
                <strong>${escapeHtml(project.title)}</strong>
                <small>${escapeHtml(project.summary || "Active Atlas project.")}</small>
              </button>
            </article>
          `,
        )
        .join("")
    : `<p class="empty-state">No active projects right now.</p>`;
}

function activeProject() {
  return state.data.projects.find((project) => project.relativePath === state.activeProject);
}

function renderProjectSectionBody(body) {
  const chunks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    chunks.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };

  body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("- ")) {
        list.push(`<li>${escapeHtml(line.slice(2))}</li>`);
        return;
      }
      flushList();
      chunks.push(`<p>${escapeHtml(line)}</p>`);
    });
  flushList();
  return chunks.join("");
}

function renderProjectDialog() {
  const project = activeProject();
  if (!project) {
    if ($("#project-dialog").open) $("#project-dialog").close();
    return;
  }
  const navigation = state.data.projects
    .map(
      (item) => `
        <button class="project-nav-button ${item.relativePath === project.relativePath ? "active" : ""}" type="button" data-open-project="${escapeHtml(item.relativePath)}">
          ${escapeHtml(item.title)}
        </button>
      `,
    )
    .join("");
  const sections = project.sections.length
    ? project.sections
        .map(
          (section) => `
            <section class="project-detail-section">
              <h4>${escapeHtml(section.title)}</h4>
              <div class="project-section-copy">${renderProjectSectionBody(section.body)}</div>
            </section>
          `,
        )
        .join("")
    : `<p class="drawer-note">This project does not have additional overview sections yet.</p>`;

  $("#project-dialog-content").innerHTML = `
    <header class="routine-drawer-header">
      <p class="eyebrow">Project highlights</p>
      <h3>${escapeHtml(project.title)}</h3>
      <p>${escapeHtml(project.summary || "Active Atlas project.")}</p>
      <div class="routine-badges">
        <span>${escapeHtml(project.status)}</span>
      </div>
    </header>

    <nav class="project-nav" aria-label="Active projects">${navigation}</nav>
    <div class="project-details">${sections}</div>

    <footer class="routine-drawer-footer">
      <a class="secondary-action drawer-link" href="${obsidianUrl(project.relativePath)}">Open Markdown</a>
      <button class="secondary-action" type="button" data-request-kind="project" data-request-prefill="For ${escapeHtml(project.title)}: ">Request project change</button>
    </footer>
  `;
}

function openProject(relativePath = state.data.projects[0]?.relativePath) {
  if (!relativePath) {
    toast("No active projects right now.");
    return;
  }
  state.activeProject = relativePath;
  renderProjectDialog();
  if (!$("#project-dialog").open) $("#project-dialog").showModal();
}

function taskRowActions(task) {
  if (task.bucket === "this-week") {
    return `<button class="task-move" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="today" aria-label="Move ${escapeHtml(task.title)} to Today" title="Move to Today">Today</button>`;
  }
  if (task.bucket === "today") {
    return `<button class="task-move" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="this-week" aria-label="Defer ${escapeHtml(task.title)} to This Week" title="Defer to This Week">Week</button>`;
  }
  if (task.bucket === "waiting") {
    return `<button class="task-move" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="this-week" aria-label="Resume ${escapeHtml(task.title)} this week" title="Resume this week">Resume</button>`;
  }
  return "";
}

function renderTasks() {
  const tasks = state.data.tasks[state.taskTab] || [];
  const focusTaskView = state.taskTab === "today";
  $("#add-routine-action").hidden = state.taskTab !== "routines";
  $("#add-task-action").hidden = !["today", "thisWeek"].includes(state.taskTab);
  $("#task-panel-title").textContent =
    state.taskTab === "completed"
      ? "Completed"
      : state.taskTab === "waiting"
        ? "Waiting"
        : state.taskTab === "routines"
          ? "Routines"
        : state.taskTab === "today"
          ? "Today"
        : "This week";
  $("#task-list").dataset.view = state.taskTab;
  $("#task-list").innerHTML = tasks.length
    ? tasks
        .map(
          (task, index) => `
            <article class="task-item ${focusTaskView ? "focus-task-item" : ""}" data-priority="${escapeHtml(task.priority || "normal")}">
              ${focusTaskView ? `<span class="task-rank">0${index + 1}</span>` : ""}
              <div class="task-copy">
                <button class="task-title-button" type="button" ${task.type === "routine" ? "data-open-routine" : "data-open-task"}="${escapeHtml(task.relativePath)}">${escapeHtml(task.title)}</button>
                ${focusTaskView && task.summary ? `<p>${escapeHtml(task.summary)}</p>` : ""}
                <div class="task-meta">
                  <span>${escapeHtml(task.priority || task.status)}</span>
                  ${focusTaskView ? `<span>${task.status === "active" ? "Open" : escapeHtml(task.status)}</span>` : ""}
                  ${task.cadence ? `<span>${escapeHtml(task.cadence)}</span>` : ""}
                  ${task.due ? `<span>Due ${escapeHtml(task.due)}</span>` : ""}
                  ${focusTaskView ? "" : `<a class="text-link" href="${obsidianUrl(task.relativePath)}">Open</a>`}
                </div>
              </div>
              ${
                task.type === "routine"
                  ? `
                    <button class="routine-open" type="button" data-open-routine="${escapeHtml(task.relativePath)}" aria-label="Open ${escapeHtml(task.title)} routine">
                      <span class="routine-marker" aria-hidden="true">↻</span>
                      <small>${task.progress.total ? `${task.progress.completed}/${task.progress.total}` : task.progress.todayDone ? "logged" : "open"}</small>
                    </button>
                  `
                  : task.status === "completed"
                  ? `<span class="task-completed" aria-label="Completed">✓</span>`
                  : `<div class="task-actions">${taskRowActions(task)}<button class="task-check" type="button" data-complete-task="${escapeHtml(task.relativePath)}" data-task-title="${escapeHtml(task.title)}" aria-label="Mark ${escapeHtml(task.title)} done" title="Mark task done"></button></div>`
              }
            </article>
          `,
        )
        .join("")
    : `<p class="panel-note">Nothing here right now.</p>`;
}

function renderRecent() {
  $("#recent-list").innerHTML = state.data.recent
    .map(
      (note) => `
        <article class="recent-item">
          <strong>${escapeHtml(note.title)}</strong>
          <p>${escapeHtml(note.type)}${note.updated ? ` · ${escapeHtml(note.updated)}` : ""}</p>
        </article>
      `,
    )
    .join("");
}

function activeRoutine() {
  return state.data.tasks.routines.find(
    (routine) => routine.relativePath === state.activeRoutine,
  );
}

function setTaskTab(taskTab) {
  state.taskTab = TASK_TABS.has(taskTab) ? taskTab : "thisWeek";
  savePreference("atlas-task-tab", state.taskTab);
  syncTabs();
}

function setActiveRoutine(relativePath) {
  state.activeRoutine = relativePath;
  savePreference("atlas-active-routine", relativePath);
}

function allTasks() {
  const tasks = [
    ...state.data.tasks.today,
    ...state.data.tasks.thisWeek,
    ...state.data.tasks.waiting,
    ...state.data.tasks.completed,
  ];
  return [...new Map(tasks.map((task) => [task.relativePath, task])).values()];
}

function activeTask() {
  return allTasks().find((task) => task.relativePath === state.activeTask);
}

function setActiveTask(relativePath) {
  state.activeTask = relativePath;
  savePreference("atlas-active-task", relativePath);
}

function setTodayOpen(open) {
  state.todayOpen = open;
  savePreference("atlas-today-open", open ? "true" : "");
}

function taskLaneLabel(task) {
  return {
    today: "Today",
    "this-week": "This week",
    waiting: "Waiting",
  }[task.bucket] || "Completed";
}

function taskDetailActions(task) {
  if (task.status === "completed") return "";
  const actions = [];
  if (task.bucket !== "today") {
    actions.push(`<button class="secondary-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="today">Move to Today</button>`);
  }
  if (task.bucket !== "this-week") {
    actions.push(`<button class="secondary-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="this-week">Move to Week</button>`);
  }
  if (task.bucket !== "waiting") {
    actions.push(`<button class="secondary-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="waiting">Waiting</button>`);
  }
  actions.push(`<button class="primary-action compact-action" type="button" data-complete-task="${escapeHtml(task.relativePath)}" data-task-title="${escapeHtml(task.title)}"><span class="button-icon">✓</span>Complete</button>`);
  return actions.join("");
}

function renderTaskDialog() {
  const task = activeTask();
  if (!task) {
    if ($("#task-dialog").open) $("#task-dialog").close();
    return;
  }

  const checklist = task.checklist.length
    ? `
      <section class="routine-section">
        <div class="routine-section-heading">
          <h4>Checklist</h4>
          <span>${task.checklist.filter((item) => item.done).length} of ${task.checklist.length}</span>
        </div>
        <ul class="detail-checklist">
          ${task.checklist
            .map(
              (item) => `
                <li class="${item.done ? "done" : ""}">
                  <button class="checklist-toggle" type="button" data-toggle-checklist="${item.index}" data-checklist-done="${item.done ? "false" : "true"}" aria-label="${item.done ? "Reopen" : "Complete"} checklist item: ${escapeHtml(item.text)}">${item.done ? "✓" : ""}</button>
                  <span>${escapeHtml(item.text)}</span>
                </li>
              `,
            )
            .join("")}
        </ul>
      </section>
    `
    : "";
  const notes = task.notes.length
    ? task.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
    : `<li class="empty-entry">No task notes yet.</li>`;

  $("#task-dialog-content").innerHTML = `
    <header class="routine-drawer-header">
      <p class="eyebrow">Task detail</p>
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.summary || "An active Atlas task.")}</p>
      <div class="routine-badges">
        <span>${escapeHtml(task.priority || "normal")}</span>
        <span>${escapeHtml(taskLaneLabel(task))}</span>
        ${task.due ? `<span>Due ${escapeHtml(task.due)}</span>` : ""}
      </div>
    </header>

    ${checklist}

    <section class="routine-section">
      <div class="routine-section-heading">
        <h4>Notes</h4>
      </div>
      <ul class="task-notes">${notes}</ul>
      <form class="inline-note-form" id="task-note-form">
        <input name="note" maxlength="220" placeholder="Add a short task note" required />
        <button class="secondary-action" type="submit">Add note</button>
      </form>
    </section>

    <footer class="routine-drawer-footer">
      <a class="secondary-action drawer-link" href="${obsidianUrl(task.relativePath)}">Open Markdown</a>
      ${taskDetailActions(task)}
    </footer>
  `;
}

function openTask(relativePath) {
  if (state.data.tasks.routines.some((routine) => routine.relativePath === relativePath)) {
    openRoutine(relativePath);
    return;
  }
  setActiveTask(relativePath);
  renderTaskDialog();
  if (!$("#task-dialog").open) $("#task-dialog").showModal();
}

function todayTaskCard(task, action = "") {
  return `
    <article class="today-task-card" data-priority="${escapeHtml(task.priority || "normal")}">
      <button class="today-task-title" type="button" data-open-task="${escapeHtml(task.relativePath)}">${escapeHtml(task.title)}</button>
      <div class="today-task-meta">
        <span>${escapeHtml(task.priority || task.status)}</span>
        ${task.due ? `<span>Due ${escapeHtml(task.due)}</span>` : ""}
        ${action}
      </div>
    </article>
  `;
}

function renderTodayDialog() {
  const tasks = state.data.tasks;
  const topThree = tasks.topThree;
  const todayTasks = tasks.today;
  const routines = tasks.routines;
  const waiting = tasks.waiting;
  const completed = tasks.completedToday;
  const focusCards = topThree.length
    ? topThree
        .map((task) =>
          todayTaskCard(
            task,
            task.bucket === "today"
              ? `<span>In Today</span>`
              : `<button class="text-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="today">Add today</button>`,
          ),
        )
        .join("")
    : `<p class="drawer-note">Atlas will surface priorities when active tasks are available.</p>`;
  const todayCards = todayTasks.length
    ? todayTasks
        .map((task) =>
          todayTaskCard(
            task,
            `<button class="text-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="this-week">Defer</button>`,
          ),
        )
        .join("")
    : `<p class="drawer-note">Choose a suggested task or add a quick task.</p>`;
  const routineCards = routines.length
    ? routines
        .map(
          (routine) => `
            <button class="today-routine-card" type="button" data-open-routine="${escapeHtml(routine.relativePath)}">
              <span>${escapeHtml(routine.title)}</span>
              <small>${routine.progress.todayDone ? "Logged today" : "Needs a check-in"}</small>
            </button>
          `,
        )
        .join("")
    : `<p class="drawer-note">No active routines.</p>`;

  $("#today-dialog-content").innerHTML = `
    <header class="today-workspace-header">
      <p class="eyebrow">Today workspace</p>
      <h3>Shape the day</h3>
      <p>Choose a small intentional list. The weekly pool can wait quietly in the background.</p>
      <div class="today-summary-grid">
        <div><strong>${todayTasks.length}</strong><span>Today</span></div>
        <div><strong>${routines.filter((routine) => !routine.progress.todayDone).length}</strong><span>Routines due</span></div>
        <div><strong>${waiting.length}</strong><span>Waiting</span></div>
        <div><strong>${completed.length}</strong><span>Done today</span></div>
      </div>
      <button class="primary-action compact-action" id="today-add-task" type="button"><span class="button-icon">+</span>Quick task</button>
    </header>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Today</h4><span>Intentional list</span></div>
      <div class="today-card-list">${todayCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading">
        <h4>Top Three</h4>
        <button class="text-action" id="adjust-top-three" type="button">${tasks.topThreeMode === "manual" ? "Adjust your override" : "Adjust Atlas selection"}</button>
      </div>
      <div class="today-card-list">${focusCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Routines</h4><span>Quiet maintenance</span></div>
      <div class="today-card-list">${routineCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Waiting</h4><span>${waiting.length} open</span></div>
      <div class="today-card-list">${waiting.length ? waiting.map((task) => todayTaskCard(task)).join("") : `<p class="drawer-note">Nothing waiting right now.</p>`}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Completed today</h4><span>${completed.length} done</span></div>
      <div class="today-card-list">${completed.length ? completed.map((task) => todayTaskCard(task)).join("") : `<p class="drawer-note">Completed work will gather here.</p>`}</div>
    </section>
  `;
}

function renderMiddayDialog() {
  const tasks = state.data.tasks;
  const topThree = tasks.topThree;
  const todayTasks = tasks.today;
  const routinesDue = tasks.routines.filter((routine) => !routine.progress.todayDone);
  const completed = tasks.completedToday;
  const waiting = tasks.waiting;
  const focusCards = topThree.length
    ? topThree
        .map((task) =>
          todayTaskCard(
            task,
            task.bucket === "today"
              ? `<span>In Today</span>`
              : `<button class="text-action" type="button" data-move-task="${escapeHtml(task.relativePath)}" data-destination="today">Add today</button>`,
          ),
        )
        .join("")
    : `<p class="drawer-note">No ranked priorities yet. Add or revise tasks if the afternoon needs shape.</p>`;
  const todayCards = todayTasks.length
    ? todayTasks.slice(0, 4).map((task) => todayTaskCard(task)).join("")
    : `<p class="drawer-note">No Today tasks selected. Pull one in or add a quick task.</p>`;
  const routineCards = routinesDue.length
    ? routinesDue
        .map(
          (routine) => `
            <button class="today-routine-card" type="button" data-open-routine="${escapeHtml(routine.relativePath)}">
              <span>${escapeHtml(routine.title)}</span>
              <small>Needs a check-in</small>
            </button>
          `,
        )
        .join("")
    : `<p class="drawer-note">Routines are quiet for now.</p>`;

  $("#midday-dialog-content").innerHTML = `
    <header class="today-workspace-header">
      <p class="eyebrow">Midday check-in</p>
      <h3>Adjust the rest of the day</h3>
      <p>Use this as a short reset: notice what moved, choose what still matters, and capture any change you want Atlas to process later.</p>
      <div class="today-summary-grid">
        <div><strong>${todayTasks.length}</strong><span>Today</span></div>
        <div><strong>${completed.length}</strong><span>Done today</span></div>
        <div><strong>${routinesDue.length}</strong><span>Routines due</span></div>
        <div><strong>${waiting.length}</strong><span>Waiting</span></div>
      </div>
    </header>

    <section class="today-section midday-actions-section">
      <div class="routine-section-heading"><h4>Midday moves</h4><span>Choose one if useful</span></div>
      <div class="midday-action-grid">
        <button class="secondary-action" id="midday-open-today" type="button">Open Today workspace</button>
        <button class="secondary-action" id="midday-priority-request" type="button">Request priority change</button>
        <button class="secondary-action" id="midday-add-task" type="button">Add quick task</button>
        <button class="secondary-action" id="midday-review-routines" type="button">Review routines</button>
        <button class="secondary-action" id="midday-project-request" type="button">Capture project note</button>
        <button class="secondary-action" id="midday-copy-process" type="button">Copy process request</button>
      </div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Top Three</h4><span>Still true?</span></div>
      <div class="today-card-list">${focusCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Today list</h4><span>${todayTasks.length} active</span></div>
      <div class="today-card-list">${todayCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Routines</h4><span>${routinesDue.length} due</span></div>
      <div class="today-card-list">${routineCards}</div>
    </section>

    <section class="today-section">
      <div class="routine-section-heading"><h4>Quick reflection</h4><span>30 seconds</span></div>
      <ul class="midday-prompt-list">
        <li>What changed since morning?</li>
        <li>What still deserves attention before evening?</li>
        <li>What should Atlas remember or process next time?</li>
      </ul>
    </section>
  `;
}

function openMiddayCheckin() {
  setTaskTab("today");
  renderMode();
  renderTasks();
  renderMiddayDialog();
  if (!$("#midday-dialog").open) $("#midday-dialog").showModal();
}

function openTodayWorkspace() {
  setTodayOpen(true);
  setTaskTab("today");
  renderMode();
  renderTasks();
  renderTodayDialog();
  if (!$("#today-dialog").open) $("#today-dialog").showModal();
}

function renderCloseoutDialog() {
  const tasks = state.data.tasks;
  const unfinished = tasks.today;
  const choices = unfinished.length
    ? unfinished
        .map(
          (task) => `
            <article class="closeout-task">
              <div>
                <strong>${escapeHtml(task.title)}</strong>
                <small>${escapeHtml(task.priority || "normal")}${task.due ? ` · Due ${escapeHtml(task.due)}` : ""}</small>
              </div>
              <label>
                <span class="sr-only">Rollover choice for ${escapeHtml(task.title)}</span>
                <select data-closeout-task="${escapeHtml(task.relativePath)}">
                  <option value="today">Carry into tomorrow</option>
                  <option value="this-week">Defer to This Week</option>
                  <option value="waiting">Mark Waiting</option>
                  <option value="someday">Move to Someday</option>
                </select>
              </label>
            </article>
          `,
        )
        .join("")
    : `<p class="drawer-note">Nothing unfinished in Today. You can close the loop cleanly.</p>`;

  $("#closeout-dialog-content").innerHTML = `
    <header class="today-workspace-header">
      <p class="eyebrow">Evening closeout</p>
      <h3>Leave tomorrow a clean runway</h3>
      <p>Review each unfinished Today task deliberately. Carry it forward, defer it, mark it waiting, or move it out of the active pool.</p>
      <div class="today-summary-grid">
        <div><strong>${tasks.completedToday.length}</strong><span>Done today</span></div>
        <div><strong>${unfinished.length}</strong><span>Unfinished</span></div>
        <div><strong>${tasks.waiting.length}</strong><span>Waiting</span></div>
        <div><strong>${tasks.routines.filter((routine) => !routine.progress.todayDone).length}</strong><span>Routines due</span></div>
      </div>
    </header>

    <form id="closeout-form">
      <section class="today-section">
        <div class="routine-section-heading"><h4>Unfinished Today tasks</h4><span>Choose intentionally</span></div>
        <div class="closeout-task-list">${choices}</div>
      </section>
      <div class="closeout-actions">
        <button class="primary-action compact-action" type="submit"><span class="button-icon">✓</span>Close the day</button>
        <button class="secondary-action" id="copy-reflection-prompt" type="button">Copy reflection prompt</button>
      </div>
    </form>
  `;
}

function openCloseout() {
  renderCloseoutDialog();
  if (!$("#closeout-dialog").open) $("#closeout-dialog").showModal();
}

function openAddTask(bucket = "today") {
  $("#add-task-form").reset();
  $("#new-task-bucket").value = bucket === "this-week" ? "this-week" : "today";
  $("#add-task-dialog").showModal();
}

function openAtlasRequest(kind = "feature", prefill = "") {
  const normalizedKind = REQUEST_TYPES[kind] ? kind : "feature";
  const config = REQUEST_TYPES[normalizedKind];
  [
    "#project-dialog",
    "#focus-dialog",
    "#today-dialog",
    "#midday-dialog",
    "#closeout-dialog",
    "#routine-dialog",
    "#task-dialog",
  ].forEach((selector) => {
    const dialog = $(selector);
    if (dialog?.open) dialog.close();
  });
  $("#atlas-request-form").reset();
  $("#request-kind").value = normalizedKind;
  $("#request-eyebrow").textContent = config.eyebrow;
  $("#request-title").textContent = config.title;
  $("#request-label").textContent = config.label;
  $("#request-intro").textContent = config.intro;
  $("#request-description").placeholder = config.placeholder;
  $("#request-description").value = prefill;
  if (!$("#request-dialog").open) $("#request-dialog").showModal();
  $("#request-description").focus();
}

function noteSectionLabel(section) {
  return {
    "01-Inbox": "Inbox",
    "02-Library": "Library",
    "03-Projects": "Projects",
    "04-Relationships": "Relationships",
    "05-Tasks": "Tasks",
  }[section] || "Atlas";
}

function renderMarkdownInline(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link">$1</span>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function markdownToHtml(markdown = "") {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const chunks = [];
  let list = [];
  let ordered = [];
  let code = [];
  let inCode = false;

  const flushList = () => {
    if (list.length) chunks.push(`<ul>${list.join("")}</ul>`);
    if (ordered.length) chunks.push(`<ol>${ordered.join("")}</ol>`);
    list = [];
    ordered = [];
  };
  const flushCode = () => {
    if (code.length) chunks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      code.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 5);
      chunks.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      return;
    }
    if (/^---+$/.test(trimmed)) {
      flushList();
      chunks.push("<hr />");
      return;
    }
    const checkbox = trimmed.match(/^- \[([ xX])\]\s+(.+)$/);
    if (checkbox) {
      ordered = [];
      list.push(`<li class="preview-check ${checkbox[1].toLowerCase() === "x" ? "done" : ""}"><span>${checkbox[1].toLowerCase() === "x" ? "✓" : ""}</span>${renderMarkdownInline(checkbox[2])}</li>`);
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      ordered = [];
      list.push(`<li>${renderMarkdownInline(bullet[1])}</li>`);
      return;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      list = [];
      ordered.push(`<li>${renderMarkdownInline(numbered[1])}</li>`);
      return;
    }
    if (trimmed.startsWith("> ")) {
      flushList();
      chunks.push(`<blockquote>${renderMarkdownInline(trimmed.slice(2))}</blockquote>`);
      return;
    }
    flushList();
    chunks.push(`<p>${renderMarkdownInline(trimmed)}</p>`);
  });

  flushList();
  flushCode();
  return chunks.join("") || `<p class="drawer-note">This note is empty.</p>`;
}

function noteListMarkup() {
  return state.notes.items.length
    ? state.notes.items
        .map(
          (note) => `
            <button class="note-list-item ${note.relativePath === state.notes.activePath ? "active" : ""}" type="button" data-note-path="${escapeHtml(note.relativePath)}">
              <span>${escapeHtml(noteSectionLabel(note.section))}</span>
              <strong>${escapeHtml(note.title)}</strong>
              <small>${escapeHtml(note.preview || note.summary || note.relativePath)}</small>
            </button>
          `,
        )
        .join("")
    : `<p class="drawer-note">No notes matched that search.</p>`;
}

function noteEditorMarkup(note) {
  if (!note) {
    return `
      <section class="notes-empty">
        <p class="eyebrow">Notes</p>
        <h3>Select a note</h3>
        <p>Choose a Markdown file from Atlas or create a new note.</p>
      </section>
    `;
  }

  const preview = markdownToHtml(note.body || "");
  const editActive = state.notes.mode === "edit";
  return `
    <header class="notes-editor-header">
      <div>
        <p class="eyebrow">${escapeHtml(noteSectionLabel(note.section))}</p>
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.relativePath)}</p>
      </div>
      <div class="notes-editor-actions">
        <button class="secondary-action ${editActive ? "" : "active"}" type="button" data-note-mode="preview">Preview</button>
        <button class="secondary-action ${editActive ? "active" : ""}" type="button" data-note-mode="edit">Edit</button>
        <button class="secondary-action" type="button" data-open-note-markdown="${escapeHtml(note.relativePath)}">Open Markdown</button>
        <button class="primary-action compact-action" type="button" id="save-note-action" ${state.notes.dirty ? "" : "disabled"}><span class="button-icon">✓</span>Save</button>
      </div>
    </header>
    <div class="notes-metadata">
      <span>${escapeHtml(note.status || "unknown")}</span>
      <span>${escapeHtml(note.type || "note")}</span>
      ${note.updated ? `<span>Updated ${escapeHtml(note.updated)}</span>` : ""}
      ${state.notes.dirty ? `<span class="dirty">Unsaved changes</span>` : ""}
    </div>
    <div class="notes-toolbar" ${editActive ? "" : "hidden"}>
      <button type="button" data-md-format="h2" title="Heading">H2</button>
      <button type="button" data-md-format="bold" title="Bold">B</button>
      <button type="button" data-md-format="italic" title="Italic">I</button>
      <button type="button" data-md-format="bullet" title="Bullet list">•</button>
      <button type="button" data-md-format="check" title="Checklist">☐</button>
      <button type="button" data-md-format="link" title="Link">↗</button>
    </div>
    <div class="notes-editor-body">
      <textarea id="note-editor-body" ${editActive ? "" : "hidden"} spellcheck="true">${escapeHtml(note.body || "")}</textarea>
      <article class="notes-preview" ${editActive ? "hidden" : ""}>${preview}</article>
    </div>
  `;
}

function renderNotesDialog() {
  $("#notes-dialog-content").innerHTML = `
    <header class="notes-workspace-header">
      <div>
        <p class="eyebrow">Phase 2</p>
        <h3>Notes</h3>
      </div>
      <div class="notes-workspace-actions">
        <button class="secondary-action" id="refresh-notes-action" type="button">Refresh</button>
        <button class="primary-action compact-action" id="new-note-action" type="button"><span class="button-icon">+</span>New note</button>
      </div>
    </header>
    <section class="notes-workspace">
      <aside class="notes-sidebar">
        <form id="notes-search-form" class="notes-search">
          <input id="notes-query" name="query" value="${escapeHtml(state.notes.query)}" placeholder="Search notes" />
          <select id="notes-section" name="section">
            <option value="">All folders</option>
            ${["01-Inbox", "02-Library", "03-Projects", "04-Relationships", "05-Tasks"]
              .map((section) => `<option value="${section}" ${state.notes.section === section ? "selected" : ""}>${noteSectionLabel(section)}</option>`)
              .join("")}
          </select>
        </form>
        <div class="notes-list">${noteListMarkup()}</div>
      </aside>
      <section class="notes-editor">${noteEditorMarkup(state.notes.active)}</section>
    </section>
  `;
}

async function loadNotes({ keepActive = true } = {}) {
  const data = await AtlasApi.getNotes({
    query: state.notes.query,
    section: state.notes.section,
  });
  state.notes.items = data.notes || [];
  if (!keepActive || !state.notes.items.some((note) => note.relativePath === state.notes.activePath)) {
    state.notes.activePath = state.notes.items[0]?.relativePath || "";
  }
  if (state.notes.activePath) {
    state.notes.active = await AtlasApi.readNote(state.notes.activePath);
  } else {
    state.notes.active = null;
  }
  state.notes.dirty = false;
  renderNotesDialog();
}

async function openNotesWorkspace() {
  if (!$("#notes-dialog").open) $("#notes-dialog").showModal();
  if (!state.notes.items.length) {
    await loadNotes({ keepActive: false });
  } else {
    renderNotesDialog();
  }
}

async function selectNote(relativePath) {
  if (state.notes.dirty && !window.confirm("Discard unsaved note changes?")) return;
  state.notes.activePath = relativePath;
  state.notes.active = await AtlasApi.readNote(relativePath);
  state.notes.mode = "preview";
  state.notes.dirty = false;
  renderNotesDialog();
}

function applyMarkdownFormat(kind) {
  const editor = $("#note-editor-body");
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const formats = {
    h2: [`## ${selected || "Heading"}`, ""],
    bold: [`**${selected || "bold text"}**`, ""],
    italic: [`*${selected || "italic text"}*`, ""],
    bullet: [`- ${selected || "List item"}`, ""],
    check: [`- [ ] ${selected || "Checklist item"}`, ""],
    link: [`[${selected || "Link text"}](https://)`, ""],
  };
  const [replacement] = formats[kind] || [selected];
  editor.setRangeText(replacement, start, end, "select");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
}

function routineModeLabel(routine) {
  if (routine.routineMode === "measurement") {
    if (routine.measurementKind === "blood-pressure") return "BP measurement";
    if (routine.measurementKind === "weight-metrics") return "Weight metrics";
    return "Measurement";
  }
  return routine.routineMode === "note" ? "Short note" : "Simple check-in";
}

function routineLogFields(routine) {
  if (routine.routineMode === "measurement" && routine.measurementKind === "blood-pressure") {
    return `
      <div class="measurement-grid">
        <label>
          <span>Systolic</span>
          <input name="systolic" type="number" min="40" max="300" inputmode="numeric" placeholder="120" required />
        </label>
        <label>
          <span>Diastolic</span>
          <input name="diastolic" type="number" min="30" max="200" inputmode="numeric" placeholder="80" required />
        </label>
      </div>
      <label>
        <span>Optional note</span>
        <input name="note" maxlength="180" placeholder="Context worth remembering" />
      </label>
    `;
  }
  if (routine.routineMode === "measurement" && routine.measurementKind === "weight-metrics") {
    return `
      <div class="measurement-grid weight-metrics-grid">
        <label>
          <span>Weight</span>
          <input name="weight" type="number" min="1" max="1000" step="0.1" inputmode="decimal" placeholder="231.6" required />
        </label>
        <label>
          <span>Fat %</span>
          <input name="bodyFat" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="28.4" required />
        </label>
        <label>
          <span>BMI</span>
          <input name="bmi" type="number" min="5" max="100" step="0.1" inputmode="decimal" placeholder="31.4" required />
        </label>
      </div>
      <label>
        <span>Optional note</span>
        <input name="note" maxlength="180" placeholder="Context worth remembering" />
      </label>
    `;
  }
  if (routine.routineMode === "measurement") {
    return `
      <label>
        <span>Today's measurement${routine.unit ? ` (${escapeHtml(routine.unit)})` : ""}</span>
        <input name="value" type="number" step="any" inputmode="decimal" required />
      </label>
      <label>
        <span>Optional note</span>
        <input name="note" maxlength="180" placeholder="Context worth remembering" />
      </label>
    `;
  }
  if (routine.routineMode === "note") {
    return `
      <label>
        <span>Today's note</span>
        <textarea name="note" maxlength="180" rows="3" placeholder="What is worth keeping?" required></textarea>
      </label>
    `;
  }
  return `
    <label>
      <span>Optional note</span>
      <input name="note" maxlength="180" placeholder="Anything worth remembering?" />
    </label>
  `;
}

function renderRoutineTrend(routine) {
  if (routine.measurementKind !== "blood-pressure" || routine.readings.length < 2) return "";

  const readings = routine.readings;
  const values = readings.flatMap((reading) => [reading.systolic, reading.diastolic]);
  const minimum = Math.min(...values) - 5;
  const maximum = Math.max(...values) + 5;
  const width = 360;
  const height = 90;
  const padding = 10;
  const spread = Math.max(maximum - minimum, 1);
  const x = (index) =>
    padding + (index * (width - padding * 2)) / Math.max(readings.length - 1, 1);
  const y = (value) =>
    height - padding - ((value - minimum) * (height - padding * 2)) / spread;
  const systolic = readings.map((reading, index) => `${x(index)},${y(reading.systolic)}`).join(" ");
  const diastolic = readings
    .map((reading, index) => `${x(index)},${y(reading.diastolic)}`)
    .join(" ");
  const latest = readings[readings.length - 1];

  return `
    <section class="routine-section routine-trend">
      <div class="routine-section-heading">
        <h4>Blood-pressure trend</h4>
        <span>${escapeHtml(latest.systolic)}/${escapeHtml(latest.diastolic)} latest</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Blood-pressure reading trend">
        <polyline class="trend-systolic" points="${systolic}"></polyline>
        <polyline class="trend-diastolic" points="${diastolic}"></polyline>
      </svg>
      <div class="trend-key"><span><i class="systolic-dot"></i>Systolic</span><span><i class="diastolic-dot"></i>Diastolic</span></div>
    </section>
  `;
}

function renderRoutineDialog() {
  const routine = activeRoutine();
  if (!routine) {
    $("#routine-dialog").close();
    return;
  }

  const progress = routine.progress;
  const dueLabel = routine.due ? `Through ${escapeHtml(routine.due)}` : "No end date";
  const progressLabel = progress.total
    ? `${progress.completed} of ${progress.total} check-ins`
    : progress.todayDone
      ? "Logged today"
      : "Ready for a check-in";
  const progressItems = progress.items.length
    ? progress.items
        .map(
          (item) => `
            <span class="progress-day ${item.done ? "done" : ""} ${item.date === state.data.today ? "today" : ""}" title="${escapeHtml(item.date)}${item.detail ? ` · ${escapeHtml(item.detail)}` : ""}">
              ${escapeHtml(item.date.slice(5))}
            </span>
          `,
        )
        .join("")
    : `<p class="drawer-note">This routine logs check-ins as you add them.</p>`;
  const recent = routine.recentEntries.length
    ? routine.recentEntries
        .map(
          (entry) => `
            <li>
              <time>${escapeHtml(entry.date)}</time>
              <span>${escapeHtml(entry.detail)}</span>
            </li>
          `,
        )
        .join("")
    : `<li class="empty-entry">No entries yet. Today's check-in can be the first.</li>`;

  $("#routine-dialog-content").innerHTML = `
    <header class="routine-drawer-header">
      <p class="eyebrow">Routine Studio</p>
      <h3>${escapeHtml(routine.title)}</h3>
      <p>${escapeHtml(routine.summary || "A quiet recurring Atlas routine.")}</p>
      <div class="routine-badges">
        <span>${escapeHtml(routine.cadence || "as-needed")}</span>
        <span>${escapeHtml(routineModeLabel(routine))}</span>
        <span>${dueLabel}</span>
      </div>
    </header>

    <section class="routine-section">
      <div class="routine-section-heading">
        <h4>Progress</h4>
        <span>${escapeHtml(progressLabel)}</span>
      </div>
      <div class="routine-progress-strip">${progressItems}</div>
    </section>

    ${renderRoutineTrend(routine)}

    <section class="routine-section routine-entry-card">
      <div class="routine-section-heading">
        <h4>${progress.todayDone ? "Update today's entry" : "Log today"}</h4>
        <span>${escapeHtml(state.data.today)}</span>
      </div>
      <form id="routine-log-form">
        ${routineLogFields(routine)}
        <button class="primary-action compact-action" type="submit">
          <span class="button-icon">✓</span>
          ${progress.todayDone ? "Update today" : "Log today"}
        </button>
      </form>
    </section>

    <section class="routine-section">
      <div class="routine-section-heading">
        <h4>Recent entries</h4>
      </div>
      <ul class="routine-entries">${recent}</ul>
    </section>

    <footer class="routine-drawer-footer">
      <a class="secondary-action drawer-link" href="${obsidianUrl(routine.relativePath)}">Open Markdown</a>
      <button class="secondary-action" type="button" data-complete-routine>Complete routine</button>
      <button class="quiet-action" type="button" data-archive-routine>Archive</button>
    </footer>
  `;
}

function openRoutine(relativePath) {
  setActiveRoutine(relativePath);
  renderRoutineDialog();
  if (!$("#routine-dialog").open) $("#routine-dialog").showModal();
}

function openRoutineStudio() {
  setTaskTab("routines");
  renderMode();
  renderTasks();
  const routines = state.data.tasks.routines;
  if (routines.length === 1) {
    openRoutine(routines[0].relativePath);
  } else if (routines.length === 0) {
    toast("No active routines yet. Add your first routine.");
    $("#add-routine-action").click();
  } else {
    toast("Routine Studio is open. Choose a routine or add a new one.");
  }
}

async function postAction(url, body = {}) {
  return AtlasApi.postAction(url, body);
}

async function moveTaskInAtlas(relativePath, destination) {
  try {
    const result = await postAction("/api/actions/move-task", { relativePath, destination });
    if (state.activeTask === relativePath) setActiveTask(result.relativePath);
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
}

async function completeTaskInAtlas(relativePath, title) {
  if (!window.confirm(`Mark "${title}" as done? This updates the Atlas Markdown task.`)) {
    return;
  }
  try {
    const result = await postAction("/api/actions/complete-task", { relativePath });
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fallbackCopyText(text) {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch (error) {
    if (fallbackCopyText(text)) {
      toast(message);
      return;
    }
    console.error(error);
    toast("Copy was blocked. Select the request from your agent conversation instead.");
  }
}

function inboxPrompt() {
  return [
    "Process Atlas Capture folder only.",
    "Read the Atlas system rules first.",
    "Preserve untouched originals before processing.",
    "Create review-ready notes with Quick Approval blocks and refresh the Review Queue.",
    "Scan every daily capture for natural-language Atlas requests, even when they are not explicitly labeled.",
    "For atlas-request captures, identify whether they are routine, priority, project, or Atlas App feature requests.",
    "Classify extracted actions as one-time tasks, checklist tasks, routines, or project candidates so minor repeated items do not crowd the focused task list.",
    "For routine requests, infer cadence, fields, routine mode, measurement kind, and any initial entries from the user's natural language.",
    "For priority, project, and feature requests, make clear safe updates when Atlas rules allow it, and route ambiguous or broad changes to Review.",
    "For Capture items older than seven days, process and file directly when clear, then delete the working capture after verifying an identical preserved original and completed filing.",
    "Do not process or file existing Review decisions unless I have checked their approval boxes.",
    "Do not delete fresh working captures unless cleanup is explicitly approved.",
  ].join(" ");
}

function dayReviewPrompt() {
  return [
    "Help me close out my Atlas day.",
    "Review my active and waiting tasks, active routines, completed work, project highlights, and unresolved Review decisions.",
    "Briefly surface routine progress and ask whether any repeated, multi-step, or overly broad item should remain a task, become a routine, use an internal checklist, or become a project.",
    "Give me a short reflection: what moved, what is blocked, and the top three priorities for tomorrow.",
    "Do not process the Capture folder unless I explicitly ask.",
  ].join(" ");
}

$$(".mode-button[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    $$(".mode-button[data-mode]").forEach((item) =>
      item.classList.toggle("active", item === button),
    );
    if (state.mode === "evening") {
      setTaskTab("completed");
    } else if (state.mode === "midday") {
      setTaskTab("today");
    }
    renderMode();
    renderTasks();
    if (state.mode === "midday") openMiddayCheckin();
    if (state.mode === "evening") openCloseout();
  });
});

$$(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    setTaskTab(button.dataset.tab);
    renderTasks();
  });
});

function syncTabs() {
  $$(".tab").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === state.taskTab),
  );
}

$("#refresh-action").addEventListener("click", async () => {
  await loadDashboard();
  toast("Atlas refreshed from your Markdown files.");
});

$("#focus-action").addEventListener("click", () => {
  renderFocusDialog();
  $("#focus-dialog").showModal();
});

$("#process-action").addEventListener("click", () =>
  copyText(inboxPrompt(), "Inbox-processing request copied. Paste it into your Atlas agent."),
);

$("#day-review-action").addEventListener("click", openCloseout);

$("#review-action").addEventListener("click", () => {
  AtlasApi.openExternal(obsidianUrl("01-Inbox/02-Review/00-Review Queue.md"));
});

$("#routine-studio-action").addEventListener("click", openRoutineStudio);

$("#today-workspace-action").addEventListener("click", openTodayWorkspace);

$("#notes-workspace-action").addEventListener("click", () => {
  openNotesWorkspace().catch((error) => toast(error.message));
});

$("#priority-request-action").addEventListener("click", () => openAtlasRequest("priority"));

$("#project-request-action").addEventListener("click", () => openAtlasRequest("project"));

$("#app-request-action").addEventListener("click", () => openAtlasRequest("feature"));

$("#project-overview-action").addEventListener("click", () => openProject());

$("#project-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-project]");
  if (button) openProject(button.dataset.openProject);
});

$("#project-dialog-content").addEventListener("click", (event) => {
  const requestButton = event.target.closest("[data-request-kind]");
  if (requestButton) {
    openAtlasRequest(requestButton.dataset.requestKind, requestButton.dataset.requestPrefill || "");
    return;
  }

  const button = event.target.closest("[data-open-project]");
  if (button) openProject(button.dataset.openProject);
});

$("#project-dialog").addEventListener("close", () => {
  state.activeProject = "";
});

$("#notes-dialog-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "notes-search-form") return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target).entries());
  state.notes.query = values.query || "";
  state.notes.section = values.section || "";
  try {
    await loadNotes({ keepActive: false });
  } catch (error) {
    toast(error.message);
  }
});

$("#notes-dialog-content").addEventListener("change", async (event) => {
  if (!["notes-query", "notes-section"].includes(event.target.id)) return;
  const form = $("#notes-search-form");
  const values = Object.fromEntries(new FormData(form).entries());
  state.notes.query = values.query || "";
  state.notes.section = values.section || "";
  try {
    await loadNotes({ keepActive: false });
  } catch (error) {
    toast(error.message);
  }
});

$("#notes-dialog-content").addEventListener("input", (event) => {
  if (event.target.id === "notes-query") {
    state.notes.query = event.target.value;
    return;
  }
  if (event.target.id !== "note-editor-body" || !state.notes.active) return;
  state.notes.active.body = event.target.value;
  state.notes.dirty = true;
  $("#save-note-action").disabled = false;
});

$("#notes-dialog-content").addEventListener("click", async (event) => {
  const noteButton = event.target.closest("[data-note-path]");
  if (noteButton) {
    try {
      await selectNote(noteButton.dataset.notePath);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (event.target.closest("#refresh-notes-action")) {
    try {
      await loadNotes();
      toast("Notes refreshed from Markdown.");
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (event.target.closest("#new-note-action")) {
    $("#add-note-form").reset();
    $("#add-note-dialog").showModal();
    return;
  }

  const modeButton = event.target.closest("[data-note-mode]");
  if (modeButton) {
    state.notes.mode = modeButton.dataset.noteMode;
    renderNotesDialog();
    return;
  }

  const formatButton = event.target.closest("[data-md-format]");
  if (formatButton) {
    applyMarkdownFormat(formatButton.dataset.mdFormat);
    return;
  }

  const openButton = event.target.closest("[data-open-note-markdown]");
  if (openButton) {
    AtlasApi.openExternal(obsidianUrl(openButton.dataset.openNoteMarkdown));
    return;
  }

  if (event.target.closest("#save-note-action") && state.notes.active) {
    const editor = $("#note-editor-body");
    try {
      const result = await AtlasApi.saveNote({
        relativePath: state.notes.active.relativePath,
        title: state.notes.active.title,
        body: editor ? editor.value : state.notes.active.body || "",
      });
      state.notes.active = result;
      state.notes.activePath = result.relativePath;
      state.notes.dirty = false;
      await loadNotes();
      toast(result.message || "Note saved.");
    } catch (error) {
      toast(error.message);
    }
  }
});

$("#add-task-action").addEventListener("click", () => {
  openAddTask(state.taskTab === "thisWeek" ? "this-week" : "today");
});

$("#add-task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!window.confirm(`Add "${values.title}" to Atlas ${values.bucket === "today" ? "Today" : "This Week"}?`)) {
    return;
  }

  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const result = await postAction("/api/actions/create-task", values);
    $("#add-task-dialog").close();
    await loadDashboard();
    toast(result.message);
    openTask(result.relativePath);
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#add-note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const destinationLabel = values.destination === "library-notes" ? "Library Notes" : "Capture";
  if (!window.confirm(`Create "${values.title}" in ${destinationLabel}?`)) {
    return;
  }

  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const result = await AtlasApi.createNote(values);
    $("#add-note-dialog").close();
    state.notes.activePath = result.relativePath;
    state.notes.active = result;
    state.notes.mode = "edit";
    state.notes.dirty = false;
    await loadNotes();
    if (!$("#notes-dialog").open) $("#notes-dialog").showModal();
    toast(result.message || "Note created.");
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#new-capture-action").addEventListener("click", async () => {
  if (!window.confirm("Create today's Atlas Capture note?")) return;
  const result = await postAction("/api/actions/create-daily-capture");
  await loadDashboard();
  toast(result.message);
  AtlasApi.openExternal(obsidianUrl(result.relativePath));
});

$("#task-list").addEventListener("click", async (event) => {
  const routineButton = event.target.closest("[data-open-routine]");
  if (routineButton) {
    openRoutine(routineButton.dataset.openRoutine);
    return;
  }

  const openButton = event.target.closest("[data-open-task]");
  if (openButton) {
    openTask(openButton.dataset.openTask);
    return;
  }

  const moveButton = event.target.closest("[data-move-task]");
  if (moveButton) {
    await moveTaskInAtlas(moveButton.dataset.moveTask, moveButton.dataset.destination);
    return;
  }

  const completeButton = event.target.closest("[data-complete-task]");
  if (completeButton) {
    await completeTaskInAtlas(completeButton.dataset.completeTask, completeButton.dataset.taskTitle);
  }
});

$("#today-dialog-content").addEventListener("click", async (event) => {
  if (event.target.closest("#today-add-task")) {
    openAddTask("today");
    return;
  }

  if (event.target.closest("#adjust-top-three")) {
    renderFocusDialog();
    if (!$("#focus-dialog").open) $("#focus-dialog").showModal();
    return;
  }

  const routineButton = event.target.closest("[data-open-routine]");
  if (routineButton) {
    openRoutine(routineButton.dataset.openRoutine);
    return;
  }

  const openButton = event.target.closest("[data-open-task]");
  if (openButton) {
    openTask(openButton.dataset.openTask);
    return;
  }

  const moveButton = event.target.closest("[data-move-task]");
  if (moveButton) {
    await moveTaskInAtlas(moveButton.dataset.moveTask, moveButton.dataset.destination);
  }
});

$("#today-dialog").addEventListener("close", () => {
  setTodayOpen(false);
});

$("#midday-dialog-content").addEventListener("click", async (event) => {
  if (event.target.closest("#midday-open-today")) {
    $("#midday-dialog").close();
    openTodayWorkspace();
    return;
  }

  if (event.target.closest("#midday-priority-request")) {
    openAtlasRequest("priority", "Midday adjustment: ");
    return;
  }

  if (event.target.closest("#midday-project-request")) {
    openAtlasRequest("project", "Midday project note: ");
    return;
  }

  if (event.target.closest("#midday-add-task")) {
    $("#midday-dialog").close();
    openAddTask("today");
    return;
  }

  if (event.target.closest("#midday-review-routines")) {
    $("#midday-dialog").close();
    openRoutineStudio();
    return;
  }

  if (event.target.closest("#midday-copy-process")) {
    copyText(inboxPrompt(), "Inbox-processing request copied. Paste it into your Atlas agent.");
    return;
  }

  const routineButton = event.target.closest("[data-open-routine]");
  if (routineButton) {
    $("#midday-dialog").close();
    openRoutine(routineButton.dataset.openRoutine);
    return;
  }

  const openButton = event.target.closest("[data-open-task]");
  if (openButton) {
    $("#midday-dialog").close();
    openTask(openButton.dataset.openTask);
    return;
  }

  const moveButton = event.target.closest("[data-move-task]");
  if (moveButton) {
    await moveTaskInAtlas(moveButton.dataset.moveTask, moveButton.dataset.destination);
    if ($("#midday-dialog").open) renderMiddayDialog();
  }
});

$("#focus-dialog-list").addEventListener("change", (event) => {
  if (!event.target.matches('input[name="topThree"]')) return;
  const checked = [...$("#top-three-form").querySelectorAll('input[name="topThree"]:checked')];
  if (checked.length <= 3) return;
  event.target.checked = false;
  toast("Choose up to three priorities.");
});

$("#focus-dialog-list").addEventListener("submit", async (event) => {
  if (event.target.id !== "top-three-form") return;
  event.preventDefault();
  const relativePaths = [...event.target.querySelectorAll('input[name="topThree"]:checked')].map(
    (input) => input.value,
  );
  try {
    const result = await postAction("/api/actions/set-top-three", { relativePaths });
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
});

$("#focus-dialog-list").addEventListener("click", async (event) => {
  if (!event.target.closest("[data-reset-top-three]")) return;
  try {
    const result = await postAction("/api/actions/set-top-three", { relativePaths: [] });
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
});

$("#closeout-dialog-content").addEventListener("click", (event) => {
  if (!event.target.closest("#copy-reflection-prompt")) return;
  copyText(dayReviewPrompt(), "End-of-day Atlas prompt copied.");
});

$("#closeout-dialog-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "closeout-form") return;
  event.preventDefault();
  const actions = [...event.target.querySelectorAll("[data-closeout-task]")].map((select) => ({
    relativePath: select.dataset.closeoutTask,
    destination: select.value,
  }));
  if (!window.confirm("Close the Atlas day and record these rollover choices?")) return;
  try {
    const result = await postAction("/api/actions/close-day", { actions });
    $("#closeout-dialog").close();
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
});

$("#task-dialog-content").addEventListener("click", async (event) => {
  const task = activeTask();
  if (!task) return;

  const checklistButton = event.target.closest("[data-toggle-checklist]");
  if (checklistButton) {
    try {
      const result = await postAction("/api/actions/toggle-task-checklist", {
        relativePath: task.relativePath,
        checklistIndex: Number(checklistButton.dataset.toggleChecklist),
        done: checklistButton.dataset.checklistDone === "true",
      });
      await loadDashboard();
      toast(result.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const moveButton = event.target.closest("[data-move-task]");
  if (moveButton) {
    await moveTaskInAtlas(moveButton.dataset.moveTask, moveButton.dataset.destination);
    return;
  }

  const completeButton = event.target.closest("[data-complete-task]");
  if (completeButton) {
    await completeTaskInAtlas(completeButton.dataset.completeTask, completeButton.dataset.taskTitle);
  }
});

$("#task-dialog-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "task-note-form") return;
  event.preventDefault();
  const task = activeTask();
  if (!task) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await postAction("/api/actions/add-task-note", {
      relativePath: task.relativePath,
      note: values.note,
    });
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
});

$("#task-dialog").addEventListener("close", () => {
  setActiveTask("");
});

$("#add-routine-action").addEventListener("click", () => {
  openAtlasRequest("routine");
});

$("#atlas-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!window.confirm("Save this request to Capture for the next Atlas processing pass?")) {
    return;
  }

  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const result = await postAction("/api/actions/create-atlas-request", values);
    $("#request-dialog").close();
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#routine-dialog-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "routine-log-form") return;
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const result = await postAction("/api/actions/log-routine", {
      relativePath: state.activeRoutine,
      ...values,
    });
    await loadDashboard();
    toast(result.message);
  } catch (error) {
    submit.disabled = false;
    toast(error.message);
  }
});

$("#routine-dialog-content").addEventListener("click", async (event) => {
  const routine = activeRoutine();
  if (!routine) return;

  if (event.target.closest("[data-complete-routine]")) {
    if (!window.confirm(`Mark "${routine.title}" complete? Its Markdown history will remain in Atlas.`)) {
      return;
    }
    try {
      const result = await postAction("/api/actions/complete-routine", {
        relativePath: routine.relativePath,
      });
      await loadDashboard();
      toast(result.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (event.target.closest("[data-archive-routine]")) {
    if (!window.confirm(`Archive "${routine.title}"? It will leave the active list, but its Markdown history will not be deleted.`)) {
      return;
    }
    try {
      const result = await postAction("/api/actions/archive-routine", {
        relativePath: routine.relativePath,
      });
      await loadDashboard();
      toast(result.message);
    } catch (error) {
      toast(error.message);
    }
  }
});

$("#routine-dialog").addEventListener("close", () => {
  setActiveRoutine("");
});

document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="obsidian://"]');
  if (!link) return;
  event.preventDefault();
  AtlasApi.openExternal(link.href).catch((error) => toast(error.message));
});

$("#settings-action").addEventListener("click", () => {
  renderSettings();
  $("#settings-dialog").showModal();
});

$("#choose-vault-action").addEventListener("click", () => {
  chooseVaultPath().catch((error) => toast(error.message));
});

$("#settings-choose-vault").addEventListener("click", () => {
  chooseVaultPath().catch((error) => toast(error.message));
});

$("#save-vault-path-action").addEventListener("click", () => {
  saveVaultPath($("#vault-path-input").value).catch((error) => toast(error.message));
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state.settings = await AtlasApi.saveSettings(values);
    applyTheme(state.settings.theme);
    renderSettings();
    $("#settings-dialog").close();
    await loadDashboard();
    toast("Settings saved.");
  } catch (error) {
    toast(error.message);
  }
});

$("#theme-select").addEventListener("change", (event) => {
  applyTheme(event.target.value);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});

async function initApp() {
  if (!AtlasApi) {
    throw new Error("Atlas API bridge is unavailable.");
  }
  state.settings = await AtlasApi.getSettings();
  applyTheme(state.settings.theme);
  renderSettings();
  if (!state.settings.vaultPath) {
    showVaultDialog();
    return;
  }
  await loadDashboard();
}

initApp().catch((error) => {
  console.error(error);
  if (/vault/i.test(error.message)) {
    showVaultDialog();
    toast("Choose your Atlas folder to begin.");
    return;
  }
  toast("Atlas could not load. Check the dashboard setup.");
});
