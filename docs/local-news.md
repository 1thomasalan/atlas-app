# Local News Contract

Local News is a vault-local newspaper with two separate concerns:

1. A producer researches and verifies the current edition.
2. Atlas deterministically renders the stored edition.

The built-in producer uses the OpenAI Responses API with web search. An
optional scheduled agent can produce the same files. A failed producer must
leave the previous `current.json` untouched.

## Settings

Users configure a publication name, coverage area, preferred sources,
editorial focus and exclusions, and a vault-relative Markdown archive folder.
Personal locations and source preferences belong in app settings, not this
repository.

## Files

```text
your-vault/
  .atlas/local-news/current.json
  .atlas/local-news/YYYY-MM-DD-morning.json
  .atlas/local-news/YYYY-MM-DD-evening.json
  02-Library/Local News/<publication>-morning-YYYY-MM-DD.md
```

The archive folder is configurable. It must remain inside the connected vault.

## Current Edition Schema

```json
{
  "schemaVersion": 1,
  "date": "YYYY-MM-DD",
  "edition": "morning",
  "name": "Local News",
  "location": "City or region",
  "generatedAt": "ISO-8601 timestamp",
  "headline": "Verified lead headline",
  "dek": "Concise edition overview",
  "weather": null,
  "sections": [
    {
      "title": "Civic",
      "items": [
        {
          "section": "Civic",
          "title": "Story title",
          "summary": "Factual reader-value summary",
          "source": "Publisher or authority",
          "url": "https://example.com/direct-source",
          "date": "YYYY-MM-DD",
          "time": "HH:MM",
          "image": "https://example.com/source-image.jpg",
          "imageAi": false,
          "imageGenerated": false
        }
      ]
    }
  ],
  "events": [],
  "notes": [],
  "markdownPath": "/absolute/path/inside/the/selected/vault.md"
}
```

`edition` is `morning` or `evening`. Every item needs its own direct HTTP(S)
source URL. Dates and times must be exact when they are material. `weather` may
be null and `image`, `time`, and `dek` may be omitted. `imageAi` identifies
model-generated editorial artwork; `imageGenerated` also covers the offline
procedural fallback. Atlas labels both so generated artwork is never presented
as source photography. `notes` contains material verification gaps, not routine
editorial narration.

## Producer Rules

- Prefer primary sources and reputable local reporting.
- Deduplicate the same underlying event.
- Never invent a source URL, date, time, or unstable fact.
- Omit unverifiable items or record a material gap in `notes`.
- Write the Markdown archive before replacing `current.json`.
- Keep credentials outside the vault and repository.
