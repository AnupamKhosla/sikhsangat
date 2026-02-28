import axios from 'axios';
import fs from 'fs-extra';
import PQueue from 'p-queue';

const PROXY_LIST_URLS = [
    'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'
];

async function getProxies() {
    let all = [];
    for (const url of PROXY_LIST_URLS) {
        try {
            console.log(`Downloading proxies from ${url}...`);
            const res = await axios.get(url, { timeout: 15000 });
            const list = res.data.split('\n').filter(p => p.trim() && p.includes(':'));
            all.push(...list);
        } catch (e) {
            console.error(`Failed to download proxies from ${url}: ${e.message}`);
        }
    }
    return [...new Set(all)];
}

async function testProxy(proxy) {
    try {
        const [host, port] = proxy.split(':');
        await axios.get('https://www.sikhsangat.com/sitemap.php', {
            proxy: {
                host: host,
                port: parseInt(port)
            },
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return true;
    } catch (e) {
        return false;
    }
}

async function main() {
    console.log("Starting proxy refresh...");
    const proxies = await getProxies();
    console.log(`Testing ${proxies.length} potential IPs...`);
    
    const working = [];
    const queue = new PQueue({ concurrency: 100 });
    let tested = 0;

    for (const p of proxies) {
        queue.add(async () => {
            if (await testProxy(p)) {
                working.push(`http://${p}`);
                process.stdout.write(`\r[FOUND] Verified: ${working.length} | Tested: ${++tested}/${proxies.length}   `);
            } else {
                tested++;
                if (tested % 100 === 0) {
                    process.stdout.write(`\r[SCAN] Tested: ${tested}/${proxies.length} | Working: ${working.length}   `);
                }
            }
        });
    }
    
    await queue.onIdle();
    console.log(`\nScan complete. Saving ${working.length} working proxies.`);
    await fs.writeJson('working_proxies.json', working, { spaces: 2 });
}

main().catch(err => console.error(err));
