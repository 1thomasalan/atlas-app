# Vault Setup

Atlas can open any Markdown folder. Its complete inbox and workflow features
use an Atlas-compatible folder structure.

## Start From the Template

Copy `templates/vault/` to a private location outside this repository, then
open that folder in Obsidian and Atlas.

```bash
cp -R templates/vault "$HOME/Knowledge/My Atlas"
```

## Existing Vault

For full Atlas behavior, create:

```text
00-System/AGENTS.md
00-System/Change-Log.md
01-Inbox/01-Capture/
01-Inbox/02-Review/
02-Library/
03-Projects/01-Active/
04-Relationships/01-People/
05-Tasks/01-Today/
05-Tasks/02-This-Week/
05-Tasks/03-Waiting/
05-Tasks/04-Someday/
05-Tasks/05-Routines/
05-Tasks/06-Done/
```

The starter template includes generic system instructions and queue files.
Review them before using automated processing.

## Connect the Desktop App

1. Run `npm run tauri dev` or launch an installed Atlas build.
2. Choose the private vault folder in the first-run picker.
3. Use Settings to change the vault later.
4. Enable only the object types and processors you intend to use.

The selected path is saved in OS app configuration, not this repository.

## Keep Data Private

Keep `atlas-app/` and the vault as separate folders. Do not copy a live vault
into the repository, even temporarily; Git history can retain deleted data.
