import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import * as cheerio from 'cheerio';
import { spawnSync } from 'child_process';
import {
  OUTPUT_DIR,
  ensureOfflineSupportFiles,
  getLocalPath,
  normalizeRemoteUrl,
  rewriteCssContent,
  rewriteJavascriptMapContent,
  repairExistingCssFile,
  repairExistingHtmlFile,
  repairExistingRootMapFile,
} from './mirror-utils.js';

const HTML_ATTRS = ['href', 'src', 'poster', 'data-src', 'data-background-src', 'content'];
const TEXT_EXTENSIONS = new Set(['.css', '.js', '.mjs', '.json', '.txt', '.xml', '.webmanifest', '.map']);
const ASSET_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.map',
  '.json',
  '.xml',
  '.txt',
  '.webmanifest',
]);
const CURL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.name.endsWith('.html') || entry.name.endsWith('.css') || entry.name === 'root_map.js') {
      files.push(fullPath);
    }
  }

  return files;
}

function isAssetLocalPath(localPath) {
  const extension = path.extname(localPath).toLowerCase();
  if (ASSET_EXTENSIONS.has(extension)) {
    return true;
  }

  return (
    localPath.includes(`${path.sep}applications${path.sep}`) ||
    localPath.includes(`${path.sep}set_resources_`) ||
    localPath.includes(`${path.sep}javascript_`) ||
    localPath.includes(`${path.sep}monthly_`) ||
    localPath.includes(`${path.sep}emoticons${path.sep}`)
  );
}

function localPathToRemoteUrl(localPath) {
  const relativePath = path.relative(OUTPUT_DIR, localPath).split(path.sep).join('/');
  if (
    !relativePath ||
    relativePath.startsWith('_offline/') ||
    relativePath.endsWith('/index.html') ||
    relativePath.endsWith('.html')
  ) {
    return null;
  }
  if (relativePath.startsWith('files.sikhsangat.com/')) {
    return `https://files.sikhsangat.com/${relativePath.slice('files.sikhsangat.com/'.length)}`;
  }
  if (relativePath.startsWith('www.sikhsangat.com/')) {
    return `https://www.sikhsangat.com/${relativePath.slice('www.sikhsangat.com/'.length)}`;
  }
  return null;
}

function resolveLocalReference(filePath, rawValue) {
  if (!rawValue) {
    return null;
  }

  const value = String(rawValue).trim().replace(/&amp;/g, '&');
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:') ||
    /^(https?:)?\/\//i.test(value)
  ) {
    return null;
  }

  const cleanValue = value.split('#')[0].split('?')[0];
  if (!cleanValue || (!cleanValue.startsWith('./') && !cleanValue.startsWith('../') && !cleanValue.startsWith('/'))) {
    return null;
  }

  const baseDir = path.dirname(filePath);
  const resolved = cleanValue.startsWith('/')
    ? path.join(OUTPUT_DIR, cleanValue.replace(/^\/+/, ''))
    : path.resolve(baseDir, cleanValue);

  if (
    !resolved.startsWith(OUTPUT_DIR) ||
    resolved.includes(`${path.sep}_offline${path.sep}`) ||
    resolved.endsWith(`${path.sep}index.html`) ||
    resolved.endsWith('.html') ||
    !isAssetLocalPath(resolved)
  ) {
    return null;
  }

  return resolved;
}

function extractCssReferences(filePath, content) {
  const references = [];
  const urlMatches = content.matchAll(/url\(([^)]+)\)/gi);
  for (const match of urlMatches) {
    const rawValue = match[1].trim().replace(/^['"]|['"]$/g, '');
    const resolved = resolveLocalReference(filePath, rawValue);
    if (resolved) {
      references.push(resolved);
    }
  }

  const importMatches = content.matchAll(/@import\s+['"]([^'"]+)['"]/gi);
  for (const match of importMatches) {
    const resolved = resolveLocalReference(filePath, match[1]);
    if (resolved) {
      references.push(resolved);
    }
  }

  return references;
}

function extractHtmlReferences(filePath, content) {
  const references = [];
  const $ = cheerio.load(content);

  $('*').each((_, element) => {
    for (const attr of HTML_ATTRS) {
      const rawValue = $(element).attr(attr);
      const resolved = resolveLocalReference(filePath, rawValue);
      if (resolved) {
        references.push(resolved);
      }
    }

    const srcset = $(element).attr('srcset');
    if (srcset) {
      for (const entry of srcset.split(',')) {
        const candidate = entry.trim().split(/\s+/)[0];
        const resolved = resolveLocalReference(filePath, candidate);
        if (resolved) {
          references.push(resolved);
        }
      }
    }

    const style = $(element).attr('style');
    if (style) {
      references.push(...extractCssReferences(filePath, style));
    }
  });

  return references;
}

function extractReferences(filePath, content) {
  if (filePath.endsWith('.css')) {
    return extractCssReferences(filePath, content);
  }

  if (filePath.endsWith('.html')) {
    return extractHtmlReferences(filePath, content);
  }

  return [];
}

async function writeDownloadedAsset(url, body, headers = {}) {
  const filePath = getLocalPath(url, { isAsset: true });
  const contentType = (headers['content-type'] || '').toLowerCase();
  await fs.ensureDir(path.dirname(filePath));

  if (contentType.includes('text/css') || filePath.endsWith('.css')) {
    const cssContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    const rewritten = rewriteCssContent(cssContent, url);
    await fs.writeFile(filePath, rewritten.content, 'utf8');
    return rewritten.assetUrls.map((assetUrl) => getLocalPath(assetUrl, { isAsset: true }));
  }

  if (filePath.endsWith(`${path.sep}javascript_global${path.sep}root_map.js`)) {
    const scriptContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    const rewritten = rewriteJavascriptMapContent(scriptContent, url);
    await fs.writeFile(filePath, rewritten, 'utf8');
    return [];
  }

  const extension = path.extname(filePath).toLowerCase();
  if (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    const textContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    await fs.writeFile(filePath, textContent, 'utf8');
    return [];
  }

  await fs.writeFile(filePath, Buffer.isBuffer(body) ? body : Buffer.from(body));
  return [];
}

function parseCurlHeaders(headerContent) {
  const sections = String(headerContent)
    .split(/\r?\n\r?\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const lines = sections[index].split(/\r?\n/).filter(Boolean);
    if (!lines[0] || !/^HTTP\/\d/i.test(lines[0])) {
      continue;
    }

    const headers = {};
    for (const line of lines.slice(1)) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      headers[key] = value;
    }
    return headers;
  }

  return {};
}

