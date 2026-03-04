import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const logAction = async (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `\x1b[1;35m[${timestamp}] [AUDIT] ${msg}\x1b[0m`;
    console.log(logMsg);
    try {
        await axios.post('http://127.0.0.1:3000/log', { 
            msg: `[${timestamp}] ${msg}`
        }, { timeout: 1000 }).catch(() => {});
    } catch(e) {}
};

async function auditPages() {
    await logAction("Starting periodic audit of existing downloaded pages...");
    
    if (!fs.existsSync(OUTPUT_DIR)) {
        await logAction("Output directory docs/ does not exist yet.");
        return;
    }

    let total = 0;
    let failed = 0;

    const walk = (dir) => {
        let files = [];
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const full = path.join(dir, item);
            if (fs.statSync(full).isDirectory()) {
                files = files.concat(walk(full));
            } else if (item.endsWith('.html')) {
                files.push(full);
            }
        }
        return files;
    };

    const files = walk(OUTPUT_DIR);
    total = files.length;

    await logAction(`Found ${total} HTML pages to audit.`);

    for (const file of files) {
        try {
            const content = await fs.readFile(file, 'utf-8');
            const $ = cheerio.load(content);
            
            // Basic Checks
            const hasBody = $('body').length > 0;
            const isErrorPage = content.includes('Internal Server Error') || content.includes('Database Error') || content.includes('500 Error');
            
            if (!hasBody || isErrorPage) {
                failed++;
                await logAction(`[FAILED AUDIT] ${path.relative(OUTPUT_DIR, file)} - Missing body or contains Server Error`);
                // Optionally move to quarantine or delete to trigger re-scrape
                // await fs.remove(file);
            }
        } catch (e) {
            failed++;
            await logAction(`[FAILED AUDIT] ${path.relative(OUTPUT_DIR, file)} - Read Error: ${e.message}`);
        }
    }

    await logAction(`Audit Complete. Checked: ${total}, Failed: ${failed}.`);
}

// Run immediately, then every 30 minutes
auditPages();
setInterval(auditPages, 30 * 60 * 1000);
