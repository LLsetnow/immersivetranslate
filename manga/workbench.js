(function () {
  'use strict';

  const routes = ['plugin-config', 'manga-config', 'standalone'];
  const links = Array.from(document.querySelectorAll('[data-route]'));
  const pages = Array.from(document.querySelectorAll('[data-page]'));
  const frames = {
    'plugin-config': document.querySelector('[data-page="plugin-config"] iframe'),
    'manga-config': document.querySelector('[data-page="manga-config"] iframe'),
    standalone: document.getElementById('standalone-frame'),
  };
  const headerState = document.getElementById('header-state');
  const taskReturn = document.getElementById('task-return');
  const taskSummary = document.getElementById('task-summary');
  const themeToggle = document.getElementById('theme-toggle');
  const themeKey = 'mangaWorkbenchTheme';
  let theme = localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark';
  let activeTask = null;

  function broadcastTheme() {
    document.documentElement.dataset.theme = theme;
    themeToggle.textContent = theme === 'dark' ? '浅色' : '深色';
    themeToggle.setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题');
    Object.values(frames).forEach(frame => frame?.contentWindow?.postMessage({ type: 'workbenchTheme', theme }, location.origin));
  }

  function currentRoute() {
    const requested = location.hash.slice(1);
    return routes.includes(requested) ? requested : 'plugin-config';
  }

  function setRoute(route, { writeHistory = false } = {}) {
    const next = routes.includes(route) ? route : 'plugin-config';
    document.documentElement.dataset.route = next;
    if (writeHistory && location.hash !== '#' + next) location.hash = next;
    links.forEach(link => {
      if (link.dataset.route === next) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    pages.forEach(page => { page.hidden = page.dataset.page !== next; });
    Object.entries(frames).forEach(([key, frame]) => {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({
        type: 'workbenchVisibility',
        visible: key === next,
      }, location.origin);
      frame.contentWindow.postMessage({ type: 'workbenchTheme', theme }, location.origin);
    });
  }

  function updateHeaderState(message) {
    if (!message || message.type !== 'workbenchBackendStatus') return;
    const dot = headerState.querySelector('.status-dot');
    const label = headerState.querySelector('span:last-child');
    dot.className = 'status-dot ' + (message.kind || '');
    label.textContent = message.text || '状态未知';
  }

  function updateTask(message) {
    if (!message || message.type !== 'workbenchTaskStatus') return;
    activeTask = message.active ? message : null;
    taskReturn.hidden = !activeTask;
    if (activeTask) {
      const progress = activeTask.total ? ' · ' + (activeTask.done || 0) + '/' + activeTask.total : '';
      taskSummary.textContent = (activeTask.title || '独立翻译') + progress;
    }
    frames['manga-config']?.contentWindow?.postMessage(message, location.origin);
  }

  const pageData = new URLSearchParams(location.search).get('pageData');
  const standaloneUrl = new URL('manga.html?view=standalone', location.href);
  if (pageData) standaloneUrl.searchParams.set('pageData', pageData);
  frames.standalone.src = standaloneUrl.href;
  if (pageData) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('pageData');
    history.replaceState(history.state, document.title, cleanUrl.href);
  }
  Object.values(frames).forEach(frame => frame?.addEventListener('load', () => {
    if (activeTask) frame.contentWindow?.postMessage(activeTask, location.origin);
    frame.contentWindow?.postMessage({ type: 'workbenchTheme', theme }, location.origin);
  }));

  window.addEventListener('hashchange', () => setRoute(currentRoute()));
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    updateHeaderState(event.data);
    updateTask(event.data);
    if (event.data?.type === 'workbenchBackendStatus' || event.data?.type === 'workbenchTaskStatus') {
      frames['plugin-config']?.contentWindow?.postMessage(event.data, location.origin);
    }
  });
  document.getElementById('return-to-task').addEventListener('click', () => {
    if (activeTask) setRoute('standalone', { writeHistory: true });
  });
  themeToggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(themeKey, theme);
    broadcastTheme();
  });

  broadcastTheme();
  setRoute(currentRoute());
})();