async function fetchWithCurl(url) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mirror-backfill-'));
  const headerPath = path.join(tempDir, 'headers.txt');

  try {
    const result = spawnSync(
      'curl',
      [
        '-sS',
        '-L',
        '--fail',
        '--connect-timeout',
        '15',
        '--max-time',
        '45',
        '-A',
        CURL_USER_AGENT,
        '-D',
        headerPath,
        url,
      ],
      {
        encoding: null,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString('utf8').trim() || `curl exited with status ${result.status}`;
      throw new Error(stderr);
    }

    const headerContent = await fs.readFile(headerPath, 'utf8').catch(() => '');
    return {
      body: result.stdout,
      headers: parseCurlHeaders(headerContent),
    };
  } finally {
    await fs.remove(tempDir);
  }
}

async function backfillMissingAssets(files) {
  const pendingLocalPaths = new Set();

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8').catch(() => null);
    if (!content) {
      continue;
    }

    for (const localPath of extractReferences(filePath, content)) {
      if (!(await fs.pathExists(localPath))) {
        pendingLocalPaths.add(localPath);
      }
    }
  }

  let downloaded = 0;
  let failed = 0;
  const seenRemoteUrls = new Set();
  const queue = Array.from(pendingLocalPaths);

  while (queue.length > 0) {
    const localPath = queue.shift();
    if (!localPath || (await fs.pathExists(localPath))) {
      continue;
    }

    const remoteUrl = localPathToRemoteUrl(localPath);
    if (!remoteUrl || seenRemoteUrls.has(remoteUrl)) {
      continue;
    }
    seenRemoteUrls.add(remoteUrl);

    try {
      const response = await fetchWithCurl(remoteUrl);
      const nestedLocalPaths = await writeDownloadedAsset(remoteUrl, response.body, response.headers);
      downloaded += 1;

      for (const nestedPath of nestedLocalPaths) {
        if (!(await fs.pathExists(nestedPath))) {
          queue.push(nestedPath);
        }
      }
    } catch (error) {
      failed += 1;
      console.warn(`[BACKFILL] Failed ${remoteUrl}: ${error.message}`);
    }
  }

  return {
    initialMissing: pendingLocalPaths.size,
    downloaded,
    failed,
  };
}

async function main() {
  await ensureOfflineSupportFiles();

  if (!(await fs.pathExists(OUTPUT_DIR))) {
    console.log('docs/ does not exist yet.');
    return;
  }

  const files = await collectFiles(OUTPUT_DIR);
  let htmlCount = 0;
  let cssCount = 0;
  let jsCount = 0;

  for (const filePath of files) {
    if (filePath.includes(`${path.sep}_offline${path.sep}`)) {
      continue;
    }

    if (filePath.endsWith('.html')) {
      await repairExistingHtmlFile(filePath);
      htmlCount += 1;
      continue;
    }

    if (filePath.endsWith('.css')) {
      await repairExistingCssFile(filePath);
      cssCount += 1;
      continue;
    }

    if (filePath.endsWith(`${path.sep}root_map.js`)) {
      await repairExistingRootMapFile(filePath);
      jsCount += 1;
    }
  }

  const backfill = await backfillMissingAssets(files);

  console.log(
    `Repaired ${htmlCount} HTML files, ${cssCount} CSS files, and ${jsCount} JS maps. ` +
      `Backfill queued ${backfill.initialMissing} missing assets, downloaded ${backfill.downloaded}, failed ${backfill.failed}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
