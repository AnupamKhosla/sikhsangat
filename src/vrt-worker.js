import { chromium } from 'playwright-extra';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs-extra';

const OUTPUT_DIR = path.join(process.cwd(), 'docs');
const SNAPSHOT_DIR = path.join(process.cwd(), 'logs', 'snapshots');

let browser = null;

async function initBrowser() {
    if (!browser) {
        browser = await chromium.launch({ headless: true });
    }
    return browser;
}

async function runTest(url, localPath, liveScreenshotPath) {
    const b = await initBrowser();
    const page = await b.newPage();
    const relPath = path.relative(OUTPUT_DIR, localPath);
    let score = 0;
    
    try {
        await page.goto(`file://${localPath}`, { waitUntil: 'networkidle', timeout: 30000 });
        const mirrorScreenshotBuffer = await page.screenshot({ fullPage: true });
        
        const liveScreenshotBuffer = fs.readFileSync(liveScreenshotPath);
        const livePng = PNG.sync.read(liveScreenshotBuffer);
        const mirrorPng = PNG.sync.read(mirrorScreenshotBuffer);
        
        // Ensure same dimensions
        const width = Math.min(livePng.width, mirrorPng.width);
        const height = Math.min(livePng.height, mirrorPng.height);
        
        const diff = pixelmatch(livePng.data, mirrorPng.data, null, width, height, { threshold: 0.1 });
        score = ((width * height - diff) / (width * height)) * 100;

        process.send({ type: 'RESULT', relPath, score: score.toFixed(2), url });

    } catch (e) {
        process.send({ type: 'ERROR', relPath, error: e.message, url });
    } finally {
        await page.close(); // Close only the page, keep browser open
        // Clean up temp snapshot
        if (fs.existsSync(liveScreenshotPath)) fs.removeSync(liveScreenshotPath);
    }
}

// Receive message from parent
process.on('message', async (msg) => {
    if (msg.type === 'SHUTDOWN') {
        if (browser) await browser.close();
        process.exit(0);
    }
    if (msg.url && msg.localPath && msg.liveScreenshotPath) {
        await runTest(msg.url, msg.localPath, msg.liveScreenshotPath);
    }
});