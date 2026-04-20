'use strict';

const { app, BrowserWindow, ipcMain, WebContentsView, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const TOOLBAR_HEIGHT = 52;
const MIN_SIDEBAR = 280;
const MAX_SIDEBAR = 900;
let SIDEBAR_WIDTH = 390;

let mainWindow = null;
let browserView = null;
let capturedEvents = [];
let sessionFilePath = null;

// ---------------------------------------------------------------------------
// Network logging state
// ---------------------------------------------------------------------------

let networkLog = [];          // completed request entries
let networkPending = new Map();   // requestId → partial entry (in-flight)
let networkFilters = [];          // user-defined domain / URL substring filters
let networkEnabled = true;
let networkIdSeq = 0;

function matchesNetworkFilters(url) {
  if (networkFilters.length === 0) return true;
  const lower = url.toLowerCase();
  return networkFilters.some(f => lower.includes(f.toLowerCase()));
}

function setupNetworkLogging(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    if (networkEnabled && matchesNetworkFilters(details.url)) {
      const entry = {
        _seq: ++networkIdSeq,
        requestId: details.id,
        timestamp: new Date().toISOString(),
        timeStart: details.timeStamp,
        timeEnd: null,
        duration: null,
        method: details.method,
        url: details.url,
        resourceType: details.resourceType || null,
        pageUrl: browserView ? browserView.webContents.getURL() : '',
        requestBody: details.uploadData ? parseRequestBody(details.uploadData) : null,
        requestHeaders: null,
        statusCode: null,
        statusLine: null,
        responseHeaders: null,
        error: null,
      };
      networkPending.set(details.id, entry);
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const entry = networkPending.get(details.id);
    if (entry) entry.requestHeaders = details.requestHeaders || null;
    cb({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
    const entry = networkPending.get(details.id);
    if (!entry) return;
    networkPending.delete(details.id);
    entry.timeEnd = details.timeStamp;
    entry.duration = Math.round(details.timeStamp - entry.timeStart);
    entry.statusCode = details.statusCode;
    entry.statusLine = details.statusLine || null;
    entry.responseHeaders = details.responseHeaders || null;
    const finalEntry = { id: entry._seq, ...entry };
    delete finalEntry._seq;
    delete finalEntry.requestId;
    networkLog.push(finalEntry);
    if (mainWindow) mainWindow.webContents.send('network-entry', finalEntry);
  });

  ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
    const entry = networkPending.get(details.id);
    if (!entry) return;
    networkPending.delete(details.id);
    entry.timeEnd = details.timeStamp;
    entry.duration = Math.round(details.timeStamp - entry.timeStart);
    entry.error = details.error;
    const finalEntry = { id: entry._seq, ...entry };
    delete finalEntry._seq;
    delete finalEntry.requestId;
    networkLog.push(finalEntry);
    if (mainWindow) mainWindow.webContents.send('network-entry', finalEntry);
  });
}

