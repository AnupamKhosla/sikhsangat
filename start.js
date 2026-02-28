import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    console.log("\x1b[1;36m[ SYSTEM ] Starting Strict Mirror Lifecycle...\x1b[0m");

    // 1. Clean ports
    execSync('lsof -ti:3000,8081 | xargs kill -9 2>/dev/null || true');

    // 2. Start Dashboard in background
    console.log("[ SYSTEM ] Launching Dashboard...");
    const dashboard = spawn('node', ['src/dashboard-server.js'], { detached: true, stdio: 'ignore' });
    dashboard.unref();

    // 3. Wait and Verify
    await new Promise(r => setTimeout(r, 5000));
    
    try {
        console.log("[ SYSTEM ] Running Data Integrity Audit...");
        execSync('node src/verify-dashboard.js', { stdio: 'inherit' });
    } catch (e) {
        console.error("\x1b[1;31m[ FATAL ] Audit Failed! Killing all services.\x1b[0m");
        execSync('lsof -ti:3000,8081 | xargs kill -9 2>/dev/null || true');
        process.exit(1); // STOP HERE
    }

    // 4. Start Scraper
    console.log("\x1b[1;32m[ SYSTEM ] Audit Passed. Launching Scraper Engine...\x1b[0m");
    const scraper = spawn('node', ['src/main.js'], { stdio: 'inherit' });
}

run();
