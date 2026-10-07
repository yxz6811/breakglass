// Run the real geometry page, scene, session and SVG view in Node.
// Only DOM/media/storage/fullscreen and the HTTP boundary are deterministic doubles.
const fs = require('node:fs');
const path = require('node:path');
const scene = Object.assign({}, require('../../extension/src/geometry-scene/validate'), require('../../extension/src/geometry-scene/solve'), require('../../extension/src/geometry-scene/actions'));
const session = require('../../extension/src/geometry-session/session');
const view = require('../../extension/src/geometry-scene/view');
const request = require('../../extension/src/geometry-scene/request');
const { createGeometryPage } = require('../../extension/src/page/geometry');
const html = fs.readFileSync(path.join(__dirname, '../../extension/demo/geometry.html'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function actionContext(pending) {
  const { requestId, videoId, frameTime, frameSize, sceneRevision } = pending.body.scene;
  return { requestId, videoId, frameTime, frameSize: { ...frameSize }, sceneRevision };
}

function element(tag = 'div') {
  const events = new Map(), attributes = new Map();
  let ownText = '';
  const value = {
    tagName: tag.toUpperCase(), children: [], parentNode: null,
    style: { setProperty(name, data) { this[name] = String(data); }, removeProperty(name) { delete this[name]; } },
    value: '', disabled: false, hidden: false, checked: false, className: '', dataset: {},
    addEventListener(type, handler) { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
    removeEventListener(type, handler) { events.set(type, (events.get(type) || []).filter((item) => item !== handler)); },
    dispatch(type, data = {}) {
      const event = { target: value, currentTarget: value, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...data };
      for (const handler of (events.get(type) || []).slice()) handler(event);
      return event;
    },
    setAttribute(name, data) {
      attributes.set(name, String(data));
      if (name === 'id') value.id = String(data);
      if (name === 'class') value.className = String(data);
      if (name.startsWith('data-')) value.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(data);
    },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    appendChild(child) { value.children.push(child); child.parentNode = value; return child; },
    removeChild(child) { const index = value.children.indexOf(child); if (index >= 0) value.children.splice(index, 1); child.parentNode = null; return child; },
    remove() { value.parentNode?.removeChild(value); },
    replaceChildren(...children) { value.textContent = ''; children.forEach((child) => value.appendChild(child)); },
    contains(child) { return child === value || value.children.some((node) => node.contains(child)); },
    matches(selector) {
      return selector.split(',').some((part) => {
        const token = part.trim();
        const name = /^[a-z][\w-]*/i.exec(token);
        if (name && value.tagName !== name[0].toUpperCase()) return false;
        for (const match of token.matchAll(/\.([\w-]+)/g)) if (!value.className.split(/\s+/).includes(match[1])) return false;
        for (const match of token.matchAll(/\[([\w-]+)(?:\s*=\s*['"]?([^'"\]]+)['"]?)?\]/g)) {
          if (!value.hasAttribute(match[1])) return false;
          if (match[2] !== undefined && value.getAttribute(match[1]) !== match[2]) return false;
        }
        return token.startsWith('#') ? value.id === token.slice(1) : true;
      });
    },
    closest(selector) { let current = value; while (current) { if (current.matches?.(selector)) return current; current = current.parentNode; } return null; },
    querySelectorAll(selector) { return value.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return value.querySelectorAll(selector)[0] || null; },
    focus() { value.focused = true; },
    getBoundingClientRect() { return value.rect || { left: 0, top: 0, width: 420, height: 300 }; },
    setPointerCapture() {}, releasePointerCapture() {},
    listenerCount(type) { return (events.get(type) || []).length; }
  };
  Object.defineProperties(value, {
    firstChild: { get: () => value.children[0] || null },
    firstElementChild: { get: () => value.children[0] || null },
    childNodes: { get: () => [...(ownText ? [{ nodeType: 3, nodeValue: ownText, textContent: ownText }] : []), ...value.children] },
    childElementCount: { get: () => value.children.length },
    textContent: { get: () => ownText + value.children.map((child) => child.textContent).join(''), set(text) { ownText = String(text ?? ''); value.children.splice(0).forEach((child) => { child.parentNode = null; }); } }
  });
  value.classList = {
    contains(name) { return value.className.split(/\s+/).includes(name); },
    toggle(name, on) { const classes = new Set(value.className.split(/\s+/).filter(Boolean)); const next = on === undefined ? !classes.has(name) : Boolean(on); if (next) classes.add(name); else classes.delete(name); value.className = [...classes].join(' '); return next; },
    add(name) { this.toggle(name, true); }, remove(name) { this.toggle(name, false); }
  };
  return value;
}

function createGeometryHarness(options = {}) {
  const elements = {};
  for (const match of html.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = element(match[1]); elements[match[2]] = node;
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
    node.hidden = /\bhidden(?:\s|>)/.test(match[0]); node.disabled = /\bdisabled(?:\s|>)/.test(match[0]);
    for (const name of ['value', 'min', 'max', 'step', 'type']) node[name] = node.getAttribute(name) || '';
  }
  elements['ask-mode'].value = 'local'; elements['candidate-unit'].value = 'unit';
  const document = Object.assign(element('document'), { getElementById: (name) => elements[name], fullscreenElement: null, visibilityState: 'visible' });
  function make(tag) { const node = element(tag); node.ownerDocument = document; node.focus = () => { node.focused = true; document.activeElement = node; }; return node; }
  document.createElement = make;
  document.createElementNS = (_, tag) => make(tag);
  document.documentElement = make('html');
  document.body = make('body');
  document.querySelectorAll = (selector) => Object.values(elements).filter((node) => node.matches(selector));
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  for (const item of Object.values(elements)) { item.ownerDocument = document; item.focus = () => { item.focused = true; document.activeElement = item; }; }
  // These controls are descendants of their owning forms in the real HTML.
  for (const [form, ids] of Object.entries({ 'ask-form': ['ask-mode', 'question', 'ask-submit', 'ask-cancel'], 'review-form': ['candidate-ab', 'candidate-ac', 'right-angle-check'], 'ab-form': ['experiment-ab'], 'ac-form': ['experiment-ac'] })) {
    ids.forEach((name) => { if (elements[name]) elements[name].parentNode = elements[form]; });
  }
  const storageValues = new Map(Object.entries(options.storageValues || {}));
  const storageCalls = [];
  const storage = options.storage || {
    getItem(key) { storageCalls.push(['get', key]); if (options.storageThrows) throw new Error('storage denied'); return storageValues.get(key) ?? null; },
    setItem(key, data) { storageCalls.push(['set', key, String(data)]); if (options.storageThrows) throw new Error('storage denied'); storageValues.set(key, String(data)); },
    removeItem(key) { storageCalls.push(['remove', key]); if (options.storageThrows) throw new Error('storage denied'); storageValues.delete(key); }
  };
  let objectSequence = 0;
  const revokedUrls = [];
  const window = Object.assign(element('window'), {
    URL: { createObjectURL: () => `blob:local-test-${++objectSequence}`, revokeObjectURL(url) { revokedUrls.push(url); } },
    sessionStorage: storage, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout,
    performance: { now: () => 0 }
  });
  const mediaCalls = { play: 0, pause: 0, load: 0, fullscreen: 0, exitFullscreen: 0 };
  const video = elements['geometry-video'];
  Object.assign(video, { paused: true, seeking: false, currentTime: 6, duration: 20, readyState: 2, videoWidth: 640, videoHeight: 360, ...options.video });
  video.pause = () => { mediaCalls.pause++; const wasPlaying = !video.paused; video.paused = true; if (wasPlaying) video.dispatch('pause'); };
  video.play = () => {
    mediaCalls.play++;
    if (options.playImpl) return options.playImpl(video);
    video.paused = false; video.dispatch('play'); return Promise.resolve();
  };
  video.load = () => { mediaCalls.load++; };
  document.documentElement.requestFullscreen = () => {
    mediaCalls.fullscreen++;
    if (options.fullscreenImpl) return options.fullscreenImpl(document);
    document.fullscreenElement = document.documentElement; document.dispatch('fullscreenchange'); return Promise.resolve();
  };
  document.exitFullscreen = () => {
    mediaCalls.exitFullscreen++;
    if (options.exitFullscreenImpl) return options.exitFullscreenImpl(document);
    document.fullscreenElement = null; document.dispatch('fullscreenchange'); return Promise.resolve();
  };
  const requests = [], captures = [];
  const BG = { geometryScene: scene, geometrySession: session, geometryView: view,
    geometryFrame: {
      captureFrame({ requestId, videoId }) {
        captures.push({ requestId, videoId, time: video.currentTime });
        if (!video.paused || video.seeking || video.readyState < 2 || !(video.videoWidth > 0 && video.videoHeight > 0)) return { ok: false, code: 'capture_failed', message: '请等待暂停帧解码完成。' };
        const context = { requestId, videoId, frameTime: video.currentTime, frameSize: { width: video.videoWidth, height: video.videoHeight }, sceneRevision: 0 };
        return { ok: true, context, preview: 'data:image/jpeg;base64,cHJldmlldw==', body: { schemaVersion: '1.0.0', ...context, image: 'fixture' } };
      },
      isFrameCurrent(_, context, videoId) { return video.paused && !video.seeking && context.videoId === videoId && context.frameSize.width === video.videoWidth && context.frameSize.height === video.videoHeight && Math.abs(video.currentTime - context.frameTime) <= 0.2; }
    },
    geometryRequest: {
      buildUrl: request.buildUrl,
      sameContext: request.sameContext,
      requestGeometry(settings) { const pending = { ...settings, body: JSON.parse(JSON.stringify(settings.body)), canceled: false, cancel() { pending.canceled = true; } }; requests.push(pending); return pending; }
    }
  };
  const page = createGeometryPage({ document, window, BreakGlass: BG, ...options.pageOptions, ...(options.borrowedVideo ? { video } : {}) });
  function confirmPreset() { elements['preset-button'].dispatch('click'); elements['right-angle-check'].checked = true; elements['review-form'].dispatch('submit'); }
  function loadVideo(file = { name: 'geometry.mp4', type: 'video/mp4' }) { elements['local-video'].files = [file]; elements['local-video'].dispatch('change'); video.dispatch('loadedmetadata'); video.dispatch('canplay'); }
  function seekVideo(time) { video.seeking = true; video.dispatch('seeking'); video.currentTime = time; video.seeking = false; video.dispatch('seeked'); video.dispatch('timeupdate'); }
  function entries() { return elements['ask-log']?.children.map((entry) => ({ role: entry.dataset.role || entry.getAttribute('data-role'), text: entry.textContent })) || []; }
  return { elements, video, page, requests, captures, document, window, storage, storageValues, storageCalls, mediaCalls, revokedUrls, confirmPreset, loadVideo, seekVideo, entries };
}

module.exports = { createGeometryHarness, element, deferred, flush, actionContext };
