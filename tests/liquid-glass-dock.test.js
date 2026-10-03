/**
 * 顶栏收起计时器：动画还没落到指针下时，到点要再看一次指针位置。
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

require('../extension/src/ui/magnify.js');

global.window = {
  BreakGlassUI: { magnify: globalThis.BreakGlassUI.magnify },
  addEventListener() {},
  removeEventListener() {},
  setTimeout(fn) { return global.setTimeout(fn); },
  clearTimeout(id) { global.clearTimeout(id); },
  requestAnimationFrame() { return 0; },
  cancelAnimationFrame() {},
  matchMedia() { return { matches: false }; }
};
global.document = {
  readyState: 'complete',
  querySelectorAll() { return []; },
  addEventListener() {}
};

require('../extension/src/ui/liquid-glass.js');

const LiquidGlassDock = global.window.BreakGlassUI.LiquidGlassDock;

/**
 * @returns {{ root: object, moveRect: (next: object) => void, dock: object }}
 */
function createDock(options = {}) {
  let rect = { left: 0, right: 400, top: -80, bottom: -20 };
  const root = {
    id: options.id || '',
    dataset: {},
    style: { setProperty() {} },
    querySelector() {
      return { getBoundingClientRect: () => rect };
    },
    querySelectorAll() { return options.items || []; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return rect; }
  };
  const dock = new LiquidGlassDock(root);
  return {
    root,
    dock,
    moveRect(next) { rect = next; }
  };
}

describe('dock hide timer', { concurrency: 1 }, () => {
test('hide timer keeps the dock when the pointer is on its landed position', () => {
  const pending = [];
  const realSetTimeout = global.window.setTimeout;
  const realClearTimeout = global.window.clearTimeout;
  global.window.setTimeout = (fn) => {
    pending.push(fn);
    return pending.length;
  };
  global.window.clearTimeout = (id) => {
    if (id) pending[id - 1] = null;
  };
  try {
    const { root, dock, moveRect } = createDock();
    dock.onWindowPointer({ clientX: 120, clientY: 5 });
    assert.equal(root.dataset.revealed, 'true');

    dock.onWindowPointer({ clientX: 120, clientY: 40 });
    assert.equal(pending.length, 1);

    moveRect({ left: 0, right: 400, top: 0, bottom: 56 });
    pending[0]();
    assert.equal(root.dataset.revealed, 'true');
  } finally {
    global.window.setTimeout = realSetTimeout;
    global.window.clearTimeout = realClearTimeout;
  }
});

test('hide timer still dismisses the dock when the pointer has left', () => {
  const pending = [];
  const realSetTimeout = global.window.setTimeout;
  const realClearTimeout = global.window.clearTimeout;
  global.window.setTimeout = (fn) => {
    pending.push(fn);
    return pending.length;
  };
  global.window.clearTimeout = (id) => {
    if (id) pending[id - 1] = null;
  };
  try {
    const { root, dock, moveRect } = createDock();
    dock.onWindowPointer({ clientX: 120, clientY: 5 });
    dock.onWindowPointer({ clientX: 120, clientY: 400 });
    moveRect({ left: 0, right: 400, top: 0, bottom: 56 });
    pending[0]();
    assert.equal(root.dataset.revealed, undefined);
  } finally {
    global.window.setTimeout = realSetTimeout;
    global.window.clearTimeout = realClearTimeout;
  }
});

test('visible reveal control opens the dock and focuses the first available action', () => {
  const originalQuery = global.document.querySelector;
  const listeners = new Map();
  const attributes = {};
  const control = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(name, value) { attributes[name] = value; }
  };
  let focused = 0;
  const disabled = { disabled: true, style: {}, offsetLeft: 0, offsetWidth: 44 };
  const action = { style: {}, offsetLeft: 52, offsetWidth: 44, focus() { focused += 1; } };
  global.document.querySelector = () => control;
  try {
    const { dock, root } = createDock({ id: 'demo-toolbar', items: [disabled, action] });
    listeners.get('click')();
    assert.equal(root.dataset.revealed, 'true');
    assert.equal(attributes['aria-expanded'], 'true');
    assert.equal(focused, 1, 'keyboard/click activation hands focus to an enabled action');
    dock.destroy();
    assert.equal(listeners.size, 0, 'reveal control handlers are removed on disposal');
  } finally {
    global.document.querySelector = originalQuery;
  }
});

test('devices without hover keep the dock visible after the pointer leaves', () => {
  const originalMatch = global.window.matchMedia;
  const originalTimer = global.window.setTimeout;
  let timers = 0;
  global.window.matchMedia = (query) => ({ matches: query === '(hover: none)' });
  global.window.setTimeout = () => { timers += 1; return timers; };
  try {
    const { dock, root } = createDock();
    assert.equal(root.dataset.revealed, 'true');
    dock.onWindowPointer({ clientX: 900, clientY: 900 });
    dock.scheduleHide();
    assert.equal(timers, 0);
    assert.equal(root.dataset.revealed, 'true');
    dock.destroy();
  } finally {
    global.window.matchMedia = originalMatch;
    global.window.setTimeout = originalTimer;
  }
});

test('reading-state hold keeps the dock and expanded state until released', () => {
  const originalObserver = global.MutationObserver;
  const originalQuery = global.document.querySelector;
  const originalTimer = global.window.setTimeout;
  const originalClear = global.window.clearTimeout;
  const pending = [];
  const attributes = {};
  let onHoldChange;
  let disconnected = false;
  const control = {
    addEventListener() {}, removeEventListener() {},
    setAttribute(name, value) { attributes[name] = value; }
  };
  global.document.querySelector = () => control;
  global.window.setTimeout = (fn) => { pending.push(fn); return pending.length; };
  global.window.clearTimeout = (id) => { pending[id - 1] = null; };
  global.MutationObserver = class {
    constructor(fn) { onHoldChange = fn; }
    observe(root, options) { assert.deepEqual(options.attributeFilter, ['data-hold']); }
    disconnect() { disconnected = true; }
  };
  try {
    const { dock, root } = createDock({ id: 'demo-toolbar' });
    dock.reveal();
    dock.scheduleHide();
    root.dataset.hold = 'true';
    onHoldChange();
    assert.equal(pending[0], null, 'a hold cancels an earlier hide timer');
    dock.onWindowPointer({ clientX: 900, clientY: 900 });
    assert.equal(pending.length, 1, 'pointer departure cannot dismiss a held dock');
    assert.equal(root.dataset.revealed, 'true');
    assert.equal(attributes['aria-expanded'], 'true');
    delete root.dataset.hold;
    onHoldChange();
    pending[1]();
    assert.equal(root.dataset.revealed, undefined);
    assert.equal(attributes['aria-expanded'], 'false');
    dock.destroy();
    assert.equal(disconnected, true);
  } finally {
    global.MutationObserver = originalObserver;
    global.document.querySelector = originalQuery;
    global.window.setTimeout = originalTimer;
    global.window.clearTimeout = originalClear;
  }
});
});
