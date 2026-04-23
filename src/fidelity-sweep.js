import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildBrowser, startMirrorServer, verifyUrl } from './verify-page-fidelity.js';
import { ROOT_DIR, normalizeRemoteUrl } from './mirror-utils.js';

const MIRROR_ROOT = path.join(ROOT_DIR, 'docs', 'www.sikhsangat.com');
const REPORT_DIR = path.join(ROOT_DIR, 'logs', 'fidelity-reports');
const DEFAULT_STALE_OUT = path.join(REPORT_DIR, 'stale.json');
const DEFAULT_REPORT_OUT = path.join(REPORT_DIR, 'sweep-report.json');
const LIVE_ORIGIN = 'https://www.sikhsangat.com';

function parseArgs(argv) {
  const opts = {
    limit: 0,
    offset: 0,
    jitter: 2000,
    concurrency: 2,
    out: DEFAULT_STALE_OUT,
    reportOut: DEFAULT_REPORT_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') opts.limit = Number(argv[++i]) || 0;
    else if (a === '--offset') opts.offset = Number(argv[++i]) || 0;
    else if (a === '--jitter') opts.jitter = Number(argv[++i]) || 2000;
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]) || 2;
    else if (a === '--out') opts.out = path.resolve(ROOT_DIR, argv[++i]);
    else if (a === '--report-out') opts.reportOut = path.resolve(ROOT_DIR, argv[++i]);
  }
  return opts;
}

async function walkIndexHtmlFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === 'index.html') {
        results.push(full);
      }
    }
  }
  return results.sort();
}

function localPathToLiveUrl(localPath) {
  const relative = path.relative(MIRROR_ROOT, localPath).split(path.sep).join('/');
  if (!relative || relative === 'index.html') {
    return `${LIVE_ORIGIN}/`;
  }
  const trimmed = relative.replace(/\/index\.html$/, '').replace(/^index\.html$/, '');
  if (!trimmed) {
    return `${LIVE_ORIGIN}/`;
  }
  return `${LIVE_ORIGIN}/${trimmed}/`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMappingOnlyFailure(result) {
  if (!result || result.ok || !Array.isArray(result.mismatches) || result.mismatches.length === 0) {
    return false;
  }
  return result.mismatches.every((entry) => entry?.kind === 'missing-local-page');
}

async function runBatch(queue, context, serverBaseUrl, concurrency) {
  const slice = queue.splice(0, concurrency);
  return Promise.all(
    slice.map(async (url) => {
      try {
        return await verifyUrl(context, url, serverBaseUrl);
      } catch (error) {
        return {
          url,
          ok: false,
          mismatches: [{ kind: 'verify-error', message: error?.message || String(error) }],
        };
      }
    }),
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!(await fs.pathExists(MIRROR_ROOT))) {
    throw new Error(`Mirror root not found: ${MIRROR_ROOT}`);
  }

  console.log(`[SWEEP] Scanning ${path.relative(ROOT_DIR, MIRROR_ROOT)} for mirrored pages...`);
  const allLocal = await walkIndexHtmlFiles(MIRROR_ROOT);
  console.log(`[SWEEP] Found ${allLocal.length} mirrored index.html page(s).`);

  let targetsSlice = allLocal.slice(opts.offset);
  if (opts.limit > 0) {
    targetsSlice = targetsSlice.slice(0, opts.limit);
  }

  const liveUrls = targetsSlice
    .map(localPathToLiveUrl)
    .map((url) => normalizeRemoteUrl(url))
    .filter(Boolean);
  const uniqueUrls = [...new Set(liveUrls)];

  console.log(
    `[SWEEP] Verifying ${uniqueUrls.length} page(s) (offset=${opts.offset}, limit=${opts.limit || 'none'}, concurrency=${opts.concurrency}, jitter=${opts.jitter}ms).`,
  );

  if (process.env.SCRAPER_REMOTE_FETCH_ENDPOINT && process.env.SCRAPER_REMOTE_FETCH_TOKEN) {
    console.log(`[SWEEP] Proxy configured: ${process.env.SCRAPER_REMOTE_FETCH_ENDPOINT} (scraper will use it on upstream 500s).`);
  } else {
    console.log('[SWEEP] No proxy configured. Direct origin only; origin 500s will count as mismatches.');
  }

  await fs.ensureDir(REPORT_DIR);
  const mirrorServer = await startMirrorServer();
  const { browser, context } = await buildBrowser();
  const results = [];
  const queue = [...uniqueUrls];
  let completed = 0;

  try {
    while (queue.length > 0) {
      const batchResults = await runBatch(queue, context, mirrorServer.baseUrl, opts.concurrency);
      results.push(...batchResults);
      completed += batchResults.length;
      for (const r of batchResults) {
        if (r.ok) {
          console.log(`[PASS] ${r.url}`);
        } else {
          const kinds = (r.mismatches || []).map((m) => m.kind || 'unknown').slice(0, 3).join(',');
          console.log(`[FAIL] ${r.url} :: ${r.mismatches?.length || 0} mismatch(es) [${kinds}]`);
        }
      }
      console.log(`[SWEEP] Progress: ${completed}/${uniqueUrls.length}`);
      if (queue.length > 0) {
        await sleep(opts.jitter);
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await mirrorServer.close().catch(() => {});
  }

  const staleResults = results.filter((r) => !r.ok && !isMappingOnlyFailure(r));
  const mappingOnlyFailures = results.filter((r) => isMappingOnlyFailure(r));
  const staleUrls = staleResults.map((r) => r.url);

  await fs.writeJson(opts.out, staleUrls, { spaces: 2 });

  const report = {
    generatedAt: new Date().toISOString(),
    scannedRoot: MIRROR_ROOT,
    mirroredPages: allLocal.length,
    verified: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: staleUrls.length,
    mappingOnlyFailures: mappingOnlyFailures.length,
    staleOutput: opts.out,
    results,
  };
  await fs.writeJson(opts.reportOut, report, { spaces: 2 });

  console.log(
    `[SWEEP DONE] ${report.passed} ok / ${report.failed} stale / ${report.mappingOnlyFailures} path-reverse-miss out of ${report.verified}.`,
  );
  console.log(`[SWEEP STALE LIST] ${path.relative(ROOT_DIR, opts.out)}`);
  console.log(`[SWEEP REPORT]     ${path.relative(ROOT_DIR, opts.reportOut)}`);

  if (staleUrls.length > 0) {
    process.exitCode = 1;
  }
}

const INVOKED_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (INVOKED_DIRECTLY) {
  main().catch((error) => {
    console.error(`[SWEEP ERROR] ${error?.stack || error?.message || error}`);
    process.exit(1);
  });
}
