# SikhSangat Mirroring (Scrapper)

High-performance, anonymous, and robust scraper for generating a fully functional offline mirror of `sikhsangat.com`.

## Features
- **Adaptive IP Rotation:** Automatically rotates between Tor and a pool of SOCKS5 proxies.
- **AJAX "Baking":** Uses Playwright to render and expand dynamic content (Tabs, Load More, etc.) before saving.
- **Memory Optimized:** Uses a shared browser instance for verification and limits concurrency to avoid heap crashes.
- **GitHub Pages Ready:** Generates output in the `docs/` folder, compatible with GitHub Pages.
- **Behavioral Side-Testing:** Verifies link integrity and AJAX functionality offline for every saved page.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Ensure Tor is running (optional but recommended):**
   ```bash
   # On macOS
   brew install tor
   brew services start tor
   ```

3. **Start the Mirroring Engine:**
   ```bash
   node index.js
   ```

4. **Monitor Progress:**
   Open `http://127.0.0.1:3000` to view the real-time dashboard.

## Deployment to GitHub Pages

1. **Initialize Git and Push:**
   ```bash
   git init
   git add .
   git commit -m "Initialize SikhSangat Mirror"
   git remote add origin https://github.com/anupamkhosla/sikhsangat.git
   git push -u origin main
   ```

2. **Enable GitHub Pages:**
   - Go to your repo **Settings** -> **Pages**.
   - Under **Build and deployment**, select **Deploy from a branch**.
   - Select `main` (or your current branch) and folder `/docs`.
   - Click **Save**.

Your site will be live at `https://anupamkhosla.github.io/sikhsangat/www.sikhsangat.com/index.html`.

## Technical Specs
- **Engine:** Node.js + Crawlee + Playwright
- **Anonymity:** Tor SOCKS5 + Proxy Rotation
- **Concurrency:** Auto-scales based on available unique IPs (Proxy count * 3)
- **State Management:** Progress saved in `logs/scraper_config.json` and Crawlee `storage` folder.
