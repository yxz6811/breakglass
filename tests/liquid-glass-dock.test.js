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
function createDock() {
  let rect = { left: 0, right: 400, top: -80, bottom: -20 };
  const root = {
    dataset: {},
    style: { setProperty() {} },
    querySelector() {
      return { getBoundingClientRect: () => rect };
    },
    querySelectorAll() { return []; },
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
});
