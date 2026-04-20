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
const logListenersBtn    = document.getElementById('log-listeners-btn');
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

// ── JS formatter ────────────────────────────────────────────────────────────
function formatJs(src) {
  const INDENT = '  ';
  let depth = 0;
  let out   = '';
  let i     = 0;
  const len = src.length;

  const ind     = () => INDENT.repeat(Math.max(0, depth));
  const trimOut = () => { out = out.replace(/[ \t]+$/, ''); };
  const skipWs  = () => { while (i < len && /[ \t\r\n]/.test(src[i])) i++; };

  while (i < len) {
    const ch = src[i];

    // String literals
    if (ch === '"' || ch === "'") {
      const q = ch; let s = ch; i++;
      while (i < len) {
        if (src[i] === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        s += src[i];
        if (src[i++] === q) break;
      }
      out += s; continue;
    }

    // Template literals
    if (ch === '`') {
      let s = '`'; i++;
      while (i < len) {
        if (src[i] === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        s += src[i];
        if (src[i++] === '`') break;
      }
      out += s; continue;
    }

    // Line comments
    if (ch === '/' && src[i + 1] === '/') {
      let s = ''; i += 2;
      while (i < len && src[i] !== '\n') s += src[i++];
      out += '//' + s; continue;
    }

    // Block comments
    if (ch === '/' && src[i + 1] === '*') {
      let s = '/*'; i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) s += src[i++];
      s += '*/'; i += 2;
      out += s; continue;
    }

    // Open brace
    if (ch === '{') {
      i++;
      // Peek past whitespace — empty block?
      let j = i;
      while (j < len && /[ \t\r\n]/.test(src[j])) j++;
      if (src[j] === '}') {
        trimOut(); out += ' {}'; i = j + 1; continue;
      }
      trimOut();
      out += ' {\n'; depth++; out += ind(); skipWs(); continue;
    }

    // Close brace
    if (ch === '}') {
      i++; depth = Math.max(0, depth - 1);
      trimOut();
      out += '\n' + ind() + '}';
      skipWs();
      if (i < len && !';,)]'.includes(src[i])) out += '\n' + ind();
      continue;
    }

    // Semicolon
    if (ch === ';') {
      i++;
      while (i < len && /[ \t]/.test(src[i])) i++;
      out += ';';
      if (i < len && src[i] !== '}' && src[i] !== '\n') {
        out += '\n' + ind();
        while (i < len && /[ \t\r\n]/.test(src[i])) i++;
      }
      continue;
    }

    // Whitespace — normalise to single space
    if (/[ \t\r\n]/.test(ch)) {
      while (i < len && /[ \t\r\n]/.test(src[i])) i++;
      const last = out[out.length - 1];
      if (last && last !== '\n' && last !== ' ' && last !== '(') out += ' ';
      continue;
    }

    out += src[i++];
  }
  return out.trim();
}

// ── JS syntax highlighter ───────────────────────────────────────────────────
const JS_KW = new Set([
  'function','return','const','let','var','if','else','for','while','do',
  'switch','case','break','continue','new','delete','void','typeof','instanceof',
  'in','of','class','extends','super','import','export','default',
  'try','catch','finally','throw','async','await','yield',
  'null','undefined','true','false','this','arguments',
]);

function highlightJs(raw) {
  // Tokenise preserving strings, template literals, and comments
  const tokens = [];
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];

    if (ch === '"' || ch === "'") {
      const q = ch; let s = ch; i++;
      while (i < len) {
        if (raw[i] === '\\') { s += raw[i] + (raw[i + 1] ?? ''); i += 2; continue; }
        s += raw[i];
        if (raw[i++] === q) break;
      }
      tokens.push({ t: 'str', v: s }); continue;
    }
    if (ch === '`') {
      let s = '`'; i++;
      while (i < len) {
        if (raw[i] === '\\') { s += raw[i] + (raw[i + 1] ?? ''); i += 2; continue; }
        s += raw[i];
        if (raw[i++] === '`') break;
      }
      tokens.push({ t: 'str', v: s }); continue;
    }
    if (ch === '/' && raw[i + 1] === '/') {
      let s = ''; i += 2;
      while (i < len && raw[i] !== '\n') s += raw[i++];
      tokens.push({ t: 'comment', v: '//' + s }); continue;
    }
    if (ch === '/' && raw[i + 1] === '*') {
      let s = '/*'; i += 2;
      while (i < len && !(raw[i] === '*' && raw[i + 1] === '/')) s += raw[i++];
      s += '*/'; i += 2;
      tokens.push({ t: 'comment', v: s }); continue;
    }
    // Code segment
    let s = '';
    while (i < len) {
      const c = raw[i];
      if (c === '"' || c === "'" || c === '`') break;
      if (c === '/' && (raw[i + 1] === '/' || raw[i + 1] === '*')) break;
      s += c; i++;
    }
    if (s) tokens.push({ t: 'code', v: s });
  }

  return tokens.map(tok => {
    if (tok.t === 'str')     return `<span class="js-str">${escapeHtml(tok.v)}</span>`;
    if (tok.t === 'comment') return `<span class="js-comment">${escapeHtml(tok.v)}</span>`;

    // Highlight keywords, numbers, and function-call names within code segments
    const code = tok.v;
    const wordRe = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    const numRe  = /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
    const spans  = [];
    let m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(code)) !== null)
      spans.push({ s: m.index, e: m.index + m[0].length, v: m[0], t: 'word' });
    numRe.lastIndex = 0;
    while ((m = numRe.exec(code)) !== null)
      if (!spans.some(x => x.s === m.index)) // skip digits inside identifiers
        spans.push({ s: m.index, e: m.index + m[0].length, v: m[0], t: 'num' });
    spans.sort((a, b) => a.s - b.s);

    let html = ''; let last = 0;
    for (const sp of spans) {
      html += escapeHtml(code.slice(last, sp.s)); last = sp.e;
      if (sp.t === 'num') {
        html += `<span class="js-num">${escapeHtml(sp.v)}</span>`;
      } else if (JS_KW.has(sp.v)) {
        html += `<span class="js-kw">${escapeHtml(sp.v)}</span>`;
      } else {
        // Function call? peek past whitespace for '('
        let j = sp.e;
        while (j < code.length && code[j] === ' ') j++;
        html += code[j] === '('
          ? `<span class="js-fn">${escapeHtml(sp.v)}</span>`
          : escapeHtml(sp.v);
      }
    }
    html += escapeHtml(code.slice(last));
    return html;
  }).join('');
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

