const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual frame loop with a deterministic clock and a rendering adapter.
// This checks scheduling and animation time, not GPU output or rendering speed.
const source = fs.readFileSync(path.join(__dirname, '../site/background-gl.js'), 'utf8')
  .replace(/^import .*;\r?\n/m, '')
  .replace('export function createAsciiRippleGL', 'function createAsciiRippleGL');

function createBackground({ reduceMotion = false } = {}) {
  let stamp = 0;
  let nextId = 0;
  const queued = new Map();
  const listeners = new Map();
  const disposed = [];
  const timers = new Map();
  let renders = 0;
  class Vector2 {
    constructor(x, y) { this.set(x, y); }
    set(x, y) { this.x = x; this.y = y; return this; }
    copy(other) { return this.set(other.x, other.y); }
    lerp(other, amount) { this.x += (other.x - this.x) * amount; this.y += (other.y - this.y) * amount; return this; }
  }
  class Vector4 { constructor(...values) { this.set(...values); } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } }
  class Resource { dispose() { disposed.push(this); } }
  class WebGLRenderer extends Resource {
    getContext() { return { getExtension() { return null; }, getParameter() { return 'Test GPU'; } }; }
    setClearAlpha() {}
    setPixelRatio() {}
    setSize() {}
    render() { renders += 1; }
  }
  class Scene { constructor() { this.children = []; } add(node) { this.children.push(node); } }
  class Mesh { constructor(geometry, material) { Object.assign(this, { geometry, material }); } }
  const THREE = { WebGLRenderer, Scene, Mesh, Vector2, Vector4, CanvasTexture: Resource, ShaderMaterial: Resource, PlaneGeometry: Resource, OrthographicCamera: Resource };
  const canvas = { clientWidth: 1280, clientHeight: 720, dataset: {}, getBoundingClientRect() { return { left: 0, top: 0 }; } };
  const document = {
    hidden: false,
    createElement() { return { getContext() { return { clearRect() {}, fillText() {} }; } }; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const window = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    matchMedia() { return { matches: reduceMotion }; },
    requestAnimationFrame(fn) { queued.set(++nextId, fn); return nextId; },
    cancelAnimationFrame(id) { queued.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(fn) { timers.set(++nextId, fn); return nextId; },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = { window, document, THREE, performance: { now: () => stamp } };
  vm.runInNewContext(source, context);
  const background = context.createAsciiRippleGL({ canvas });
  return {
    background, document, listeners, queued, disposed, timers,
    renders() { return renders; },
    tick(time) {
      stamp = time;
      const [id, fn] = queued.entries().next().value;
      queued.delete(id);
      fn(time);
    },
    setTime(time) { stamp = time; }
  };
}

test('default background rendering stays near 30fps on a high-refresh display', () => {
  const harness = createBackground();
  for (let time = 0; time <= 1000; time += 1000 / 144) harness.tick(time);
  const frames = harness.background.info().frames;
  assert.ok(frames >= 25 && frames <= 36, 'rendered frames in 1s: ' + frames);
  harness.background.dispose();
  assert.equal(harness.queued.size, 0);
  assert.equal(harness.listeners.size, 0, 'disposed background retains no event handlers');
  assert.equal(harness.disposed.length, 4, 'geometry, material, atlas and renderer released');
});

test('reduced-motion background redraws its static frame after resizing', () => {
  const harness = createBackground({ reduceMotion: true });
  assert.equal(harness.queued.size, 0, 'no decorative animation loop');
  const before = harness.renders();
  harness.listeners.get('resize')();
  harness.timers.values().next().value();
  assert.equal(harness.renders(), before + 1, 'new canvas size has a visible static frame');
  harness.background.dispose();
  assert.equal(harness.listeners.size, 0);
});

test('background animation advances by elapsed time at 60Hz and 144Hz', () => {
  function phaseAt(refreshRate) {
    const harness = createBackground();
    harness.background.setFpsCap(0);
    for (let frame = 0; frame <= refreshRate; frame += 1) harness.tick(frame * 1000 / refreshRate);
    const phase = harness.background.info().flowPhase;
    harness.background.dispose();
    return phase;
  }
  assert.equal(phaseAt(60), 0.35);
  assert.equal(phaseAt(144), 0.35);
});

test('long pauses and hidden-page resume cannot inject a large animation step', () => {
  const harness = createBackground();
  harness.tick(0);
  harness.tick(1000);
  assert.equal(harness.background.info().flowPhase, 0.02, 'dropped frame step is limited to 50ms');
  harness.document.hidden = true;
  harness.listeners.get('visibilitychange')();
  assert.equal(harness.queued.size, 0);
  harness.setTime(10000);
  harness.document.hidden = false;
  harness.listeners.get('visibilitychange')();
  harness.tick(10000);
  assert.equal(harness.background.info().flowPhase, 0.02, 'first resumed frame resets delta time');
  harness.background.dispose();
});
