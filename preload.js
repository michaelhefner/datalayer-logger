'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, typed API to the renderer. Nothing from Node.js leaks
// into the page context because contextIsolation is true for this window.
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigation
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),

  // Events management
  getEvents: () => ipcRenderer.invoke('get-events'),
  getSessionFile: () => ipcRenderer.invoke('get-session-file'),
  clearEvents: () => ipcRenderer.send('clear-events'),
  exportEvents: () => ipcRenderer.send('export-events'),

  // Clickable element scanner
  scanClickableElements: () => ipcRenderer.invoke('scan-clickable-elements'),
  highlightElement: (selector) => ipcRenderer.invoke('highlight-element', selector),

  // Subscriptions (one-way from main → renderer)
  onUrlChanged: (cb) =>
    ipcRenderer.on('url-changed', (_e, url) => cb(url)),
  onNewEvent: (cb) =>
    ipcRenderer.on('new-datalayer-event', (_e, entry) => cb(entry)),
  onSessionFileChanged: (cb) =>
    ipcRenderer.on('session-file-changed', (_e, filePath) => cb(filePath)),
});
