// Firefox/Zen 划词触发器：选中文本后显示右下角小点，悬停或点击后请求翻译。
(function () {
  'use strict';

  window.__immersiveSelectionTriggerActive = true;

  const HOST_ID = '__immersive_translation_selection_ui__';
  const MAX_LENGTH = 5000;
  const HIDE_DELAY_MS = 500;
  let pendingText = '';
  let pendingRange = null;
  let selectionTimer = null;
  let hideTimer = null;
  let isTranslating = false;
  let translationToken = 0;
  let repositionFrame = null;

  function isChineseText(text) {
    const meaningful = text.replace(/[\s\d.,;:!?()[\]{}'"，。；：！？（）【】「」『』、]/g, '');
    if (!meaningful) return false;
    const chineseCount = (meaningful.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    return chineseCount / meaningful.length > 0.5;
  }

  function isEditableSelection(selection) {
    if (!selection || selection.rangeCount === 0) return false;
    const container = selection.getRangeAt(0).startContainer;
    const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    return Boolean(element && element.closest('input, textarea, [contenteditable="true"]'));
  }

  function ensureUI() {
    let host = document.getElementById(HOST_ID);
    if (host) return host.shadowRoot;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .trigger-shell, .card-shell {
          position: fixed;
          top: 0;
          left: 0;
          right: auto;
          bottom: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #eef4ff;
          pointer-events: none;
        }
        .trigger-shell[hidden], .card-shell[hidden] { display: none; }
        .trigger {
          width: 14px;
          height: 14px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: #8aa8ff;
          box-shadow: 0 0 0 4px rgba(138, 168, 255, .18), 0 6px 18px rgba(15, 23, 42, .35);
          cursor: pointer;
          pointer-events: auto;
          transition: transform .18s ease, background .18s ease;
        }
        .trigger:hover { transform: scale(1.15); background: #b7c8ff; }
        .trigger:focus-visible { outline: 3px solid rgba(183, 200, 255, .75); outline-offset: 4px; }
        .card {
          width: min(360px, calc(100vw - 36px));
          max-height: min(460px, calc(100vh - 44px));
          overflow: auto;
          padding: 14px;
          border: 1px solid rgba(190, 207, 255, .2);
          border-radius: 16px;
          background: rgba(20, 27, 45, .96);
          box-shadow: 0 18px 48px rgba(6, 12, 26, .42);
          backdrop-filter: blur(18px);
          pointer-events: auto;
        }
        .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .label { color: #aebbe0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
        .close, .copy {
          border: 0;
          border-radius: 8px;
          color: #b9c7ed;
          background: transparent;
          cursor: pointer;
          font: inherit;
        }
        .close { width: 26px; height: 26px; font-size: 20px; line-height: 1; }
        .close:hover, .copy:hover { background: rgba(255,255,255,.09); color: #fff; }
        .source { max-height: 76px; overflow: auto; color: #9da9c7; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
        .divider { height: 1px; margin: 12px 0; background: rgba(190, 207, 255, .14); }
        .result { min-height: 46px; color: #f6f8ff; font-size: 16px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
        .loading { color: #aebbe0; font-size: 13px; }
        .error { color: #ffb5b5; font-size: 13px; line-height: 1.5; }
        .card-foot { display: flex; justify-content: flex-end; margin-top: 10px; }
        .copy { padding: 5px 8px; font-size: 12px; }
      </style>
      <div class="trigger-shell" hidden>
        <button class="trigger" type="button" aria-label="翻译选中文本" title="翻译选中文本"></button>
      </div>
      <div class="card-shell" hidden>
        <section class="card" role="dialog" aria-live="polite" aria-label="翻译结果">
          <div class="card-head">
            <span class="label">阿里云翻译</span>
            <button class="close" type="button" data-action="close" aria-label="关闭">×</button>
          </div>
          <div class="source"></div>
          <div class="divider"></div>
          <div class="result"></div>
          <div class="card-foot"><button class="copy" type="button" data-action="copy">复制译文</button></div>
        </section>
      </div>
    `;

    const trigger = shadow.querySelector('.trigger');
    const startFromPointer = event => {
      event.preventDefault();
      event.stopPropagation();
      translatePending(shadow);
    };
    trigger.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    trigger.addEventListener('pointerenter', () => translatePending(shadow));
    trigger.addEventListener('click', startFromPointer);
    shadow.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'close') hideAll(shadow);
      if (action === 'copy') copyResult(shadow);
    });
    return shadow;
  }

  function getSelectionRects(range) {
    if (!range) return [];
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width || rect.height);
    if (rects.length) return rects;
    const rect = range.getBoundingClientRect();
    return rect && (rect.width || rect.height) ? [rect] : [];
  }

  function getSelectionRect(range) {
    const rects = getSelectionRects(range);
    const rect = rects[rects.length - 1];
    if (!rect || (!rect.width && !rect.height)) return null;
    return rect;
  }

  function isPointInsideSelection(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    return getSelectionRects(pendingRange).some(rect => (
      clientX >= rect.left - 2 &&
      clientX <= rect.right + 2 &&
      clientY >= rect.top - 2 &&
      clientY <= rect.bottom + 2
    ));
  }

  function cancelScheduledHide() {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(shadow) {
    if (hideTimer !== null) return;
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      hideAll(shadow);
    }, HIDE_DELAY_MS);
  }

  function isUIVisible(shadow) {
    return shadow && (
      !shadow.querySelector('.trigger-shell').hidden ||
      !shadow.querySelector('.card-shell').hidden
    );
  }

  function handlePointerMove(event) {
    const host = document.getElementById(HOST_ID);
    if (!host || !pendingRange || !isUIVisible(host.shadowRoot)) return;

    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const overUI = host.contains(event.target) || eventPath.includes(host);
    if (overUI || isPointInsideSelection(event.clientX, event.clientY)) {
      cancelScheduledHide();
      return;
    }
    scheduleHide(host.shadowRoot);
  }

  function setShellPosition(shell, left, top) {
    shell.style.left = `${Math.round(left)}px`;
    shell.style.top = `${Math.round(top)}px`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function positionTrigger(shadow) {
    const rect = getSelectionRect(pendingRange);
    if (!rect) return;

    const triggerSize = 14;
    const gap = 8;
    const viewportPadding = 8;
    let left = rect.right + gap;
    let top = rect.bottom + gap;

    if (left + triggerSize > window.innerWidth - viewportPadding) {
      left = rect.left - triggerSize - gap;
    }
    if (top + triggerSize > window.innerHeight - viewportPadding) {
      top = rect.top - triggerSize - gap;
    }

    setShellPosition(
      shadow.querySelector('.trigger-shell'),
      clamp(left, viewportPadding, window.innerWidth - triggerSize - viewportPadding),
      clamp(top, viewportPadding, window.innerHeight - triggerSize - viewportPadding)
    );
  }

  function positionCard(shadow) {
    const rect = getSelectionRect(pendingRange);
    const card = shadow.querySelector('.card');
    if (!rect || !card) return;

    const gap = 10;
    const viewportPadding = 12;
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    let left = rect.right + gap;
    let top = rect.bottom + gap;

    if (left + cardWidth > window.innerWidth - viewportPadding) {
      left = rect.right - cardWidth;
    }
    if (top + cardHeight > window.innerHeight - viewportPadding) {
      top = rect.top - cardHeight - gap;
    }

    setShellPosition(
      shadow.querySelector('.card-shell'),
      clamp(left, viewportPadding, window.innerWidth - cardWidth - viewportPadding),
      clamp(top, viewportPadding, window.innerHeight - cardHeight - viewportPadding)
    );
  }

  function repositionVisibleUI() {
    if (repositionFrame !== null) return;
    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = null;
      if (!pendingRange) return;
      const shadow = ensureUI();
      if (!shadow.querySelector('.trigger-shell').hidden) {
        positionTrigger(shadow);
      } else if (!shadow.querySelector('.card-shell').hidden) {
        positionCard(shadow);
      }
    });
  }

  function showTrigger(text, range) {
    const shadow = ensureUI();
    if (pendingText !== text) {
      translationToken += 1;
      isTranslating = false;
    }
    cancelScheduledHide();
    pendingText = text;
    pendingRange = range.cloneRange();
    shadow.querySelector('.source').textContent = text;
    shadow.querySelector('.result').textContent = '';
    shadow.querySelector('.trigger-shell').hidden = false;
    shadow.querySelector('.card-shell').hidden = true;
    positionTrigger(shadow);
    window.dispatchEvent(new Event('immersive-translation-trigger-change'));
  }

  function hideAll(shadow = ensureUI()) {
    cancelScheduledHide();
    shadow.querySelector('.trigger-shell').hidden = true;
    shadow.querySelector('.card-shell').hidden = true;
    pendingText = '';
    pendingRange = null;
    isTranslating = false;
    translationToken += 1;
    window.dispatchEvent(new Event('immersive-translation-trigger-change'));
  }

  function renderCard(shadow, state, message) {
    shadow.querySelector('.trigger-shell').hidden = true;
    shadow.querySelector('.card-shell').hidden = false;
    const result = shadow.querySelector('.result');
    result.className = `result ${state}`;
    result.textContent = message;
    shadow.querySelector('[data-action="copy"]').hidden = state !== 'result';
  }

  function translatePending(shadow) {
    if (!pendingText || isTranslating) return;
    const text = pendingText;
    const requestToken = ++translationToken;
    isTranslating = true;
    renderCard(shadow, 'loading', '正在翻译…');
    window.requestAnimationFrame(() => positionCard(shadow));

    chrome.runtime.sendMessage({
      action: 'translateSelection',
      text,
      from: 'auto',
      to: 'zh'
    }, response => {
      isTranslating = false;
      if (requestToken !== translationToken || !pendingRange) return;
      if (chrome.runtime.lastError) {
        renderCard(shadow, 'error', `扩展通信失败：${chrome.runtime.lastError.message}`);
        window.requestAnimationFrame(() => positionCard(shadow));
        return;
      }
      if (!response || !response.success) {
        renderCard(shadow, 'error', response?.error || '翻译失败，请检查阿里云配置');
        window.requestAnimationFrame(() => positionCard(shadow));
        return;
      }
      shadow.querySelector('.result').className = 'result result';
      shadow.querySelector('.result').textContent = response.translation || '没有返回译文';
      shadow.querySelector('[data-action="copy"]').hidden = false;
      window.requestAnimationFrame(() => positionCard(shadow));
    });
  }

  async function copyResult(shadow) {
    const result = shadow.querySelector('.result').textContent;
    if (!result || result === '正在翻译…') return;
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = result;
      textarea.style.cssText = 'position: fixed; opacity: 0;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    const button = shadow.querySelector('[data-action="copy"]');
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = '复制译文'; }, 1200);
  }

  function inspectSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || isEditableSelection(selection)) return;
    const text = selection.toString().trim();
    if (!text || text.length < 2 || text.length > MAX_LENGTH || isChineseText(text)) return;
    showTrigger(text, selection.getRangeAt(0));
  }

  document.addEventListener('mouseup', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(inspectSelection, 80);
  }, true);

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(inspectSelection, 180);
  }, true);

  document.addEventListener('mousedown', event => {
    const host = document.getElementById(HOST_ID);
    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const clickedInsideHost = host && (host.contains(event.target) || eventPath.includes(host));
    if (host && !clickedInsideHost && isUIVisible(host.shadowRoot)) {
      scheduleHide(host.shadowRoot);
    }
  }, true);

  document.addEventListener('pointermove', handlePointerMove, true);

  window.addEventListener('scroll', repositionVisibleUI, true);
  window.addEventListener('resize', repositionVisibleUI);
})();
