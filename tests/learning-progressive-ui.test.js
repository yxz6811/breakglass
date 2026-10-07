const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const rules = require('../learning-site/analysis-cache.js');
const flush = () => new Promise((done) => setImmediate(done));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function element(tag = 'div') {
  const listeners = new Map(); let text = '';
  const item = { tagName: tag.toUpperCase(), children: [], disabled: false, checked: false,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { return Promise.all([...(listeners.get(name) || [])].map((callback) => callback())); },
    setAttribute() {}, append(...children) { this.children.push(...children); }, replaceChildren(...children) { text = ''; this.children = children; },
    listeners: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0) };
  Object.defineProperty(item, 'textContent', { get: () => text + item.children.map((child) => child.textContent).join(''),
    set: (content) => { text = String(content); item.children = []; } }); return item;
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const visual = () => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'unit' },
  area: null, title: '直角三角形', explanation: '直角条件仍需要校对。', pitfallHint: '确认斜边名称。' });
function answer(input, changes = {}) {
  return { schemaVersion: '1', requestId: input.requestId, sourceId: input.sourceId, videoVersion: input.videoVersion, analysisVersion: input.analysisVersion,
    status: 'context', contextSourceId: input.contextSourceId, observedTimes: input.frames.map((frame) => frame.frameTime),
    coverage: { start: input.frames[0].frameTime, end: input.frames.at(-1).frameTime, frameCount: input.frames.length, inputTypes: ['frames'] },
    limitations: '只总结稀疏画面，未处理音频或完整课程。', summary: '本片段候选概述。', keyPoints: [], pitfalls: [],
    objects: [{ frameTime: input.frames[0].frameTime, result: visual() }],
    cache: { hit: false, stored: true, createdAt: Date.now(), origin: 'AI片段候选', label: '本次AI分析' }, ...changes };
}
function setup(options = {}) {
  const document = element(); document.hidden = false; document.createElement = element;
  const mount = element(); const video = { isConnected: true, currentTime: 35, paused: false, currentSrc: 'blob:http://localhost:4174/video', src: '' };
  let selected = { source: { kind: 'local-file', id: 'file-' + 'a'.repeat(64), version: '1', analysisVersion: '1', materialMode: 'self-authored' }, duration: 75 };
  let policy = { allowed: options.allowed !== false, context: null }; const calls = []; const extracts = []; const candidates = []; let clears = 0;
  const sandbox = { document, AbortController, AbortSignal, TextDecoder, crypto: { randomUUID }, fetch: async (url, init) => {
    const entry = { url, init, input: JSON.parse(init.body) }; calls.push(entry); const custom = options.fetch?.(entry);
    if (custom !== undefined) return custom;
    if (url === '/api/vision/progressive/session') return response({ token: 'progressive-ui-token', plan: rules.plan(selected.duration, entry.input.currentTime) });
    if (url === '/api/vision/progressive/context') return response(answer(entry.input, options.answer?.(entry.input)));
    if (['/api/vision/session/end', '/api/vision/cache/clear', '/api/vision/cache/clear-guest'].includes(url)) return response({ ok: true });
    throw new Error('unexpected request');
  } };
  vm.createContext(sandbox);
  for (const file of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', file), 'utf8'), sandbox);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-site/analysis-cache.js'), 'utf8'), sandbox);
  sandbox.BreakGlass.videoContext = { extractWindow: async (player, config) => {
    extracts.push({ player, config }); const custom = options.extract?.(player, config); if (custom !== undefined) return custom;
    const times = Array.from({ length: 4 }, (_, index) => Number((config.start + (config.end - 0.001 - config.start) * index / 3).toFixed(6)));
    return { frames: times.map((frameTime) => ({ frameTime, image: 'explicit-frame-placeholder' })) };
  } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-site/progressive.js'), 'utf8'), sandbox);
  const ui = sandbox.BreakGlass.progressive.createUI({ mount, document, video, getSelection: () => selected, getPolicy: () => policy,
    onClear: () => { clears += 1; }, onCandidate: (...args) => { candidates.push(args); } });
  const buttons = () => mount.children[2].children;
  return { ui, mount, video, document, calls, extracts, candidates, buttons,
    clearCount: () => clears, changeSource: () => { selected = { ...selected, source: { ...selected.source, id: 'file-' + 'b'.repeat(64) } }; },
    setPolicy: (next) => { policy = next; } };
}

test('progressive UI explicitly processes current window first with single sequential decoding, visible gaps and unchanged player', async () => {
  const f = setup(); assert.equal(f.calls.length, 0); await f.ui.start();
  assert.deepEqual(f.extracts.map((item) => item.config.start), [30, 0, 60]); assert.equal(f.video.currentTime, 35); assert.equal(f.video.paused, false);
  assert.equal(f.ui.snapshot().completed, 3); assert.equal(f.ui.snapshot().state, 'complete');
  assert.match(f.mount.textContent, /未分析时间窗：无/); assert.match(f.mount.textContent, /片段区间完成不等于连续覆盖/);
  assert.equal(f.calls.filter((item) => item.url.endsWith('progressive/context')).length, 3);
  const resultButton = f.mount.children.at(-1).children[0].children.find((item) => item.tagName === 'BUTTON'); await resultButton.emit('click');
  assert.equal(f.candidates.length, 1); assert.equal(f.candidates[0][2](), true);
  f.ui.stop(); assert.equal(f.candidates[0][2](), false); await flush();
  assert.equal(f.calls.at(-1).input.token, 'progressive-ui-token'); f.ui.destroy(); assert.equal(f.document.listeners(), 0);
});

