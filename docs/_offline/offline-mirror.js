(() => {
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
    const shouldBlock = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
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
        node.style.backgroundImage = 'url("' + value + '")';
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
