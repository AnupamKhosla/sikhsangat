import { execSync } from 'child_process';

console.log("Stopping all background scraper processes...");
try {
    // Kill processes on our specific ports
    execSync('lsof -ti:3000,8081 | xargs kill -9 2>/dev/null || true');
    // Kill by name as a fallback
    execSync('pkill -f "node src/main.js" || true');
    execSync('pkill -f "node src/seed-extractor.js" || true');
    console.log("✅ All workers stopped.");
} catch (e) {
    console.log("⚠️ No active workers found.");
}