function parseRequestBody(uploadData) {
  if (!uploadData || uploadData.length === 0) return null;
  try {
    const parts = uploadData.map(item => {
      if (item.bytes) return Buffer.from(item.bytes).toString('utf8');
      if (item.file) return `[File: ${item.file}]`;
      return '';
    });
    return parts.join('');
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Session file helpers
// ---------------------------------------------------------------------------

function getEventsDir() {
  const dir = path.join(app.getAppPath(), 'datalayer-events');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createSessionFile() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  sessionFilePath = path.join(getEventsDir(), `session-${timestamp}.json`);
  fs.writeFileSync(sessionFilePath, '[]', 'utf8');
  return sessionFilePath;
}

function persistEvents() {
  if (!sessionFilePath) return;
  try {
    fs.writeFileSync(sessionFilePath, JSON.stringify(capturedEvents, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write events file:', err);
  }
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function updateBrowserViewBounds() {
  if (!mainWindow || !browserView) return;
  const { width, height } = mainWindow.getContentBounds();
  browserView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: Math.max(width - SIDEBAR_WIDTH, 200),
    height: Math.max(height - TOOLBAR_HEIGHT, 200),
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
  createSessionFile();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Browser view for the actual web content.
  // contextIsolation: false is required so the preload script can intercept
  // window.dataLayer in the page's JavaScript context.
  browserView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'page-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.contentView.addChildView(browserView);
  updateBrowserViewBounds();

  setupNetworkLogging(browserView.webContents.session);

  browserView.webContents.loadURL('https://www.google.com');

  // Keep the URL bar in sync
  browserView.webContents.on('did-navigate', (_e, url) => {
    if (mainWindow) mainWindow.webContents.send('url-changed', url);
  });
  browserView.webContents.on('did-navigate-in-page', (_e, url) => {
    if (mainWindow) mainWindow.webContents.send('url-changed', url);
  });
  browserView.webContents.on('page-title-updated', (_e, title) => {
    if (mainWindow) mainWindow.setTitle(`DataLayer Logger — ${title}`);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', updateBrowserViewBounds);

  mainWindow.on('closed', () => {
    persistEvents();
    mainWindow = null;
    browserView = null;
  });
}

// ---------------------------------------------------------------------------
// IPC — navigation
// ---------------------------------------------------------------------------

ipcMain.on('navigate', (_e, rawUrl) => {
  if (!browserView) return;
  let url = rawUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // Treat as a URL if it looks like one, otherwise do a Google search
    if (/^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(url)) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  browserView.webContents.loadURL(url);
});

ipcMain.on('go-back', () => {
  if (browserView && browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
});

ipcMain.on('go-forward', () => {
  if (browserView && browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
});

ipcMain.on('reload', () => {
  if (browserView) browserView.webContents.reload();
});

ipcMain.on('resize-sidebar', (_e, width) => {
  SIDEBAR_WIDTH = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Math.round(width)));
  updateBrowserViewBounds();
});

// ---------------------------------------------------------------------------
// IPC — network logging
// ---------------------------------------------------------------------------

ipcMain.handle('get-network-log', () => networkLog);
ipcMain.handle('get-network-filters', () => networkFilters);

ipcMain.on('clear-network-log', () => {
  networkLog = [];
  networkPending.clear();
  networkIdSeq = 0;
});

ipcMain.on('set-network-filters', (_e, filters) => {
  networkFilters = Array.isArray(filters) ? filters : [];
});

ipcMain.on('set-network-enabled', (_e, enabled) => {
  networkEnabled = !!enabled;
});

ipcMain.on('export-network-log', async (_e, filtered) => {
  if (!mainWindow) return;
  const data = filtered !== undefined ? filtered : networkLog;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Network Log',
    defaultPath: `network-log-${Date.now()}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Network export failed:', err);
    }
  }
});

// ---------------------------------------------------------------------------
// IPC — dataLayer events (sent from page-preload.js)
// ---------------------------------------------------------------------------

ipcMain.on('datalayer-event', (_e, data) => {
  const entry = {
    id: capturedEvents.length + 1,
    timestamp: new Date().toISOString(),
    url: browserView ? browserView.webContents.getURL() : '',
    event: data,
  };
  capturedEvents.push(entry);
  persistEvents();

  if (mainWindow) {
    mainWindow.webContents.send('new-datalayer-event', entry);
  }
});

// ---------------------------------------------------------------------------
// IPC — UI actions
// ---------------------------------------------------------------------------

ipcMain.handle('get-events', () => capturedEvents);

ipcMain.handle('get-session-file', () => sessionFilePath);

ipcMain.on('clear-events', () => {
  capturedEvents = [];
  createSessionFile();
  if (mainWindow) {
    mainWindow.webContents.send('session-file-changed', sessionFilePath);
  }
});

ipcMain.on('export-events', async () => {
  if (!mainWindow) return;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export DataLayer Events',
    defaultPath: `datalayer-events-${Date.now()}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(capturedEvents, null, 2), 'utf8');
    } catch (err) {
      console.error('Export failed:', err);
    }
  }
});

ipcMain.on('export-listeners', async (_e, elements) => {
  if (!mainWindow) return;
  const url = browserView ? browserView.webContents.getURL() : '';
  const report = {
    exportedAt: new Date().toISOString(),
    pageUrl: url,
    totalElements: elements.length,
    elements,
  };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Elements with Listeners',
    defaultPath: `listeners-${Date.now()}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    } catch (err) {
      console.error('Listener export failed:', err);
    }
  }
});

// ---------------------------------------------------------------------------
// IPC — clickable element scanner
// ---------------------------------------------------------------------------

// This function is serialised via .toString() and executed inside the page
// context via executeJavaScript. It must use only browser globals.
function scanPageForClickables() {
  const SEMANTIC_SEL = [
    'a[href]', 'button', 'summary',
    'input[type="button"]', 'input[type="submit"]',
    'input[type="reset"]', 'input[type="image"]',
    'input[type="checkbox"]', 'input[type="radio"]',
    'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
    '[role="switch"]', '[role="option"]', '[role="treeitem"]',
    '[onclick]', '[onmousedown]', '[onmouseup]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function escapeId(id) {
    try { return CSS.escape(id); } catch (e) { return id; }
  }

  function getSelector(el) {
    if (el.id) return '#' + escapeId(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur !== document.documentElement) {
      let tag = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + escapeId(cur.id)); break; }
      const siblings = cur.parentNode
        ? Array.from(cur.parentNode.children).filter(s => s.tagName === cur.tagName)
        : [];
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        tag += `:nth-of-type(${idx})`;
      }
      parts.unshift(tag);
      cur = cur.parentNode;
    }
    return parts.join(' > ');
  }

  function getText(el) {
    const t = (el.textContent || el.value || el.alt ||
      el.getAttribute('aria-label') || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ').trim();
    return t.length > 100 ? t.slice(0, 100) + '\u2026' : t;
  }

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0;
    } catch (e) { return false; }
  }

  function elementInfo(el) {
    const rect = el.getBoundingClientRect();
    const classes = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 6)
      : [];
    // Collect registered event listeners recorded by the preload interceptor.
    const listeners = typeof window.__dlGetListeners__ === 'function'
      ? window.__dlGetListeners__(el)
      : [];
    // Also pick up inline on* attributes as synthetic listener entries.
    const INLINE_EVENTS = ['onclick', 'onmousedown', 'onmouseup', 'onchange',
      'onfocus', 'onblur', 'onkeydown', 'onkeyup', 'onkeypress', 'oninput', 'onsubmit'];
    INLINE_EVENTS.forEach(attr => {
      if (el.hasAttribute(attr)) {
        listeners.push({
          type: attr.replace(/^on/, ''),
          capture: false, once: false, passive: false,
          fnName: '(inline)',
          fnPreview: (el.getAttribute(attr) || '').trim().slice(0, 160),
        });
      }
    });
    return {
      tag: el.tagName.toLowerCase(),
      text: getText(el),
      href: el.href || null,
      id: el.id || null,
      classes,
      role: el.getAttribute('role') || null,
      type: el.getAttribute('type') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      selector: getSelector(el),
      visible: isVisible(el),
      listeners,
      rect: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  const seen = new Set();

  // 1. Semantic / ARIA-role clickable elements
  try { document.querySelectorAll(SEMANTIC_SEL).forEach(el => seen.add(el)); } catch (e) { }

  // 2. Elements styled cursor:pointer (capped to avoid page freezes)
  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, 3000);
  for (let i = 0; i < limit; i++) {
    try { if (window.getComputedStyle(all[i]).cursor === 'pointer') seen.add(all[i]); } catch (e) { }
  }

  return Array.from(seen).map(elementInfo);
}

// Inlined page script — highlights an element by CSS selector with a pulsing overlay.
function highlightElementInPage(selector) {
  const prev = document.getElementById('__dl_highlight__');
  if (prev) prev.remove();

  let el;
  try { el = document.querySelector(selector); } catch (e) { }
  if (!el) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const rect = el.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.id = '__dl_highlight__';
  const pad = 3;
  overlay.style.cssText = [
    'position:fixed',
    `top:${rect.top - pad}px`,
    `left:${rect.left - pad}px`,
    `width:${rect.width + pad * 2}px`,
    `height:${rect.height + pad * 2}px`,
    'border:2px solid #007acc',
    'background:rgba(0,122,204,0.12)',
    'pointer-events:none',
    'z-index:2147483647',
    'box-sizing:border-box',
    'border-radius:3px',
    'transition:opacity 0.4s ease',
    'opacity:1',
  ].join(';');

  // Pulsing outline via box-shadow keyframes injected once
  if (!document.getElementById('__dl_highlight_style__')) {
    const s = document.createElement('style');
    s.id = '__dl_highlight_style__';
    s.textContent = '@keyframes __dl_pulse {0%,100%{box-shadow:0 0 0 0 rgba(0,122,204,0.5)}50%{box-shadow:0 0 0 6px rgba(0,122,204,0)}}';
    document.head.appendChild(s);
  }
  overlay.style.animation = '__dl_pulse 0.8s ease 2';

  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity = '0'; }, 2200);
  setTimeout(() => { overlay.remove(); }, 2600);
}

ipcMain.handle('highlight-element', async (_e, selector) => {
  if (!browserView) return;
  try {
    await browserView.webContents.executeJavaScript(
      `(${highlightElementInPage.toString()})(${JSON.stringify(selector)})`
    );
  } catch (err) {
    console.error('Highlight failed:', err);
  }
});

ipcMain.handle('scan-clickable-elements', async () => {
  if (!browserView) return { url: '', elements: [] };
  try {
    const url = browserView.webContents.getURL();
    const elements = await browserView.webContents.executeJavaScript(
      `(${scanPageForClickables.toString()})()`
    );
    return { url, elements };
  } catch (err) {
    console.error('Scan failed:', err);
    return { url: '', elements: [], error: err.message };
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  persistEvents();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
