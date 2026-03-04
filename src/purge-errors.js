import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');

const ERROR_SIGNATURES = [
    'Internal Server Error',
    '500 Error',
    'Link to database could not be established',
    'Database Error',
    'Something went wrong'
];

async function purge() {
    console.log("Starting Deep Audit of mirrored pages...");
    let purgedCount = 0;
    let totalChecked = 0;

    const walk = async (dir) => {
        if (!await fs.pathExists(dir)) return;
        const files = await fs.readdir(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                await walk(fullPath);
            } else if (file.endsWith('.html')) {
                totalChecked++;
                const content = await fs.readFile(fullPath, 'utf8');
                const $ = cheerio.load(content);
                
                const hasErrorSig = ERROR_SIGNATURES.some(sig => content.includes(sig));
                const isTopicPage = fullPath.includes('/topic/');
                const isEmptyTopic = isTopicPage && $('.ipsComment_text').length === 0;
                
                if (hasErrorSig || isEmptyTopic) {
                    const reason = hasErrorSig ? "Server Error Sig" : "Empty Topic Content";
                    console.log(`[PURGE] Deleting (${reason}): ${fullPath}`);
                    await fs.remove(fullPath);
                    purgedCount++;
                }
            }
        }
    };

    await walk(OUTPUT_DIR);

    console.log(`\nAudit Complete.`);
    console.log(`Total Pages Checked: ${totalChecked}`);
    console.log(`Total Pages Purged: ${purgedCount}`);

    if (fs.existsSync(CONFIG_FILE)) {
        const config = await fs.readJson(CONFIG_FILE);
        config.downloadedCount = Math.max(0, config.downloadedCount - purgedCount);
        await fs.outputJson(CONFIG_FILE, config, { spaces: 2 });
        console.log(`Updated downloadedCount to: ${config.downloadedCount}`);
    }
}

purge().catch(console.error);
