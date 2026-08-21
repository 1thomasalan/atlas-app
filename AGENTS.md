# AGENTS

Atlas App is the public code repository for working with private Atlas Markdown vaults.

## Prime Directive

Do not add private vault data to this repository.

This repo may contain:

- app source code
- docs
- generic templates
- sample agent instructions
- build configuration

This repo must not contain:

- a real Atlas vault
- captures
- review archives
- inbox originals
- health logs
- relationship notes
- private project notes
- `.env.local`
- `.atlas-local/`
- credentials, API keys, tokens, or passwords

## Development

Use app settings to point to a local vault. Keep all local state untracked.

Before publishing changes, run:

```bash
npm run check:all
```

Then scan for private data:

```bash
git ls-files -z | xargs -0 rg -n "api[_-]?key|password|token|secret|/Users/|/home/"
```

## Architecture Rule

Prefer narrow, semantic operations over broad file-write access. Atlas App should make explicit Markdown changes and log them in the configured vault.
