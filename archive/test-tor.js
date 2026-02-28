import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';

chromium.use(StealthPlugin());

async function test() {
    const browser = await chromium.launch({
        headless: true,
        args: ['--proxy-server=socks5://127.0.0.1:9050']
    });
    const page = await browser.newPage();
    console.log("Navigating (5 min timeout)...");
    try {
        await page.goto('https://www.sikhsangat.com/', { waitUntil: 'domcontentloaded', timeout: 300000 });
        const content = await page.content();
        await fs.writeFile('test_tor.html', content);
        console.log("Success! Saved test_tor.html");
    } catch (e) {
        console.error("Failed:", e.message);
    } finally {
        await browser.close();
    }
}

test();
