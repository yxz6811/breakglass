const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Frontend entrance behavior only, within docs/BreakGlass-constitution.md.
// Run the production controller and event-ownership helper without a DOM library.
const compatSource = fs.readFileSync(path.join(__dirname, '../site/showcase-compat.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../site/showcase-scroll-lock.js'), 'utf8');

function createPage({ x = 0, y = 360, width = 1200, clientWidth = 1185, padding = '8px', styles = {} } = {}) {
  class Style {
    constructor(values) {
      this.values = new Map();
      for (const [name, value] of Object.entries(values)) {
        const entry = typeof value === 'string' ? { value, priority: '' } : value;
        this.setProperty(name, entry.value, entry.priority);
      }
    }
    getPropertyValue(name) { return this.values.get(name)?.value || ''; }
    getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
    setProperty(name, value, priority = '') { this.values.set(name, { value: String(value), priority }); }
    removeProperty(name) {
      const previous = this.getPropertyValue(name);
      this.values.delete(name);
      return previous;
    }
  }
  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options = {}) {
      const handlers = this.listeners.get(type) || [];
      handlers.push({ callback, options });
      this.listeners.set(type, handlers);
    }
    removeEventListener(type, callback, options = {}) {
      const capture = typeof options === 'boolean' ? options : !!options.capture;
      this.listeners.set(type, (this.listeners.get(type) || []).filter(handler => (
        handler.callback !== callback || !!handler.options.capture !== capture
      )));
    }
    dispatch(type, data = {}) {
      const event = {
        type, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...data
      };
      for (const { callback } of [...(this.listeners.get(type) || [])]) callback(event);
      return event;
    }
    count(type) { return (this.listeners.get(type) || []).length; }
  }
  class Element {
    constructor(tag = 'div', attributes = {}, parent = null) {
      this.tag = tag;
      this.attributes = attributes;
      this.parent = parent;
      this.isContentEditable = attributes.contenteditable === '' || attributes.contenteditable === 'true';
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) {
      for (let element = this; element; element = element.parent) {
        if (selector === 'a[href]') {
          if (element.tag === 'a' && element.getAttribute('href') !== null) return element;
        } else if (['input', 'textarea', 'select'].includes(element.tag)
          || element.getAttribute('contenteditable') !== null
          || element.getAttribute('role') === 'textbox') return element;
      }
      return null;
    }
  }
  const classes = new Set();
  const root = {
    clientWidth, dataset: {}, style: new Style(styles),
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) }
  };
  const document = new EventTarget();
  document.documentElement = root;
  document.body = {};
  const window = {
    scrollX: x, scrollY: y, innerWidth: width,
    location: new URL('https://yxz6811.github.io/breakglass/showcase.html?demo=1'),
    getComputedStyle: () => ({ paddingRight: padding })
  };
  const scrollCalls = [];
  window.scrollTo = (nextX, nextY) => {
    scrollCalls.push({ x: nextX, y: nextY, behavior: root.style.getPropertyValue('scroll-behavior'), priority: root.style.getPropertyPriority('scroll-behavior') });
    window.scrollX = nextX;
    window.scrollY = nextY;
  };
  const context = vm.createContext({ window, document, URL });
  vm.runInContext(compatSource, context);
  vm.runInContext(source, context);
  return { lock: window.BreakGlassMotion.createScrollLock(), window, document, root, classes, scrollCalls, Element };
}

test('locking freezes the current horizontal and vertical position without losing scrollbar width', () => {
  const page = createPage({ x: 24, y: 480 });
  assert.equal(page.lock.isLocked(), false);
  page.lock.lock();
  assert.equal(page.lock.isLocked(), true);
  assert.equal(page.classes.has('intro-scroll-locked'), true);
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-x'), '-24px');
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-y'), '-480px');
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-padding'), '23px');
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) {
    assert.equal(page.document.count(type), 1);
    assert.equal(page.document.listeners.get(type)[0].options.capture, true);
  }
  for (const type of ['wheel', 'touchmove']) assert.equal(page.document.listeners.get(type)[0].options.passive, false);
});

test('wheel, touch and page-scrolling keys are blocked during entrance and released afterward', () => {
  const page = createPage();
  const target = new page.Element();
  page.lock.lock();
  for (const type of ['wheel', 'touchmove']) assert.equal(page.document.dispatch(type, { target }).defaultPrevented, true);
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']) {
    assert.equal(page.document.dispatch('keydown', { key, target }).defaultPrevented, true, key);
  }
  for (const key of ['Tab', 'Escape', 'Enter', 'a']) assert.equal(page.document.dispatch('keydown', { key, target }).defaultPrevented, false, key);
  page.lock.unlock();
  for (const type of ['wheel', 'touchmove', 'keydown']) {
    assert.equal(page.document.count(type), 0);
    assert.equal(page.document.dispatch(type, { target, key: 'PageDown' }).defaultPrevented, false);
  }
});

test('editable controls retain their keyboard behavior while the surrounding page stays locked', () => {
  const page = createPage();
  page.lock.lock();
  for (const target of [
    new page.Element('input'), new page.Element('textarea'), new page.Element('select'),
    new page.Element('div', { contenteditable: 'true' }), new page.Element('div', { role: 'textbox' })
  ]) {
    for (const key of [' ', 'ArrowRight', 'Home', 'PageDown']) {
      assert.equal(page.document.dispatch('keydown', { target, key }).defaultPrevented, false);
      const nested = new page.Element('span', {}, target);
      assert.equal(page.document.dispatch('keydown', { target: nested, key }).defaultPrevented, false);
    }
  }
  assert.equal(page.document.dispatch('keydown', { target: { isContentEditable: true }, key: ' ' }).defaultPrevented, false);
  assert.equal(page.lock.isLocked(), true);
});

