# Handoff: Scraper + Proxies

Read this file first in the next Codex session.

## Current Goal

There are two connected workstreams:

1. Keep repairing and stabilizing the SikhSangat scraper/mirror in this repo.
2. Build a new sibling repo for generic protected proxy endpoints at:

`/Users/anupamkhosla/Desktop/Coding/proxies`

The immediate priority is the new `proxies` repo, starting with a Vercel-ready endpoint.

## Scraper Repo State

Repo path:

`/Users/anupamkhosla/Desktop/Coding/Scrapper`

Known context:

- The scraper still sees many real upstream `HTTP 500` responses.
- Multi-level seed work exists in this repo.
- There was also a remote fetch fallback idea added in a prior session, but the new dedicated `proxies` repo is now the preferred direction.
- The dashboard port issue was environmental and inconsistent across sessions; in one manual run the user got the dashboard working on port `3020`.

Important files to inspect:

- `src/main.js`
- `src/dashboard-server.js`
- `seed_multilevel.json`
- `src/multilevel-seed-manager.js`
- `README.md`
- `DOCUMENTATION.md`

## New Proxies Repo

Target repo path:

`/Users/anupamkhosla/Desktop/Coding/proxies`

This repo was already scaffolded as a sibling of `Scrapper`.

Current intended structure:

- `package.json`
- `.gitignore`
- `.env.example`
- `vercel.json`
- `README.md`
- `api/fetch.js`
- `api/health.js`
- `shared/config.js`
- `shared/auth.js`
- `shared/http.js`
- `shared/fetch-target.js`
- `shared/health.js`
- `providers/render/server.js`
- `providers/oracle/server.js`
- `providers/gcloud/index.js`
- `providers/vercel/api/README.md`

The design intent:

- Keep this repo generic for multiple projects, not scraper-specific.
- First real deployment target is Vercel.
- Render / GCloud / Oracle are only bare stubs right now.
- The proxy contract should stay stable across providers:
  - `GET /api/fetch?url=...` on Vercel
  - `GET /api/health` on Vercel
  - `GET /fetch?url=...` on long-running providers
  - `GET /health` on long-running providers
  - auth via `Authorization: Bearer <token>` or `x-scraper-token`
  - host allowlist via env vars

## What Was Finished

- The `proxies` folder was created.
- The initial file scaffold was written.

## What Was NOT Finished

These steps still need to be completed:

1. Verify the files in `/Users/anupamkhosla/Desktop/Coding/proxies`
2. Run `npm install`
3. Run syntax checks
4. Fix any issues found
5. Initialize git in the `proxies` repo
6. Create a sane first commit
7. Create a public GitHub repo with `gh`
8. Push the repo
9. Optionally connect it to Vercel and document deploy env vars

## Constraints / Preferences

- User wants "Gemini yolo" style autonomy.
- User wants the new repo to be named exactly `proxies`.
- Repo should be public.
- Secrets should not be committed.
- Use env vars from provider dashboards manually later.
- Vercel should be fully working first.
- Other providers should be only skeletal, not overbuilt.

## Recommended Next Actions

1. Inspect `/Users/anupamkhosla/Desktop/Coding/proxies`
2. Complete `npm install`
3. Run checks
4. Initialize and push the `proxies` repo
5. Only after that, decide whether to wire the scraper here to use the new proxy

## Suggested First Commands

Check repo contents:

```bash
cd /Users/anupamkhosla/Desktop/Coding/proxies
find . -maxdepth 3 -type f | sort
```

Install and verify:

```bash
cd /Users/anupamkhosla/Desktop/Coding/proxies
npm install
npm run check
```

Then proceed with git/GitHub setup.
