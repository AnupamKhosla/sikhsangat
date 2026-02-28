import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PROXY_FILE = path.join(ROOT_DIR, 'working_proxies.json');

class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentIndex = 0;
        this.loadProxies();
    }

    loadProxies() {
        try {
            if (fs.existsSync(PROXY_FILE)) {
                this.proxies = fs.readJsonSync(PROXY_FILE);
            }
        } catch (e) {
            console.error("Failed to load proxies:", e.message);
        }
        
        // Add Tor as a default if it's likely running (SOCKS5 on 9050 or 9150)
        // We add it to the list to rotate it
        this.proxies.push('socks5://127.0.0.1:9050'); 
        
        console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies (including Tor).`);
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }

    getConcurrencyLimit() {
        // x * 3 parallel fetches as requested by user
        // x is number of unique IPs.
        const uniqueIps = new Set(this.proxies).size;
        return Math.max(5, uniqueIps * 3); 
    }
}

export default new ProxyManager();
