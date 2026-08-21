# Architecture

Atlas App has three layers.

## 1. Vault

The vault is a private folder of Markdown files. It is the source of truth.

Required top-level folders:

```text
00-System/
01-Inbox/
02-Library/
03-Projects/
04-Relationships/
05-Tasks/
```

## 2. Local App Service

`server.js` is the browser-mode local service. It:

- serves files from `public/`
- reads Markdown from the configured vault
- exposes dashboard data
- performs explicit semantic writes such as create capture, complete task, move task, log routine, and save request
- appends changes to the vault change log

The service only binds to `127.0.0.1` by default.

Local operational state lives outside the vault:

```text
.atlas-local/settings.json    non-secret browser preferences
.atlas-local/secrets.json     Agent Zero A2A token, mode 0600 when supported
.atlas-local/agent-jobs.json  short processing leases and job outcomes
```

These files are ignored by Git. The Tauri shell stores the same state in the OS app config directory.

## 3. Tauri Shell

`src-tauri/` provides a desktop shell. It stores the selected vault path in the app config directory and uses Tauri commands for native file access.

## Design Rule

Prefer narrow operations over generic file writes. A button such as `Complete task` is safer than an endpoint that writes arbitrary text to arbitrary paths.

## Hybrid Processing

```text
Capture item
-> Atlas lease
-> Codex local handoff OR Agent Zero A2A dispatch
-> Review or permitted filing
-> lease completion or expiry
```

Codex authenticates independently through its local ChatGPT sign-in. Agent Zero authenticates independently through its A2A token. Atlas never converts, copies, or brokers one agent's credential to the other.

Agent Zero receives only the Capture content assigned to the job. Its response becomes an Atlas Review note; it does not receive a vault write path from this workflow.
