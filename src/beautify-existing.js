import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import prettier from 'prettier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'sikhsangat_offline');

async function beautifyFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf8');
    const parserMap = { '.html': 'html', '.css': 'css', '.js': 'babel' };
    const parser = parserMap[ext];
    
    if (!parser) return;

    try {
        // Aggressive pre-processing
        let clean = content.replace(/\n\s*\n\s*\n/g, '\n\n');

        const formatted = await prettier.format(clean, {
            parser: parser,
            printWidth: 100,
            tabWidth: 2,
            useTabs: false,
            htmlWhitespaceSensitivity: 'ignore',
            endOfLine: 'lf'
        });

        fs.writeFileSync(filePath, formatted);
        console.log(`[AGGRESSIVE CLEAN] ${path.relative(OUTPUT_DIR, filePath)}`);
    } catch (e) {
        // console.error(`[SKIP] ${filePath}`);
    }
}

async function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) await walk(full);
        else await beautifyFile(full);
    }
}

console.log("Starting Aggressive Whitespace Purge...");
walk(OUTPUT_DIR).then(() => console.log("✅ All files are now ultra-clean."));
