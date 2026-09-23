# Security

Atlas is local-first, but the public code repository and the private vault are
separate trust zones.

## Never Commit

- a real vault or Obsidian configuration;
- Capture or Review contents;
- health, relationship, or project notes;
- local app settings or job files;
- API keys, tokens, passwords, cookies, or recovery codes;
- `.env*`, `.atlas-local/`, `.atlas/`, or editor-agent state.

Root-level Atlas vault folders are ignored as an additional guard. Generic
fixtures belong only in `demo-vault/`, `templates/`, or the in-memory demo.

## Vault Scope

The Tauri filesystem plugin is scoped at runtime to the folder selected by the
user, including its `.atlas` and `.trash` directories. Inbox processing also
canonicalizes the requested path and requires it to equal the saved vault.
Symlinked Capture files are skipped.

The webview can make HTTPS requests for existing features such as OpenAI,
Todoist, metadata, images, weather, and geocoding. Plain HTTP webview access is
limited to loopback. Agent Zero dispatch runs in Rust and is not exposed as a
general browser request capability.

## Agent Jobs

- Agent access is opt-in.
- Codex and Agent Zero use separate credentials.
- Leases prevent the same Capture path from being claimed twice concurrently.
- Expired and failed jobs release their paths.
- Agent Zero receives only the leased Capture content.
- Capture contents are framed as private data, not trusted instructions.
- Agent Zero can create only a Review proposal through this workflow.
- External actions and durable rule changes require explicit approval.
- Agent responses and batches have hard size limits.

## Secrets

OpenAI, Todoist, and Agent Zero credentials are stored in the operating
system's native credential manager: macOS Keychain, Windows Credential Manager,
or a Linux Secret Service. The Agent Zero settings API returns only a
configured/not configured status.

On upgrade, Atlas migrates legacy plaintext credentials into secure storage,
reads them back to verify the copy, removes the plaintext fields, deletes the
legacy Agent Zero secret file, and restricts the remaining settings file to
mode `0600` on Unix. A credential-store failure leaves the legacy value intact
so migration cannot silently lose access.

Credentials are never written to Markdown, logs, Review notes, or Git. Use
restricted keys, rotate compromised credentials, and keep account recovery
material in a password manager.

## Reporting

Do not include real vault excerpts or credentials in a public issue. Reproduce
with the fictional demo vault and redact absolute paths, account names, and
tokens from logs.
