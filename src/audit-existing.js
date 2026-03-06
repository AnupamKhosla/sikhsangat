import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const LIVE_URL_PATTERN = /(https?:)?\/\/(?:www\.)?sikhsangat\.com|(https?:)?\/\/files\.sikhsangat\.com|https:\/\/fonts\.googleapis\.com/i;

async function logAction(message) {
  const timestamp = new Date().toLocaleTimeString();
  const decorated = `\x1b[1;35m[${timestamp}] [AUDIT] ${message}\x1b[0m`;
  console.log(decorated);

  try {
    await axios.post(
      'http://127.0.0.1:3000/log',
      {
        msg: `[${timestamp}] ${message}`,
      },
      { timeout: 1000 },
    );
  } catch {}
}

function walk(dir) {
  let files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      files = files.concat(walk(fullPath));
      continue;
    }
    if (item.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function auditPages() {
  await logAction('Starting periodic audit of saved pages...');

  if (!fs.existsSync(OUTPUT_DIR)) {
    await logAction('docs/ does not exist yet.');
    return;
  }

  const files = walk(OUTPUT_DIR);
  let failed = 0;

  await logAction(`Found ${files.length} HTML pages to audit.`);

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const $ = cheerio.load(content);
      const relativePath = path.relative(OUTPUT_DIR, filePath);

      const issues = [];
      if ($('body').length === 0) {
        issues.push('missing <body>');
      }
      if (/Internal Server Error|Database Error|500 Error/i.test(content)) {
        issues.push('server error signature');
      }
      if (LIVE_URL_PATTERN.test(content)) {
        issues.push('live target URL remains');
      }
      if ($('script[data-offline-asset="offline-mirror.js"]').length === 0) {
        issues.push('offline runtime missing');
      }
      if ($('link[data-offline-asset="offline-mirror.css"]').length === 0) {
        issues.push('offline stylesheet missing');
      }
      if ($('form[action^="http"], form[action^="//"]').length > 0) {
        issues.push('form still points live');
      }

      if (issues.length > 0) {
        failed += 1;
        await logAction(`[FAILED AUDIT] ${relativePath} :: ${issues.join(', ')}`);
      }
    } catch (error) {
      failed += 1;
      await logAction(`[FAILED AUDIT] ${path.relative(OUTPUT_DIR, filePath)} :: ${error.message}`);
    }
  }

  await logAction(`Audit complete. Checked: ${files.length}, Failed: ${failed}.`);
}

auditPages();
if (process.env.AUDIT_ONCE !== '1') {
  setInterval(auditPages, 30 * 60 * 1000);
}
