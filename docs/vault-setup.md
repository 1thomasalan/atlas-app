# Vault Setup

Atlas App needs an Atlas-compatible Markdown vault.

## Create a New Vault

Copy the starter template:

```bash
cp -R templates/vault ~/Atlas
```

Open `~/Atlas` in Obsidian, or use it as a plain folder.

## Use an Existing Vault

Your vault needs these folders:

```text
00-System/
01-Inbox/
02-Library/
03-Projects/
04-Relationships/
05-Tasks/
```

It also needs:

```text
00-System/AGENTS.md
00-System/Change-Log.md
```

## Point Atlas App At the Vault

Browser/server mode:

```bash
cp .env.example .env.local
```

Then edit:

```text
ATLAS_VAULT_PATH=/absolute/path/to/Atlas
```

Tauri mode:

1. Run `npm run dev`.
2. Choose the vault folder in the setup dialog.

## Keep Data Out of Git

Do not move your real vault inside `atlas-app/`. Keep it as a sibling folder or somewhere else private.
