import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs-extra';
import { SocksProxyAgent } from 'socks-proxy-agent';
import PQueue from 'p-queue';

const proxyAgent = new SocksProxyAgent('socks5://127.0.0.1:9050');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
};

async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { 
                headers: HEADERS, 
                httpsAgent: proxyAgent, 
                httpAgent: proxyAgent,
                timeout: 60000 
            });
            return res.data;
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function extractAll() {
    const parser = new XMLParser();
    const seeds = new Set();
    const queue = new PQueue({ concurrency: 5 });
    
    const subSitemapUrls = [
        'https://www.sikhsangat.com/sitemap.php?file=sitemap_content_forums_Forum',
        ...Array.from({length: 137}, (_, i) => `https://www.sikhsangat.com/sitemap.php?file=sitemap_content_forums_Topic_${i + 1}`)
    ];

    console.log(`[START] Rebuilding seed list incrementally...`);

    subSitemapUrls.forEach(url => {
        queue.add(async () => {
            try {
                const data = await fetchWithRetry(url);
                const jsonObj = parser.parse(data);
                const entries = jsonObj.urlset?.url || [];
                const entryList = Array.isArray(entries) ? entries : [entries];
                
                entryList.forEach(e => { if (e.loc) seeds.add(e.loc); });
                
                // Write every time we find more to feed the scraper
                await fs.writeJson('seed_urls.json', Array.from(seeds), { spaces: 2 });
                
                process.stdout.write(`\r[DISCOVERY] Total Found: ${seeds.size}   `);
            } catch (e) {}
        });
    });

    await queue.onIdle();
    console.log(`\n[FINISH] Discovery complete.`);
}

extractAll();
