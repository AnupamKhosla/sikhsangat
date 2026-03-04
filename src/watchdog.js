import axios from 'axios';
import { spawn } from 'child_process';

const TARGET = 'https://www.sikhsangat.com/';

async function watch() {
    console.log(`[WATCHDOG] Monitoring ${TARGET} for recovery...`);
    
    while (true) {
        try {
            // Heartbeat log every 60s
            for(let i=0; i<5; i++) {
                console.log(`[${new Date().toLocaleTimeString()}] Checking in ${5-i} minutes...`);
                await new Promise(r => setTimeout(r, 60000));
            }

            const res = await axios.get(TARGET, { timeout: 15000 });
            if (res.status === 200) {
                console.log("\x1b[1;32m[RECOVERY] Server is UP! Launching Scraper...\x1b[0m");
                spawn('node', ['index.js'], { stdio: 'inherit' });
                break;
            }
        } catch (e) {
            const status = e.response?.status || "TIMEOUT/DOWN";
            console.log(`\x1b[1;33m[ALERT] Status: ${status}. Server still cooling...\x1b[0m`);
        }
    }
}

watch();
