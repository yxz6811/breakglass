// 最小假 DOM：让真实的 extension/src/page/main.js 可以在 Node 里被确定性地驱动。
// 只提供 window/document/getComputedStyle/fetch 替身，不修改被测代码。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..', '..', 'extension');
const mainSource = fs.readFileSync(path.join(extensionDir, 'src/page/main.js'), 'utf8');

require('../../extension/src/curve/validate');
require('../../extension/src/curve/evaluate');
require('../../extension/src/curve/current-frame');
require('../../extension/src/geometry/content-rect');
require('../../extension/src/geometry/alignment');
require('../../extension/src/geometry/figures');
require('../../extension/src/session/session');
require('../../extension/src/attempt/simulator');
require('../../extension/src/session/wake');
require('../../extension/src/telemetry/latency');
require('../../extension/src/preset/load');
require('../../extension/src/preset/place-in-frame');
require('../../extension/src/lesson/reading');
require('../../extension/src/lesson/ask');
require('../../extension/src/tutor/numbers');
require('../../extension/src/tutor/figures');
require('../../extension/src/tutor/parse');
require('../../extension/src/tutor/ask');

const ELEMENT_IDS = [
  'demo-video', 'video-stage', 'target-time', 'play-toggle', 'jump-target',
  'wake-button', 'cancel-button', 'retry-button', 'reset-button', 'exit-button',
  'parameter-a', 'parameter-a-value', 'parameter-h', 'parameter-h-value',
  'parameter-k', 'parameter-k-value', 'source-label', 'source-note',
  'state-label', 'time-label', 'asset-empty', 'runtime-note',
  'waiting-bar', 'waiting-progress', 'fullscreen-button',
  'wake-reason', 'reset-reason', 'local-video', 'preset-video',
  'lesson-status', 'lesson-cancel', 'lesson-next', 'lesson-endpoint', 'lesson-note',
  'stage-banner', 'stage-banner-title', 'stage-banner-detail',
  'figure-kind', 'figure-title', 'figure-formula', 'figure-note',
  'parabola-parameters', 'local-parameters',
  'figure-row-1', 'figure-row-2', 'figure-row-3',
  'figure-label-1', 'figure-label-2', 'figure-label-3',
  'parameter-figure-1', 'parameter-figure-2', 'parameter-figure-3',
  'parameter-figure-1-value', 'parameter-figure-2-value', 'parameter-figure-3-value',
  'tutor-form', 'tutor-input', 'tutor-send', 'tutor-log', 'tutor-hint', 'tutor-examples'
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
    removeAttribute(name) { attributes.delete(name); },
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
    listenerCount(type) {
      return type ? (listeners.get(type) || []).length : [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
    },
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
      const taggedClass = /^([a-zA-Z]+)\.([A-Za-z0-9_-]+)$/.exec(selector);
      if (taggedClass) {
        return found.find((child) => child.tagName === taggedClass[1].toUpperCase()
          && child.classList.contains(taggedClass[2])) || null;
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
  if (String(tagName).toLowerCase() === 'video') {
    node.duration = 0;
    node.readyState = 2;
    node.src = '';
    node.seeking = false;
    // holdSeeks 为 true 时定位停在 seeking，直到测试调用 harness.finishSeek()。
    node.holdSeeks = false;
    let time = 0;
    Object.defineProperty(node, 'currentTime', {
      configurable: true,
      enumerable: true,
      get() { return time; },
      set(value) {
        const next = Number(value);
        const changed = next !== time;
        time = next;
        if (!changed) return;
        if (node.holdSeeks) node.seeking = true;
        else node.dispatch('seeked');
      }
    });
  }
  Object.defineProperty(node, 'innerHTML', {
    configurable: true,
    get() { return node.markup || ''; },
    set(markup) {
      node.markup = String(markup);
      children.length = 0;
      for (const match of String(markup).matchAll(/<([a-zA-Z]+)([^>]*)>/g)) {
        const child = element(match[1]);
        const attrs = match[2] || '';
        const className = /class="([^"]*)"/.exec(attrs);
        if (className) child.className = className[1];
        const strokeWidth = /stroke-width="([^"]*)"/.exec(attrs);
        if (strokeWidth) child.setAttribute('stroke-width', strokeWidth[1]);
        child.parentNode = node;
        children.push(child);
      }
    }
  });
  return node;
}

/**
 * 按演示页标记补上 disabled / hidden。假节点默认都是可点的，否则测不到按钮初始禁用。
 * @param {Record<string, { disabled: boolean, hidden: boolean }>} elements
 */
