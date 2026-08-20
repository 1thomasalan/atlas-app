# Agent Access Plan

Atlas App is moving toward secure agent access without exposing the whole vault.

The near-term pattern is:

```text
Agent -> Atlas local API -> scoped operation -> Markdown change -> Change Log
```

## Principles

- Agent access is off by default.
- The user enables it in Atlas settings.
- Access is local-first and scoped.
- Meaningful writes remain review-gated unless Atlas rules explicitly allow direct filing.
- Every write is logged in `00-System/Change-Log.md`.
- Secrets are never copied into review notes or final notes.

## Candidate Scopes

```text
capture:create
capture:read
review:read
review:propose
task:update
routine:log
project:propose
library:read
file:dropbox
```

Start with the smallest useful scopes:

1. Create Capture item
2. Read Review Queue
3. Propose Review note
4. Log completed action

## Agent Zero Notes

Agent Zero currently runs through a Docker-based setup by default, and its docs describe optional A0 CLI host access for local files, host terminal execution, and browser workflows:

- https://www.agent-zero.ai/p/docs/installation/
- https://www.agent-zero.ai/p/docs/

That makes a scoped Atlas local API preferable to mounting an entire personal vault into the Agent Zero container. For a future music workflow, an agent should receive a watched drop folder or a single uploaded artifact plus specific scopes, not unrestricted vault access.

## Example Music Workflow

```text
Drop MP3 into allowed intake folder
-> Atlas creates Capture record
-> Agent reads only the intake item and relevant project settings
-> Agent proposes artwork and distribution steps
-> User approves external actions
-> Agent uploads to configured services
-> Atlas records outcome and links assets
```

External actions such as publishing, distribution uploads, account changes, spending, or messaging should require explicit approval.
