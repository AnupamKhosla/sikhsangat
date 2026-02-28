# Project: SikhSangat Mirroring (Scrapper)
**Copyright (c) 2026 Anupam Khosla. All Rights Reserved.**

## Mission
To create a high-performance, anonymous, and robust scraper that generates a fully functional offline mirror of `sikhsangat.com`.

## Legal & Ethical Use
- **Purpose:** This tool is designed for ethical web archiving, historical preservation, and security auditing.
- **Mandate:** Users must have explicit permission to clone non-public or private data. It is intended for use on sites owned by the operator, client sites under contract, or public forums for the purpose of posterity.
- **Responsibility:** The developer (Anupam Khosla) is not responsible for any misuse of this tool.

## Technical Compatibility
- **Primary Focus:** Optimized for **Server-Side Rendered (SSR)** platforms like Invision Community, WordPress, and standard PHP forums.
- **SPA/React Compatibility:** The engine uses **Playwright** to render the DOM, making it capable of mirroring Single Page Applications (SPAs). However, the "Intelligent Discovery" selectors are currently tuned for IPS forums and may require refactoring for generic SPA use.
- **State "Baking":** By capturing the rendered DOM after AJAX events, the tool effectively converts dynamic web apps into portable, static offline archives.

## Technical Requirements
- **Anonymity:** MUST use IP rotation (Proxies/Tor) for every request. NEVER use the local IP for target site requests.
- **Adaptive Scaling:** Start with low concurrency (e.g., 10 parallel fetches) and programmatically ramp up (toward 1,000+) only as long as the server remains healthy and no blocking/rate-limiting (429 errors) is detected.
- **Monitoring & Feedback Loops:** The system must monitor success rates and response times in real-time. If failure rates spike, it must automatically throttle down and rotate the proxy pool.
- **Offline Integrity:** All absolute links to `sikhsangat.com` must be converted to relative local paths.
- **Resilience:** Handle slow PHP responses (120s+ timeouts) and implement a retry logic (3-5 attempts per URL).
- **State Management:** Maintain `visited` and `queue` states to allow resuming after a crash or stop.

## Core Components
- `seed-extractor.js`: Fetches 130+ sitemaps via Tor to populate `seed_urls.json`.
- `proxy-tester.js`: Refreshes and validates a pool of HTTP/SOCKS proxies.
- `ultimate-parallel-scraper.js` (PENDING): The main engine that will handle high-concurrency proxy-rotated downloads.

## Architecture Decisions
- **Primary Engine: Node.js + Crawlee:** We will use the `Crawlee` framework for its professional-grade queue management, adaptive scaling, and proxy handling.
- **JS-Centric Development:** Staying in JS ensures the developer can maintain the code. Raw speed (Go/Python) is secondary to stealth; jitter and network delays are the primary limiters.
- **Cheerio-First Strategy:** Use `CheerioCrawler` (raw HTTP) for the 95% of pages that are static HTML. Only "level up" to `PlaywrightCrawler` for the few pages that require JavaScript rendering.
- **Proxy-First Mandate:** Every outbound request to `sikhsangat.com` must be routed through a unique IP (Proxy or Tor). The local IP is strictly for control.

## Advanced Discovery & Replication
- **AJAX "Baking" Strategy:** To ensure the offline mirror works without a server, the scraper must trigger all AJAX events (Tabs, Load More, Popups) and wait for the DOM to expand before saving the HTML.
- **Navigation vs. AJAX (Calculative Guess):**
    - **Target:** Elements with `data-ips*`, `data-action`, or `href="#"`.
    - **Avoid:** Blind clicking of `<a>` tags with full URLs to prevent premature navigation.
- **Network Interception:** Use Playwright's `page.on('request')` to identify if a click triggers an `xhr/fetch` (AJAX) or a `document` (Navigation).
- **Subdomain Asset Handling:** All assets from `files.sikhsangat.com` and other subdomains must be downloaded and mapped to local folders to bypass CORS and ensure 100% visual fidelity.

