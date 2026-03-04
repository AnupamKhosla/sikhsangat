# SikhSangat Replicator: The Digital Immortality Documentation

## I. Abstract
The SikhSangat Replicator is a state-of-the-art web archiving engine designed to forge a perfect, 100% offline-compatible mirror of complex Invision Community platforms. Utilizing a sophisticated "State Baking" architecture, the system transcends traditional static scrapers by leveraging headless browser orchestration (Playwright) to trigger, capture, and flatten dynamic AJAX content, lazy-loaded assets, and interactive UI states into a standalone static archive. With an aggressive 3x3 stealth strategy—incorporating Tor circuit rotation, SOCKS5 proxy pools, and CORS-bypassing asset fetchers—the engine navigates server-side rate limits and connection bottlenecks with surgical precision. It ensures visual and functional fidelity through automated visual regression testing (VRT) and pixel-perfect audits, delivering an immortalized digital sanctuary that functions flawlessly without internet connectivity.

---

## II. System Architecture: The State Baking Engine
Traditional scraping (Wget, HTTrack) fails on modern Invision Community sites because content is locked behind JavaScript interactions and AJAX calls. The Replicator uses a **Playwright-first** approach:
1.  **Dynamic Rendering:** Every page is rendered in a full browser context to execute JavaScript.
2.  **Interaction Probing:** Instead of relying on hardcoded selectors, the engine probes the DOM for elements that hold event listeners or common IPS interactive attributes (`data-action`, `data-role`, `ipsPagination`).
3.  **State Flattening (Baking):** Once all AJAX content (tabs, "load more", infinite scrolls) is triggered, the engine captures the expanded DOM and saves it as static HTML. This "bakes" the dynamic state into a portable file.

## III. The 3x3 Stealth Matrix
To bypass AWS-based rate limits and Apache connection caps, the Replicator employs a tri-layered network strategy:
- **Layer 1: The Tor Siphon:** All primary HTML requests are routed through a local Tor SOCKS5 proxy (port 9050), rotating circuits to maintain anonymity.
- **Layer 2: SOCKS5 Proxy Pools:** A validated pool of external proxies provides secondary rotation for asset-heavy fetches.
- **Layer 3: CORS Bypass Fetching:** Asset fetchers are configured to bypass `Access-Control-Allow-Origin` restrictions by relativizing paths at the source and hosting them locally.

## IV. Offline Integrity Protocol (OIP)
A mirror is worthless if it breaks without a heartbeat. The OIP ensures 100% standalone functionality:
- **The CSS Font Trap:** The system identifies absolute FontAwesome/Google Font URLs inside CSS files, downloads the binary assets, and rewrites the CSS to use local relative paths.
- **URL Relativization:** Every `href` and `src` is converted from absolute `sikhsangat.com` URLs to relative local paths (e.g., `../../topic/123/`).
- **History API Shimming:** Fixes `SecurityError` during local file navigation by shimming `pushState` and `replaceState` to work on the `file://` protocol.

## V. Discovery & Infinite Intelligence
The engine does not just follow links; it understands structure:
- **Intelligent Discovery:** Uses a combination of sitemap extraction and link discovery to map the entire forum.
- **AJAX Discovery:** Detects "Load More" buttons and infinite scroll triggers to capture deep-threaded content that standard scrapers miss.
- **Asset Mapping:** Automatically maps assets from subdomains (e.g., `files.sikhsangat.com`) into a unified local structure.

## VI. Monitoring & Verification
- **macOS QA Dashboard:** A real-time Socket.io-powered dashboard provides instant visibility into crawl progress, jitter status, and thread health.
- **Visual Regression Testing (VRT):** A pixel-by-pixel comparison engine captures screenshots of the mirrored page vs. the live page, scoring them for fidelity. A score below 90% triggers an automatic re-scrape or quarantine.
- **Log Audit:** Compares disk states with UI logs to ensure zero data loss during high-concurrency operations.

## VII. Operational Mandates
- **Foreground Execution:** For absolute reliability and observability, the main engine runs in the foreground.
- **Memory Safety:** Reuses a persistent browser instance for VRT and verification to prevent JS heap exhaustion.
- **Sandbox Enclosure:** The entire project is locked behind a macOS Kernel sandbox to protect system integrity while performing high-volume network operations.

---
*Created by the Gods of Mirroring.*
