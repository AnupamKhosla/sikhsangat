# Handoff: Proxies Repo Only

Repo path:

`/Users/anupamkhosla/Desktop/Coding/proxies`

## Goal

Create a standalone public repo for protected fetch proxies used by scraper projects.

## Naming

The repo/folder name should stay:

`proxies`

## Scope

Start lean:

- Fully working Vercel endpoint
- Bare provider stubs for Render / GCloud / Oracle
- Shared auth/allowlist/fetch logic
- No committed secrets

## Expected Files

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

## Contract

Vercel:

- `GET /api/health`
- `GET /api/fetch?url=...`

Long-running providers:

- `GET /health`
- `GET /fetch?url=...`

Auth:

- `Authorization: Bearer <token>`
- or `x-scraper-token`

Allowlist:

- driven by `ALLOWED_FETCH_HOSTS`

## Remaining Work

1. Verify the scaffolded files exist and are coherent
2. `npm install`
3. `npm run check`
4. Fix any syntax or import issues
5. `git init`
6. `git add -A`
7. Create a clean first commit
8. `gh repo create`
9. `git push -u origin main`

## Suggested Commit Message

Subject:

`Initialize protected proxy gateway`

Body:

`Add a Vercel-ready protected fetch endpoint, shared auth/allowlist/fetch core, and minimal provider stubs for Render, GCloud, and Oracle.`

## Suggested GitHub Repo Description

`Protected multi-provider fetch proxies for scraper workloads`
