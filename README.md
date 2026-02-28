# SikhSangat Digital Archive

A high-performance, robust preservation tool designed for the historical archiving of the `sikhsangat.com` public forum. 

## Mission
To ensure the long-term accessibility of public discourse and religious scholarship. This project generates a fully functional, offline-capable digital twin of the forum for educational research, historical preservation, and public utility.

## Features
- **Adaptive Preservation Engine:** Utilizes rotating network pathways (Tor, SOCKS5) to ensure non-disruptive, respectful data collection.
- **Dynamic Content Rendering:** Employs Playwright to accurately capture and "bake" dynamic elements (Tabs, expanded content) into stable, static HTML files.
- **Resource Optimization:** Features a shared-browser architecture for efficient memory management and high-reliability verification.
- **Archive-Ready Structure:** Optimized for hosting as a static site via GitHub Pages or local filesystem access.
- **Automated Quality Assurance:** Built-in behavioral testing to verify link integrity and interactive functionality within the archive.

## Setup

1. **Environment Preparation:**
   ```bash
   npm install
   ```

2. **Network Routing (Optional):**
   ```bash
   # On macOS
   brew install tor
   brew services start tor
   ```

3. **Initiate Archival Process:**
   ```bash
   node index.js
   ```

4. **Monitor Progress:**
   Access the real-time monitoring dashboard at `http://127.0.0.1:3000`.

## Publication to Digital Archive (GitHub Pages)

The repository is pre-configured to host the public archive via the `docs/` directory.

1. **Commit and Sync:**
   ```bash
   git add .
   git commit -m "Synchronize archive update"
   git push origin main
   ```

2. **Enable Public Access:**
   - Navigate to the repository **Settings** -> **Pages**.
   - Under **Build and deployment**, select **Deploy from a branch**.
   - Choose the `main` branch and the `/docs` folder.
   - Click **Save**.

The public archive will be accessible at `https://anupamkhosla.github.io/sikhsangat/www.sikhsangat.com/index.html`.

## Technical Specifications
- **Core Engine:** Node.js + Crawlee + Playwright
- **Anonymity Layer:** Multi-path SOCKS5 + Tor Rotation
- **Scalability:** Adaptive concurrency based on verified network entry points.
- **Persistence:** State tracking via `logs/scraper_config.json` and Crawlee's integrated storage layer.

## Ethical & Legal Use
This tool is intended for personal use, educational research, and the preservation of public data for the purpose of posterity. Users are responsible for ensuring their use complies with local regulations and respects the terms of service of the target platform.
