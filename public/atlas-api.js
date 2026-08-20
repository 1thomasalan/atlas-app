(function () {
  const tauri = window.__TAURI__;
  const invoke = tauri?.core?.invoke;
  const isTauri = typeof invoke === "function";

  async function httpJson(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Atlas could not complete that action.");
    }
    return result;
  }

  async function promptForVaultPath() {
    const path = window.prompt("Atlas folder path");
    return path ? path.trim() : "";
  }

  async function chooseVaultFolder() {
    if (isTauri && tauri?.dialog?.open) {
      const selected = await tauri.dialog.open({
        directory: true,
        multiple: false,
        title: "Choose Atlas folder",
      });
      return selected ? setVaultFolder(String(selected)) : null;
    }

    if (isTauri) {
      return invoke("select_vault_folder");
    }

    const vaultPath = await promptForVaultPath();
    if (!vaultPath) return null;
    return setVaultFolder(vaultPath);
  }

  async function getSettings() {
    if (isTauri) return invoke("get_settings");
    return httpJson("/api/settings");
  }

  async function saveSettings(settings) {
    if (isTauri) return invoke("save_settings", { settings });
    return httpJson("/api/settings", {
      method: "POST",
      body: JSON.stringify(settings),
    });
  }

  async function setVaultFolder(vaultPath) {
    if (isTauri) return invoke("set_vault_folder", { vaultPath });
    return httpJson("/api/settings/vault", {
      method: "POST",
      body: JSON.stringify({ vaultPath }),
    });
  }

  async function getDashboard() {
    if (isTauri) return invoke("get_dashboard");
    return httpJson("/api/dashboard");
  }

  async function getMarketTicker() {
    if (isTauri) return invoke("get_market_ticker");
    return httpJson("/api/market-ticker");
  }

  async function getWeather() {
    if (isTauri) return invoke("get_weather");
    return httpJson("/api/weather");
  }

  async function getNotes(params = {}) {
    if (isTauri) return invoke("get_notes", { query: params.query || "", section: params.section || "" });
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.section) search.set("section", params.section);
    return httpJson(`/api/notes${search.toString() ? `?${search}` : ""}`);
  }

  async function readNote(relativePath) {
    if (isTauri) return invoke("read_note_content", { relativePath });
    const search = new URLSearchParams({ path: relativePath });
    return httpJson(`/api/notes/read?${search}`);
  }

  async function saveNote(note) {
    if (isTauri) return invoke("save_note", { note });
    return httpJson("/api/notes/save", {
      method: "POST",
      body: JSON.stringify(note),
    });
  }

  async function createNote(note) {
    if (isTauri) return invoke("create_note", { note });
    return httpJson("/api/notes/create", {
      method: "POST",
      body: JSON.stringify(note),
    });
  }

  async function postAction(url, body = {}) {
    if (isTauri) return invoke("run_action", { action: url, payload: body });
    return httpJson(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function openExternal(url) {
    if (isTauri) return invoke("open_external", { url });
    window.location.href = url;
    return null;
  }

  window.AtlasApi = {
    isTauri,
    chooseVaultFolder,
    getDashboard,
    getMarketTicker,
    getNotes,
    getSettings,
    getWeather,
    openExternal,
    postAction,
    createNote,
    readNote,
    saveNote,
    saveSettings,
    setVaultFolder,
  };
})();
