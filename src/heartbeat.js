import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'logs', 'system.log');

function checkPort(port) {
    try {
        const out = execSync(`lsof -i :${port}`).toString();
        return out.length > 0;
    } catch (e) {
        return false;
    }
}

const status = {
    dashboard: checkPort(3000),
    proxy: checkPort(8081),
    scraperActive: false,
    lastLogLines: []
};

if (fs.existsSync(LOG_FILE)) {
    const fullLog = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = fullLog.split(/\r?\n/).filter(l => l.trim());
    status.lastLogLines = lines.slice(-5);
    status.scraperActive = status.lastLogLines.length > 0;
}

console.log(JSON.stringify(status, null, 2));
