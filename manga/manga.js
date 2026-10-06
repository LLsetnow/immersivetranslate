// 漫画章节翻译页：解析 HTML 图片地址，逐张调用 manga-translator-ui App 核心桥接。
(function () {
  'use strict';

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:5003';
  const SHARED_BACKEND_PROTOCOL = 'manga-translator-ui-shared-v2';
  const SHARED_BACKEND_PROJECT_ROOT = '/Users/apple/Documents/github/manga-translator-ui';
  const AIGATE_TEMP_OUTPUT_FOLDER = '/tmp/immersive-translate-output';
  const TRANSLATE_PATH = '/execute_image/translate';
  const NATIVE_HOST_NAME = 'com.timecyber.immersivetranslate.manga_backend';
  const state = {
    htmlFile: null,
    htmlTitle: '',
    sourceUrl: '',
    downloadBaseName: 'translated-chapter',
    images: [],
    running: false,
    paused: false,
    logOffset: 0,
    logPolling: false,
    logTimer: null,
    outputFolder: '',
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
    refreshingAigateResources: false,
    creatingAigateInstance: false,
    startingAigateTranslation: false,
    checkingAigateConnectivity: false,
    stoppingAigateInstance: false,
    configRevision: '',
    outputFolderReady: Promise.resolve(),
  };

  const $ = selector => document.querySelector(selector);
  const fileInput = $('#chapter-html');
  const fileDrop = $('.file-drop');
  const fileLabel = $('#file-label');
  const imageCount = $('#image-count');
  const chapterTitle = $('#chapter-title');
  const imageGrid = $('#image-grid');
  const endpointInput = $('#server-endpoint');
  const sourceBaseInput = $('#source-base');
  const outputFolderInput = $('#manga-output-folder');
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
  const EIGHTEEN_COMIC_BODY_IMAGE_SELECTOR = '.scramble-page:not(.thewayhome) > img';
  const EIGHTEEN_COMIC_IMAGE_ATTRIBUTES = ['data-original', 'data-src', 'data-lazy-src', 'src'];

  function setStatus(message, kind = 'info') {
    statusText.textContent = message;
    statusText.dataset.kind = kind;
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
    if (shouldStickToBottom) backendLog.scrollTop = backendLog.scrollHeight;
  }

  function filterLogPollingNoise(text) {
    return String(text || '').split('\n')
      .filter(line => !/"GET \/logs\?offset=\d+ HTTP\/1\.[01]"/.test(line))
      .join('\n');
  }

  async function pollBackendLog() {
    if (state.logPolling) return;
    state.logPolling = true;
    const mode = state.backendMode;
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
      if (mode !== state.backendMode) return;
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
      if (document.visibilityState !== 'hidden') pollBackendLog();
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
    card.innerHTML = `
      <div class="image-frame"><img loading="lazy" alt="${item.name}"></div>
      <div class="image-info">
        <div class="image-name" title="${item.name}">${item.name}</div>
        <div class="image-status">等待翻译</div>
      </div>
    `;
    const image = card.querySelector('img');
    image.src = item.url;
    image.addEventListener('error', () => updateImageStatus(index, '源图片无法加载', 'error'));
    return card;
  }

  function updateImageStatus(index, message, kind = '') {
    const card = imageGrid.querySelector(`[data-index="${index}"]`);
    if (!card) return;
    card.classList.remove('processing', 'done', 'error');
    if (kind) card.classList.add(kind);
    card.querySelector('.image-status').textContent = message;
  }

  function renderImages() {
    imageGrid.replaceChildren();
    imageGrid.classList.toggle('empty-state', state.images.length === 0);
    if (!state.images.length) {
      imageGrid.innerHTML = '<div class="empty-icon">▧</div><p>当前内容中没有识别到可翻译图片</p>';
      return;
    }
    state.images.forEach((item, index) => imageGrid.appendChild(makeImageCard(item, index)));
  }

  function loadImageList(urls, title, sourceName = '', sourceUrl = '') {
    state.htmlFile = sourceName ? { name: sourceName } : null;
    state.htmlTitle = title || '翻译章节';
    state.sourceUrl = sourceUrl || '';
    state.taskId = createTaskId(state.sourceUrl || state.htmlTitle, urls);
    state.downloadBaseName = safeDownloadBaseName(sourceName || state.htmlTitle);
    state.images = urls.map((url, index) => ({
      url,
      name: filenameFromUrl(url, index),
      blob: null,
      resultUrl: '',
      resultDataUrl: '',
    }));
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
  }

  async function loadChapter(file) {
    const htmlText = await file.text();
    const parsed = extractImageUrls(htmlText, sourceBaseInput.value);
    loadImageList(parsed.urls, parsed.title, file.name);
  }

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
    if (!(Number(info?.configApiVersion) >= 1)) {
      throw new Error('云端进程可达，但缺少统一配置 API v1；请更新项目并重启服务进程');
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
      || state.stoppingAigateInstance;
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
      item.areaName === state.aigateArea && item.operationStatus !== '4');
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
    startAigateButton.title = '在所选实例中启动或复用翻译服务进程，并等待 HTTP 6006 连通性检查通过';
    checkAigateServiceButton.title = '只检查已运行的实例和翻译服务，不启动实例或服务进程';
  }

  function renderBackendMode() {
    state.backendMode = backendModeInput.value === 'aigate' ? 'aigate' : 'local';
    aigateControls.hidden = state.backendMode !== 'aigate';
    startBackendButton.textContent = state.backendMode === 'aigate'
      ? '启动本地结果保存桥' : '启动 App 核心桥接';
    testButton.textContent = state.backendMode === 'aigate'
      ? '测试云端与保存桥' : '测试 App 核心桥接';
    const note = $('#app-config-note');
    if (note) {
      note.textContent = state.backendMode === 'aigate'
        ? '原图将上传到 AIGate；翻译结果回传后由本机共享服务写入所选目录和缓存清单。本地桥仅提供配置与缓存读写，不会执行本地翻译。云端项目和环境会在实例的 /home/waas 中自动定位。'
        : '本地模式读取本机 manga-translator-ui/config/config.json；此模式不需要 Web 登录，翻译结果保存在所选输出目录。';
    }
  }

  async function initializeBackendSettings() {
    const saved = await storageGet([
      'mangaOutputFolder',
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
    resetBackendLogCursor();
    if (state.backendMode === 'aigate' && state.aigateToken) {
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

  async function refreshAigateResources() {
    if (state.refreshingAigateResources) return;
    state.refreshingAigateResources = true;
    renderAigateResources();
    try {
      await persistAigateForm();
      if (!state.aigateToken) {
        setAigateStatus('请填写 AIGate Bearer Token', 'error');
        return;
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
    } catch (error) {
      setAigateStatus(`读取云扉资源失败：${error.message || error}`, 'error');
    } finally {
      state.refreshingAigateResources = false;
      renderAigateResources();
    }
  }

  async function startAigateTranslation(instanceId) {
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
      const configResult = await sendRuntimeMessage({
        action: 'applyMangaTranslatorConfig',
        reloadLocalConfig: false,
      });
      if (!configResult.success || configResult.backend !== 'aigate') {
        throw new Error(configResult.error || '云端 GPU 配置未确认应用');
      }
      resetBackendLogCursor();
      const backendInfo = await fetchAigateBackendInfo(state.aigateEndpoint, state.aigateNonce);
      setAigateStatus(`${aigateGpuSummary(gpu)} 已就绪，PyTorch/ONNX GPU 配置已应用；HTTP 6006 与配置 API v${backendInfo.configApiVersion} 正常`, 'success');
      return true;
    } catch (error) {
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
      const configResult = await sendRuntimeMessage({
        action: 'applyMangaTranslatorConfig',
        reloadLocalConfig: false,
      });
      if (!configResult.success || configResult.backend !== 'aigate') {
        throw new Error(configResult.error || '云端 GPU 配置未确认应用');
      }
      setAigateStatus(`${aigateGpuSummary(gpu)} 已就绪，GPU 配置已应用 · HTTP 6006 与配置 API v${info.configApiVersion} 正常`, 'success');
      return true;
    } catch (error) {
      setAigateStatus(`云端服务连通性检查失败：${error.message || error}`, 'error');
      return false;
    } finally {
      state.checkingAigateConnectivity = false;
      renderAigateResources();
    }
  }

  async function createAigateInstance() {
    if (state.creatingAigateInstance) return;
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
      || state.stoppingAigateInstance) return;
    const instanceId = String(aigateInstanceInput.value || state.aigateInstanceId || '').trim();
    if (!state.aigateToken || !instanceId) return;
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
      await storageSet({ mangaAigateEndpoint: '', mangaAigateNonce: '' });
      setAigateStatus(`已请求停止实例 ${instanceId}；共享盘数据保留`, 'success');
      await refreshAigateResources();
    } catch (error) {
      setAigateStatus(`停止云扉实例失败：${error.message || error}`, 'error');
    } finally {
      state.stoppingAigateInstance = false;
      renderAigateResources();
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
      if (!localReady && !(await startBackend({ silent: true }))) return false;

      if (mode === 'local') {
        await reloadBackendConfig(localEndpoint);
        return { mode, endpoint: localEndpoint, nonce: '' };
      }

      await reloadBackendConfig(localEndpoint);
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
      return { mode, endpoint: remoteEndpoint, nonce };
    } catch (error) {
      setStatus(`${mode === 'aigate' ? 'AIGate 云端' : '本地'}翻译后端不可用：${error.message}`, 'error');
      return false;
    }
  }

  function loadCurrentPageData() {
    const encoded = new URLSearchParams(window.location.search).get('pageData');
    if (!encoded) return;
    try {
      const pageData = JSON.parse(encoded);
      const urls = Array.isArray(pageData.imageUrls)
        ? pageData.imageUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url))
        : [];
      if (!urls.length) throw new Error('当前网页没有可翻译图片');
      loadImageList(urls, pageData.title || '当前网页章节', pageData.title || '当前网页', pageData.sourceUrl || '');
      history.replaceState({}, document.title, chrome.runtime.getURL('manga/manga.html'));
      if (pageData.autoStart === true) {
        setStatus(`已从当前网页读取 ${urls.length} 张图片，正在准备翻译…`, 'success');
        setTimeout(async () => {
          await state.outputFolderReady;
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

  async function fetchImage(url) {
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
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
    const sourceBlob = await fetchImage(item.url);
    const image = arrayBufferToBase64(await sourceBlob.arrayBuffer());

    updateImageStatus(index, backend.mode === 'aigate'
      ? '正在上传到 AIGate 并翻译…' : '正在 OCR、擦除并排版…', 'processing');
    const response = await fetch(`${backend.endpoint}${TRANSLATE_PATH}`, {
      method: 'POST',
      body: JSON.stringify({
        image,
        filename: item.name,
        imageUrl: item.url,
        taskId: state.taskId,
        pageIndex: index,
        sourceUrl: state.sourceUrl,
        outputFolder: backend.mode === 'local'
          ? (state.outputFolder || undefined)
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
            imageUrl: item.url,
            sourceUrl: state.sourceUrl,
            outputFolder: state.outputFolder || undefined,
          }),
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        },
      );
      if (!saveResponse.ok) {
        const detail = await saveResponse.text();
        throw new Error(`AIGate 已返回译图，但本地保存失败（HTTP ${saveResponse.status}）：${detail.slice(0, 160)}`);
      }
      const saved = await saveResponse.json();
      item.savedPath = saved.path || '';
    }
    const card = imageGrid.querySelector(`[data-index="${index}"]`);
    card.querySelector('img').src = item.resultUrl;
    updateImageStatus(index, backend.mode === 'aigate' ? '翻译完成并保存到本地' : '翻译完成', 'done');
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

  async function translateChapter() {
    if (state.running || !state.images.length) return;
    await state.outputFolderReady;
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
    downloadButton.disabled = true;
    setProgress(0, state.images.length);
      setStatus('开始处理章节…');
    let completed = 0;
    try {
      for (let index = 0; index < state.images.length; index += 1) {
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
      }
      const successCount = state.images.filter(item => item.resultDataUrl).length;
      downloadButton.disabled = successCount === 0;
      setStatus(`章节处理完成：${successCount} / ${state.images.length} 张成功`, successCount ? 'success' : 'error');
    } finally {
      state.running = false;
      state.paused = false;
      translateButton.disabled = false;
      testButton.disabled = false;
      startBackendButton.disabled = false;
      updatePauseButton();
    }
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    updatePauseButton();
    if (state.paused) {
      setStatus(`已暂停：${progressText.textContent}，当前图片完成后停止`, 'info');
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
      setStatus(`翻译后端连接失败：${error.message}`, 'error');
    } finally {
      testButton.disabled = false;
    }
  }

  async function startBackend({ silent = false } = {}) {
    if (state.running) return;
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
      if (!silent) setStatus(response.alreadyRunning ? 'App 核心桥接已经在运行' : 'App 核心桥接已启动，可以开始翻译', 'success');
      return true;
    } catch (error) {
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
  outputFolderInput.addEventListener('change', () => {
    state.outputFolder = outputFolderInput.value.trim();
    chrome.storage.local.set({ mangaOutputFolder: state.outputFolder });
  });
  backendModeInput.addEventListener('change', async () => {
    renderBackendMode();
    resetBackendLogCursor();
    await storageSet({ mangaBackendMode: state.backendMode });
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
  pauseTranslationButton.addEventListener('click', togglePause);
  translateButton.addEventListener('click', translateChapter);
  downloadButton.addEventListener('click', downloadTranslatedHtml);
  clearBackendLogButton.addEventListener('click', () => {
    backendLog.textContent = '';
  });
  toggleBackendLogButton.addEventListener('click', () => {
    const collapsed = logsPanel.dataset.collapsed === 'true';
    logsPanel.dataset.collapsed = collapsed ? 'false' : 'true';
    toggleBackendLogButton.textContent = collapsed ? '隐藏日志' : '显示日志';
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
  startBackendLogPolling();
  loadCurrentPageData();
})();