function applyMarkupState(elements) {
  const html = fs.readFileSync(path.join(extensionDir, 'demo/index.html'), 'utf8');
  for (const id of Object.keys(elements)) {
    const match = new RegExp('<[^>]*\\bid="' + id + '"[^>]*>').exec(html);
    if (!match) continue;
    if (/(?:^|[\s/])disabled(?:=|\s|>|$)/.test(match[0])) elements[id].disabled = true;
    if (/(?:^|[\s/])hidden(?:=|\s|>|$)/.test(match[0])) elements[id].hidden = true;
  }
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
  const frames = new Map();
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
    requestAnimationFrame(handler) {
      const id = ++sequence;
      frames.set(id, handler);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
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
    listenerCount(type) {
      return type ? (listeners.get(type) || []).length : [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
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
    frames,
    mediaQueries,
    observers,
    now: () => nowMs,
    frame(ms = 16) {
      nowMs += ms;
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((handler) => handler(nowMs));
    },
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
    const tag = id === 'demo-video' ? 'video'
      : (id === 'figure-kind' ? 'select'
        : (id === 'preset-video' || id === 'tutor-send' ? 'button'
          : (id === 'tutor-form' ? 'form'
            : (/^parameter-(?:a|h|k|figure-[123])$/.test(id) || id === 'local-video' || id === 'lesson-endpoint' || id === 'lesson-note' || id === 'tutor-input' ? 'input' : 'div'))));
    elements[id] = element(tag);
  }
  applyMarkupState(elements);
  elements['demo-video'].rect = { left: 100, top: 50, width: 1280, height: 800 };
  elements['video-stage'].rect = { left: 50, top: 0, width: 1400, height: 900 };
  elements['video-stage'].appendChild(elements['demo-video']);

  const canvasCaptures = [], canvasEncodes = [];
  const canvasOptions = options.canvas || {};
  // A genuine local JPEG is an encoding fixture; this canvas double does not decode video pixels.
  const canvasImage = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '../../breakglass-reader/tests/helpers/fixtures/demo-6451-640x402.jpg')).toString('base64');
  function createCanvas() {
    const canvas = element('canvas');
    canvas.width = 0; canvas.height = 0;
    canvas.getContext = (type) => {
      if (canvasOptions.context === false || type !== '2d') return null;
      return { drawImage(source, ...args) {
        canvasCaptures.push({ source, captureTime: source.currentTime, width: canvas.width, height: canvas.height, args });
        if (canvasOptions.drawError) throw canvasOptions.drawError;
      } };
    };
    canvas.toDataURL = (type, quality) => {
      canvasEncodes.push({ type, quality, width: canvas.width, height: canvas.height });
      if (canvasOptions.encodeError) throw canvasOptions.encodeError;
      return canvasOptions.image === undefined ? canvasImage : canvasOptions.image;
    };
    return canvas;
  }
  const documentListeners = new Map();
  const documentStub = {
    hidden: false,
    visibilityState: 'visible',
    querySelector(selector) {
      const match = /^#(.+)$/.exec(selector);
      return match ? elements[match[1]] || null : null;
    },
    createElement(tag) { return String(tag).toLowerCase() === 'canvas' ? createCanvas() : element(tag); },
    createElementNS(namespace, tag) { return element(tag); },
    addEventListener(type, handler) {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = documentListeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    listenerCount(type) {
      return type ? (documentListeners.get(type) || []).length : [...documentListeners.values()].reduce((sum, list) => sum + list.length, 0);
    },
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
    fetch: globalThis.fetch,
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage
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
  if (options.pageOptions) {
    documentStub.body = { dataset: { unifiedWorkspace: true } };
    globalThis.location = { hostname: 'localhost' };
  }
  if (options.storage) globalThis.sessionStorage = options.storage;
  globalThis.getComputedStyle = options.getComputedStyle || (() => ({ objectFit: 'contain', objectPosition: '50% 50%' }));
  const defaultFetch = (url) => {
    if (String(url).indexOf('config.json') >= 0) {
      if (options.configPromise) return Promise.resolve(options.configPromise).then((value) => ({ ok: true, status: 200, json: async () => value }));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...config }) });
    }
    if (options.packagedVideoErrors && String(url).indexOf('breakglass-demo-9s.mp4') >= 0) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return assetFetch(url);
  };
  globalThis.fetch = (url, init) => options.fetchImpl ? options.fetchImpl(url, init, defaultFetch) : defaultFetch(url, init);
  if (options.packagedVideoErrors) {
    const probe = elements['demo-video'];
    let src = '';
    Object.defineProperty(probe, 'src', {
      configurable: true,
      enumerable: true,
      get() { return src; },
      set(value) {
        src = value == null ? '' : String(value);
        if (src.indexOf('breakglass-demo-9s.mp4') >= 0) fake.win.setTimeout(() => probe.dispatch('error'), 0);
      }
    });
  }

  vm.runInThisContext(mainSource, { filename: 'main.js' });
  const page = options.pageOptions
    ? fake.win.BreakGlass.curvePage.createCurvePage({ ...options.pageOptions, document: documentStub, window: fake.win, video: elements['demo-video'], stage: elements['video-stage'] })
    : fake.win.BreakGlass.curvePage.page;
  await flush();

  const video = elements['demo-video'];
  return {
    elements,
    video,
    stage: elements['video-stage'],
    document: documentStub,
    win: fake.win,
    page,
    advance: fake.advance,
    frame: fake.frame,
    flush,
    now: fake.now,
    mediaQueries: fake.mediaQueries,
    observers: fake.observers,
    timers: fake.timers,
    frames: fake.frames,
    canvasCaptures,
    canvasEncodes,
    overlay() { return elements['video-stage'].children.find((child) => child.tagName === 'SVG') || null; },
    ready() {
      video.duration = 9.383333;
      video.videoWidth = 1920;
      video.videoHeight = 1080;
      video.paused = true;
      video.currentTime = 6;
      video.dispatch('loadedmetadata');
    },
    /** 放行 holdSeeks 挂住的那次定位。 */
    finishSeek() {
      video.seeking = false;
      video.dispatch('seeked');
    },
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.getComputedStyle = previous.getComputedStyle;
      globalThis.fetch = previous.fetch;
      globalThis.location = previous.location;
      globalThis.sessionStorage = previous.sessionStorage;
    }
  };
}

module.exports = { createHarness, flush, ELEMENT_IDS };
