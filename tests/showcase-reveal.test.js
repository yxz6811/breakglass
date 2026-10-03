const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Frontend presentation only, within docs/BreakGlass-constitution.md. Execute
// the real controller: unseen elements enter once, visited content stays visible.
const source = fs.readFileSync(path.join(__dirname, '../site/showcase-effects.js'), 'utf8');
const compatSource = fs.readFileSync(path.join(__dirname, '../site/showcase-compat.js'), 'utf8');

function createEffects({ reduced = false, legacyMedia = false, intersectionObserver = true, bounds, extraBounds = [] } = {}) {
  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options = {}) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(callback);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, callback) {
      this.listeners.get(type)?.delete(callback);
    }
    send(type, options = {}) {
      for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, ...options });
    }
  }
  class MediaQueryList extends EventTarget {
    constructor(matches) {
      super();
      this.matches = matches;
      if (legacyMedia) {
        this.addEventListener = undefined;
        this.removeEventListener = undefined;
      }
    }
    addListener(callback) { EventTarget.prototype.addEventListener.call(this, 'change', callback); }
    removeListener(callback) { EventTarget.prototype.removeEventListener.call(this, 'change', callback); }
  }
  class Element {
    constructor(rect = {}) {
      this.classes = new Set();
      this.children = new Set();
      this.reveals = 0;
      this.bounds = { top: 1000, bottom: 1200, left: 100, right: 500, ...rect };
      this.classList = {
        add: name => { this.classes.add(name); if (name === 'is-revealed') this.reveals++; },
        remove: name => this.classes.delete(name),
        toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)
      };
    }
    getBoundingClientRect() { return { ...this.bounds }; }
    contains(target) { return target === this || this.children.has(target); }
  }
  const element = new Element(bounds);
  const elements = [element, ...extraBounds.map(rect => new Element(rect))];
  const control = {};
  element.children.add(control);
  const document = new EventTarget();
  document.hidden = false;
  document.documentElement = new Element();
  document.body = new Element();
  document.querySelectorAll = selector => selector === '.reveal' ? elements : [];
  document.querySelector = () => null;
  document.getElementById = () => null;
  const motion = new MediaQueryList(reduced);
  const screen = new MediaQueryList(false);
  const window = new EventTarget();
  window.innerHeight = 800;
  window.innerWidth = 1200;
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? motion : screen;
  const observers = [];
  class IntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      this.unobserved = new Set();
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); this.unobserved.add(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  }
  if (intersectionObserver) window.IntersectionObserver = IntersectionObserver;
  const context = vm.createContext({
    document, window, IntersectionObserver,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}
  });
  vm.runInContext(compatSource, context);
  vm.runInContext(source, context);
  function emit(target, intersecting, nextBounds = {}) {
    Object.assign(target.bounds, nextBounds);
    // The browser stops delivering new intersections after unobserve/disconnect.
    for (const observer of observers) {
      if (!observer.disconnected && observer.targets.has(target)) {
        observer.callback([{ target, isIntersecting: intersecting, boundingClientRect: target.getBoundingClientRect() }]);
      }
    }
  }
  return {
    element, elements, control, document, window, motion, screen, observers,
    shown: (target = element) => target.classes.has('is-revealed'),
    trigger: (on, nextBounds, target = element) => emit(target, on, nextBounds),
    focus() { document.send('focusin', { target: control }); },
    reduced(value) { motion.matches = value; motion.send('change'); },
    pagehide(persisted = false) { window.send('pagehide', { persisted }); }
  };
}

test('first intersection reveals once and visited content stays visible on every return', () => {
  const effects = createEffects();
  const observer = effects.observers[0];
  assert.equal(effects.shown(), false);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(observer.targets.has(effects.element), false);
  assert.equal(observer.unobserved.has(effects.element), true);
  for (const outside of [{ top: -300, bottom: -100 }, { top: 900, bottom: 1100 }]) {
    effects.trigger(false, outside);
    assert.equal(effects.shown(), true, 'visited content never hides after leaving');
    effects.trigger(true, { top: 100, bottom: 300 });
    assert.equal(effects.shown(), true);
  }
  assert.equal(effects.element.reveals, 1, 'returning does not repeat the entrance');
});

test('content already within the viewport at boot appears directly and is not observed', () => {
  const effects = createEffects({ bounds: { top: 100, bottom: 300 } });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
  assert.equal(effects.observers[0].targets.size, 0);
  effects.trigger(false, { top: -300, bottom: -100 });
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
});

