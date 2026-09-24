# Architecture

Atlas App has three local layers.

## React Interface

`src/` contains the Vite and React UI. It builds an in-memory object index from
the connected Markdown files and renders the dashboard, calendar, editor,
object browsers, settings, and review flows.

In browser development mode, filesystem and settings calls use the fictional
in-memory vault in `src/lib/demoFs.ts`. Browser mode is a UI preview, not the
desktop security model.

## Tauri Shell

`src-tauri/` contains the Rust desktop shell. It:

- grants Tauri filesystem scope only to the selected vault;
- restores the saved scope at launch;
- stores credentials in the OS credential manager and lease state outside the vault;
- runs YouTube requests that cannot originate from the webview;
- reserves bounded Capture batches for Codex or Agent Zero;
- sends Agent Zero A2A requests and saves responses to Review;
- appends native workflow writes to `00-System/Change-Log.md`.

## Markdown Vault

The vault remains the durable database. Objects are classified by frontmatter
`type` first and folder prefix second. Object definitions are a folder,
frontmatter type, and property schema. Custom definitions live at
`.atlas/types.json` in the user's vault so they remain portable with the notes.

Daily Brief and Local News caches also live under `.atlas/`. Local News keeps
its current structured edition at `.atlas/local-news/current.json` and a
human-readable Markdown mirror in the vault folder selected in Settings. The
React view only renders that contract; native generation and optional external
agents are producers of the same format.

The complete Atlas workflow uses:

```text
00-System/
01-Inbox/01-Capture/
01-Inbox/02-Review/
02-Library/
03-Projects/
04-Relationships/
05-Tasks/
```

## Processing Boundary

```text
Capture
  -> one-hour, per-vault lease (maximum 12 files / 120,000 characters)
  -> Codex path-scoped handoff
     OR Agent Zero content-scoped A2A request
  -> permitted filing or Review proposal
  -> completion, failure, or lease expiry
```

Codex reads only the absolute paths listed in its handoff. Agent Zero receives
the leased contents as framed private data and its response is capped at 250 KB.
Plain HTTP Agent Zero URLs are accepted only on loopback; remote instances must
use HTTPS.

## Design Rule

Prefer semantic operations over generic remote write access. The desktop UI
may edit the chosen vault as the user, but an external agent begins with a
bounded job and a Review proposal, not an unrestricted filesystem mount.
