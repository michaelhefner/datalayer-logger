'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────
const urlBar      = document.getElementById('url-bar');
const goBtn       = document.getElementById('go-btn');
const backBtn     = document.getElementById('back-btn');
const forwardBtn  = document.getElementById('forward-btn');
const reloadBtn   = document.getElementById('reload-btn');
const eventsList  = document.getElementById('events-list');
const eventBadge  = document.getElementById('event-badge');
const exportBtn   = document.getElementById('export-btn');
const clearBtn    = document.getElementById('clear-btn');
const sessionPath = document.getElementById('session-path');
const filterInput = document.getElementById('filter-input');

// Clickable elements
const elementBadge       = document.getElementById('element-badge');
const scanBtn            = document.getElementById('scan-btn');
const copyElementsBtn    = document.getElementById('copy-elements-btn');
const elementsList       = document.getElementById('elements-list');
const elementsEmptyState = document.getElementById('elements-empty-state');
const elementFilterInput = document.getElementById('element-filter-input');
const visibleOnlyCb      = document.getElementById('visible-only-cb');
const autoScanCb         = document.getElementById('auto-scan-cb');
const elementsCount      = document.getElementById('elements-count');

let totalCount = 0;

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal JSON syntax highlighter.
 * Expects an already-HTML-escaped string produced by
 * JSON.stringify(...) → escapeHtml(...)
 */
function highlightJson(raw) {
  return raw.replace(
    /("(\\.|[^"\\])*")\s*:|("(\\.|[^"\\])*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, keyWithColon, _k1, strVal, _s1, bool, nil, num) => {
      if (keyWithColon) {
        // "key":  → colour the key part, keep the colon
        const colonIdx = keyWithColon.lastIndexOf(':');
        const key   = keyWithColon.slice(0, colonIdx).trim();
        const colon = keyWithColon.slice(colonIdx);
        return `<span class="jk">${key}</span>${colon}`;
      }
      if (strVal)  return `<span class="js">${strVal}</span>`;
      if (bool)    return `<span class="jb">${bool}</span>`;
      if (nil)     return `<span class="jl">${nil}</span>`;
      if (num !== undefined) return `<span class="jn">${num}</span>`;
      return _match;
    }
  );
}

function getEventName(data) {
  if (!data || typeof data !== 'object') return String(data);
  if (data.event) return data.event;
  // gtag-style arguments object: {"0":"event","1":"page_view",...}
  if (data['0'] === 'event' && data['1']) return `gtag: ${data['1']}`;
  if (data['0'] === 'config' && data['1']) return `gtag config: ${data['1']}`;
  if (data['0'] === 'set')   return 'gtag set';
  const keys = Object.keys(data);
  if (keys.length === 0) return '(empty push)';
  return keys.slice(0, 2).join(', ');
}

function updateEmptyState() {
  document.body.classList.toggle('no-events', totalCount === 0);
}

function applyFilter() {
  const term = filterInput.value.trim().toLowerCase();
  document.querySelectorAll('.event-item').forEach((el) => {
    if (!term) {
      el.classList.remove('hidden');
      return;
    }
    const name = (el.dataset.eventName || '').toLowerCase();
    el.classList.toggle('hidden', !name.includes(term));
  });
}

// ── Render a single event entry ───────────────────────────────────────────

function addEventToList(entry, prepend = true) {
  totalCount++;
  eventBadge.textContent = totalCount;
  updateEmptyState();

  const eventName = getEventName(entry.event);
  const time      = new Date(entry.timestamp).toLocaleTimeString();
  const jsonText  = JSON.stringify(entry.event, null, 2);
  const highlighted = highlightJson(escapeHtml(jsonText));

  const item = document.createElement('div');
  item.className = 'event-item';
  item.dataset.eventName = eventName;

  item.innerHTML = `
    <div class="event-header">
      <span class="event-index">#${entry.id}</span>
      <span class="event-name">${escapeHtml(eventName)}</span>
      <span class="event-time">${time}</span>
      <span class="event-chevron">&#9654;</span>
    </div>
    <div class="event-body">
      <div class="event-url">${escapeHtml(entry.url || '')}</div>
      <pre class="event-json">${highlighted}</pre>
    </div>
  `;

  item.querySelector('.event-header').addEventListener('click', () => {
    item.classList.toggle('expanded');
  });

  if (prepend) {
    eventsList.insertBefore(item, eventsList.firstChild);
  } else {
    eventsList.appendChild(item);
  }

  applyFilter();
}

// ── Navigation ────────────────────────────────────────────────────────────

function navigate() {
  const url = urlBar.value.trim();
  if (url) window.electronAPI.navigate(url);
}

goBtn.addEventListener('click', navigate);
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate();
  if (e.key === 'Escape') urlBar.blur();
});