// ── Sidebar resize handle ───────────────────────────────────────────────────

const resizeHandle = document.getElementById('sidebar-resize-handle');
const sidebar      = document.getElementById('sidebar');
const MIN_W = 280;
const MAX_W = window.innerWidth - 300;

resizeHandle.addEventListener('mousedown', (startEvt) => {
  startEvt.preventDefault();
  const startX     = startEvt.clientX;
  const startWidth = sidebar.getBoundingClientRect().width;

  document.body.classList.add('resizing');

  function onMouseMove(e) {
    const delta    = startX - e.clientX;          // dragging left = wider
    const newWidth = Math.min(MAX_W, Math.max(MIN_W, startWidth + delta));
    document.documentElement.style.setProperty('--sidebar-w', `${newWidth}px`);
    window.electronAPI.resizeSidebar(newWidth);
  }

  function onMouseUp() {
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);
});

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
      <div class="el-header">
        <span class="el-tag ${tagClass(el.tag)}">&lt;${escapeHtml(el.tag)}&gt;</span>
        <div class="el-body">
          <div class="el-text">${escapeHtml(el.text)}</div>
          <div class="el-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="el-right">
          ${el.listeners && el.listeners.length
            ? `<span class="el-listener-badge" title="${el.listeners.length} event listener${el.listeners.length !== 1 ? 's' : ''}">${el.listeners.length} &#x1F4E1;</span>`
            : ''}
          <button class="el-copy-btn" title="Copy CSS selector">Copy</button>
        </div>
      </div>
      ${el.listeners && el.listeners.length ? `
      <div class="el-listeners" style="display:none">
        ${el.listeners.map(l => `
          <div class="el-listener-row">
            <div class="el-listener-top">
              <span class="el-event-type">${escapeHtml(l.type)}</span>
              <span class="el-fn-name">${escapeHtml(l.fnName)}</span>
              ${l.capture ? '<span class="el-flag">capture</span>' : ''}
              ${l.once    ? '<span class="el-flag">once</span>'    : ''}
              ${l.passive ? '<span class="el-flag">passive</span>' : ''}
              <button class="el-listener-copy" title="Copy listener source">Copy</button>
            </div>
            ${l.fnPreview ? `<pre class="el-fn-preview">${highlightJs(formatJs(l.fnPreview))}</pre>` : ''}
          </div>`).join('')}
      </div>` : ''}
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

    // Wire up per-listener copy buttons
    item.querySelectorAll('.el-listener-copy').forEach((btn, i) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = el.listeners[i];
        const text = l.fnPreview || l.fnName || l.type;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        });
      });
    });

    // Toggle listener section when the badge is clicked
    const listenerBadge = item.querySelector('.el-listener-badge');
    const listenersDiv  = item.querySelector('.el-listeners');
    if (listenerBadge && listenersDiv) {
      listenerBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = listenersDiv.style.display !== 'none';
        listenersDiv.style.display = open ? 'none' : 'block';
        listenerBadge.classList.toggle('active', !open);
      });
    }

    // Click the row to highlight the element in the browser
    item.title = 'Click to highlight element on page';
    item.addEventListener('click', (e) => {
      if (e.target === copyBtn) return;
      if (e.target.closest('.el-listener-copy')) return;
      if (e.target === listenerBadge || (listenerBadge && listenerBadge.contains(e.target))) return;
      window.electronAPI.highlightElement(el.selector);
      document.querySelectorAll('.el-item.el-active').forEach(r => r.classList.remove('el-active'));
      item.classList.add('el-active');
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

logListenersBtn.addEventListener('click', () => {
  const visOnly = visibleOnlyCb.checked;
  const pool    = visOnly ? scannedElements.filter(e => e.visible) : scannedElements;
  const withListeners = pool
    .filter(e => e.listeners && e.listeners.length > 0)
    .map(e => ({
      selector: e.selector,
      tag:      e.tag,
      text:     e.text,
      href:     e.href,
      id:       e.id,
      classes:  e.classes,
      role:     e.role,
      visible:  e.visible,
      rect:     e.rect,
      listeners: e.listeners,
    }));
  if (withListeners.length === 0) {
    alert('No elements with event listeners found. Try scanning the page first.');
    return;
  }
  window.electronAPI.exportListeners(withListeners);
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

// ── Network panel ─────────────────────────────────────────────────────────

const networkBadge       = document.getElementById('network-badge');
const networkList        = document.getElementById('network-list');
const networkEmptyState  = document.getElementById('network-empty-state');
const networkEnabledCb   = document.getElementById('network-enabled-cb');
const exportNetworkBtn   = document.getElementById('export-network-btn');
const clearNetworkBtn    = document.getElementById('clear-network-btn');
const networkFilterInput = document.getElementById('network-filter-input');
const networkFilterTags  = document.getElementById('network-filter-tags');
const networkSearchInput = document.getElementById('network-search-input');

let networkFilters  = [];
let networkCount    = 0;
let networkEntries  = [];

// ── Filter tag management ─────────────────────────────────────────────────

function renderFilterTags() {
  networkFilterTags.innerHTML = '';
  networkFilters.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'net-filter-chip';
    chip.innerHTML = `${escapeHtml(f)}<button class="net-chip-remove" data-i="${i}" title="Remove">&#x2715;</button>`;
    networkFilterTags.appendChild(chip);
  });
  networkFilterTags.querySelectorAll('.net-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      networkFilters.splice(+btn.dataset.i, 1);
      window.electronAPI.setNetworkFilters(networkFilters);
      renderFilterTags();
      updateNetworkHint();
    });
  });
}

