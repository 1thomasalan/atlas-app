# Processing Rules

## Workflow

```text
Capture -> Process -> Review -> File -> Act
```

## Preserve Originals

Copy untouched originals to:

```text
02-Library/Sources/Inbox-Originals/
```

Never overwrite source material.

## Capture

New notes, clips, thoughts, tasks, meeting notes, files, and questions enter:

```text
01-Inbox/01-Capture/
```

## Stale Capture Rule

Capture items older than seven days may be processed and filed without checkbox approval when the result is clear.

For stale captures:

1. Preserve the untouched original.
2. File clear content into the right Atlas folder.
3. Keep secrets out of processed and final notes.
4. Avoid external side effects unless explicitly requested.
5. Create Review notes for unresolved ambiguity or sensitive decisions.
6. Delete the working Capture only after verifying the preserved original.
7. Log the cleanup.
8. When renaming a processed capture, keep its current filename stem and append ` - Processed`; do not add another date.

Fresh captures still use Review unless the change is low-risk or explicitly requested.

## Agent Processing Leases

Atlas App may lease Capture items to Codex or Agent Zero for one hour. Do not process a path assigned to another active job. An expired or failed lease may be claimed again.

Agent Zero responses enter Review as proposals. They do not authorize direct filing, cleanup, external actions, or durable rule changes.

## Custom Objects

Custom-object requests enter Capture. Draft the complete metadata, destination, template, processing behavior, dashboard impact, and relationships, then create a Review note before changing `00-System/Object-Types.md` or another durable system rule.

## Review

Review notes live in:

```text
01-Inbox/02-Review/
```

Use one of:

```yaml
status: under-review
status: approved
status: approved-with-edits
status: rejected
```

## Filing

- Library knowledge -> `02-Library/`
- Projects -> `03-Projects/`
- Relationships -> `04-Relationships/`
- Tasks and routines -> `05-Tasks/`

## Change Log

Log every agent-created, edited, moved, renamed, or deleted file in:

```text
00-System/Change-Log.md
```
