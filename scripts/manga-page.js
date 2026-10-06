// 当前章节在原页面替换译图；manga18.club 的下一话可留在本页后台翻译并缓存。
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
    pluginBatchSize: MANGA_BATCH_WINDOW_SIZE,
    nextChapterRunning: false,
    cacheChecking: false,
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
    progressTasks: new Map(),
    activeProgressTaskId: '',
    progressExpanded: false,
    selectedProgressPage: null,
  };

  function applyPreparedPluginBatchSize(ready) {
    const value = Number(ready?.pluginBatchSize);
    state.pluginBatchSize = Number.isFinite(value)
      ? Math.max(1, Math.min(MANGA_BATCH_WINDOW_SIZE, Math.trunc(value)))
      : MANGA_BATCH_WINDOW_SIZE;
    return state.pluginBatchSize;
  }

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

  function isManga18Hostname(hostname) {
    const normalisedHostname = String(hostname || '').toLowerCase();
    return normalisedHostname === 'manga18.club' || normalisedHostname.endsWith('.manga18.club');
  }

  function getManga18ChapterInfo(value = location.href) {
    try {
      const url = new URL(value);
      if (!isManga18Hostname(url.hostname)) return null;
      const match = url.pathname.match(/^(\/manhwa\/[^/]+\/)(chapter-)?(\d+)(\/?)$/i);
      if (!match) return null;
      const chapterNumber = Number(match[3]);
      if (!Number.isSafeInteger(chapterNumber)) return null;
      return {
        url,
        chapterPrefix: `${match[1]}${match[2] || ''}`,
        chapterNumber,
        seriesPath: match[1].toLowerCase(),
        trailingSlash: match[4],
      };
    } catch {
      return null;
    }
  }

  function buildManga18NextChapterUrl(chapterInfo) {
    if (!chapterInfo || chapterInfo.chapterNumber >= Number.MAX_SAFE_INTEGER) return null;
    const nextUrl = new URL(chapterInfo.url.href);
    nextUrl.pathname = `${chapterInfo.chapterPrefix}${chapterInfo.chapterNumber + 1}${chapterInfo.trailingSlash}`;
    return nextUrl;
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

  function extractManga18ChapterImageUrls(htmlText, baseUrl) {
    const slidesMatch = String(htmlText || '').match(/slides_p_path\s*=\s*\[((?:.|\n)*?)\]\s*;/i);
    if (slidesMatch) {
      return Array.from(slidesMatch[1].matchAll(/[\"']([A-Za-z0-9+/=_-]+)[\"']/g))
        .map(item => decodeBase64Url(item[1]))
        .map(value => {
          try {
            return new URL(value, baseUrl).href;
          } catch {
            return '';
          }
        })
        .filter(isHttpUrl);
    }

    const parsedPage = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
    const seen = new Set();
    return Array.from(parsedPage.querySelectorAll('img'))
      .flatMap(image => ['src', 'data-src', 'data-original', 'data-lazy-src']
        .map(attribute => image.getAttribute(attribute))
        .filter(Boolean))
      .map(value => {
        try {
          return new URL(value, baseUrl).href;
        } catch {
          return '';
        }
      })
      .filter(url => {
        if (!isImageUrl(url) || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
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
    const manga18ChapterInfo = getManga18ChapterInfo();
    const pageHtml = document.documentElement.outerHTML;
    const specialImageData = special18ComicPage
      ? await waitFor18ComicImageData()
      : null;
    const specialImageRecords = specialImageData?.records || [];
    let imageUrls = special18ComicPage
      ? specialImageData?.urls || []
      : extractImageUrls(pageHtml);
    if (manga18ChapterInfo) {
      const deadline = Date.now() + 20000;
      let lastSignature = '';
      let stableChecks = 0;
      while (Date.now() < deadline) {
        const nextImageUrls = extractImageUrls(document.documentElement.outerHTML);
        imageUrls = nextImageUrls;
        if (nextImageUrls.length >= 3) {
          const signature = nextImageUrls.join('\n');
          stableChecks = signature === lastSignature ? stableChecks + 1 : 0;
          lastSignature = signature;
          if (stableChecks >= 20) break;
        } else {
          stableChecks = 0;
          lastSignature = '';
        }
        await sleep(100);
      }
    }
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
    const nextChapterUrl = buildManga18NextChapterUrl(manga18ChapterInfo);

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
      markProgressPageSucceeded(
        entry.progressTaskId || state.taskId,
        Number.isInteger(entry.progressPageIndex) ? entry.progressPageIndex : state.entries.indexOf(entry),
        cached,
      );
      updateAverageTime();
      setStatus(`已完成 ${state.translated} / ${state.entries.length}：${entry.name}`, 'success');
    }

    function markEntryFailed(entry, error) {
      entry.completed = false;
      if (!entry.failed) state.failed += 1;
      entry.failed = true;
      markProgressPageFailed(
        entry.progressTaskId || state.taskId,
        Number.isInteger(entry.progressPageIndex) ? entry.progressPageIndex : state.entries.indexOf(entry),
        error,
      );
      updateAverageTime();
      if (entry.element?.isConnected) {
        entry.element.style.outline = '2px solid rgba(255, 100, 100, .75)';
      }
      const index = state.entries.indexOf(entry);
      setStatus(`第 ${index + 1} 页失败：${error?.message || error}`, 'error');
    }

    async function runMangaBatchAttempt(entries, preserveSuccessfulRows = false) {
      return new Promise((resolve, reject) => {
        let port = null;
        let started = false;
        let finalising = false;
        let keepAliveTimer = null;
        const task = state.progressTasks.get(state.taskId);
        const runId = createRunId();
        const settledIndexes = new Set();
        const pendingHandlers = [];
        beginProgressBatch(task, entries, runId, preserveSuccessfulRows);
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
          if ((message.taskId && message.taskId !== state.taskId)
            || (message.runId && message.runId !== runId)) return;
          started = true;
          if (message.action === 'mangaBatchStarted') {
            if (message.taskId !== state.taskId || message.runId !== runId) return;
            setProgressBackend(task, message.backend, message.pageProgressVersion);
            setStatus(`已提交 ${entries.length} 张图片，等待逐张返回结果…`);
            return;
          }
          if (message.action === 'mangaBatchPageProgress') {
            applyPageProgressEvent(message);
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
            if (message.taskId !== state.taskId || message.runId !== runId) return;
            if (task) task.completedAt = performance.now();
            void finish();
            return;
          }

          if (message.action === 'mangaBatchFailed') {
            if (message.taskId !== state.taskId || message.runId !== runId) return;
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
            runId,
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

    async function translateMangaBatchThroughBackground(entries, { retry = false } = {}) {
      let pendingEntries = entries.filter(entry => entry && entry.completed !== true);
      let lastError = null;
      // A Port can disappear after a batch has already produced some images.
      // Reconcile the disk manifest first, then retry only pages still missing
      // from the page. The backend also skips pages already present in cache.
      for (let attempt = 0; attempt < 3 && pendingEntries.length; attempt += 1) {
        try {
          await runMangaBatchAttempt(pendingEntries, retry || attempt > 0);
          return;
        } catch (error) {
          lastError = error;
          if (attempt >= 2) {
            pendingEntries.filter(entry => entry.completed !== true).forEach(entry => markEntryFailed(entry, error));
            throw error;
          }
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
      pendingEntries.filter(entry => entry.completed !== true).forEach(entry => markEntryFailed(entry, lastError));
      throw lastError || new Error('批量翻译失败');
    }

    function runManga18DetachedBatch(entries, sourceUrl, taskId, chapterNumber, progress, preserveSuccessfulRows = false) {
      return new Promise((resolve, reject) => {
        let port = null;
        let finalising = false;
        let keepAliveTimer = null;
        const task = state.progressTasks.get(taskId);
        const runId = createRunId();
        const settledIndexes = new Set();
        const failedEntries = new Map();
        const entriesByIndex = new Map(entries.map(entry => [entry.pageIndex, entry]));
        beginProgressBatch(task, entries, runId, preserveSuccessfulRows);

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
            // The port may already have been closed by the browser.
          }
          port = null;
        };

        const updateProgress = () => {
          if (state.paused) return;
          const successful = Array.from(progress.outcomes.values())
            .filter(result => result === 'success').length;
          const failed = Array.from(progress.outcomes.values())
            .filter(result => result === 'failed').length;
          setStatus(
            `第 ${chapterNumber} 话：已缓存 ${successful} / ${progress.total} 张${failed ? `，${failed} 张待重试` : ''}`,
            failed ? 'info' : 'success',
          );
        };

        const settleEntry = (entry, success, error = '', cached = false) => {
          if (settledIndexes.has(entry.pageIndex)) return;
          settledIndexes.add(entry.pageIndex);
          if (success) {
            progress.outcomes.set(entry.pageIndex, 'success');
            failedEntries.delete(entry.pageIndex);
            markProgressPageSucceeded(taskId, entry.pageIndex, cached);
          } else {
            progress.outcomes.set(entry.pageIndex, 'failed');
            failedEntries.set(entry.pageIndex, entry);
            markProgressPageFailed(taskId, entry.pageIndex, error || '批量翻译失败');
            if (error) console.warn(`[漫画翻译] 下一话第 ${entry.pageIndex + 1} 张失败:`, error);
          }
          updateProgress();
        };

        const finish = error => {
          if (finalising) return;
          finalising = true;
          if (!error) {
            entries.forEach(entry => {
              if (!settledIndexes.has(entry.pageIndex)) {
                settleEntry(entry, false, '批量处理未返回结果图片');
              }
            });
          }
          cleanup();
          if (error) reject(error);
          else resolve(Array.from(failedEntries.values()));
        };

        function handleMessage(message) {
          if (!message || finalising) return;
          if ((message.taskId && message.taskId !== taskId)
            || (message.runId && message.runId !== runId)) return;
          if (message.action === 'mangaBatchStarted') {
            setProgressBackend(task, message.backend, message.pageProgressVersion);
            if (!state.paused) setStatus(`第 ${chapterNumber} 话：已提交 ${entries.length} 张，正在翻译…`);
            return;
          }
          if (message.action === 'mangaBatchPageProgress') {
            applyPageProgressEvent(message);
            return;
          }

          if (message.action === 'mangaBatchDone') {
            if (task) task.completedAt = performance.now();
            finish(null);
            return;
          }
          if (message.action === 'mangaBatchFailed') {
            finish(new Error(message.error || '下一话批量翻译失败'));
            return;
          }

          const pageIndex = Number(message.pageIndex);
          const entry = entriesByIndex.get(pageIndex);
          if (!entry) return;
          if (message.action === 'mangaBatchImage' || message.action === 'mangaBatchImageSkipped') {
            settleEntry(entry, true, '', message.action === 'mangaBatchImageSkipped');
            return;
          }
          if (message.action === 'mangaBatchImageError') {
            settleEntry(entry, false, message.error || '批量翻译失败');
          }
        }

        function handleDisconnect() {
          if (!finalising) finish(new Error('下一话翻译回传通道已断开'));
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
              pageIndex: entry.pageIndex,
            })),
            sourceUrl,
            taskId,
            runId,
          });
          keepAliveTimer = window.setInterval(() => {
            if (!port || finalising) return;
            try {
              port.postMessage({ action: 'mangaBatchKeepAlive' });
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          }, 5000);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }

    async function translateManga18NextChapterInBackground() {
      if (!manga18ChapterInfo || !nextChapterUrl || state.running) return;
      const nextChapterNumber = manga18ChapterInfo.chapterNumber + 1;
      state.running = true;
      state.paused = false;
      state.nextChapterRunning = true;
      setRunningControls();
      countNode.textContent = `第 ${nextChapterNumber} 话`;
      setStatus(`正在读取第 ${nextChapterNumber} 话图片；当前页面会保持不变…`);

      try {
        const response = await fetch(nextChapterUrl.href, {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
        });
        if (!response.ok) throw new Error(`读取下一话页面失败（HTTP ${response.status}）`);

        const resolvedUrl = response.url || nextChapterUrl.href;
        const resolvedChapter = getManga18ChapterInfo(resolvedUrl);
        if (!resolvedChapter
          || resolvedChapter.seriesPath !== manga18ChapterInfo.seriesPath
          || resolvedChapter.chapterNumber !== nextChapterNumber) {
          throw new Error('网站没有返回预期的下一话页面');
        }

        const htmlText = await response.text();
        const imageUrls = extractManga18ChapterImageUrls(htmlText, resolvedUrl);
        if (imageUrls.length < 3) {
          throw new Error(`下一话页面只找到 ${imageUrls.length} 张图片，无法确认章节图片列表`);
        }

        const sourceUrl = normaliseSourceUrl(resolvedUrl);
        const taskId = createTaskId(sourceUrl, imageUrls);
        const usedNames = new Set();
        const entries = imageUrls.map((url, index) => ({
          url,
          name: createUniqueEntryName(url, index, usedNames),
          pageIndex: index,
        }));
        const nextTask = createProgressTask(
          taskId,
          `下一话 第 ${nextChapterNumber} 话`,
          entries,
        );
        setActiveProgressTask(taskId);
        const progress = { total: entries.length, outcomes: new Map() };
        countNode.textContent = `第 ${nextChapterNumber} 话 · ${entries.length} 页`;
        setStatus(`第 ${nextChapterNumber} 话读取到 ${entries.length} 张图片，正在准备翻译…`);

        const ready = await sendMessage({ action: 'prepareMangaTranslation' });
        if (!ready.success) throw new Error(ready.error || '翻译后端启动失败');
        const pluginBatchSize = applyPreparedPluginBatchSize(ready);
        setProgressBackend(nextTask, ready.backend, ready.pageProgressVersion);
        startProcessingClock();

        let lastBatchError = '';
        for (let offset = 0; offset < entries.length; offset += pluginBatchSize) {
          while (state.paused && state.running) await sleep(120);
          const batch = entries.slice(offset, offset + pluginBatchSize);
          let pendingEntries = batch;

          for (let attempt = 0; attempt < 3 && pendingEntries.length; attempt += 1) {
            while (state.paused && state.running) await sleep(120);
            if (attempt > 0) {
              pendingEntries.forEach(entry => progress.outcomes.set(entry.pageIndex, 'pending'));
              setStatus(`第 ${nextChapterNumber} 话：正在重试 ${pendingEntries.length} 张失败图片（${attempt + 1}/3）…`);
              await sleep(350 * attempt);
            }
            try {
              pendingEntries = await runManga18DetachedBatch(
                pendingEntries,
                sourceUrl,
                taskId,
                nextChapterNumber,
                progress,
                attempt > 0,
              );
            } catch (error) {
              lastBatchError = error.message || String(error);
              pendingEntries = pendingEntries.filter(entry => (
                progress.outcomes.get(entry.pageIndex) !== 'success'
              ));
            }
          }

          pendingEntries.forEach(entry => progress.outcomes.set(entry.pageIndex, 'failed'));
          pendingEntries.forEach(entry => markProgressPageFailed(taskId, entry.pageIndex, lastBatchError || '批量处理失败'));
        }

        const successful = Array.from(progress.outcomes.values())
          .filter(result => result === 'success').length;
        const failed = entries.length - successful;
        if (failed) {
          setStatus(
            `第 ${nextChapterNumber} 话：${successful}/${entries.length} 张已缓存，${failed} 张失败${lastBatchError ? `（${lastBatchError}）` : ''}`,
            'error',
          );
        } else {
          setStatus(`第 ${nextChapterNumber} 话的 ${successful} 张图片已翻译并缓存；当前页面保持不变。`, 'success');
        }
      } catch (error) {
        setStatus(`翻译下一话失败：${error.message || error}`, 'error');
      } finally {
        stopProcessingClock();
        state.running = false;
        state.paused = false;
        state.nextChapterRunning = false;
        setRunningControls();
        syncSavedBackendBadge();
      }
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
        cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; pointer-events: auto;
        font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transition: background .18s ease, box-shadow .18s ease, opacity .18s ease;
      }
      .launcher[data-dragging="true"] { cursor: grabbing; opacity: .9; }
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
        display: flex; flex-direction: column; gap: 0;
        width: min(310px, calc(100vw - 32px));
        max-height: min(560px, calc(100vh - 32px));
        overflow: hidden;
        padding: 13px 14px;
        border: 1px solid rgba(255,255,255,.22); border-radius: 15px;
        color: #f8fbff; background: rgba(24, 30, 47, .96);
        box-shadow: 0 16px 42px rgba(0,0,0,.32);
        backdrop-filter: blur(14px);
        pointer-events: auto;
      }
      .card[data-details-expanded="true"] { width: min(360px, calc(100vw - 24px)); }
      .card[hidden] { display: none; }
      .card[aria-busy="true"] { cursor: progress; }
      .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 0 0 auto; }
      .title-cluster { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
      .title { min-width: 0; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      .backend { flex: 0 0 auto; color: #aab8d8; font-size: 11px; white-space: nowrap; }
      .count { flex: 0 0 auto; color: #aab8d8; font-size: 12px; white-space: nowrap; }
      .status { min-height: 18px; max-height: 38px; margin: 7px 0 8px; overflow: auto; color: #b7c4df; font-size: 12px; flex: 0 0 auto; }
      .status[data-kind="success"] { color: #72d6b0; }
      .status[data-kind="error"] { color: #ff9d9d; }
      .chapter-progress { margin: 0 0 8px; flex: 0 0 auto; color: #d4def2; font-size: 11px; }
      .chapter-summary { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
      .chapter-success { color: #72d6b0; }
      .chapter-fail { color: #ff9d9d; }
      .chapter-track { display: flex; width: 100%; height: 5px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.12); }
      .chapter-track-success { height: 100%; background: #72d6b0; transition: width .18s ease; }
      .chapter-track-fail { height: 100%; background: #ff7777; transition: width .18s ease; }
      .batch-summary { margin: 0 0 7px; color: #b7c4df; font-size: 11px; flex: 0 0 auto; }
      .batch-summary[hidden], .chapter-progress[hidden], .batch-details[hidden] { display: none; }
      .batch-activity { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 2px; }
      .batch-detail-toggle { min-height: 22px; border: 0; padding: 1px 3px; color: #aab8d8; background: transparent; font-size: 10px; white-space: nowrap; }
      .batch-detail-toggle:hover:not(:disabled) { transform: none; color: #fff; background: transparent; }
      .batch-details { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; max-height: 260px; margin: 0 0 7px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; }
      .progress-table-wrap { min-height: 0; max-height: 194px; overflow: auto; scrollbar-width: thin; }
      .progress-table { width: 100%; border-collapse: collapse; table-layout: fixed; color: #dce5f7; font-size: 10px; }
      .progress-table th, .progress-table td { padding: 4px 2px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: center; white-space: nowrap; }
      .progress-table th { position: sticky; top: 0; z-index: 1; color: #aab8d8; background: #20283c; font-weight: 600; }
      .progress-table th:first-child, .progress-table td:first-child { width: 42px; text-align: left; padding-left: 6px; }
      .progress-table tr[data-selected="true"] { background: rgba(138,168,255,.17); }
      .progress-row { cursor: pointer; }
      .progress-state[data-state="done"] { color: #72d6b0; }
      .progress-state[data-state="running"] { color: #8aa8ff; }
      .progress-state[data-state="error"] { color: #ff9d9d; }
      .progress-state[data-state="skipped"] { color: #aab8d8; }
      .progress-state[data-state="waiting"] { color: #75829e; }
      .progress-spinner { display: inline-block; animation: manga-progress-spin .9s linear infinite; }
      @keyframes manga-progress-spin { to { transform: rotate(360deg); } }
      .progress-selection { flex: 0 0 auto; min-height: 34px; max-height: 60px; overflow: auto; padding: 6px 8px; color: #b7c4df; background: rgba(5,10,20,.2); font-size: 10px; line-height: 1.4; }
      .progress-selection[data-kind="error"] { color: #ff9d9d; }
      .progress-selection[data-kind="success"] { color: #72d6b0; }
      .progress-compat { flex: 0 0 auto; padding: 4px 7px; color: #f3d58a; background: rgba(243,213,138,.08); font-size: 10px; }
      .metrics { min-height: 16px; margin: 0 0 8px; color: #aab8d8; font-size: 11px; flex: 0 0 auto; }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 0 0 auto; }
      .actions .retry, .actions .continue, .actions .view-toggle { grid-column: 1 / -1; }
      .actions .next-chapter { grid-column: 1 / -1; }
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
        .card { width: min(310px, calc(100vw - 24px)); }
      }
      @media (max-height: 460px) {
        .batch-details { max-height: 140px; }
        .progress-table-wrap { max-height: 95px; }
        .status { max-height: 25px; }
      }
    </style>
    <section class="panel" data-dock="right" data-placement="above" aria-label="图片翻译">
      <button class="launcher" data-action="toggle" type="button" aria-expanded="false" aria-label="展开图片翻译" title="展开图片翻译">
        <span class="launcher-glyph" aria-hidden="true">图</span>
      </button>
      <div class="card" hidden>
        <div class="card-head">
          <span class="title-cluster"><span class="title">图片翻译</span><span class="backend" data-role="backend">本地</span></span>
          <span class="count">${state.entries.length} 页</span>
          <button class="collapse" data-action="close" type="button" aria-label="收起图片翻译" title="收起">×</button>
        </div>
        <div class="status" data-kind="info">点击开始翻译当前章节图片</div>
        <div class="chapter-progress" data-role="chapter-progress" hidden>
          <div class="chapter-summary"><span data-role="chapter-label">本章：0 / 0</span><span><span class="chapter-success" data-role="chapter-success">成功 0</span> · <span class="chapter-fail" data-role="chapter-fail">失败 0</span></span></div>
          <div class="chapter-track" aria-label="章节处理进度"><span class="chapter-track-success" data-role="progress-success-bar"></span><span class="chapter-track-fail" data-role="progress-fail-bar"></span></div>
        </div>
        <div class="batch-summary" data-role="batch-summary" hidden>
          <div data-role="batch-label">当前批次：--</div>
          <div class="batch-activity"><span data-role="batch-activity">翻译中：0 张 · 修复中：0 张</span><button class="batch-detail-toggle" data-action="toggle-details" type="button" aria-expanded="false">▸ 批次详情</button></div>
        </div>
        <div class="batch-details" data-role="batch-details" hidden>
          <div class="progress-compat" data-role="progress-compat" hidden>处理中，后端未提供阶段进度</div>
          <div class="progress-table-wrap"><table class="progress-table"><thead><tr><th>页码</th><th>准备</th><th>识别</th><th>翻译</th><th>修复</th><th>合成</th><th>结果</th></tr></thead><tbody data-role="progress-rows"></tbody></table></div>
          <div class="progress-selection" data-role="progress-selection">选择一页查看具体步骤。</div>
        </div>
        <div class="metrics" data-role="metrics"><span data-role="average-time">平均每张图：--</span></div>
        <div class="actions">
          <button class="primary" data-action="start" type="button">翻译本章</button>
          <button data-action="pause" type="button" disabled>暂停</button>
          <button class="retry" data-action="retry" type="button" hidden>重试失败页</button>
          <button class="continue" data-action="continue" type="button" hidden>继承缓存并继续</button>
          <button class="view-toggle" data-action="toggle-view" type="button" hidden>显示原图</button>
          <button class="next-chapter" data-action="next-chapter" type="button" hidden>翻译下一话</button>
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
  const nextChapterButton = shadow.querySelector('[data-action="next-chapter"]');
  const countNode = shadow.querySelector('.count');
  const statusNode = shadow.querySelector('.status');
  const averageTimeNode = shadow.querySelector('[data-role="average-time"]');
  const backendNode = shadow.querySelector('[data-role="backend"]');
  const chapterProgressNode = shadow.querySelector('[data-role="chapter-progress"]');
  const chapterLabelNode = shadow.querySelector('[data-role="chapter-label"]');
  const chapterSuccessNode = shadow.querySelector('[data-role="chapter-success"]');
  const chapterFailNode = shadow.querySelector('[data-role="chapter-fail"]');
  const progressSuccessBar = shadow.querySelector('[data-role="progress-success-bar"]');
  const progressFailBar = shadow.querySelector('[data-role="progress-fail-bar"]');
  const batchSummaryNode = shadow.querySelector('[data-role="batch-summary"]');
  const batchLabelNode = shadow.querySelector('[data-role="batch-label"]');
  const batchActivityNode = shadow.querySelector('[data-role="batch-activity"]');
  const batchDetailsNode = shadow.querySelector('[data-role="batch-details"]');
  const progressRowsNode = shadow.querySelector('[data-role="progress-rows"]');
  const progressSelectionNode = shadow.querySelector('[data-role="progress-selection"]');
  const progressCompatNode = shadow.querySelector('[data-role="progress-compat"]');
  const detailToggleButton = shadow.querySelector('[data-action="toggle-details"]');

  const PROGRESS_STAGES = ['prepare', 'recognize', 'translate', 'inpaint', 'render', 'result'];
  const PROGRESS_STAGE_LABELS = {
    prepare: '准备', recognize: '识别', translate: '翻译', inpaint: '修复', render: '合成', result: '结果',
  };
  const PIPELINE_STAGES = ['recognize', 'translate', 'inpaint', 'render'];

  function emptyStageProgress() {
    return { state: 'waiting', step: '', startedAt: 0, elapsedMs: 0, updatedAt: 0, error: '' };
  }

  function createProgressTask(taskId, chapterLabel, entries, backend = '', pageProgressVersion = 0) {
    const pages = new Map();
    entries.forEach((entry, index) => {
      const pageIndex = Number.isInteger(entry.pageIndex) ? entry.pageIndex : index;
      pages.set(pageIndex, {
        pageIndex,
        filename: entry.name || entry.filename || `page-${pageIndex + 1}`,
        outcome: 'pending',
        stages: Object.fromEntries(PROGRESS_STAGES.map(stage => [stage, emptyStageProgress()])),
      });
      entry.progressTaskId = taskId;
      entry.progressPageIndex = pageIndex;
    });
    const task = {
      taskId,
      chapterLabel,
      backend,
      pageProgressVersion: Number(pageProgressVersion) || 0,
      pages,
      total: pages.size,
      batchPageIndices: [],
      activeRunPageIndices: [],
      currentRunId: '',
      lastSequence: 0,
      startedAt: 0,
      completedAt: 0,
    };
    state.progressTasks.set(taskId, task);
    return task;
  }

  function getActiveProgressTask() {
    return state.progressTasks.get(state.activeProgressTaskId) || null;
  }

  function setActiveProgressTask(taskId) {
    if (!state.progressTasks.has(taskId)) return;
    state.activeProgressTaskId = taskId;
    state.selectedProgressPage = null;
    updateProgressView();
  }

  function formatBackendLabel(mode) {
    return mode === 'aigate' ? '云端' : '本地';
  }

  function updateBackendBadge(mode) {
    backendNode.textContent = formatBackendLabel(mode);
    backendNode.title = mode === 'aigate' ? '当前批次使用云端翻译后端' : '当前批次使用本地翻译后端';
  }

  function syncSavedBackendBadge() {
    try {
      chrome.storage.local.get(['mangaBackendMode'], settings => {
        if (chrome.runtime.lastError || state.running) return;
        updateBackendBadge(settings?.mangaBackendMode === 'aigate' ? 'aigate' : 'local');
      });
    } catch (_) {
      updateBackendBadge('local');
    }
  }

  function createRunId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function setProgressBackend(task, mode, version) {
    if (!task) return;
    task.backend = mode === 'aigate' ? 'aigate' : 'local';
    task.pageProgressVersion = Number(version) || 0;
    updateBackendBadge(task.backend);
    const unreported = task.pageProgressVersion < 1;
    task.activeRunPageIndices.forEach(pageIndex => {
      const page = task.pages.get(pageIndex);
      if (!page || page.outcome === 'success') return;
      PIPELINE_STAGES.forEach(stageName => {
        const stage = page.stages[stageName];
        if (unreported && ['waiting', 'unavailable'].includes(stage.state)) {
          stage.state = 'unavailable';
          stage.step = 'backend-no-progress';
        } else if (!unreported && stage.state === 'unavailable') {
          page.stages[stageName] = emptyStageProgress();
        }
      });
    });
    updateProgressView();
  }

  function beginProgressBatch(task, entries, runId, preserveSuccessfulRows = false) {
    if (!task) return;
    task.currentRunId = runId;
    task.lastSequence = 0;
    if (!task.startedAt) task.startedAt = performance.now();
    task.completedAt = 0;
    const activeRunPageIndices = entries
      .map(entry => Number.isInteger(entry.progressPageIndex) ? entry.progressPageIndex : entry.pageIndex)
      .filter(Number.isInteger)
      .sort((left, right) => left - right);
    const retainedSuccesses = preserveSuccessfulRows
      ? task.batchPageIndices.filter(pageIndex => task.pages.get(pageIndex)?.outcome === 'success')
      : [];
    task.activeRunPageIndices = activeRunPageIndices;
    task.batchPageIndices = Array.from(new Set([...retainedSuccesses, ...activeRunPageIndices]))
      .sort((left, right) => left - right);
    activeRunPageIndices.forEach(pageIndex => {
      const page = task.pages.get(pageIndex);
      if (!page || page.outcome === 'success') return;
      page.outcome = 'pending';
      page.stages = Object.fromEntries(PROGRESS_STAGES.map(stageName => [stageName, emptyStageProgress()]));
      if (task.pageProgressVersion < 1) {
        PIPELINE_STAGES.forEach(stageName => {
          page.stages[stageName].state = 'unavailable';
          page.stages[stageName].step = 'backend-no-progress';
        });
      }
    });
    setActiveProgressTask(task.taskId);
    updateProgressView();
  }

  function applyPageProgressEvent(message) {
    const task = state.progressTasks.get(String(message.taskId || ''));
    const pageIndex = Number(message.pageIndex);
    const sequence = Number(message.sequence);
    if (!task || task.currentRunId !== String(message.runId || '')
      || !task.activeRunPageIndices.includes(pageIndex)
      || !Number.isInteger(sequence) || sequence <= task.lastSequence) return;
    task.lastSequence = sequence;
    const page = task.pages.get(pageIndex);
    const stage = page?.stages?.[message.stage];
    if (!page || !stage || page.outcome !== 'pending') return;
    const now = performance.now();
    const nextState = ['waiting', 'running', 'done', 'skipped', 'error'].includes(message.state)
      ? message.state
      : 'waiting';
    if (stage.state === 'running' && nextState !== 'running' && stage.startedAt) {
      stage.elapsedMs += Math.max(0, now - stage.startedAt);
      stage.startedAt = 0;
    }
    if (nextState === 'running' && stage.state !== 'running') stage.startedAt = now;
    if (nextState === 'running' && stage.state === 'running' && !stage.startedAt) stage.startedAt = now;
    stage.state = nextState;
    stage.step = String(message.step || '');
    stage.error = String(message.error || '');
    stage.updatedAt = now;
    if (message.state === 'error') page.lastError = stage.error || stage.step;
    updateProgressView();
  }

  function markProgressPageSucceeded(taskId, pageIndex, cached = false) {
    const task = state.progressTasks.get(String(taskId || ''));
    const page = task?.pages.get(Number(pageIndex));
    if (!task || !page) return;
    if (cached) {
      ['prepare', ...PIPELINE_STAGES].forEach(stageName => {
        page.stages[stageName] = { ...emptyStageProgress(), state: 'skipped', step: 'cache' };
      });
    }
    const result = page.stages.result;
    if (result.state === 'running' && result.startedAt) {
      result.elapsedMs += Math.max(0, performance.now() - result.startedAt);
    }
    result.state = 'done';
    result.step = cached ? 'cache-complete' : 'applied';
    result.startedAt = 0;
    result.updatedAt = performance.now();
    result.error = '';
    page.outcome = 'success';
    page.lastError = '';
    updateProgressView();
  }

  function markProgressPageFailed(taskId, pageIndex, error) {
    const task = state.progressTasks.get(String(taskId || ''));
    const page = task?.pages.get(Number(pageIndex));
    if (!task || !page || page.outcome === 'success') return;
    page.outcome = 'failed';
    page.lastError = String(error?.message || error || '翻译失败');
    PROGRESS_STAGES.forEach(stageName => {
      const stage = page.stages[stageName];
      if (stage.state !== 'running') return;
      if (stage.startedAt) stage.elapsedMs += Math.max(0, performance.now() - stage.startedAt);
      stage.startedAt = 0;
      stage.state = 'error';
      stage.error = stage.error || page.lastError;
    });
    const hasStageError = PROGRESS_STAGES.some(stageName => page.stages[stageName].state === 'error');
    if (!hasStageError) {
      page.stages.result.state = 'error';
      page.stages.result.step = 'failed';
      page.stages.result.error = page.lastError;
      page.stages.result.updatedAt = performance.now();
    }
    updateProgressView();
  }

  function progressStepLabel(stageName, step) {
    const labels = {
      download: '正在下载原图', submit: '准备提交', submitting: '正在提交翻译', received: '已提交后端',
      loading: '正在载入图片', preprocessing: '正在预处理', colorizing: '正在图像上色', upscaling: '正在超分处理',
      detection: '正在检测文字', ocr: '正在 OCR 识别', textline_merge: '正在整理文字区域',
      queued: '等待阶段处理', translating: '正在翻译', translated: '翻译完成',
      'mask-generation': '正在生成蒙版', 'mask-generation-redo': '蒙版生成重做中',
      inpainting: '正在背景修复', 'inpainting-redo': '背景修复重做中', 'redo-complete': '修复重做完成', complete: '修复完成',
      rendering: '正在合成文字', passthrough: '无文字图片，保留原图', saved: '合成结果已保存',
      'save-result': '正在保存合成结果',
      delivering: '翻译结果正在返回', 'local-save': '云端结果正在保存到本地',
      'apply-to-page': '正在应用到网页', 'cache-restore': '正在恢复缓存结果',
      cache: '缓存命中，跳过模型处理', 'cache-complete': '缓存结果已应用', applied: '结果已应用到网页',
      'no-text': '未检测到文字，跳过翻译与修复', 'recognition-failed': '识别失败，跳过后续阶段',
      'translation-failed': '翻译失败，跳过后续阶段', 'backend-no-progress': '后端未提供阶段进度',
      'backend-result': '后端返回失败', 'empty-result': '后端未返回结果图片', 'stream-result': '准备结果失败', failed: '图片处理失败',
    };
    return labels[step] || (step ? String(step).replaceAll('-', ' ') : '等待处理');
  }

  function progressStepForState(stageName, stage) {
    const label = progressStepLabel(stageName, stage?.step);
    if (stage?.state === 'done' && label.startsWith('正在')) return `已完成${label.slice(2)}`;
    if (stage?.state === 'skipped' && stage?.step !== 'no-text' && stage?.step !== 'cache') return `已跳过：${label}`;
    return label;
  }

  function getProgressStatePresentation(stageName, stage) {
    const stateName = stage?.state || 'waiting';
    const presentation = {
      done: ['✓', '完成'], running: ['↻', '进行中'], waiting: ['○', '等待'],
      skipped: ['—', stage?.step === 'no-text' ? '无文字，跳过' : '跳过'],
      unavailable: ['—', '后端未提供阶段进度'], error: ['×', '失败'],
    }[stateName] || ['○', '等待'];
    const detail = stage?.error || progressStepForState(stageName, stage);
    return { symbol: presentation[0], label: presentation[1], detail, stateName };
  }

  function renderProgressTable(task) {
    const indexes = task.batchPageIndices.slice(0, MANGA_BATCH_WINDOW_SIZE);
    const focusedRow = shadow.activeElement?.closest?.('.progress-row');
    const focusedPage = Number(focusedRow?.dataset.pageIndex);
    progressRowsNode.replaceChildren();
    const preferredPage = state.selectedProgressPage?.taskId === task.taskId
      ? Number(state.selectedProgressPage.pageIndex)
      : Number(state.selectedProgressPage?.pageIndex);
    const selectedKey = indexes.includes(preferredPage) ? preferredPage : indexes[0];
    if (indexes.length) {
      state.selectedProgressPage = { taskId: task.taskId, pageIndex: indexes[0] };
      if (indexes.includes(preferredPage)) {
        state.selectedProgressPage = { taskId: task.taskId, pageIndex: preferredPage };
      }
    }
    indexes.forEach(pageIndex => {
      const page = task.pages.get(pageIndex);
      if (!page) return;
      const row = document.createElement('tr');
      row.className = 'progress-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.dataset.pageIndex = String(pageIndex);
      row.dataset.selected = String(pageIndex === selectedKey);
      const pageCell = document.createElement('td');
      pageCell.textContent = `第 ${pageIndex + 1} 页`;
      row.appendChild(pageCell);
      PROGRESS_STAGES.forEach(stageName => {
        const cell = document.createElement('td');
        const stage = page.stages[stageName];
        const stateInfo = getProgressStatePresentation(stageName, stage);
        const icon = document.createElement('span');
        icon.className = `progress-state${stateInfo.stateName === 'running' ? ' progress-spinner' : ''}`;
        icon.dataset.state = stateInfo.stateName === 'unavailable' ? 'skipped' : stateInfo.stateName;
        icon.textContent = stateInfo.symbol;
        icon.title = `${PROGRESS_STAGE_LABELS[stageName]}：${stateInfo.detail}`;
        cell.appendChild(icon);
        row.appendChild(cell);
      });
      progressRowsNode.appendChild(row);
    });
    if (Number.isInteger(focusedPage) && indexes.includes(focusedPage)) {
      try {
        progressRowsNode.querySelector(`[data-page-index="${focusedPage}"]`)?.focus({ preventScroll: true });
      } catch (_) {
        // Focus restoration is only for keeping keyboard selection stable during live updates.
      }
    }

    const selectedPage = task.pages.get(selectedKey);
    progressSelectionNode.dataset.kind = selectedPage?.outcome === 'failed' ? 'error'
      : (selectedPage?.outcome === 'success' ? 'success' : 'info');
    if (!selectedPage) {
      progressSelectionNode.textContent = '选择一页查看具体步骤。';
      return;
    }
    const running = PROGRESS_STAGES.find(stageName => selectedPage.stages[stageName].state === 'running');
    const failed = PROGRESS_STAGES.find(stageName => selectedPage.stages[stageName].state === 'error');
    const stageName = running || failed || [...PROGRESS_STAGES].reverse().find(name => selectedPage.stages[name].state === 'done' || selectedPage.stages[name].state === 'skipped');
    if (stageName) {
      const stage = selectedPage.stages[stageName];
      const elapsed = stage.elapsedMs + (stage.state === 'running' && stage.startedAt ? performance.now() - stage.startedAt : 0);
      const elapsedText = stage.state === 'running' || elapsed > 0 ? ` · 耗时 ${formatDuration(elapsed)}` : '';
      const statusText = stage.error
        ? `${progressStepForState(stageName, stage)}：${stage.error}`
        : progressStepForState(stageName, stage);
      progressSelectionNode.textContent = `${task.chapterLabel} · 第 ${selectedKey + 1} 页：${PROGRESS_STAGE_LABELS[stageName]} · ${statusText}${elapsedText}`;
    } else if (task.pageProgressVersion < 1 && selectedPage.outcome === 'pending') {
      progressSelectionNode.textContent = `${task.chapterLabel} · 第 ${selectedKey + 1} 页：处理中，后端未提供阶段进度。`;
    } else {
      progressSelectionNode.textContent = `${task.chapterLabel} · 第 ${selectedKey + 1} 页：${selectedPage.outcome === 'success' ? '处理完成' : '等待处理'}`;
    }
    if (selectedPage.stages.translate.step === 'no-text' || selectedPage.stages.inpaint.step === 'no-text') {
      progressSelectionNode.textContent += '；未检测到文字，已跳过翻译与修复。';
    }
    if (selectedPage.outcome === 'failed' && selectedPage.lastError && !failed) {
      progressSelectionNode.textContent += `：${selectedPage.lastError}`;
    }
  }

  function updateProgressView() {
    const task = getActiveProgressTask();
    if (!task) {
      chapterProgressNode.hidden = true;
      batchSummaryNode.hidden = true;
      batchDetailsNode.hidden = true;
      if (!card.hidden) schedulePanelPosition();
      return;
    }
    chapterProgressNode.hidden = task.total <= 0;
    const pages = Array.from(task.pages.values());
    const succeeded = pages.filter(page => page.outcome === 'success').length;
    const failed = pages.filter(page => page.outcome === 'failed').length;
    const processed = succeeded + failed;
    chapterLabelNode.textContent = `${task.chapterLabel}：${processed} / ${task.total} · 失败 ${failed}`;
    chapterSuccessNode.textContent = `成功 ${succeeded}`;
    chapterFailNode.textContent = `失败 ${failed}`;
    const denominator = task.total || 1;
    progressSuccessBar.style.width = `${(succeeded / denominator) * 100}%`;
    progressFailBar.style.width = `${(failed / denominator) * 100}%`;
    countNode.textContent = `${task.chapterLabel} · ${task.total} 页`;

    const batchPages = task.batchPageIndices.map(index => task.pages.get(index)).filter(Boolean);
    batchSummaryNode.hidden = batchPages.length === 0;
    if (!batchPages.length) {
      batchDetailsNode.hidden = true;
      return;
    }
    const first = batchPages[0].pageIndex + 1;
    const last = batchPages[batchPages.length - 1].pageIndex + 1;
    const finished = batchPages.filter(page => page.outcome !== 'pending').length;
    batchLabelNode.textContent = `${task.chapterLabel} 当前批次：${first === last ? `第 ${first} 页` : `第 ${first}–${last} 页`} · ${finished} / ${batchPages.length} 已完成`;
    const translateRunning = batchPages.filter(page => page.stages.translate.state === 'running').length;
    const inpaintRunning = batchPages.filter(page => page.stages.inpaint.state === 'running').length;
    batchActivityNode.textContent = `翻译中：${translateRunning} 张 · 修复中：${inpaintRunning} 张`;
    const expanded = Boolean(state.progressExpanded);
    batchDetailsNode.hidden = !expanded;
    card.dataset.detailsExpanded = String(expanded);
    detailToggleButton.setAttribute('aria-expanded', String(expanded));
    detailToggleButton.textContent = expanded ? '▾ 收起详情' : '▸ 批次详情';
    progressCompatNode.hidden = task.pageProgressVersion >= 1;
    if (expanded) renderProgressTable(task);
    if (!card.hidden) schedulePanelPosition();
  }

  function setProgressDetailsExpanded(expanded) {
    state.progressExpanded = Boolean(expanded);
    updateProgressView();
    positionPanel(true);
  }

  const currentChapterLabel = manga18ChapterInfo
    ? `本章 第 ${manga18ChapterInfo.chapterNumber} 话`
    : '本章';
  const currentProgressTask = createProgressTask(state.taskId, currentChapterLabel, state.entries);
  setActiveProgressTask(currentProgressTask.taskId);
  syncSavedBackendBadge();
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.mangaBackendMode && !state.running) {
      updateBackendBadge(changes.mangaBackendMode.newValue === 'aigate' ? 'aigate' : 'local');
    }
  });

  const VIEWPORT_PADDING = 18;
  const LAUNCHER_SIZE = 36;
  const TEXT_TRIGGER_GAP = 8;
  let repositionFrame = null;
  let manualPosition = null;
  let pointerDrag = null;
  let suppressLauncherClick = false;
  let suppressLauncherClickTimer = null;

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
    if (manualPosition) {
      positionManuallyPositionedPanel(expanded);
      return;
    }

    const protectedRects = getProtectedTranslationRects();
    const candidates = getPanelCandidates();
    let fallback = candidates[0];

    for (const candidate of candidates) {
      if (expanded) {
        const availableHeight = candidate.placement === 'above'
          ? candidate.top - VIEWPORT_PADDING - 20
          : window.innerHeight - VIEWPORT_PADDING - candidate.top - 56;
        card.style.maxHeight = `${Math.max(1, Math.min(560, availableHeight))}px`;
      }
      const cardWidth = expanded ? card.offsetWidth : 0;
      const cardHeight = expanded ? card.offsetHeight : 0;
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
    if (expanded) {
      const availableHeight = fallback.placement === 'above'
        ? fallback.top - VIEWPORT_PADDING - 20
        : window.innerHeight - VIEWPORT_PADDING - fallback.top - 56;
      card.style.maxHeight = `${Math.max(1, Math.min(560, availableHeight))}px`;
    }
    setPanelPosition(fallback);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function positionManuallyPositionedPanel(expanded = !card.hidden) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = viewportWidth - VIEWPORT_PADDING - LAUNCHER_SIZE;
    const maxTop = viewportHeight - VIEWPORT_PADDING - LAUNCHER_SIZE;
    manualPosition.left = clamp(manualPosition.left, VIEWPORT_PADDING, maxLeft);
    manualPosition.top = clamp(manualPosition.top, VIEWPORT_PADDING, maxTop);

    const roomToLeft = manualPosition.left + LAUNCHER_SIZE - VIEWPORT_PADDING;
    const roomToRight = viewportWidth - VIEWPORT_PADDING - manualPosition.left;
    const aboveRoom = manualPosition.top - VIEWPORT_PADDING - 20;
    const belowRoom = viewportHeight - VIEWPORT_PADDING - manualPosition.top - 56;

    let dock = roomToLeft > roomToRight ? 'right' : 'left';
    let placement = aboveRoom > belowRoom ? 'above' : 'below';
    if (expanded) {
      const cardWidth = card.offsetWidth;
      if (roomToLeft >= cardWidth && roomToRight < cardWidth) dock = 'right';
      else if (roomToRight >= cardWidth && roomToLeft < cardWidth) dock = 'left';
      else if (roomToLeft < cardWidth && roomToRight >= roomToLeft) dock = 'left';
      else if (roomToRight < cardWidth && roomToLeft > roomToRight) dock = 'right';

      const availableHeight = Math.max(1, Math.min(560, placement === 'above' ? aboveRoom : belowRoom));
      card.style.maxHeight = `${availableHeight}px`;
    }

    setPanelPosition({
      dock,
      placement,
      left: manualPosition.left,
      top: manualPosition.top,
    });
  }

  function beginLauncherDrag(event) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = panel.getBoundingClientRect();
    pointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    try {
      launcher.setPointerCapture(event.pointerId);
    } catch (_) {
      // Pointer capture is best-effort; pointer events still work while over the launcher.
    }
  }

  function moveLauncher(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const deltaX = event.clientX - pointerDrag.startX;
    const deltaY = event.clientY - pointerDrag.startY;
    if (!pointerDrag.moved && Math.hypot(deltaX, deltaY) < 5) return;

    pointerDrag.moved = true;
    event.preventDefault();
    launcher.dataset.dragging = 'true';
    manualPosition = {
      left: pointerDrag.startLeft + deltaX,
      top: pointerDrag.startTop + deltaY,
    };
    positionManuallyPositionedPanel();
  }

  function endLauncherDrag(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const moved = pointerDrag.moved;
    pointerDrag = null;
    delete launcher.dataset.dragging;
    if (!moved) return;

    suppressLauncherClick = true;
    if (suppressLauncherClickTimer !== null) window.clearTimeout(suppressLauncherClickTimer);
    suppressLauncherClickTimer = window.setTimeout(() => {
      suppressLauncherClick = false;
      suppressLauncherClickTimer = null;
    }, 0);
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
    const task = getActiveProgressTask();
    const completed = task
      ? Array.from(task.pages.values()).filter(page => page.outcome === 'success' || page.outcome === 'failed').length
      : state.translated + state.failed;
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
    state.averageTimer = window.setInterval(() => {
      updateAverageTime();
      if (state.progressExpanded) updateProgressView();
    }, 1000);
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
    startButton.disabled = state.running || state.cacheChecking;
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
    nextChapterButton.hidden = !nextChapterUrl;
    nextChapterButton.disabled = state.running || state.cacheChecking || !nextChapterUrl;
    nextChapterButton.textContent = state.nextChapterRunning
      ? `正在翻译第 ${manga18ChapterInfo.chapterNumber + 1} 话…`
      : (manga18ChapterInfo
        ? `翻译下一话（第 ${manga18ChapterInfo.chapterNumber + 1} 话）`
        : '翻译下一话');
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
      state.cacheChecking = false;
      setRunningControls();
    }
  }

  async function processEntries(entries, { retry = false } = {}) {
    const pluginBatchSize = state.pluginBatchSize;
    for (let offset = 0; offset < entries.length; offset += pluginBatchSize) {
      while (state.paused && state.running) {
        await sleep(120);
      }
      if (!state.running) break;
      const batch = entries.slice(offset, offset + pluginBatchSize)
        .filter(entry => entry && entry.completed !== true);
      if (!batch.length) continue;
      const firstIndex = state.entries.indexOf(batch[0]);
      const lastIndex = state.entries.indexOf(batch[batch.length - 1]);
      setStatus(
        `正在提交第 ${firstIndex + 1}–${lastIndex + 1} 页（每次 ${pluginBatchSize} 张）…`,
      );
      await translateMangaBatchThroughBackground(batch, { retry });
    }
  }

  async function translateCurrentPage() {
    if (state.running) return;
    setActiveProgressTask(currentProgressTask.taskId);
    currentProgressTask.currentRunId = '';
    currentProgressTask.batchPageIndices = [];
    currentProgressTask.activeRunPageIndices = [];
    currentProgressTask.lastSequence = 0;
    currentProgressTask.pages.forEach(page => {
      page.outcome = 'pending';
      page.lastError = '';
      page.stages = Object.fromEntries(PROGRESS_STAGES.map(stageName => [stageName, emptyStageProgress()]));
    });
    updateProgressView();
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
    setStatus('正在连接翻译后端…');

    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '翻译后端启动失败');
      applyPreparedPluginBatchSize(ready);
      setProgressBackend(currentProgressTask, ready.backend, ready.pageProgressVersion);
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
      syncSavedBackendBadge();
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
    setActiveProgressTask(currentProgressTask.taskId);
    setAllImageSources(false);
    resetProcessingClock();
    setRunningControls();
    setStatus(`准备重试 ${failedEntries.length} 个失败页面…`);
    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '翻译后端启动失败');
      applyPreparedPluginBatchSize(ready);
      setProgressBackend(currentProgressTask, ready.backend, ready.pageProgressVersion);
      startProcessingClock();
      await processEntries(failedEntries, { retry: true });
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
      syncSavedBackendBadge();
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
    setActiveProgressTask(currentProgressTask.taskId);
    setAllImageSources(false);
    resetProcessingClock();
    setRunningControls();
    setStatus(`继承 ${state.translated} 页缓存，继续处理 ${incompleteEntries.length} 页…`);
    try {
      const ready = await sendMessage({ action: 'prepareMangaTranslation' });
      if (!ready.success) throw new Error(ready.error || '翻译后端启动失败');
      applyPreparedPluginBatchSize(ready);
      setProgressBackend(currentProgressTask, ready.backend, ready.pageProgressVersion);
      startProcessingClock();
      await processEntries(incompleteEntries, { retry: true });
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
      syncSavedBackendBadge();
    }
  }

  function translateNextManga18Chapter() {
    void translateManga18NextChapterInBackground();
  }

  launcher.addEventListener('pointerdown', beginLauncherDrag);
  launcher.addEventListener('pointermove', moveLauncher);
  launcher.addEventListener('pointerup', endLauncherDrag);
  launcher.addEventListener('pointercancel', endLauncherDrag);
  launcher.addEventListener('lostpointercapture', endLauncherDrag);
  launcher.addEventListener('click', event => {
    if (suppressLauncherClick) {
      suppressLauncherClick = false;
      if (suppressLauncherClickTimer !== null) window.clearTimeout(suppressLauncherClickTimer);
      suppressLauncherClickTimer = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setExpanded(card.hidden);
  });
  collapseButton.addEventListener('click', () => setExpanded(false));
  detailToggleButton.addEventListener('click', () => setProgressDetailsExpanded(!state.progressExpanded));
  progressRowsNode.addEventListener('click', event => {
    const row = event.target.closest('.progress-row');
    const task = getActiveProgressTask();
    if (!row || !task) return;
    state.selectedProgressPage = { taskId: task.taskId, pageIndex: Number(row.dataset.pageIndex) };
    updateProgressView();
  });
  progressRowsNode.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.progress-row');
    const task = getActiveProgressTask();
    if (!row || !task) return;
    event.preventDefault();
    state.selectedProgressPage = { taskId: task.taskId, pageIndex: Number(row.dataset.pageIndex) };
    updateProgressView();
  });
  startButton.addEventListener('click', translateCurrentPage);
  retryButton.addEventListener('click', retryFailedPages);
  continueButton.addEventListener('click', continueIncompletePages);
  viewToggleButton.addEventListener('click', toggleImageView);
  nextChapterButton.addEventListener('click', translateNextManga18Chapter);
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
    const pauseMessage = state.nextChapterRunning
      ? (state.paused ? '已暂停后续批次；当前批次继续处理并更新进度。' : '已继续翻译下一话')
      : (state.paused ? '已暂停后续批次；当前批次继续处理并更新进度。' : '已继续处理当前页面');
    setStatus(pauseMessage, state.paused ? 'info' : 'success');
  });
  window.addEventListener('resize', schedulePanelPosition);
  window.addEventListener('immersive-translation-trigger-change', schedulePanelPosition);
  document.addEventListener('selectionchange', schedulePanelPosition, { passive: true });
  positionPanel(false);
  state.cacheChecking = Boolean(manga18ChapterInfo);
  setRunningControls();
  restoreCachedResults();
  }

  initialiseMangaPage().catch(error => {
    console.warn('[漫画翻译] 页面图片入口初始化失败:', error);
  });
})();
