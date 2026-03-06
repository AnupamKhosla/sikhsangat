# SikhSangat Replicator Documentation

## Overview
The project mirrors `sikhsangat.com` into `docs/` as a local-first static archive. The current implementation uses one shared rewrite layer for both newly scraped pages and already-saved pages so the archive does not drift between “old” and “new” content.

## Current Architecture
1. `index.js`
   Starts the dashboard, periodic audit worker, and scraper in the foreground.
2. `src/main.js`
   Runs the Playwright-based scraper with a desktop browser profile, two-worker jittered scheduling, dynamic-state baking, asset capture, and shared HTML/CSS rewriting.
3. `src/mirror-utils.js`
   Central mirror logic for:
   - URL normalization and query-aware local path mapping
   - HTML rewriting and live-link removal
   - CSS `url(...)` rewriting for fonts/icons/background assets
   - `root_map.js` rewriting for offline compiled controller loading
   - relocation/removal of stray head scripts that break IPS boot order
   - captcha and analytics stripping for offline pages
   - offline runtime injection
   - shared offline support files in `docs/_offline/`
4. `src/repair-existing-mirror.js`
   Rewrites the existing `docs/` archive in place using the same mirror rules as the live scraper, including HTML, CSS, and `root_map.js`.
5. `src/audit-existing.js`
   Audits saved HTML for server-error pages, live target URLs, missing offline runtime assets, and live form actions.
6. `src/dashboard-server.js`
   Serves the mirror dashboard and paginated QA list from the local archive.
7. `src/vrt-worker.js`
   Reuses a shared browser/context for screenshot comparison work to avoid runaway Playwright process growth.

## Offline Integrity Rules
The archive is treated as failed if any of the following remain in saved pages:
- live `www.sikhsangat.com` or `files.sikhsangat.com` URLs
- live form actions
- Google Fonts references
- live analytics / captcha bootstraps
- CSS font/background URLs that still point to the live origin
- missing offline runtime support files

The repair/scrape pipeline now injects shared support files under `docs/_offline/`:
- `offline-mirror.css`
- `offline-mirror.js`
- `mirror.webmanifest`
- `browserconfig.xml`

## URL and Pagination Mapping
Query-driven pages are no longer collapsed onto the same file path.
Examples:
- `...?page=2` maps into `/page/2/index.html`
- tab and other meaningful query parameters are encoded into deterministic local subpaths
- assets keep file-style paths instead of being treated as HTML pages

This is the key fix that prevents pagination and query-state collisions.
Newly discovered pagination and related pages are now queued ahead of the remaining seed backlog, so page chains continue immediately after a successful parent fetch instead of waiting behind thousands of seeds.

## Dynamic State Baking
Before saving a page, the scraper now:
- uses a desktop viewport instead of the previous mobile emulation
- smooth-scrolls the page to trigger lazy media
- clicks common IPS tab/load-more/expand targets
- captures loaded assets and rewrites the final baked HTML

Pagination links are preserved as local links instead of live links.
The scheduler now upgrades already-queued URLs if they are rediscovered as pagination or related pages, so they are not stranded at seed priority.

## Dashboard Behavior
The dashboard is now self-contained:
- no Bootstrap CDN dependency
- mirror-first QA links
- stable sorted pagination for QA browsing
- direct page jump controls (`First`, `Previous`, numeric jump, `Next`, `Last`)
- current-session-only log replay so stale log history does not masquerade as a live run
- explicit live-source QA links on dashboard cards only; mirrored pages themselves remain live-free

## Commands
- `node index.js`
  Starts dashboard, audit worker, and scraper in foreground mode.
- `npm run repair`
  Rewrites the existing archive in `docs/` using the current mirror rules.
- `npm run audit:once`
  Runs a one-shot archive audit.
- `npm run audit`
  Runs the audit worker continuously.
- `node stop.js`
  Stops active workers started by the lifecycle scripts.

## Verification Status
The current local verification baseline is:
- `node --check` passes for the updated source files
- `npm run audit:once` passes against the repaired archive
- archive grep for live `sikhsangat.com` / `files.sikhsangat.com` URLs returns zero matches in saved HTML/CSS/JS
- headless `file://` verification currently passes at zero runtime errors on:
  - `docs/www.sikhsangat.com/index.html`
  - `docs/www.sikhsangat.com/discover/index.html`
  - `docs/www.sikhsangat.com/forum/28-general/index.html`
  - `docs/www.sikhsangat.com/topic/82567-please-read-it-brings-peace/page/2/index.html`

## Remaining Work
The current codebase still needs real browser verification in an unrestricted environment for:
- screenshot/VRT execution
- dashboard port binding checks
- live scrape validation against the origin
- deeper AJAX behavior validation on newly fetched pages

Those runtime checks are blocked in the present sandbox, but the code paths and local archive rewrite logic are now aligned.
