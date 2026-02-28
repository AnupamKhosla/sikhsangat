import { chromium } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://www.sikhsangat.com';
const OUTPUT_DIR = path.join(__dirname, 'archive');

// 1. Concurrency limit to prevent overwhelming the server (like HTTrack's defaults)
const queue = new PQueue({ concurrency: 1 });
const visited = new Set();
const failed = new Set();

const delay = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 2. Robust fetching with retry logic (mimicking wget's --tries)
async function fetchWithRetry(url, retries = 3, backoff = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                timeout: 15000
            });
            return res;
        } catch (error) {
            log(`[Attempt ${i + 1}/${retries}] Failed to fetch ${url}: ${error.message}`);
            if (error.response && error.response.status === 404) return null; // Don't retry 404s
            if (i === retries - 1) throw error;
            await delay(backoff * (i + 1)); // Exponential backoff
        }
    }
}

async function getSitemapUrls() {
    const parser = new XMLParser();
    const urls = new Set();
    const sitemapUrl = `${BASE_URL}/sitemap.php`;
    
    log(`Fetching master sitemap: ${sitemapUrl}`);
    try {
        const response = await fetchWithRetry(sitemapUrl);
        if (!response) return [];
        
        const jsonObj = parser.parse(response.data);
        const sitemaps = jsonObj.sitemapindex?.sitemap || [];
        const sitemapList = Array.isArray(sitemaps) ? sitemaps : [sitemaps];
        
        for (const sitemap of sitemapList) {
            if (!sitemap.loc.includes('forums_')) continue;
            log(`Fetching sub-sitemap: ${sitemap.loc}`);
            try {
                await delay(1500); // Polite delay between sitemaps
                const subRes = await fetchWithRetry(sitemap.loc);
                if (subRes) {
                    const subJson = parser.parse(subRes.data);
                    const entries = subJson.urlset?.url || [];
                    const entryList = Array.isArray(entries) ? entries : [entries];
                    entryList.forEach(e => {
                        if (e.loc) urls.add(e.loc);
                    });
                }
            } catch (e) { log(`Skipping sub-sitemap ${sitemap.loc} due to error.`); }
        }
    } catch (e) { 
        log(`CRITICAL: Failed to load master sitemap: ${e.message}`);
    }
    return Array.from(urls);
}

// 3. Playwright crawler with try-catch for page loading, DOM parsing, and saving
async function scrape(browser, url, retries = 2) {
    if (visited.has(url)) return;
    visited.add(url);

    let page;
    try {
        page = await browser.newPage({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        log(`[CRAWL] ${url}`);
        await delay(2000 + Math.random() * 3000); // Human-like jitter
        
        // Wait until network is idle to ensure JS pagination loads
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        
        const html = await page.content();
        const $ = cheerio.load(html);

        // Convert links to relative paths (Crucial for GitHub pages, mimicking wget --convert-links)
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith(BASE_URL)) {
                try {
                    const fromUrl = new URL(url);
                    const toUrl = new URL(href);
                    const fromPath = fromUrl.pathname.endsWith('/') ? fromUrl.pathname : path.dirname(fromUrl.pathname);
                    let rel = path.relative(fromPath, toUrl.pathname);
                    if (!rel) rel = '.';
                    if (!path.extname(rel) && !rel.endsWith('/')) rel += '/index.html';
                    $(el).attr('href', rel + toUrl.search + toUrl.hash);
                } catch(e) { /* ignore link parse errors */ }
            }
        });

        // Save HTML
        const uO = new URL(url);
        let sP = path.join(OUTPUT_DIR, uO.pathname, 'index.html');
        if (uO.pathname === '/' || uO.pathname === '/index.php') {
            sP = path.join(OUTPUT_DIR, 'index.html');
        }
        await fs.outputFile(sP, $.html());
        
        // IPS Pagination discovery (The feature wget misses)
        try {
            const pLinks = await page.$$eval('li.ipsPagination_page a, li.ipsPagination_next a', ls => ls.map(a => a.href));
            for (const l of pLinks) {
                const cleanUrl = l.split('#')[0];
                if (!visited.has(cleanUrl) && cleanUrl.startsWith(BASE_URL)) {
                    queue.add(() => scrape(browser, cleanUrl));
                }
            }
        } catch(e) { log(`  -> No pagination found or error evaluating: ${e.message}`); }

    } catch (e) { 
        log(`[ERROR] Failed to scrape ${url}: ${e.message}`);
        failed.add(url);
        if (retries > 0) {
            log(`  -> Retrying ${url}... (${retries} left)`);
            visited.delete(url); // Remove from visited so it can be tried again
            queue.add(() => scrape(browser, url, retries - 1));
        }
    } finally { 
        if (page) await page.close().catch(e => log(`Failed to close page: ${e.message}`)); 
    }
}

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const seeds = await getSitemapUrls();
        
        if (seeds.length === 0) {
            log("No seeds found. If the site is blocking us, we may need to use a residential proxy or pause the wget process.");
            return;
        }

        log(`Starting crawl with ${seeds.length} seeds.`);
        
        // Process a subset for testing, ensuring queue processes them
        seeds.slice(0, 10).forEach(seed => queue.add(() => scrape(browser, seed)));
        
        await queue.onIdle();
        log("Crawl phase completed.");
        
        if (failed.size > 0) {
            log(`Failed URLs: ${failed.size}`);
            await fs.writeJson('failed_urls.json', Array.from(failed), { spaces: 2 });
        }
        
    } catch (e) {
        log(`FATAL RUNTIME ERROR: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

main();