test('unseen elements stay pending independently until their own entry', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  const second = effects.elements[1];
  effects.trigger(false);
  assert.equal(effects.shown(), false);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.shown(second), false, 'one element entering does not reveal a whole long section');
  assert.equal(effects.observers[0].targets.has(second), true);
  effects.trigger(true, { top: 100, bottom: 300 }, second);
  assert.equal(effects.shown(second), true);
  assert.equal(effects.observers[0].targets.size, 0);
});

test('a tall mobile element enters with any intersection instead of requiring a section ratio', () => {
  const effects = createEffects();
  assert.equal(effects.observers[0].options.threshold, 0);
  effects.trigger(true, { top: 750, bottom: 2750 });
  assert.equal(effects.shown(), true);
  effects.trigger(false, { top: -2000, bottom: 0 });
  effects.trigger(true, { top: -1900, bottom: 100 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
});

test('keyboard focus reveals its pending ancestor before interaction and leaves others pending', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  assert.equal(effects.shown(), false);
  effects.focus();
  assert.equal(effects.shown(), true);
  assert.equal(effects.observers[0].targets.has(effects.element), false);
  assert.equal(effects.shown(effects.elements[1]), false);
  effects.focus();
  assert.equal(effects.element.reveals, 1, 'a visited ancestor is no longer pending');
});

test('live reduced motion reveals all pending elements and does not hide them when reenabled', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  effects.reduced(true);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  assert.equal(effects.observers[0].disconnected, true);
  effects.reduced(false);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  assert.ok(effects.elements.every(element => element.reveals === 1));
});

test('initial reduced motion and a missing IntersectionObserver both keep content readable', () => {
  for (const options of [{ reduced: true }, { intersectionObserver: false }]) {
    const effects = createEffects({ ...options, extraBounds: [{ top: 1400, bottom: 1700 }] });
    assert.equal(effects.observers.length, 0);
    assert.ok(effects.elements.every(element => effects.shown(element)));
    effects.reduced(true);
    effects.reduced(false);
    assert.ok(effects.elements.every(element => effects.shown(element)));
    assert.ok(effects.elements.every(element => element.reveals === 1));
  }
});

test('pagehide disconnects observations and removes lifecycle listeners on final departure', () => {
  const effects = createEffects();
  assert.equal(effects.document.listeners.get('focusin').size, 1);
  effects.pagehide();
  assert.equal(effects.observers[0].disconnected, true);
  assert.equal(effects.observers[0].targets.size, 0);
  assert.equal(effects.document.listeners.get('focusin').size, 0);
  assert.equal(effects.motion.listeners.get('change').size, 0);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), false, 'departed page receives no new reveal work');
});

test('a bfcache departure preserves pending observations and once-only history', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  effects.trigger(true, { top: 100, bottom: 300 });
  effects.pagehide(true);
  assert.equal(effects.observers[0].disconnected, false);
  assert.equal(effects.document.listeners.get('focusin').size, 1);
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
  effects.trigger(true, { top: 100, bottom: 300 }, effects.elements[1]);
  assert.equal(effects.shown(effects.elements[1]), true);
});

test('legacy MediaQueryList boot preserves first-entry reveal and live reduced-motion readability', () => {
  const effects = createEffects({ legacyMedia: true, extraBounds: [{ top: 1400, bottom: 1700 }] });
  assert.equal(effects.motion.addEventListener, undefined);
  assert.equal(effects.document.documentElement.classes.has('effects-ready'), true);
  assert.equal(effects.motion.listeners.get('change').size, 1);
  assert.equal(effects.shown(), false);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.shown(effects.elements[1]), false);
  effects.reduced(true);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  assert.equal(effects.observers[0].disconnected, true);
  effects.reduced(false);
  assert.ok(effects.elements.every(element => element.reveals === 1), 'visited reveals remain once-only');
});

test('legacy preference and lifecycle listeners are removed on final departure', () => {
  const effects = createEffects({ legacyMedia: true });
  assert.equal(effects.screen.listeners.get('change').size, 2);
  effects.pagehide();
  assert.equal(effects.motion.listeners.get('change').size, 0);
  assert.equal(effects.screen.listeners.get('change').size, 0);
  assert.equal(effects.document.listeners.get('focusin').size, 0);
  assert.equal(effects.document.listeners.get('visibilitychange').size, 0);
  for (const type of ['scroll', 'resize', 'pagehide', 'pageshow']) {
    assert.equal(effects.window.listeners.get(type).size, 0);
  }
  assert.equal(effects.observers[0].disconnected, true);
  effects.reduced(true);
  effects.focus();
  assert.equal(effects.shown(), false, 'disposed effects no longer react to preferences or focus');
});
