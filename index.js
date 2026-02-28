import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
    console.log("\x1b[1;36m[ SYSTEM ] Starting SikhSangat Mirroring Engine (FOREGROUND MODE)...\x1b[0m");
    console.log("\x1b[1;33m[ MANDATE ] 3*3 Proxy Strategy Enabled: Tor (9050), Firefox Headers, CORS Proxy Pool.\x1b[0m");

    // 1. Fetch Proxies first (Optional now, as Tor is primary, but good for rotation)
    console.log("[ SYSTEM ] Refreshing proxy pool...");
    const fetcher = spawn('node', ['src/proxy-fetcher.js'], { stdio: 'inherit' });
    
    await new Promise((resolve) => {
        fetcher.on('exit', () => resolve());
    });

    // 2. Start Dashboard in separate process (if needed) but keep main in foreground
    console.log("[ SYSTEM ] Launching Monitoring Dashboard...");
    const dashboard = spawn('node', ['src/dashboard-server.js'], { stdio: 'inherit' });

    // 3. Start Scraper in FOREGROUND
    console.log("[ SYSTEM ] Launching Scraper Engine (Main Process)...");
    
    // We import and run main.js logic to keep it in the same process for real-time control
    // Alternatively, we spawn it and wait for it. Let's spawn with 'inherit' to keep logs in foreground.
    const scraper = spawn('node', ['src/main.js'], { stdio: 'inherit' });

    scraper.on('exit', (code) => {
        console.log(`[ SYSTEM ] Scraper exited with code ${code}.`);
        dashboard.kill();
        process.exit(code);
    });

    process.on('SIGINT', () => {
        console.log("\x1b[1;31m[ SYSTEM ] Emergency Shutdown Initiated...\x1b[0m");
        dashboard.kill();
        scraper.kill();
        process.exit();
    });
}

start();
