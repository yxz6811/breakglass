const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

// Run the actual browser IIFE and math validators. DOM, extraction and transport
// are explicit deterministic doubles; these checks do not verify real decoding or AI.
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function element(tag = 'div') {
  const listeners = new Map(); let text = '';
  const value = { tagName: tag.toUpperCase(), children: [], disabled: false, checked: false, value: '',
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    async emit(name) { await Promise.all([...(listeners.get(name) || [])].map((fn) => fn())); },
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { text = ''; this.children = [...nodes]; },
    count() { return [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
  };
  Object.defineProperty(value, 'textContent', { get: () => text + value.children.map((child) => child.textContent).join(''),
    set: (content) => { text = String(content); value.children = []; } });
  Object.defineProperty(value, 'valueAsNumber', { get: () => value.value === '' ? NaN : Number(value.value) });
  return value;
}
const visual = () => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'unit' },
  area: null, title: '直角三角形', explanation: '条件需要人工确认。', pitfallHint: '注意斜边名称。' });
const response = (value) => new Response(JSON.stringify(value));
function result(body, overrides = {}) {
  return { schemaVersion: '1', requestId: body.requestId, sourceId: body.sourceId, videoVersion: body.videoVersion,
    analysisVersion: body.analysisVersion, status: 'context', contextSourceId: body.contextSourceId,
    observedTimes: body.frames.map((frame) => frame.frameTime), coverage: { start: body.frames[0].frameTime,
      end: body.frames.at(-1).frameTime, frameCount: body.frames.length,
      inputTypes: body.contextSourceId ? ['frames', 'subtitle'] : ['frames'] },
    summary: '仅已提交画面与作者文字的候选总结。', keyPoints: ['确认直角'], pitfalls: ['确认斜边'],
    objects: [{ frameTime: body.frames[0].frameTime, result: visual() }], ...overrides };
}
function fixture(options = {}) {
  const ids = ['context-status', 'context-result', 'cancel-context', 'analyze-context', 'use-author-subtitles',
    'context-source', 'context-start', 'context-end'];
  const nodes = Object.fromEntries(ids.map((id) => [id, element()]));
  nodes['use-author-subtitles'].checked = true;
  const document = element(); document.hidden = false;
  document.getElementById = (id) => nodes[id]; document.createElement = element;
  const video = { currentTime: 7, paused: false, isConnected: true,
    currentSrc: 'blob:http://localhost:4174/self-video', src: 'blob:http://localhost:4174/self-video' };
  let chosen = { source: { kind: 'local-file', id: 'file-' + 'a'.repeat(64), version: '1', analysisVersion: '1',
    materialMode: 'self-authored', title: '自制课程' }, duration: 12 };
  let policy = { allowed: options.allowed !== false, context: { id: 'subtitle-' + 'b'.repeat(64), title: '登记作者文字' } };
  const calls = []; const extracts = []; const candidates = []; let starts = 0; let clears = 0;
  const sandbox = { AbortController, AbortSignal, TextDecoder, crypto: { randomUUID }, document,
    fetch: async (url, init) => {
      const entry = { url, init, body: JSON.parse(init.body) }; calls.push(entry);
      const custom = options.fetch?.(entry); if (custom !== undefined) return custom;
      if (url === '/api/vision/session') return response({ token: 'test-context-token' });
      if (url === '/api/vision/session/end') return response({ ok: true });
      if (url === '/api/vision/context') return response(result(entry.body, options.result?.(entry.body)));
      throw new Error('Unexpected request: ' + url);
    } };
  vm.createContext(sandbox);
  for (const file of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.BreakGlass.videoContext = { extractWindow: async (player, config) => {
    extracts.push({ player, config }); const custom = options.extract?.(player, config);
    if (custom !== undefined) return custom;
    return { frames: [0, 4, 8, 11.999].map((frameTime) => ({ frameTime, image: 'transport-frame-placeholder' })) };
  } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-site/context.js'), 'utf8'), sandbox, { filename: 'context.js' });
  let ui;
  ui = sandbox.BreakGlass.webContext.createUI({ video, document, getSelection: () => chosen, getPolicy: () => policy,
    beforeStart: () => { starts += 1; }, onClear: () => { clears += 1; options.onClear?.(); }, onCandidate: (...args) => {
      candidates.push(args); return options.onCandidate?.(...args, ui);
    } });
  ui.update();
  return { ui, nodes, document, video, calls, extracts, candidates, start: () => nodes['analyze-context'].emit('click'),
    beforeStarts: () => starts, clearCalls: () => clears, setPolicy: (next) => { policy = next; }, setChosen: (next) => { chosen = next; },
    buttons: () => nodes['context-result'].children.filter((node) => node.tagName === 'BUTTON') };
}

test('context IIFE sends bounded sparse frames only after explicit start and keeps the student player unchanged', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.extracts.length, 0);
  await f.start(); await flush();
  assert.equal(f.beforeStarts(), 1); assert.equal(f.video.currentTime, 7); assert.equal(f.video.paused, false);
  assert.equal(f.extracts.length, 1); assert.equal(f.extracts[0].player, f.video);
  assert.equal(f.extracts[0].config.maxFrames, 4);
  assert.deepEqual(f.calls.map((entry) => entry.url), ['/api/vision/session', '/api/vision/context', '/api/vision/session/end']);
  const input = f.calls[1].body; assert.equal(input.frames.length, 4); assert.equal(Object.hasOwn(input, 'cues'), false);
  assert.equal(input.contextSourceId, 'subtitle-' + 'b'.repeat(64));
  assert.match(f.nodes['context-result'].textContent, /不能代表完整课程/);
  assert.equal(f.buttons().length, 1); assert.equal(f.candidates.length, 0);
  assert.equal(f.calls.every((entry) => entry.url.startsWith('/api/vision/')), true);
  f.ui.destroy();
});

