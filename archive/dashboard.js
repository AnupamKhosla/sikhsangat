import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, 'master-spider.log');
const SEED_LOG = path.join(__dirname, 'seed-extractor.log');
const PROXY_LOG = path.join(__dirname, 'proxy-tester.log');
const OUTPUT_DIR = path.join(__dirname, 'sikhsangat_offline');
const SEED_FILE = path.join(__dirname, 'seed_urls.json');
const PROXY_FILE = path.join(__dirname, 'working_proxies.json');

async function getStats() {
    let filesCount = 0;
    if (await fs.pathExists(OUTPUT_DIR)) {
        const files = await fs.readdir(OUTPUT_DIR, { recursive: true });
        filesCount = files.length;
    }

    let seeds = 0;
    if (await fs.pathExists(SEED_FILE)) {
        seeds = (await fs.readJson(SEED_FILE)).length;
    }

    let proxies = 0;
    if (await fs.pathExists(PROXY_FILE)) {
        proxies = (await fs.readJson(PROXY_FILE)).length;
    }

    const boxWidth = 60;
    const line = "━".repeat(boxWidth);
    
    console.clear();
    console.log(`┏${line}┓`);
    console.log(`┃ ${"SIKHSANGAT ARCHIVE DASHBOARD".padEnd(boxWidth - 1)}┃`);
    console.log(`┣${line}┫`);
    console.log(`┃ Verified Proxies: ${proxies.toString().padEnd(boxWidth - 18)}┃`);
    console.log(`┃ Seed URLs Found:  ${seeds.toString().padEnd(boxWidth - 18)}┃`);
    console.log(`┃ Files Archived:   ${filesCount.toString().padEnd(boxWidth - 18)}┃`);
    console.log(`┣${line}┫`);
    
    if (await fs.pathExists(SEED_LOG)) {
        const seedLog = (await fs.readFile(SEED_LOG, 'utf8')).trim().split('\n').slice(-1)[0];
        console.log(`┃ Seed Log: ${seedLog?.substring(0, boxWidth - 11).padEnd(boxWidth - 10)}┃`);
    }
    
    if (await fs.pathExists(PROXY_LOG)) {
        const proxyLog = (await fs.readFile(PROXY_LOG, 'utf8')).trim().split('\n').slice(-1)[0];
        console.log(`┃ Proxy Log: ${proxyLog?.substring(0, boxWidth - 12).padEnd(boxWidth - 11)}┃`);
    }

    console.log(`┗${line}┛`);
    console.log(`\n(Press Ctrl+C to exit dashboard)`);
}

getStats();
setInterval(getStats, 2000);
