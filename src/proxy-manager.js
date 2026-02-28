import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ProxyManager {
    constructor() {
        // User Override: Using local IP for performance/reliability as Tor is unstable
        this.proxies = []; 
        console.log(`[ProxyManager] 3*3 Strategy Paused: Using Local IP as requested by user.`);
    }

    getConcurrencyLimit() {
        return 3; // Hard limit of 3 parallel fetches as requested
    }
}

export default new ProxyManager();
