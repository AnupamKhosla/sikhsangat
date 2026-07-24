import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'docs');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const IMG_RE = /(?:src|href|data-src|data-background-src|poster)="([^"]*\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot)(?:\.[a-f0-9]+\.\w+)?[^"]*)"/gi;

function walkHtml(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walkHtml(full));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

function resolveAssetPath(ref, htmlFile) {
  const clean = ref.split('?')[0].split('#')[0];
  if (clean.startsWith('data:') || clean.startsWith('http') || clean.startsWith('//')) return null;
  const resolved = path.resolve(path.dirname(htmlFile), clean);
  if (!resolved.startsWith(DOCS)) return null;
  return resolved;
}

function toLiveUrl(localPath) {
  const rel = path.relative(DOCS, localPath);
  const parts = rel.split(path.sep);
  const host = parts[0];
  const rest = parts.slice(1).join('/');
  if (host === 'files.sikhsangat.com' || host === 'www.sikhsangat.com') {
    return `https://${host}/${rest}`;
  }
  return null;
}

async function run() {
  console.log('Scanning all HTML files for missing assets...');
  const htmlFiles = walkHtml(DOCS);
  console.log(`Found ${htmlFiles.length} HTML files`);

  const missing = new Map();
  for (const htmlFile of htmlFiles) {
    const content = fs.readFileSync(htmlFile, 'utf8');
    let match;
    IMG_RE.lastIndex = 0;
    while ((match = IMG_RE.exec(content)) !== null) {
      const ref = match[1];
      const localPath = resolveAssetPath(ref, htmlFile);
      if (!localPath) continue;
      if (fs.existsSync(localPath)) continue;
      const liveUrl = toLiveUrl(localPath);
      if (!liveUrl) continue;
      if (!missing.has(localPath)) missing.set(localPath, liveUrl);
    }
  }

  console.log(`Found ${missing.size} missing assets. Downloading...`);
  let ok = 0, fail = 0;
  const entries = [...missing.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [localPath, liveUrl] = entries[i];
    try {
      const resp = await axios.get(liveUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': UA },
        validateStatus: s => s >= 200 && s < 400,
      });
      await fs.ensureDir(path.dirname(localPath));
      await fs.writeFile(localPath, resp.data);
      ok++;
      if (ok % 20 === 0) console.log(`  ${ok}/${entries.length} downloaded...`);
    } catch (e) {
      fail++;
      console.log(`  FAIL: ${liveUrl} → ${e.message}`);
    }
    if (i % 2 === 1) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${ok} downloaded, ${fail} failed, ${entries.length} total missing`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
