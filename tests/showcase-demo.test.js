const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../site/showcase-demo.js'), 'utf8');

// Execute the real controller with a deterministic clock. The input adapter stands
// in for the existing graph renderer; these tests check ownership and scheduling.
function createDemo({ reduced = false } = {}) {
  let stamp = 0;
  let nextFrame = 0;
  let observer = null;
  const frames = new Map();
  const renderedValues = [];

  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options = {}) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(callback);
      this.listeners.set(type, listeners);
      if (options.signal) options.signal.addEventListener('abort', () => listeners.delete(callback), { once: true });
    }
    dispatchEvent(event) {
      for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event);
      return true;
    }
  }
  class Element extends EventTarget {
    constructor() {
      super();
      this.dataset = {};
      this.attributes = new Map();
      this.textContent = '';
      this.hidden = true;
      this.disabled = false;
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
      };
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
  }
  class InputEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
  }
  const section = new Element();
  const chart = new Element();
  const slider = new Element();
  const toggle = new Element();
  const status = new Element();
  const reset = new Element();
  const elements = new Map([
    ['.hands-on-chart', chart], ['#coefficient', slider], ['.demo-autoplay', toggle],
    ['.demo-motion-status', status], ['.curve-reset', reset]
  ]);
  section.querySelector = selector => elements.get(selector);
  slider.value = '0.65';
  slider.addEventListener('input', () => renderedValues.push(Number(slider.value)));
  // The graph module's existing reset handler is registered before this controller.
  reset.addEventListener('click', () => { slider.value = '0.65'; renderedValues.push(.65); });

  const document = new EventTarget();
  document.hidden = false;
  document.querySelector = selector => selector === '#p5' ? section : null;
  const motion = new EventTarget();
  motion.matches = reduced;
  const window = new EventTarget();
  window.matchMedia = () => motion;
  window.IntersectionObserver = true;
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  class IntersectionObserver {
    constructor(callback) { observer = callback; }
    observe(element) { assert.equal(element, chart); }
    disconnect() { observer = null; }
  }
  vm.runInNewContext(source, {
    document, window, Event: InputEvent, IntersectionObserver, AbortController,
    performance: { now: () => stamp }
  });

  function send(target, type, options = {}) { target.dispatchEvent(new InputEvent(type, options)); }
  return {
    section, slider, toggle, status, frames, renderedValues,
    visible(ratio) { observer([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    advance(milliseconds) {
      const end = stamp + milliseconds;
      while (stamp < end) {
        stamp = Math.min(end, stamp + 50);
        for (const [id, callback] of [...frames]) {
          if (frames.delete(id)) callback(stamp);
        }
      }
    },
    clickToggle() { send(toggle, 'click'); },
    input(value) { slider.value = String(value); send(slider, 'input', { isTrusted: true }); },
    pointerdown() { send(slider, 'pointerdown', { isTrusted: true }); },
    reset() { send(reset, 'click', { isTrusted: true }); },
    hidden(value) { document.hidden = value; send(document, 'visibilitychange'); },
    reduced(value) { motion.matches = value; send(motion, 'change'); },
    pagehide(persisted = false) { send(window, 'pagehide', { persisted }); }
  };
}

test('showcase curve automatically demonstrates once on visibility and returns to the original parameter', () => {
  const demo = createDemo();
  assert.equal(demo.frames.size, 0, 'offscreen graph has no animation');
  demo.visible(.8);
  assert.equal(demo.section.dataset.demoPlayback, 'playing');
  demo.advance(6000);
  assert.equal(demo.slider.value, '0.65');
  assert.equal(demo.section.dataset.demoPlayback, 'complete');
  assert.equal(demo.frames.size, 0);
  assert.ok(demo.renderedValues.some(value => value < .4), 'demonstrates a wider curve');
  assert.ok(demo.renderedValues.some(value => value > 1), 'demonstrates a narrower curve');
  demo.visible(0);
  demo.visible(.8);
  assert.equal(demo.frames.size, 0, 'returning to the graph does not replay automatically');
});

test('explicit pause freezes the chosen frame and resume finishes the remaining demonstration', () => {
  const demo = createDemo();
  demo.visible(.8);
  demo.advance(1000);
  demo.clickToggle();
  const pausedValue = demo.slider.value;
  const paints = demo.renderedValues.length;
  assert.equal(demo.section.dataset.demoPlayback, 'paused');
  assert.equal(demo.toggle.attributes.get('aria-pressed'), 'false');
  assert.equal(demo.frames.size, 0);
  demo.advance(2000);
  assert.equal(demo.slider.value, pausedValue);
  assert.equal(demo.renderedValues.length, paints);
  demo.clickToggle();
  assert.equal(demo.section.dataset.demoPlayback, 'playing');
  demo.advance(5000);
  assert.equal(demo.slider.value, '0.65');
  assert.equal(demo.section.dataset.demoPlayback, 'complete');
});

test('manual parameter input takes ownership and survives leaving and returning to the graph', () => {
  const demo = createDemo();
  demo.visible(.8);
  demo.advance(1000);
  demo.input(.92);
  assert.equal(demo.section.dataset.demoPlayback, 'manual');
  assert.equal(demo.frames.size, 0);
  demo.advance(7000);
  demo.visible(0);
  demo.visible(.8);
  assert.equal(demo.slider.value, '0.92');
  assert.equal(demo.frames.size, 0);
  assert.equal(demo.renderedValues.at(-1), .92);
});

test('pointer editing stops autoplay before input and reset remains under manual control', () => {
  const demo = createDemo();
  demo.visible(.8);
  demo.advance(700);
  demo.pointerdown();
  assert.equal(demo.frames.size, 0);
  demo.input(1.2);
  demo.reset();
  assert.equal(demo.slider.value, '0.65');
  assert.equal(demo.section.dataset.demoPlayback, 'manual');
  demo.visible(0);
  demo.visible(.8);
  assert.equal(demo.frames.size, 0, 'reset never re-enables automatic playback');
});

test('leaving the graph cancels animation and requires an explicit resume', () => {
  const demo = createDemo();
  demo.visible(.8);
  demo.advance(1000);
  const value = demo.slider.value;
  demo.visible(0);
  assert.equal(demo.frames.size, 0);
  assert.equal(demo.section.dataset.demoPlayback, 'paused');
  demo.advance(3000);
  demo.visible(.8);
  assert.equal(demo.slider.value, value);
  assert.equal(demo.frames.size, 0);
  demo.clickToggle();
  assert.equal(demo.frames.size, 1);
});

test('a hidden document or pagehide cancels scheduled work without changing the curve', () => {
  const demo = createDemo();
  demo.visible(.8);
  demo.advance(1000);
  const value = demo.slider.value;
  demo.hidden(true);
  assert.equal(demo.frames.size, 0);
  demo.advance(3000);
  demo.hidden(false);
  assert.equal(demo.frames.size, 0, 'tab visibility alone does not resume playback');
  assert.equal(demo.slider.value, value);
  demo.clickToggle();
  assert.equal(demo.frames.size, 1);
  demo.pagehide(true);
  assert.equal(demo.frames.size, 0);
});

test('reduced motion prevents automatic playback while preserving manual parameter changes', () => {
  const demo = createDemo({ reduced: true });
  demo.visible(.8);
  assert.equal(demo.frames.size, 0);
  assert.equal(demo.toggle.disabled, true);
  demo.input(.83);
  assert.equal(demo.slider.value, '0.83');
  assert.equal(demo.renderedValues.at(-1), .83);
  demo.reduced(false);
  demo.visible(.8);
  assert.equal(demo.frames.size, 0, 'a manual edit keeps ownership after preference changes');
  demo.clickToggle();
  assert.equal(demo.frames.size, 1);
  demo.reduced(true);
  assert.equal(demo.frames.size, 0, 'live reduced-motion preference stops active playback');
  assert.equal(demo.toggle.disabled, true);
  demo.input(1.1);
  assert.equal(demo.slider.value, '1.1');
  assert.equal(demo.renderedValues.at(-1), 1.1);
});
