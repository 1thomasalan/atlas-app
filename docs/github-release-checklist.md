# Public GitHub Checklist

Before pushing `atlas-app` to a public GitHub repository:

- Confirm the repo contains app code, docs, and templates only.
- Confirm your real Atlas vault is outside the repo.
- Confirm `.env.local` and `.atlas-local/` are not tracked.
- Run `npm run check:web`.
- Run a private-data scan with `rg`.
- Review `docs/security.md`.
- Decide whether MIT is the license you want to keep.
- Create the GitHub repository as public.
- Push only after the scan is clean.

Suggested remote:

```bash
git remote add origin git@github.com:<owner>/atlas-app.git
git branch -M main
git push -u origin main
```
