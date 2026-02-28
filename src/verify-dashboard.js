import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');

async function audit() {
    console.log("[AUDIT] Opening Browser to http://127.0.0.1:3000...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 10000 });
        
        // Give it a second for any client-side JS to run
        await page.waitForTimeout(2000);

        // Capture Snapshot for manual proof
        await page.screenshot({ path: path.join(ROOT_DIR, 'logs', 'audit_snapshot.png') });

        const uiJitter = await page.locator('#jitter').innerText();
        const uiCount = await page.locator('#count').innerText();
        
        const onDisk = fs.readJsonSync(CONFIG_FILE);

        console.log(`[AUDIT] UI Jitter: "${uiJitter}" | Disk Jitter: "${onDisk.currentJitter}"`);
        console.log(`[AUDIT] UI Count: "${uiCount}" | Disk Count: "${onDisk.downloadedCount}"`);

        if (uiJitter === "0" || !uiJitter) {
            throw new Error("Dashboard UI shows 0 or empty jitter!");
        }

        if (parseInt(uiJitter) !== onDisk.currentJitter) {
            throw new Error(`DATA MISMATCH! UI shows ${uiJitter}ms but disk has ${onDisk.currentJitter}ms`);
        }

        console.log("\x1b[1;32m[AUDIT PASS] Real Browser Verified UI is correct.\x1b[0m");
        process.exit(0);
    } catch (e) {
        console.error(`\x1b[1;31m[AUDIT FAIL] ${e.message}\x1b[0m`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

audit();