test('pending permission and invalid windows produce zero extraction and zero fetch', async () => {
  const f = fixture({ allowed: false }); await f.start();
  assert.equal(f.extracts.length, 0); assert.equal(f.calls.length, 0); assert.match(f.nodes['context-status'].textContent, /许可/);
  f.setPolicy({ allowed: true, context: null }); f.ui.update();
  f.nodes['context-start'].value = '1'; f.nodes['context-end'].value = '0'; await f.start();
  assert.equal(f.extracts.length, 0); assert.equal(f.calls.length, 0); assert.match(f.nodes['context-status'].textContent, /有效片段/);
  f.ui.destroy();
});

test('registered subtitle selection with actual empty cues can display truthful frames-only coverage', async () => {
  const f = fixture({ result: (body) => ({ coverage: { start: body.frames[0].frameTime, end: body.frames.at(-1).frameTime,
    frameCount: body.frames.length, inputTypes: ['frames'] } }) });
  await f.start(); await flush();
  assert.equal(f.buttons().length, 1); assert.match(f.nodes['context-status'].textContent, /总结已返回/);
  assert.doesNotMatch(f.nodes['context-result'].textContent, /＋登记作者字幕/); f.ui.destroy();
});

test('stop during extraction invalidates a late noncooperative decoder and never begins a model session', async () => {
  const decoding = deferred(); const f = fixture({ extract: () => decoding.promise });
  const work = f.start(); await flush(); const signal = f.extracts[0].config.signal;
  f.ui.stop('学生取消片段'); assert.equal(signal.aborted, true);
  decoding.resolve({ frames: [{ frameTime: 1, image: 'transport-frame-placeholder' }] }); await work;
  assert.equal(f.calls.length, 0); assert.equal(f.nodes['context-result'].children.length, 0);
  assert.equal(f.nodes['context-status'].textContent, '学生取消片段'); f.ui.destroy();
});

test('late session token from transport ignoring cancellation is explicitly ended without starting analysis', async () => {
  const began = deferred(); const f = fixture({ fetch: (entry) => entry.url === '/api/vision/session' ? began.promise : undefined });
  const work = f.start(); await flush(); assert.equal(f.calls[0].url, '/api/vision/session');
  f.ui.stop('账户已变化'); assert.equal(f.calls[0].init.signal.aborted, true);
  began.resolve(response({ token: 'late-issued-token' })); await work; await flush();
  assert.equal(f.calls.filter((entry) => entry.url === '/api/vision/context').length, 0);
  const cleanup = f.calls.find((entry) => entry.url === '/api/vision/session/end');
  assert.deepEqual(cleanup.body, { token: 'late-issued-token' }); assert.equal(cleanup.init.keepalive, true);
  assert.equal(f.nodes['context-result'].children.length, 0); f.ui.destroy();
});

test('cancel, hidden page, replaced file and account stop discard late candidate responses without restoring old UI', async () => {
  for (const action of ['cancel', 'hidden', 'file', 'account']) {
    const pending = deferred(); let submitted;
    const f = fixture({ fetch: (entry) => {
      if (entry.url === '/api/vision/context') { submitted = entry; return pending.promise; }
      return undefined;
    } });
    const work = f.start(); await flush(); assert.ok(submitted);
    if (action === 'cancel') await f.nodes['cancel-context'].emit('click');
    if (action === 'hidden') { f.document.hidden = true; await f.document.emit('visibilitychange'); }
    if (action === 'file') { f.video.currentSrc = 'blob:http://localhost:4174/new-video'; f.ui.stop('文件已替换'); }
    if (action === 'account') f.ui.stop('账户已变化');
    const status = f.nodes['context-status'].textContent;
    assert.equal(submitted.init.signal.aborted, true);
    pending.resolve(response(result(submitted.body))); await work; await flush();
    assert.equal(f.nodes['context-result'].children.length, 0); assert.equal(f.candidates.length, 0);
    assert.equal(f.nodes['context-status'].textContent, status);
    assert.equal(f.calls.some((entry) => entry.url.includes('/learning/')), false); f.ui.destroy();
  }
});

