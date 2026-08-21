# Public GitHub Checklist

Before pushing `atlas-app` to a public repository:

- Confirm the working tree contains source, docs, templates, and fictional
  demo data only.
- Confirm the real vault is outside the repository.
- Run `npm run check:all`.
- Build the Tauri bundle on a supported desktop platform.
- Exercise the browser demo at desktop and narrow widths.
- Scan tracked files for credentials, home-directory paths, names, locations,
  and private project terms.
- Inspect `git diff --check` and the exact staged file list.
- Confirm `.env*`, `.atlas-local/`, `.atlas/`, app settings, and Cargo/Node
  build output are untracked.
- Review `docs/security.md` and `docs/agent-access.md` after any permission or
  processor change.
- Push without force and verify the remote commit.

Never use a real Capture excerpt as a test fixture. Reproduce with
`demo-vault/` or `src/lib/demoFs.ts`.
