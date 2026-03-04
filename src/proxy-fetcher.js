import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import PQueue from 'p-queue';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_FILE = path.join(__dirname, '..', 'logs', 'working_proxies.json');

const PROXY_LIST_URLS = [
    'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt'
];

async function getProxies() {
    let all = [];
    for (const url of PROXY_LIST_URLS) {
        try {
            console.log(`[ PROXY ] Downloading proxies from ${url}...`);
            const res = await axios.get(url, { timeout: 15000 });
            const list = res.data.split('\n').filter(p => p.trim() && p.includes(':'));
            list.forEach(p => {
                const protocol = url.includes('socks5') ? 'socks5' : 'http';
                all.push(`${protocol}://${p.trim()}`);
            });
        } catch (e) {
            console.error(`[ PROXY ] Failed to download proxies from ${url}: ${e.message}`);
        }
    }
    return [...new Set(all)];
}

async function testProxy(proxyUrl) {
    try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        const { SocksProxyAgent } = await import('socks-proxy-agent');

        let agent;
        if (proxyUrl.startsWith('socks5://')) {
            agent = new SocksProxyAgent(proxyUrl);
        } else {
            agent = new HttpsProxyAgent(proxyUrl);
        }

        const res = await axios.get('https://www.sikhsangat.com/', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
        });
        
        // 500 errors mean the server hates this proxy or Tor exit node
        if (res.status === 200) return true;
        return false;
    } catch (e) {
        return false;
    }
}

async function validateProxyList(proxiesToTest, targetCount) {
    return new Promise(async (resolve) => {
        const working = [];
        const queue = new PQueue({ concurrency: 100 });
        let tested = 0;
        let isDone = false;

        for (const p of proxiesToTest) {
            if (isDone) break;

            queue.add(async () => {
                if (isDone) return;

                if (await testProxy(p)) {
                    working.push(p);
                    console.log(`\x1b[1;32m[FOUND]\x1b[0m Verified: ${working.length}/${targetCount} | IP: ${p}`);
                    
                    if (working.length >= targetCount) {
                        isDone = true;
                        queue.clear();
                        resolve(working); // Immediately return when target hit
                    }
                } else {
                    tested++;
                    if (tested % 50 === 0 && !isDone) {
                        console.log(`[SCAN] Tested: ${tested}/${proxiesToTest.length} | Found: ${working.length}`);
                    }
                }
            });
        }
        
        // Wait for it to naturally finish if it doesn't hit targetCount
        await queue.onIdle();
        if (!isDone) resolve(working);
    });
}

async function main() {
    console.log("[ SYSTEM ] Starting Proxy Discovery & Validation...");
    await fs.ensureDir(path.dirname(PROXY_FILE));
    
    // 1. Check existing saved proxies first!
    let existingProxies = [];
    if (fs.existsSync(PROXY_FILE)) {
        try {
            existingProxies = await fs.readJson(PROXY_FILE);
        } catch (e) {}
    }

    if (existingProxies.length > 0) {
        console.log(`[ PROXY ] Found ${existingProxies.length} previously saved proxies. Verifying them first...`);
        const stillWorking = await validateProxyList(existingProxies, 20); // We only need ~20
        
        if (stillWorking.length >= 5) {
            console.log(`[ PROXY ] Awesome! ${stillWorking.length} previously saved proxies are still working. Skipping full download.`);
            await fs.writeJson(PROXY_FILE, stillWorking, { spaces: 2 });
            return; // We have enough proxies, no need to download 3600 again
        } else {
            console.log(`[ PROXY ] Only ${stillWorking.length} old proxies still work. We need more. Falling back to full scan...`);
        }
    }

    // 2. Fall back to downloading full list if we don't have enough working ones
    const proxies = await getProxies();
    console.log(`[ PROXY ] Testing ${proxies.length} potential IPs against Target Server...`);
    
    const working = await validateProxyList(proxies, 20);

    console.log(`\n[ PROXY ] Scan complete. Saving ${working.length} working proxies.`);
    await fs.writeJson(PROXY_FILE, working, { spaces: 2 });
}

main().catch(err => console.error(err));
