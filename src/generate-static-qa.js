import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');
const MIRROR_DIR = path.join(OUTPUT_DIR, 'www.sikhsangat.com');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'qa-data.js');

async function collectHtmlFiles(dir) {
  if (!(await fs.pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(fullPath)));
      continue;
    }

    if (entry.name.endsWith('.html')) {
      const stats = await fs.stat(fullPath);
      files.push({
        path: path.relative(OUTPUT_DIR, fullPath).split(path.sep).join('/'),
        modifiedAt: stats.mtimeMs,
      });
    }
  }

  return files;
}

async function main() {
  const files = await collectHtmlFiles(MIRROR_DIR);
  files.sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path));

  const payload = {
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    pageSize: 50,
    files,
  };

  const content = `window.__MIRROR_QA__ = ${JSON.stringify(payload, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, content, 'utf8');

  console.log(`Static QA snapshot written to ${path.relative(ROOT_DIR, OUTPUT_FILE)} with ${files.length} pages.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
