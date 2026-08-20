# Atlas App

Atlas App is a local-first interface for an Atlas Markdown vault.

Atlas keeps personal data in a normal folder of Markdown files, usually opened with Obsidian. Atlas App is the optional app layer that reads and writes that vault through narrow, explicit actions: dashboard review, daily focus, tasks, routines, notes, and capture requests.

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

Atlas App is being designed toward opt-in agent access through narrow local operations, not blanket filesystem access. The future agent bridge should support scoped permissions such as:

- create a capture
- read pending work
- propose a processing result
- write a reviewed change
- log an action

See `docs/agent-access.md` for the working architecture.

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
