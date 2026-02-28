import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'sikhsangat_offline');

async function migrate() {
    const wwwDir = path.join(OUTPUT_DIR, 'www.sikhsangat.com');
    if (!fs.existsSync(wwwDir)) return console.log("No files to migrate.");

    // 1. Move files out of 'index.php' folder if it exists
    const phpDir = path.join(wwwDir, 'index.php');
    if (fs.existsSync(phpDir)) {
        console.log("Migrating files out of index.php folder...");
        const items = fs.readdirSync(phpDir);
        for (const item of items) {
            const oldPath = path.join(phpDir, item);
            const newPath = path.join(wwwDir, item);
            if (fs.existsSync(newPath)) fs.removeSync(newPath); // Avoid collisions
            fs.moveSync(oldPath, newPath);
        }
        fs.removeSync(phpDir);
    }

    console.log("✅ Migration complete. Folder structure is now clean.");
}

migrate();
