import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { getLocalPath, normalizeRemoteUrl, ROOT_DIR } from './mirror-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(ROOT_DIR, 'logs', 'fidelity-reports');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'snapshots');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 2500;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CHROME_TEXT_PATTERN =
  /\b(?:Link to comment|Share on other sites|More sharing options(?:\.\.\.)?|Report(?:\s+Share)?|Quote|MultiQuote)\b/gi;

function normalizeText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/Â·/g, '·')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(normalizeText(value)).digest('hex');
}

function normalizeCommentBody(value = '') {
  return normalizeText(value)
    .replace(CHROME_TEXT_PATTERN, ' ')
    .replace(/\b\d+\s+(?=Link to comment\b)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFilePart(value = '') {
  return String(value)
    .replace(/https?:\/\//gi, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'page';
}

function parseArgs(argv) {
  const urls = [];
  let listFile = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      listFile = argv[index + 1] || '';
      index += 1;
      continue;
    }
    urls.push(arg);
  }

  return { urls, listFile };
}

async function collectUrls(argv) {
  const { urls, listFile } = parseArgs(argv);
  const expanded = [...urls];

  if (listFile) {
    const fileContent = await fs.readFile(path.resolve(ROOT_DIR, listFile), 'utf8');
    for (const line of fileContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        expanded.push(trimmed);
      }
    }
  }

  const normalized = expanded
    .map((entry) => normalizeRemoteUrl(entry))
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error('Provide at least one page URL or a --file list.');
  }

  return [...new Set(normalized)];
}

async function buildBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    viewport: { width: 1440, height: 2200 },
    locale: 'en-US',
  });

  return { browser, context };
}

async function startMirrorServer() {
  const app = express();
  app.use('/mirror', express.static(OUTPUT_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      }
      res.setHeader('Cache-Control', 'no-store');
    },
  }));

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function buildLocalMirrorUrl(localPath, serverBaseUrl) {
  const relativePath = path.relative(OUTPUT_DIR, localPath).split(path.sep).join('/');
  return `${serverBaseUrl}/mirror/${relativePath}`;
}

async function openPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => null);
  await page.waitForTimeout(DEFAULT_WAIT_AFTER_LOAD_MS);
}

function compareScalar(label, liveValue, localValue, mismatches) {
  if (normalizeText(liveValue) !== normalizeText(localValue)) {
    mismatches.push({
      kind: 'field',
      field: label,
      live: liveValue,
      local: localValue,
    });
  }
}

function compareArrays(label, liveValues, localValues, mismatches) {
  const liveList = Array.isArray(liveValues) ? liveValues : [];
  const localList = Array.isArray(localValues) ? localValues : [];
  if (JSON.stringify(liveList) !== JSON.stringify(localList)) {
    mismatches.push({
      kind: 'array',
      field: label,
      live: liveList,
      local: localList,
    });
  }
}

