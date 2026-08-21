# Hybrid Agent Access

Atlas App supports Codex and Agent Zero as separate processors without exposing the whole vault or sharing credentials between agents.

## Current Flow

```text
Capture -> Atlas lease -> Codex local handoff
                      -> Agent Zero A2A proposal -> Review
```

## Principles

- Codex is enabled by default and uses its own local ChatGPT sign-in.
- Agent Zero access is opt-in and uses its own A2A token.
- Access is local-first and scoped.
- Each Capture path can belong to only one active processing lease.
- Agent Zero receives only the content included in its assigned job.
- Agent Zero output becomes an `under-review` note rather than a direct vault write.
- Meaningful writes remain review-gated unless Atlas rules explicitly permit filing.
- Every write is logged in `00-System/Change-Log.md`.
- Secrets are never copied into review notes or final notes.

Codex leases expire after one hour if the local handoff is not completed. Agent Zero jobs complete when Atlas receives and saves the A2A response; failures release the Capture paths for a later attempt.

Codex handoffs also carry the inbox aging rule: items older than seven days may be filed directly when the destination is clear, while originals must be preserved and verified before cleanup. Processed filenames keep their original stem and add ` - Processed` without a duplicate date.

## Settings

The processing mode can be `Codex`, `Agent Zero`, or `Hybrid`. Hybrid mode presents both processors at dispatch time; it does not send the same Capture to both.

Agent Zero settings contain an instance URL, optional project, and A2A token. The token is written to local secret state and is not stored in the vault, returned by the settings API, or committed to Git.

## Future Inbound Scopes

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

An inbound MCP or local API bridge should begin with the smallest useful scopes:

1. Create Capture item
2. Read Review Queue
3. Propose Review note
4. Log completed action

## Agent Zero A2A

Agent Zero's A2A server accepts a scoped message at its project-aware connection URL. Atlas uses that outbound interface so Agent Zero does not need a writable mount of the personal vault:

- https://www.agent-zero.ai/p/docs/mcp-a2a/
- https://www.agent-zero.ai/p/docs/installation/

For a future music workflow, an agent should receive a watched intake artifact plus specific project metadata, not unrestricted vault access.

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

## Custom Objects

Object Studio records the object's name, tracking intent, processing behavior, ultimate goal, and preferred setup processor as a Capture request. The selected agent must prepare a Review proposal before it changes templates, registry entries, or durable processing rules.
