# Security

Atlas App is local-first, but local-first does not mean careless.

## Public Repo Boundary

Keep this repo limited to:

- source code
- build config
- public docs
- starter templates
- example agent instructions

Do not commit:

- real vault folders
- captures
- inbox originals
- review archives
- relationship notes
- health logs
- project notes with private context
- `.env.local`
- `.atlas-local/`
- API keys, tokens, passwords, recovery codes, or credentials

## Vault Path

The browser server reads the vault path from `ATLAS_VAULT_PATH` or ignored local settings in `.atlas-local/settings.json`.

The Tauri app stores the selected vault path in the OS app config directory.

Neither path should be committed.

## Agent Access

Agents should not receive blanket access to the private vault. Prefer an opt-in local bridge with:

- disabled by default
- local-only bind address
- token or OS-mediated authorization
- scope-based permissions
- explicit action logs
- review gates for meaningful writes

## Secrets

Atlas Markdown should not be a secret store. Store secrets in a password manager or OS-backed secret storage. Markdown can reference that a credential exists without copying the value.
