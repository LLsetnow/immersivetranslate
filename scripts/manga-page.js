// 在漫画网页原页面按 10 张窗口提交图片，并逐张接收、替换翻译结果。
(function () {
  'use strict';

  if (window.top !== window.self || !document.documentElement) return;

  const IMAGE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
  const MANGA_BATCH_WINDOW_SIZE = 10;
  const EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR = '.scramble-page:not(.thewayhome) > img';
  const EIGHTEEN_COMIC_IMAGE_ATTRIBUTES = ['data-original', 'data-src', 'data-lazy-src', 'src'];
  const state = {
    running: false,
    paused: false,
    entries: [],
    translated: 0,
    failed: 0,
    taskId: '',
    cacheRestored: false,
    cacheAvailable: false,
    showingOriginal: false,
    processingStartedAt: 0,
    processingPausedAt: 0,
    processingPausedMs: 0,
    averageTimer: null,
  };

  function decodeBase64Url(value) {
    try {
      return atob(value.replace(/\s/g, '')).trim();
    } catch {
      return '';
    }
  }

  function normaliseUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return '';
    }
  }

  function normaliseSourceUrl(value) {
    try {
      const url = new URL(value || location.href);
      url.hash = '';
      return url.href;
    } catch {
      return String(value || '').trim();
    }
  }

  function is18ComicHostname(hostname) {
    const normalisedHostname = String(hostname || '').toLowerCase();
    return normalisedHostname === '18comic.vip' || normalisedHostname.endsWith('.18comic.vip');
  }

  function is18ComicHost() {
    const hostname = String(location.hostname || '').toLowerCase();
    return is18ComicHostname(hostname);
  }

  function is18ComicPhotoPage() {
    return is18ComicHost() && /^\/photo(?:\/|$)/i.test(location.pathname || '');
  }

  function is18ComicBodyImageUrl(value) {
    try {
      const url = new URL(value);
      return is18ComicHostname(url.hostname)
        && /^\/media\/photos\/\d+\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function is18ComicBlankImageUrl(value) {
    try {
      const url = new URL(value);
      return is18ComicHostname(url.hostname)
        && /^\/media\/albums\/blank(?:\.[^/]+)?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function extract18ComicPhotoId(value) {
    try {
      const url = new URL(value, document.baseURI);
      return url.pathname.match(/^\/photo\/(\d+)\/?$/i)?.[1] || '';
    } catch {
      return '';
    }
  }

  function is18ComicPageName(value) {
    const name = String(value || '').trim();
    return /^[^/\\?#]+\.(?:avif|bmp|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(name);
  }

  function extract18ComicPageArray(htmlText) {
    const match = String(htmlText || '').match(
      /\b(?:var|let|const)\s+page_arr\s*=\s*(\[[\s\S]*?\])\s*;/i,
    );
    if (!match) return [];

    let values = [];
    try {
      const parsed = JSON.parse(match[1]);
      values = Array.isArray(parsed) ? parsed : [];
    } catch {
      // The reference project expects JSON here, but tolerate single-quoted
      // arrays found in older page snapshots without executing page script.
      values = Array.from(match[1].matchAll(/["']([^"']+)["']/g))
        .map(item => item[1]);
    }
    return values
      .map(value => String(value || '').trim())
      .filter(is18ComicPageName);
  }

  function get18ComicImageAttributeValues(root = document) {
    return Array.from(root.querySelectorAll('img'))
      .flatMap(image => EIGHTEEN_COMIC_IMAGE_ATTRIBUTES
        .map(attribute => image.getAttribute(attribute))
        .filter(Boolean));
  }

  function get18ComicSourceImageValues(root = document, htmlText = '') {
    const values = get18ComicImageAttributeValues(root);
    if (htmlText) {
      const rawValues = Array.from(String(htmlText).matchAll(
        /(?:data-original|data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi,
      )).map(match => match[1]);
      values.push(...rawValues);
    }
    return values
      .map(value => normaliseUrl(value))
      .filter(isHttpUrl);
  }

  function get18ComicImageSourceInfo(root = document, htmlText = '') {
    const values = get18ComicSourceImageValues(root, htmlText);
    const blankUrl = values.find(is18ComicBlankImageUrl);
    const bodyUrls = values.filter(is18ComicBodyImageUrl);
    const domainUrl = blankUrl || bodyUrls[0] || '';
    let origin = '';
    let query = '';
    try {
      const parsedDomainUrl = new URL(domainUrl);
      origin = parsedDomainUrl.origin;
    } catch {
      // Leave origin empty; the caller will fall back to DOM body URLs.
    }
    for (const value of bodyUrls) {
      try {
        const parsed = new URL(value);
        if (parsed.search) {
          query = parsed.search;
          break;
        }
      } catch {
        // Ignore malformed candidates.
      }
    }
    return { origin, query, bodyUrls };
  }

  function build18ComicImageUrls(pageId, pageNames, sourceInfo) {
    if (!/^\d+$/.test(String(pageId || '')) || !sourceInfo?.origin) return [];
    const seen = new Set();
    return pageNames.map(pageName => {
      const [pathname, pageQuery = ''] = String(pageName).split('?', 2);
      try {
        const url = new URL(
          `/media/photos/${pageId}/${pathname}`,
          `${sourceInfo.origin}/`,
        );
        url.search = pageQuery ? `?${pageQuery}` : sourceInfo.query || '';
        return url.href;
      } catch {
        return '';
      }
    }).filter(url => {
      if (!url || !is18ComicBodyImageUrl(url) || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }

  function get18ComicBodyImageElements() {
    return Array.from(document.querySelectorAll(EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR));
  }

  function get18ComicImageRecords() {
    const seen = new Set();
    return get18ComicBodyImageElements()
      .map(element => {
        const url = EIGHTEEN_COMIC_IMAGE_ATTRIBUTES
          .map(attribute => normaliseUrl(element.getAttribute(attribute)))
          .find(is18ComicBodyImageUrl);
        return url ? { element, url } : null;
      })
      .filter(record => {
        if (!record || seen.has(record.url)) return false;
        seen.add(record.url);
        return true;
      });
  }

  function get18ComicImageData(htmlText = document.documentElement.outerHTML) {
    const elements = get18ComicBodyImageElements();
    const records = get18ComicImageRecords();
    const pageNames = extract18ComicPageArray(htmlText);
    const pageId = extract18ComicPhotoId(location.href);
    const sourceInfo = get18ComicImageSourceInfo(document, htmlText);
    const generatedUrls = build18ComicImageUrls(pageId, pageNames, sourceInfo);
    return {
      urls: generatedUrls.length ? generatedUrls : records.map(record => record.url),
      elements,
      records,
      pageNames,
      pageId,
      generated: generatedUrls.length > 0,
    };
  }

  async function waitFor18ComicImageData(timeout = 20000) {
    const deadline = Date.now() + timeout;
    let lastSignature = '';
    let stableChecks = 0;
    let best = { urls: [], elements: [], records: [], pageNames: [], pageId: '', generated: false };
    while (Date.now() < deadline) {
      const data = get18ComicImageData(document.documentElement.outerHTML);
      if (data.urls.length > 0) {
        best = data;
        const signature = data.urls.join('\n');
        if (signature === lastSignature) {
          stableChecks += 1;
        } else {
          lastSignature = signature;
          stableChecks = 0;
        }
        // Give the site's lazy-loader a short window to append the remaining
        // chapter pages before taking the snapshot used by the task.
        if (stableChecks >= 10) return data;
      }
      await sleep(100);
    }
    return best.urls.length ? best : get18ComicImageData(document.documentElement.outerHTML);
  }

  function createTaskId(sourceUrl, imageUrls) {
    // Keep the task stable when a site rotates CDN query tokens between visits.
    const seed = normaliseSourceUrl(sourceUrl) || `local-page\n${imageUrls.join('\n')}`;
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < seed.length; index += 1) {
      const code = seed.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 3266489917);
    }
    return `manga-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function isImageUrl(value) {
    return /^https?:\/\//i.test(value) && IMAGE_PATTERN.test(value);
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  function extractSlideUrls(htmlText) {
    const match = htmlText.match(/slides_p_path\s*=\s*\[((?:.|\n)*?)\]\s*;/i);
    if (!match) return [];
    return Array.from(match[1].matchAll(/['"]([A-Za-z0-9+/=_-]+)['"]/g))
      .map(item => decodeBase64Url(item[1]))
      .map(normaliseUrl)
      .filter(isHttpUrl);
  }

  function extractImageUrls(htmlText) {
    const slideUrls = extractSlideUrls(htmlText);
    const values = slideUrls.length ? slideUrls : Array.from(document.images)
      .flatMap(image => ['src', 'data-src', 'data-original', 'data-lazy-src']
        .map(attribute => image.getAttribute(attribute))
        .filter(Boolean));
    const urls = [];
    const seen = new Set();
    values.forEach(value => {
      const url = normaliseUrl(value);
      const validImage = slideUrls.length ? isHttpUrl(url) : isImageUrl(url);
      if (validImage && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
    return urls;
  }

  function normaliseImageCacheKey(value) {
    if (!value) return '';
    try {
      const url = new URL(value, document.baseURI);
      if (is18ComicBodyImageUrl(url.href)) return url.pathname;
      return `${url.origin.toLowerCase()}${url.pathname}`;
    } catch {
      return String(value || '').trim();
    }
  }

  function createUniqueEntryName(url, index, usedNames) {
    const rawName = url.split('/').pop()?.split('?')[0] || `page-${index + 1}.png`;
    let name = rawName;
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : '';
      name = `${stem}-page-${index + 1}${extension}`;
    }
    while (usedNames.has(name)) {
      name = `page-${index + 1}-${name}`;
    }
    usedNames.add(name);
    return name;
  }

  function imageAttributeUrls(image) {
    return ['src', 'data-src', 'data-original', 'data-lazy-src']
      .map(attribute => normaliseUrl(image.getAttribute(attribute)))
      .filter(isHttpUrl);
  }

  function getLiveImageElements() {
    return is18ComicPhotoPage()
      ? Array.from(document.querySelectorAll(EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR))
      : Array.from(document.images);
  }

  function findImageElement(url, candidates, used) {
    const cacheKey = normaliseImageCacheKey(url);
    const exact = candidates.find(image => !used.has(image)
      && imageAttributeUrls(image).some(candidate => (
        candidate === url
        || (is18ComicBodyImageUrl(url)
          && normaliseImageCacheKey(candidate) === cacheKey)
      )));
    return exact || null;
  }

  function find18ComicPageElement(elements, pageIndex, expectedCount) {
    const byPageAttribute = elements.find(element => (
      Number(element.getAttribute('data-page')) === pageIndex
    ));
    if (byPageAttribute) return byPageAttribute;
    return elements.length === expectedCount ? elements[pageIndex] || null : null;
  }

  function resolveLiveImageElement(entry) {
    const liveImages = getLiveImageElements();
    const cacheKey = normaliseImageCacheKey(entry.url);
    const exact = liveImages.find(image => imageAttributeUrls(image).some(candidate => (
      candidate === entry.url
      || (is18ComicBodyImageUrl(entry.url)
        && normaliseImageCacheKey(candidate) === cacheKey)
    )));
    if (exact) return exact;
    if (is18ComicPhotoPage()) {
      const pageIndex = state.entries.indexOf(entry);
      const pageElement = find18ComicPageElement(
        liveImages,
        pageIndex,
        state.entries.length,
      );
      if (pageElement) return pageElement;
    }
    if (entry.element?.isConnected && (
      imageAttributeUrls(entry.element).includes(entry.url)
      || (is18ComicPhotoPage() && entry.element.matches?.(EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR))
    )) {
      return entry.element;
    }
    // 章节图片可能在脚本初始化后才插入 DOM。这里不能按页面图片顺序
    // 兜底，否则会把缓存结果写到广告、头像或站点 logo 上。
    return null;
  }

  async function waitForLiveImageElement(entry, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const element = resolveLiveImageElement(entry);
      if (element) return element;
      await sleep(100);
    }
    return resolveLiveImageElement(entry);
  }

  async function waitForAllLiveImageElements(entries, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const matched = entries.reduce((count, entry) => (
        resolveLiveImageElement(entry) ? count + 1 : count
      ), 0);
      if (matched >= entries.length) return true;
      await sleep(100);
    }
    return entries.every(entry => Boolean(resolveLiveImageElement(entry)));
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  function makeResultBlob(data, mimeType = 'image/png') {
    if (typeof data === 'string') {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }
    if (data instanceof ArrayBuffer) {
      return new Blob([data], { type: mimeType });
    }
    if (ArrayBuffer.isView(data)) {
      return new Blob([data.buffer], { type: mimeType });
    }
    throw new Error('翻译后端返回的数据格式不受支持');
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function initialiseMangaPage() {
    const special18ComicPage = is18ComicPhotoPage();
    const pageHtml = document.documentElement.outerHTML;
    const specialImageData = special18ComicPage
      ? await waitFor18ComicImageData()
      : null;
    const specialImageRecords = specialImageData?.records || [];
    const imageUrls = special18ComicPage
      ? specialImageData?.urls || []
      : extractImageUrls(pageHtml);
    const hasChapterSlides = /slides_p_path\s*=\s*\[/i.test(pageHtml);
    // 18comic pages must never fall back to the site's global image list:
    // page_arr is the chapter order, while the shell also contains ads,
    // navigation and other ordinary <img> elements.
    if (!imageUrls.length || (!special18ComicPage && !hasChapterSlides && imageUrls.length < 3)) return;
    if (document.getElementById('immersive-translate-manga-entry')) return;

    const imageCandidates = special18ComicPage
      ? specialImageData?.elements || specialImageRecords.map(record => record.element)
      : Array.from(document.images).filter(image => imageAttributeUrls(image).length > 0);
    const usedImages = new Set();
    const usedNames = new Set();
    state.entries = imageUrls.map((url, index) => {
      const element = findImageElement(url, imageCandidates, usedImages)
        || (special18ComicPage && specialImageData?.generated
          ? find18ComicPageElement(imageCandidates, index, imageUrls.length)
          : null);
      if (element) usedImages.add(element);
      return {
        url,
        element,
        name: createUniqueEntryName(url, index, usedNames),
        resultUrl: '',
        cached: false,
        completed: false,
        failed: false,
      };
    });
    const sourceUrl = normaliseSourceUrl(location.href);
    state.taskId = createTaskId(sourceUrl, imageUrls);

    function markEntrySucceeded(entry, { cached = false } = {}) {
      const wasFailed = entry.failed === true;
      const wasCompleted = entry.completed === true;
      entry.completed = true;
      entry.failed = false;
      entry.cached = cached;
      // Every streamed success is persisted by the shared backend before it
      // reaches this handler, so a later interruption can use the same cache
      // and continue with only the incomplete pages.
      state.cacheAvailable = true;
      if (!wasCompleted) state.translated += 1;
      if (wasFailed) state.failed = Math.max(0, state.failed - 1);
      updateAverageTime();
      setStatus(`已完成 ${state.translated} / ${state.entries.length}：${entry.name}`, 'success');
    }

    function markEntryFailed(entry, error) {
      entry.completed = false;
      if (!entry.failed) state.failed += 1;
      entry.failed = true;
      updateAverageTime();
      if (entry.element?.isConnected) {
        entry.element.style.outline = '2px solid rgba(255, 100, 100, .75)';
      }
      const index = state.entries.indexOf(entry);
      setStatus(`第 ${index + 1} 页失败：${error?.message || error}`, 'error');
    }

    async function runMangaBatchAttempt(entries) {
      return new Promise((resolve, reject) => {
        let port = null;
        let started = false;
        let finalising = false;
        let keepAliveTimer = null;
        const settledIndexes = new Set();
        const pendingHandlers = [];
        const entriesByIndex = new Map(entries.map(entry => [
          state.entries.indexOf(entry),
          entry,
        ]));

        const cleanup = () => {
          if (keepAliveTimer !== null) {
            window.clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
          if (!port) return;
          try {
            port.onMessage.removeListener(handleMessage);
            port.onDisconnect.removeListener(handleDisconnect);
            port.disconnect();
          } catch {
            // The port may already have been reaped by Firefox/Zen.
          }
          port = null;
        };

        const finish = async (error = null) => {
          if (finalising) return;
          finalising = true;
          await Promise.all(pendingHandlers);
          if (!error) {
            entries.forEach(entry => {
              const index = state.entries.indexOf(entry);
              if (!settledIndexes.has(index) && entry.completed !== true) {
                settledIndexes.add(index);
                markEntryFailed(entry, new Error('批量处理未返回结果图片'));
              }
            });
          }
          cleanup();
          if (error) {
            error.beforeStart = !started;
            reject(error);
          } else {
            resolve();
          }
        };

        const queueResultHandler = (entry, handler) => {
          const pending = Promise.resolve()
            .then(handler)
            .catch(error => markEntryFailed(entry, error));
          pendingHandlers.push(pending);
        };

        function handleMessage(message) {
          if (!message || finalising) return;
          started = true;
          if (message.action === 'mangaBatchStarted') {
            setStatus(`已提交 ${entries.length} 张图片，等待逐张返回结果…`);
            return;
          }

          const pageIndex = Number(message.pageIndex);
          const entry = entriesByIndex.get(pageIndex);
          if (message.action === 'mangaBatchImage' && entry && !settledIndexes.has(pageIndex)) {
            settledIndexes.add(pageIndex);
            queueResultHandler(entry, async () => {
              await replaceImage(entry, message);
              markEntrySucceeded(entry);
            });
            return;
          }

          if (message.action === 'mangaBatchImageSkipped' && entry && !settledIndexes.has(pageIndex)) {
            settledIndexes.add(pageIndex);
            queueResultHandler(entry, async () => {
              const cached = await sendMessage({
                action: 'getMangaCachedImage',
                taskId: state.taskId,
                pageIndex,
                sourceUrl,
              });
              if (!cached.success) throw new Error(cached.error || '读取批量缓存图片失败');
              await replaceImage(entry, cached);
              markEntrySucceeded(entry, { cached: true });
            });
            return;
          }

          if (message.action === 'mangaBatchImageError' && entry && !settledIndexes.has(pageIndex)) {
            settledIndexes.add(pageIndex);
            markEntryFailed(entry, new Error(message.error || '批量翻译失败'));
            return;
          }

          if (message.action === 'mangaBatchDone') {
            void finish();
            return;
          }

          if (message.action === 'mangaBatchFailed') {
            void finish(new Error(message.error || '批量翻译失败'));
          }
        }

        function handleDisconnect() {
          if (!finalising) {
            void finish(new Error('批量翻译回传通道已断开'));
          }
        }

        try {
          port = chrome.runtime.connect({ name: 'manga-batch' });
          port.onMessage.addListener(handleMessage);
          port.onDisconnect.addListener(handleDisconnect);
          port.postMessage({
            action: 'translateMangaBatchInPage',
            entries: entries.map(entry => ({
              url: entry.url,
              filename: entry.name,
              pageIndex: state.entries.indexOf(entry),
            })),
            sourceUrl,
            taskId: state.taskId,
            batchSize: MANGA_BATCH_WINDOW_SIZE,
          });
          // Firefox/Zen can reap an otherwise quiet event page while the
          // local model is processing a batch. Keep the connected channel
          // active until the final result/done event arrives.
          keepAliveTimer = window.setInterval(() => {
            if (!port || finalising) return;
            try {
              port.postMessage({ action: 'mangaBatchKeepAlive' });
            } catch (error) {
              void finish(error instanceof Error ? error : new Error(String(error)));
            }
          }, 5000);
        } catch (error) {
          error.beforeStart = true;
          void finish(error);
        }
      });
    }

    async function translateMangaBatchThroughBackground(entries) {
      let pendingEntries = entries.filter(entry => entry && entry.completed !== true);
      let lastError = null;
      // A Port can disappear after a batch has already produced some images.
      // Reconcile the disk manifest first, then retry only pages still missing
      // from the page. The backend also skips pages already present in cache.
      for (let attempt = 0; attempt < 3 && pendingEntries.length; attempt += 1) {
        try {
          await runMangaBatchAttempt(pendingEntries);
          return;
        } catch (error) {
          lastError = error;
          if (attempt >= 2) throw error;
          setStatus(
            `批量回传通道中断，正在继承已完成缓存并重试剩余 ${pendingEntries.length} 页…`,
            'info',
          );
          await sleep(400 + attempt * 600);
          try {
            const recovered = await restoreCachedEntries(pendingEntries);
            pendingEntries = recovered.pendingEntries;
          } catch (recoveryError) {
            console.warn('[漫画翻译] 批量断线后的缓存恢复失败，将直接重试:', recoveryError);
          }
        }
      }
      if (!pendingEntries.length) return;
      throw lastError || new Error('批量翻译失败');
    }

  const host = document.createElement('div');
  host.id = 'immersive-translate-manga-entry';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        position: fixed; left: 0; top: 0; z-index: 1;
        width: 36px; height: 36px;
        color: #f8fbff;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }
      .launcher {
        display: grid; place-items: center;
        width: 36px; height: 36px; padding: 0;
        border: 1px solid rgba(255,255,255,.3); border-radius: 50%;
        color: #10182b; background: #8aa8ff;
        opacity: .5;
        box-shadow: 0 7px 18px rgba(6, 12, 26, .32), 0 0 0 4px rgba(138, 168, 255, .14);
        cursor: pointer; pointer-events: auto;
        font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transition: background .18s ease, box-shadow .18s ease, opacity .18s ease;
      }
      .launcher:hover { background: #b7c8ff; box-shadow: 0 9px 22px rgba(6, 12, 26, .38), 0 0 0 5px rgba(138, 168, 255, .2); }
      .launcher:focus-visible { outline: 3px solid rgba(183, 200, 255, .85); outline-offset: 4px; }
      .launcher[data-running="true"] { background: #72d6b0; box-shadow: 0 8px 22px rgba(6, 12, 26, .32), 0 0 0 5px rgba(114, 214, 176, .16); }
      .launcher-glyph { transform: translateY(-.5px); }
      .panel[data-dock="left"] .card { left: 0; right: auto; }
      .panel[data-placement="above"] .card { bottom: 56px; top: auto; }
      .panel[data-placement="below"] .card { bottom: auto; top: 56px; }
      .card {
        position: absolute;
        right: 0;
        width: min(310px, calc(100vw - 32px));
        max-height: min(360px, calc(100vh - 32px));
        overflow: auto;
        padding: 13px 14px;
        border: 1px solid rgba(255,255,255,.22); border-radius: 15px;
        color: #f8fbff; background: rgba(24, 30, 47, .96);
        box-shadow: 0 16px 42px rgba(0,0,0,.32);
        backdrop-filter: blur(14px);
        pointer-events: auto;
      }
      .card[hidden] { display: none; }
      .card[aria-busy="true"] { cursor: progress; }
      .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .title { min-width: 0; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .count { flex: 0 0 auto; color: #aab8d8; font-size: 12px; white-space: nowrap; }
      .status { min-height: 18px; max-height: 38px; margin: 10px 0 12px; overflow: auto; color: #b7c4df; font-size: 12px; }
      .status[data-kind="success"] { color: #72d6b0; }
      .status[data-kind="error"] { color: #ff9d9d; }
      .metrics { min-height: 16px; margin: -4px 0 10px; color: #aab8d8; font-size: 11px; }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .actions .retry, .actions .continue, .actions .view-toggle { grid-column: 1 / -1; }
      button {
        min-height: 34px; border: 1px solid rgba(255,255,255,.18); border-radius: 9px;
        padding: 7px 10px; color: #f8fbff; background: rgba(255,255,255,.08);
        cursor: pointer; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transition: transform .18s ease, background .18s ease, border-color .18s ease;
      }
      button:hover:not(:disabled) { transform: translateY(-1px); background: rgba(138,168,255,.2); border-color: rgba(138,168,255,.55); }
      button.primary { border-color: transparent; color: #0f1524; background: #8aa8ff; }
      button.primary:hover:not(:disabled) { background: #b3c2ff; }
      button:disabled { cursor: not-allowed; opacity: .48; }
      .collapse {
        flex: 0 0 auto; width: 25px; min-height: 25px; padding: 0;
        border: 0; color: #aab8d8; background: transparent; font-size: 19px; line-height: 1;
      }
      .collapse:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,.09); }
      @media (max-width: 420px) {
        .card { width: min(290px, calc(100vw - 24px)); }
      }
    </style>
    <section class="panel" data-dock="right" data-placement="above" aria-label="图片翻译">
      <button class="launcher" data-action="toggle" type="button" aria-expanded="false" aria-label="展开图片翻译" title="展开图片翻译">
        <span class="launcher-glyph" aria-hidden="true">图</span>
      </button>
      <div class="card" hidden>
        <div class="card-head">
          <span class="title">图片翻译</span>
          <span class="count">${state.entries.length} 页</span>
          <button class="collapse" data-action="close" type="button" aria-label="收起图片翻译" title="收起">×</button>
        </div>
        <div class="status" data-kind="info">点击开始翻译当前章节图片</div>
        <div class="metrics" data-role="metrics"><span data-role="average-time">平均每张图：--</span></div>
        <div class="actions">
          <button class="primary" data-action="start" type="button">翻译本章</button>
          <button data-action="pause" type="button" disabled>暂停</button>
          <button class="retry" data-action="retry" type="button" hidden>重试失败页</button>
          <button class="continue" data-action="continue" type="button" hidden>继承缓存并继续</button>
          <button class="view-toggle" data-action="toggle-view" type="button" hidden>显示原图</button>
        </div>
      </div>
    </section>
  `;
  document.documentElement.appendChild(host);

  const panel = shadow.querySelector('.panel');
  const launcher = shadow.querySelector('.launcher');
  const card = shadow.querySelector('.card');
  const collapseButton = shadow.querySelector('[data-action="close"]');
  const startButton = shadow.querySelector('[data-action="start"]');
  const pauseButton = shadow.querySelector('[data-action="pause"]');
  const retryButton = shadow.querySelector('[data-action="retry"]');
  const continueButton = shadow.querySelector('[data-action="continue"]');
  const viewToggleButton = shadow.querySelector('[data-action="toggle-view"]');
  const statusNode = shadow.querySelector('.status');
  const averageTimeNode = shadow.querySelector('[data-role="average-time"]');

  const VIEWPORT_PADDING = 18;
  const LAUNCHER_SIZE = 36;
  const TEXT_TRIGGER_GAP = 8;
  let repositionFrame = null;

  function getVisibleRect(element) {
    if (!element || element.hidden) return null;
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }

  function getProtectedTranslationRects() {
    const rects = [];
    const textHost = document.getElementById('__immersive_translation_selection_ui__');
    const textShadow = textHost?.shadowRoot;
    const triggerShell = textShadow?.querySelector('.trigger-shell');
    const selectionTextButton = getVisibleRect(triggerShell);
    if (selectionTextButton) rects.push(selectionTextButton);

    return rects;
  }

  function rectanglesOverlap(first, second, gap = 0) {
    return first.left < second.right + gap
      && first.right + gap > second.left
      && first.top < second.bottom + gap
      && first.bottom + gap > second.top;
  }

  function isInsideViewport(rect) {
    return rect.left >= VIEWPORT_PADDING
      && rect.top >= VIEWPORT_PADDING
      && rect.right <= window.innerWidth - VIEWPORT_PADDING
      && rect.bottom <= window.innerHeight - VIEWPORT_PADDING;
  }

  function setPanelPosition(candidate) {
    panel.dataset.dock = candidate.dock;
    panel.dataset.placement = candidate.placement;
    panel.style.left = `${Math.round(candidate.left)}px`;
    panel.style.top = `${Math.round(candidate.top)}px`;
  }

  function getPanelCandidates() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = VIEWPORT_PADDING;
    const right = Math.max(left, viewportWidth - VIEWPORT_PADDING - LAUNCHER_SIZE);
    const candidates = [];

    const bottom = Math.max(left, viewportHeight - VIEWPORT_PADDING - LAUNCHER_SIZE - 24);
    candidates.push(
      { dock: 'right', placement: 'above', left: right, top: bottom },
      { dock: 'right', placement: 'below', left: right, top: left },
      { dock: 'left', placement: 'above', left, top: bottom },
      { dock: 'left', placement: 'below', left, top: left },
    );
    return candidates;
  }

  function positionPanel(expanded = !card.hidden) {
    const protectedRects = getProtectedTranslationRects();
    const candidates = getPanelCandidates();
    const cardWidth = expanded ? card.offsetWidth : 0;
    const cardHeight = expanded ? card.offsetHeight : 0;
    let fallback = candidates[0];

    for (const candidate of candidates) {
      const launcherRect = {
        left: candidate.left,
        top: candidate.top,
        right: candidate.left + LAUNCHER_SIZE,
        bottom: candidate.top + LAUNCHER_SIZE,
      };
      const cardRect = expanded ? {
        left: candidate.dock === 'left'
          ? candidate.left
          : candidate.left + LAUNCHER_SIZE - cardWidth,
        top: candidate.placement === 'above'
          ? candidate.top + LAUNCHER_SIZE - 56 - cardHeight
          : candidate.top + 56,
        right: 0,
        bottom: 0,
      } : null;
      if (cardRect) {
        cardRect.right = cardRect.left + cardWidth;
        cardRect.bottom = cardRect.top + cardHeight;
      }
      const avoidsText = protectedRects.every(protectedRect => (
        !rectanglesOverlap(launcherRect, protectedRect, TEXT_TRIGGER_GAP)
          && (!cardRect || !rectanglesOverlap(cardRect, protectedRect, TEXT_TRIGGER_GAP))
      ));
      const fits = isInsideViewport(launcherRect)
        && (!cardRect || isInsideViewport(cardRect));
      if (avoidsText && fits) {
        setPanelPosition(candidate);
        return;
      }
      if (avoidsText && fallback === candidates[0]) fallback = candidate;
    }
    setPanelPosition(fallback);
  }

  function schedulePanelPosition() {
    if (repositionFrame !== null) return;
    const run = () => {
      repositionFrame = null;
      positionPanel();
    };
    repositionFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 0);
  }

  function setExpanded(expanded) {
    card.hidden = !expanded;
    launcher.setAttribute('aria-expanded', String(expanded));
    launcher.setAttribute('aria-label', expanded ? '收起图片翻译' : '展开图片翻译');
    launcher.title = expanded ? '收起图片翻译' : '展开图片翻译';
    positionPanel(expanded);
    if (expanded) startButton.focus();
  }

  function setStatus(message, kind = 'info') {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind;
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--';
    if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))} 毫秒`;
    const seconds = milliseconds / 1000;
    if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return `${minutes} 分 ${remainder} 秒`;
  }

  function processingElapsed() {
    if (!state.processingStartedAt) return 0;
    const now = performance.now();
    const pausedNow = state.processingPausedAt ? now - state.processingPausedAt : 0;
    return Math.max(0, now - state.processingStartedAt - state.processingPausedMs - pausedNow);
  }

  function updateAverageTime() {
    const completed = state.translated + state.failed;
    if (!state.processingStartedAt || completed <= 0) {
      averageTimeNode.textContent = '平均每张图：--';
      return;
    }
    averageTimeNode.textContent = `平均每张图：${formatDuration(processingElapsed() / completed)}（已处理 ${completed} 张）`;
  }

  function resetProcessingClock() {
    if (state.averageTimer !== null) {
      window.clearInterval(state.averageTimer);
      state.averageTimer = null;
    }
    state.processingStartedAt = 0;
    state.processingPausedAt = 0;
    state.processingPausedMs = 0;
    updateAverageTime();
  }

  function startProcessingClock() {
    resetProcessingClock();
    state.processingStartedAt = performance.now();
    state.averageTimer = window.setInterval(updateAverageTime, 1000);
    updateAverageTime();
  }

  function stopProcessingClock() {
    if (state.processingPausedAt) {
      state.processingPausedMs += performance.now() - state.processingPausedAt;
      state.processingPausedAt = 0;
    }
    if (state.averageTimer !== null) {
      window.clearInterval(state.averageTimer);
      state.averageTimer = null;
    }
    updateAverageTime();
  }

  function getIncompleteEntries() {
    return state.entries.filter(entry => entry.completed !== true);
  }

  function setRunningControls() {
    const incompleteCount = getIncompleteEntries().length;
    const canContinueCache = state.cacheAvailable && incompleteCount > 0;
    const hasTranslatedImages = state.entries.some(entry => Boolean(entry.resultUrl));
    startButton.disabled = state.running;
    pauseButton.disabled = !state.running;
    pauseButton.textContent = state.paused ? '继续' : '暂停';
    retryButton.hidden = state.running || state.failed <= 0;
    retryButton.disabled = state.running || state.failed <= 0;
    retryButton.textContent = state.failed > 0 ? `重试失败页（${state.failed}）` : '重试失败页';
    continueButton.hidden = state.running || !canContinueCache;
    continueButton.disabled = state.running || !canContinueCache;
    continueButton.textContent = canContinueCache
      ? `继承缓存并继续（${incompleteCount} 页）`
      : '继承缓存并继续';
    viewToggleButton.hidden = !hasTranslatedImages;
    viewToggleButton.disabled = state.running || !hasTranslatedImages;
    viewToggleButton.textContent = state.showingOriginal ? '显示翻译图' : '显示原图';
    launcher.dataset.running = String(state.running);
    startButton.textContent = state.running
      ? '处理中…'
      : (state.translated || state.failed ? '再次翻译本章' : '翻译本章');
  }

  function yieldToBrowserPaint() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  async function replaceImage(entry, response) {
    const blob = makeResultBlob(response.data, response.mimeType || 'image/png');
    const nextResultUrl = URL.createObjectURL(blob);
    const preview = new Image();
    try {
      await new Promise((resolve, reject) => {
        preview.onload = resolve;
        preview.onerror = () => reject(new Error('翻译结果图片无法加载'));
        preview.src = nextResultUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(nextResultUrl);
      throw error;
    }

    const liveElement = await waitForLiveImageElement(entry);
    if (!liveElement) {
      URL.revokeObjectURL(nextResultUrl);
      throw new Error('找不到当前页面中的原图元素');
    }
    entry.element = liveElement;

    const previousResultUrl = entry.resultUrl;
    entry.resultUrl = nextResultUrl;
    if (previousResultUrl) URL.revokeObjectURL(previousResultUrl);
    applyEntryImageSource(entry);
    await yieldToBrowserPaint();
  }

  function applyEntryImageSource(entry) {
    if (!entry?.element?.isConnected) return;
    const source = state.showingOriginal ? entry.url : entry.resultUrl;
    if (!source) return;
    entry.element.src = source;
    entry.element.removeAttribute('srcset');
    ['data-src', 'data-original', 'data-lazy-src'].forEach(attribute => {
      entry.element.removeAttribute(attribute);
    });
    if (state.showingOriginal) {
      delete entry.element.dataset.immersiveTranslated;
    } else {
      entry.element.dataset.immersiveTranslated = 'true';
    }
  }

  function setAllImageSources(showOriginal) {
    state.showingOriginal = showOriginal;
    state.entries.forEach(entry => applyEntryImageSource(entry));
    setRunningControls();
  }

  function toggleImageView() {
    if (state.running) return;
    const hasTranslatedImages = state.entries.some(entry => Boolean(entry.resultUrl));
    if (!hasTranslatedImages) return;
    setAllImageSources(!state.showingOriginal);
    setStatus(
      state.showingOriginal ? '已切换到原图' : '已切换到翻译图',
      'success',
    );
  }

  function getRestorableCachePages(pages, special18ComicPage) {
    const usedEntries = new Set();
    return pages.map(page => {
      const pageIndex = Number(page?.index);
      if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

      let entry = null;
      if (special18ComicPage) {
        const cacheKey = normaliseImageCacheKey(page?.imageUrl);
        if (!cacheKey) return null;
        entry = state.entries.find(candidate => (
          !usedEntries.has(candidate)
          && normaliseImageCacheKey(candidate.url) === cacheKey
        ));
      } else {
        entry = state.entries[pageIndex] || null;
      }
      if (!entry) return null;
      usedEntries.add(entry);
      return {
        entry,
        page,
        pageIndex,
        entryIndex: state.entries.indexOf(entry),
      };
    }).filter(Boolean);
  }

  async function restoreCachedEntries(entries, cachePayload = null) {
    const cache = cachePayload || await sendMessage({
      action: 'getMangaCache',
      taskId: state.taskId,
      sourceUrl,
      imageUrls,
    });
    if (!cache.success) throw new Error(cache.error || '读取翻译缓存失败');
    const pages = Array.isArray(cache.pages) ? cache.pages : [];
    const restorablePages = getRestorableCachePages(pages, special18ComicPage)
      .filter(item => entries.includes(item.entry) && item.entry.completed !== true);
    if (cache.found && pages.length) state.cacheAvailable = true;

    let restored = 0;
    for (const item of restorablePages.sort((left, right) => left.pageIndex - right.pageIndex)) {
      const { entry, entryIndex, pageIndex } = item;
      try {
        const cached = await sendMessage({
          action: 'getMangaCachedImage',
          taskId: state.taskId,
          pageIndex,
          sourceUrl,
        });
        if (!cached.success) throw new Error(cached.error || '读取缓存图片失败');
        await replaceImage(entry, cached);
        markEntrySucceeded(entry, { cached: true });
        restored += 1;
        setStatus(`已恢复缓存 ${state.translated} 页`, 'success');
      } catch (error) {
        markEntryFailed(entry, new Error(`缓存第 ${entryIndex + 1} 页恢复失败：${error.message}`));
      }
    }
    return {
      found: Boolean(cache.found && pages.length),
      restored,
      pendingEntries: entries.filter(entry => entry.completed !== true),
    };
  }

  async function restoreCachedResults() {
    try {
      const cache = await sendMessage({
        action: 'getMangaCache',
        taskId: state.taskId,
        sourceUrl,
        imageUrls,
      });
      if (!cache.success) throw new Error(cache.error || '读取翻译缓存失败');
      const pages = Array.isArray(cache.pages) ? cache.pages : [];
      const restorablePages = getRestorableCachePages(pages, special18ComicPage);
      if (!cache.found || !restorablePages.length) return;

      state.cacheAvailable = true;
      state.running = true;
      setRunningControls();
      setStatus(`发现上次翻译缓存，正在等待章节图片加载…`, 'success');
      await waitForAllLiveImageElements(state.entries);
      setStatus(`发现上次翻译缓存，正在恢复 ${restorablePages.length} 页…`, 'success');
      await restoreCachedEntries(restorablePages.map(item => item.entry), cache);
      state.cacheRestored = state.translated > 0;
      const incompleteCount = getIncompleteEntries().length;
      if (state.cacheAvailable) {
        setStatus(
          incompleteCount
            ? `已继承 ${state.translated} 页缓存，还有 ${incompleteCount} 页未完成；点击“继承缓存并继续”`
            : `已恢复上次翻译：${state.translated} / ${state.entries.length} 页`,
          'success',
        );
      }
    } catch (error) {
      // Cache lookup is optional. A stopped backend or an old cache should not
      // prevent the user from starting a new translation manually.
      console.warn('[漫画翻译] 缓存检查失败，将继续使用实时翻译:', error);
    } finally {
      state.running = false;
      setRunningControls();
    }
  }

  async function processEntries(entries) {
    for (let offset = 0; offset < entries.length; offset += MANGA_BATCH_WINDOW_SIZE) {
      while (state.paused && state.running) {
        await sleep(120);
      }
      if (!state.running) break;
      const batch = entries.slice(offset, offset + MANGA_BATCH_WINDOW_SIZE)
        .filter(entry => entry && entry.completed !== true);
      if (!batch.length) continue;
      const firstIndex = state.entries.indexOf(batch[0]);
      const lastIndex = state.entries.indexOf(batch[batch.length - 1]);
      setStatus(
        `正在提交第 ${firstIndex + 1}–${lastIndex + 1} 页（批输入窗口 ${batch.length}/${MANGA_BATCH_WINDOW_SIZE}）…`,
      );
      await translateMangaBatchThroughBackground(batch);
    }
  }

  async function translateCurrentPage() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    state.translated = 0;
    state.failed = 0;
    state.cacheRestored = false;
    state.cacheAvailable = false;
    setAllImageSources(false);
    state.entries.forEach(entry => {
      entry.cached = false;
      entry.completed = false;
      entry.failed = false;
    });
    resetProcessingClock();
    setRunningControls();
    setStatus('正在启动本地翻译后端…');

    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '本地后端启动失败');
      startProcessingClock();

      await processEntries(state.entries);

      if (state.running) {
        setStatus(`处理完成：${state.translated} / ${state.entries.length} 页成功${state.failed ? `，${state.failed} 页失败` : ''}`, state.failed ? 'error' : 'success');
      }
    } catch (error) {
      setStatus(error.message || '网页漫画翻译失败', 'error');
    } finally {
      stopProcessingClock();
      state.running = false;
      state.paused = false;
      setRunningControls();
    }
  }

  async function retryFailedPages() {
    if (state.running) return;
    const failedEntries = state.entries.filter(entry => entry.failed === true);
    if (!failedEntries.length) {
      setRunningControls();
      return;
    }

    state.running = true;
    state.paused = false;
    setAllImageSources(false);
    resetProcessingClock();
    setRunningControls();
    setStatus(`准备重试 ${failedEntries.length} 个失败页面…`);
    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '本地后端启动失败');
      startProcessingClock();
      await processEntries(failedEntries);
      if (state.running) {
        setStatus(
          state.failed
            ? `重试完成：仍有 ${state.failed} 页失败`
            : `重试完成：${state.translated} / ${state.entries.length} 页成功`,
          state.failed ? 'error' : 'success',
        );
      }
    } catch (error) {
      setStatus(error.message || '重试失败页面时发生错误', 'error');
    } finally {
      stopProcessingClock();
      state.running = false;
      state.paused = false;
      setRunningControls();
    }
  }

  async function continueIncompletePages() {
    if (state.running) return;
    const incompleteEntries = getIncompleteEntries();
    if (!state.cacheAvailable || !incompleteEntries.length) {
      setRunningControls();
      return;
    }

    state.running = true;
    state.paused = false;
    setAllImageSources(false);
    resetProcessingClock();
    setRunningControls();
    setStatus(`继承 ${state.translated} 页缓存，继续处理 ${incompleteEntries.length} 页…`);
    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '本地后端启动失败');
      startProcessingClock();
      await processEntries(incompleteEntries);
      if (state.running) {
        setStatus(
          state.failed
            ? `继续完成后仍有 ${state.failed} 页失败`
            : `已继承缓存并完成：${state.translated} / ${state.entries.length} 页`,
          state.failed ? 'error' : 'success',
        );
      }
    } catch (error) {
      setStatus(error.message || '继续处理未完成页面时发生错误', 'error');
    } finally {
      stopProcessingClock();
      state.running = false;
      state.paused = false;
      setRunningControls();
    }
  }

  launcher.addEventListener('click', () => setExpanded(card.hidden));
  collapseButton.addEventListener('click', () => setExpanded(false));
  startButton.addEventListener('click', translateCurrentPage);
  retryButton.addEventListener('click', retryFailedPages);
  continueButton.addEventListener('click', continueIncompletePages);
  viewToggleButton.addEventListener('click', toggleImageView);
  pauseButton.addEventListener('click', () => {
    if (!state.running) return;
    if (!state.paused) {
      state.processingPausedAt = performance.now();
    } else if (state.processingPausedAt) {
      state.processingPausedMs += performance.now() - state.processingPausedAt;
      state.processingPausedAt = 0;
    }
    state.paused = !state.paused;
    updateAverageTime();
    setRunningControls();
    setStatus(state.paused ? `已暂停：当前页面已完成 ${state.translated} 页` : '已继续处理当前页面', state.paused ? 'info' : 'success');
  });
  window.addEventListener('resize', schedulePanelPosition);
  window.addEventListener('immersive-translation-trigger-change', schedulePanelPosition);
  document.addEventListener('selectionchange', schedulePanelPosition, { passive: true });
  positionPanel(false);
  restoreCachedResults();
  }

  initialiseMangaPage().catch(error => {
    console.warn('[漫画翻译] 页面图片入口初始化失败:', error);
  });
})();
