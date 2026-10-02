// 最小假 DOM：让真实的 extension/src/page/main.js 可以在 Node 里被确定性地驱动。
// 只提供 window/document/getComputedStyle/fetch 替身，不修改被测代码。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..', '..', 'extension');
const mainSource = fs.readFileSync(path.join(extensionDir, 'src/page/main.js'), 'utf8');

require('../../extension/src/curve/validate');
require('../../extension/src/curve/evaluate');
require('../../extension/src/geometry/content-rect');
require('../../extension/src/geometry/alignment');
require('../../extension/src/session/session');
require('../../extension/src/attempt/simulator');
require('../../extension/src/session/wake');
require('../../extension/src/telemetry/latency');
require('../../extension/src/preset/load');

const ELEMENT_IDS = [
  'demo-video', 'video-stage', 'target-time', 'play-toggle', 'jump-target',
  'wake-button', 'cancel-button', 'retry-button', 'reset-button', 'exit-button',
  'parameter-a', 'parameter-a-value', 'parameter-h', 'parameter-h-value',
  'parameter-k', 'parameter-k-value', 'source-label', 'source-note',
  'state-label', 'time-label', 'asset-empty', 'runtime-note',
  'waiting-bar', 'waiting-progress', 'fullscreen-button'
];

// 忠实一点的 style 替身：main.js 会同时用 style.left = ... 和 style.setProperty。
function createStyle() {
  const values = {};
  return {
    setProperty(name, value) { values[name] = String(value); },
    getPropertyValue(name) { return values[name] || ''; },
    removeProperty(name) { delete values[name]; }
  };
}

function element(tagName) {
  const listeners = new Map();
  const children = [];
  const attributes = new Map();
  const node = {
    tagName: String(tagName).toUpperCase(),
    children,
    parentNode: null,
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    className: '',
    dataset: {},
    style: createStyle(),
    paused: false,
    currentTime: 0,
    videoWidth: 0,
    videoHeight: 0,
    rect: { left: 0, top: 0, width: 0, height: 0 },
    classList: {
      add(name) { node.className = node.className ? node.className + ' ' + name : name; },
      contains(name) { return node.className.split(/\s+/).indexOf(name) >= 0; },
      toggle(name, force) {
        const has = node.classList.contains(name);
        const next = force === undefined ? !has : Boolean(force);
        if (next && !has) node.classList.add(name);
        if (!next && has) node.classList.remove(name);
        return next;
      },
      remove(name) {
        node.className = node.className.split(/\s+/).filter((item) => item && item !== name).join(' ');
      }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const handler of (listeners.get(type) || []).slice()) {
        handler(Object.assign({ target: node, preventDefault() {} }, event || {}));
      }
    },
    appendChild(child) { children.push(child); child.parentNode = node; return child; },
    remove() {
      if (!node.parentNode) return;
      const index = node.parentNode.children.indexOf(node);
      if (index >= 0) node.parentNode.children.splice(index, 1);
      node.parentNode = null;
    },
    contains(candidate) {
      if (candidate === node) return true;
      return children.some((child) => child.contains(candidate));
    },
    querySelector(selector) {
      const found = [];
      const walk = (current) => { for (const child of current.children) { found.push(child); walk(child); } };
      walk(node);
      if (/^[a-zA-Z]+$/.test(selector)) {
        return found.find((child) => child.tagName === selector.toUpperCase()) || null;
      }
      return null;
    },
    getBoundingClientRect() { return Object.assign({}, node.rect); },
    play() { node.paused = false; return Promise.resolve(); },
    pause() { node.paused = true; },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
    releasePointerCapture() {}
  };
  Object.defineProperty(node, 'innerHTML', {
    configurable: true,
    get() { return node.markup || ''; },
    set(markup) {
      node.markup = String(markup);
      children.length = 0;
      for (const match of String(markup).matchAll(/<([a-zA-Z]+)/g)) {
        const child = element(match[1]);
        child.parentNode = node;
        children.push(child);
      }
    }
  });
  return node;
}

