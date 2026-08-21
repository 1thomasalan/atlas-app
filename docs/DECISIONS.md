# Architecture Decisions

## Markdown Is the Durable Database

Everything a user creates remains ordinary Markdown. Local caches and settings
may live in `.atlas/` or OS app configuration, but they are rebuildable support
state, not a replacement for the vault.

## The Public App and Private Vault Are Siblings

The repository contains source, generic fixtures, and documentation. It never
contains a user's real vault. Root vault folders and local settings are ignored
to make accidental staging harder.

## Object Types Are a Lens

An object type is a frontmatter value, a default folder, and a property schema.
Classification uses `type:` first and folder prefix second. Custom definitions
travel with the vault in `.atlas/types.json`; visibility preferences stay in
local app settings.

Daily Notes, People, Places, and Tasks are identified as core objects in the
settings interface. Every built-in and custom type can still be enabled or
disabled without deleting its Markdown data.

## Filesystem Scope Is Vault-Only

The webview has no global filesystem wildcard. The Rust shell grants the
selected vault at runtime and restores that scope from local settings at boot.
Inbox processing additionally requires the command's canonical path to equal
the saved vault and requires `00-System/AGENTS.md`.

## Task Lane Equals Folder

A task's kanban lane is the folder containing its Markdown file. Moving a card
moves the file and updates redundant `status` frontmatter.

## Wiki Links Stay Literal

The editor decorates `[[Wiki Links]]` but saves the literal Markdown syntax so
Obsidian and other tools can read it without conversion.

## Daily Notes Are Capture Notes

The calendar note for a date is `01-Inbox/01-Capture/YYYY-MM-DD.md`. Reviews,
Pomodoro logs, and other daily context append to the same portable note.

## Agent Authentication Stays Separate

Atlas does not broker Codex credentials. Codex uses its own local sign-in and
receives a copied, path-scoped handoff. Agent Zero uses a separate A2A token
stored in permission-restricted local app state.

## Agent Zero Returns Proposals

Agent Zero receives only a bounded leased batch of Capture content. The Rust
shell writes its response to Review; the agent receives no general vault write
endpoint. External actions and durable processing-rule changes stay
approval-gated.

## Old Captures May Be Filed Directly

Codex handoffs state the Atlas inbox policy: a Capture older than seven days may
be processed without checkbox approval when its destination is clear. Originals
must be preserved and verified before cleanup. A processed filename keeps its
existing stem and appends ` - Processed`; it never receives a duplicate date.

## Every Atlas Workflow Write Is Logged

App and processor writes append to `00-System/Change-Log.md` when the connected
vault supports the Atlas system contract. Generic Markdown folders continue to
work without that log.
