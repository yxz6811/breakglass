import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const workspacePath = new URL('../../extension/demo/workspace.js', import.meta.url);
const mountContextSource = fs.readFileSync(new URL('../../extension/src/page/mount-context.js', import.meta.url), 'utf8');

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

export const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };

function descendants(node) { return node.childNodes.flatMap(child => [child, ...descendants(child)]); }
function attribute(node, name) {
  if (name.startsWith('data-')) return node.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
  if (node.attributes.has(name)) return node.attributes.get(name);
  const value = name === 'class' ? node.className : node[name];
  return value === '' || typeof value === 'boolean' ? undefined : value;
}
function matches(node, selector) {
  const parts = selector.trim().split(/\s+/);
  const single = parts.pop();
  if (!single || node.nodeType !== 1) return false;
  const tag = single.match(/^[\w-]+/)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const id = single.match(/#([\w-]+)/)?.[1];
  if (id && node.id !== id) return false;
  for (const [, name] of single.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(name)) return false;
  for (const [, name, expected] of single.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    const actual = attribute(node, name);
    if (actual === undefined || actual === null || expected !== undefined && String(actual) !== expected) return false;
  }
  if (parts.length) {
    let parent = node.parentElement;
    while (parent && !matches(parent, parts.join(' '))) parent = parent.parentElement;
    if (!parent) return false;
  }
  return true;
}

function eventTarget(node) {
  const listeners = new Map();
  node.addEventListener = (type, fn, options = {}) => { if (!listeners.has(type)) listeners.set(type, new Map()); listeners.get(type).set(fn, options); };
  node.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  node.listenerCount = () => [...listeners.values()].reduce((total, values) => total + values.size, 0);
  node.emit = async (type, extra = {}) => {
    const event = { type, target: node, currentTarget: node, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    const pending = [...(listeners.get(type) || [])].map(([fn, settings]) => { if (settings.once) listeners.get(type).delete(fn); return fn(event); });
    if (typeof node['on' + type] === 'function') pending.push(node['on' + type](event));
    await Promise.all(pending);
    return event;
  };
  return node;
}

function element(tag, created, onAppend) {
  let ownText = '';
  const node = eventTarget({ nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], parentElement: null,
    attributes: new Map(), dataset: {}, className: '', id: '', hidden: false, disabled: false,
    checked: false, value: '', style: {}, type: '', currentTime: 1, paused: true,
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { for (const child of nodes) this.appendChild(child); },
    appendChild(child) {
      if (!child) throw new TypeError('appendChild requires a node');
      child.remove(); this.childNodes.push(child); child.parentElement = this;
      if (this.tagName === 'SELECT' && !this.value) this.value = child.value;
      onAppend?.(this, child); return child;
    },
    insertBefore(child, reference) {
      if (!reference) return this.appendChild(child);
      const index = this.childNodes.indexOf(reference);
      if (index < 0) throw new Error('Reference is not a child');
      child.remove(); this.childNodes.splice(index, 0, child); child.parentElement = this;
      onAppend?.(this, child); return child;
    },
    replaceChildren(...nodes) { this.childNodes.slice().forEach(child => child.remove()); ownText = ''; this.append(...nodes); },
    remove() {
      if (this.parentElement) this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1);
      this.parentElement = null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
      else if (['id', 'class', 'type'].includes(name)) this[name === 'class' ? 'className' : name] = String(value);
    },
    getAttribute(name) { return attribute(this, name) ?? null; },
    hasAttribute(name) { return attribute(this, name) !== undefined && attribute(this, name) !== null && attribute(this, name) !== ''; },
    removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; else if (name === 'id') this.id = ''; },
    querySelectorAll(selector) { return descendants(this).filter(child => selector.split(',').some(part => matches(child, part))); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) { let current = this; while (current && !matches(current, selector)) current = current.parentElement; return current; },
    contains(child) { return child === this || descendants(this).includes(child); },
    cloneNode(deep = false) {
      const copy = element(tag, created, onAppend);
      for (const name of ['className', 'id', 'type', 'value', 'hidden', 'disabled', 'checked']) copy[name] = this[name];
      copy.attributes = new Map(this.attributes); copy.dataset = { ...this.dataset }; copy.textContent = ownText;
      if (deep) this.childNodes.forEach(child => copy.append(child.cloneNode(true)));
      return copy;
    },
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); },
    click() { return this.emit('click'); }
  });
  Object.defineProperties(node, {
    children: { get: () => node.childNodes.filter(child => child.nodeType === 1) },
    parentNode: { get: () => node.parentElement },
    nextSibling: { get: () => node.parentElement?.childNodes[node.parentElement.childNodes.indexOf(node) + 1] || null },
    textContent: { get: () => ownText + node.childNodes.map(child => child.textContent).join(''),
      set: value => { node.replaceChildren(); ownText = String(value); } },
    isConnected: { get: () => { let current = node; while (current.parentElement) current = current.parentElement; return current.tagName === 'HTML'; } }
  });
  created.push(node);
  return node;
}