function assetFetch(url) {
  const rel = String(url).replace(/^\.\.\//, '');
  const file = path.join(extensionDir, rel);
  if (!fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => JSON.parse(fs.readFileSync(file, 'utf8'))
  });
}

function createWindow() {
  const timers = new Map();
  const listeners = new Map();
  const mediaQueries = [];
  const observers = [];
  let sequence = 0;
  let nowMs = 0;

  const win = {
    performance: { now: () => nowMs },
    devicePixelRatio: 1,
    setTimeout(handler, delay) {
      const id = ++sequence;
      timers.set(id, { at: nowMs + Math.max(0, delay || 0), handler });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event) {
      for (const handler of (listeners.get(type) || []).slice()) handler(event || {});
    },
    matchMedia(query) {
      const media = {
        media: query,
        matches: false,
        handlers: [],
        addEventListener(type, handler) { if (type === 'change') this.handlers.push(handler); },
        removeEventListener(type, handler) {
          const index = this.handlers.indexOf(handler);
          if (index >= 0) this.handlers.splice(index, 1);
        }
      };
      mediaQueries.push(media);
      return media;
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    }
  };

  return {
    win,
    timers,
    mediaQueries,
    observers,
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= nowMs).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        for (const [id, timer] of due) { timers.delete(id); timer.handler(); }
      }
    }
  };
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }

async function createHarness(options = {}) {
  const elements = {};
  for (const id of ELEMENT_IDS) {
    const tag = id === 'demo-video' ? 'video' : (id === 'parameter-h' ? 'input' : 'div');
    elements[id] = element(tag);
  }
  elements['demo-video'].rect = { left: 100, top: 50, width: 1280, height: 800 };
  elements['video-stage'].rect = { left: 50, top: 0, width: 1400, height: 900 };
  elements['video-stage'].appendChild(elements['demo-video']);

  const documentListeners = new Map();
  const documentStub = {
    querySelector(selector) {
      const match = /^#(.+)$/.exec(selector);
      return match ? elements[match[1]] || null : null;
    },
    createElementNS(namespace, tag) { return element(tag); },
    addEventListener(type, handler) {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const handler of (documentListeners.get(type) || []).slice()) {
        handler(Object.assign({ preventDefault() {} }, event || {}));
      }
    }
  };

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    fetch: globalThis.fetch
  };
  const fake = createWindow();
  let config = {
    enableLocalMock: true,
    fallbackAfterMs: 1500,
    presetKey: 'demo-parabola',
    prewarmed: true,
    externalAttempt: 'off'
  };
  if (options.config) config = { ...config, ...options.config };
  fake.win.BreakGlass = globalThis.BreakGlass;

  globalThis.window = fake.win;
  globalThis.document = documentStub;
  globalThis.getComputedStyle = options.getComputedStyle || (() => ({ objectFit: 'contain', objectPosition: '50% 50%' }));
  globalThis.fetch = (url) => {
    if (String(url).indexOf('config.json') >= 0) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...config }) });
    }
    return assetFetch(url);
  };

  vm.runInThisContext(mainSource, { filename: 'main.js' });
  await flush();

  const video = elements['demo-video'];
  return {
    elements,
    video,
    stage: elements['video-stage'],
    document: documentStub,
    win: fake.win,
    advance: fake.advance,
    flush,
    now: fake.now,
    mediaQueries: fake.mediaQueries,
    observers: fake.observers,
    overlay() { return elements['video-stage'].children.find((child) => child.tagName === 'SVG') || null; },
    ready() {
      video.videoWidth = 1920;
      video.videoHeight = 1080;
      video.paused = true;
      video.currentTime = 12.5;
      video.dispatch('loadedmetadata');
    },
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.fetch = previous.fetch;
    }
  };
}

module.exports = { createHarness, flush, ELEMENT_IDS };