async function extractSnapshot(page, sourceLabel) {
  return page.evaluate(({ sourceLabel: innerSourceLabel }) => {
    const stripTransientUi = () => {
      document.querySelectorAll([
        'script',
        'style',
        'noscript',
        '.ipsAd',
        '.ipsResponsive_hidePhone[data-role="shareComment"]',
        '.ipsComment_tools',
        '.ipsComment_controls',
        '.ipsItem_controls',
        '.ipsItemStatus',
        '[data-role="commentActions"]',
        '[data-role="moderationTools"]',
        '[data-offline-disabled="true"] .ipsComposeArea_editor',
      ].join(',')).forEach((node) => node.remove());
    };

    stripTransientUi();

    const normalizeTextInner = (value = '') =>
      String(value)
        .replace(/\u00a0/g, ' ')
        .replace(/Â·/g, '·')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/–/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    const textFrom = (selector, root = document) =>
      normalizeTextInner(root.querySelector(selector)?.textContent || '');

    const htmlTextFrom = (selector, root = document) => {
      const node = root.querySelector(selector);
      if (!node) {
        return '';
      }
      const clone = node.cloneNode(true);
      clone.querySelectorAll([
        'script',
        'style',
        'noscript',
        '.ipsQuote_citation',
        '.ipsComment_tools',
        '.ipsComment_controls',
        '.ipsItem_controls',
        '.ipsItemStatus',
        '.ipsAd',
        '[data-role="commentActions"]',
      ].join(',')).forEach((child) => child.remove());
      return normalizeTextInner(clone.textContent || '');
    };

    const paginationRoot = Array.from(document.querySelectorAll('.ipsPagination')).find((node) =>
      node.closest('.ipsBox, .cTopic, .ipsLayout_mainArea') && /Page \d+ of \d+/i.test(node.textContent || ''),
    );

    const activePageNode = paginationRoot?.querySelector('.ipsPagination_active a, .ipsPagination_active');
    const pageJumpNode = paginationRoot?.querySelector('.ipsPagination_pageJump a, .ipsPagination_pageJump');
    const pageJumpText = normalizeTextInner(pageJumpNode?.textContent || '');
    const pageInfoMatch = pageJumpText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);

    const comments = Array.from(document.querySelectorAll('article[id^="elComment_"]')).map((article) => {
      const commentId =
        article.id.replace(/^elComment_/, '') ||
        article.querySelector('[data-commentid]')?.getAttribute('data-commentid') ||
        '';

      return {
        id: commentId,
        author:
          textFrom('.ipsComment_meta a.ipsType_break', article) ||
          textFrom('.cAuthorPane a.ipsType_break', article) ||
          textFrom('.ipsType_sectionHead a', article),
        datetime:
          article.querySelector('time[datetime]')?.getAttribute('datetime') ||
          normalizeTextInner(article.querySelector('time')?.textContent || ''),
        body: htmlTextFrom('.ipsComment_content .ipsType_richText, .ipsComment_content .cPost_contentWrap, .ipsComment_content', article),
      };
    });

    return {
      source: innerSourceLabel,
      pageUrl: location.href,
      title: normalizeTextInner(document.title),
      topicTitle: textFrom('h1.ipsType_pageTitle, h1[data-role="pageTitle"], .ipsType_pageTitle'),
      breadcrumb: Array.from(document.querySelectorAll('#elBreadcrumb li, .ipsBreadcrumb li'))
        .map((node) => normalizeTextInner(node.textContent || ''))
        .filter(Boolean),
      pagination: {
        current: pageInfoMatch ? Number(pageInfoMatch[1]) : Number(normalizeTextInner(activePageNode?.textContent || '')) || null,
        total: pageInfoMatch ? Number(pageInfoMatch[2]) : null,
        pageJumpText,
        nextLabel: textFrom('.ipsPagination_next a', paginationRoot || document),
        prevLabel: textFrom('.ipsPagination_prev a', paginationRoot || document),
      },
      repliesCount: textFrom('.ipsCommentCount'),
      joinConversationPresent: Boolean(Array.from(document.querySelectorAll('h2, h3')).find((node) =>
        normalizeTextInner(node.textContent || '').toLowerCase() === 'join the conversation',
      )),
      commentCount: comments.length,
      commentIds: comments.map((comment) => comment.id),
      commentAuthors: comments.map((comment) => comment.author),
      comments,
    };
  }, { sourceLabel });
}

async function preparePageForScreenshot(page) {
  await page.addStyleTag({
    content: `
      * {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      .ipsAd,
      .ipsComment_tools,
      .ipsComment_controls,
      .ipsItem_controls,
      .ipsItemStatus,
      [data-role="commentActions"],
      [data-role="moderationTools"] {
        display: none !important;
      }
    `,
  }).catch(() => {});
}

async function compareScreenshots(livePage, localPage, fileStem) {
  const liveMain = livePage.locator('main, #ipsLayout_mainArea, .ipsLayout_contentArea').first();
  const localMain = localPage.locator('main, #ipsLayout_mainArea, .ipsLayout_contentArea').first();
  const liveBuffer = await liveMain.screenshot();
  const localBuffer = await localMain.screenshot();
  const livePng = PNG.sync.read(liveBuffer);
  const localPng = PNG.sync.read(localBuffer);
  const width = Math.max(livePng.width, localPng.width);
  const height = Math.max(livePng.height, localPng.height);
  const diff = new PNG({ width, height });
  const liveCanvas = new PNG({ width, height });
  const localCanvas = new PNG({ width, height });

  PNG.bitblt(livePng, liveCanvas, 0, 0, livePng.width, livePng.height, 0, 0);
  PNG.bitblt(localPng, localCanvas, 0, 0, localPng.width, localPng.height, 0, 0);

  const mismatchPixels = pixelmatch(liveCanvas.data, localCanvas.data, diff.data, width, height, {
    threshold: 0.1,
  });

  const liveScreenshotPath = path.join(SCREENSHOT_DIR, `${fileStem}.live.png`);
  const localScreenshotPath = path.join(SCREENSHOT_DIR, `${fileStem}.local.png`);
  const diffScreenshotPath = path.join(SCREENSHOT_DIR, `${fileStem}.diff.png`);

  await fs.writeFile(liveScreenshotPath, liveBuffer);
  await fs.writeFile(localScreenshotPath, localBuffer);
  await fs.writeFile(diffScreenshotPath, PNG.sync.write(diff));

  return {
    mismatchPixels,
    mismatchRatio: Number((mismatchPixels / (width * height || 1)).toFixed(6)),
    screenshots: {
      live: liveScreenshotPath,
      local: localScreenshotPath,
      diff: diffScreenshotPath,
    },
  };
}