function updateNetworkHint() {
  const hint = document.getElementById('network-filter-hint');
  hint.textContent = networkFilters.length === 0
    ? 'No filters = capture all requests'
    : `Capturing ${networkFilters.length} filter pattern${networkFilters.length !== 1 ? 's' : ''}`;
}

networkFilterInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const val = networkFilterInput.value.trim();
  if (!val || networkFilters.includes(val)) { networkFilterInput.value = ''; return; }
  networkFilters.push(val);
  window.electronAPI.setNetworkFilters(networkFilters);
  networkFilterInput.value = '';
  renderFilterTags();
  updateNetworkHint();
});

// ── Status helpers ────────────────────────────────────────────────────────

function statusClass(code) {
  if (!code) return 'net-status-err';
  if (code < 300) return 'net-status-ok';
  if (code < 400) return 'net-status-redir';
  if (code < 500) return 'net-status-warn';
  return 'net-status-err';
}

function methodClass(method) {
  const m = (method || '').toUpperCase();
  if (m === 'GET')    return 'net-method-get';
  if (m === 'POST')   return 'net-method-post';
  if (m === 'PUT' || m === 'PATCH') return 'net-method-put';
  if (m === 'DELETE') return 'net-method-del';
  return 'net-method-other';
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname + (u.search.length > 40 ? u.search.slice(0, 40) + '…' : u.search);
  } catch { return url; }
}

