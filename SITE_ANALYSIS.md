# Site Analysis: sikhsangat.com (Invision Community)

## Technical Architecture
- **Origin IP:** `18.221.214.42` (AWS EC2 Instance)
- **Web Server:** Apache
- **Engine:** Invision Community (IPS) v4.x (PHP/MySQL)
- **Database Limits:** The server is highly sensitive to concurrent database connections. 
    - **Bottleneck:** Triggers "500 Error: Too many connections" easily.
    - **Stability Threshold:** Max 8-10 concurrent requests.

## Dynamic Content Intelligence (AJAX)
- **Trigger Attributes:** 
    - `[data-action="loadMore"]`: Standard for expanding forum posts.
    - `[data-role="tab"]`: Swaps content in Leaderboards and User Profiles.
    - `[data-ipstooltip]`: Loads user/post summaries on hover.
- **Pagination Logic:** 
    - Uses `?page=N` query strings for SEO-friendly static links. 
    - Uses `ips.ui.infiniteScroll` for JS-enabled browsers.
- **Asset Pattern:** CSS/JS is heavily version-bundled (e.g., `_framework.css?v=ae0ab03...`). These MUST be local to avoid broken layouts.

## Scraping & Mirroring Findings
- **The CSS Font Trap:** Invision Community bundles fonts (like FontAwesome) inside versioned CSS files using absolute URLs. This triggers CORS errors in local mirrors.
- **Action:** A regex rewriter MUST scan `.css` files for `url(...)` patterns, download the fonts, and relativize the paths.
- **AJAX Baking:** Capturing the `page.content()` *after* triggering `data-action` elements effectively "bakes" the server-side responses into the static HTML.
- **Smooth Scroll Requirement:** Standard `window.scrollTo` is often ignored; a timed "Smooth Scroll" is necessary to trigger lazy-loaded images.
- **Standalone Mandate:** The mirror must function perfectly via `file://` protocol.
