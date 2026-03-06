# Common Hallucinations & Corrections

## 1. The CORS Font Trap (Ignored in early versions)
- **Hallucination:** "Downloading the CSS is enough to fix the layout."
- **Correction:** Invision Community CSS contains absolute URLs for fonts (FontAwesome). Simply saving the CSS causes CORS blocks on GitHub Pages. The engine MUST scan every `.css` file for `url()` patterns, download the fonts locally, and rewrite the CSS to use relative paths.

## 2. Browser Verification Memory Leak (The February 2026 Crash)
- **Hallucination:** "We can launch a new browser for every page verification to ensure a clean state."
- **Correction:** This leads to a `JS heap out of memory` error (The Heap Stack Crisis). Launching 50+ browser processes concurrently exhausts system memory. The engine MUST use a single, shared `testBrowser` instance for all offline verifications.

## 3. GitHub Pages Directory Misalignment
- **Hallucination:** "Saving to `sikhsangat_offline` is fine for Git."
- **Correction:** GitHub Pages defaults to the `docs/` folder for branch-based deployment. The scraper must save directly to `docs/` to ensure the archive is immediately hostable without manual moving.

## 4. Local IP Leakage
- **Hallucination:** "The local IP is safe for small asset fetches."
- **Correction:** Any connection to `sikhsangat.com` from the local IP risks a block. ALL requests, including images and fonts, must go through the proxy rotation or the CORS proxy pool.

## 5. Offline Integrity (Runtime Leaks)
- **Hallucination:** "Absolute links in HTML are fine as long as they point to the live site."
- **Correction:** A 100% offline mirror must never attempt to contact the live site at runtime. All absolute URLs to the target domain must be relativized before saving to ensure the archive is standalone and survives live-site downtime.

## 6. Background Process Failure
- **Hallucination:** "Running long-running tasks like the scraper with `is_background: true` is more efficient."
- **Correction:** Background execution in the agent environment frequently leads to lost stdout/stderr, failed service bindings (e.g., dashboard port 3000), and unobserved startup crashes. For reliability and real-time observability, the scraper MUST be run in the **foreground**.

## 7. Pagination Is Solved Once Links Rewrite
- **Hallucination:** "If saved HTML points to `./page/2/index.html`, pagination is effectively solved."
- **Correction:** Link rewriting only fixes offline navigation for pages that already exist. The scraper must also promote discovered pagination and related URLs ahead of the seed backlog, or page 2/page 3 will arrive far too late to feel correct.

## 8. No Live Links Means No QA Source Link Anywhere
- **Hallucination:** "Strict mirror rules mean the dashboard should not expose any live-source URL."
- **Correction:** The mirrored archive must stay fully offline, but the operator dashboard is allowed to expose an explicit, opt-in live-source QA link so the user can compare local vs. origin behavior quickly.