function formatHeaders(headers) {
  if (!headers || typeof headers !== 'object') return '(none)';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

function updateNetworkEmptyState() {
  networkEmptyState.style.display = networkCount === 0 ? 'flex' : 'none';
}

// ── Search / filter display ───────────────────────────────────────────────

function applyNetworkSearch() {
  const term = networkSearchInput.value.trim().toLowerCase();
  document.querySelectorAll('.net-item').forEach(el => {
    if (!term) { el.classList.remove('hidden'); return; }
    el.classList.toggle('hidden', !el.dataset.haystack.includes(term));
  });
}

networkSearchInput.addEventListener('input', applyNetworkSearch);

// ── Render a single network entry ─────────────────────────────────────────

function addNetworkEntry(entry, prepend = true) {
  networkCount++;
  networkBadge.textContent = networkCount;
  networkEntries[entry.id] = entry;
  updateNetworkEmptyState();

  const item = document.createElement('div');
  item.className = 'net-item';
  item.dataset.haystack = `${entry.method} ${entry.url} ${entry.statusCode || ''}`.toLowerCase();

  const short   = shortUrl(entry.url);
  const time    = new Date(entry.timestamp).toLocaleTimeString();
  const dur     = entry.duration != null ? `${entry.duration}ms` : '—';
  const status  = entry.error ? 'ERR' : (entry.statusCode || '—');
  const sCls    = entry.error ? 'net-status-err' : statusClass(entry.statusCode);
  const mCls    = methodClass(entry.method);

  item.innerHTML = `
    <div class="net-row">
      <span class="net-method ${mCls}">${escapeHtml(entry.method || '?')}</span>
      <span class="net-status ${sCls}">${status}</span>
      <span class="net-url" title="${escapeHtml(entry.url)}">${escapeHtml(short)}</span>
      <span class="net-dur">${dur}</span>
      <span class="net-time">${time}</span>
      <span class="net-chevron">&#9654;</span>
    </div>
    <div class="net-detail" style="display:none">
      <div class="net-detail-section">
        <div class="net-detail-label">Full URL</div>
        <pre class="net-detail-pre">${escapeHtml(entry.url)}</pre>
      </div>
      ${entry.requestBody ? `
      <div class="net-detail-section">
        <div class="net-detail-label">Request Body</div>
        <pre class="net-detail-pre">${escapeHtml(entry.requestBody)}</pre>
      </div>` : ''}
      <div class="net-detail-section">
        <div class="net-detail-label">Request Headers</div>
        <pre class="net-detail-pre">${escapeHtml(formatHeaders(entry.requestHeaders))}</pre>
      </div>
      <div class="net-detail-section">
        <div class="net-detail-label">Response Headers</div>
        <pre class="net-detail-pre">${escapeHtml(formatHeaders(entry.responseHeaders))}</pre>
      </div>
      ${entry.error ? `
      <div class="net-detail-section">
        <div class="net-detail-label net-detail-label-err">Error</div>
        <pre class="net-detail-pre net-detail-err">${escapeHtml(entry.error)}</pre>
      </div>` : ''}
      <div class="net-detail-actions">
        <button class="net-copy-url-btn">Copy URL</button>
        <button class="net-copy-json-btn">Copy as JSON</button>
      </div>
    </div>
  `;

  // Expand/collapse
  item.querySelector('.net-row').addEventListener('click', () => {
    const detail = item.querySelector('.net-detail');
    const open   = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : 'block';
    item.classList.toggle('net-expanded', !open);
  });

  // Copy buttons
  item.querySelector('.net-copy-url-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.url);
    const btn = e.target; btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy URL'; }, 1400);
  });
  item.querySelector('.net-copy-json-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    const btn = e.target; btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy as JSON'; }, 1400);
  });

  if (prepend) networkList.insertBefore(item, networkList.firstChild);
  else         networkList.appendChild(item);

  applyNetworkSearch();
}

// ── Controls ──────────────────────────────────────────────────────────────

networkEnabledCb.addEventListener('change', () => {
  window.electronAPI.setNetworkEnabled(networkEnabledCb.checked);
});

clearNetworkBtn.addEventListener('click', () => {
  window.electronAPI.clearNetworkLog();
  networkList.innerHTML = '';
  networkCount  = 0;
  networkEntries = [];
  networkBadge.textContent = '0';
  updateNetworkEmptyState();
});

exportNetworkBtn.addEventListener('click', () => {
  window.electronAPI.exportNetworkLog();
});

// ── IPC subscription ──────────────────────────────────────────────────────

window.electronAPI.onNetworkEntry((entry) => {
  addNetworkEntry(entry, true);
});

// ── Initialise ────────────────────────────────────────────────────────────

(async () => {
  // Load the session save path
  const filePath = await window.electronAPI.getSessionFile();
  sessionPath.textContent = `Saving to: ${filePath}`;

  // Replay any events captured before the renderer was ready
  const existing = await window.electronAPI.getEvents();
  existing.forEach((entry) => addEventToList(entry, false));

  // Restore network state
  const [existingNet, existingFilters] = await Promise.all([
    window.electronAPI.getNetworkLog(),
    window.electronAPI.getNetworkFilters(),
  ]);
  networkFilters = existingFilters || [];
  renderFilterTags();
  updateNetworkHint();
  existingNet.forEach(e => addNetworkEntry(e, false));

  updateEmptyState();
})();
