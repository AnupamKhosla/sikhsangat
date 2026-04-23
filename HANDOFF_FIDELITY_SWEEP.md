# Handoff: Fidelity Sweep + Proxy Wiring (partial, not validated)

Date: 2026-04-23. Agent: Claude Sonnet 4.6. Status: **shipped but barely tested — assume broken until verified**.

## What was changed

Two commits on `main` of `github.com/AnupamKhosla/sikhsangat.git`:

1. `6f605e5` — dotenv wiring for remote-fetch.
   - Added `dotenv` dependency.
   - `import 'dotenv/config';` prepended to `index.js`, `src/main.js`, `src/verify-page-fidelity.js`.
   - New `.env.example` (committed, placeholders only).
   - Local `.env` (gitignored) with real `SCRAPER_REMOTE_FETCH_ENDPOINT=https://crimewiki.site/proxy.php` and the real `SCRAPER_REMOTE_FETCH_TOKEN` value (pulled from `/Users/anupamkhosla/Documents/Codex_Projects/secrets.env`).

2. `b038b21` — bulk fidelity sweep.
   - New `src/fidelity-sweep.js` that walks `docs/www.sikhsangat.com/` for `index.html`, reverse-maps path → live URL, runs the existing `verifyUrl` from `src/verify-page-fidelity.js` with a shared browser, concurrency 2, jitter 2000ms per `GEMINI.md`.
   - Exports added to `src/verify-page-fidelity.js`: `verifyUrl`, `buildBrowser`, `startMirrorServer`. Its CLI `main()` is now gated with an is-entry check so importing the module no longer triggers a run.
   - `package.json` scripts: `verify:sweep` and `refresh:stale` (the latter is `SCRAPER_SEED_FILE=logs/fidelity-reports/stale.json node index.js`).
   - Writes `logs/fidelity-reports/stale.json` (seed-compatible URL list) and `logs/fidelity-reports/sweep-report.json` (full result dump).

## What was actually verified

- `node --check` passed on all new/edited files.
- `import('./src/fidelity-sweep.js')` resolved (module graph loads).
- `npm run verify:sweep -- --limit 1` ran end-to-end once. **It picked up an IPS internal path (`/__app/core/__controller/profile/__id/3515/__module/members/`), reverse-mapped it literally, hit Playwright, got a verify-error, and stopped.** The full-budget scraper was not run. The proxy fallback was not exercised. No real topic/forum page was verified.

## What is almost certainly broken or unverified

1. **Reverse path → URL mapping.** `localPathToLiveUrl()` in `src/fidelity-sweep.js` does a literal strip of `docs/www.sikhsangat.com/` + `/index.html` + trailing `/`. This:
   - Produces nonsense URLs for IPS internal `__app/__controller/__module/...` paths (confirmed: first walked file is exactly this kind).
   - Has not been tested on forum / topic / pagination URLs. It may or may not round-trip through `getLocalPath()` in `mirror-utils.js`. If it doesn't, `verifyUrl` will report `missing-local-page` for real pages.
   - Queries (`?page=N`, tab params) are NOT handled by this reverse map. The forward `getLocalPath()` encodes query state into subpaths — reversing that requires reading the local file's content or using a manifest, which the sweep does NOT do.

2. **Proxy flow not validated.** Token is in `.env`, `src/remote-fetch.js` reads it, `src/main.js` has the fallback branch (lines ~584–620). None of this was executed. If `crimewiki.site/proxy.php` is down, unreachable, or the token is wrong, the scraper will silently fall through to local-only fetches. No end-to-end test was performed.

3. **Concurrency/jitter semantics.** Sweep claims "2 per jitter period" per `GEMINI.md`, but the implementation is "batches of `concurrency`, then sleep `jitter`." This is approximately right for default values (2, 2000ms) and wrong for other values. Don't change defaults without re-reading.

4. **`refresh:stale` script was not run.** It shells into `node index.js` with `SCRAPER_SEED_FILE` — the seed file format is an array of URL strings, which matches what the sweep writes. Untested.

## Recommended next steps (in order)

1. **Before anything else**, add a filter in `fidelity-sweep.js` that skips paths matching `/__app/`, `/__controller/`, `/__id/`, `/__module/`, and any other IPS internal route fragment. The first sweep failure was from exactly this. Candidate implementation: pre-filter `allLocal` by regex before reverse-mapping.

2. Validate the reverse mapping on ~5 known-good URLs: a forum root, a topic, a topic page 2, a discover page. Inspect `logs/fidelity-reports/sweep-report.json` after `npm run verify:sweep -- --limit 10` and confirm either mismatches OR passes — NOT `missing-local-page`. If lots of `missing-local-page` come back, the reverse map is wrong for the majority of URLs and needs a different strategy (e.g. a forward-write manifest mapping URL → localPath emitted by `src/main.js` at save time, then read back by the sweep).

3. Validate proxy flow in isolation: `curl -H "Authorization: Bearer $SCRAPER_REMOTE_FETCH_TOKEN" "https://crimewiki.site/proxy.php?url=https%3A%2F%2Fwww.sikhsangat.com%2F"` — expect HTML, not 401. If 401, the token on crimewiki VM and the local token are out of sync.

4. Only after 1–3 pass, run full sweep: `npm run verify:sweep -- --concurrency 2 --jitter 2000`. Expect ~17+ minutes for all ~3070 pages.

## Loose context

- The sweep walks 3070 mirrored pages (`find docs -name index.html | wc -l`).
- IPS internal `__app` paths were sorted first alphabetically — that's why `--limit 1` hit junk.
- `GEMINI.md` (which outranks anything I wrote) says: jitter = 2 requests per period max; pixel VRT threshold 90%; foreground only; local IP mandate unless user opts into proxy; 5px click sweep is explicitly deferred.
- `hallucinations.md` entry #2 (Feb 2026 OOM crash) is respected by the sweep — it reuses one browser and one context for the whole run.
- `.env` is in the standard gitignore; do NOT commit it; if you need to rotate the token, regenerate on the crimewiki VM (`/etc/secrets/secrets.env` → `PROXY_SECRET_TOKEN`) and update `Scrapper/.env`.

## What this session did NOT do

- Did not implement pixel-diff VRT (the existing `verifyUrl` already does this).
- Did not touch dynamic baking in `src/main.js`.
- Did not improve 500-resilience logic.
- Did not run the actual scraper against live.
- Did not verify the deployed GitHub Pages archive.
