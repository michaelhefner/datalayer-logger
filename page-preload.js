'use strict';

// page-preload.js
// Runs in the browsed page's JavaScript context (contextIsolation: false).
// Installs a Proxy over window.dataLayer BEFORE any page scripts execute,
// so every dataLayer.push() call is intercepted and forwarded to the main
// process via IPC.

const { ipcRenderer } = require('electron');

(function () {
  const backingArray = [];

  // Safe serialiser – handles circular refs, DOM nodes, functions, etc.
  function safeSerialise(value) {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(value, function replacer(key, val) {
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'symbol') return val.toString();
        if (typeof val === 'undefined') return '[undefined]';
        if (val instanceof Node) return `[${val.constructor.name}: ${val.nodeName}]`;
        if (val instanceof Error) return { message: val.message, stack: val.stack };
        if (val !== null && typeof val === 'object') {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      })
    );
  }

  function sendEvent(item) {
    try {
      ipcRenderer.send('datalayer-event', safeSerialise(item));
    } catch (err) {
      try {
        // Last-resort: send whatever toString gives us
        ipcRenderer.send('datalayer-event', { _raw: String(item), _error: err.message });
      } catch (_) { /* swallow */ }
    }
  }

  // The proxy intercepts push() calls while delegating everything else.
  const proxy = new Proxy(backingArray, {
    get(target, prop, receiver) {
      if (prop === 'push') {
        return function (...args) {
          args.forEach(sendEvent);
          return Array.prototype.push.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  // Install the property descriptor.
  // getter always returns our proxy so push() is always intercepted.
  // setter absorbs any explicit assignment (e.g. `window.dataLayer = []`)
  //   by processing pre-existing items and silently keeping our proxy.
  Object.defineProperty(window, 'dataLayer', {
    get() {
      return proxy;
    },
    set(newVal) {
      // If the page replaces dataLayer with a pre-populated array, capture
      // those items and merge them into the backing store.
      if (newVal !== proxy && Array.isArray(newVal) && newVal.length > 0) {
        newVal.forEach(sendEvent);
        Array.prototype.push.apply(backingArray, newVal);
      }
      // The getter always returns proxy regardless of what was assigned.
    },
    configurable: true,
    enumerable: true,
  });
})();

// ---------------------------------------------------------------------------
// addEventListener interceptor
// Patches EventTarget.prototype.addEventListener BEFORE page scripts run,
// recording every listener registration keyed by target element.
// Exposes window.__dlGetListeners__(el) so scanPageForClickables can read them.
// ---------------------------------------------------------------------------
(function () {
  const listenerMap = new WeakMap();
  const _add = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (this instanceof EventTarget) {
      const capture = typeof options === 'boolean' ? options
        : !!(options && options.capture);
      const once = !!(options && typeof options === 'object' && options.once);
      const passive = !!(options && typeof options === 'object' && options.passive);

      let fnName = '(anonymous)';
      let fnPreview = '';
      if (typeof listener === 'function') {
        fnName = listener.name || '(anonymous)';
        try { fnPreview = listener.toString(); } catch (e) { fnPreview = '[native code]'; }
      }

      const entry = { type, capture, once, passive, fnName, fnPreview };
      const existing = listenerMap.get(this);
      if (existing) {
        existing.push(entry);
      } else {
        listenerMap.set(this, [entry]);
      }
    }
    return _add.call(this, type, listener, options);
  };

  window.__dlGetListeners__ = (el) => listenerMap.get(el) || [];
})();