test('media identity changes are independently checked even when the owner has not yet called stop', async () => {
  const pending = deferred(); let submitted;
  const f = fixture({ fetch: (entry) => { if (entry.url === '/api/vision/context') { submitted = entry; return pending.promise; } } });
  const work = f.start(); await flush(); f.video.currentSrc = 'blob:http://localhost:4174/replaced';
  pending.resolve(response(result(submitted.body))); await work;
  assert.equal(f.nodes['context-result'].children.length, 0); assert.equal(f.candidates.length, 0); f.ui.destroy();
});

test('forged identity/coverage and malicious mathematical candidates are rejected before interactive callbacks', async () => {
  const mutations = [(body) => ({ requestId: 'forged' }), (body) => ({ observedTimes: [1, 2] }),
    (body) => ({ coverage: { start: 0, end: 11.999, frameCount: 4, inputTypes: ['frames', 'audio'] } }),
    (body) => ({ objects: [{ frameTime: 5, result: visual() }] }),
    (body) => ({ objects: [{ frameTime: 0, result: { ...visual(), code: 'fetch(secret)' } }] }),
    (body) => ({ objects: [{ frameTime: 0, result: { ...visual(), snapshot: { AB: -3, AC: 4, unit: 'unit' } } }] }),
    (body) => ({ objects: [{ frameTime: 0, result: { ...visual(), template: 'parabola', snapshot: { a: 0, h: 0, k: 0 } } }] }),
    (body) => ({ objects: [{ frameTime: 0, result: visual() }, { frameTime: 0, result: visual() }] })];
  for (const mutate of mutations) {
    const f = fixture({ result: mutate }); await f.start();
    assert.equal(f.nodes['context-result'].children.length, 0); assert.equal(f.candidates.length, 0);
    assert.match(f.nodes['context-status'].textContent, /未完成/); f.ui.destroy();
  }
});

test('candidate buttons from cleared results cannot invoke callbacks or write learning data', async () => {
  const f = fixture(); await f.start(); const button = f.buttons()[0];
  assert.ok(button); f.ui.stop('候选已清除'); await button.emit('click');
  assert.equal(f.candidates.length, 0); assert.equal(f.nodes['context-result'].children.length, 0);
  assert.equal(f.calls.every((entry) => entry.url.startsWith('/api/vision/')), true); f.ui.destroy();
});

test('asynchronous candidate preparation receives a generation guard and cancellation prevents its late writeback', async () => {
  const prepared = deferred(); const writes = []; let callback;
  const f = fixture({ onCandidate: (object, value, isCurrent) => {
    assert.equal(typeof isCurrent, 'function'); assert.equal(isCurrent(), true);
    callback = prepared.promise.then(() => { if (isCurrent()) writes.push(object); });
    return callback;
  } });
  await f.start(); await f.buttons()[0].emit('click'); assert.equal(f.candidates.length, 1);
  const guard = f.candidates[0][2]; const clears = f.clearCalls();
  await f.nodes['cancel-context'].emit('click');
  assert.equal(f.clearCalls(), clears + 1); assert.equal(guard(), false);
  prepared.resolve(); await callback; assert.equal(writes.length, 0);
  assert.equal(f.nodes['context-result'].children.length, 0); f.ui.destroy();
});

test('candidate generation guards reject hidden pages, changed sources and account stop independently of transport', async () => {
  for (const action of ['hidden', 'source', 'account']) {
    const f = fixture(); await f.start(); await f.buttons()[0].emit('click');
    const guard = f.candidates[0][2]; assert.equal(guard(), true);
    if (action === 'hidden') f.document.hidden = true;
    if (action === 'source') f.setChosen({ source: { id: 'file-' + 'f'.repeat(64) }, duration: 12 });
    if (action === 'account') f.ui.stop('账户已变化');
    assert.equal(guard(), false); f.ui.destroy();
  }
});

test('destroy clears prepared state and removes both action listeners and the visibility listener', async () => {
  const f = fixture(); await f.start(); const button = f.buttons()[0]; const clears = f.clearCalls();
  assert.equal(f.nodes['analyze-context'].count(), 1); assert.equal(f.nodes['cancel-context'].count(), 1);
  assert.equal(f.document.count(), 1); f.ui.destroy();
  assert.equal(f.clearCalls(), clears + 1); assert.equal(f.nodes['analyze-context'].count(), 0);
  assert.equal(f.nodes['cancel-context'].count(), 0); assert.equal(f.document.count(), 0);
  await button.emit('click'); assert.equal(f.candidates.length, 0);
  assert.equal(f.nodes['context-result'].children.length, 0);
});
