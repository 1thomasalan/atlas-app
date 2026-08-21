# Atlas App

Local-first second-brain app for an Obsidian Markdown vault with optional
scoped agent workflows via API.

Atlas is a Tauri 2 desktop app with a React interface and a Rust shell. It
turns ordinary Markdown files into connected objects while keeping the vault
as the source of truth. The public repository contains the app; a user's notes,
captures, credentials, and settings stay outside it.

## What It Does

- Opens an existing Obsidian or Markdown vault without importing it.
- Maps Markdown files to objects such as Daily Notes, People, Places, Tasks,
  Projects, Meetings, Organizations, Weblinks, Meals, Workouts, and Habits.
- Lets users enable or disable built-in and custom object types in Settings.
- Provides calendar, search, backlinks, typed properties, task lanes, daily
  reviews, habits, local briefs, health imports, and a Markdown editor.
- Stores custom object schemas in the connected vault at `.atlas/types.json`.
- Uses Object Studio to turn a plain-language object idea into a Capture
  request and a review-gated setup proposal.
- Routes Capture work to Codex, Agent Zero, or either processor in Hybrid mode.

## Data Boundary

```text
atlas-app/       public source code, docs, generic fixtures
your-vault/      private Markdown data, Obsidian config, Atlas object schemas
OS app config/   selected vault path, preferences, API credentials, job leases
```

The webview receives filesystem access only to the folder selected by the user.
The Rust shell restores that scope on launch. Do not put a real vault inside
this repository.

## Agent Processing

Codex and Agent Zero authenticate independently:

- **Codex** uses the user's local ChatGPT/Codex sign-in. Atlas creates a
  one-hour lease for specific Capture paths and copies a scoped handoff prompt.
- **Agent Zero** is opt-in. Atlas sends only leased Capture contents through
  its A2A endpoint, then writes the response as a Review proposal. It does not
  grant Agent Zero a writable vault mount.
- **Hybrid** presents both choices; it does not send one Capture to both.

External publishing, spending, messaging, account changes, and durable
processing-rule changes remain approval-gated. See
[`docs/agent-access.md`](docs/agent-access.md) and
[`docs/security.md`](docs/security.md).

## Development

Prerequisites: [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs), and
the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your
operating system.

```bash
npm install
npm run tauri dev
```

Browser demo mode uses an in-memory fictional vault:

```bash
npm run dev
```

Run the full local check before publishing:

```bash
npm run check:all
```

Build an installable desktop bundle with:

```bash
npm run tauri build
```

## Vault Setup

Atlas can open a plain Markdown folder. The full inbox, review, tasks, and
change-log workflow expects the Atlas folder convention documented in
[`docs/vault-setup.md`](docs/vault-setup.md). A generic starter lives under
`templates/vault/`.

## Secrets

Provider credentials and the Agent Zero A2A token are stored in local app
configuration, never in the vault or this repository. The Agent Zero token is
kept in a separate `0600` file on Unix systems and is never returned to the
frontend after saving. General credentials still belong in an OS keychain or
password manager.

## License

MIT. Fork it, point it at your own vault, and make it yours.
