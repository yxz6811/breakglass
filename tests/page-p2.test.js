// 页面集成测试：用最小假 DOM 驱动真实的 extension/src/page/main.js，验证故事 2 的可见状态。
// 只提供 window/document/getComputedStyle/fetch 替身，不修改被测代码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..', 'extension');
const mainSource = fs.readFileSync(path.join(extensionDir, 'src/page/main.js'), 'utf8');

require('../extension/src/curve/validate');
require('../extension/src/curve/evaluate');
require('../extension/src/geometry/content-rect');
require('../extension/src/session/session');
require('../extension/src/attempt/simulator');
require('../extension/src/session/wake');
require('../extension/src/telemetry/latency');
require('../extension/src/preset/load');

const ELEMENT_IDS = [
  'demo-video', 'video-stage', 'target-time', 'play-toggle', 'jump-target',
  'wake-button', 'cancel-button', 'retry-button', 'reset-button', 'exit-button',
  'parameter-h', 'parameter-h-value', 'source-label', 'source-note',
  'state-label', 'time-label', 'asset-empty', 'runtime-note'
];

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
    style: {},
    paused: false,
    currentTime: 0,
    videoWidth: 0,
    videoHeight: 0,
    rect: { left: 0, top: 0, width: 0, height: 0 },
    classList: {
      add(name) { node.className = node.className ? node.className + ' ' + name : name; },
      contains(name) { return node.className.split(/\s+/).indexOf(name) >= 0; },
      remove() {}
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
  let sequence = 0;
  let nowMs = 0;
  const win = {
    performance: { now: () => nowMs },
    setTimeout(handler, delay) {
      const id = ++sequence;
      timers.set(id, { at: nowMs + Math.max(0, delay || 0), handler });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {}
  };
  return {
    win,
    advance(ms) {
      nowMs += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= nowMs).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        for (const [id, timer] of due) { timers.delete(id); timer.handler(); }
      }
    },
    now: () => nowMs
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
  const fakeWindow = createWindow();
  let config = {
    enableLocalMock: true,
    fallbackAfterMs: 1500,
    presetKey: 'demo-parabola',
    prewarmed: true,
    externalAttempt: 'off'
  };
  if (options.config) {
    config = { ...config, ...options.config };
    fakeWindow.win.BreakGlass = globalThis.BreakGlass;
  }
  fakeWindow.win.BreakGlass = globalThis.BreakGlass;

  globalThis.window = fakeWindow.win;
  globalThis.document = documentStub;
  globalThis.getComputedStyle = () => ({ objectFit: 'contain', objectPosition: '50% 50%' });
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
    win: fakeWindow.win,
    advance: fakeWindow.advance,
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

test('off 主路径：破壁后挂载覆盖层并持续显示来源', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    assert.equal(elements['runtime-note'].textContent.includes('off'), true);
    harness.ready();
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    assert.ok(overlay, '破壁后应挂载覆盖层');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(elements['retry-button'].hidden, true);
    const pathNode = overlay.querySelector('path');
    const points = [...pathNode.getAttribute('d').matchAll(/([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    assert.equal(points.length, 81);
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-h'].value, '0');
    harness.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(harness.overlay(), null);
    assert.equal(video.paused, true);
  } finally {
    harness.restore();
  }
});

test('hang：等待态可取消，1.5 秒后自动回退并持续显示原因', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null, '等待中不得有曲线');
    assert.equal(elements['cancel-button'].hidden, false);
    assert.equal(elements['cancel-button'].disabled, false);
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['state-label'].textContent.includes('正在等待外部结果'), true);
    harness.advance(1499);
    assert.equal(harness.overlay(), null);
    harness.advance(1);
    const overlay = harness.overlay();
    assert.ok(overlay, '1.5 秒后应自动出现曲线');
    assert.equal(elements['source-label'].textContent, '预先准备的示例 · 超时回退');
    assert.equal(elements['source-note'].textContent.includes('1.5 秒'), true);
    assert.equal(elements['cancel-button'].hidden, true);
    const summary = harness.win.__breakglassLatency.summary();
    assert.equal(summary['fallback-visible'].count >= 1, true, '应记录回退显现耗时');
    assert.equal(summary['fallback-visible'].max <= 100, true, 'SC-003 口径应小于 0.1 秒');
  } finally {
    harness.restore();
  }
});

test('取消等待：回到暂停画面，等待提示消失', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'late' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    assert.equal(elements['cancel-button'].hidden, false);
    elements['cancel-button'].dispatch('click');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
    assert.equal(elements['state-label'].textContent.includes('已取消等待'), true);
    harness.advance(5000);
    assert.equal(harness.overlay(), null, '迟到结果不得再打开交互层');
  } finally {
    harness.restore();
  }
});

test('invalid：非法外部结果进入可恢复错误并提供重试', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'invalid' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    harness.advance(0);
    await flush();
    assert.equal(harness.overlay(), null);
    assert.equal(elements['retry-button'].hidden, false);
    assert.equal(elements['retry-button'].disabled, false);
    assert.equal(elements['state-label'].textContent.includes('外部结果不可用'), true);
    assert.equal(elements['source-label'].textContent, '等待素材');
    elements['retry-button'].dispatch('click');
    assert.equal(elements['state-label'].textContent.includes('正在等待外部结果'), true);
  } finally {
    harness.restore();
  }
});

test('播放会让等待或交互状态一起结束', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const { elements, video } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    video.paused = false;
    video.dispatch('play');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
  } finally {
    harness.restore();
  }
});
