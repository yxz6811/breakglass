const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const siteSource = fs.readFileSync(path.join(__dirname, '../site/site.js'), 'utf8');

function createSite({ page = '1', reduceMotion = false, sections = [], dissolveTargets = [], textDom = {} } = {}) {
  const handlers = new Map();
  const timers = [];
  const scrolls = [];
  const root = { style: {} };
  const body = { getAttribute(name) { return ({ 'data-page': page, 'data-next-page': 'modules/education.html' })[name] || ''; } };
  const location = { protocol: 'http:', href: 'http://localhost/site/index.html' };
  const document = {
    body, documentElement: root,
    querySelector(selector) { return selector === '[data-pager]' && sections.length ? {} : null; },
    querySelectorAll(selector) {
      if (selector === '[data-page-section]') return sections;
      if (selector === '.article__title, .article__lead, .prose > p, .prose > h2, .prose li') return dissolveTargets;
      return [];
    },
    ...textDom
  };
  const window = {
    location, scrollY: 0, innerHeight: 800,
    matchMedia() { return { matches: reduceMotion }; },
    addEventListener(type, fn) { handlers.set(type, fn); },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    scrollTo(options) { scrolls.push(options); },
    getComputedStyle() { return { overflowY: 'visible' }; }
  };
  vm.runInNewContext(siteSource, { window, document, location, history: {}, NodeFilter: { SHOW_TEXT: 4 } });
  return { window, document, location, root, timers, scrolls, handlers };
}

test('Escape on the cover keeps the current page visible', () => {
  const site = createSite();
  site.handlers.get('keydown')({ key: 'Escape' });
  assert.equal(site.location.href, 'http://localhost/site/index.html');
  assert.equal(site.root.style.opacity, undefined);
  assert.equal(site.timers.length, 0);
});

test('dissolved headings expose the original text while hiding decorative glyph nodes', () => {
  function textNode(value) { return { nodeType: 3, nodeValue: value, parentNode: null }; }
  function element() {
    const attributes = new Map();
    const node = {
      nodeType: 1, children: [], dataset: {},
      style: { setProperty() {} }, classList: { add() {} },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name) || null; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      replaceChild(fragment, old) {
        const index = this.children.indexOf(old);
        this.children.splice(index, 1, ...fragment.children);
        fragment.children.forEach((child) => { child.parentNode = this; });
      },
      getBoundingClientRect() { return { top: 100, bottom: 180 }; }
    };
    Object.defineProperty(node, 'textContent', {
      get() { return this.children.map((child) => child.nodeValue || child.textContent).join(''); },
      set(value) { this.children = []; this.appendChild(textNode(value)); }
    });
    return node;
  }
  const heading = element();
  const original = '课被录成了 Video 2026';
  heading.appendChild(textNode(original));
  const textDom = {
    createElement: element,
    createTextNode: textNode,
    createDocumentFragment: element,
    createTreeWalker(root) {
      const texts = [];
      function collect(node) {
        if (node.nodeType === 3) texts.push(node);
        else node.children.forEach(collect);
      }
      collect(root);
      let index = 0;
      return { nextNode() { this.currentNode = texts[index++]; return Boolean(this.currentNode); } };
    }
  };
  createSite({ dissolveTargets: [heading], textDom });
  function accessibleText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.getAttribute('aria-hidden') === 'true') return '';
    return node.children.map(accessibleText).join('');
  }
  const glyphs = heading.children.flatMap((child) => child.children || []).filter((child) => child.className === 'ch__glyph');
  assert.ok(glyphs.length > 0, 'decorative layers must be separate nodes with their own ARIA boundary');
  assert.ok(glyphs.every((node) => node.getAttribute('aria-hidden') === 'true'));
  assert.equal(accessibleText(heading), original, 'heading name retains Chinese, words, numbers and spaces without decoration');
  assert.equal(heading.dataset.dissolved, '1', 'visual dissolve remains enabled');
});

test('reduced motion navigates directly without fading or waiting', () => {
  const site = createSite({ reduceMotion: true });
  site.handlers.get('keydown')({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(site.location.href, 'modules/education.html');
  assert.equal(site.root.style.opacity, undefined);
  assert.equal(site.timers.length, 0);
});

test('page shortcuts preserve native link and form keyboard actions', () => {
  const site = createSite({ reduceMotion: true });
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) {
    site.handlers.get('keydown')({ key: ' ', target: { tagName }, preventDefault() { assert.fail('native control action was hijacked'); } });
  }
  assert.equal(site.location.href, 'http://localhost/site/index.html');
});

test('reduced motion scrolls to the next section immediately and permits the next gesture', () => {
  function section(top) {
    return {
      getBoundingClientRect() { return { top, bottom: top + 200, height: 200 }; },
      querySelectorAll() { return []; },
      classList: { add() {} },
      animate() { assert.fail('reduced motion should not animate entry'); }
    };
  }
  const site = createSite({ reduceMotion: true, sections: [section(96), section(500)] });
  const wheel = { deltaY: 40, preventDefault() {}, target: site.document.body };
  site.handlers.get('wheel')(wheel);
  site.handlers.get('wheel')(wheel);
  assert.equal(site.scrolls.length, 2, 'no 820ms animation lock for immediate scrolling');
  assert.equal(site.scrolls[0].behavior, 'auto');
  assert.equal(site.scrolls[0].top, 404);
});
