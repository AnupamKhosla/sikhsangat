import axios from 'axios';
import fs from 'fs-extra';
import PQueue from 'p-queue';
import { SocksProxyAgent } from 'socks-proxy-agent';

const PROXY_APIS = [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=all',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt'
];
const TEST_URL = 'https://www.sikhsangat.com/';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
};

async function fetchAndTestProxies() {
    console.log("Fetching proxy lists...");
    let proxyList = [];
    
    for (const api of PROXY_APIS) {
        try {
            const response = await axios.get(api);
            const lines = response.data.split('\n').map(p => p.trim()).filter(p => p !== '');
            proxyList = proxyList.concat(lines);
        } catch (e) {
            console.error(`Failed to fetch from ${api}:`, e.message);
        }
    }
    
    // Deduplicate
    proxyList = [...new Set(proxyList)];
    console.log(`Found ${proxyList.length} potential unique proxies.`);

    console.log(`Testing proxies against ${TEST_URL}...`);
    const workingProxies = [];
    const queue = new PQueue({ concurrency: 50 }); // Test 50 at a time

    let tested = 0;
    for (const proxy of proxyList) {
        queue.add(async () => {
            const agent = new SocksProxyAgent(`socks5://${proxy}`);
            try {
                await axios.get(TEST_URL, {
                    httpAgent: agent,
                    httpsAgent: agent,
                    timeout: 5000, // Strict timeout for fast proxies only
                    headers: HEADERS
                });
                workingProxies.push(`socks5://${proxy}`);
                process.stdout.write(`\rWorking: ${workingProxies.length} | Tested: ${++tested}/${proxyList.length}`);
            } catch (e) {
                process.stdout.write(`\rWorking: ${workingProxies.length} | Tested: ${++tested}/${proxyList.length}`);
            }
        });
    }

    await queue.onIdle();
    console.log(`\nTesting complete. Found ${workingProxies.length} working proxies.`);
    
    if (workingProxies.length > 0) {
        fs.writeJsonSync('working_proxies.json', workingProxies, { spaces: 2 });
        console.log("Saved to working_proxies.json");
    } else {
        console.log("No working proxies found from this source. We may need a premium list or Tor rotation.");
    }
}

fetchAndTestProxies();
