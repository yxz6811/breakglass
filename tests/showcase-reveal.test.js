const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Frontend presentation only, within docs/BreakGlass-constitution.md. Execute
// the real controller: both scroll directions replay only after a complete exit.
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
      this.properties = new Map();
      this.style = { setProperty: (name, value) => this.properties.set(name, value) };
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
  document.activeElement = null;
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
    focus(target = control) { document.activeElement = target; document.send('focusin', { target }); },
    reduced(value) { motion.matches = value; motion.send('change'); },
    pagehide(persisted = false) { window.send('pagehide', { persisted }); }
  };
}

test('a complete exit rearms a reveal for both upward and downward returns', () => {
  const effects = createEffects();
  const observer = effects.observers[0];
  assert.equal(effects.shown(), false);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(observer.targets.has(effects.element), true, 'observations remain live after entry');
  effects.trigger(true, { top: 120, bottom: 320 });
  assert.equal(effects.element.reveals, 1, 'updates inside the viewport do not restart motion');
  for (const outside of [{ top: -300, bottom: -100 }, { top: 900, bottom: 1100 }]) {
    effects.trigger(false, outside);
    assert.equal(effects.shown(), false, 'a fully offscreen element is ready for its next entrance');
    assert.equal(effects.element.properties.get('--reveal-from-y'), outside.bottom < 0 ? '-22px' : '22px');
    effects.trigger(true, { top: 100, bottom: 300 });
    assert.equal(effects.shown(), true);
  }
  assert.equal(effects.element.reveals, 3, 'every return repeats the entrance');
  assert.equal(observer.unobserved.size, 0);
});

test('content within the viewport at boot appears directly and remains eligible for later returns', () => {
  const effects = createEffects({ bounds: { top: 100, bottom: 300 } });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
  assert.equal(effects.observers[0].targets.size, 1);
  effects.trigger(false, { top: -300, bottom: -100 });
  assert.equal(effects.shown(), false);
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 2);
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
  assert.equal(effects.observers[0].targets.size, 2);
});

test('a tall mobile element enters with any intersection instead of requiring a section ratio', () => {
  const effects = createEffects();
  assert.equal(effects.observers[0].options.threshold, 0);
  effects.trigger(true, { top: 750, bottom: 2750 });
  assert.equal(effects.shown(), true);
  effects.trigger(false, { top: -2000, bottom: 0 });
  effects.trigger(true, { top: -1900, bottom: 100 });
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 2);
});

test('partially visible elements do not hide or replay when an intersection report is false', () => {
  const effects = createEffects();
  effects.trigger(true, { top: 100, bottom: 300 });
  for (const bounds of [{ top: -1990, bottom: 10 }, { top: 790, bottom: 2790 }]) {
    effects.trigger(false, bounds);
    assert.equal(effects.shown(), true);
    effects.trigger(true, bounds);
  }
  assert.equal(effects.element.reveals, 1, 'a tall element stays settled while any part remains visible');
});

test('keyboard focus reveals its ancestor, protects it outside the viewport, and rearms after focus moves', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  assert.equal(effects.shown(), false);
  effects.focus();
  assert.equal(effects.shown(), true);
  assert.equal(effects.observers[0].targets.has(effects.element), true);
  assert.equal(effects.shown(effects.elements[1]), false);
  effects.focus();
  assert.equal(effects.element.reveals, 1, 'existing focus does not repeat the entrance');
  effects.trigger(false, { top: -300, bottom: -100 });
  assert.equal(effects.shown(), true, 'a focused control must stay readable during scrolling');
  effects.focus(effects.document.body);
  assert.equal(effects.shown(), false, 'the offscreen ancestor can rearm once focus leaves');
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.element.reveals, 2);
});

test('live reduced motion reveals all content and reenabling motion preserves visible content', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  effects.trigger(true, { top: 100, bottom: 300 });
  effects.reduced(true);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  assert.equal(effects.observers[0].disconnected, true);
  effects.reduced(false);
  assert.equal(effects.shown(), true, 'the content being read never disappears when preferences change');
  assert.equal(effects.shown(effects.elements[1]), false, 'offscreen content prepares for a later entrance');
  assert.ok(effects.elements.every(element => element.reveals === 1));
  assert.equal(effects.observers[1].targets.size, 2);
  effects.trigger(true, { top: 100, bottom: 300 }, effects.elements[1]);
  assert.equal(effects.elements[1].reveals, 2);
});

test('initial reduced motion keeps content readable and observing can start when it is disabled', () => {
  const effects = createEffects({ reduced: true, bounds: { top: 100, bottom: 300 } });
  assert.equal(effects.observers.length, 0);
  assert.equal(effects.shown(), true);
  effects.reduced(false);
  assert.equal(effects.shown(), true);
  assert.equal(effects.observers[0].targets.size, 1);
  effects.trigger(false, { top: 900, bottom: 1100 });
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.element.reveals, 2);
});

test('queued entries from a replaced observer cannot hide or reanimate current content', () => {
  const effects = createEffects({ bounds: { top: 100, bottom: 300 } });
  const oldObserver = effects.observers[0];
  effects.reduced(true);
  effects.reduced(false);
  oldObserver.callback([{ target: effects.element, isIntersecting: false, boundingClientRect: { top: 900, bottom: 1100 } }]);
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
});

test('without IntersectionObserver all content stays directly readable through preference changes', () => {
  const effects = createEffects({ intersectionObserver: false, extraBounds: [{ top: 1400, bottom: 1700 }] });
  assert.equal(effects.observers.length, 0);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  effects.reduced(true);
  effects.reduced(false);
  assert.ok(effects.elements.every(element => effects.shown(element)));
  assert.ok(effects.elements.every(element => element.reveals === 1));
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

test('a bfcache departure preserves observations and repeated return behavior', () => {
  const effects = createEffects({ extraBounds: [{ top: 1400, bottom: 1700 }] });
  effects.trigger(true, { top: 100, bottom: 300 });
  effects.pagehide(true);
  assert.equal(effects.observers[0].disconnected, false);
  assert.equal(effects.document.listeners.get('focusin').size, 1);
  assert.equal(effects.shown(), true);
  assert.equal(effects.element.reveals, 1);
  effects.trigger(true, { top: 100, bottom: 300 }, effects.elements[1]);
  assert.equal(effects.shown(effects.elements[1]), true);
  effects.trigger(false, { top: 900, bottom: 1100 });
  effects.trigger(true, { top: 100, bottom: 300 });
  assert.equal(effects.element.reveals, 2);
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
  assert.equal(effects.shown(), true);
  assert.equal(effects.shown(effects.elements[1]), false);
  effects.trigger(true, { top: 100, bottom: 300 }, effects.elements[1]);
  assert.equal(effects.elements[1].reveals, 2, 'legacy media listeners also resume repeated reveals');
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
