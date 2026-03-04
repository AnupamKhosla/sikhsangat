# SikhSangat Replicator: The Digital Immortality Protocol
**Copyright (c) 2026 Anupam Khosla. All Rights Reserved.**

## I. Divine Mandates (Hard Operational Constraints)
- **The macOS Enclosure:** The agent is strictly confined to `/Users/anupamkhosla/Desktop/Coding/Scrapper`. Verification via `ls /Users/anupamkhosla/Desktop/Documents` returning `Operation not permitted` is mandatory before every task.
- **The Knowledge Precedence:** `GEMINI.md` is the supreme instruction. `hallucinations.md` must be consulted at the start of every session. `DOCUMENTATION.md` is an output and must be updated as code changes.
- **The Foreground Law (CRITICAL):** Currently, the engine must always be run in the foreground (`node index.js`) for absolute observability. The agent is forbidden from using `is_background: true` when starting the scraper for now, but **MUST eventually find a way to implement a stable, autonomous background mode.**
- **The Dashboard Commandment:** `http://127.0.0.1:3000/` is the only source of truth. The agent must ensure it displays the correct physical file count and real-time logs.
- **The Zero-Git Constraint:** Git operations are prohibited within the sandbox. Use an external tab for version control.
- **API Resilience:** During periods of high API demand (503 errors), the operator should set `export GEMINI_TIMEOUT=1800000` to allow the Gods of AI enough time to process complex architectural shifts.

## II. Mission: Eternal Preservation
The mission is to forge a perfect, 100% offline-compatible digital sanctuary of `sikhsangat.com`. We are not merely scraping; we are immortalizing a culture and a community.

## III. The Architecture of Perfection
- **State Baking:** Using Playwright to render, trigger AJAX, and flatten dynamic states into static HTML.
- **Local IP Mandate:** All proxies (Tor, SOCKS5) are DISABLED per user request. Use the local PC IP for all fetches.
- **Reverse-Fetching Protocol:** If the scraper encounters consecutive HTTP 500 errors (indicating a blocked range), it must reverse its seed list to find unblocked content.
- **Intelligent Discovery:** Dynamic probing of the DOM for interactive triggers (Pagination, "Load More", Tabs).

## IV. Technical Specs & Verification
- **Jitter Protocol:** No more than 2 fetches within the jitter period. If jitter is 2000ms, fire 2 requests, then wait 2000ms, then fire next 2.
- **Concurrency:** Limited by the Jitter Protocol (effectively 2 per jitter).
- **Verification (VRT):** Pixel-by-pixel audit of mirrored pages vs. live pages. A score below 90% is a failure.
- **Offline Integrity:** All absolute links relativized. Sign-up modals neutralized.

## V. Strategic Evolution & Pitfalls (The God Level Shift)
- **The API Timeout Pitfall:** Address Gemini CLI 503 errors by setting environment timeouts.
- **The Jitter Hallucination:** Agents often fail to implement the exact 2-request-per-jitter-period requirement.
- **The Proxy Pitfall:** SOCKS5 proxies often lead to 500 errors. Stick to local IP until a better stealth solution is found.
- **The Background Execution Pitfall:** Agents fail to maintain live logs and dashboard connectivity in the background. Foreground is mandatory until this is solved.
- **The Dashboard Saved Count Pitfall:** Ensure the UI accurately reflects the physical file count in `docs/`.

## VI. How to Command the Engine
1. **Initiate:** `node index.js`
2. **Monitor:** `http://127.0.0.1:3000` (macOS QA Dashboard)
3. **Audit:** `node src/verify-dashboard.js`
4. **Halt:** `node stop.js`

---
*We are the architects of history.*
