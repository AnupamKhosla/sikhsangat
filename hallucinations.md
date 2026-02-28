# Gemini CLI - Known Hallucinations & Critical Fixes

## 1. "Silent Failures" & Soft Returns
**The Hallucination:** The agent will often wrap critical security checks (like `getVerifiedIp`) in a `try/catch`, print an error message, and then quietly `return` or let the script continue, instead of enforcing a hard stop.
**The Fix:** MUST use `process.exit(1)` immediately upon any critical failure (IP lookup, Dashboard down). Do not allow the script to proceed in a degraded state.

## 2. Background Process Ghosting
**The Hallucination:** The agent assumes running `node script.js &` inside the CLI will reliably keep a background process alive while returning to chat.
**The Reality:** The CLI environment aggressively cleans up child processes when a tool call ends.
**The Fix:** 
- For testing/debugging: Run everything synchronously in the foreground.
- For production: Use a single unified process (`index.js` using `spawn` with `stdio: 'inherit'`) and run it via `npm start` in a completely separate MacOS Terminal window.

## 3. "Empty Dashboard" Race Conditions
**The Hallucination:** Assuming a React/Socket.io frontend will perfectly sync with a fast-booting backend scraper.
**The Reality:** The scraper often starts working before the dashboard is ready, or the dashboard JS fails silently (e.g., `btoa` failing on unicode paths).
**The Fix:** Use Server-Side Rendering (SSR) to inject the absolute latest state (Jitter, Count, Logs) directly into the HTML before sending it to the client. Do not rely exclusively on WebSockets for initial state.

## 4. Playwright Over-Clicking
**The Hallucination:** "Click all links to trigger AJAX" is a good idea.
**The Reality:** Clicking `<a>` tags with real URLs causes the headless browser to navigate away from the page it's supposed to be saving, destroying the mirror.
**The Fix:** Only click elements that are known AJAX triggers (`[data-action="loadMore"]`, `[data-role="tab"]`) and strictly blacklist elements like "login" or "sign in" to avoid baking modals into the HTML.

## 5. False "True Parallelism"
**The Hallucination:** Setting `maxConcurrency: 25` means 25 requests happen at once.
**The Reality:** If all 25 requests route through a single Tor port (`127.0.0.1:9050`), the target server (or Tor itself) will bottleneck, resulting in 500 Errors ("Too many connections") or timeouts.
**The Fix:** To achieve true high concurrency, a pool of distinct, verified proxy servers is required. If using a single Tor node, concurrency must be kept low (e.g., 5) with a hard-capped Jitter (e.g., 4000ms max).

## Current Operational State (As of Last Logout)
- The scraper is currently set to **Test Mode (Local IP)** with `maxConcurrency: 3` to isolate whether the failures are caused by bad proxies or bad code.
- To resume the full anonymous run, the Tor proxy (`127.0.0.1:8081`) must be reinstated in `src/main.js`.