backBtn.addEventListener('click',    () => window.electronAPI.goBack());
forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
reloadBtn.addEventListener('click',  () => window.electronAPI.reload());

document.addEventListener('keydown', (e) => {
  if (e.key === 'F5')                        { window.electronAPI.reload();    e.preventDefault(); }
  if (e.key === 'ArrowLeft'  && e.altKey)    { window.electronAPI.goBack();    e.preventDefault(); }
  if (e.key === 'ArrowRight' && e.altKey)    { window.electronAPI.goForward(); e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') { urlBar.select();            e.preventDefault(); }
});

// ── Event log actions ─────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => window.electronAPI.exportEvents());

clearBtn.addEventListener('click', () => {
  window.electronAPI.clearEvents();
  eventsList.innerHTML = '';
  totalCount = 0;
  eventBadge.textContent = '0';
  updateEmptyState();
});

filterInput.addEventListener('input', applyFilter);

// ── Tab switching ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Clickable elements panel ──────────────────────────────────────────────

let scannedElements = [];

function tagClass(tag) {
  if (tag === 'a')                          return 'el-tag-a';
  if (tag === 'button' || tag === 'summary') return 'el-tag-button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'el-tag-input';
  if (tag === 'select')                     return 'el-tag-select';
  return 'el-tag-other';
}

function elMeta(el) {
  if (el.href)        return el.href;
  if (el.role)        return `role=${el.role}`;
  if (el.type)        return `type=${el.type}`;
  if (el.name)        return `name=${el.name}`;
  if (el.placeholder) return el.placeholder;
  if (el.ariaLabel)   return el.ariaLabel;
  return el.selector;
}

function renderElements() {
  const visOnly = visibleOnlyCb.checked;
  const term    = elementFilterInput.value.trim().toLowerCase();
  const pool    = visOnly ? scannedElements.filter(e => e.visible) : scannedElements;

  elementsList.innerHTML = '';
  let shown = 0;

  pool.forEach((el) => {
    const meta     = elMeta(el);
    const haystack = `${el.tag} ${el.text} ${meta} ${el.selector}`.toLowerCase();
    if (term && !haystack.includes(term)) return;

    shown++;
    const item = document.createElement('div');
    item.className = 'el-item' + (el.visible ? '' : ' el-invisible');

    item.innerHTML = `
      <span class="el-tag ${tagClass(el.tag)}">&lt;${escapeHtml(el.tag)}&gt;</span>
      <div class="el-body">
        <div class="el-text">${escapeHtml(el.text)}</div>
        <div class="el-meta">${escapeHtml(meta)}</div>
      </div>
      <button class="el-copy-btn" title="Copy CSS selector">Copy</button>
    `;

    const copyBtn = item.querySelector('.el-copy-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(el.selector).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500);
      });
    });

    elementsList.appendChild(item);
  });

  const total = pool.length;
  elementsCount.textContent = term
    ? `${shown} of ${total} matching`
    : `${total} element${total !== 1 ? 's' : ''} found`;

  elementsEmptyState.style.display = (total === 0 && !term) ? 'flex' : 'none';
  elementBadge.textContent = scannedElements.filter(e => e.visible).length;
}

async function runScan() {
  scanBtn.textContent = 'Scanning…';
  scanBtn.classList.add('scanning');
  scanBtn.disabled = true;
  try {
    const result = await window.electronAPI.scanClickableElements();
    scannedElements = result.elements || [];
    renderElements();
  } catch (err) {
    console.error('Scan error:', err);
  } finally {
    scanBtn.textContent = 'Scan Page';
    scanBtn.classList.remove('scanning');
    scanBtn.disabled = false;
  }
}

scanBtn.addEventListener('click', runScan);

copyElementsBtn.addEventListener('click', () => {
  const visOnly = visibleOnlyCb.checked;
  const data = visOnly ? scannedElements.filter(e => e.visible) : scannedElements;
  navigator.clipboard.writeText(JSON.stringify(data, null, 2));
});

visibleOnlyCb.addEventListener('change', renderElements);
elementFilterInput.addEventListener('input', renderElements);

// ── IPC subscriptions ─────────────────────────────────────────────────────

window.electronAPI.onUrlChanged((url) => {
  urlBar.value = url;
  if (autoScanCb.checked) runScan();
});

window.electronAPI.onNewEvent((entry) => {
  addEventToList(entry, true);
});

window.electronAPI.onSessionFileChanged((filePath) => {
  sessionPath.textContent = `Saving to: ${filePath}`;
});

// ── Initialise ────────────────────────────────────────────────────────────

(async () => {
  // Load the session save path
  const filePath = await window.electronAPI.getSessionFile();
  sessionPath.textContent = `Saving to: ${filePath}`;

  // Replay any events captured before the renderer was ready
  const existing = await window.electronAPI.getEvents();
  existing.forEach((entry) => addEventToList(entry, false));

  updateEmptyState();
})();
