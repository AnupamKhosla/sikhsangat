import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, 'logs', 'dashboard.port');

console.log("Stopping all background scraper processes...");

let port = '';
try {
  if (fs.existsSync(PORT_FILE)) port = fs.readFileSync(PORT_FILE, 'utf8').trim();
} catch {}
if (!/^\d+$/.test(port)) {
  const envPort = String(process.env.DASHBOARD_PORT || '').trim();
  if (/^\d+$/.test(envPort)) port = envPort;
}

try {
  if (port) execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
  execSync('pkill -f "node src/main.js" || true');
  execSync('pkill -f "node src/seed-extractor.js" || true');
  execSync('pkill -f "node src/dashboard-server.js" || true');
  try { fs.rmSync(PORT_FILE, { force: true }); } catch {}
  console.log(`✅ All workers stopped.${port ? ` (dashboard port ${port})` : ''}`);
} catch (e) {
  console.log("⚠️ No active workers found.");
}
