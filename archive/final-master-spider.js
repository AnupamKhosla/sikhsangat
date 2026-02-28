import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import axios from 'axios';
import PQueue from 'p-queue';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'sikhsangat_offline');
const BASE_URL = 'https://www.sikhsangat.com';

const queue = new PQueue({ concurrency: 50 }); // 50 PARALLEL FETCHES
const visited = new Set();
let workingProxies = [];

function getLocalPath(urlStr) {
    try {
        const uO = new URL(urlStr, BASE_URL);
        let pathname = uO.pathname;
        if (pathname === '/index.php' && uO.search.startsWith('?/')) {
            pathname = uO.search.substring(1).split('&')[0]; 
        }
        let fullPath = path.join(OUTPUT_DIR, pathname);
        if (pathname.endsWith('/') || !path.extname(pathname)) {
            fullPath = path.join(fullPath, 'index.html');
        }
        return fullPath;
    } catch(e) { return path.join(OUTPUT_DIR, 'error.html'); }
}

function getRelativePath(fromUrl, toUrl) {
    try {
        const fromLocal = getLocalPath(fromUrl);
        const toLocal = getLocalPath(toUrl);
        const rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
        return (rel.startsWith('.') ? rel : './' + rel);
    } catch (e) { return toUrl; }
}

async function scrapePage(url, attempt = 1) {
    const cleanUrl = url.split('#')[0];
    if (visited.has(cleanUrl)) return;
    visited.add(cleanUrl);

    // Pick a unique IP for this fetch
    const proxy = workingProxies[Math.floor(Math.random() * workingProxies.length)];
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            proxy: proxy ? { server: proxy } : undefined
        });
        const context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
        });
        const page = await context.newPage();

        console.log(`[CRAWL] Worker ${queue.pending}/${queue.concurrency} | IP: ${proxy || 'DIRECT'} | URL: ${cleanUrl}`);
        
        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        const html = await page.content();
        const $ = cheerio.load(html);

        // Discovery & Relative Link Conversion
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith(BASE_URL) && !href.includes('do=')) {
                $(el).attr('href', getRelativePath(cleanUrl, href));
                const nextUrl = href.split('#')[0];
                if (!visited.has(nextUrl)) queue.add(() => scrapePage(nextUrl));
            }
        });

        await fs.outputFile(getLocalPath(cleanUrl), $.html());
        console.log(`[SAVED] ${cleanUrl}`);

    } catch (e) {
        console.error(`[ERR] ${cleanUrl} via ${proxy}: ${e.message}`);
        if (attempt < 3) {
            visited.delete(cleanUrl);
            queue.add(() => scrapePage(cleanUrl, attempt + 1));
        }
    } finally {
        if (browser) await browser.close();
    }
}

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    
    console.log("Waiting for seed_urls.json and working_proxies.json...");
    while (!fs.existsSync('seed_urls.json') || !fs.existsSync('working_proxies.json')) {
        await new Promise(r => setTimeout(r, 5000));
    }

    const seeds = await fs.readJson('seed_urls.json');
    workingProxies = await fs.readJson('working_proxies.json');
    
    console.log(`Initialization complete. Using ${workingProxies.length} IPs to download ${seeds.length} pages.`);
    
    seeds.forEach(u => queue.add(() => scrapePage(u)));
}

main();
