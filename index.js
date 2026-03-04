import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
    console.log("\x1b[1;36m[ SYSTEM ] Starting SikhSangat Mirroring Engine (FOREGROUND MODE)...\x1b[0m");

    // Clear old processes
    try {
        console.log("[ SYSTEM ] Clearing old processes and ports...");
        execSync('node stop.js', { stdio: 'ignore' });
    } catch (e) {}

    await fs.ensureDir(path.join(__dirname, 'logs'));
    const logFile = path.join(__dirname, 'logs', 'system.log');
    
    // Clear old log
    fs.writeFileSync(logFile, '');

    console.log("\x1b[1;33m[ MANDATE ] Proxies are DISABLED per user request. Using LOCAL IP.\x1b[0m");

    // Helper to run a process and pipe output to both terminal and file
    const runProcess = (name, scriptPath) => {
        const p = spawn('node', [scriptPath]);
        
        p.stdout.on('data', (data) => {
            process.stdout.write(data);
            fs.appendFileSync(logFile, data);
        });
        
        p.stderr.on('data', (data) => {
            process.stderr.write(data);
            fs.appendFileSync(logFile, data);
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

    scraper.on('exit', (code) => {
        console.log(`\x1b[1;31m[ SYSTEM ] Scraper exited with code ${code}.\x1b[0m`);
        if (dashboard) dashboard.kill();
        if (auditor) auditor.kill();
        process.exit(code);
    });

    process.on('SIGINT', () => {
        console.log("\x1b[1;31m[ SYSTEM ] Emergency Shutdown Initiated...\x1b[0m");
        if (dashboard) dashboard.kill();
        if (auditor) auditor.kill();
        if (scraper) scraper.kill();
        process.exit();
    });

    console.log("\x1b[1;32m[ SUCCESS ] Foreground Engine is live. Logs streaming to Terminal AND Dashboard.\x1b[0m");
}

start();
