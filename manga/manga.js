// 漫画章节翻译页：解析 HTML 图片地址，逐张调用 manga-translator-ui App 核心桥接。
(function () {
  'use strict';

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:5003';
  const SHARED_BACKEND_PROTOCOL = 'manga-translator-ui-shared-v2';
  const SHARED_BACKEND_PROJECT_ROOT = '/Users/apple/Documents/github/manga-translator-ui';
  const AIGATE_TEMP_OUTPUT_FOLDER = '/tmp/immersive-translate-output';
  const TRANSLATE_PATH = '/execute_image/translate';
  const NATIVE_HOST_NAME = 'com.timecyber.immersivetranslate.manga_backend';
  const DEFAULT_PLUGIN_BATCH_SIZE = 10;
  const MIN_PLUGIN_BATCH_SIZE = 1;
  const MAX_PLUGIN_BATCH_SIZE = 10;

  function normalizePluginBatchSize(value, fallback = DEFAULT_PLUGIN_BATCH_SIZE) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(
      MIN_PLUGIN_BATCH_SIZE,
      Math.min(MAX_PLUGIN_BATCH_SIZE, Math.trunc(numericValue)),
    );
  }

  const state = {
    htmlFile: null,
    view: new URLSearchParams(window.location.search).get('view') || 'full',
    sourceKind: 'web',
    sourceSignatures: [],
    pendingResumeRecord: null,
    htmlTitle: '',
    sourceUrl: '',
    downloadBaseName: 'translated-chapter',
    images: [],
    running: false,
    paused: false,
    externalTaskActive: false,
    workbenchVisible: true,
    logScrollPaused: false,
    logSource: 'current',
    selectedImageIndex: -1,
    previewMode: 'compare',
    localBridgeReady: false,
    remoteServiceReady: false,
    logOffset: 0,
    logPolling: false,
    logTimer: null,
    outputFolder: '',
    taskOutputFolder: '',
    taskOutputFolderFromResume: false,
    batchSize: DEFAULT_PLUGIN_BATCH_SIZE,
    taskId: '',
    backendMode: 'local',
    aigateToken: '',
    aigateArea: '华东一区',
    aigateSkuName: '',
    aigateImageId: '',
    aigateInstanceId: '',
    aigateEndpoint: '',
    aigateNonce: '',
    aigateSkus: [],
    aigateImages: [],
    aigateInstances: [],
    releasedAigateInstanceIds: new Set(),
    refreshingAigateResources: false,
    creatingAigateInstance: false,
    startingAigateTranslation: false,
    checkingAigateConnectivity: false,
    stoppingAigateInstance: false,
    releasingAigateInstance: false,
    configRevision: '',
    outputFolderReady: Promise.resolve(),
    cacheRestorePromise: Promise.resolve(),
  };

  const $ = selector => document.querySelector(selector);
  const fileInput = $('#chapter-html');
  const imageFilesInput = $('#image-files');
  const logSourceInput = $('#backend-log-source');
  const pauseBackendLogButton = $('#pause-backend-log');
  const saveImagesButton = $('#save-translated-images');
  const retryFailedButton = $('#retry-failed-images');
  const resumeTaskBox = $('#resume-task-box');
  const resumeTaskLabel = $('#resume-task-label');
  const resumeTaskButton = $('#resume-task-button');
  const standaloneSummary = $('#standalone-summary');
  const connectionHelp = $('#connection-help');
  const localBridgeStatus = $('#local-bridge-status');
  const remoteServiceStatus = $('#remote-service-status');
  const aigateEndpointDisplay = $('#aigate-endpoint-display');
  const releaseAigateButton = $('#release-aigate-instance');
  const connectionSummary = $('#connection-summary');
  const backendStatusBadge = $('#backend-status-badge');
  const previewName = $('#preview-name');
  const previewEmpty = $('#preview-empty');
  const previewImages = $('#preview-images');
  const previewOriginal = $('#preview-original');
  const previewTranslated = $('#preview-translated');
  const fileDrop = $('.file-drop');
  const fileLabel = $('#file-label');
  const imageCount = $('#image-count');
  const chapterTitle = $('#chapter-title');
  const imageGrid = $('#image-grid');
  const endpointInput = $('#server-endpoint');
  const sourceBaseInput = $('#source-base');
  const outputFolderInput = $('#manga-output-folder');
  const pluginBatchSizeInput = $('#plugin-batch-size');
  const pluginBatchSizeStatus = $('#plugin-batch-size-status');
  const chooseOutputFolderButton = $('#choose-output-folder');
  const statusText = $('#status-text');
  const progressText = $('#progress-text');
  const progressBar = $('#progress-bar');
  const logsPanel = $('.logs-panel');
  const backendLog = $('#backend-log');
  const backendLogStatus = $('#backend-log-status');
  const clearBackendLogButton = $('#clear-backend-log');
  const toggleBackendLogButton = $('#toggle-backend-log');
  const startBackendButton = $('#start-backend');
  const pauseTranslationButton = $('#pause-translation');
  const translateButton = $('#translate-chapter');
  const testButton = $('#test-server');
  const downloadButton = $('#download-html');
  const backendModeInput = $('#manga-backend-mode');
  const aigateControls = $('#aigate-controls');
  const localControls = $('#local-controls');
  const startLocalServiceButton = $('#start-local-service');
  const testLocalServiceButton = $('#test-local-service');
  const localServiceStatus = $('#local-service-status');
  const aigateTokenInput = $('#manga-aigate-token');
  const aigateAreaInput = $('#manga-aigate-area');
  const aigateSkuInput = $('#manga-aigate-sku');
  const aigateImageInput = $('#manga-aigate-image');
  const aigateInstanceInput = $('#manga-aigate-instance');
  const aigateStatus = $('#aigate-status');
  const refreshAigateButton = $('#refresh-aigate-resources');
  const createAigateButton = $('#create-aigate-instance');
  const startAigateButton = $('#start-aigate-instance');
  const checkAigateServiceButton = $('#check-aigate-service');
  const stopAigateButton = $('#stop-aigate-instance');
  document.body.dataset.view = state.view;
  const EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR = '.scramble-page:not(.thewayhome) > img';
  const EIGHTEEN_COMIC_IMAGE_ATTRIBUTES = ['data-original', 'data-src', 'data-lazy-src', 'src'];
  if (state.view === 'plugin') $('#source-panel-title').textContent = '本地服务与结果保存';

  function setStatus(message, kind = 'info') {
    statusText.textContent = message;
    statusText.dataset.kind = kind;
    if (connectionHelp) connectionHelp.dataset.visible = String(kind === 'error' && /服务|后端|连接|桥接|AIGate/i.test(message));
  }

  function reportBackendStatus() {
    const ready = state.backendMode === 'local'
      ? state.localBridgeReady
      : state.localBridgeReady && state.remoteServiceReady;
    const text = state.backendMode === 'aigate'
      ? (ready ? 'AIGate 与本地保存服务已连接' : 'AIGate 云端 · 本地保存桥')
      : (ready ? '本地服务已连接' : '本地服务');
    if (connectionSummary) {
      connectionSummary.textContent = ready ? '可以翻译' : '尚未检查';
      connectionSummary.dataset.kind = ready ? 'success' : 'info';
    }
    if (backendStatusBadge) backendStatusBadge.textContent = text;
    if (localBridgeStatus) {
      localBridgeStatus.textContent = `本地保存桥：${state.localBridgeReady ? '已连接' : '未连接'}`;
      localBridgeStatus.dataset.kind = state.localBridgeReady ? 'success' : 'info';
    }
    if (remoteServiceStatus) {
      remoteServiceStatus.hidden = state.backendMode !== 'aigate';
      remoteServiceStatus.textContent = `AIGate 云端：${state.remoteServiceReady ? '已连接' : '未连接'}`;
      remoteServiceStatus.dataset.kind = state.remoteServiceReady ? 'success' : 'info';
    }
    if (aigateEndpointDisplay) aigateEndpointDisplay.textContent = `云端服务地址：${state.aigateEndpoint || '未启动'}`;
    if (window.parent !== window && state.view !== 'standalone') {
      window.parent.postMessage({
        type: 'workbenchBackendStatus',
        kind: ready ? 'ready' : 'info',
        text,
      }, location.origin);
    }
  }

  function reportTaskStatus(active, done = 0, total = state.images.length) {
    if (window.parent === window) return;
    window.parent.postMessage({
      type: 'workbenchTaskStatus',
      active: Boolean(active || state.running || state.paused || state.externalTaskActive),
      done,
      total,
      title: state.htmlTitle || '独立翻译',
    }, location.origin);
  }

  function setProgress(done, total) {
    progressText.textContent = `${done} / ${total}`;
    progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function updatePauseButton() {
    pauseTranslationButton.disabled = !state.running;
    pauseTranslationButton.textContent = state.paused ? '继续翻译' : '暂停翻译';
  }

  function normaliseEndpoint(value) {
    return value.trim().replace(/\/+$/, '');
  }

  function createTaskId(sourceUrl, imageUrls) {
    // A chapter URL is the stable task key. Image URLs often contain CDN
    // tokens that change between visits even when the chapter is unchanged.
    const seed = sourceUrl || `local-chapter\n${imageUrls.join('\n')}`;
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < seed.length; index += 1) {
      const code = seed.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 3266489917);
    }
    return `manga-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function appendBackendLog(text) {
    if (!text) return;
    const shouldStickToBottom = backendLog.scrollHeight - backendLog.scrollTop - backendLog.clientHeight < 32;
    const maxDisplayCharacters = 240000;
    const nextText = `${backendLog.textContent}${text}`;
    backendLog.textContent = nextText.length > maxDisplayCharacters
      ? nextText.slice(-maxDisplayCharacters)
      : nextText;
    if (shouldStickToBottom && !state.logScrollPaused) backendLog.scrollTop = backendLog.scrollHeight;
  }

  function filterLogPollingNoise(text) {
    return String(text || '').split('\n')
      .filter(line => !/"GET \/logs\?offset=\d+ HTTP\/1\.[01]"/.test(line))
      .join('\n');
  }

  async function pollBackendLog() {
    if (state.logPolling) return;
    state.logPolling = true;
      const mode = state.logSource === 'local' ? 'local' : state.backendMode;
    try {
      let endpoint;
      const headers = {};
      if (mode === 'aigate') {
        if (!state.aigateEndpoint || state.aigateNonce.length < 24) {
          backendLogStatus.textContent = '云端日志待连接：请先选择实例并启动翻译服务';
          backendLogStatus.dataset.kind = 'info';
          return;
        }
        endpoint = normalizeAigateEndpoint(state.aigateEndpoint);
        headers['X-Nonce'] = state.aigateNonce;
      } else {
        endpoint = validateLoopbackEndpoint(endpointInput.value || DEFAULT_ENDPOINT);
      }
      const response = await fetch(`${endpoint}/logs?offset=${state.logOffset}`, {
        headers,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (mode !== state.backendMode && state.logSource !== 'local') return;
      const nextOffset = Number(payload.offset);
      if (Number.isFinite(nextOffset)) state.logOffset = nextOffset;
      appendBackendLog(filterLogPollingNoise(payload.text));
      const source = mode === 'aigate' ? '云端' : '本机';
      backendLogStatus.textContent = payload.size
        ? `${source}已连接 · 自动同步 · ${payload.path || (mode === 'aigate' ? 'shared-api.log' : 'manga-backend.log')}`
        : `${source}已连接，等待后端产生日志`;
      backendLogStatus.dataset.kind = 'success';
    } catch (error) {
      if (mode === state.backendMode) {
        backendLogStatus.textContent = `日志暂不可用：${error.message}`;
        backendLogStatus.dataset.kind = 'error';
      }
    } finally {
      state.logPolling = false;
    }
  }

  function startBackendLogPolling() {
    if (state.logTimer) return;
    pollBackendLog();
    state.logTimer = window.setInterval(() => {
      if (state.workbenchVisible && document.visibilityState !== 'hidden') pollBackendLog();
    }, 2000);
  }

  function resetBackendLogCursor() {
    state.logOffset = 0;
    backendLog.textContent = '';
    pollBackendLog();
  }

  function nativeMessage(message) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendNativeMessage !== 'function') {
        reject(new Error('当前浏览器不支持 Native Messaging'));
        return;
      }
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  function nativeRequestWithProgress(message, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.connectNative !== 'function') {
        reject(new Error('当前浏览器不支持 Native Messaging'));
        return;
      }
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      let settled = false;
      port.onMessage.addListener(response => {
        if (response && response.progress) {
          onProgress(String(response.progress));
          return;
        }
        if (!response || response.done !== true) return;
        settled = true;
        port.disconnect();
        resolve(response);
      });
      port.onDisconnect.addListener(() => {
        if (settled) return;
        const reason = chrome.runtime.lastError?.message || 'Native Messaging 连接已关闭';
        reject(new Error(reason));
      });
      port.postMessage(message);
    });
  }

  function validateLoopbackEndpoint(value) {
    let parsed;
    try {
      parsed = new URL(normaliseEndpoint(value));
    } catch {
      throw new Error('后端地址格式不正确');
    }
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      throw new Error('出于安全考虑，启动器只允许启动本机回环地址');
    }
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5003') {
      throw new Error('漫画插件固定使用统一 App 核心端口 127.0.0.1:5003');
    }
    return DEFAULT_ENDPOINT;
  }

  function looksLikeImageUrl(value) {
    return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(value);
  }

  function is18ComicHostname(hostname) {
    const normalisedHostname = String(hostname || '').toLowerCase();
    return normalisedHostname === '18comic.vip' || normalisedHostname.endsWith('.18comic.vip');
  }

  function is18ComicPhotoSource(value) {
    try {
      const url = new URL(value, window.location.href);
      return is18ComicHostname(url.hostname) && /^\/photo(?:\/|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function is18ComicBodyImageUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return is18ComicHostname(url.hostname)
        && /^\/media\/photos\/\d+\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function is18ComicBlankImageUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return is18ComicHostname(url.hostname)
        && /^\/media\/albums\/blank(?:\.[^/]+)?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function extract18ComicPhotoId(value) {
    try {
      const url = new URL(value, window.location.href);
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
      values = Array.from(match[1].matchAll(/["']([^"']+)["']/g))
        .map(item => item[1]);
    }
    return values
      .map(value => String(value || '').trim())
      .filter(is18ComicPageName);
  }

  function get18ComicImageSourceInfo(documentFragment, baseUrl) {
    const values = Array.from(documentFragment.querySelectorAll('img'))
      .flatMap(image => EIGHTEEN_COMIC_IMAGE_ATTRIBUTES
        .map(attribute => image.getAttribute(attribute))
        .filter(Boolean))
      .map(value => {
        try {
          return new URL(value, baseUrl || window.location.href).href;
        } catch {
          return '';
        }
      })
      .filter(value => /^https?:\/\//i.test(value));
    const blankUrl = values.find(is18ComicBlankImageUrl);
    const bodyUrls = values.filter(is18ComicBodyImageUrl);
    const domainUrl = blankUrl || bodyUrls[0] || '';
    let origin = '';
    try {
      origin = new URL(domainUrl).origin;
    } catch {
      // The caller will fall back to the already-normalised body URLs.
    }
    let query = '';
    for (const value of bodyUrls) {
      try {
        const search = new URL(value).search;
        if (search) {
          query = search;
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

  function decodeBase64Url(value) {
    try {
      return atob(value.replace(/\s/g, '')).trim();
    } catch {
      return '';
    }
  }

  function extractSlideUrls(htmlText) {
    const match = htmlText.match(/slides_p_path\s*=\s*\[((?:.|\n)*?)\]\s*;/i);
    if (!match) return [];
    return Array.from(match[1].matchAll(/['"]([A-Za-z0-9+/=_-]+)['"]/g))
      .map(item => decodeBase64Url(item[1]))
      .filter(url => /^https?:\/\//i.test(url) && looksLikeImageUrl(url));
  }

  function extract18ComicImageUrls(documentFragment, baseUrl, sourceUrl, htmlText) {
    const seen = new Set();
    const records = Array.from(documentFragment.querySelectorAll(EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR))
      .map(image => EIGHTEEN_COMIC_IMAGE_ATTRIBUTES
        .map(attribute => image.getAttribute(attribute)?.trim() || '')
        .filter(Boolean)
        .map(value => {
          try {
            return new URL(value, baseUrl || window.location.href).href;
          } catch {
            return '';
          }
        })
        .find(is18ComicBodyImageUrl))
      .filter(url => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
    const pageNames = extract18ComicPageArray(htmlText);
    const pageId = extract18ComicPhotoId(sourceUrl);
    const sourceInfo = get18ComicImageSourceInfo(documentFragment, baseUrl);
    const generatedUrls = build18ComicImageUrls(pageId, pageNames, sourceInfo);
    return generatedUrls.length ? generatedUrls : records;
  }

  function extractImageUrls(htmlText, baseOverride = '') {
    const documentFragment = new DOMParser().parseFromString(htmlText, 'text/html');
    const rawCanonical = documentFragment.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || '';
    const rawOgUrl = documentFragment.querySelector('meta[property="og:url"]')?.getAttribute('content')?.trim() || '';
    const resolutionBase = baseOverride.trim() || window.location.href;
    const resolveSourceUrl = value => {
      if (!value) return '';
      try {
        return new URL(value, resolutionBase).href;
      } catch {
        return '';
      }
    };
    const canonical = resolveSourceUrl(rawCanonical);
    const ogUrl = resolveSourceUrl(rawOgUrl);
    const baseUrl = baseOverride.trim() || canonical || ogUrl || resolutionBase;
    const sourceUrl = canonical || ogUrl || resolveSourceUrl(baseOverride.trim());
    if (is18ComicPhotoSource(sourceUrl)) {
      // 18comic's page shell contains many ads, menu tiles and social icons.
      // page_arr supplies the chapter order and filenames; do not fall back
      // to the global <img> list when the body selector is empty.
      return {
        urls: extract18ComicImageUrls(documentFragment, baseUrl, sourceUrl, htmlText),
        title: documentFragment.title.trim() || '翻译章节',
      };
    }
    const slideUrls = extractSlideUrls(htmlText);
    const values = slideUrls.length ? slideUrls : Array.from(documentFragment.querySelectorAll('img'))
      .flatMap(image => ['src', 'data-src', 'data-original', 'data-lazy-src']
        .map(attribute => image.getAttribute(attribute))
        .filter(Boolean));

    const urls = [];
    const seen = new Set();
    values.forEach(value => {
      const trimmed = value.trim();
      if (!trimmed) return;
      let url = trimmed;
      if (!trimmed.startsWith('data:')) {
        try {
          url = new URL(trimmed, baseUrl || window.location.href).href;
        } catch {
          return;
        }
      }
      if (!url.startsWith('data:') && !/^https?:\/\//i.test(url)) return;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
    return { urls, title: documentFragment.title.trim() || '翻译章节' };
  }

  function filenameFromUrl(url, index) {
    if (url.startsWith('data:')) return `page-${String(index + 1).padStart(2, '0')}.png`;
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split('/').pop();
      if (name) return name.replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch {
      // Fall back to a stable page name below.
    }
    return `page-${String(index + 1).padStart(2, '0')}.png`;
  }

  function safeDownloadBaseName(value) {
    return String(value || 'translated-chapter')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'translated-chapter';
  }

  function makeImageCard(item, index) {
    const card = document.createElement('article');
    card.className = 'image-card';
    card.dataset.index = String(index);
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', '预览第 ' + (index + 1) + ' 张：' + item.name);
    card.innerHTML = `
      <div class="image-frame"><img loading="lazy"></div>
      <div class="image-info">
        <div class="image-name"></div>
        <div class="image-status"></div>
        <div class="image-card-actions"><button type="button" data-move="up" aria-label="上移">↑</button><button type="button" data-move="down" aria-label="下移">↓</button><button type="button" data-remove="true" aria-label="移除图片">移除</button></div>
      </div>
    `;
    const image = card.querySelector('img');
    image.alt = item.name;
    image.src = item.url;
    card.querySelector('.image-name').textContent = item.name;
    card.querySelector('.image-name').title = item.name;
    card.querySelector('.image-status').textContent = item.statusText || '等待翻译';
    image.addEventListener('error', () => updateImageStatus(index, '源图片无法加载', 'error'));
    if (item.status) card.classList.add(item.status);
    card.addEventListener('click', () => selectPreviewImage(index));
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPreviewImage(index);
      }
    });
    card.querySelectorAll('button').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      if (button.hasAttribute('data-remove')) removeImage(index);
      else moveImage(index, button.dataset.move === 'up' ? -1 : 1);
    }));
    return card;
  }

  function moveImage(index, delta) {
    if (state.running || state.paused) return;
    const target = index + delta;
    if (target < 0 || target >= state.images.length) return;
    [state.images[index], state.images[target]] = [state.images[target], state.images[index]];
    state.selectedImageIndex = target;
    updateTaskIdentity();
    imageCount.textContent = `${state.images.length} 张图片`;
    chapterTitle.textContent = `${state.htmlTitle} · ${state.images.length} 张图片`;
    renderImages();
    saveIndependentTaskRecord(state.sourceKind);
  }

  function removeImage(index) {
    if (state.running || state.paused) return;
    const [removed] = state.images.splice(index, 1);
    if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    state.selectedImageIndex = Math.min(Math.max(0, index), state.images.length - 1);
    updateTaskIdentity();
    imageCount.textContent = `${state.images.length} 张图片`;
    chapterTitle.textContent = `${state.htmlTitle} · ${state.images.length} 张图片`;
    translateButton.disabled = state.images.length === 0;
    const hasResults = state.images.some(item => item.resultDataUrl);
    downloadButton.disabled = !hasResults;
    saveImagesButton.disabled = !hasResults;
    setProgress(state.images.filter(item => item.resultDataUrl).length, state.images.length);
    renderImages();
    saveIndependentTaskRecord(state.sourceKind);
  }

  function updateTaskIdentity() {
    if (state.sourceKind === 'files') {
      const fingerprint = state.images.map(item => `${item.signature?.name || item.name}\n${item.signature?.size || 0}\n${item.signature?.hash || ''}`).join('\n');
      state.taskId = createTaskId('local-files\n' + fingerprint, state.images.map(item => item.name));
    } else {
      state.taskId = createTaskId(state.sourceUrl || state.htmlTitle, state.images.map(item => item.imageUrl || item.url));
    }
  }

  function selectPreviewImage(index) {
    const item = state.images[index];
    if (!item) return;
    state.selectedImageIndex = index;
    imageGrid.querySelectorAll('.image-card').forEach(card => {
      card.classList.toggle('selected', Number(card.dataset.index) === index);
      card.setAttribute('aria-selected', String(Number(card.dataset.index) === index));
    });
    previewName.textContent = item.name;
    previewEmpty.hidden = true;
    previewImages.hidden = false;
    previewOriginal.src = item.url;
    if (item.resultUrl) previewTranslated.src = item.resultUrl;
    else previewTranslated.removeAttribute('src');
    previewTranslated.hidden = !item.resultUrl;
    previewTranslated.closest('figure').classList.toggle('preview-unavailable', !item.resultUrl);
    previewTranslated.previousElementSibling.textContent = item.resultUrl
      ? '译图'
      : item.pendingSave ? '译图待保存' : item.status === 'error' ? '翻译失败' : '等待译图';
    previewImages.className = 'preview-images mode-' + state.previewMode;
    previewImages.dataset.mode = state.previewMode;
    previewImages.closest('.preview-pane').dataset.mode = state.previewMode;
    document.querySelectorAll('[data-preview-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.previewMode === state.previewMode));
    });
  }

  function updateImageStatus(index, message, kind = '') {
    const card = imageGrid.querySelector(`[data-index="${index}"]`);
    const item = state.images[index];
    if (item) { item.status = kind; item.statusText = message; }
    if (!card) return;
    card.classList.remove('processing', 'done', 'error');
    if (kind) card.classList.add(kind);
    card.querySelector('.image-status').textContent = message;
    if (state.selectedImageIndex === index) selectPreviewImage(index);
  }

  function renderImages() {
    imageGrid.replaceChildren();
    imageGrid.classList.toggle('empty-state', state.images.length === 0);
    if (!state.images.length) {
      imageGrid.innerHTML = '<div class="empty-icon">▧</div><p>当前内容中没有识别到可翻译图片</p>';
      state.selectedImageIndex = -1;
      previewImages.hidden = true;
      previewEmpty.hidden = false;
      downloadButton.disabled = true;
      saveImagesButton.disabled = true;
      return;
    }
    state.images.forEach((item, index) => imageGrid.appendChild(makeImageCard(item, index)));
    if (state.images.length) selectPreviewImage(state.selectedImageIndex >= 0 ? state.selectedImageIndex : 0);
    else {
      state.selectedImageIndex = -1;
      previewImages.hidden = true;
      previewEmpty.hidden = false;
    }
  }

  function loadImageList(urls, title, sourceName = '', sourceUrl = '', sourceKind = '', taskId = '') {
    state.htmlFile = sourceName ? { name: sourceName } : null;
    state.htmlTitle = title || '翻译章节';
    state.sourceUrl = sourceUrl || '';
    state.sourceKind = sourceKind || (sourceUrl ? 'web' : (sourceName ? 'html' : 'web'));
    state.taskId = taskId || createTaskId(state.sourceUrl || state.htmlTitle, urls);
    state.taskOutputFolder = taskId ? String(state.pendingResumeRecord?.outputFolder || '') : '';
    state.taskOutputFolderFromResume = Boolean(taskId && state.pendingResumeRecord);
    state.downloadBaseName = safeDownloadBaseName(sourceName || state.htmlTitle);
    state.images = urls.map((url, index) => ({
      url,
      name: filenameFromUrl(url, index),
      blob: null,
      resultUrl: '',
      resultDataUrl: '',
      sourceBlob: null,
      imageUrl: url,
      status: '',
      statusText: '等待翻译',
    }));
    state.selectedImageIndex = state.images.length ? 0 : -1;
    fileLabel.textContent = sourceName ? `当前来源：${sourceName}` : '当前网页图片';
    imageCount.textContent = `${state.images.length} 张图片`;
    chapterTitle.textContent = `${state.htmlTitle} · ${state.images.length} 张图片`;
    translateButton.disabled = state.images.length === 0;
    state.paused = false;
    updatePauseButton();
    downloadButton.disabled = true;
    setProgress(0, state.images.length);
    setStatus(state.images.length ? '图片已读取，可以开始翻译' : '没有识别到图片', state.images.length ? 'success' : 'error');
    renderImages();
    saveIndependentTaskRecord(state.sourceKind);
    state.cacheRestorePromise = restoreCachedResults();
  }

  async function loadChapter(file) {
    const htmlText = await file.text();
    const parsed = extractImageUrls(htmlText, sourceBaseInput.value);
    if (!parsed.urls.length) {
      const hasRelative = /(?:src|data-src|data-original)\s*=\s*["'](?!https?:|data:|\/\/)[^"']+/i.test(htmlText);
      document.body.dataset.needsBase = String(hasRelative);
      throw new Error(hasRelative
        ? 'HTML 中的漫画图片使用相对路径。填写可访问的图片基础地址，或直接选择对应图片文件。'
        : 'HTML 中没有识别到漫画图片；请检查普通 img、懒加载属性或 slides_p_path 内容。');
    }
    const pendingResume = state.pendingResumeRecord;
    if (pendingResume?.kind === 'html') {
      const importedTaskId = createTaskId(pendingResume.title || parsed.title || '翻译章节', parsed.urls);
      if (importedTaskId !== pendingResume.taskId) {
        throw new Error('所选 HTML 与待恢复任务的图片列表不匹配；请重新选择原章节，或取消恢复后作为新任务导入。');
      }
    }
    document.body.dataset.needsBase = 'false';
    loadImageList(parsed.urls, parsed.title, file.name, '', 'html', pendingResume?.taskId || '');
    state.sourceKind = 'html';
    state.pendingResumeRecord = null;
    resumeTaskBox.hidden = true;
    saveIndependentTaskRecord('html');
  }

  async function fingerprintFiles(files) {
    const signatures = [];
    for (const file of files) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      signatures.push({ name: file.name, size: file.size, hash });
    }
    return signatures;
  }

  async function loadImageFiles(fileList) {
    let files = Array.from(fileList || []).filter(file => /^image\/(png|jpeg|webp)$/i.test(file.type));
    if (!files.length) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    let signatures = await fingerprintFiles(files);
    const pendingResume = state.pendingResumeRecord?.kind === 'files' ? state.pendingResumeRecord : null;
    if (pendingResume) {
      const expected = Array.isArray(pendingResume.signatures) ? pendingResume.signatures : [];
      if (expected.length !== Number(pendingResume.count) || files.length !== expected.length
        || expected.some(item => !item || !item.name || !Number.isFinite(Number(item.size)) || !/^[a-f0-9]{64}$/i.test(String(item.hash || '')))) {
        throw new Error('待恢复任务缺少完整的原图校验信息，不能安全恢复；可取消恢复后将所选图片作为新任务导入。');
      }
      const keyOf = item => `${item.name}\n${item.size}\n${String(item.hash).toLowerCase()}`;
      const available = new Map();
      files.forEach((file, index) => {
        const key = keyOf(signatures[index]);
        if (!available.has(key)) available.set(key, []);
        available.get(key).push({ file, signature: signatures[index] });
      });
      const ordered = expected.map(signature => available.get(keyOf(signature))?.shift());
      if (ordered.some(item => !item)) {
        throw new Error('所选图片与待恢复任务不匹配；请重新选择原图，或取消恢复后作为新任务导入。');
      }
      files = ordered.map(item => item.file);
      signatures = ordered.map(item => item.signature);
      const resumedFingerprint = signatures.map(item => [item.name, item.size, item.hash].join('\n')).join('\n');
      const resumedTaskId = createTaskId('local-files\n' + resumedFingerprint, files.map(item => item.name));
      if (resumedTaskId !== pendingResume.taskId) {
        throw new Error('所选原图与待恢复任务标识不一致；请取消恢复后作为新任务导入。');
      }
    }
    const fingerprint = signatures.map(item => [item.name, item.size, item.hash].join('\n')).join('\n');
    state.htmlFile = null;
    state.sourceKind = 'files';
    state.htmlTitle = files.length === 1 ? files[0].name : '独立翻译 · ' + files.length + ' 张图片';
    state.sourceUrl = '';
    state.sourceSignatures = signatures;
    state.taskOutputFolder = pendingResume ? String(pendingResume.outputFolder || '') : '';
    state.taskOutputFolderFromResume = Boolean(pendingResume);
    state.taskId = pendingResume?.taskId || createTaskId('local-files\n' + fingerprint, files.map(item => item.name));
    state.downloadBaseName = safeDownloadBaseName(files.length === 1 ? files[0].name : state.htmlTitle);
    state.images.forEach(item => { if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); });
    state.images = files.map((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      return {
        url: objectUrl,
        name: file.name || ('page-' + (index + 1) + '.png'),
        sourceBlob: file,
        signature: signatures[index],
        imageUrl: 'local-file:' + signatures[index].hash,
        objectUrl,
        resultUrl: '',
        resultDataUrl: '',
      };
    });
    state.pendingResumeRecord = null;
    resumeTaskBox.hidden = true;
    state.selectedImageIndex = 0;
    fileLabel.textContent = files.length + ' 张图片已选择';
    imageCount.textContent = files.length + ' 张图片';
    chapterTitle.textContent = state.htmlTitle;
    translateButton.disabled = false;
    downloadButton.disabled = true;
    setProgress(0, files.length);
    setStatus('图片已读取，可以开始翻译', 'success');
    renderImages();
    await saveIndependentTaskRecord('files');
    await restoreCachedResults();
  }

  async function saveIndependentTaskRecord(kind = state.sourceKind) {
    if (!state.taskId || !state.images.length) return;
    await state.outputFolderReady;
    if (!state.taskOutputFolder) state.taskOutputFolder = state.outputFolder;
    const record = {
      taskId: state.taskId,
      kind,
      title: state.htmlTitle,
      sourceUrl: state.sourceUrl,
      imageUrls: state.images.map(item => /^https?:\/\//i.test(item.imageUrl || item.url) ? (item.imageUrl || item.url) : ''),
      fileNames: state.images.map(item => item.name),
      signatures: kind === 'files' ? state.sourceSignatures : [],
      outputFolder: state.taskOutputFolder,
      count: state.images.length,
      updatedAt: Date.now(),
    };
    await storageSet({ mangaLastIndependentTask: record });
  }

  async function restoreCachedResults() {
    if (!state.taskId || !state.images.length) return;
    try {
      const cache = await sendRuntimeMessage({
        action: 'getMangaCache',
        taskId: state.taskId,
        sourceUrl: state.sourceUrl,
        imageUrls: state.images.map(item => item.imageUrl || item.url),
        outputFolder: state.taskOutputFolder,
      });
      if (!cache.success || !cache.found) return;
      let restored = 0;
      for (const page of cache.pages || []) {
        const index = Number(page.index ?? page.pageIndex);
        if (!Number.isInteger(index) || !state.images[index]) continue;
        const cached = await sendRuntimeMessage({
          action: 'getMangaCachedImage',
          taskId: state.taskId,
          pageIndex: index,
          sourceUrl: state.sourceUrl,
          outputFolder: state.taskOutputFolder,
        });
        if (!cached.success || !cached.data) continue;
        const bytes = Uint8Array.from(atob(cached.data), character => character.charCodeAt(0));
        const mimeType = cached.mimeType || 'image/png';
        const blob = new Blob([bytes], { type: mimeType });
        const item = state.images[index];
        item.blob = blob;
        item.resultUrl = URL.createObjectURL(blob);
        item.resultDataUrl = `data:${mimeType};base64,${cached.data}`;
        item.savedPath = page.path || '';
        updateImageStatus(index, '已从本地缓存恢复译图', 'done');
        restored += 1;
      }
      if (restored) {
        downloadButton.disabled = false;
        saveImagesButton.disabled = false;
        setProgress(restored, state.images.length);
        setStatus(`已从本地缓存恢复 ${restored} 张译图`, 'success');
      }
    } catch (error) {
      setStatus(`读取本地译图缓存失败：${error.message}`, 'error');
    }
  }

  async function showResumeTaskNotice() {
    const stored = await storageGet(['mangaLastIndependentTask']);
    const task = stored.mangaLastIndependentTask;
    if (!task || Date.now() - Number(task.updatedAt || 0) > 30 * 24 * 60 * 60 * 1000 || task.taskId === state.taskId) return;
    resumeTaskLabel.textContent = `${task.title || '未完成任务'} · ${task.count || 0} 张 · ${task.kind === 'files' ? '需要重新选择原图' : '可读取本地缓存'}`;
    resumeTaskBox.hidden = false;
    resumeTaskButton.onclick = async () => {
      if (task.kind === 'files') {
        state.pendingResumeRecord = task;
        resumeTaskLabel.textContent = `${task.title || '未完成任务'} · 请重新选择并校验 ${task.count || 0} 张原图`;
        imageFilesInput.click();
        return;
      }
      else if (task.kind === 'html' && (task.imageUrls || []).length === task.count && task.imageUrls.every(Boolean)) {
        state.pendingResumeRecord = task;
        loadImageList(task.imageUrls, task.title, task.title, '', 'html', task.taskId);
        state.pendingResumeRecord = null;
        await restoreCachedResults();
      } else if (task.kind === 'html') {
        state.pendingResumeRecord = task;
        resumeTaskLabel.textContent = `${task.title || '未完成任务'} · 请选择原章节 HTML 以验证图片列表`;
        fileInput.click();
        return;
      }
      else {
        const urls = (task.imageUrls || []).filter(url => /^https?:\/\//i.test(url));
        if (urls.length !== task.count) throw new Error('恢复信息中的远程图片地址不完整');
        state.pendingResumeRecord = task;
        loadImageList(urls, task.title, '', task.sourceUrl || '', 'web', task.taskId);
        state.pendingResumeRecord = null;
        await restoreCachedResults();
      }
      resumeTaskBox.hidden = true;
    };
  }

  $('#cancel-resume-task').addEventListener('click', () => {
    state.pendingResumeRecord = null;
    resumeTaskBox.hidden = true;
    setStatus('已取消任务恢复；可以导入新的图片或 HTML', 'info');
  });

  async function reloadBackendConfig(endpoint) {
    const response = await fetch(`${endpoint}/reload_config`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`本机翻译配置刷新失败（HTTP ${response.status}）：${detail.slice(0, 240)}`);
    }
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, values => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(values || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || {});
    }));
  }

  function setAigateStatus(message, kind = 'info') {
    aigateStatus.textContent = message;
    aigateStatus.dataset.kind = kind;
    if (aigateEndpointDisplay) aigateEndpointDisplay.textContent = `云端服务地址：${state.aigateEndpoint || '未启动'}`;
  }

  function normalizeAigateEndpoint(value) {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:'
      || !parsed.hostname.toLowerCase().endsWith('.waas.aigate.cc')
      || parsed.username || parsed.password || parsed.port
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('AIGate 服务地址无效');
    }
    return parsed.origin;
  }

  function validateAigateBackendInfo(info) {
    if (info?.service !== 'manga-translator-ui'
      || info?.mode !== 'shared'
      || info?.protocol !== SHARED_BACKEND_PROTOCOL) {
      throw new Error('HTTP 6006 已响应，但共享翻译服务身份或协议不匹配');
    }
    if (!(Number(info?.configApiVersion) >= 2)) {
      throw new Error('云端进程可达，但缺少插件会话配置 API v2；请更新项目并重启服务进程');
    }
    return info;
  }

  function validateAigateGpu(gpu) {
    if (!gpu?.cudaAvailable || !gpu?.onnxCudaAvailable || !String(gpu.deviceName || '').trim()) {
      throw new Error('云端 Python 环境未确认 PyTorch CUDA 和 ONNX Runtime CUDA 可用；翻译不会按 GPU 就绪处理');
    }
    return gpu;
  }

  function aigateGpuSummary(gpu) {
    const device = String(gpu.deviceName || 'CUDA GPU').trim();
    const cuda = String(gpu.cudaVersion || '').trim();
    return `GPU ${device}${cuda ? ` · CUDA ${cuda}` : ''}`;
  }

  async function fetchAigateBackendInfo(endpoint, nonce) {
    const serviceEndpoint = normalizeAigateEndpoint(endpoint);
    const serviceNonce = String(nonce || '').trim();
    if (serviceNonce.length < 24) throw new Error('AIGate 服务凭据已失效，请在所选实例启动服务');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${serviceEndpoint}/backend_info`, {
        headers: { 'X-Nonce': serviceNonce },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = validateAigateBackendInfo(await response.json());
      const configResponse = await fetch(`${serviceEndpoint}/config`, {
        headers: { 'X-Nonce': serviceNonce },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!configResponse.ok) {
        if (configResponse.status === 401) throw new Error('云端服务访问凭据无效，请重新启动或检查服务');
        throw new Error(`配置 API HTTP ${configResponse.status}`);
      }
      if (configResponse.body) await configResponse.body.cancel();
      return info;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('检查 AIGate HTTP 6006 连通性超时');
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function formatAigatePrice(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return '价格暂不可用';
    const cents = raw.replace(/^0+(?=\d)/, '').padStart(3, '0');
    return `¥ ${cents.slice(0, -2)}.${cents.slice(-2)}`;
  }

  function setSelectOptions(select, items, placeholder, valueOf, labelOf) {
    while (select.firstChild) select.removeChild(select.firstChild);
    if (!items.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    items.forEach(item => {
      const option = document.createElement('option');
      option.value = valueOf(item);
      option.textContent = labelOf(item);
      select.appendChild(option);
    });
    select.disabled = false;
  }

  async function persistAigateForm() {
    const nextToken = aigateTokenInput.value.trim();
    const nextArea = aigateAreaInput.value || '华东一区';
    const tokenChanged = state.aigateToken !== nextToken;
    const areaChanged = state.aigateArea !== nextArea;
    state.aigateToken = nextToken;
    state.aigateArea = nextArea;
    if (tokenChanged || areaChanged) {
      state.aigateInstanceId = '';
      state.aigateEndpoint = '';
      state.aigateNonce = '';
      state.aigateSkus = [];
      state.aigateImages = [];
      state.aigateInstances = [];
    }
    await storageSet({
      mangaAigateToken: state.aigateToken,
      mangaAigateArea: state.aigateArea,
      mangaAigateSkuName: state.aigateSkuName,
      mangaAigateImageId: state.aigateImageId,
      mangaAigateInstanceId: state.aigateInstanceId,
      mangaAigateEndpoint: state.aigateEndpoint,
      mangaAigateNonce: state.aigateNonce,
    });
  }

  function renderAigateResources() {
    const lifecycleBusy = state.refreshingAigateResources
      || state.creatingAigateInstance
      || state.startingAigateTranslation
      || state.checkingAigateConnectivity
      || state.stoppingAigateInstance
      || state.releasingAigateInstance
      || state.running || state.paused || state.externalTaskActive;
    const skus = state.aigateSkus;
    setSelectOptions(
      aigateSkuInput,
      skus,
      '没有可用 GPU 规格',
      item => item.skuName,
      item => `${item.skuName} · ${formatAigatePrice(item.price)}`,
    );
    if (skus.some(item => item.skuName === state.aigateSkuName)) {
      aigateSkuInput.value = state.aigateSkuName;
    } else {
      state.aigateSkuName = skus[0]?.skuName || '';
      aigateSkuInput.value = state.aigateSkuName;
    }

    const images = state.aigateImages.filter(item => item.areaName === state.aigateArea && item.status === '1');
    setSelectOptions(
      aigateImageInput,
      images,
      '没有可用个人镜像',
      item => item.worksId,
      item => `${item.name}${item.imageVersion ? ` · ${item.imageVersion}` : ''}`,
    );
    if (images.some(item => item.worksId === state.aigateImageId)) {
      aigateImageInput.value = state.aigateImageId;
    } else {
      const preferred = images.find(item => item.name === 'comfyPsV7') || images[0];
      state.aigateImageId = preferred?.worksId || '';
      aigateImageInput.value = state.aigateImageId;
    }

    const instances = state.aigateInstances.filter(item =>
      item.areaName === state.aigateArea && item.operationStatus !== '4' && !state.releasedAigateInstanceIds.has(item.instanceId));
    setSelectOptions(
      aigateInstanceInput,
      instances,
      '没有可用实例',
      item => item.instanceId,
      item => `${item.instanceName} · ${item.statusLabel} · ${item.instanceId}`,
    );
    if (instances.some(item => item.instanceId === state.aigateInstanceId)) {
      aigateInstanceInput.value = state.aigateInstanceId;
    } else {
      const nextInstanceId = instances[0]?.instanceId || '';
      if (state.aigateInstanceId && nextInstanceId !== state.aigateInstanceId) {
        state.aigateEndpoint = '';
        state.aigateNonce = '';
      }
      state.aigateInstanceId = nextInstanceId;
      aigateInstanceInput.value = state.aigateInstanceId;
    }

    aigateTokenInput.disabled = lifecycleBusy;
    aigateAreaInput.disabled = lifecycleBusy;
    backendModeInput.disabled = lifecycleBusy;
    outputFolderInput.disabled = lifecycleBusy;
    chooseOutputFolderButton.disabled = lifecycleBusy;
    startBackendButton.disabled = lifecycleBusy;
    testButton.disabled = lifecycleBusy;
    if (startLocalServiceButton) startLocalServiceButton.disabled = lifecycleBusy;
    if (testLocalServiceButton) testLocalServiceButton.disabled = lifecycleBusy;
    aigateSkuInput.disabled = lifecycleBusy || !skus.length;
    aigateImageInput.disabled = lifecycleBusy || !images.length;
    aigateInstanceInput.disabled = lifecycleBusy || !instances.length;
    refreshAigateButton.disabled = lifecycleBusy;
    createAigateButton.disabled = lifecycleBusy
      || !state.aigateSkuName
      || !state.aigateImageId;
    startAigateButton.disabled = lifecycleBusy || !state.aigateInstanceId;
    checkAigateServiceButton.disabled = lifecycleBusy
      || !state.aigateToken
      || !state.aigateInstanceId;
    stopAigateButton.disabled = lifecycleBusy || !state.aigateInstanceId;
    releaseAigateButton.disabled = lifecycleBusy || !state.aigateToken || !state.aigateInstanceId;
    startAigateButton.title = '本机先从个人 GitHub 同步默认分支，再通过 SSH 隧道让云端 git pull，之后启动 GPU 翻译服务';
    checkAigateServiceButton.title = '只检查已运行实例的仓库版本、GPU 环境和 HTTP 6006 连通性，不启动实例或拉取代码';
  }

  function renderBackendMode() {
    state.backendMode = backendModeInput.value === 'aigate' ? 'aigate' : 'local';
    aigateControls.hidden = state.backendMode !== 'aigate';
    if (localControls) localControls.hidden = state.backendMode !== 'local';
    startBackendButton.hidden = state.backendMode === 'local';
    testButton.hidden = state.backendMode === 'local';
    if (state.view === 'plugin') $('#source-panel-title').textContent = '本地服务与结果保存';
    const savedSummary = state.taskOutputFolder || state.outputFolder || '未设置（使用 App 当前输出目录）';
    if (standaloneSummary) standaloneSummary.textContent = `后端：${state.backendMode === 'aigate' ? 'AIGate 云端' : '本地 App'} · 保存目录：${savedSummary}`;
    startBackendButton.textContent = state.backendMode === 'aigate'
      ? '启动本地结果保存桥' : '启动 App 核心桥接';
    testButton.textContent = state.backendMode === 'aigate'
      ? '测试云端与保存桥' : '测试 App 核心桥接';
    const note = $('#app-config-note');
    if (note) {
      note.textContent = state.backendMode === 'aigate'
        ? '原图将上传到 AIGate；翻译结果回传后由本机共享服务写入所选目录和缓存清单。本地桥仅提供配置与缓存读写，不会执行本地翻译。本机启动前先从你的个人 GitHub 获取最新分支，再通过 SSH 只读隧道供云端 git pull 同步代码。'
        : '本地模式读取本机 manga-translator-ui/config/config.json；此模式不需要 Web 登录，翻译结果保存在所选输出目录。';
    }
  }

  async function initializeBackendSettings() {
    const saved = await storageGet([
      'mangaOutputFolder',
      'batch_size',
      'mangaBackendMode',
      'mangaAigateToken',
      'mangaAigateArea',
      'mangaAigateSkuName',
      'mangaAigateImageId',
      'mangaAigateInstanceId',
      'mangaAigateEndpoint',
      'mangaAigateNonce',
    ]);
    state.outputFolder = String(saved.mangaOutputFolder || '').trim();
    outputFolderInput.value = state.outputFolder;
    state.batchSize = normalizePluginBatchSize(saved.batch_size);
    pluginBatchSizeInput.value = String(state.batchSize);
    state.backendMode = saved.mangaBackendMode === 'aigate' ? 'aigate' : 'local';
    state.aigateToken = String(saved.mangaAigateToken || '');
    state.aigateArea = String(saved.mangaAigateArea || '华东一区');
    state.aigateSkuName = String(saved.mangaAigateSkuName || '');
    state.aigateImageId = String(saved.mangaAigateImageId || '');
    state.aigateInstanceId = String(saved.mangaAigateInstanceId || '');
    state.aigateEndpoint = String(saved.mangaAigateEndpoint || '');
    state.aigateNonce = String(saved.mangaAigateNonce || '');
    backendModeInput.value = state.backendMode;
    aigateTokenInput.value = state.aigateToken;
    aigateAreaInput.value = state.aigateArea;
    endpointInput.value = DEFAULT_ENDPOINT;
    renderBackendMode();
    reportBackendStatus();
    resetBackendLogCursor();
    if (state.view === 'standalone') await showResumeTaskNotice();
    await probeLocalBridge();
    if (state.view !== 'standalone' && state.backendMode === 'aigate' && state.aigateToken) {
      refreshAigateResources()
        .then(() => {
          if (state.aigateEndpoint && state.aigateNonce) {
            return checkAigateServiceConnectivity({ automatic: true });
          }
          return null;
        })
        .catch(error => setAigateStatus(error.message, 'error'));
    }
  }

  function updateLocalServiceStatus(text, kind = 'info') {
    if (!localServiceStatus) return;
    localServiceStatus.textContent = text;
    localServiceStatus.dataset.kind = kind;
  }

  async function probeLocalBridge() {
    try {
      const response = await fetch(`${DEFAULT_ENDPOINT}/backend_info`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const info = await response.json();
      state.localBridgeReady = info?.service === 'manga-translator-ui'
        && info?.mode === 'shared'
        && info?.protocol === SHARED_BACKEND_PROTOCOL
        && info?.projectRoot === SHARED_BACKEND_PROJECT_ROOT;
      if (!state.localBridgeReady) throw new Error('5003 上的进程不是 manga-translator-ui 共享服务');
      const pid = info?.pid ? ` · PID ${info.pid}` : '';
      const api = info?.configApiVersion ? ` · 配置API v${info.configApiVersion}` : '';
      updateLocalServiceStatus(`本地服务：已连接${pid}${api}`, 'success');
    } catch (error) {
      state.localBridgeReady = false;
      updateLocalServiceStatus(`本地服务：未连接（${error.message || error}）`, 'error');
    }
    if (state.backendMode === 'local') state.remoteServiceReady = state.localBridgeReady;
    reportBackendStatus();
    return state.localBridgeReady;
  }

  async function refreshAigateResources() {
    if (state.refreshingAigateResources) return false;
    state.refreshingAigateResources = true;
    renderAigateResources();
    try {
      await persistAigateForm();
      if (!state.aigateToken) {
        setAigateStatus('请填写 AIGate Bearer Token', 'error');
        return false;
      }
      setAigateStatus('正在读取可用 GPU、个人镜像和实例…');
      const result = await nativeMessage({
        action: 'aigateResources',
        token: state.aigateToken,
        area: state.aigateArea,
      });
      if (!result.success) throw new Error(result.error || '读取云扉资源失败');
      state.aigateSkus = Array.isArray(result.skus) ? result.skus : [];
      state.aigateImages = Array.isArray(result.images) ? result.images : [];
      state.aigateInstances = Array.isArray(result.instances) ? result.instances : [];
      renderAigateResources();
      await persistAigateForm();
      setAigateStatus(`已读取 ${state.aigateSkus.length} 个 GPU 规格、${state.aigateImages.length} 个个人镜像和 ${state.aigateInstances.length} 个实例`, 'success');
      return true;
    } catch (error) {
      setAigateStatus(`读取云扉资源失败：${error.message || error}`, 'error');
      return false;
    } finally {
      state.refreshingAigateResources = false;
      renderAigateResources();
    }
  }

  async function startAigateTranslation(instanceId) {
    if (state.running || state.paused || state.externalTaskActive) return false;
    const selectedInstanceId = String(instanceId || state.aigateInstanceId || '').trim();
    await persistAigateForm();
    if (!state.aigateToken || !selectedInstanceId) {
      setAigateStatus('请填写 Token 并选择一个云扉实例', 'error');
      return false;
    }
    state.startingAigateTranslation = true;
    renderAigateResources();
    setAigateStatus('正在准备 AIGate 翻译服务…');
    let serviceStarted = false;
    try {
      const result = await nativeRequestWithProgress({
        action: 'aigateStartTranslation',
        token: state.aigateToken,
        instanceId: selectedInstanceId,
        nonce: state.aigateNonce,
      }, message => setAigateStatus(message));
      if (!result.success) throw new Error(result.error || '启动 AIGate 翻译服务失败');
      const gpu = validateAigateGpu(result.gpu);
      const revision = String(result.revision || '').trim();
      if (!/^[a-f0-9]{7,40}$/i.test(revision)) {
        throw new Error('云端服务未确认 git pull 后的漫画翻译仓库版本');
      }
      serviceStarted = true;
      state.aigateInstanceId = selectedInstanceId;
      state.aigateEndpoint = normalizeAigateEndpoint(result.endpoint);
      state.aigateNonce = String(result.nonce || '');
      state.backendMode = 'aigate';
      backendModeInput.value = 'aigate';
      renderBackendMode();
      await storageSet({
        mangaBackendMode: 'aigate',
        mangaAigateToken: state.aigateToken,
        mangaAigateArea: state.aigateArea,
        mangaAigateSkuName: state.aigateSkuName,
        mangaAigateImageId: state.aigateImageId,
        mangaAigateInstanceId: state.aigateInstanceId,
        mangaAigateEndpoint: state.aigateEndpoint,
        mangaAigateNonce: state.aigateNonce,
      });
      resetBackendLogCursor();
      const backendInfo = await fetchAigateBackendInfo(state.aigateEndpoint, state.aigateNonce);
      state.remoteServiceReady = true;
      reportBackendStatus();
      const syncStatus = result.sourceUpdated ? '已拉取新提交' : '仓库已是最新';
      setAigateStatus(`${aigateGpuSummary(gpu)} 服务已就绪 · manga-translator-ui ${revision}（${syncStatus}）；HTTP 6006 与配置 API v${backendInfo.configApiVersion} 正常`, 'success');
      return true;
    } catch (error) {
      state.remoteServiceReady = false;
      reportBackendStatus();
      setAigateStatus(
        serviceStarted
          ? `云端进程已启动，但页面连通性确认或状态保存失败：${error.message || error}。可点击“检查连通性”重试`
          : String(error.message || error).startsWith('启动云端翻译服务失败：')
            ? String(error.message || error)
            : `启动云端翻译服务失败：${error.message || error}`,
        'error',
      );
      return false;
    } finally {
      state.startingAigateTranslation = false;
      refreshAigateButton.disabled = false;
      renderAigateResources();
    }
  }

  async function checkAigateServiceConnectivity({ automatic = false } = {}) {
    if (!automatic && (state.running || state.paused || state.externalTaskActive)) return false;
    let endpoint = state.aigateEndpoint;
    let nonce = state.aigateNonce;
    if (!state.aigateToken || !state.aigateInstanceId) {
      if (!automatic) setAigateStatus('请填写 AIGate Token 并选择一个已有实例', 'error');
      return false;
    }
    state.checkingAigateConnectivity = true;
    renderAigateResources();
    setAigateStatus('正在检查所选实例上的翻译进程和 HTTP 6006 连通性…');
    try {
      const result = await nativeRequestWithProgress({
        action: 'aigateCheckTranslation',
        token: state.aigateToken,
        instanceId: state.aigateInstanceId,
      }, message => setAigateStatus(message));
      if (!result.success) throw new Error(result.error || '检查云端翻译服务失败');
      const gpu = validateAigateGpu(result.gpu);
      endpoint = normalizeAigateEndpoint(result.endpoint);
      nonce = String(result.nonce || '').trim();
      if (nonce.length < 24) throw new Error('云端服务未返回有效访问凭据');
      state.aigateEndpoint = endpoint;
      state.aigateNonce = nonce;
      await storageSet({
        mangaAigateEndpoint: endpoint,
        mangaAigateNonce: nonce,
      });
      const info = await fetchAigateBackendInfo(endpoint, nonce);
      state.remoteServiceReady = true;
      reportBackendStatus();
      const revision = String(result.revision || '').trim();
      setAigateStatus(`${aigateGpuSummary(gpu)} 翻译服务已就绪 · 云端代码 ${revision || '版本未知'} · HTTP 6006 与配置 API v${info.configApiVersion} 正常`, 'success');
      return true;
    } catch (error) {
      state.remoteServiceReady = false;
      reportBackendStatus();
      setAigateStatus(`云端服务连通性检查失败：${error.message || error}`, 'error');
      return false;
    } finally {
      state.checkingAigateConnectivity = false;
      renderAigateResources();
    }
  }

  async function createAigateInstance() {
    if (state.creatingAigateInstance || state.running || state.paused || state.externalTaskActive) return;
    state.creatingAigateInstance = true;
    renderAigateResources();
    try {
      await persistAigateForm();
      const sku = state.aigateSkus.find(item => item.skuName === state.aigateSkuName);
      const image = state.aigateImages.find(item => item.worksId === state.aigateImageId);
      if (!state.aigateToken || !sku || !image) {
        setAigateStatus('请刷新云扉资源并选择可用 GPU 规格和个人镜像', 'error');
        return;
      }
      const price = formatAigatePrice(sku.price);
      if (!window.confirm(`创建 1 台 ${sku.skuName} 云扉实例（${price}），使用镜像 ${image.name}？云扉会按其当前计费规则计费。`)) return;
      createAigateButton.disabled = true;
      refreshAigateButton.disabled = true;
      setAigateStatus(`正在创建 ${sku.skuName} 实例…`);
      const created = await nativeMessage({
        action: 'aigateCreateInstance',
        token: state.aigateToken,
        area: state.aigateArea,
        skuName: sku.skuName,
        imageId: image.worksId,
        imageType: '3',
      });
      if (!created.success || !created.instanceId) {
        throw new Error(created.error || '云扉未返回实例 ID');
      }
      state.aigateInstanceId = String(created.instanceId);
      state.aigateInstances = [
        {
          instanceId: state.aigateInstanceId,
          instanceName: String(created.instanceName || '新建实例'),
          operationStatus: '1',
          statusLabel: '创建中',
          areaName: state.aigateArea,
        },
        ...state.aigateInstances.filter(item => item.instanceId !== state.aigateInstanceId),
      ];
      renderAigateResources();
      await storageSet({
        mangaAigateToken: state.aigateToken,
        mangaAigateArea: state.aigateArea,
        mangaAigateSkuName: state.aigateSkuName,
        mangaAigateImageId: state.aigateImageId,
        mangaAigateInstanceId: state.aigateInstanceId,
        mangaAigateEndpoint: '',
        mangaAigateNonce: '',
      });
      setAigateStatus(`实例 ${state.aigateInstanceId} 已创建，正在等待并启动翻译服务…`);
      await startAigateTranslation(state.aigateInstanceId);
    } catch (error) {
      setAigateStatus(`创建云扉实例失败：${error.message || error}`, 'error');
    } finally {
      state.creatingAigateInstance = false;
      refreshAigateButton.disabled = false;
      renderAigateResources();
    }
  }

  async function stopAigateInstance() {
    if (state.refreshingAigateResources
      || state.creatingAigateInstance
      || state.startingAigateTranslation
      || state.checkingAigateConnectivity
      || state.stoppingAigateInstance
      || state.releasingAigateInstance
      || state.running || state.paused || state.externalTaskActive) return;
    const instanceId = String(aigateInstanceInput.value || state.aigateInstanceId || '').trim();
    if (!state.aigateToken || !instanceId) return;
    if (!window.confirm(`关闭实例 ${instanceId}？实例会停止，但仍保留在云扉账户中，可稍后重新启动。`)) return;
    state.stoppingAigateInstance = true;
    renderAigateResources();
    try {
      await persistAigateForm();
      const result = await nativeMessage({
        action: 'aigateStopInstance',
        token: state.aigateToken,
        instanceId,
      });
      if (!result.success) throw new Error(result.error || '停止云扉实例失败');
      state.aigateEndpoint = '';
      state.aigateNonce = '';
      state.remoteServiceReady = false;
      await storageSet({ mangaAigateEndpoint: '', mangaAigateNonce: '' });
      setAigateStatus(`已请求停止实例 ${instanceId}；共享盘数据保留`, 'success');
      reportBackendStatus();
      const refreshed = await refreshAigateResources();
      setAigateStatus(refreshed
        ? `已请求停止实例 ${instanceId}；实例仍保留，可稍后启动`
        : `已请求停止实例 ${instanceId}；资源列表刷新失败，请稍后重试`, refreshed ? 'success' : 'info');
    } catch (error) {
      setAigateStatus(`停止云扉实例失败：${error.message || error}`, 'error');
    } finally {
      state.stoppingAigateInstance = false;
      renderAigateResources();
    }
  }

  async function releaseAigateInstance() {
    if (state.running || state.paused || state.externalTaskActive || state.refreshingAigateResources
      || state.creatingAigateInstance || state.startingAigateTranslation || state.checkingAigateConnectivity
      || state.stoppingAigateInstance || state.releasingAigateInstance) return;
    const instanceId = String(aigateInstanceInput.value || state.aigateInstanceId || '').trim();
    if (!state.aigateToken || !instanceId) return;
    if (!window.confirm(`释放实例 ${instanceId}？此操作会删除该实例，无法通过启动操作恢复。`)) return;
    state.releasingAigateInstance = true;
    renderAigateResources();
    setAigateStatus(`正在释放实例 ${instanceId}…`);
    try {
      const result = await nativeMessage({ action: 'aigateReleaseInstance', token: state.aigateToken, instanceId });
      if (!result.success) throw new Error(result.error || '释放云扉实例失败');
      state.aigateInstanceId = '';
      state.aigateEndpoint = '';
      state.aigateNonce = '';
      state.remoteServiceReady = false;
      state.releasedAigateInstanceIds.add(instanceId);
      await storageSet({ mangaAigateInstanceId: '', mangaAigateEndpoint: '', mangaAigateNonce: '' });
      const refreshed = await refreshAigateResources();
      setAigateStatus(refreshed
        ? `实例 ${instanceId} 已释放，资源列表已更新`
        : `实例 ${instanceId} 已释放；资源列表刷新失败，请稍后重新读取`, refreshed ? 'success' : 'info');
      if (state.aigateInstanceId === instanceId) state.aigateInstanceId = '';
      await storageSet({ mangaAigateInstanceId: state.aigateInstanceId });
    } catch (error) {
      setAigateStatus(`释放实例失败，保留当前实例选择：${error.message || error}`, 'error');
    } finally {
      state.releasingAigateInstance = false;
      renderAigateResources();
      reportBackendStatus();
    }
  }

  async function ensureBackendAvailable() {
    const mode = state.backendMode;
    const localEndpoint = DEFAULT_ENDPOINT;
    try {
      let localReady = false;
      try {
        const localResponse = await fetch(`${localEndpoint}/backend_info`, { cache: 'no-store' });
        if (localResponse.ok) {
          const localInfo = await localResponse.json();
          localReady = localInfo?.service === 'manga-translator-ui'
            && localInfo?.mode === 'shared'
            && localInfo?.protocol === SHARED_BACKEND_PROTOCOL
            && localInfo?.projectRoot === SHARED_BACKEND_PROJECT_ROOT;
        }
      } catch {
        localReady = false;
      }
      state.localBridgeReady = localReady;
      if (!localReady) throw new Error('本地保存桥未运行；请使用插件配置页的“启动本地服务”后重试');

      if (mode === 'local') {
        state.remoteServiceReady = true;
        reportBackendStatus();
        return { mode, endpoint: localEndpoint, nonce: '' };
      }

      const saved = await storageGet(['mangaAigateEndpoint', 'mangaAigateNonce']);
      let remoteEndpoint;
      try {
        remoteEndpoint = normalizeAigateEndpoint(saved.mangaAigateEndpoint);
      } catch (error) {
        throw new Error(error.message || '请先在上方启动 AIGate 翻译服务');
      }
      const nonce = String(saved.mangaAigateNonce || '').trim();
      if (nonce.length < 24) throw new Error('AIGate 服务凭据已失效，请重新启动云端服务');
      await fetchAigateBackendInfo(remoteEndpoint, nonce);
      state.remoteServiceReady = true;
      reportBackendStatus();
      return { mode, endpoint: remoteEndpoint, nonce };
    } catch (error) {
      if (mode === 'aigate') state.remoteServiceReady = false;
      reportBackendStatus();
      setStatus(`${mode === 'aigate' ? 'AIGate 云端' : '本地'}翻译后端不可用：${error.message}`, 'error');
      return false;
    }
  }

  function loadCurrentPageData() {
    const encoded = new URLSearchParams(window.location.search).get('pageData');
    if (!encoded) return;
    resumeTaskBox.hidden = true;
    try {
      const pageData = JSON.parse(encoded);
      const urls = Array.isArray(pageData.imageUrls)
        ? pageData.imageUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url))
        : [];
      if (!urls.length) throw new Error('当前网页没有可翻译图片');
      loadImageList(urls, pageData.title || '当前网页章节', '当前网页', pageData.sourceUrl || '', 'web');
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('pageData');
      history.replaceState({}, document.title, cleanUrl.href);
      if (pageData.autoStart === true) {
        setStatus(`已从当前网页读取 ${urls.length} 张图片，正在准备翻译…`, 'success');
        setTimeout(async () => {
          await state.outputFolderReady;
          await state.cacheRestorePromise;
          if (state.running) return;
          translateButton.click();
        }, 80);
      } else {
        setStatus(`已从当前网页读取 ${urls.length} 张图片，可以开始翻译`, 'success');
      }
    } catch (error) {
      setStatus(`读取当前网页失败：${error.message}`, 'error');
    }
  }

  async function fetchImage(item) {
    if (item.sourceBlob instanceof Blob) {
      if (!item.sourceBlob.size) throw new Error('本地图片文件为空');
      return item.sourceBlob;
    }
    const response = await fetch(item.url, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`下载图片失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('下载到空图片');
    return blob;
  }

  function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function translateImage(item, index, backend) {
    updateImageStatus(index, '下载原图…', 'processing');
    const sourceBlob = await fetchImage(item);
    const image = arrayBufferToBase64(await sourceBlob.arrayBuffer());

    updateImageStatus(index, backend.mode === 'aigate'
      ? '正在上传到 AIGate 并翻译…' : '正在 OCR、擦除并排版…', 'processing');
    const response = await fetch(`${backend.endpoint}${TRANSLATE_PATH}`, {
      method: 'POST',
      body: JSON.stringify({
        image,
        filename: item.name,
        imageUrl: item.imageUrl || item.url,
        taskId: state.taskId,
        pageIndex: index,
        sourceUrl: state.sourceUrl,
        outputFolder: backend.mode === 'local'
          ? (state.taskOutputFolder || state.outputFolder || undefined)
          : AIGATE_TEMP_OUTPUT_FOLDER,
        configRevision: state.configRevision,
      }),
      headers: {
        'Content-Type': 'application/json',
        ...(backend.mode === 'aigate' ? { 'X-Nonce': backend.nonce } : {}),
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`翻译失败（HTTP ${response.status}）：${detail.slice(0, 180)}`);
    }
    const resultBlob = await readStreamingImage(response, index);
    item.blob = resultBlob;
    item.resultUrl = URL.createObjectURL(resultBlob);
    item.resultDataUrl = await blobToDataUrl(resultBlob);
    if (backend.mode === 'aigate') {
      const saveResponse = await fetch(
        `${DEFAULT_ENDPOINT}/cache/task/${encodeURIComponent(state.taskId)}/image/${index}`,
        {
          method: 'POST',
          body: JSON.stringify({
            image: item.resultDataUrl.split(',', 2)[1],
            filename: item.name,
            imageUrl: item.imageUrl || item.url,
            sourceUrl: state.sourceUrl,
            outputFolder: state.taskOutputFolder || state.outputFolder || undefined,
          }),
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        },
      );
      if (!saveResponse.ok) {
        const detail = await saveResponse.text();
        item.pendingSave = true;
        saveImagesButton.disabled = false;
        $('#retry-save-images').hidden = false;
        throw new Error(`AIGate 已返回译图，但本地保存失败（HTTP ${saveResponse.status}）：${detail.slice(0, 160)}`);
      }
      const saved = await saveResponse.json();
      item.savedPath = saved.path || '';
      item.pendingSave = false;
    }
    item.saved = true;
    const card = imageGrid.querySelector(`[data-index="${index}"]`);
    card.querySelector('img').src = item.resultUrl;
    updateImageStatus(index, backend.mode === 'aigate' ? '翻译完成并保存到本地' : '翻译完成，已写入保存目录', 'done');
    saveImagesButton.disabled = false;
    await saveIndependentTaskRecord(state.sourceKind);
  }

  async function retrySaveImages() {
    const pending = state.images.map((item, index) => ({ item, index })).filter(({ item }) => item.pendingSave && item.resultDataUrl);
    if (!pending.length) return;
    try {
      const infoResponse = await fetch(`${DEFAULT_ENDPOINT}/backend_info`, { cache: 'no-store' });
      if (!infoResponse.ok) throw new Error(`HTTP ${infoResponse.status}`);
      const info = await infoResponse.json();
      if (info?.service !== 'manga-translator-ui' || info?.mode !== 'shared' || info?.protocol !== SHARED_BACKEND_PROTOCOL) {
        throw new Error('本地共享保存服务身份不匹配');
      }
      state.localBridgeReady = true;
      reportBackendStatus();
    } catch (error) {
      state.localBridgeReady = false;
      reportBackendStatus();
      setStatus(`本地保存桥不可用：${error.message}。请先启动本地服务后重试保存。`, 'error');
      return;
    }
    for (const { item, index } of pending) {
      updateImageStatus(index, '正在重试本地保存…', 'processing');
      try {
        const response = await fetch(`${DEFAULT_ENDPOINT}/cache/task/${encodeURIComponent(state.taskId)}/image/${index}`, {
          method: 'POST',
          body: JSON.stringify({
            image: item.resultDataUrl.split(',', 2)[1],
            filename: item.name,
            imageUrl: item.imageUrl || item.url,
            sourceUrl: state.sourceUrl,
            outputFolder: state.taskOutputFolder || state.outputFolder || undefined,
          }),
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 140)}`);
        const saved = await response.json();
        item.savedPath = saved.path || '';
        item.pendingSave = false;
        item.saved = true;
        updateImageStatus(index, '译图已保存到本地', 'done');
      } catch (error) {
        updateImageStatus(index, `待保存：${error.message || error}`, 'error');
      }
    }
    const stillPending = state.images.some(item => item.pendingSave);
    $('#retry-save-images').hidden = !stillPending;
    setStatus(stillPending ? '仍有译图待保存，可再次重试' : '译图已保存到本地', stillPending ? 'error' : 'success');
  }

  function saveTranslatedImages() {
    const results = state.images.filter(item => item.resultDataUrl);
    if (!results.length) return;
    for (const item of results) {
      const anchor = document.createElement('a');
      anchor.href = item.resultDataUrl;
      anchor.download = `translated-${safeDownloadBaseName(item.name)}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    setStatus(`已发送 ${results.length} 张译图到浏览器下载`, 'success');
  }

  async function readStreamingImage(response, index) {
    // App 核心桥接使用 1 字节状态 + 4 字节大端长度
    // 的帧格式：状态 1 是进度 JSON，状态 2 是错误 JSON，状态 0 是最终 PNG。
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('浏览器不支持读取翻译流');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = new Uint8Array(0);
    let resultBytes = null;

    const appendBuffer = (left, right) => {
      const merged = new Uint8Array(left.byteLength + right.byteLength);
      merged.set(left);
      merged.set(right, left.byteLength);
      return merged;
    };

    const decodeJson = bytes => {
      try {
        return JSON.parse(decoder.decode(bytes));
      } catch (error) {
        return null;
      }
    };

    const progressMessage = payload => {
      const progress = decodeJson(payload);
      if (!progress) return;
      if (progress.error) {
        throw new Error(progress.error);
      }
      if (progress.message) {
        updateImageStatus(index, progress.message, 'processing');
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value && value.byteLength) {
        buffer = appendBuffer(buffer, value);
      }

      while (buffer.byteLength >= 5) {
        const status = buffer[0];
        const length = (
          (buffer[1] * 0x1000000) +
          (buffer[2] * 0x10000) +
          (buffer[3] * 0x100) +
          buffer[4]
        );
        if (length > 256 * 1024 * 1024) {
          throw new Error('翻译后端返回了过大的图片帧');
        }
        if (buffer.byteLength < 5 + length) break;

        const payload = buffer.slice(5, 5 + length);
        buffer = buffer.slice(5 + length);
        if (status === 0) {
          resultBytes = payload;
        } else if (status === 1) {
          progressMessage(payload);
        } else if (status === 2) {
          const error = decodeJson(payload);
          throw new Error(error?.error || '翻译后端处理失败');
        } else {
          throw new Error(`翻译后端返回了未知状态：${status}`);
        }
      }

      if (done) break;
    }

    if (buffer.byteLength) {
      throw new Error('翻译后端返回了不完整的数据帧');
    }
    if (!resultBytes || !resultBytes.byteLength) {
      throw new Error('翻译后端没有返回图片，请检查后端日志');
    }
    return new Blob([resultBytes], { type: 'image/png' });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('读取翻译图片失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function translateChapter({ retryFailed = false } = {}) {
    if (state.running || !state.images.length) return;
    const indexes = state.images.map((item, index) => ({ item, index }))
      .filter(({ item }) => retryFailed
        ? item.status === 'error' && !item.pendingSave
        : !item.resultDataUrl && !item.pendingSave)
      .map(({ index }) => index);
    if (!indexes.length) {
      if (state.images.some(item => item.pendingSave)) setStatus('有已返回的译图等待保存，请使用“重试保存译图”', 'info');
      else setStatus('所有图片均已有译图', 'success');
      return;
    }
    await state.outputFolderReady;
    if (!state.taskOutputFolder) state.taskOutputFolder = state.outputFolder;
    const backend = await ensureBackendAvailable();
    if (!backend) return;
    try {
      const applied = await sendRuntimeMessage({
        action: 'applyMangaTranslatorConfig',
        reloadLocalConfig: false,
      });
      if (!applied.success || !applied.revision) throw new Error(applied.error || '后端没有确认配置版本');
      if (applied.backend !== backend.mode) throw new Error('当前选择的翻译后端刚刚发生变化，请重新开始章节翻译');
      state.configRevision = applied.revision;
    } catch (error) {
      setStatus(`无法应用统一漫画翻译配置：${error.message}`, 'error');
      return;
    }
    state.running = true;
    state.paused = false;
    translateButton.disabled = true;
    testButton.disabled = true;
    startBackendButton.disabled = true;
    updatePauseButton();
    downloadButton.disabled = !state.images.some(item => item.resultDataUrl);
    saveImagesButton.disabled = !state.images.some(item => item.resultDataUrl);
    let completed = state.images.filter(item => item.resultDataUrl).length;
    setProgress(completed, state.images.length);
    setStatus(retryFailed ? `重试 ${indexes.length} 张失败图片…` : '开始处理图片…');
    reportTaskStatus(true, completed, state.images.length);
    renderAigateResources();
    try {
      for (const index of indexes) {
        while (state.paused && state.running) {
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (!state.running) return;
        try {
          await translateImage(state.images[index], index, backend);
        } catch (error) {
          updateImageStatus(index, error.message || '翻译失败', 'error');
        }
        completed += 1;
        setProgress(completed, state.images.length);
        reportTaskStatus(true, completed, state.images.length);
      }
      const successCount = state.images.filter(item => item.resultDataUrl).length;
      downloadButton.disabled = successCount === 0;
      saveImagesButton.disabled = successCount === 0;
      const missingCount = state.images.length - successCount;
      const pendingCount = state.images.filter(item => item.pendingSave).length;
      setStatus(`处理完成：${successCount} 张成功，${missingCount} 张缺失${pendingCount ? `，${pendingCount} 张待保存` : ''}`, successCount ? 'success' : 'error');
      $('#retry-failed-images').hidden = !state.images.some(item => item.status === 'error' && !item.pendingSave);
      $('#retry-save-images').hidden = pendingCount === 0;
    } finally {
      state.running = false;
      state.paused = false;
      translateButton.disabled = false;
      testButton.disabled = false;
      startBackendButton.disabled = false;
      updatePauseButton();
      renderAigateResources();
      reportTaskStatus(false, state.images.filter(item => item.resultDataUrl).length, state.images.length);
      await saveIndependentTaskRecord(state.sourceKind);
    }
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    updatePauseButton();
    reportTaskStatus(true, Number(progressText.textContent.split('/')[0]) || 0, state.images.length);
    renderAigateResources();
    if (state.paused) {
      setStatus(`正在完成当前图片；完成后暂停（${progressText.textContent}）`, 'info');
    } else {
      setStatus('继续处理章节…', 'success');
    }
  }

  async function testServer() {
    testButton.disabled = true;
    setStatus(state.backendMode === 'aigate' ? '正在检查本地保存桥和 AIGate 服务…' : '正在连接本地后端…');
    try {
      const backend = await ensureBackendAvailable();
      if (!backend) return;
      setStatus(backend.mode === 'aigate'
        ? `AIGate 云端翻译服务和本地保存桥已连接：${backend.endpoint}`
        : '本地 App 核心桥接已连接', 'success');
    } catch (error) {
      state.localBridgeReady = false;
      state.remoteServiceReady = false;
      reportBackendStatus();
      setStatus(`翻译后端连接失败：${error.message}`, 'error');
    } finally {
      testButton.disabled = false;
    }
  }

  async function startBackend({ silent = false } = {}) {
    if (state.running || state.paused || state.externalTaskActive) return;
    let endpoint;
    try {
      endpoint = validateLoopbackEndpoint(endpointInput.value || DEFAULT_ENDPOINT);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }

    startBackendButton.disabled = true;
    testButton.disabled = true;
    if (!silent) setStatus('正在通过本机启动器启动 App 核心桥接…');
    try {
      const response = await nativeMessage({
        action: 'start',
        endpoint,
        outputFolder: state.outputFolder || '',
      });
      if (!response.success) throw new Error(response.error || '本机启动器未能启动后端');
      const infoResponse = await fetch(`${endpoint}/backend_info`, { cache: 'no-store' });
      if (!infoResponse.ok) throw new Error(`启动请求已返回，但服务尚未就绪（HTTP ${infoResponse.status}）`);
      const info = await infoResponse.json();
      if (info?.service !== 'manga-translator-ui' || info?.mode !== 'shared' || info?.protocol !== SHARED_BACKEND_PROTOCOL) {
        throw new Error('进程已响应，但不是预期的 manga-translator-ui 共享服务');
      }
      state.localBridgeReady = true;
      if (!silent) setStatus(response.alreadyRunning ? 'App 核心桥接已经在运行' : 'App 核心桥接已启动，可以开始翻译', 'success');
      reportBackendStatus();
      return true;
    } catch (error) {
      state.localBridgeReady = false;
      reportBackendStatus();
      setStatus(`启动后端失败：${error.message}。请确认已运行 native-host/install-macos.sh。`, 'error');
      return false;
    } finally {
      startBackendButton.disabled = false;
      testButton.disabled = false;
    }
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function downloadTranslatedHtml() {
    const successful = state.images.filter(item => item.resultDataUrl);
    if (!successful.length) return;
    const title = escapeHtml(`${state.htmlTitle || '翻译章节'}（中文）`);
    const images = successful.map(item => `    <img src="${item.resultDataUrl}" alt="${escapeHtml(item.name)}" loading="lazy">`).join('\n');
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#111;color:#eee;text-align:center}main{max-width:1200px;margin:auto}img{display:block;width:auto;max-width:100%;height:auto;margin:0 auto}</style></head>
<body><main>\n${images}\n</main></body></html>`;
    const downloadUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `${state.downloadBaseName}-zh.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  fileInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) loadChapter(file).catch(error => setStatus(`HTML 读取失败：${error.message}`, 'error'));
  });
  ['dragenter', 'dragover'].forEach(type => fileDrop.addEventListener(type, event => {
    event.preventDefault();
    fileDrop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => fileDrop.addEventListener(type, event => {
    event.preventDefault();
    fileDrop.classList.remove('dragging');
  }));
  fileDrop.addEventListener('drop', event => {
    const file = event.dataTransfer.files?.[0];
    if (file) loadChapter(file).catch(error => setStatus(`HTML 读取失败：${error.message}`, 'error'));
  });
  imageFilesInput.addEventListener('change', event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    loadImageFiles(files).catch(error => setStatus(`图片导入失败：${error.message}`, 'error'));
  });
  document.body.addEventListener('dragover', event => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  document.body.addEventListener('drop', event => {
    if (event.target.closest?.('.file-drop')) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    if (files.every(file => /^image\/(png|jpeg|webp)$/i.test(file.type))) {
      loadImageFiles(files).catch(error => setStatus(`图片导入失败：${error.message}`, 'error'));
    } else {
      const html = files.find(file => /\.html?$/i.test(file.name) || file.type === 'text/html');
      if (html) loadChapter(html).catch(error => setStatus(`HTML 读取失败：${error.message}`, 'error'));
      else setStatus('请拖入 PNG、JPEG、WebP 图片或漫画 HTML 文件', 'error');
    }
  });
  outputFolderInput.addEventListener('change', () => {
    if (state.running || state.paused || state.externalTaskActive) {
      outputFolderInput.value = state.outputFolder;
      return;
    }
    state.outputFolder = outputFolderInput.value.trim();
    storageSet({ mangaOutputFolder: state.outputFolder })
      .then(async () => {
        if (!state.taskOutputFolderFromResume) {
          state.taskOutputFolder = state.outputFolder;
          await saveIndependentTaskRecord(state.sourceKind);
        }
      })
      .catch(error => setStatus(`保存目录设置失败：${error.message || error}`, 'error'));
    renderBackendMode();
  });
  pluginBatchSizeInput.addEventListener('change', async () => {
    const previous = state.batchSize;
    const next = normalizePluginBatchSize(pluginBatchSizeInput.value, previous);
    pluginBatchSizeInput.value = String(next);
    pluginBatchSizeStatus.textContent = '保存中…';
    pluginBatchSizeStatus.dataset.kind = 'info';
    try {
      await storageSet({ batch_size: next });
      state.batchSize = next;
      pluginBatchSizeStatus.textContent = '已保存到插件配置';
      pluginBatchSizeStatus.dataset.kind = 'success';
    } catch (error) {
      pluginBatchSizeInput.value = String(previous);
      pluginBatchSizeStatus.textContent = `保存失败：${error.message || error}`;
      pluginBatchSizeStatus.dataset.kind = 'error';
    }
  });
  backendModeInput.addEventListener('change', async () => {
    if (state.running || state.paused || state.externalTaskActive) {
      backendModeInput.value = state.backendMode;
      return;
    }
    renderBackendMode();
    state.logSource = 'current';
    logSourceInput.value = 'current';
    state.localBridgeReady = false;
    state.remoteServiceReady = false;
    reportBackendStatus();
    resetBackendLogCursor();
    await storageSet({ mangaBackendMode: state.backendMode });
    if (state.backendMode === 'local') await probeLocalBridge();
    if (state.backendMode === 'aigate' && state.aigateToken) await refreshAigateResources();
  });
  aigateTokenInput.addEventListener('change', async () => {
    await persistAigateForm();
    renderAigateResources();
  });
  aigateAreaInput.addEventListener('change', async () => {
    await persistAigateForm();
    renderAigateResources();
    if (state.aigateToken) await refreshAigateResources();
  });
  aigateSkuInput.addEventListener('change', async () => {
    state.aigateSkuName = aigateSkuInput.value;
    await persistAigateForm();
  });
  aigateImageInput.addEventListener('change', async () => {
    state.aigateImageId = aigateImageInput.value;
    await persistAigateForm();
  });
  aigateInstanceInput.addEventListener('change', async () => {
    if (state.running || state.paused || state.externalTaskActive) {
      aigateInstanceInput.value = state.aigateInstanceId;
      return;
    }
    const nextInstanceId = aigateInstanceInput.value;
    if (state.aigateInstanceId !== nextInstanceId) {
      state.aigateEndpoint = '';
      state.aigateNonce = '';
    }
    state.aigateInstanceId = nextInstanceId;
    await persistAigateForm();
    renderAigateResources();
    if (state.backendMode === 'aigate') resetBackendLogCursor();
  });
  refreshAigateButton.addEventListener('click', refreshAigateResources);
  createAigateButton.addEventListener('click', createAigateInstance);
  startAigateButton.addEventListener('click', () => startAigateTranslation());
  checkAigateServiceButton.addEventListener('click', () => checkAigateServiceConnectivity());
  stopAigateButton.addEventListener('click', stopAigateInstance);
  releaseAigateButton.addEventListener('click', releaseAigateInstance);
  chooseOutputFolderButton.addEventListener('click', async () => {
    chooseOutputFolderButton.disabled = true;
    try {
      const response = await nativeMessage({ action: 'pickOutputFolder' });
      if (!response.success) {
        if (!response.cancelled) setStatus(response.error || '选择保存目录失败', 'error');
        return;
      }
      state.outputFolder = String(response.outputFolder || '').trim();
      outputFolderInput.value = state.outputFolder;
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ mangaOutputFolder: state.outputFolder }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
      setStatus(`插件保存路径已设置：${state.outputFolder}`, 'success');
    } catch (error) {
      setStatus(`选择保存目录失败：${error.message}`, 'error');
    } finally {
      chooseOutputFolderButton.disabled = false;
    }
  });
  testButton.addEventListener('click', testServer);
  startBackendButton.addEventListener('click', startBackend);
  startLocalServiceButton.addEventListener('click', async () => {
    if (state.running || state.paused || state.externalTaskActive) return;
    startLocalServiceButton.disabled = true;
    testLocalServiceButton.disabled = true;
    setStatus('正在通过本机启动器启动本地服务…');
    try {
      const started = await startBackend({ silent: true });
      await probeLocalBridge();
      if (started && state.localBridgeReady) setStatus('本地服务已启动，可以开始翻译', 'success');
    } finally {
      startLocalServiceButton.disabled = false;
      testLocalServiceButton.disabled = false;
    }
  });
  testLocalServiceButton.addEventListener('click', async () => {
    testLocalServiceButton.disabled = true;
    setStatus('正在连接本地服务…');
    try {
      const connected = await probeLocalBridge();
      setStatus(
        connected ? '本地 App 核心桥接已连接' : '本地服务未连接：可点击“启动本地服务”后再测试',
        connected ? 'success' : 'error',
      );
    } finally {
      testLocalServiceButton.disabled = false;
    }
  });
  pauseTranslationButton.addEventListener('click', togglePause);
  translateButton.addEventListener('click', translateChapter);
  retryFailedButton.addEventListener('click', () => translateChapter({ retryFailed: true }));
  $('#retry-save-images').addEventListener('click', retrySaveImages);
  saveImagesButton.addEventListener('click', saveTranslatedImages);
  downloadButton.addEventListener('click', downloadTranslatedHtml);
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.batch_size) {
      state.batchSize = normalizePluginBatchSize(changes.batch_size.newValue);
      pluginBatchSizeInput.value = String(state.batchSize);
    }
    if (state.running || state.paused || state.externalTaskActive) return;
    let backendChanged = false;
    if (changes.mangaBackendMode) {
      const nextMode = changes.mangaBackendMode.newValue === 'aigate' ? 'aigate' : 'local';
      if (nextMode !== state.backendMode) {
        state.backendMode = nextMode;
        backendModeInput.value = nextMode;
        state.remoteServiceReady = false;
        state.logSource = 'current';
        logSourceInput.value = 'current';
        resetBackendLogCursor();
        backendChanged = true;
      }
    }
    if (changes.mangaOutputFolder) {
      state.outputFolder = String(changes.mangaOutputFolder.newValue || '').trim();
      outputFolderInput.value = state.outputFolder;
      if (!state.taskOutputFolderFromResume) {
        state.taskOutputFolder = state.outputFolder;
        saveIndependentTaskRecord(state.sourceKind).catch(error => setStatus(`更新任务保存目录失败：${error.message || error}`, 'error'));
      }
    }
    if (changes.mangaAigateToken) {
      state.aigateToken = String(changes.mangaAigateToken.newValue || '');
      aigateTokenInput.value = state.aigateToken;
    }
    if (changes.mangaAigateArea) {
      state.aigateArea = String(changes.mangaAigateArea.newValue || '华东一区');
      aigateAreaInput.value = state.aigateArea;
    }
    if (changes.mangaAigateSkuName) state.aigateSkuName = String(changes.mangaAigateSkuName.newValue || '');
    if (changes.mangaAigateImageId) state.aigateImageId = String(changes.mangaAigateImageId.newValue || '');
    if (changes.mangaAigateInstanceId) {
      state.aigateInstanceId = String(changes.mangaAigateInstanceId.newValue || '');
      backendChanged = true;
    }
    if (changes.mangaAigateEndpoint) {
      state.aigateEndpoint = String(changes.mangaAigateEndpoint.newValue || '');
      state.remoteServiceReady = false;
      backendChanged = true;
    }
    if (changes.mangaAigateNonce) {
      state.aigateNonce = String(changes.mangaAigateNonce.newValue || '');
      state.remoteServiceReady = false;
      backendChanged = true;
    }
    renderBackendMode();
    renderAigateResources();
    if (backendChanged) {
      reportBackendStatus();
      if (state.backendMode === 'local') probeLocalBridge();
      if (state.backendMode === 'aigate' && state.view !== 'standalone') resetBackendLogCursor();
    }
  });
  document.querySelectorAll('[data-preview-mode]').forEach(button => button.addEventListener('click', () => {
    state.previewMode = button.dataset.previewMode;
    if (state.selectedImageIndex >= 0) selectPreviewImage(state.selectedImageIndex);
  }));
  logSourceInput.addEventListener('change', () => {
    state.logSource = logSourceInput.value === 'local' ? 'local' : 'current';
    resetBackendLogCursor();
  });
  pauseBackendLogButton.addEventListener('click', () => {
    state.logScrollPaused = !state.logScrollPaused;
    pauseBackendLogButton.textContent = state.logScrollPaused ? '恢复自动滚动' : '暂停滚动';
  });
  clearBackendLogButton.addEventListener('click', () => {
    backendLog.textContent = '';
  });
  toggleBackendLogButton.addEventListener('click', () => {
    const collapsed = logsPanel.dataset.collapsed === 'true';
    logsPanel.dataset.collapsed = collapsed ? 'false' : 'true';
    toggleBackendLogButton.textContent = collapsed ? '隐藏日志' : '显示日志';
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type === 'workbenchVisibility') {
      state.workbenchVisible = Boolean(event.data.visible);
      if (state.workbenchVisible) pollBackendLog();
    } else if (event.data.type === 'workbenchTheme') {
      document.documentElement.dataset.theme = event.data.theme === 'light' ? 'light' : 'dark';
    } else if (event.data.type === 'workbenchTaskStatus') {
      state.externalTaskActive = Boolean(event.data.active && state.view !== 'standalone');
      renderAigateResources();
    }
  });
  endpointInput.value = DEFAULT_ENDPOINT;
  state.outputFolderReady = initializeBackendSettings().catch(error => {
    setAigateStatus(`读取翻译后端设置失败：${error.message || error}`, 'error');
  });
  endpointInput.addEventListener('change', () => {
    endpointInput.value = DEFAULT_ENDPOINT;
    resetBackendLogCursor();
  });
  updatePauseButton();
  setProgress(0, 0);
  if (state.view !== 'standalone') startBackendLogPolling();
  loadCurrentPageData();
})();