// Browser platform doubles only; workspace orchestration runs from the saved production file.
// Pending resource results can deliberately ignore abort to exercise late-result guards.
export function createWorkspaceHarness(options = {}) {
  const created = []; const scripts = []; const fetches = [];
  const createdDocks = [];
  const mounts = []; const controllers = { learning: [], curve: [], geometry: [], recognition: [], particles: [] };
  let context;
  const newElement = tag => element(tag, created, (parent, child) => {
    if (parent.tagName !== 'HEAD' || child.tagName !== 'SCRIPT') return;
    const request = { node: child, path: child.src, load: () => child.emit('load'), fail: () => child.emit('error') };
    scripts.push(request);
    if (options.holdScript?.(child.src, scripts.length)) return;
    queueMicrotask(() => options.failScript?.(child.src, scripts.length) ? request.fail() : request.load());
  });
  const document = eventTarget({ location: new URL('http://localhost:8765/extension/demo/index.html'), visibilityState: 'visible',
    createElement: newElement, createElementNS: (_ns, tag) => newElement(tag),
    importNode: (node, deep) => node.cloneNode(deep),
    getElementById: id => document.documentElement.querySelector('#' + id),
    querySelector: selector => document.documentElement.querySelector(selector),
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector) });
  document.documentElement = newElement('html'); document.head = newElement('head'); document.body = newElement('body');
  document.documentElement.append(document.head, document.body);
  const cssLink = newElement('link'); cssLink.setAttribute('href', './workspace.css'); document.head.append(cssLink);
  const original = newElement('main'); original.id = 'original-demo';
  const stage = newElement('section'); stage.id = 'video-stage';
  const video = newElement('video'); video.id = 'demo-video';
  const banner = newElement('div'); banner.id = 'stage-banner'; stage.append(video, banner);
  const help = newElement('p'); help.id = 'current-frame-help'; original.append(stage, help); document.body.append(original);

  let media = { generation: 1, owner: 'local:epoch-0', source: { id: 'fixture-authorized', version: '1' },
    selection: { name: '自制回归视频', source: { id: 'fixture-authorized', version: '1' } }, policy: { allowed: true } };
  let target = { scope: 'local', label: '本机访客', owner: 'local:epoch-0', epoch: 0, canSave: true, ...options.saveTarget };
  const saves = []; const opened = [];
  function controller(kind, opts) {
    const instance = { options: opts, active: true, stopCount: 0, destroyCount: 0, mediaChanges: [],
      setActive(value) { this.active = value; }, onMediaChange(value) { this.mediaChanges.push(value); },
      stopReader() { this.stopCount += 1; }, stop() { this.stopCount += 1; },
      destroy() { this.destroyCount += 1; } };
    controllers[kind].push(instance); mounts.push(kind); return instance;
  }
  const BreakGlass = {
    webRecords: { validSnapshot: () => true },
    liveParticles: { mount(_container, opts) { const instance = controller('particles', opts);
      instance.update = scene => { instance.scene = scene; }; instance.getState = () => instance.scene; return instance; } },
    learningApp: { mount(_container, opts) {
      if (options.failMount?.('learning', controllers.learning.length)) throw new Error('学习控制器测试失败');
      const instance = controller('learning', opts);
      instance.context = { getOwner: () => target.owner, getSaveTarget: () => ({ ...target }),
        client: { snapshot: () => ({ user: { username: 'logged-in-but-local' } }) } };
      instance.snapshot = () => media; instance.switchView = () => {};
      instance.chooseFile = async () => true; instance.loadSample = async () => true;
      instance.saveSnapshot = async (record, purpose) => { saves.push({ record, purpose, target: { ...target } });
        if (options.beforeSave) await options.beforeSave(record); return record; };
      instance.openSnapshot = (record, scope) => opened.push({ record, scope });
      return instance;
    } },
    curvePage: { mount(_container, opts) { if (options.failMount?.('curve', controllers.curve.length)) throw new Error('曲线控制器测试失败'); return controller('curve', opts); } },
    geometryPage: { mount(_container, opts) { if (options.failMount?.('geometry', controllers.geometry.length)) throw new Error('几何控制器测试失败'); return controller('geometry', opts); } },
    recognitionWorkbench: { mount(_container, opts) { return controller('recognition', opts); } }
  };
  class DOMParser {
    parseFromString(path) {
      const body = newElement('body');
      if (path.includes('geometry.html')) {
        for (const id of ['geometry-video', 'geometry-banner', 'geometry-toolbar', 'reader-hint']) { const node = newElement('div'); node.id = id; body.append(node); }
      } else { const node = newElement('section'); node.id = 'recognition-workbench'; body.append(node); }
      return { body, querySelectorAll: selector => body.querySelectorAll(selector) };
    }
  }
  const window = eventTarget({ document, location: document.location, BreakGlass, URL, AbortController,
    DOMParser, DOMException, CSSStyleSheet: class { cssRules = []; replaceSync() {} },
    crypto: { randomUUID }, setTimeout, clearTimeout, queueMicrotask, console,
    fetch: async (path, settings = {}) => {
      const request = { path: String(path), signal: settings.signal }; fetches.push(request);
      const gate = options.fetchGates?.get(String(path)); if (gate) await gate.promise;
      return { ok: !options.failFetch?.(String(path), fetches.length), text: async () => String(path) };
    } });
  const existingDock = { destroy() { throw new Error('An unrelated dock must remain owned by its original page'); } };
  if (options.withDock) window.BreakGlassUI = { docks: [existingDock], LiquidGlassDock: class {
    destroyCount = 0;
    constructor() { createdDocks.push(this); }
    destroy() { this.destroyCount += 1; }
  } };
  window.window = window; window.globalThis = window;
  context = vm.createContext(window);
  vm.runInContext(mountContextSource, context, { filename: 'mount-context.js' });
  const execute = () => vm.runInContext(fs.readFileSync(workspacePath, 'utf8'), context, { filename: 'workspace.js' });
  const setMedia = patch => { media = { ...media, ...patch }; controllers.learning.at(-1).options.onMediaChange(media); };
  const setTarget = patch => { target = { ...target, ...patch }; controllers.learning.at(-1).options.onScopeChange?.({ ...target }); };
  return { document, window, BreakGlass, created, scripts, fetches, controllers, mounts, original, stage, video, createdDocks, existingDock,
    execute, setMedia, setTarget, saves, opened,
    nodes: selector => document.querySelectorAll(selector), node: selector => document.querySelector(selector),
    async ready() { await flush(); if (!controllers.geometry.length) throw new Error(document.body.textContent || 'Workspace did not mount'); return BreakGlass.workspace; },
    async destroy() { BreakGlass.workspace?.destroy(); await flush(); } };
}
