# Daily Inbox Processing Automation

```markdown
Read `00-System/AGENTS.md` and follow the required Atlas system files.

Process new items and items changed since their last preserved version in `01-Inbox/01-Capture/` according to Atlas rules.

Ignore folder documentation such as `README.md`, hidden files, and operating files unless the user explicitly asks to process them as captures.

Infer intent proactively from natural notes, questions, breadcrumbs, research requests, flagged phrases, and content seeds. Atlas Cues are optional hints, not strict commands.

Do not move or delete fresh capture files during processing. For Capture items older than seven days, process and file directly when clear, then delete the working capture after verifying an identical preserved original and completed filing.

Copy untouched originals to `02-Library/Sources/Inbox-Originals/`.

Create processed notes in `01-Inbox/02-Review/` with `status: under-review`.

For fresh or ambiguous items, propose new Library notes, wiki links, updates, and filing destinations inside the review note. For stale Capture items older than seven days, file clear content directly into the appropriate Atlas folder and create Review notes only for unresolved ambiguity, conflict, or sensitive decisions.

Put the Quick Approval block from `00-System/Processing-Rules.md` immediately below the title of every actionable review note.

Treat meaningful meetings, calls, visits, and important emails as interaction candidates. Ordinary mentions should be linked without creating interaction notes.

Follow `00-System/Privacy-Rules.md`. Do not repeat secrets in review notes or final knowledge.

Clear, low-stakes tasks may be created directly in `05-Tasks/02-This-Week/` or `05-Tasks/04-Someday/`. Sensitive, ambiguous, work-critical, health-related, financial, legal, or relationship-sensitive tasks should go to Review first.

Use useful Obsidian-style `[[wiki-links]]`, but avoid excessive linking.

Log every file or folder change in `00-System/Change-Log.md`.

When uncertain, create a review note explaining the uncertainty instead of silently deciding.
```