## Asynchronous Workflow (Multi-Agent Mode)
- **Background Worker:** The crawler runs as a detached background process (`is_background: true`).
- **Interactive Consultant:** The chat agent remains available for discussion, code updates, and strategy without stopping the crawl.
- **Visual Monitoring:** Real-time progress is viewed via the Browser Dashboard at `http://localhost:3000`.
- **Termination:** Use `node stop.js` or ask the agent to stop the background workers.

## Performance Memory & Verified Specs
- **State File:** `logs/scraper_config.json` tracks optimal settings in real-time.
- **Verified Sweet Spot:** 
    - Jitter: **4000ms MAX CAP**. Do not exceed 4000ms. If a page fails, skip/quarantine it instead of slowing down the whole crawl.
    - Concurrency: **5 workers MINIMUM FLOOR**. Do not drop below 5. (Hard ceiling at 10-12).
- **QA Findings:**
    - **Health Score:** > 90% is reliable. < 80% MUST throw a hard error to force agent debugging.
    - **VRT:** Pixel-by-pixel matching is the primary health metric.

## AI-Driven Audit Rules
- **Log Sync Verification:** The system MUST periodically compare the physical `scraper.log` with the browser dashboard UI. Any mismatch or staleness triggers a process kill.
- **Real IP Enforcement:** Every fetch log MUST include the actual string-based IP address. A placeholder or missing IP triggers an immediate crash.
- **Behavioral Side-Testing:** Every saved page MUST undergo a functional test based on `SITE_ANALYSIS.md` (Tabs, Menus, Relative Links). Failure flips the `systemIsBroken` flag.
- **Watchdog Halt:** A 60s timer monitors the `systemIsBroken` flag and performs a Full System Halt on any failure.

## Lessons Learned (Operational History)
- **Background Fragility:** Early attempts at backgrounding failed due to silent startup errors. 
- **Solution:** Use `src/heartbeat.js` to verify port status and log activity before reporting success.
- **Server Bottleneck:** High concurrency (10+) triggers "Too many connections" errors on the Apache/IPS server.
- **Solution:** Adaptive Scaling starting at 2 workers with 4000ms jitter. Hard cap at 4000ms.
- **AJAX Baking:** Static mirrors of IPS forums fail because content is JS-loaded.
- **Solution:** Universal AJAX expansion script clicks all `data-ips*` elements before saving.

## Operational Pitfalls & Recurring Mistakes
- **IP Lookup Failures:** Occasionally `getVerifiedIp()` fails due to Tor circuit instability or API rate limits.
- **Agent Hallucination (Silent Failures):** The agent has a recurring tendency to return error strings (e.g., "IP_LOOKUP_FAILED") instead of throwing a hard error. 
- **MANDATORY FIX:** The scraper MUST NOT proceed with a fetch if the IP lookup fails. It must use `process.exit(1)` to kill the entire process immediately. No soft returns are allowed in the error path.
- **DB Overload Persistence:** Even with 4s jitter, the server can still return "Too many connections." 
- **Strategy:** Quarantine the URL immediately and move on to maintain throughput.
- **Foreground Error Catching:** When running the scraper in the foreground, any uncaught exception must explicitly trigger a process crash to force immediate agent intervention.
- **Proxy/Tor Limits:** Because Tor provides only one IP at a time, high concurrency (25+) leads to timeouts or 500 errors. 
- **Test Strategy:** Temporarily test with LOCAL IP at low concurrency (3 workers) to verify the core scraping logic works without the proxy bottleneck.

## How to Start / Resume
1. **Full Start:** Run `node index.js`. This starts the Proxy, Seed Waiter, and Scraper.
2. **Monitoring:** Open `http://localhost:3000` for the macOS QA Dashboard.
3. **Health Check:** Run `node src/heartbeat.js` to verify all background workers are healthy.
4. **Stopping:** Run `node stop.js`.