async function verifyUrl(context, liveUrl, serverBaseUrl) {
  const localPath = getLocalPath(liveUrl);
  if (!(await fs.pathExists(localPath))) {
    return {
      url: liveUrl,
      localPath,
      ok: false,
      mismatches: [{ kind: 'missing-local-page', localPath }],
    };
  }

  const localUrl = buildLocalMirrorUrl(localPath, serverBaseUrl);
  const livePage = await context.newPage();
  const localPage = await context.newPage();
  const mismatches = [];

  try {
    await openPage(livePage, liveUrl);
    await openPage(localPage, localUrl);
    await preparePageForScreenshot(livePage);
    await preparePageForScreenshot(localPage);

    const live = await extractSnapshot(livePage, 'live');
    const local = await extractSnapshot(localPage, 'local');

    compareScalar('title', live.title, local.title, mismatches);
    compareScalar('topicTitle', live.topicTitle, local.topicTitle, mismatches);
    compareScalar('pagination.current', live.pagination.current, local.pagination.current, mismatches);
    compareScalar('pagination.total', live.pagination.total, local.pagination.total, mismatches);
    compareScalar('repliesCount', live.repliesCount, local.repliesCount, mismatches);
    compareScalar('commentCount', live.commentCount, local.commentCount, mismatches);
    compareScalar('joinConversationPresent', live.joinConversationPresent, local.joinConversationPresent, mismatches);
    compareArrays('commentIds', live.commentIds, local.commentIds, mismatches);
    compareArrays('commentAuthors', live.commentAuthors, local.commentAuthors, mismatches);

    const liveById = new Map(live.comments.map((comment) => [comment.id, comment]));
    const localById = new Map(local.comments.map((comment) => [comment.id, comment]));
    const sharedCommentIds = live.commentIds.filter((commentId) => localById.has(commentId));

    for (const commentId of sharedCommentIds) {
      const liveComment = liveById.get(commentId);
      const localComment = localById.get(commentId);
      if (hashText(normalizeCommentBody(liveComment.body)) !== hashText(normalizeCommentBody(localComment.body))) {
        mismatches.push({
          kind: 'comment-body',
          commentId,
          liveAuthor: liveComment.author,
          localAuthor: localComment.author,
          liveSnippet: normalizeCommentBody(liveComment.body).slice(0, 240),
          localSnippet: normalizeCommentBody(localComment.body).slice(0, 240),
        });
      }
    }

    await fs.ensureDir(SCREENSHOT_DIR);
    const fileStem = sanitizeFilePart(liveUrl);
    let screenshotSummary = null;

    if (mismatches.length > 0) {
      screenshotSummary = await compareScreenshots(livePage, localPage, fileStem);
      if (screenshotSummary.mismatchRatio > 0.015) {
        mismatches.push({
          kind: 'screenshot-diff',
          mismatchPixels: screenshotSummary.mismatchPixels,
          mismatchRatio: screenshotSummary.mismatchRatio,
        });
      }
    }

    return {
      url: liveUrl,
      localPath,
      ok: mismatches.length === 0,
      mismatches,
      live,
      local,
      screenshots: screenshotSummary?.screenshots || null,
    };
  } finally {
    await livePage.close().catch(() => {});
    await localPage.close().catch(() => {});
  }
}

async function main() {
  const urls = await collectUrls(process.argv.slice(2));
  await fs.ensureDir(REPORT_DIR);

  const mirrorServer = await startMirrorServer();
  const { browser, context } = await buildBrowser();
  const results = [];

  try {
    for (const url of urls) {
      console.log(`[VERIFY] ${url}`);
      const result = await verifyUrl(context, url, mirrorServer.baseUrl);
      results.push(result);
      console.log(
        result.ok
          ? `[VERIFY PASS] ${url}`
          : `[VERIFY FAIL] ${url} :: ${result.mismatches.length} mismatch(es)`,
      );
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await mirrorServer.close().catch(() => {});
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };

  const reportPath = path.join(REPORT_DIR, `verify-page-fidelity-${Date.now()}.json`);
  await fs.writeJson(reportPath, report, { spaces: 2 });
  console.log(`[VERIFY REPORT] ${path.relative(ROOT_DIR, reportPath)}`);

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[VERIFY ERROR] ${error.message}`);
  process.exit(1);
});
