import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.join(__dirname, '..');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');
export const PRIMARY_HOST = 'www.sikhsangat.com';
export const TARGET_HOSTS = new Set(['sikhsangat.com', 'www.sikhsangat.com', 'files.sikhsangat.com']);
export const OFFLINE_DIR = path.join(OUTPUT_DIR, '_offline');
export const OFFLINE_STYLE_FILE = path.join(OFFLINE_DIR, 'offline-mirror.css');
export const OFFLINE_SCRIPT_FILE = path.join(OFFLINE_DIR, 'offline-mirror.js');
export const OFFLINE_MANIFEST_FILE = path.join(OFFLINE_DIR, 'mirror.webmanifest');
export const OFFLINE_BROWSERCONFIG_FILE = path.join(OFFLINE_DIR, 'browserconfig.xml');

const OFFLINE_STYLE_NAME = 'offline-mirror.css';
const OFFLINE_SCRIPT_NAME = 'offline-mirror.js';
const OFFLINE_MANIFEST_NAME = 'mirror.webmanifest';
const OFFLINE_BROWSERCONFIG_NAME = 'browserconfig.xml';
const PAGE_QUERY_ORDER = ['page', 'tab', 'all_activity', 'do', 'sortby', 'sortdirection', 'type', 'status', 'filter'];
const EPHEMERAL_QUERY_KEYS = new Set(['csrfKey', '_', 'ref', 'referrer', 'token']);
const URLISH_ATTRS = [
  'href',
  'src',
  'action',
  'poster',
  'value',
  'data-src',
  'data-background-src',
  'data-ipshover-target',
  'data-ipsdialog-url',
  'data-ipsselecttree-url',
  'data-baseurl',
  'data-streamurl',
  'data-url',
  'data-webshareurl',
  'content',
  'srcset',
];
const CLICKLESS_ATTRS = [
  'data-ipshover',
  'data-ipshover-target',
  'data-ipsdialog',
  'data-ipsdialog-url',
  'data-ipsmenu',
  'data-ipsmenu-closeonclick',
  'data-ipshover',
];
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
  '.pdf',
  '.webmanifest',
]);

const OFFLINE_STYLE_CONTENT = `:root {
  --offline-font-stack: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: var(--offline-font-stack);
}

body[data-offline-mirror="true"] .ipsModal,
body[data-offline-mirror="true"] #elRegisterForm,
body[data-offline-mirror="true"] #elGuestSignIn,
body[data-offline-mirror="true"] #elGuestTerms,
body[data-offline-mirror="true"] .ipsSticky,
body[data-offline-mirror="true"] [data-role="guestTermsBar"],
body[data-offline-mirror="true"] form[data-offline-disabled="true"] {
  display: none !important;
}

body[data-offline-mirror="true"] [data-offline-disabled="true"] {
  pointer-events: none !important;
}

body[data-offline-mirror="true"] [data-offline-tab-panel][hidden] {
  display: none !important;
}

body[data-offline-mirror="true"] .ipsPagination a,
body[data-offline-mirror="true"] [data-role="tab"],
body[data-offline-mirror="true"] [role="tab"] {
  cursor: pointer;
}
`;

