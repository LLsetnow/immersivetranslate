// Full manga-translator-ui settings editor shared by the local and AIGate backends.
(function () {
  'use strict';

  const STORAGE_KEY = 'mangaTranslatorConfig';
  const NATIVE_HOST = 'com.timecyber.immersivetranslate.manga_backend';
  const COMBO_OPTIONS = {
    'cli.format': ['不指定', 'png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'heic', 'heif'],
    'cli.html_view_mode': ['scroll', 'paged'],
    'ocr.ocr_mode': ['local', 'ai_vlm'],
    'ocr.ocr': ['32px', '48px', '48px_ctc', 'mocr', 'paddleocr', 'paddleocr_korean', 'paddleocr_latin', 'paddleocr_thai', 'paddleocr_vl', 'hayai_ocr_v2', 'qwen_vl', 'doubao_vl', 'glm_vl', 'kimi_vl', 'openai_ocr', 'gemini_ocr'],
    'ocr.secondary_ocr': ['32px', '48px', '48px_ctc', 'mocr', 'paddleocr', 'paddleocr_korean', 'paddleocr_latin', 'paddleocr_thai', 'paddleocr_vl', 'hayai_ocr_v2', 'qwen_vl', 'doubao_vl', 'glm_vl', 'kimi_vl', 'openai_ocr', 'gemini_ocr'],
    'ocr.ocr_vl_language_hint': ['auto', 'multilingual', 'Arabic', 'Simplified Chinese', 'Traditional Chinese', 'English', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Russian', 'Portuguese', 'Italian', 'Thai', 'Vietnamese', 'Indonesian', 'Turkish', 'Polish', 'Ukrainian'],
    'detector.detector': ['default', 'dbconvnext', 'ctd', 'craft', 'none'],
    'translator.translator': ['openai', 'openai_hq', 'gemini', 'gemini_hq', 'aliyun', 'sakura', 'none', 'original'],
    'translator.thinking_level': ['auto', 'off', 'low', 'medium', 'high'],
    'translator.target_lang': ['CHS', 'CHT', 'ENG', 'JPN', 'KOR', 'FRA', 'DEU', 'SPA', 'RUS', 'ITA', 'POR', 'THA', 'VIE'],
    'translator.keep_lang': ['none', 'CHS', 'CHT', 'ENG', 'JPN', 'KOR', 'FRA', 'DEU', 'SPA', 'RUS', 'ITA', 'POR', 'THA', 'VIE'],
    'inpainter.inpainter': ['default', 'lama_large', 'lama_mpe', 'flux2-klein', 'sd', 'none', 'original'],
    'inpainter.inpainting_precision': ['fp32', 'fp16', 'bf16'],
    'render.renderer': ['default', 'openai_renderer', 'gemini_renderer', 'none'],
    'render.alignment': ['auto', 'left', 'center', 'right'],
    'render.direction': ['auto', 'horizontal', 'vertical'],
    'render.layout_mode': ['smart_scaling', 'strict', 'balloon_fill'],
    'upscale.upscaler': ['waifu2x', 'esrgan', '4xultrasharp', 'realcugan', 'mangajanai'],
    'upscale.upscale_ratio': ['不使用', '2', '3', '4'],
    'colorizer.colorizer': ['none', 'mc2', 'openai_colorizer', 'gemini_colorizer'],
  };
  const state = { schema: null, config: {}, activeTab: 0, dirty: false, knownPaths: new Set() };
  const $ = selector => document.querySelector(selector);
  const tabsElement = $('#settings-tabs');
  const fieldsElement = $('#settings-fields');
  const searchInput = $('#settings-search');
  const extraInput = $('#extra-config');
  const statusElement = $('#config-status');
  const fileInput = $('#config-file');

  function setStatus(message, kind = 'info') {
    statusElement.textContent = message;
    statusElement.dataset.kind = kind;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    }));
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }

  function sendNativeMessage(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendNativeMessage(NATIVE_HOST, message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || {});
    }));
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || {});
    }));
  }

  function getPath(root, path) {
    return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], root);
  }

  function setPath(root, path, value) {
    const parts = String(path).split('.');
    let cursor = root;
    parts.slice(0, -1).forEach(key => {
      if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
      cursor = cursor[key];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  function removePath(root, path) {
    const parts = String(path).split('.');
    let cursor = root;
    for (const key of parts.slice(0, -1)) {
      if (!cursor || typeof cursor !== 'object') return;
      cursor = cursor[key];
    }
    if (cursor && typeof cursor === 'object') delete cursor[parts[parts.length - 1]];
  }

  function isKnownOrAncestor(path) {
    const prefix = `${path}.`;
    return state.knownPaths.has(path) || Array.from(state.knownPaths).some(known => known.startsWith(prefix));
  }

  function getExtras() {
    const extras = clone(state.config);
    state.knownPaths.forEach(path => removePath(extras, path));
    return extras;
  }

  function getKnownConfig() {
    const known = {};
    state.knownPaths.forEach(path => {
      const value = getPath(state.config, path);
      if (value !== undefined) setPath(known, path, clone(value));
    });
    return known;
  }

  function buildFullConfig(extras) {
    const config = getKnownConfig();
    mergeExtras(config, extras);
    return config;
  }

  function mergeExtras(target, source, path = '') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      if (!isKnownOrAncestor(path)) setPath(target, path, source);
      return;
    }
    Object.entries(source).forEach(([key, value]) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (state.knownPaths.has(nextPath)) return;
      if (isKnownOrAncestor(nextPath) && value && typeof value === 'object' && !Array.isArray(value)) {
        mergeExtras(target, value, nextPath);
      } else if (nextPath) {
        setPath(target, nextPath, value);
      }
    });
  }

  function markDirty() {
    state.dirty = true;
    setStatus('有未保存的修改', 'info');
    renderExtras();
  }

  function displayLabel(item) {
    if (item.label && item.label !== item.key) return item.label;
    return item.key;
  }

  function displayValue(item) {
    const value = getPath(state.config, item.key);
    return value === undefined ? item.defaultValue : value;
  }

  function parseNumericValue(value, kind) {
    if (String(value).trim() === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return kind === 'integer' ? Math.trunc(parsed) : parsed;
  }

  function controlKind(control, value) {
    if (control === 'toggle' || control.startsWith('toggle +')) return 'boolean';
    if (control === 'int-input') return 'integer';
    if (control === 'float-input') return 'number';
    if (control.includes('prompt-editor')) return 'textarea';
    if (value && typeof value === 'object') return 'json';
    return 'text';
  }

  function renderField(item) {
    const value = displayValue(item);
    const kind = controlKind(item.control || '', value);
    const card = document.createElement('div');
    card.className = 'field-card';
    const label = document.createElement('div');
    label.className = 'field-heading';
    const labelText = document.createElement('span');
    labelText.className = 'field-label';
    labelText.textContent = displayLabel(item);
    label.appendChild(labelText);

    const key = document.createElement('code');
    key.className = 'field-key';
    key.textContent = item.key;
    label.appendChild(key);

    const description = document.createElement('p');
    description.className = 'field-description';
    description.textContent = item.description || '';

    const controlWrap = document.createElement('div');
    controlWrap.className = 'field-control';
    let control;
    if (kind === 'boolean') {
      const row = document.createElement('label');
      row.className = 'toggle-row';
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = Boolean(value);
      row.append(control, document.createTextNode(control.checked ? '启用' : '关闭'));
      control.addEventListener('change', () => {
        setPath(state.config, item.key, control.checked);
        row.lastChild.textContent = control.checked ? '启用' : '关闭';
        markDirty();
      });
      controlWrap.appendChild(row);
    } else {
      control = document.createElement(kind === 'textarea' || kind === 'json' ? 'textarea' : 'input');
      if (control.tagName === 'INPUT') {
        control.type = kind === 'integer' || kind === 'number' ? 'number' : 'text';
        if (kind === 'integer') control.step = '1';
        if (kind === 'number') control.step = 'any';
        const choices = COMBO_OPTIONS[item.key];
        if (choices) {
          const listId = `options-${item.key.replace(/[^a-z0-9_-]/gi, '-')}`;
          const dataList = document.createElement('datalist');
          dataList.id = listId;
          [value, ...choices].filter(choice => choice !== undefined && choice !== null)
            .map(String).filter((choice, index, values) => values.indexOf(choice) === index)
            .forEach(choice => {
              const option = document.createElement('option');
              option.value = choice;
              dataList.appendChild(option);
            });
          control.setAttribute('list', listId);
          controlWrap.appendChild(dataList);
        }
        control.value = value == null ? '' : String(value);
      } else {
        control.value = kind === 'json'
          ? JSON.stringify(value, null, 2)
          : value == null ? '' : String(value);
        if (kind === 'json') control.rows = 5;
        else control.rows = 3;
        control.placeholder = item.control?.includes('prompt-editor') ? '提示词文件路径或内容' : '留空';
      }
      control.setAttribute('aria-label', displayLabel(item));
      control.addEventListener('change', () => {
        let nextValue = control.value;
        if (kind === 'integer' || kind === 'number') {
          nextValue = parseNumericValue(nextValue, kind);
        } else if (kind === 'json') {
          try {
            nextValue = JSON.parse(nextValue);
          } catch {
            setStatus(`“${displayLabel(item)}”不是有效 JSON`, 'error');
            return;
          }
        } else if (item.key === 'upscale.upscale_ratio' && nextValue === '不使用') {
          nextValue = null;
        }
        setPath(state.config, item.key, nextValue);
        markDirty();
      });
      control.addEventListener('input', () => {
        if (kind !== 'json') {
          let nextValue = control.value;
          if (kind === 'integer' || kind === 'number') {
            nextValue = parseNumericValue(nextValue, kind);
          } else if (item.key === 'upscale.upscale_ratio' && nextValue === '不使用') {
            nextValue = null;
          }
          setPath(state.config, item.key, nextValue);
          markDirty();
        }
      });
      controlWrap.appendChild(control);
    }
    card.append(label, description, controlWrap);
    return card;
  }

  function renderTabs() {
    tabsElement.replaceChildren();
    state.schema.tabs.forEach((tab, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-tab';
      button.textContent = tab.title;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === state.activeTab));
      button.addEventListener('click', () => {
        state.activeTab = index;
        renderTabs();
        renderFields();
      });
      tabsElement.appendChild(button);
    });
  }

  function renderFields() {
    fieldsElement.replaceChildren();
    const tab = state.schema.tabs[state.activeTab];
    const query = searchInput.value.trim().toLocaleLowerCase();
    let visible = 0;
    tab.items.forEach(item => {
      if (item.kind === 'divider') {
        const divider = document.createElement('h3');
        divider.className = 'settings-divider';
        divider.textContent = item.title;
        fieldsElement.appendChild(divider);
        return;
      }
      if (item.kind !== 'field') return;
      if (query && !`${displayLabel(item)} ${item.key}`.toLocaleLowerCase().includes(query)) return;
      fieldsElement.appendChild(renderField(item));
      visible += 1;
    });
    if (!visible) {
      const empty = document.createElement('div');
      empty.className = 'settings-empty';
      empty.textContent = query ? '当前分组没有匹配的设置项' : '当前分组没有设置项';
      fieldsElement.appendChild(empty);
    }
  }

  function renderExtras() {
    extraInput.value = JSON.stringify(getExtras(), null, 2);
  }

  function setConfig(rawConfig, message) {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      throw new Error('配置文件顶层必须是 JSON 对象');
    }
    state.config = clone(rawConfig);
    state.dirty = true;
    renderFields();
    renderExtras();
    setStatus(message || '配置已载入，保存或应用前仍可继续编辑', 'success');
  }

  async function loadInitialConfig() {
    const stored = await storageGet([STORAGE_KEY]);
    if (stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object') {
      state.config = clone(stored[STORAGE_KEY]);
      state.dirty = false;
      renderFields();
      renderExtras();
      setStatus('已载入扩展保存的统一配置', 'success');
      return;
    }
    try {
      const response = await sendNativeMessage({ action: 'readMangaConfig' });
      if (!response.success || !response.config) throw new Error(response.error || '读取本机配置失败');
      state.config = clone(response.config);
      state.dirty = false;
      renderFields();
      renderExtras();
      setStatus(`已读取本机配置：${response.path || 'config.json'}。保存后将作为本地与云端统一配置。`, 'success');
    } catch (error) {
      state.config = {};
      renderFields();
      renderExtras();
      setStatus(`未找到已保存配置：${error.message}。可以导入配置文件后继续。`, 'error');
    }
  }

  async function saveConfig() {
    const extras = JSON.parse(extraInput.value || '{}');
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('其他配置必须是 JSON 对象');
    const config = buildFullConfig(extras);
    await storageSet({ [STORAGE_KEY]: config });
    state.config = config;
    state.dirty = false;
    renderFields();
    renderExtras();
    setStatus('配置已保存到此浏览器的本地扩展存储', 'success');
  }

  function downloadConfig() {
    const extras = JSON.parse(extraInput.value || '{}');
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('其他配置必须是 JSON 对象');
    const config = buildFullConfig(extras);
    const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'manga-translator-ui-config.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('已导出完整配置文件', 'success');
  }

  async function applyConfig() {
    const extras = JSON.parse(extraInput.value || '{}');
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('其他配置必须是 JSON 对象');
    const config = buildFullConfig(extras);
    state.config = config;
    await storageSet({ [STORAGE_KEY]: config });
    state.dirty = false;
    setStatus('正在将统一配置应用到当前翻译后端…');
    const result = await sendRuntimeMessage({ action: 'applyMangaTranslatorConfig' });
    if (!result.success) throw new Error(result.error || '应用配置失败');
    setStatus(`已应用到${result.backend === 'aigate' ? ' AIGate 云端' : ' 本地'}后端（配置 ${String(result.revision).slice(0, 12)}）`, 'success');
  }

  async function importConfig(file) {
    const parsed = JSON.parse(await file.text());
    setConfig(parsed, `已导入 ${file.name}；保存或应用后会用于本地与云端翻译`);
  }

  async function loadLocalConfig() {
    setStatus('正在读取本机 manga-translator-ui 配置…');
    const response = await sendNativeMessage({ action: 'readMangaConfig' });
    if (!response.success || !response.config) throw new Error(response.error || '读取本机配置失败');
    setConfig(response.config, `已载入本机配置 ${response.path || 'config.json'}；保存后将作为统一配置`);
  }

  async function initialize() {
    try {
      const response = await fetch('config-schema.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`设置项清单读取失败（HTTP ${response.status}）`);
      state.schema = await response.json();
      state.schema.tabs.forEach(tab => tab.items.forEach(item => {
        if (item.kind === 'field' && item.key) state.knownPaths.add(item.key);
      }));
      renderTabs();
      searchInput.addEventListener('input', renderFields);
      await loadInitialConfig();
    } catch (error) {
      setStatus(`配置页初始化失败：${error.message}`, 'error');
    }
  }

  $('#import-config').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) importConfig(file).catch(error => setStatus(`导入失败：${error.message}`, 'error'));
  });
  $('#load-local-config').addEventListener('click', () => loadLocalConfig().catch(error => setStatus(`读取本机配置失败：${error.message}`, 'error')));
  $('#save-config').addEventListener('click', () => saveConfig().catch(error => setStatus(`保存失败：${error.message}`, 'error')));
  $('#export-config').addEventListener('click', () => {
    try { downloadConfig(); } catch (error) { setStatus(`导出失败：${error.message}`, 'error'); }
  });
  $('#apply-config').addEventListener('click', () => applyConfig().catch(error => setStatus(`应用配置失败：${error.message}`, 'error')));
  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  extraInput.addEventListener('change', () => {
    try {
      const extras = JSON.parse(extraInput.value || '{}');
      if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('请输入 JSON 对象');
      state.config = buildFullConfig(extras);
      markDirty();
    } catch (error) {
      setStatus(`其他配置 JSON 错误：${error.message}`, 'error');
    }
  });

  initialize();
})();