test('paused requests abort and late answers never become ready; only explicit continue retries a missing window', async () => {
  const waiting = deferred(); let attempts = 0;
  const f = setup({ fetch: (entry) => entry.url.endsWith('progressive/context') && attempts++ === 0 ? waiting.promise : undefined });
  const start = f.ui.start(); await flush(); const first = f.calls.find((item) => item.url.endsWith('progressive/context'));
  f.ui.pause(); assert.equal(first.init.signal.aborted, true); assert.equal(f.ui.snapshot().state, 'paused');
  waiting.resolve(response(answer(first.input))); await start; assert.equal(f.ui.snapshot().completed, 0);
  await flush(); assert.equal(f.calls.filter((item) => item.url.endsWith('progressive/context')).length, 1);
  assert.match(f.mount.textContent, /覆盖缺口/); await f.ui.resume(); assert.equal(f.ui.snapshot().completed, 3);
  assert.equal(f.calls.filter((item) => item.url.endsWith('progressive/context')).length, 4); f.ui.destroy();
});

test('failure leaves completed results and unprocessed gaps visible without retrying; cache hits retain original AI label', async () => {
  let attempts = 0;
  const f = setup({ fetch: (entry) => {
    if (!entry.url.endsWith('progressive/context')) return;
    attempts += 1; if (attempts === 2) return response({ error: '模型配置未就绪' }, 503);
    if (attempts === 1) return response(answer(entry.input, { cache: { hit: true, stored: true, createdAt: Date.now() - 1000, origin: 'AI片段候选', label: '来自前次AI分析' } }));
  } });
  await f.ui.start(); assert.equal(f.ui.snapshot().completed, 1); assert.equal(f.ui.snapshot().state, 'failed');
  assert.equal(attempts, 2); await flush(); assert.equal(attempts, 2); assert.match(f.mount.textContent, /来自前次AI分析/);
  assert.match(f.mount.textContent, /未分析时间窗：0.0–30.0秒、60.0–75.0秒/);
  await f.ui.resume(); assert.equal(f.ui.snapshot().completed, 3); f.ui.destroy();
});

test('pending permissions, forged response identity and source changes fail closed without stale candidates', async () => {
  const pending = setup({ allowed: false }); await pending.ui.start(); assert.equal(pending.extracts.length, 0); assert.equal(pending.calls.length, 0); pending.ui.destroy();
  const forged = setup({ answer: () => ({ sourceId: 'file-forged' }) }); await forged.ui.start(); assert.equal(forged.ui.snapshot().completed, 0);
  assert.equal(forged.ui.snapshot().state, 'failed'); assert.match(forged.mount.textContent, /身份/); forged.ui.destroy();
  const blocked = deferred(); const changed = setup({ extract: () => blocked.promise }); const work = changed.ui.start(); await flush();
  changed.changeSource(); blocked.resolve({ frames: [{ frameTime: 30, image: 'late' }] }); await work;
  assert.equal(changed.calls.filter((item) => item.url.endsWith('progressive/context')).length, 0); changed.ui.destroy();
});

test('hidden page cancels upstream, clears ephemeral results and cache clearing is an explicit isolated request', async () => {
  const f = setup(); await f.ui.start(); f.document.hidden = true; await f.document.emit('visibilitychange'); await flush();
  assert.equal(f.ui.snapshot().completed, 0); assert.equal(f.ui.snapshot().state, 'idle'); assert.match(f.mount.textContent, /页面隐藏/);
  f.document.hidden = false; await f.ui.clearCache(); assert.equal(f.calls.at(-1).url, '/api/vision/cache/clear');
  assert.deepEqual(f.calls.at(-1).input, {}); assert.match(f.mount.textContent, /缓存已由服务清除/); f.ui.destroy();
});

test('clear local data has a distinct guest-only cache action and reports a server failure to its caller', async () => {
  const f = setup(); await f.ui.clearGuestCache(); assert.equal(f.calls.at(-1).url, '/api/vision/cache/clear-guest');
  assert.deepEqual(f.calls.at(-1).input, {}); assert.match(f.mount.textContent, /账户缓存与记录保留/); f.ui.destroy();
  const failed = setup({ fetch: (entry) => entry.url.endsWith('clear-guest') ? response({ error: '缓存服务不可用' }, 503) : undefined });
  await assert.rejects(failed.ui.clearGuestCache(), /缓存服务不可用/); assert.match(failed.mount.textContent, /访客缓存清除未确认/); failed.ui.destroy();
});