const OFFLINE_SCRIPT_CONTENT = `(() => {
  const OFFLINE_ATTR = 'data-offline-mirror';

  const disableHistory = () => {
    if (location.protocol !== 'file:') {
      return;
    }
    const noop = () => undefined;
    try {
      history.pushState = noop;
      history.replaceState = noop;
    } catch {}
  };

  const disableNetwork = () => {
    const shouldBlock = (value) => typeof value === 'string' && /^https?:\\/\\//i.test(value);
    const offlineError = () => Promise.reject(new Error('Offline mirror disabled live network access'));

    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === 'function') {
      globalThis.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (shouldBlock(url)) {
          return offlineError();
        }
        return originalFetch(input, init);
      };
    }

    if (typeof globalThis.XMLHttpRequest === 'function') {
      const OriginalXHR = globalThis.XMLHttpRequest;
      globalThis.XMLHttpRequest = class OfflineXMLHttpRequest extends OriginalXHR {
        open(method, url, ...rest) {
          if (shouldBlock(url)) {
            throw new Error('Offline mirror disabled live XHR');
          }
          return super.open(method, url, ...rest);
        }
      };
    }
  };

  const hardenIpsSettings = () => {
    if (!globalThis.ipsSettings || typeof globalThis.ipsSettings !== 'object') {
      return;
    }

    globalThis.ipsSettings.links_external = false;
    globalThis.ipsSettings.googleAnalyticsEnabled = false;
    globalThis.ipsSettings.matomoEnabled = false;
    globalThis.ipsSettings.disableNotificationSounds = true;
  };

  const decodeCompiledScriptSources = (value) => {
    try {
      const parsed = new URL(value, location.href);
      const src = parsed.searchParams.get('src');
      if (!src) {
        return [];
      }
      return src
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => decodeURIComponent(entry))
        .map((entry) => (entry.startsWith('file:') ? entry.replace(/[?&]v=[^?#]+$/, '') : entry));
    } catch {
      return [];
    }
  };

  const loadLocalScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error('Failed to load offline script: ' + src));
      (document.head || document.documentElement).appendChild(script);
    });

  const installCompiledScriptShim = () => {
    const $ = globalThis.jQuery || globalThis.$;
    if (!$ || typeof $.ajax !== 'function' || $.ajax.__offlineMirrorPatched) {
      return;
    }

    const originalAjax = $.ajax.bind($);
    const patchedAjax = function (options) {
      const settings = typeof options === 'string' ? { url: options } : { ...(options || {}) };
      const isCompiledScriptRequest =
        settings.dataType === 'script' &&
        typeof settings.url === 'string' &&
        settings.url.includes('js.php?src=');

      if (!isCompiledScriptRequest) {
        return originalAjax.apply(this, arguments);
      }

      const sources = decodeCompiledScriptSources(settings.url);
      if (!sources.length) {
        return originalAjax.apply(this, arguments);
      }

      const deferred = $.Deferred();
      (async () => {
        for (const src of sources) {
          await loadLocalScript(src);
        }
      })()
        .then(() => {
          if (typeof settings.success === 'function') {
            settings.success(undefined, 'success', undefined);
          }
          if (typeof settings.complete === 'function') {
            settings.complete(undefined, 'success');
          }
          deferred.resolve();
        })
        .catch((error) => {
          if (typeof settings.error === 'function') {
            settings.error(undefined, 'error', error);
          }
          if (typeof settings.complete === 'function') {
            settings.complete(undefined, 'error');
          }
          deferred.reject(undefined, 'error', error);
        });

      return deferred.promise();
    };

    patchedAjax.__offlineMirrorPatched = true;
    $.ajax = patchedAjax;
  };

  const hydrateLazyMedia = () => {
    document.querySelectorAll('[data-src]').forEach((node) => {
      if (node instanceof HTMLImageElement || node instanceof HTMLSourceElement) {
        if (!node.getAttribute('src')) {
          node.setAttribute('src', node.getAttribute('data-src') || '');
        }
      }
    });

    document.querySelectorAll('[data-background-src]').forEach((node) => {
      const value = node.getAttribute('data-background-src');
      if (value && !node.style.backgroundImage) {
        node.style.backgroundImage = 'url(\"' + value + '\")';
      }
    });
  };

  const disableForms = () => {
    document.querySelectorAll('form').forEach((form) => {
      if (form.getAttribute('data-offline-disabled') === 'true') {
        form.addEventListener('submit', (event) => event.preventDefault());
      }
    });
  };

  const setupTabs = () => {
    const tabGroups = new Map();

    document.querySelectorAll('[data-role="tab"], [role="tab"]').forEach((tab, index) => {
      const href = tab.getAttribute('href') || tab.dataset.tabHref || '';
      if (!href.startsWith('#')) {
        return;
      }
      const target = document.querySelector(href);
      if (!target) {
        return;
      }
      const groupKey = tab.closest('[data-role="tabBar"], .ipsTabs, [role="tablist"]') || tab.parentElement || document.body;
      if (!tabGroups.has(groupKey)) {
        tabGroups.set(groupKey, []);
      }
      tab.dataset.offlineTabIndex = String(index);
      target.setAttribute('data-offline-tab-panel', 'true');
      tabGroups.get(groupKey).push({ tab, target });
    });

    tabGroups.forEach((entries) => {
      const activate = (entry) => {
        entries.forEach(({ tab, target }) => {
          const active = tab === entry.tab;
          tab.classList.toggle('ipsTabs_activeItem', active);
          tab.classList.toggle('ipsTab_active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
          if (active) {
            target.removeAttribute('hidden');
          } else {
            target.setAttribute('hidden', 'hidden');
          }
        });
      };

      entries.forEach((entry, entryIndex) => {
        entry.tab.addEventListener('click', (event) => {
          event.preventDefault();
          activate(entry);
        });
        if (entryIndex !== 0) {
          entry.target.setAttribute('hidden', 'hidden');
        } else {
          activate(entry);
        }
      });
    });
  };

  hardenIpsSettings();
  disableHistory();
  disableNetwork();
  installCompiledScriptShim();

  const boot = () => {
    document.body?.setAttribute(OFFLINE_ATTR, 'true');
    hardenIpsSettings();
    installCompiledScriptShim();
    hydrateLazyMedia();
    disableForms();
    setupTabs();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

const OFFLINE_MANIFEST_CONTENT = JSON.stringify(
  {
    name: 'SIKH SANGAT',
    short_name: 'SikhSangat',
    display: 'standalone',
    start_url: './index.html',
    theme_color: '#ffffff',
    background_color: '#ffffff',
  },
  null,
  2,
);

const OFFLINE_BROWSERCONFIG_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <TileColor>#ffffff</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`;

