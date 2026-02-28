import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://www.sikhsangat.com';
const OUTPUT_DIR = path.join(__dirname, 'archive');
const STATE_FILE = path.join(__dirname, 'crawl_state.json');

// --- CRAWL STATE MANAGEMENT ---
let state = { visited: [], failed: [], queue: [] };
if (fs.existsSync(STATE_FILE)) {
    try {
        state = fs.readJsonSync(STATE_FILE);
        console.log(`[RESUME] Visited: ${state.visited.length}, Queue: ${state.queue.length}`);
    } catch (e) {}
}

const saveState = () => fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const delay = ms => new Promise(r => setTimeout(r, ms));

// --- PROXY POOL ---
let proxyPool = [];
async function fetchProxies() {
    log("Refreshing proxy pool...");
    const urls = [
        'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
        'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'
    ];
    for (const url of urls) {
        try {
            const res = await axios.get(url, { timeout: 10000 });
            const list = res.data.split('
').filter(p => p.trim()).map(p => `http://${p.trim()}`);
            proxyPool.push(...list);
        } catch (e) {}
    }
    proxyPool = [...new Set(proxyPool)];
    log(`Loaded ${proxyPool.length} proxies.`);
}

function getProxy() { return proxyPool[Math.floor(Math.random() * proxyPool.length)]; }

// --- LINK CONVERSION ---
function toRelative(source, target) {
    try {
        const s = new URL(source);
        const t = new URL(target, BASE_URL);
        if (t.hostname !== new URL(BASE_URL).hostname) return target;
        let tPath = t.pathname.endsWith('/') ? t.pathname + 'index.html' : (!path.extname(t.pathname) ? t.pathname + '/index.html' : t.pathname);
        let sDir = path.posix.dirname(s.pathname.endsWith('/') ? s.pathname + 'index.html' : (!path.extname(s.pathname) ? s.pathname + '/index.html' : s.pathname));
        let rel = path.posix.relative(sDir, tPath);
        return (rel.startsWith('.') ? rel : './' + rel) + t.search + t.hash;
    } catch (e) { return target; }
}

// --- WORKER ---
async function scrape(url, attempt = 1) {
    if (state.visited.includes(url)) return;
    const proxy = getProxy();
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            proxy: proxy ? { server: proxy } : undefined,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            timeout: 120000 // 2-minute timeout for slow PHP responses
        });
        const page = await context.newPage();
        log(`[WORKER] Scraping: ${url} (Attempt ${attempt}/5 via ${proxy || 'Direct'})`);

        // Wait up to 120s for slow PHP server
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(5000); // Wait for potential JS hydration

        const html = await page.content();
        const $ = cheerio.load(html);

        // Process Links & Discovery
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith(BASE_URL)) {
                $(el).attr('href', toRelative(url, href));
                const clean = href.split('#')[0];
                if (!state.visited.includes(clean) && !state.queue.includes(clean) && !clean.includes('do=')) {
                    state.queue.push(clean);
                }
            }
        });

        const uO = new URL(url);
        let sP = path.join(OUTPUT_DIR, uO.pathname);
        if (sP.endsWith('/') || !path.extname(sP)) sP = path.join(sP, 'index.html');
        await fs.outputFile(sP, $.html());
        
        state.visited.push(url);
        state.queue = state.queue.filter(u => u !== url);
        saveState();
    } catch (e) {
        log(`[FAIL] ${url}: ${e.message}`);
        if (attempt < 5) return scrape(url, attempt + 1); // Retry with different proxy
        state.failed.push({ url, err: e.message });
        state.queue = state.queue.filter(u => u !== url);
        saveState();
    } finally { if (browser) await browser.close(); }
}

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    await fetchProxies();
    if (state.queue.length === 0 && fs.existsSync('seed_urls.json')) {
        state.queue = fs.readJsonSync('seed_urls.json');
    }
    const q = new PQueue({ concurrency: 5 }); // 5 parallel workers to avoid overloading slow server
    log(`Crawl Started. Queue: ${state.queue.length}`);
    
    while (state.queue.length > 0) {
        const url = state.queue.shift();
        await delay(Math.random() * 10000); // Randomized jitter between 0-10s
        q.add(() => scrape(url));
    }
    await q.onIdle();
}

main();
