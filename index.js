import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
    console.log("\x1b[1;36m[ SYSTEM ] Starting SikhSangat Mirroring Engine...\x1b[0m");

    // 1. Fetch Proxies first
    console.log("[ SYSTEM ] Refreshing proxy pool...");
    const fetcher = spawn('node', ['src/proxy-fetcher.js'], { stdio: 'inherit' });
    
    await new Promise((resolve) => {
        fetcher.on('exit', () => resolve());
    });

    // 2. Start Dashboard
    console.log("[ SYSTEM ] Launching Monitoring Dashboard...");
    const dashboard = spawn('node', ['src/dashboard-server.js'], { stdio: 'inherit' });

    // 3. Start Scraper after a short delay
    setTimeout(() => {
        console.log("[ SYSTEM ] Launching Scraper Engine...");
        const scraper = spawn('node', ['src/main.js'], { stdio: 'inherit' });

        scraper.on('exit', (code) => {
            console.log(`[ SYSTEM ] Scraper exited with code ${code}.`);
            dashboard.kill();
            process.exit(code);
        });
    }, 2000);

    process.on('SIGINT', () => {
        dashboard.kill();
        process.exit();
    });
}

start();
