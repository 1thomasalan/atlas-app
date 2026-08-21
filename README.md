# Atlas App

Atlas App is a local-first interface for an Atlas Markdown vault.

Atlas keeps personal data in a normal folder of Markdown files, usually opened with Obsidian. Atlas App is the optional app layer that reads and writes that vault through narrow, explicit actions: dashboard review, daily focus, tasks, routines, notes, and capture requests.

Atlas App also supports hybrid processing. Codex can handle local, subscription-authenticated work while Agent Zero prepares scoped, review-only proposals through its A2A interface. Atlas leases each Capture item to one processor at a time so the two agents do not race over the same source.

## Data Boundary

This repository is intended to be public. It should contain app code, templates, docs, and example scaffolding only.

It should not contain a real Atlas vault, private notes, captured source material, relationship records, health logs, secrets, API keys, or local app settings.

The split is:

```text
atlas-app/      public code, docs, templates, build files
Atlas/          private Obsidian vault and personal Markdown data
```

## Quick Start

Install dependencies:

```bash
npm install
```

Copy the environment example:

```bash
cp .env.example .env.local
```

Edit `.env.local` and point the app at your vault:

```bash
ATLAS_VAULT_PATH=/absolute/path/to/Atlas
```

Start the browser version:

```bash
npm run serve
```

Open:

```text
http://127.0.0.1:4173
```

## Tauri Development

The desktop shell lives in `src-tauri/`.

```bash
npm run dev
```

The Tauri app stores its selected vault path in the app config directory, outside the vault and outside this Git repository.

## Vault Template

A starter vault template lives in:

```text
templates/vault/
```

Use it to create a fresh Atlas-compatible Obsidian vault, then point Atlas App at that folder. See `docs/vault-setup.md`.

## Agent Access Direction

Agent access is opt-in and uses narrow operations instead of blanket filesystem access. The current hybrid foundation supports:

- Codex handoffs that use the locally signed-in ChatGPT subscription
- Agent Zero A2A dispatch with its token stored outside the vault and outside Git
- one-hour Capture leases that prevent duplicate agent claims
- Agent Zero results saved as `under-review` proposals with Quick Approval
- external actions and durable rule changes kept behind approval gates
- object-type toggles and custom-object setup requests

Atlas never gives Agent Zero the Codex session or a writable vault mount. See `docs/agent-access.md` for the working architecture and remaining MCP/API direction.

## Safety Checks

Before making this repository public, run:

```bash
npm run check:web
```

Then scan for private data:

```bash
rg -n "your-private-term|api_key|password|token|secret" .
```

The `.gitignore` excludes local config, dependencies, build output, generated app artifacts, and common vault data folders.