export function isTargetHost(hostname = '') {
  return TARGET_HOSTS.has(hostname.replace(/^www\./, 'www.')) || TARGET_HOSTS.has(hostname);
}

export function sanitizePathSegment(value = '') {
  return value
    .trim()
    .replace(/%/g, '-')
    .replace(/[<>:"|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120) || 'index';
}

function decodeSafe(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeUrlReference(value = '') {
  return /^(https?:)?\/\//i.test(value) ||
    value.startsWith('/') ||
    value.startsWith('?') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('index.php') ||
    value.includes('sikhsangat.com');
}

function isAlreadyLocalizedReference(value = '') {
  if (!/^(?:\.\.\/|\.\/)/.test(value)) {
    return false;
  }

  if (value.startsWith('../_offline/') || value.startsWith('./_offline/')) {
    return true;
  }

  if (value.includes('index.php') || value.startsWith('?')) {
    return false;
  }

  const cleanValue = value.split('?')[0].split('#')[0];
  const extension = path.extname(cleanValue).toLowerCase();
  if (cleanValue.endsWith('/index.html') || cleanValue === './' || cleanValue === '../') {
    return true;
  }

  return ASSET_EXTENSIONS.has(extension);
}

function stripLocalPrefix(value = '') {
  return value.replace(/^(?:\.\.\/|\.\/)+/, '');
}

function normalizePathArtifacts(value = '') {
  return String(value)
    .replace(/\/\(([^/]+)\/\)(\.[^"'?#<>\s)]+)/g, '($1)$2')
    .replace(/(^|\/)upload:(av-\d+\.(?:jpg|jpeg|png|gif|webp))/gi, '$1$2');
}

function fixMalformedLocalizedReference(value = '') {
  return String(value)
    .replace(/upload:(av-\d+\.(?:jpg|jpeg|png|gif|webp))/gi, '$1')
    .replace(/\.xml\/(?=$|[?#])/i, '.xml')
    .replace(/:\/{3,}/g, '://');
}

function canonicalizeLocalizedReference(value, currentUrl, { isCss = false, fromFilePath } = {}) {
  if (!isAlreadyLocalizedReference(value)) {
    return value;
  }

  const repairedValue = fixMalformedLocalizedReference(value);
  const stripped = stripLocalPrefix(repairedValue);
  const fromFile = fromFilePath || getLocalPath(currentUrl, { isAsset: false });

  if (/^(?:www|files)\.sikhsangat\.com\//.test(stripped)) {
    return getRelativeFsPath(fromFile, path.join(OUTPUT_DIR, stripped));
  }

  if (stripped.startsWith('_offline/')) {
    return getRelativeFsPath(fromFile, path.join(OUTPUT_DIR, stripped));
  }

  if (isCss && /^applications\//.test(stripped)) {
    return repairedValue;
  }

  return repairedValue;
}

export function normalizeRemoteUrl(rawValue, baseUrl = `https://${PRIMARY_HOST}/`) {
  if (!rawValue) {
    return null;
  }

  const value = normalizePathArtifacts(String(rawValue).trim()).replace(/&amp;/gi, '&');
  if (!value || !looksLikeUrlReference(value) || isAlreadyLocalizedReference(value)) {
    return null;
  }

  if (
    value.startsWith('#') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:')
  ) {
    return null;
  }

  const candidate = value.startsWith('//') ? `https:${value}` : value;

  try {
    const url = new URL(candidate, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }
    if (url.hostname === 'sikhsangat.com') {
      url.hostname = PRIMARY_HOST;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function splitRouteAndParams(url) {
  let pathname = url.pathname || '/';
  let params = new URLSearchParams(url.search);

  if (pathname === '/index.php' && url.search.startsWith('?/')) {
    const routed = url.search.slice(2);
    const ampIndex = routed.indexOf('&');
    const routePart = ampIndex === -1 ? routed : routed.slice(0, ampIndex);
    pathname = `/${routePart.replace(/^\/+/, '')}`;
    params = new URLSearchParams(ampIndex === -1 ? '' : routed.slice(ampIndex + 1));
  }

  pathname = decodeSafe(pathname).replace(/\/+/g, '/');
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  return { pathname, params };
}

function isAssetLikeUrl(url) {
  const { pathname } = splitRouteAndParams(url);
  const ext = path.extname(pathname).toLowerCase();
  if (ASSET_EXTENSIONS.has(ext)) {
    return true;
  }
  if (url.hostname === 'files.sikhsangat.com') {
    return true;
  }
  return pathname.includes('/applications/') || pathname.includes('/set_resources_');
}

function buildPageQuerySegments(params) {
  const entries = [];
  for (const [key, value] of params.entries()) {
    if (!key || EPHEMERAL_QUERY_KEYS.has(key) || value === '') {
      continue;
    }
    entries.push([key, value]);
  }

  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const leftOrder = PAGE_QUERY_ORDER.indexOf(leftKey);
    const rightOrder = PAGE_QUERY_ORDER.indexOf(rightKey);
    if (leftOrder !== rightOrder) {
      return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder) - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
    }
    return `${leftKey}:${leftValue}`.localeCompare(`${rightKey}:${rightValue}`);
  });

  const segments = [];
  for (const [key, value] of entries) {
    if (key === 'page') {
      segments.push('page', sanitizePathSegment(value));
      continue;
    }
    if (key === 'tab') {
      segments.push('tab', sanitizePathSegment(value));
      continue;
    }
    segments.push(`__${sanitizePathSegment(key)}`, sanitizePathSegment(value));
  }
  return segments;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function getRelativeFsPath(fromFilePath, toFilePath) {
  let relative = path.posix.relative(path.posix.dirname(toPosixPath(fromFilePath)), toPosixPath(toFilePath));
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

export function getLocalPath(urlStr, { isAsset = false } = {}) {
  const normalized = normalizeRemoteUrl(urlStr, `https://${PRIMARY_HOST}/`);
  if (!normalized) {
    return path.join(OUTPUT_DIR, 'invalid', 'index.html');
  }

  const url = new URL(normalized);
  const { pathname, params } = splitRouteAndParams(url);
  const ext = path.extname(pathname).toLowerCase();
  const hostDir = path.join(OUTPUT_DIR, url.hostname);

  if (isAsset || isAssetLikeUrl(url)) {
    let assetPath = pathname === '/' ? '/index.html' : pathname;
    if (!path.extname(assetPath)) {
      assetPath = assetPath.replace(/\/+$/, '');
      assetPath = `${assetPath}/index.html`;
    }
    return path.join(hostDir, assetPath);
  }

  const routeParts = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part));
  const queryParts = buildPageQuerySegments(params);

  return path.join(hostDir, ...routeParts, ...queryParts, 'index.html');
}

export function getRelativePath(fromUrlStr, toUrlStr, { isAsset = false } = {}) {
  const fromFile = getLocalPath(fromUrlStr, { isAsset: false });
  const toFile = getLocalPath(toUrlStr, { isAsset });
  return getRelativeFsPath(fromFile, toFile);
}

function rewriteCssValue(rawCssUrl, currentUrl, currentFilePath, assetUrls) {
  if (isAlreadyLocalizedReference(rawCssUrl)) {
    const canonical = canonicalizeLocalizedReference(rawCssUrl, currentUrl, {
      isCss: true,
      fromFilePath: currentFilePath,
    });
    if (/fontawesome-webfont\.woff2/i.test(canonical)) {
      return canonical;
    }
    return canonical;
  }
  const normalized = normalizeRemoteUrl(rawCssUrl, currentUrl);
  if (!normalized) {
    return rawCssUrl;
  }
  const url = new URL(normalized);
  if (!isTargetHost(url.hostname)) {
    return '';
  }
  assetUrls.add(normalized);
  return getRelativeFsPath(currentFilePath, getLocalPath(normalized, { isAsset: true }));
}

export function rewriteCssContent(cssContent, cssUrl) {
  const assetUrls = new Set();
  const localCssPath = getLocalPath(cssUrl, { isAsset: true });

  const rewriteUrlToken = (fullMatch, rawValue) => {
    const cleanValue = rawValue.trim().replace(/^['"]|['"]$/g, '');
    const rewritten = rewriteCssValue(cleanValue, cssUrl, localCssPath, assetUrls);
    if (rewritten === cleanValue) {
      return fullMatch;
    }
    if (!rewritten) {
      return 'url("")';
    }
    return `url("${rewritten}")`;
  };

  let rewritten = cssContent.replace(/url\(([^)]+)\)/gi, rewriteUrlToken);
  rewritten = rewritten.replace(/@import\s+['"]([^'"]+)['"]/gi, (fullMatch, rawValue) => {
    const rewrittenImport = rewriteCssValue(rawValue, cssUrl, localCssPath, assetUrls);
    if (!rewrittenImport) {
      return '';
    }
    return `@import "${rewrittenImport}"`;
  });

  const fontAwesomePath = path.join(
    OUTPUT_DIR,
    'www.sikhsangat.com',
    'applications',
    'core',
    'interface',
    'font',
    'fontawesome-webfont.woff2',
  );
  if (fs.existsSync(fontAwesomePath)) {
    const fontData = fs.readFileSync(fontAwesomePath).toString('base64');
    rewritten = rewritten.replace(
      /src:\s*url\("[^"]*fontawesome-webfont\.woff2[^"]*"\)\s*format\("woff2"\)\s*,\s*url\("[^"]*fontawesome-webfont\.woff[^"]*"\)\s*format\("woff"\)\s*,\s*url\("[^"]*fontawesome-webfont\.ttf[^"]*"\)\s*format\("truetype"\)\s*;/gi,
      `src: url("data:font/woff2;base64,${fontData}") format("woff2");`,
    );
  }

  return { content: rewritten, assetUrls: Array.from(assetUrls) };
}

export function rewriteJavascriptMapContent(scriptContent, scriptUrl) {
  const normalizedScriptUrl = normalizeRemoteUrl(scriptUrl, `https://${PRIMARY_HOST}/`);
  if (!normalizedScriptUrl) {
    return scriptContent;
  }

  const { pathname } = new URL(normalizedScriptUrl);
  if (!pathname.endsWith('/javascript_global/root_map.js')) {
    return scriptContent;
  }

  const currentFilePath = getLocalPath(normalizedScriptUrl, { isAsset: true });

  return scriptContent.replace(/"https:\/\/files\.sikhsangat\.com\/([^"\n]+)"/g, (fullMatch, remotePath) => {
    const normalizedTarget = normalizeRemoteUrl(`https://files.sikhsangat.com/${remotePath}`, normalizedScriptUrl);
    if (!normalizedTarget) {
      return fullMatch;
    }

    const targetFilePath = getLocalPath(normalizedTarget, { isAsset: true });
    const relative = getRelativeFsPath(currentFilePath, targetFilePath);
    return `new URL(${JSON.stringify(relative)}, (document.currentScript && document.currentScript.src) || location.href).toString()`;
  });
}

function rewriteSrcset(value, currentUrl, assetUrls) {
  return value
    .split(',')
    .map((entry) => {
      const [rawCandidateUrl, descriptor] = entry.trim().split(/\s+/, 2);
      const candidateUrl = normalizePathArtifacts(rawCandidateUrl);
      if (isAlreadyLocalizedReference(candidateUrl)) {
        const canonical = canonicalizeLocalizedReference(candidateUrl, currentUrl);
        return descriptor ? `${canonical} ${descriptor}` : canonical;
      }
      const normalized = normalizeRemoteUrl(candidateUrl, currentUrl);
      if (!normalized) {
        return entry.trim();
      }
      const url = new URL(normalized);
      if (!isTargetHost(url.hostname)) {
        return descriptor ? `# ${descriptor}` : '#';
      }
      assetUrls.add(normalized);
      const rewrittenUrl = getRelativePath(currentUrl, normalized, { isAsset: true });
      return descriptor ? `${rewrittenUrl} ${descriptor}` : rewrittenUrl;
    })
    .join(', ');
}

function rewriteInlineStyle(styleValue, currentUrl, assetUrls) {
  return styleValue.replace(/url\(([^)]+)\)/gi, (fullMatch, rawValue) => {
    const cleanValue = normalizePathArtifacts(rawValue.trim().replace(/^['"]|['"]$/g, ''));
    if (isAlreadyLocalizedReference(cleanValue)) {
      const canonical = canonicalizeLocalizedReference(cleanValue, currentUrl);
      return canonical ? `url("${canonical}")` : 'url("")';
    }
    const normalized = normalizeRemoteUrl(cleanValue, currentUrl);
    if (!normalized) {
      return fullMatch;
    }
    const url = new URL(normalized);
    if (!isTargetHost(url.hostname)) {
      return 'url("")';
    }
    assetUrls.add(normalized);
    return `url("${getRelativePath(currentUrl, normalized, { isAsset: true })}")`;
  });
}

function replaceInlineTargetUrls(text, currentUrl, assetUrls) {
  if (!text || (!text.includes('sikhsangat.com') && !text.includes('fonts.googleapis.com'))) {
    return text;
  }

  return text.replace(/((?:https?:)?\/\/(?:www\.)?sikhsangat\.com[^\s'"<>)]+|(?:https?:)?\/\/files\.sikhsangat\.com[^\s'"<>)]+)/gi, (match) => {
    const normalized = normalizeRemoteUrl(match, currentUrl);
    if (!normalized) {
      return match;
    }
    const asset = isAssetLikeUrl(new URL(normalized));
    assetUrls.add(normalized);
    return getRelativePath(currentUrl, normalized, { isAsset: asset });
  });
}

function rewriteAttributeValue(name, value, currentUrl, assetUrls) {
  const normalizedValue = normalizePathArtifacts(value);

  if (name === 'srcset') {
    return rewriteSrcset(normalizedValue, currentUrl, assetUrls);
  }

  if (name === 'style') {
    return rewriteInlineStyle(normalizedValue, currentUrl, assetUrls);
  }

  if (name === 'action') {
    return '#';
  }

  if (name === 'content' && !looksLikeUrlReference(normalizedValue)) {
    return normalizedValue;
  }

  if (name === 'value' && !looksLikeUrlReference(normalizedValue)) {
    return normalizedValue;
  }

  if (name === 'content' && normalizedValue.includes('fonts.googleapis.com')) {
    return normalizedValue.replace(/https:\/\/fonts\.googleapis\.com[^\s'"<>]*/gi, '');
  }

  if (isAlreadyLocalizedReference(normalizedValue)) {
    return canonicalizeLocalizedReference(normalizedValue, currentUrl);
  }

  const normalized = normalizeRemoteUrl(normalizedValue, currentUrl);
  if (!normalized) {
    return normalizedValue;
  }

  const url = new URL(normalized);
  if (!isTargetHost(url.hostname)) {
    return name === 'href' ? '#' : '';
  }

  const isAsset = isAssetLikeUrl(url) || ['src', 'poster', 'data-src', 'data-background-src', 'content'].includes(name);
  assetUrls.add(normalized);
  return getRelativePath(currentUrl, normalized, { isAsset });
}

export function collectDomTargets($, currentUrl) {
  const pageUrls = new Set();
  const assetUrls = new Set();

  $('[href], [src], [data-src], [data-background-src], [srcset], [style]').each((_, element) => {
    const attribs = element.attribs || {};
    for (const [name, value] of Object.entries(attribs)) {
      if (!URLISH_ATTRS.includes(name) && name !== 'style') {
        continue;
      }
      const normalized = normalizeRemoteUrl(value, currentUrl);
      if (!normalized) {
        continue;
      }
      const url = new URL(normalized);
      if (!isTargetHost(url.hostname)) {
        continue;
      }
      if (isAssetLikeUrl(url) || name === 'src' || name === 'data-src' || name === 'data-background-src' || name === 'srcset' || name === 'style') {
        assetUrls.add(normalized);
      } else {
        pageUrls.add(normalized);
      }
    }
  });

  return { pageUrls: Array.from(pageUrls), assetUrls: Array.from(assetUrls) };
}

function injectOfflineAssets($, currentUrl) {
  const cssHref = getRelativeFsPath(getLocalPath(currentUrl), OFFLINE_STYLE_FILE);
  const scriptSrc = getRelativeFsPath(getLocalPath(currentUrl), OFFLINE_SCRIPT_FILE);
  const manifestHref = getRelativeFsPath(getLocalPath(currentUrl), OFFLINE_MANIFEST_FILE);
  const browserConfigHref = getRelativeFsPath(getLocalPath(currentUrl), OFFLINE_BROWSERCONFIG_FILE);
  const startUrl = getRelativePath(currentUrl, `https://${PRIMARY_HOST}/`);

  if ($(`link[data-offline-asset="${OFFLINE_STYLE_NAME}"]`).length === 0) {
    $('head').append(`<link rel="stylesheet" href="${cssHref}" data-offline-asset="${OFFLINE_STYLE_NAME}">`);
  } else {
    $(`link[data-offline-asset="${OFFLINE_STYLE_NAME}"]`).attr('href', cssHref);
  }
  if ($(`script[data-offline-asset="${OFFLINE_SCRIPT_NAME}"]`).length === 0) {
    $('body').append(`<script defer src="${scriptSrc}" data-offline-asset="${OFFLINE_SCRIPT_NAME}"></script>`);
  } else {
    $(`script[data-offline-asset="${OFFLINE_SCRIPT_NAME}"]`).attr('src', scriptSrc);
  }

  $('link[rel="manifest"]').remove();
  $('head').append(`<link rel="manifest" href="${manifestHref}" data-offline-asset="${OFFLINE_MANIFEST_NAME}">`);

  if ($('meta[name="msapplication-config"]').length === 0) {
    $('head').append(`<meta name="msapplication-config" content="${browserConfigHref}">`);
  } else {
    $('meta[name="msapplication-config"]').attr('content', browserConfigHref);
  }

  if ($('meta[name="msapplication-starturl"]').length === 0) {
    $('head').append(`<meta name="msapplication-starturl" content="${startUrl}">`);
  } else {
    $('meta[name="msapplication-starturl"]').attr('content', startUrl);
  }

  $('link[rel="canonical"]').attr('href', './index.html');
}

export function rewriteHtmlContent(html, currentUrl) {
  const assetUrls = new Set();
  const discoveredPageUrls = new Set();
  const $ = cheerio.load(html, { decodeEntities: false });

  $('html').attr('data-offline-mirror', 'true');
  $('body').attr('data-offline-mirror', 'true');

  $('link[href*="fonts.googleapis.com"]').remove();
  $('link[rel="preload"][as="font"]').remove();
  $('meta[http-equiv="refresh"]').each((_, element) => {
    const content = $(element).attr('content') || '';
    const replaced = replaceInlineTargetUrls(content, currentUrl, assetUrls);
    $(element).attr('content', replaced);
  });

  $('meta[content]').each((_, element) => {
    const content = $(element).attr('content') || '';
    const metaKey = `${$(element).attr('name') || ''} ${$(element).attr('property') || ''}`;
    const isUrlishMeta = /\b(?:url|config|starturl)\b/i.test(metaKey);
    if (/^(?:\.\.\/|\.\/)+/.test(content) && !isUrlishMeta) {
      $(element).attr('content', content.replace(/^(?:\.\.\/|\.\/)+/, '').replace(/\/index\.html$/, ''));
    }
  });

  $('form').each((_, element) => {
    $(element)
      .attr('action', '#')
      .attr('data-offline-disabled', 'true')
      .removeAttr('data-controller')
      .removeAttr('data-ipsform');
    $(element).find('input[type="submit"], button[type="submit"]').attr('disabled', 'disabled');
  });

  $('[data-action="dismissTerms"], #elGuestTerms, #elRegisterForm, #elGuestSignIn').attr('data-offline-disabled', 'true');

  $('[data-ipscaptcha]').each((_, element) => {
    $(element)
      .attr('data-offline-disabled', 'true')
      .removeAttr('data-ipscaptcha')
      .removeAttr('data-ipscaptcha-service')
      .removeAttr('data-ipscaptcha-key')
      .removeAttr('data-ipscaptcha-lang')
      .removeAttr('data-ipscaptcha-theme');
    $(element).find('iframe, [data-captchacontainer], .g-recaptcha-response').remove();
  });

  $('iframe[src*="google.com/recaptcha"], iframe[src*="google-analytics.com"]').remove();

  $('[style]').each((_, element) => {
    const styleValue = $(element).attr('style');
    if (styleValue) {
      $(element).attr('style', rewriteInlineStyle(styleValue, currentUrl, assetUrls));
    }
  });

  $('*').each((_, element) => {
    const attribs = element.attribs || {};
    for (const [name, value] of Object.entries(attribs)) {
      if (CLICKLESS_ATTRS.includes(name)) {
        $(element).removeAttr(name);
        continue;
      }

      if (!URLISH_ATTRS.includes(name)) {
        continue;
      }

      const rewrittenValue = rewriteAttributeValue(name, value, currentUrl, assetUrls);
      if (name === 'href' && rewrittenValue !== '#') {
        const normalized = normalizeRemoteUrl(value, currentUrl);
        if (normalized && isTargetHost(new URL(normalized).hostname) && !isAssetLikeUrl(new URL(normalized))) {
          discoveredPageUrls.add(normalized);
        }
      }
      if (rewrittenValue === '') {
        $(element).removeAttr(name);
      } else {
        $(element).attr(name, rewrittenValue);
      }
    }
  });

  $('script').each((_, element) => {
    if ($(element).attr('src')) {
      return;
    }
    const scriptContent = $(element).html();
    if (!scriptContent) {
      return;
    }
    if (/google-analytics\.com\/ga\.js|_gaq\.push|googletagmanager/i.test(scriptContent)) {
      $(element).remove();
      return;
    }
    $(element).html(replaceInlineTargetUrls(scriptContent, currentUrl, assetUrls));
  });

  $('meta[content], script[type="application/ld+json"]').each((_, element) => {
    const content = $(element).html() || $(element).attr('content');
    if (!content) {
      return;
    }
    const replaced = replaceInlineTargetUrls(content, currentUrl, assetUrls);
    if ($(element).is('meta')) {
      $(element).attr('content', replaced);
    } else {
      $(element).html(replaced);
    }
  });

  const bodyScriptSources = new Set(
    $('body script[src]')
      .map((_, element) => $(element).attr('src'))
      .get()
      .filter(Boolean),
  );

  const relocatedHeadScripts = [];
  $('head script[src]').each((_, element) => {
    const src = $(element).attr('src');
    const strippedSrc = stripLocalPrefix(src || '');
    const shouldRelocate =
      !!src &&
      (
        /^files\.sikhsangat\.com\/javascript_/i.test(strippedSrc) ||
        (/^applications\//i.test(strippedSrc) && !/html5shiv/i.test(strippedSrc))
      );

    if (src && bodyScriptSources.has(src)) {
      $(element).remove();
      return;
    }

    if (shouldRelocate) {
      relocatedHeadScripts.push($.html(element));
      $(element).remove();
    }
  });

  relocatedHeadScripts.forEach((scriptHtml) => $('body').append(scriptHtml));

  injectOfflineAssets($, currentUrl);

  const finalHtml = replaceInlineTargetUrls($.html(), currentUrl, assetUrls)
    .replace(/index\.html\/index\.html/g, 'index.html')
    .replace(/<iframe\b[^>]*google\.com\/recaptcha[^>]*>\s*<\/iframe>/gi, '')
    .replace(/<textarea\b[^>]*class="[^"]*g-recaptcha-response[^"]*"[\s\S]*?<\/textarea>/gi, '');

  return {
    html: finalHtml,
    assetUrls: Array.from(assetUrls),
    discoveredPageUrls: Array.from(discoveredPageUrls),
  };
}

export async function ensureOfflineSupportFiles() {
  await fs.ensureDir(OFFLINE_DIR);
  await fs.outputFile(OFFLINE_STYLE_FILE, OFFLINE_STYLE_CONTENT);
  await fs.outputFile(OFFLINE_SCRIPT_FILE, OFFLINE_SCRIPT_CONTENT);
  await fs.outputFile(OFFLINE_MANIFEST_FILE, OFFLINE_MANIFEST_CONTENT);
  await fs.outputFile(OFFLINE_BROWSERCONFIG_FILE, OFFLINE_BROWSERCONFIG_CONTENT);
}

export async function repairExistingHtmlFile(filePath) {
  const currentUrl = filePathToMirrorUrl(filePath);
  if (!currentUrl) {
    return false;
  }
  const html = await fs.readFile(filePath, 'utf8');
  const rewritten = rewriteHtmlContent(html, currentUrl);
  await fs.writeFile(filePath, rewritten.html);
  return true;
}

export async function repairExistingCssFile(filePath) {
  const currentUrl = filePathToMirrorUrl(filePath, { isAsset: true });
  if (!currentUrl) {
    return false;
  }
  const css = await fs.readFile(filePath, 'utf8');
  const rewritten = rewriteCssContent(css, currentUrl);
  await fs.writeFile(filePath, rewritten.content);
  return true;
}

export async function repairExistingRootMapFile(filePath) {
  const currentUrl = filePathToMirrorUrl(filePath, { isAsset: true });
  if (!currentUrl) {
    return false;
  }

  const javascript = await fs.readFile(filePath, 'utf8');
  const rewritten = rewriteJavascriptMapContent(javascript, currentUrl);
  await fs.writeFile(filePath, rewritten);
  return true;
}

export function filePathToMirrorUrl(filePath, { isAsset = false } = {}) {
  const relative = path.relative(OUTPUT_DIR, filePath);
  if (!relative || relative.startsWith('..')) {
    return null;
  }

  const posixRelative = toPosixPath(relative);
  const [hostname, ...restParts] = posixRelative.split('/');
  if (!hostname || hostname === '_offline') {
    return null;
  }

  if (isAsset) {
    const assetPath = `/${restParts.join('/')}`;
    return `https://${hostname}${assetPath}`;
  }

  let pagePath = `/${restParts.join('/')}`;
  if (pagePath.endsWith('/index.html')) {
    pagePath = pagePath.slice(0, -'/index.html'.length) || '/';
  }
  return `https://${hostname}${pagePath}`;
}
