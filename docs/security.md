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

Agents should not receive blanket access to the private vault. Atlas hybrid processing uses:

- disabled by default
- separate Codex and Agent Zero authentication
- a permission-restricted local Agent Zero secret file
- one processor lease per Capture item
- explicit selection before private Capture content is sent to Agent Zero
- explicit action logs
- Review notes for Agent Zero results
- approval gates for external actions and durable rule changes

The Agent Zero token grants access to that Agent Zero instance. Use a local instance when possible. Atlas permits unencrypted HTTP only for loopback addresses and requires HTTPS for remote instance URLs.

Atlas does not read or copy Codex's cached ChatGPT authentication. Codex remains responsible for its own local sign-in and permission profile.

## Secrets

Atlas Markdown should not be a secret store. Store general credentials in a password manager or OS-backed secret storage. Browser mode stores the Agent Zero A2A token in ignored local state with mode `0600` when the filesystem supports it; the token is never returned to the browser after saving. Markdown can reference that a credential exists without copying the value.
