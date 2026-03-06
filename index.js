import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'system.log');
const SESSION_FILE = path.join(LOG_DIR, 'runtime_state.json');

function appendSystemLog(message) {
    const line = `[${new Date().toLocaleTimeString()}] [SYSTEM] ${message}\n`;
    process.stdout.write(line);
    fs.appendFileSync(LOG_FILE, line);
}

function writeSessionState(state) {
    fs.writeJsonSync(SESSION_FILE, state, { spaces: 2 });
}

async function start() {
    console.log("\x1b[1;36m[ SYSTEM ] Starting SikhSangat Mirroring Engine (FOREGROUND MODE)...\x1b[0m");

    // Clear old processes
    try {
        console.log("[ SYSTEM ] Clearing old processes and ports...");
        execSync('node stop.js', { stdio: 'ignore' });
    } catch (e) {}

    await fs.ensureDir(LOG_DIR);
    const sessionId = `${Date.now()}-${process.pid}`;
    
    // Clear old log
    fs.writeFileSync(LOG_FILE, '');
    writeSessionState({
        active: true,
        sessionId,
        startedAt: new Date().toISOString(),
        pid: process.pid,
        logFile: LOG_FILE,
    });
    appendSystemLog(`SESSION START ${sessionId}`);

    console.log("\x1b[1;33m[ MANDATE ] Proxies are DISABLED per user request. Using LOCAL IP.\x1b[0m");

    // Helper to run a process and pipe output to both terminal and file
    const runProcess = (name, scriptPath) => {
        const p = spawn('node', [scriptPath]);
        
        p.stdout.on('data', (data) => {
            process.stdout.write(data);
            fs.appendFileSync(LOG_FILE, data);
        });
        
        p.stderr.on('data', (data) => {
            process.stderr.write(data);
            fs.appendFileSync(LOG_FILE, data);
        });

        p.on('exit', (code, signal) => {
            appendSystemLog(`${name} exited${signal ? ` on ${signal}` : ` with code ${code}`}.`);
        });
        
        return p;
    };

    // 1. Start Dashboard
    console.log("[ SYSTEM ] Launching Monitoring Dashboard...");
    const dashboard = runProcess('Dashboard', 'src/dashboard-server.js');

    // 2. Start Audit Engine
    console.log("[ SYSTEM ] Launching Periodic Audit Engine...");
    const auditor = runProcess('Auditor', 'src/audit-existing.js');

    // 3. Start Scraper
    console.log("[ SYSTEM ] Launching Scraper Engine (Main Process)...");
    const scraper = runProcess('Scraper', 'src/main.js');

    const stopSession = () => {
        const existing = fs.existsSync(SESSION_FILE) ? fs.readJsonSync(SESSION_FILE) : {};
        writeSessionState({
            ...existing,
            active: false,
            stoppedAt: new Date().toISOString(),
        });
    };

    scraper.on('exit', (code) => {
        console.log(`\x1b[1;31m[ SYSTEM ] Scraper exited with code ${code}.\x1b[0m`);
        if (dashboard) dashboard.kill();
        if (auditor) auditor.kill();
        stopSession();
        process.exit(code);
    });

    process.on('SIGINT', () => {
        console.log("\x1b[1;31m[ SYSTEM ] Emergency Shutdown Initiated...\x1b[0m");
        if (dashboard) dashboard.kill();
        if (auditor) auditor.kill();
        if (scraper) scraper.kill();
        stopSession();
        process.exit();
    });

    console.log("\x1b[1;32m[ SUCCESS ] Foreground Engine is live. Logs streaming to Terminal AND Dashboard.\x1b[0m");
}

start();
