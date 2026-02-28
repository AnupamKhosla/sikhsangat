import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { SocksProxyAgent } from 'socks-proxy-agent';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'sikhsangat_offline');
const BASE_URL = 'https://www.sikhsangat.com';

const torProxy = 'socks5://127.0.0.1:9050';
const torAgent = new SocksProxyAgent(torProxy);

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

const crawler = new PlaywrightCrawler({
    maxConcurrency: 5,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 600, 
    navigationTimeoutSecs: 300,    
    
    launchContext: {
        launcher: chromium,
        launchOptions: { 
            headless: true,
            args: [`--proxy-server=${torProxy}`] 
        }
    },

    async requestHandler({ request, page, enqueueLinks, log }) {
        log.info(`[START] ${request.url}`);
        
        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 300000 });
        log.info(`[LOADED] ${request.url}`);
        
        await page.waitForTimeout(2000); 
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const assetTasks = [];
        $('img, link[rel="stylesheet"], script[src]').each((i, el) => {
            const attr = el.name === 'link' ? 'href' : 'src';
            const val = $(el).attr(attr);
            if (val) {
                try {
                    const fullAssetUrl = new URL(val, request.url).href;
                    if (fullAssetUrl.includes('sikhsangat.com')) {
                        const localAssetPath = getLocalPath(fullAssetUrl);
                        assetTasks.push(async () => {
                            if (!await fs.pathExists(localAssetPath)) {
                                try {
                                    const res = await axios.get(fullAssetUrl, { 
                                        responseType: 'arraybuffer',
                                        timeout: 60000,
                                        httpAgent: torAgent,
                                        httpsAgent: torAgent
                                    });
                                    await fs.outputFile(localAssetPath, res.data);
                                } catch(e) {}
                            }
                        });
                        $(el).attr(attr, getRelativePath(request.url, fullAssetUrl));
                    }
                } catch(e) {}
            }
        });
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href) {
                try {
                    const fullHref = new URL(href, request.url).href;
                    if (fullHref.startsWith(BASE_URL) && !fullHref.includes('do=')) {
                        $(el).attr('href', getRelativePath(request.url, fullHref));
                    }
                } catch(e) {}
            }
        });
        
        await Promise.all(assetTasks.map(t => t()));

        const savePath = getLocalPath(request.url);
        await fs.outputFile(savePath, $.html());
        log.info(`[SAVED] -> ${savePath.replace(OUTPUT_DIR, '')}`);

        await enqueueLinks({
            strategy: 'same-domain',
            transformRequestFunction(req) {
                if (req.url.includes('do=') || req.url.includes('search/') || req.url.includes('login/')) return false;
                return req;
            }
        });
    },

    failedRequestHandler({ request, log }) {
        log.error(`[FATAL] ${request.url}`);
    }
});

async function run() {
    await fs.ensureDir(OUTPUT_DIR);
    let seeds = ['https://www.sikhsangat.com/'];
    if (fs.existsSync('seed_urls.json')) {
        const fileSeeds = await fs.readJson('seed_urls.json');
        seeds = fileSeeds.slice(0, 500); 
    }
    await crawler.addRequests(seeds);
    await crawler.run();
}

run().catch(err => console.error(err));
