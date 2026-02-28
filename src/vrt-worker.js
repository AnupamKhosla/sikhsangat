import { chromium } from 'playwright-extra';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs-extra';

const OUTPUT_DIR = path.join(process.cwd(), 'sikhsangat_offline');
const SNAPSHOT_DIR = path.join(process.cwd(), 'logs', 'snapshots');

async function runTest(url, localPath, liveScreenshotPath) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
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
        await browser.close();
        // Clean up temp snapshot
        if (fs.existsSync(liveScreenshotPath)) fs.removeSync(liveScreenshotPath);
        process.exit(0);
    }
}

// Receive message from parent
process.on('message', (msg) => {
    if (msg.url && msg.localPath && msg.liveScreenshotPath) {
        runTest(msg.url, msg.localPath, msg.liveScreenshotPath);
    }
});
