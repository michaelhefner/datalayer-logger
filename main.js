'use strict';

const { app, BrowserWindow, ipcMain, WebContentsView, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const TOOLBAR_HEIGHT = 52;
const SIDEBAR_WIDTH = 380;

let mainWindow = null;
let browserView = null;
let capturedEvents = [];
let sessionFilePath = null;

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
