import { CheerioCrawler, ProxyConfiguration, Dataset } from 'crawlee';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'sikhsangat_offline');
const BASE_URL = 'https://www.sikhsangat.com';

// LOCAL TUNNEL SETUP (Connects to Tor)
const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: ['http://127.0.0.1:8080'],
});

/**
 * Converts absolute URLs to relative local paths
 */
function getLocalPath(urlStr) {
    try {
        const uO = new URL(urlStr, BASE_URL);
        let pathname = uO.pathname;
        
        // Handle Invision PHP query strings: index.php?/topic/123/
        if (pathname.includes('index.php') && uO.search.startsWith('?/')) {
            pathname = uO.search.substring(1).split('&')[0];
        }

        let fullPath = path.join(OUTPUT_DIR, pathname);
        
        // Ensure index.html for directory-like paths
        if (pathname.endsWith('/') || !path.extname(pathname) || pathname === '/' || pathname === '') {
            fullPath = path.join(fullPath, 'index.html');
        }
        
        // Clean up path (remove trailing dots/spaces that OS X/Windows might hate)
        return fullPath.replace(/\/+$/, '') + (fullPath.endsWith('.html') ? '' : '');
    } catch(e) { 
        return path.join(OUTPUT_DIR, 'error.html'); 
    }
}

function getRelativePath(fromUrl, toUrl) {
    try {
        const fromLocal = getLocalPath(fromUrl);
        const toLocal = getLocalPath(toUrl);
        let rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
        if (!rel.startsWith('.')) rel = './' + rel;
        return rel;
    } catch (e) { return toUrl; }
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 10, // START SMALL AS REQUESTED
    requestHandlerTimeoutSecs: 120,
    
    async requestHandler({ request, $, enqueueLinks, log }) {
        const url = request.url;
        log.info(`[PROCESSING] ${url}`);

        // 1. ASSET HANDLING (Images, CSS, JS)
        // We will collect these and download them to make it "offline"
        $('img, link[rel="stylesheet"], script[src]').each((i, el) => {
            const attr = el.name === 'link' ? 'href' : 'src';
            const val = $(el).attr(attr);
            if (val) {
                try {
                    const fullAssetUrl = new URL(val, url).href;
                    if (fullAssetUrl.includes('sikhsangat.com')) {
                        $(el).attr(attr, getRelativePath(url, fullAssetUrl));
                        // Enqueue assets for download if we want them (optional)
                    }
                } catch(e) {}
            }
        });

        // 2. LINK CONVERSION (Make all internal links relative)
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                try {
                    const fullHref = new URL(href, url).href;
                    if (fullHref.startsWith(BASE_URL) && !fullHref.includes('do=')) {
                        $(el).attr('href', getRelativePath(url, fullHref));
                    }
                } catch(e) {}
            }
        });

        // 3. SAVE TO DISK
        const savePath = getLocalPath(url);
        if (await fs.pathExists(savePath)) {
            log.info(`[SKIPPED] Already exists: ${savePath.replace(OUTPUT_DIR, '')}`);
        } else {
            await fs.outputFile(savePath, $.html());
            log.info(`[SAVED] ${savePath.replace(OUTPUT_DIR, '')}`);
        }

        // 4. DISCOVERY (Enqueue next links)
        await enqueueLinks({
            baseUrl: BASE_URL,
            strategy: 'same-domain',
            transformRequestFunction(req) {
                // Filter out non-content pages (search, login, etc)
                if (req.url.includes('do=') || req.url.includes('search') || req.url.includes('login')) return false;
                return req;
            }
        });
        
        // 5. ADAPTIVE SCALING
        // If we are doing well, we increase concurrency slowly
        if (crawler.stats.state.requestsFinished % 50 === 0 && crawler.maxConcurrency < 100) {
            crawler.maxConcurrency += 2;
            log.info(`[SCALING] Ramping up to ${crawler.maxConcurrency} parallel workers...`);
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`[FATAL] Failed to fetch ${request.url}`);
    }
});

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    
    let seeds = ['https://www.sikhsangat.com/'];
    if (fs.existsSync('seed_urls.json')) {
        try {
            const fileSeeds = await fs.readJson('seed_urls.json');
            if (fileSeeds.length > 0) {
                seeds = fileSeeds;
                console.log(`Loaded ${seeds.length} seeds from file.`);
            }
        } catch (e) {
            console.log("Could not read seed_urls.json, starting with homepage.");
        }
    }

    console.log(`Starting Ultimate Hybrid Scraper with Tor rotation...`);
    // Add requests and run
    await crawler.addRequests(seeds);
    await crawler.run();
}

main();
