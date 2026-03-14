import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const LIVE_URL_PATTERN = /(https?:)?\/\/(?:www\.)?sikhsangat\.com|(https?:)?\/\/files\.sikhsangat\.com|https:\/\/fonts\.googleapis\.com/i;
const MALFORMED_LOCAL_REF_PATTERN = /upload:av-\d+\.(?:jpg|jpeg|png|gif|webp)|index\.htmlpage\/|:\/{3,}|\.xml\/(?=["'#\s>])/i;
const LOCAL_ASSET_REF_PATTERN = /(?:^|\/)(?:_offline\/|files\.sikhsangat\.com\/|www\.sikhsangat\.com\/).+|(?:\.(?:css|js|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot|map|json|xml|txt|pdf|webmanifest))$/i;

function resolveLocalTarget(filePath, reference) {
  const clean = String(reference || '').split('#')[0].split('?')[0];
  if (!clean || clean === '#' || /^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(clean)) {
    return null;
  }
  if (/^https?:\/\//i.test(clean) || clean.startsWith('//')) {
    return null;
  }
  if (!/^(?:\.\.\/|\.\/|\/)/.test(clean)) {
    return null;
  }
  const absolute = clean.startsWith('/')
    ? path.join(OUTPUT_DIR, clean)
    : path.resolve(path.dirname(filePath), clean);
  return absolute;
}

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
      if (MALFORMED_LOCAL_REF_PATTERN.test(content)) {
        issues.push('malformed local reference');
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

      const brokenLocalRefs = [];
      $('[href], [src], [poster], [data-src], [data-background-src]').each((_, element) => {
        if (brokenLocalRefs.length >= 10) {
          return;
        }
        for (const attr of ['href', 'src', 'poster', 'data-src', 'data-background-src']) {
          const rawValue = $(element).attr(attr);
          if (!rawValue) {
            continue;
          }
          const cleanValue = String(rawValue).split('#')[0].split('?')[0];
          if (!LOCAL_ASSET_REF_PATTERN.test(cleanValue)) {
            continue;
          }
          const target = resolveLocalTarget(filePath, rawValue);
          if (!target) {
            continue;
          }
          if (!fs.existsSync(target)) {
            brokenLocalRefs.push(`${attr}:${rawValue}`);
          }
        }
      });

      if (brokenLocalRefs.length > 0) {
        issues.push(`broken local refs (${brokenLocalRefs.slice(0, 3).join(', ')})`);
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
