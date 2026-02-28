import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'sikhsangat_offline');
const torProxy = 'socks5://127.0.0.1:9050';

const crawler = new PlaywrightCrawler({
    proxyConfiguration: new ProxyConfiguration({ proxyUrls: [torProxy] }),
    maxConcurrency: 10,
    requestHandlerTimeoutSecs: 300,
    
    launchContext: {
        launcher: chromium,
        launchOptions: { 
            headless: true,
            args: ['--proxy-server=socks5://127.0.0.1:9050'] 
        }
    },

    async requestHandler({ request, page, enqueueLinks, log }) {
        log.info(`[CRAWL] Processing: ${request.url}`);
        
        // Navigate using the 'domcontentloaded' strategy which worked in our test
        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(3000); 

        // If it's a sitemap page, extract links and add to queue
        if (request.url.includes('sitemap.php')) {
            const links = await page.$$eval('loc', locs => locs.map(l => l.textContent));
            if (links.length > 0) {
                log.info(`[SEED] Found ${links.length} URLs in sitemap.`);
                await enqueueLinks({ urls: links });
                return; // Don't save sitemap XML as HTML
            }
        }

        const html = await page.content();
        const uO = new URL(request.url);
        let savePath = path.join(OUTPUT_DIR, uO.pathname);
        if (savePath.endsWith('/') || !path.extname(savePath)) savePath = path.join(savePath, 'index.html');
        
        await fs.outputFile(savePath, html);
        log.info(`[SAVED] -> ${uO.pathname}`);

        // Discover forum topics and pagination
        await enqueueLinks({
            strategy: 'same-domain',
            transformRequestFunction(req) {
                if (req.url.includes('do=') || req.url.includes('search/') || req.url.includes('login/')) return false;
                return req;
            }
        });
    }
});

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    console.log("Launching Bulletproof Spider...");
    // Start with the main sitemap index
    await crawler.run(['https://www.sikhsangat.com/sitemap.php']);
}

main().catch(err => console.error(err));
