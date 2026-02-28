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

const queue = new PQueue({ concurrency: 50 }); // 50 SIMULTANEOUS WORKERS
const visited = new Set();
let proxyPool = [];

async function refreshProxyPool() {
    const sources = [
        'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
        'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
        'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'
    ];
    let newProxies = [];
    for (const s of sources) {
        try {
            const res = await axios.get(s, { timeout: 10000 });
            newProxies.push(...res.data.split('\n').filter(p => p.includes(':')));
        } catch (e) {}
    }
    proxyPool = [...new Set(newProxies)];
    console.log(`[POOL] Loaded ${proxyPool.length} Unique IPs for distribution.`);
}

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

    // Grab a random unique IP from the pool
    const proxy = proxyPool[Math.floor(Math.random() * proxyPool.length)];
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            proxy: proxy ? { server: `http://${proxy}` } : undefined
        });
        const context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
        });
        const page = await context.newPage();

        console.log(`[CRAWL] Worker ${queue.pending}/50 | IP: ${proxy} | URL: ${cleanUrl}`);
        
        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const html = await page.content();
        const $ = cheerio.load(html);

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
        console.error(`[FAIL] ${cleanUrl} via ${proxy}: ${e.message}`);
        if (attempt < 5) {
            visited.delete(cleanUrl);
            queue.add(() => scrapePage(cleanUrl, attempt + 1));
        }
    } finally {
        if (browser) await browser.close();
    }
}

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    await refreshProxyPool();
    setInterval(refreshProxyPool, 15 * 60 * 1000);

    let seeds = ['https://www.sikhsangat.com/'];
    if (fs.existsSync('seed_urls.json')) {
        const fileSeeds = await fs.readJson('seed_urls.json');
        seeds = fileSeeds.slice(0, 5000); 
    }

    seeds.forEach(u => queue.add(() => scrapePage(u)));
    
    setInterval(() => {
        console.log(`--- STATUS: Archived: ${visited.size} | Pool: ${proxyPool.length} | Active Workers: ${queue.pending} ---`);
    }, 5000);
}

main();
