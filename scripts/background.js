// 翻译助手 - 后台脚本
// 处理翻译请求和其他后台操作

// MD5函数实现 - 确保在Service Worker中可用
function MD5(string) {
  function rotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  
  function addUnsigned(lX, lY) {
    const lX8 = (lX & 0x80000000);
    const lY8 = (lY & 0x80000000);
    const lX4 = (lX & 0x40000000);
    const lY4 = (lY & 0x40000000);
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) {
      return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    }
    if (lX4 | lY4) {
      if (lResult & 0x40000000) {
        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      } else {
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      }
    } else {
      return (lResult ^ lX8 ^ lY8);
    }
  }
  
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return (x ^ y ^ z); }
  function I(x, y, z) { return (y ^ (x | (~z))); }
  
  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  
  function convertToWordArray(string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  
  function wordToHex(lValue) {
    let WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValue_temp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  
  let x = [];
  let k, AA, BB, CC, DD, a, b, c, d;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  
  string = utf8Encode(string);
  x = convertToWordArray(string);
  a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
  
  for (k = 0; k < x.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  
  const temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
  return temp.toLowerCase();
}

// UTF8编码函数
function utf8Encode(string) {
  string = string.replace(/\r\n/g, "\n");
  let utftext = "";
  
  for (let n = 0; n < string.length; n++) {
    const c = string.charCodeAt(n);
    
    if (c < 128) {
      utftext += String.fromCharCode(c);
    } else if ((c > 127) && (c < 2048)) {
      utftext += String.fromCharCode((c >> 6) | 192);
      utftext += String.fromCharCode((c & 63) | 128);
    } else {
      utftext += String.fromCharCode((c >> 12) | 224);
      utftext += String.fromCharCode(((c >> 6) & 63) | 128);
      utftext += String.fromCharCode((c & 63) | 128);
    }
  }
  
  return utftext;
}

// 调试日志函数
function log(message, data) {
  console.log(`[Background] ${message}`, data !== undefined ? data : '');
}

// 全局变量
let currentTranslator = 'aliyun'; // 默认使用阿里云通用翻译
let translationCache = {}; // 翻译缓存

// 百度凭据仍保留为旧版兼容入口；阿里云凭据只从 storage.local 读取。
// 不要把任何真实密钥写入源码、manifest 或 content script。
const BAIDU_CREDENTIALS = {
  APPID: '',
  SECRET: ''
};

const ALIYUN_STORAGE_KEYS = [
  'aliyunAccessKeyId',
  'aliyunAccessKeySecret'
];

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function getAliyunCredentials() {
  const settings = await storageGet(ALIYUN_STORAGE_KEYS);
  return {
    accessKeyId: (settings.aliyunAccessKeyId || '').trim(),
    accessKeySecret: (settings.aliyunAccessKeySecret || '').trim()
  };
}

function getPublicSettings(settings) {
  return {
    translationMode: settings.translationMode || 'light',
    translationEngine: settings.translationEngine || currentTranslator,
    ollamaEndpoint: settings.ollamaEndpoint || 'http://localhost:11434',
    ollamaModel: settings.ollamaModel || ''
  };
}

// Local app-core bridge. This is the manga-translator-ui shared mode, not its Web UI server.
const MANGA_BACKEND_ENDPOINT = 'http://127.0.0.1:5003';
const MANGA_BACKEND_PROTOCOL = 'manga-translator-ui-shared-v2';
const MANGA_BACKEND_PROJECT_ROOT = '/Users/apple/Documents/github/manga-translator-ui';
const MANGA_AIGATE_TEMP_OUTPUT_FOLDER = '/tmp/immersive-translate-output';
const MANGA_BACKEND_READY_TTL_MS = 30000;
const MANGA_BATCH_WINDOW_SIZE = 10;
let mangaBackendReadyUntil = 0;
let mangaBackendProbePromise = null;
let mangaAigateReadyUntil = 0;
const MANGA_NATIVE_HOST_NAME = 'com.timecyber.immersivetranslate.manga_backend';

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(MANGA_NATIVE_HOST_NAME, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

async function mangaBackendReady() {
  if (Date.now() < mangaBackendReadyUntil) return true;
  if (mangaBackendProbePromise) return mangaBackendProbePromise;
  mangaBackendProbePromise = (async () => {
    try {
      const response = await fetch(`${MANGA_BACKEND_ENDPOINT}/backend_info`, { cache: 'no-store' });
      if (!response.ok) return false;
      const info = await response.json();
      const ready = info?.service === 'manga-translator-ui'
        && info?.mode === 'shared'
        && info?.protocol === MANGA_BACKEND_PROTOCOL
        && Number(info?.configApiVersion) >= 1
        && info?.projectRoot === MANGA_BACKEND_PROJECT_ROOT;
      if (ready) mangaBackendReadyUntil = Date.now() + MANGA_BACKEND_READY_TTL_MS;
      return ready;
    } catch {
      return false;
    } finally {
      mangaBackendProbePromise = null;
    }
  })();
  // A failed probe is not cached; successful probes remain valid for the
  // short TTL above so cache restoration does not issue one identity GET per page.
  return mangaBackendProbePromise;
}

async function ensureMangaBackend(outputFolder = '') {
  if (await mangaBackendReady()) return;
  const response = await sendNativeMessage({
    action: 'start',
    outputFolder: String(outputFolder || '').trim(),
  });
  if (!response.success) {
    throw new Error(response.error || '本地翻译后端启动失败');
  }
  mangaBackendReadyUntil = Date.now() + MANGA_BACKEND_READY_TTL_MS;
}

async function reloadMangaBackendConfig() {
  const response = await fetch(`${MANGA_BACKEND_ENDPOINT}/reload_config`, {
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

async function getMangaTranslationBackend() {
  const settings = await storageGet([
    'mangaBackendMode',
    'mangaAigateEndpoint',
    'mangaAigateNonce',
  ]);
  const mode = settings.mangaBackendMode === 'aigate' ? 'aigate' : 'local';
  if (mode === 'local') {
    return { mode, endpoint: MANGA_BACKEND_ENDPOINT, nonce: '' };
  }

  let endpoint;
  try {
    const parsed = new URL(String(settings.mangaAigateEndpoint || ''));
    if (parsed.protocol !== 'https:'
      || !parsed.hostname.toLowerCase().endsWith('.waas.aigate.cc')
      || parsed.username || parsed.password || parsed.port
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('地址不属于有效的 AIGate HTTP 6006 服务');
    }
    endpoint = parsed.origin;
  } catch (error) {
    throw new Error(error.message || '请先在漫画翻译页连接 AIGate 实例');
  }
  const nonce = String(settings.mangaAigateNonce || '').trim();
  if (nonce.length < 24) throw new Error('AIGate 翻译服务凭据已失效，请重新启动云端服务');
  return { mode, endpoint, nonce };
}

async function ensureMangaTranslationBackend(outputFolder = '', options = {}) {
  await ensureMangaBackend(outputFolder);
  const backend = await getMangaTranslationBackend();
  if (backend.mode === 'local') {
    if (options.reloadLocalConfig) await reloadMangaBackendConfig();
    return backend;
  }
  if (options.reloadLocalConfig) await reloadMangaBackendConfig();
  if (!options.verifyCloud && Date.now() < mangaAigateReadyUntil) return backend;
  mangaAigateReadyUntil = 0;

  let response;
  try {
    response = await fetch(`${backend.endpoint}/backend_info`, {
      headers: { 'X-Nonce': backend.nonce },
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error(`AIGate 翻译服务不可访问：${error.message || error}`);
  }
  if (!response.ok) throw new Error(`AIGate 翻译服务返回 HTTP ${response.status}`);
  const info = await response.json();
  if (info?.service !== 'manga-translator-ui'
    || info?.mode !== 'shared'
    || info?.protocol !== MANGA_BACKEND_PROTOCOL
    || !(Number(info?.configApiVersion) >= 1)) {
    throw new Error('AIGate 实例未运行支持统一配置的 manga-translator-ui 共享服务；请更新云端项目后重启服务');
  }
  mangaAigateReadyUntil = Date.now() + MANGA_BACKEND_READY_TTL_MS;
  return backend;
}

async function saveMangaTranslationLocally({
  taskId,
  pageIndex,
  sourceUrl,
  imageUrl,
  filename,
  imageBytes,
  outputFolder,
}) {
  if (!taskId || !Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const response = await fetch(
    `${MANGA_BACKEND_ENDPOINT}/cache/task/${encodeURIComponent(taskId)}/image/${pageIndex}`,
    {
      method: 'POST',
      body: JSON.stringify({
        image: typeof imageBytes === 'string' ? imageBytes : arrayBufferToBase64(imageBytes),
        filename: filename || `page-${pageIndex + 1}.png`,
        imageUrl: imageUrl || '',
        sourceUrl: normaliseMangaSourceUrl(sourceUrl || ''),
        outputFolder: outputFolder || undefined,
      }),
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`翻译结果已返回，但本地保存失败（HTTP ${response.status}）：${detail.slice(0, 180)}`);
  }
  return response.json();
}

function normaliseMangaSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '').trim().slice(0, 4000);
  }
}

async function getMangaOutputFolder() {
  const settings = await storageGet(['mangaOutputFolder']);
  return String(settings.mangaOutputFolder || '').trim();
}

async function getMangaTranslatorConfig() {
  const stored = await storageGet(['mangaTranslatorConfig']);
  if (stored.mangaTranslatorConfig && typeof stored.mangaTranslatorConfig === 'object'
    && !Array.isArray(stored.mangaTranslatorConfig)) {
    return stored.mangaTranslatorConfig;
  }

  const response = await sendNativeMessage({ action: 'readMangaConfig' });
  if (!response.success || !response.config || typeof response.config !== 'object'
    || Array.isArray(response.config)) {
    throw new Error(response.error || '没有统一漫画翻译配置；请先导入配置文件或读取本机配置');
  }
  await storageSet({ mangaTranslatorConfig: response.config });
  return response.config;
}

async function applyMangaTranslatorConfig(backend) {
  const savedConfig = await getMangaTranslatorConfig();
  // Cloud translation must not inherit a local CPU-only preference. Keep the
  // saved config untouched so switching back to local mode preserves it.
  const config = backend.mode === 'aigate'
    ? JSON.parse(JSON.stringify(savedConfig))
    : savedConfig;
  if (backend.mode === 'aigate') {
    config.cli = config.cli && typeof config.cli === 'object' && !Array.isArray(config.cli)
      ? config.cli
      : {};
    config.cli.use_gpu = true;
    config.cli.disable_onnx_gpu = false;
  }
  let response;
  try {
    response = await fetch(`${backend.endpoint}/config/apply`, {
      method: 'POST',
      body: JSON.stringify({ config }),
      headers: {
        'Content-Type': 'application/json',
        ...(backend.mode === 'aigate' ? { 'X-Nonce': backend.nonce } : {}),
      },
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error(`发送漫画翻译配置失败：${error.message || error}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 404) {
      throw new Error('当前 manga-translator-ui 服务不支持统一配置接口，请更新本地/云端项目并重启共享服务');
    }
    throw new Error(`应用漫画翻译配置失败（HTTP ${response.status}）：${detail.slice(0, 240)}`);
  }
  const result = await response.json();
  if (!result.success || !result.revision) throw new Error('翻译后端没有确认配置版本');
  return result;
}

async function rememberMangaTask(sourceUrl, taskId, imageCount) {
  const key = normaliseMangaSourceUrl(sourceUrl);
  if (!key || !taskId) return;
  const stored = await storageGet(['mangaTaskMap']);
  const map = stored.mangaTaskMap && typeof stored.mangaTaskMap === 'object'
    ? { ...stored.mangaTaskMap }
    : {};
  map[key] = { taskId: String(taskId), imageCount: Number(imageCount) || 0, updatedAt: Date.now() };
  const recent = Object.entries(map)
    .sort((left, right) => (right[1]?.updatedAt || 0) - (left[1]?.updatedAt || 0))
    .slice(0, 100);
  await storageSet({ mangaTaskMap: Object.fromEntries(recent) });
}

async function getMangaCache(taskId, sourceUrl, imageUrls) {
  if (!taskId) return { success: true, found: false, pages: [] };
  const outputFolder = await getMangaOutputFolder();
  const sourceKey = normaliseMangaSourceUrl(sourceUrl);
  const stored = await storageGet(['mangaTaskMap']);
  const existingTask = stored.mangaTaskMap?.[sourceKey]?.taskId || '';
  await rememberMangaTask(sourceUrl, taskId, imageUrls.length);
  if (!(await mangaBackendReady())) {
    // The browser map is only a fast path. Older tasks, imported-page tasks,
    // and mappings lost during extension updates can still have a valid disk
    // manifest, so probe the selected output directory before giving up.
    let shouldStartBackend = existingTask && existingTask === taskId;
    if (!shouldStartBackend) {
      try {
        const probe = await sendNativeMessage({
          action: 'hasMangaCache',
          taskId,
          outputFolder,
          sourceUrl,
        });
        shouldStartBackend = Boolean(probe?.success && probe.found);
      } catch {
        shouldStartBackend = false;
      }
    }
    if (shouldStartBackend) {
      await ensureMangaBackend(outputFolder);
    } else {
      return { success: true, found: false, pages: [], backendUnavailable: true };
    }
  }
  const query = new URLSearchParams({
    outputFolder,
    sourceUrl: normaliseMangaSourceUrl(sourceUrl),
  });
  const response = await fetch(
    `${MANGA_BACKEND_ENDPOINT}/cache/task/${encodeURIComponent(taskId)}/manifest?${query.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`读取翻译缓存失败（HTTP ${response.status}）`);
  const cache = await response.json();
  return {
    success: true,
    ...cache,
  };
}

async function getMangaCachedImage(taskId, pageIndex, sourceUrl = '') {
  const outputFolder = await getMangaOutputFolder();
  await ensureMangaBackend(outputFolder);
  const query = new URLSearchParams({
    outputFolder,
    sourceUrl: normaliseMangaSourceUrl(sourceUrl),
  });
  const response = await fetch(
    `${MANGA_BACKEND_ENDPOINT}/cache/task/${encodeURIComponent(taskId)}/image/${encodeURIComponent(pageIndex)}?${query.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`读取缓存图片失败（HTTP ${response.status}）`);
  const data = await response.arrayBuffer();
  return {
    success: true,
    mimeType: response.headers.get('content-type') || 'image/png',
    data: arrayBufferToBase64(data),
    encoding: 'base64',
  };
}

function decodeStreamJson(bytes) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
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

async function readMangaImageStream(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('浏览器不支持读取翻译流');
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let resultBytes = null;

  function append(left, right) {
    const merged = new Uint8Array(left.byteLength + right.byteLength);
    merged.set(left);
    merged.set(right, left.byteLength);
    return merged;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (value && value.byteLength) buffer = append(buffer, value);

    while (buffer.byteLength >= 5) {
      const status = buffer[0];
      const length = (buffer[1] * 0x1000000)
        + (buffer[2] * 0x10000)
        + (buffer[3] * 0x100)
        + buffer[4];
      if (length > 256 * 1024 * 1024) {
        throw new Error('翻译后端返回了过大的图片帧');
      }
      if (buffer.byteLength < 5 + length) break;
      const payload = buffer.slice(5, 5 + length);
      buffer = buffer.slice(5 + length);

      if (status === 0) {
        resultBytes = payload;
      } else if (status === 2) {
        const error = decodeStreamJson(payload);
        throw new Error(error?.error || '翻译后端处理失败');
      } else if (status !== 1) {
        throw new Error(`翻译后端返回了未知状态：${status}`);
      }
    }

    if (done) break;
  }

  if (buffer.byteLength) throw new Error('翻译后端返回了不完整的数据帧');
  if (!resultBytes?.byteLength) throw new Error('翻译后端没有返回图片');
  return resultBytes;
}

async function readMangaBatchStream(response, onEvent) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('浏览器不支持读取批量翻译流');
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let receivedDone = false;

  function append(left, right) {
    const merged = new Uint8Array(left.byteLength + right.byteLength);
    merged.set(left);
    merged.set(right, left.byteLength);
    return merged;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (value && value.byteLength) buffer = append(buffer, value);

    while (buffer.byteLength >= 5) {
      const status = buffer[0];
      const length = (buffer[1] * 0x1000000)
        + (buffer[2] * 0x10000)
        + (buffer[3] * 0x100)
        + buffer[4];
      if (length > 256 * 1024 * 1024) {
        throw new Error('翻译后端返回了过大的批量帧');
      }
      if (buffer.byteLength < 5 + length) break;
      const payload = buffer.slice(5, 5 + length);
      buffer = buffer.slice(5 + length);

      if (status === 1) {
        await onEvent({ type: 'progress', text: new TextDecoder().decode(payload) });
      } else if (status === 0 || status === 2 || status === 3) {
        const event = decodeStreamJson(payload);
        if (!event) throw new Error('翻译后端返回了无效的批量事件');
        if (status === 2) {
          await onEvent({ type: 'error', ...event });
        } else {
          await onEvent(event);
        }
        if (status === 3 || event.type === 'done') receivedDone = true;
      } else {
        throw new Error(`翻译后端返回了未知状态：${status}`);
      }
    }

    if (done) break;
  }

  if (buffer.byteLength) throw new Error('翻译后端返回了不完整的批量数据帧');
  if (!receivedDone) throw new Error('翻译后端未发送批量完成事件');
}

function postMangaBatchMessage(port, message) {
  if (!port) return false;
  try {
    port.postMessage(message);
    return true;
  } catch (error) {
    // The page can navigate away while the local translator is still working.
    // Do not turn a normal port teardown into an unhandled background error.
    console.warn('[漫画翻译] 页面端口已断开，停止回传批量结果:', error?.message || error);
    return false;
  }
}

function postMangaBatchEvent(port, event) {
  if (!port) return false;
  if (event.type === 'result') {
    return postMangaBatchMessage(port, {
      action: 'mangaBatchImage',
      ...event,
      data: event.data,
      encoding: 'base64',
    });
  }
  if (event.type === 'error') {
    return postMangaBatchMessage(port, { action: 'mangaBatchImageError', ...event });
  }
  if (event.type === 'skipped') {
    return postMangaBatchMessage(port, { action: 'mangaBatchImageSkipped', ...event });
  }
  if (event.type === 'done') {
    return postMangaBatchMessage(port, { action: 'mangaBatchDone', ...event });
  }
  return true;
}

async function translateMangaBatchInBackground(entries, sourceUrl, taskId, batchSize, port) {
  if (entries.length > MANGA_BATCH_WINDOW_SIZE) {
    throw new Error(`单次批量翻译最多支持 ${MANGA_BATCH_WINDOW_SIZE} 张图片`);
  }
  const outputFolder = await getMangaOutputFolder();
  await rememberMangaTask(sourceUrl, taskId, entries.length);
  const backend = await ensureMangaTranslationBackend(outputFolder, { reloadLocalConfig: true });
  const appliedConfig = await applyMangaTranslatorConfig(backend);

  const fetched = await Promise.all(entries.map(async entry => {
    try {
      if (!/^https?:\/\//i.test(entry.url)) throw new Error('图片地址不是 HTTP/HTTPS');
      const response = await fetch(entry.url, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error(`下载原图失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('下载到空图片');
      return {
        ok: true,
        entry,
        image: arrayBufferToBase64(await blob.arrayBuffer()),
      };
    } catch (error) {
      return { ok: false, entry, error: error.message || String(error) };
    }
  }));

  const validEntries = [];
  fetched.forEach(item => {
    if (item.ok) {
      validEntries.push({
        image: item.image,
        filename: item.entry.filename,
        imageUrl: item.entry.url,
        pageIndex: item.entry.pageIndex,
      });
    } else {
      if (!postMangaBatchEvent(port, {
        type: 'error',
        taskId,
        pageIndex: item.entry.pageIndex,
        filename: item.entry.filename,
        error: item.error,
        stage: 'download',
      })) {
        throw new Error('漫画翻译页面已离开，停止回传批量结果');
      }
    }
  });

  if (!validEntries.length) {
    if (!postMangaBatchEvent(port, {
      type: 'done',
      taskId,
      success: false,
      processed: 0,
      total: entries.length,
    })) {
      throw new Error('漫画翻译页面已离开，停止回传批量结果');
    }
    return;
  }

  const response = await fetch(`${backend.endpoint}/execute_image/batch_translate`, {
    method: 'POST',
    body: JSON.stringify({
      images: validEntries,
      taskId,
      sourceUrl: normaliseMangaSourceUrl(sourceUrl),
      outputFolder: backend.mode === 'local'
        ? (outputFolder || undefined)
        : MANGA_AIGATE_TEMP_OUTPUT_FOLDER,
      batchSize,
      configRevision: appliedConfig.revision,
    }),
    headers: {
      'Content-Type': 'application/json',
      ...(backend.mode === 'aigate' ? { 'X-Nonce': backend.nonce } : {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`App 批量翻译桥接失败（HTTP ${response.status}）：${detail.slice(0, 240)}`);
  }

  if (backend.mode === 'local') {
    await readMangaBatchStream(response, event => {
      if (!postMangaBatchEvent(port, event)) {
        throw new Error('漫画翻译页面已离开，停止回传批量结果');
      }
    });
    return;
  }

  await readMangaBatchStream(response, async event => {
    if (event.type === 'result') {
      try {
        const saved = await saveMangaTranslationLocally({
          taskId,
          pageIndex: Number(event.pageIndex),
          sourceUrl,
          imageUrl: validEntries.find(entry => entry.pageIndex === Number(event.pageIndex))?.imageUrl || '',
          filename: event.filename,
          imageBytes: event.data,
          outputFolder,
        });
        event.savedPath = saved?.path || '';
      } catch (error) {
        event.type = 'error';
        event.error = error.message || String(error);
        event.stage = 'local-save';
        delete event.data;
      }
    }
    if (!postMangaBatchEvent(port, event)) {
      throw new Error('漫画翻译页面已离开，停止回传批量结果');
    }
  });
}

async function translateMangaImageInBackground(url, filename, options = {}) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('只支持翻译 HTTP/HTTPS 图片');
  }

  const outputFolder = await getMangaOutputFolder();
  if (options.sourceUrl && options.taskId) {
    await rememberMangaTask(options.sourceUrl, options.taskId, 1);
  }
  const backend = await ensureMangaTranslationBackend(outputFolder, {
    reloadLocalConfig: options.reloadConfig === true,
  });
  const appliedConfig = await applyMangaTranslatorConfig(backend);
  const sourceResponse = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!sourceResponse.ok) {
    throw new Error(`下载原图失败（HTTP ${sourceResponse.status}）`);
  }
  const sourceBlob = await sourceResponse.blob();
  if (!sourceBlob.size) throw new Error('下载到空图片');

  const imageBase64 = arrayBufferToBase64(await sourceBlob.arrayBuffer());
  const response = await fetch(`${backend.endpoint}/execute_image/translate`, {
    method: 'POST',
    body: JSON.stringify({
      image: imageBase64,
      filename: filename || 'manga-page.webp',
      imageUrl: url,
      taskId: options.taskId || '',
      pageIndex: Number.isInteger(options.pageIndex) ? options.pageIndex : undefined,
      sourceUrl: normaliseMangaSourceUrl(options.sourceUrl || ''),
      outputFolder: backend.mode === 'local'
        ? (outputFolder || undefined)
        : MANGA_AIGATE_TEMP_OUTPUT_FOLDER,
      configRevision: appliedConfig.revision,
    }),
    headers: {
      'Content-Type': 'application/json',
      ...(backend.mode === 'aigate' ? { 'X-Nonce': backend.nonce } : {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`App 翻译桥接失败（HTTP ${response.status}）：${detail.slice(0, 180)}`);
  }

  const resultBytes = await readMangaImageStream(response);
  let savedPath = '';
  if (backend.mode === 'aigate' && options.taskId && Number.isInteger(options.pageIndex)) {
    const saved = await saveMangaTranslationLocally({
      taskId: options.taskId,
      pageIndex: options.pageIndex,
      sourceUrl: options.sourceUrl || '',
      imageUrl: url,
      filename: filename || 'manga-page.webp',
      imageBytes: resultBytes,
      outputFolder,
    });
    savedPath = saved?.path || '';
  }
  return {
    success: true,
    mimeType: 'image/png',
    data: arrayBufferToBase64(resultBytes),
    encoding: 'base64',
    savedPath,
  };
}

// Ollama翻译功能
async function ollamaTranslate(text, from = 'auto', to = 'zh') {
  try {
    console.log('🚀 [Ollama翻译] 开始翻译', {
      原文预览: text.substring(0, 50) + (text.length > 50 ? '...' : '')
    });
    
    // 获取Ollama设置
    const { ollamaEndpoint, ollamaModel } = await new Promise((resolve) => {
      chrome.storage.local.get(['ollamaEndpoint', 'ollamaModel'], resolve);
    });
    
    console.log('📝 [Ollama翻译] 使用配置:', { 
      endpoint: ollamaEndpoint || 'http://localhost:11434',
      model: ollamaModel || '未指定模型'
    });
    
    // 检查必要参数
    if (!ollamaEndpoint) {
      throw new Error('未设置Ollama API地址');
    }
    
    if (!ollamaModel) {
      throw new Error('未指定Ollama模型');
    }
    
    // 构建请求体
    let prompt;
    if (to === 'zh' || to === 'zh-CN' || to === 'zh-Hans') {
      // 翻译为中文
      prompt = `请将以下${from !== 'auto' && from !== 'zh' ? from + '语言的' : ''}文本翻译成中文，只返回翻译结果，不要包含原文，不要有任何前缀说明:\n\n${text}`;
    } else if (to === 'en') {
      // 翻译为英文
      prompt = `Please translate the following ${from !== 'auto' && from !== 'en' ? from + ' ' : ''}text to English. Only return the translation result without including the original text or any prefixes:\n\n${text}`;
    } else {
      // 翻译为其他语言
      prompt = `Please translate the following text to ${to} language. Only return the translation result without including the original text or any prefixes:\n\n${text}`;
    }
    
    // 创建可取消的请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
    
    try {
      console.log(`📤 [Ollama翻译] 发送请求到 ${ollamaEndpoint}/api/generate，模型: ${ollamaModel}`);
      
      // 发送请求到Ollama API
      const response = await fetch(`${ollamaEndpoint}/api/generate`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: prompt,
          stream: false
        })
      });
      
      // 清除超时
      clearTimeout(timeoutId);
      
      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Ollama翻译] 响应错误:', { 
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        
        // 判断错误类型
        if (response.status === 404) {
          throw new Error(`Ollama模型 "${ollamaModel}" 不存在，请确认模型名称或拉取模型`);
        } else if (response.status === 500) {
          throw new Error(`Ollama服务器错误: ${errorText}`);
        } else if (response.status === 400) {
          throw new Error(`请求格式错误: ${errorText}`);
        } else {
          throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
        }
      }
      
      // 处理响应
      const data = await response.json();
      console.log('📥 [Ollama翻译] 收到响应:', data);
      
      if (data.response) {
        // 清理响应文本
        let translation = data.response.trim();
        
        // 移除常见的前缀
        const prefixesToRemove = [
          '翻译结果：', '翻译:', '翻译：', '译文：', '译文:', 
          'Translation:', 'Translated text:', 'Result:',
          '以下是翻译：', '以下是中文翻译：'
        ];
        
        for (const prefix of prefixesToRemove) {
          if (translation.startsWith(prefix)) {
            translation = translation.substring(prefix.length).trim();
            break;
          }
        }
        
        console.log('✅ [Ollama翻译] 翻译成功', {
          原文预览: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
          译文预览: translation.substring(0, 50) + (translation.length > 50 ? '...' : '')
        });
        
        return translation;
      } else {
        throw new Error('Ollama API返回的响应中没有翻译结果');
      }
    } catch (fetchError) {
      // 清除超时
      clearTimeout(timeoutId);
      
      // 处理不同类型的错误
      if (fetchError.name === 'AbortError') {
        throw new Error('Ollama翻译请求超时，请检查模型是否正在运行');
      } else if (fetchError.message.includes('Failed to fetch') || 
                fetchError.message.includes('Network request failed')) {
        throw new Error('无法连接到Ollama服务，请确保Ollama正在运行并且API地址正确');
      } else {
        throw fetchError;
      }
    }
  } catch (error) {
    console.error('❌ [Ollama翻译] 翻译过程中出错:', error);
    throw error;
  }
}

// 初始化函数
function initialize() {
  log('初始化后台脚本...');
  
  // 加载保存的设置
  return new Promise((resolve) => {
    chrome.storage.local.get(['preferred_translator', 'translationEngine'], function(result) {
      if (chrome.runtime.lastError) {
        log('加载设置时出错:', chrome.runtime.lastError);
        resolve();
        return;
      }

      // 优先使用translationEngine，然后是preferred_translator
      if (result.translationEngine) {
        currentTranslator = result.translationEngine;
        log('使用translationEngine设置:', currentTranslator);
      } else if (result.preferred_translator) {
        currentTranslator = result.preferred_translator;
        log('使用preferred_translator设置:', currentTranslator);
        // 同步到translationEngine
        chrome.storage.local.set({ 'translationEngine': currentTranslator });
      } else {
        // 保存默认设置到两个键
        chrome.storage.local.set({ 
          'preferred_translator': currentTranslator,
          'translationEngine': currentTranslator
        });
        log('保存默认翻译器设置:', currentTranslator);
      }
      
      resolve();
    });
  });
}

// 百度翻译API实现
async function baiduTranslate(text, from = 'auto', to = 'zh') {
  try {
    console.log('🔄 [百度翻译] 开始翻译...', {
      文本长度: text.length,
      原文预览: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      源语言: from,
      目标语言: to
    });

    const salt = Date.now().toString();
    const appid = BAIDU_CREDENTIALS.APPID;
    const key = BAIDU_CREDENTIALS.SECRET;
    
    // 检查API凭据
    if (!appid || appid.trim() === '' || !key || key.trim() === '') {
      throw new Error('百度翻译API凭据无效或未配置');
    }
    
    const sign = MD5(appid + text + salt + key);
    
    const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
    const params = new URLSearchParams({
      q: text,
      from: from,
      to: to,
      appid: appid,
      salt: salt,
      sign: sign
    });
    
    log('发送百度翻译请求:', { text: text.substring(0, 30) + (text.length > 30 ? '...' : ''), from, to });
    
    // 创建AbortController用于请求超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    try {
      // 使用fetch API带超时控制
      const response = await fetch(`${url}?${params.toString()}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      // 清除超时计时器
      clearTimeout(timeoutId);
      
      // 检查响应状态
      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error_code) {
        console.error('❌ [百度翻译] 翻译失败:', data.error_msg);
        throw new Error(`百度翻译错误: ${data.error_code} - ${data.error_msg}`);
      }
      
      if (data.trans_result && data.trans_result.length > 0) {
        const translations = data.trans_result.map(item => item.dst);
        console.log('✅ [百度翻译] 翻译成功', {
          原文预览: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
          译文预览: translations[0].substring(0, 50) + (translations[0].length > 50 ? '...' : '')
        });
        return translations.join('\n');
      } else {
        throw new Error('百度翻译返回结果格式错误');
      }
    } catch (fetchError) {
      // 清除超时计时器，以防它尚未触发
      clearTimeout(timeoutId);
      
      // 处理不同类型的网络错误
      if (fetchError.name === 'AbortError') {
        throw new Error('百度翻译API请求超时');
      } else if (fetchError.message.includes('Failed to fetch') || 
                 fetchError.message.includes('Network request failed')) {
        throw new Error('网络连接失败，无法连接到百度翻译API');
      } else {
        throw fetchError; // 重新抛出其他错误ba
      }
    }
  } catch (error) {
    console.error('❌ [百度翻译] 发生错误:', error.message);
    throw error;
  }
}

// 阿里云翻译实现已统一到下方的 TranslateGeneral 版本。

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createSignatureNonce() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatAliyunTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function hmacSha1Base64(message, secret) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('当前浏览器不支持 Web Crypto，无法生成阿里云签名');
  }

  const encoder = new TextEncoder();
  const key = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await cryptoApi.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// 阿里云机器翻译通用版 API（TranslateGeneral）。凭据只从 storage.local 读取。
async function aliyunTranslate(text, from = 'auto', to = 'zh', credentialOverride = null) {
  if (!text || text.length > 5000) {
    throw new Error('阿里云通用翻译单次最多支持5000个字符');
  }

  const credentials = credentialOverride || await getAliyunCredentials();
  const { accessKeyId, accessKeySecret } = credentials;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('尚未配置阿里云 AccessKey ID 和 AccessKey Secret，请打开扩展设置');
  }

  const apiUrl = 'https://mt.cn-hangzhou.aliyuncs.com';
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'TranslateGeneral',
    Format: 'JSON',
    FormatType: 'text',
    Scene: 'general',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: createSignatureNonce(),
    SignatureVersion: '1.0',
    SourceLanguage: from || 'auto',
    SourceText: text,
    TargetLanguage: to || 'zh',
    Timestamp: formatAliyunTimestamp(),
    Version: '2018-10-12'
  };

  const canonicalizedQueryString = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`;
  const signature = await hmacSha1Base64(stringToSign, `${accessKeySecret}&`);
  const requestBody = `${canonicalizedQueryString}&Signature=${percentEncode(signature)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json'
      },
      body: requestBody
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`阿里云翻译返回了非 JSON 响应（HTTP ${response.status}）`);
    }

    if (!response.ok) {
      const message = data.Message || data.message || response.statusText;
      throw new Error(`阿里云翻译请求失败（HTTP ${response.status}）：${message}`);
    }

    const result = data.TranslateGeneralResponse || data;
    const code = Number(result.Code);
    if (code !== 200) {
      throw new Error(`阿里云翻译错误：${result.Code || '未知错误'} - ${result.Message || '请检查服务权限和计费状态'}`);
    }

    const translated = result.Data && result.Data.Translated;
    if (!translated) {
      throw new Error('阿里云翻译返回结果中没有译文');
    }
    return translated;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('阿里云翻译请求超时');
    }
    if (error.message.includes('Failed to fetch') || error.message.includes('Network request failed')) {
      throw new Error('无法连接阿里云翻译服务，请检查网络和扩展权限');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'manga-batch') return;

  port.onMessage.addListener(request => {
    if (request.action === 'mangaBatchKeepAlive') return;
    if (request.action !== 'translateMangaBatchInPage') return;
    if (!postMangaBatchMessage(port, { action: 'mangaBatchStarted', taskId: request.taskId })) return;
    translateMangaBatchInBackground(
      Array.isArray(request.entries) ? request.entries : [],
      request.sourceUrl || '',
      request.taskId || '',
      Math.max(1, Math.min(Number(request.batchSize) || MANGA_BATCH_WINDOW_SIZE, MANGA_BATCH_WINDOW_SIZE)),
      port,
    ).catch(error => {
      postMangaBatchMessage(port, {
        action: 'mangaBatchFailed',
        error: error.message || String(error),
      });
    });
  });
});

const MANGA18_NEXT_INTENT_STORAGE_PREFIX = 'manga18NextChapterIntentForTab:';
const MANGA18_NEXT_INTENT_TTL_MS = 10 * 60 * 1000;

function getManga18ChapterRouteFromSender(sender) {
  try {
    const pageUrl = new URL(sender.url || sender.tab?.url || '');
    const hostname = pageUrl.hostname.toLowerCase();
    if (hostname !== 'manga18.club' && !hostname.endsWith('.manga18.club')) return null;
    const match = pageUrl.pathname.match(/^(\/manhwa\/[^/]+\/chapter-)(\d+)(\/?)$/i);
    if (!match) return null;
    const chapterNumber = Number(match[2]);
    if (!Number.isSafeInteger(chapterNumber)) return null;
    return {
      seriesPath: match[1].replace(/chapter-$/i, '').toLowerCase(),
      chapterNumber,
    };
  } catch {
    return null;
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[后台脚本] 收到消息:', request.action, request.messageId || '');

  if (request.action === 'armManga18NextChapterIntent') {
    const tabId = sender.tab?.id;
    const currentRoute = getManga18ChapterRouteFromSender(sender);
    const seriesPath = String(request.seriesPath || '').toLowerCase();
    const chapterNumber = Number(request.chapterNumber);
    if (!Number.isInteger(tabId)
      || !currentRoute
      || currentRoute.seriesPath !== seriesPath
      || !Number.isSafeInteger(chapterNumber)
      || chapterNumber !== currentRoute.chapterNumber + 1) {
      sendResponse({ success: false, error: '只支持从 manga18.club 当前章节启动下一话翻译' });
      return false;
    }

    const key = `${MANGA18_NEXT_INTENT_STORAGE_PREFIX}${tabId}`;
    chrome.storage.local.set({
      [key]: { seriesPath, chapterNumber, createdAt: Date.now() },
    }, () => {
      const error = chrome.runtime.lastError;
      sendResponse(error
        ? { success: false, error: error.message }
        : { success: true });
    });
    return true;
  }

  if (request.action === 'consumeManga18NextChapterIntent') {
    const tabId = sender.tab?.id;
    const currentRoute = getManga18ChapterRouteFromSender(sender);
    if (!Number.isInteger(tabId) || !currentRoute) {
      sendResponse({ success: true, autoTranslate: false });
      return false;
    }

    const key = `${MANGA18_NEXT_INTENT_STORAGE_PREFIX}${tabId}`;
    chrome.storage.local.get(key, stored => {
      const intent = stored[key];
      const createdAt = Number(intent?.createdAt);
      const ageMs = Date.now() - createdAt;
      const autoTranslate = ageMs >= 0
        && ageMs <= MANGA18_NEXT_INTENT_TTL_MS
        && String(intent?.seriesPath || '').toLowerCase() === currentRoute.seriesPath
        && Number(intent?.chapterNumber) === currentRoute.chapterNumber
        && currentRoute.seriesPath === String(request.seriesPath || '').toLowerCase()
        && currentRoute.chapterNumber === Number(request.chapterNumber);
      chrome.storage.local.remove(key, () => {
        const error = chrome.runtime.lastError;
        sendResponse(error
          ? { success: false, error: error.message }
          : { success: true, autoTranslate });
      });
    });
    return true;
  }
  
  // 侧边栏翻译按钮发送的ping请求
  if (request.action === 'ping') {
    console.log('[后台脚本] 收到ping请求，回复成功');
    sendResponse({ success: true, message: "后台脚本正在运行" });
    return true;
  }

  if (request.action === 'getSettings') {
    storageGet(['translationMode', 'translationEngine', 'ollamaEndpoint', 'ollamaModel'])
      .then(settings => sendResponse({ success: true, settings: getPublicSettings(settings) }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'prepareMangaTranslation') {
    getMangaOutputFolder()
      .then(outputFolder => ensureMangaTranslationBackend(outputFolder, {
        reloadLocalConfig: true,
        verifyCloud: true,
      }))
      .then(backend => sendResponse({ success: true, backend: backend.mode }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'applyMangaTranslatorConfig') {
    (async () => {
      const outputFolder = await getMangaOutputFolder();
      const backend = await ensureMangaTranslationBackend(outputFolder, {
        reloadLocalConfig: request.reloadLocalConfig !== false,
        verifyCloud: true,
      });
      const result = await applyMangaTranslatorConfig(backend);
      sendResponse({
        success: true,
        backend: backend.mode,
        revision: result.revision,
        changed: result.changed,
        persisted: result.persisted,
      });
    })().catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (request.action === 'getMangaCache') {
    const imageUrls = Array.isArray(request.imageUrls) ? request.imageUrls : [];
    getMangaCache(request.taskId, request.sourceUrl, imageUrls)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getMangaCachedImage') {
    getMangaCachedImage(request.taskId, request.pageIndex, request.sourceUrl)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'translateMangaImageInPage') {
    translateMangaImageInBackground(request.url, request.filename, request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'openMangaTranslatorFromPage') {
    const page = request.page || {};
    const imageUrls = Array.isArray(page.imageUrls)
      ? page.imageUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url)).slice(0, 100)
      : [];
    if (!imageUrls.length) {
      sendResponse({ success: false, error: '当前网页没有可翻译图片' });
      return true;
    }
      const pageData = {
        title: String(page.title || '当前网页章节').slice(0, 200),
        sourceUrl: String(page.sourceUrl || '').slice(0, 2000),
        imageUrls,
        autoStart: true,
      };
    const targetUrl = `${chrome.runtime.getURL('manga/manga.html')}?pageData=${encodeURIComponent(JSON.stringify(pageData))}`;
    chrome.tabs.create({ url: targetUrl }, tab => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (request.action === 'getTranslatorInfo') {
    Promise.all([
      getAliyunCredentials(),
      storageGet(['translationEngine'])
    ]).then(([credentials, settings]) => sendResponse({
      success: true,
      currentTranslator: settings.translationEngine || currentTranslator,
      baiduAvailable: Boolean(BAIDU_CREDENTIALS.APPID && BAIDU_CREDENTIALS.SECRET),
      aliyunAvailable: Boolean(credentials.accessKeyId && credentials.accessKeySecret)
    })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'switchTranslator') {
    const supportedTranslators = ['ollama', 'baidu', 'aliyun'];
    if (!supportedTranslators.includes(request.translator)) {
      sendResponse({ success: false, error: '不支持的翻译引擎' });
      return true;
    }
    currentTranslator = request.translator;
    storageSet({
      translationEngine: currentTranslator,
      preferred_translator: currentTranslator
    }).then(() => sendResponse({ success: true, currentTranslator }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testAliyun') {
    (async () => {
      try {
        const translation = await aliyunTranslate('Hello', 'en', 'zh', request.credentials || null);
        sendResponse({ success: true, translation });
      } catch (error) {
        sendResponse({ success: false, error: error.message || '阿里云连接测试失败' });
      }
    })();
    return true;
  }
  
  // 处理翻译请求 - 识别"translate"和"TRANSLATE"
  if (request.action === 'translate' || request.action === 'TRANSLATE' || request.action === 'translateSelection') {
    console.log('[后台脚本] 收到翻译请求:', request.text?.substring(0, 30) + '...');
    
    if (!request.text) {
      console.error('[后台脚本] 翻译请求缺少文本');
      sendResponse({ 
        success: false, 
        error: '翻译文本不能为空', 
        messageId: request.messageId || request.requestId 
      });
      return true;
    }
    
    // 执行翻译
    (async function() {
      try {
        console.log('[后台脚本] 开始翻译文本:', request.text.substring(0, 30));
        
        // 获取当前选择的翻译引擎
        const { translationEngine } = await new Promise((resolve) => {
          chrome.storage.local.get(['translationEngine'], resolve);
        });
        
        // 获取源语言和目标语言，默认从自动检测翻译到中文
        const from = request.from || 'auto';
        const to = request.to || 'zh';
        
        let translation;
        
        console.log('[后台脚本] 当前翻译引擎:', translationEngine || 'aliyun',
                    '源语言:', from, '目标语言:', to);
        
        // 根据选择的引擎调用相应的翻译函数
        switch (translationEngine) {
          case 'baidu':
            translation = await baiduTranslate(request.text, from, to);
            break;
          case 'aliyun':
            translation = await aliyunTranslate(request.text, from, to);
            break;
          case 'ollama':
          default:
            translation = await ollamaTranslate(request.text, from, to);
            break;
        }
        
        console.log('[后台脚本] 翻译成功:', translation?.substring(0, 30));
        
        sendResponse({ 
          success: true, 
          translation: translation,
          messageId: request.messageId || request.requestId
        });
      } catch (error) {
        console.error('[后台脚本] 翻译失败:', error);
        sendResponse({ 
          success: false, 
          error: error.message || '翻译失败',
          messageId: request.messageId || request.requestId
        });
      }
    })();
    
    return true; // 保持消息通道开放以便异步响应
  }
  
  if (request.action === "settingsUpdated") {
    // 设置更新通知
    console.log("[Background] 翻译设置已更新:", request.settings?.translationEngine || 'unchanged');
    if (request.settings && request.settings.translationEngine) {
      currentTranslator = request.settings.translationEngine;
    }
    sendResponse({ success: true, message: "设置更新已接收" });
    return true;
  }
  
  if (request.action === "fetchModels") {
    // 获取Ollama模型列表请求
    console.log("[Background] 收到获取Ollama模型列表请求");
    
    // 获取Ollama API地址
    (async function() {
      try {
        const { ollamaEndpoint } = await new Promise((resolve) => {
          chrome.storage.local.get(['ollamaEndpoint'], resolve);
        });
        
        const endpoint = ollamaEndpoint || 'http://localhost:11434';
        console.log(`[Background] 从 ${endpoint} 获取模型列表`);
        
        const response = await fetch(`${endpoint}/api/tags`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Background] 获取模型列表失败:', errorText);
      sendResponse({ 
        success: false, 
            error: `获取模型列表失败: ${response.status} ${response.statusText}`
          });
          return;
        }
        
        const data = await response.json();
        console.log('[Background] 获取到模型列表:', data);
        
        if (data && data.models && Array.isArray(data.models)) {
          // 提取模型名称
          const models = data.models.map(model => {
            return typeof model === 'string' ? model : model.name;
          }).filter(Boolean);
          
        sendResponse({
          success: true,
            models: models
        });
      } else {
        sendResponse({
          success: false,
            error: '模型数据格式不正确'
        });
      }
    } catch (error) {
        console.error('[Background] 获取模型列表错误:', error);
      sendResponse({
        success: false,
          error: error.message || '获取模型列表失败'
        });
      }
    })();
    
    return true; // 保持消息通道开放以便异步响应
  }
  
  // 其他请求类型
  console.log("[Background] 未知请求类型:", request.action);
  sendResponse({ success: false, error: "未知的请求类型" });
  return true;
});

// 初始化
initialize().catch(error => {
  log('初始化过程中出错:', error);
});

log('后台脚本已加载');