test('pinch gestures and Ctrl+wheel keep browser zoom available during the entrance', () => {
  const page = createPage();
  page.lock.lock();
  assert.equal(page.document.dispatch('wheel', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(page.document.dispatch('touchmove', { touches: [{}, {}] }).defaultPrevented, false);
  assert.equal(page.document.dispatch('touchmove', { touches: [{}] }).defaultPrevented, true);
  assert.equal(page.document.dispatch('wheel', { ctrlKey: false }).defaultPrevented, true);
  assert.equal(page.lock.isLocked(), true);
});

test('nested same-page anchors cannot navigate during entrance, while other destinations remain usable', () => {
  const page = createPage();
  page.lock.lock();
  for (const href of ['#p5', 'showcase.html?demo=1#p3', '/breakglass/showcase.html?demo=1#p1', 'https://yxz6811.github.io/breakglass/showcase.html?demo=1#p8']) {
    const anchor = new page.Element('a', { href });
    const icon = new page.Element('svg', {}, anchor);
    const event = page.document.dispatch('click', { target: icon });
    assert.equal(event.defaultPrevented, true, href);
    assert.equal(event.propagationStopped, true, 'capture prevents document-level smooth-scroll handlers');
  }
  for (const href of ['https://github.com/yxz6811/breakglass#readme', '../other.html#p1', '?demo=2#p5', '', 'mailto:hello@example.com']) {
    const event = page.document.dispatch('click', { target: new page.Element('a', { href }) });
    assert.equal(event.defaultPrevented, false, href);
    assert.equal(event.propagationStopped, false);
  }
  assert.equal(page.document.dispatch('click', { target: new page.Element('button') }).defaultPrevented, false);
  page.lock.unlock();
  assert.equal(page.document.dispatch('click', { target: new page.Element('a', { href: '#p5' }) }).defaultPrevented, false);
});

test('unlock restores saved position and styles immediately even when the page normally scrolls smoothly', () => {
  const styles = {
    '--intro-scroll-x': { value: '3px', priority: 'important' },
    '--intro-scroll-y': '7px',
    'scroll-behavior': { value: 'smooth', priority: 'important' }
  };
  const page = createPage({ x: 18, y: 720, styles });
  page.lock.lock();
  // Fixed-body layouts can report a reset scroll position while locked.
  page.window.scrollX = 0;
  page.window.scrollY = 0;
  page.lock.unlock();
  assert.equal(page.lock.isLocked(), false);
  assert.equal(page.classes.has('intro-scroll-locked'), false);
  assert.deepEqual(page.scrollCalls, [{ x: 18, y: 720, behavior: 'auto', priority: 'important' }]);
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-x'), '3px');
  assert.equal(page.root.style.getPropertyPriority('--intro-scroll-x'), 'important');
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-y'), '7px');
  assert.equal(page.root.style.getPropertyPriority('--intro-scroll-y'), '');
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-padding'), '');
  assert.equal(page.root.style.getPropertyValue('scroll-behavior'), 'smooth');
  assert.equal(page.root.style.getPropertyPriority('scroll-behavior'), 'important');
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 0);
});

test('repeated lock is idempotent, and replay locks a fresh position without retaining old handlers', () => {
  const page = createPage({ y: 300, width: 390, clientWidth: 390, padding: '0px' });
  page.lock.lock();
  page.window.scrollY = 0;
  page.lock.lock();
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 1);
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-padding'), '0px');
  page.lock.unlock();
  page.lock.unlock();
  assert.equal(page.scrollCalls.length, 1);
  assert.equal(page.window.scrollY, 300, 'second lock must not replace the original position');
  assert.equal(page.root.style.getPropertyValue('scroll-behavior'), '');
  page.window.scrollY = 960;
  page.lock.lock();
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-y'), '-960px');
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 1);
  page.lock.unlock();
  assert.equal(page.window.scrollY, 960);
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 0);
});

test('disposing a running entrance restores scrolling and permanently releases every input listener', () => {
  const page = createPage({ y: 420 });
  page.lock.lock();
  page.lock.dispose();
  assert.equal(page.lock.isLocked(), false);
  assert.equal(page.classes.has('intro-scroll-locked'), false);
  assert.equal(page.window.scrollY, 420);
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-y'), '');
  assert.equal(page.root.style.getPropertyValue('scroll-behavior'), '');
  page.lock.lock();
  page.lock.dispose();
  page.lock.unlock();
  assert.equal(page.lock.isLocked(), false);
  assert.equal(page.scrollCalls.length, 1);
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 0);
  assert.equal(page.document.dispatch('wheel').defaultPrevented, false);
});

test('an unused controller can be disposed without scrolling or mutating existing presentation styles', () => {
  const page = createPage({ styles: { '--intro-scroll-y': '6px', 'scroll-behavior': 'smooth' } });
  page.lock.dispose();
  page.lock.lock();
  assert.equal(page.lock.isLocked(), false);
  assert.equal(page.scrollCalls.length, 0);
  assert.equal(page.root.style.getPropertyValue('--intro-scroll-y'), '6px');
  assert.equal(page.root.style.getPropertyValue('scroll-behavior'), 'smooth');
  for (const type of ['wheel', 'touchmove', 'keydown', 'click']) assert.equal(page.document.count(type), 0);
});
