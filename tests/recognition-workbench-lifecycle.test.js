const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const records = require('../learning-site/records');
const provenance = require('../learning-site/provenance');
const workbench = require('../learning-site/recognition-workbench');

// Real workbench, contracts, immutable records and provenance execute. The small
// DOM and transport doubles do not claim browser pixels or actual model accuracy.
function element(tag = 'div') {
  const handlers = new Map(); let text = '';
  const result = { tagName: tag.toUpperCase(), children: [], dataset: {}, value: '', disabled: false, hidden: false,
    classList: { add() {} }, append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = []; text = ''; this.append(...nodes); },
    addEventListener(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); },
    removeEventListener(event, fn) { handlers.get(event)?.delete(fn); },
    setAttribute(name, value) { this[name] = value; },
    emit(event) { for (const fn of [...(handlers.get(event) || [])]) fn({ preventDefault() {} }); },
    listenerCount() { return [...handlers.values()].reduce((sum, list) => sum + list.size, 0); }
  };
  Object.defineProperty(result, 'textContent', { get: () => text + result.children.map(node => node.textContent).join(''),
    set(value) { this.replaceChildren(); text = String(value); } });
  Object.defineProperty(result, 'innerHTML', { set() { throw new Error('unsafe HTML insertion'); } });
  return result;
}
const all = element => [element, ...element.children.flatMap(all)];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = () => ({ kind: 'local-file', id: `file-${'a'.repeat(64)}`, version: '1', analysisVersion: '1', materialMode: 'self-authored' });
function reply() {
  return { schemaVersion: '011.1', requestId: 'lifecycle-read', sourceId: source().id, videoVersion: '1', analysisVersion: '1',
    kind: 'parabola', frameTime: 2, frameSize: { width: 3024, height: 1898 }, jpegSize: { width: 640, height: 402 },
    status: 'candidate', candidate: { template: 'parabola', snapshot: { a: 1, h: 0, k: 1 } },
    evidence: { formulaBasis: 'visible-equation', mathStatus: 'consistent', placementStatus: 'unknown', map: null,
      calibrationBasis: 'none', profileVersion: 'recognition-profile-v1', promptVersion: 'recognition-prompt-v1', calibrationVersion: 'recognition-calibration-v1' },
    limitations: ['placement_unknown', 'student_confirmation_required'] };
}
function harness(t, options = {}) {
  const events = element('window'), document = element('document'); document.hidden = false; document.createElement = element;
  const priorAdd = globalThis.addEventListener, priorRemove = globalThis.removeEventListener;
  const bg = globalThis.BreakGlass; const priorParticles = bg.liveParticles;
  globalThis.addEventListener = events.addEventListener.bind(events); globalThis.removeEventListener = events.removeEventListener.bind(events);
  const scenes = []; let previewDestroyed = false;
  bg.liveParticles = { mount: () => ({ update(scene) { scenes.push(scene); }, destroy() { previewDestroyed = true; } }) };
  const data = new Map(); let failProvenance = Boolean(options.failProvenance);
  const storage = { getItem: key => data.get(key) ?? null, setItem(key, value) {
    if (key === provenance.KEY && failProvenance) throw new Error('来源暂不可写'); data.set(key, value);
  }, removeItem: key => data.delete(key) };
  const store = records.createLocalStore(storage, { id: randomUUID });
  let owner = 'guest', mediaGeneration = 1, material = source(), permitted = true, permissionGeneration = 0, active = true;
  let reads = 0, saves = 0, stops = 0, pauses = 0; const writes = [];
  const video = element('video'); video.videoWidth = 3024; video.videoHeight = 1898; video.pause = () => { pauses += 1; };
  const snapshot = () => ({ owner: `${owner}:${store.read().epoch}`, generation: mediaGeneration, source: material, policy: { allowed: true } });
  const session = { stop() { stops += 1; }, async recognize(input, signal) {
    reads += 1; return options.recognize ? options.recognize(input, signal) : reply();
  } };
  const learning = { snapshot, context: { store, getState: () => store.read(), getSaveTarget: () => ({ scope: 'local', label: '本机访客',
    owner: snapshot().owner, epoch: store.read().epoch, canSave: true }), getVisualSession: () => session,
    prepareRecognitionSession: async () => session }, async saveSnapshot(record) {
      saves += 1; writes.push(record); if (options.beforeSave) await options.beforeSave(record);
      const saved = store.save(record, store.read().epoch);
      if (options.afterSave) await options.afterSave(saved);
      return saved;
    } };
  const container = element(); const ui = workbench.mount(container, { learning, video, document, storage,
    canRead: () => permitted, getPermissionGeneration: () => permissionGeneration, isActive: () => active });
  const action = name => all(container).find(node => node.dataset.recognitionAction === name);
  const parameter = name => all(container).find(node => node.dataset.recognitionParameter === name);
  const note = () => all(container).find(node => node.tagName === 'TEXTAREA');
  const select = () => all(container).find(node => node.tagName === 'SELECT');
  async function click(name) { action(name).emit('click'); await flush(); await flush(); }
  async function confirm() { await click('read'); await click('confirm'); assert.equal(ui.snapshot().confirmed, true); }
  t.after(() => { ui.destroy(); globalThis.addEventListener = priorAdd; globalThis.removeEventListener = priorRemove; bg.liveParticles = priorParticles; });
  return { ui, container, video, document, events, store, data, scenes, writes, action, parameter, note, select, click, confirm,
    counts: () => ({ reads, saves, stops, pauses }), failProvenance: value => { failProvenance = value; },
    changeOwner: value => { owner = value; ui.refresh(); }, changeSource: () => { material = { ...material, id: `file-${'b'.repeat(64)}` }; mediaGeneration += 1; ui.refresh(); },
    revoke: () => { permitted = false; permissionGeneration += 1; ui.stop('许可开关已关闭；已核对数学可继续学习。'); },
    deactivate: () => { active = false; ui.stop(); }, previewDestroyed: () => previewDestroyed };
}

test('only an explicit read then student confirmation exposes deterministic preview and save, with no automatic accuracy assertion', async t => {
  const f = harness(t); assert.deepEqual(f.counts(), { reads: 0, saves: 0, stops: 0, pauses: 0 });
  assert.equal(f.action('save').hidden, true); await f.click('read');
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().pauses, 1); assert.equal(f.ui.snapshot().confirmed, false);
  f.parameter('h').value = '2'; f.parameter('h').emit('input'); await f.click('confirm');
  assert.deepEqual(f.scenes.at(-1).snapshot, { a: 1, h: 2, k: 1 });
  assert.match(f.container.textContent, /学生已核对|数学条件已由你核对/); assert.match(f.container.textContent, /位置.*待校对/);
  assert.doesNotMatch(f.container.textContent, /模型识别准确|像素验收通过/);
  await f.click('save'); assert.equal(f.store.read().records.length, 1); assert.equal(f.ui.snapshot().saved, true);
  const sidecar = JSON.parse(f.data.get(provenance.KEY)).items[0]; assert.deepEqual(sidecar.originalSnapshot, { a: 1, h: 0, k: 1 });
  assert.equal(sidecar.placementStatus, 'unknown'); assert.equal(sidecar.confirmation, 'student');
});

test('stopping an unfinished read rejects its late candidate and cannot enable confirmation or save', async t => {
  const delayed = deferred(); let signal; const f = harness(t, { recognize: (_input, value) => { signal = value; return delayed.promise; } });
  await f.click('read'); assert.equal(f.action('read').disabled, true); f.ui.stop(); assert.equal(signal.aborted, true);
  delayed.resolve(reply()); await flush(); await flush();
  assert.equal(f.ui.snapshot().pending, false); assert.equal(f.ui.snapshot().confirmed, false);
  assert.equal(f.action('confirm').disabled, true); assert.equal(f.action('save').disabled, true); assert.equal(f.counts().saves, 0);
});

test('turning analysis permission off preserves confirmed mathematics for manual save but cannot trigger new acquisition', async t => {
  const f = harness(t); await f.confirm(); const preview = f.scenes.at(-1); f.revoke();
  assert.equal(f.ui.snapshot().confirmed, true); assert.deepEqual(f.scenes.at(-1), preview);
  assert.equal(f.action('read').disabled, true); assert.equal(f.action('save').disabled, false);
  await f.click('read'); assert.equal(f.counts().reads, 1); await f.click('save');
  assert.equal(f.ui.snapshot().saved, true); assert.equal(f.store.read().records.length, 1);
});

test('owner and source changes clear old candidate, confirmation and unsaved student input', async t => {
  const f = harness(t); await f.confirm(); f.note().value = '旧账号输入'; f.changeOwner('another-user');
  assert.equal(f.ui.snapshot().confirmed, false); assert.equal(f.note().value, ''); assert.equal(f.scenes.at(-1), null);
  await f.confirm(); f.changeSource(); assert.equal(f.ui.snapshot().pending, false); assert.equal(f.ui.snapshot().confirmed, false);
  assert.equal(f.action('save').disabled, true); assert.equal(f.scenes.at(-1), null);
});

test('editing a confirmed condition requires confirmation again and never reuses an already saved writer', async t => {
  const f = harness(t); await f.confirm(); await f.click('save'); const original = f.store.read().records[0];
  f.parameter('h').value = '4'; f.parameter('h').emit('input'); assert.equal(f.ui.snapshot().confirmed, false);
  assert.equal(f.action('save').disabled, true); await f.click('confirm'); await f.click('save');
  const saved = f.store.read().records; assert.equal(saved.length, 2); assert.notEqual(saved[0].id, saved[1].id);
  assert.deepEqual(saved[0], original); assert.equal(saved[1].snapshot.h, 4);
});

test('a partial provenance failure can retry only the frozen saved mathematics even if the editable note changed', async t => {
  const f = harness(t, { failProvenance: true }); await f.confirm(); f.note().value = '第一次保存备注'; await f.click('save');
  assert.equal(f.store.read().records.length, 1); assert.equal(f.ui.snapshot().saved, false);
  assert.match(f.container.textContent, /数学记录已保存，来源保存未确认/);
  const original = f.store.read().records[0]; f.note().value = '失败后尚未提交的新备注'; f.failProvenance(false); await f.click('save');
  assert.equal(f.ui.snapshot().saved, true); assert.deepEqual(f.store.read().records, [original]);
  assert.equal(f.counts().saves, 1, 'partial retry must not rewrite an immutable saved record');
  assert.equal(JSON.parse(f.data.get(provenance.KEY)).items[0].recordId, original.id);
});

test('same-epoch parent deletion after partial save invalidates the pending writer instead of recreating the deleted record', async t => {
  const f = harness(t, { failProvenance: true }); await f.confirm(); await f.click('save');
  const parent = f.store.read().records[0]; assert.equal(f.store.read().epoch, 0); f.store.remove(parent.id);
  f.events.emit('storage'); assert.equal(f.store.read().epoch, 0); f.failProvenance(false); await f.click('save');
  assert.deepEqual(f.store.read().records, []); assert.equal(f.action('save').disabled, true);
  assert.equal(f.ui.snapshot().confirmed, false); assert.equal(f.data.has(provenance.KEY), false);
});

test('a failed post-record purpose write does not authorize recreating a same-epoch deleted parent on retry', async t => {
  let failPurpose = true;
  const f = harness(t, { afterSave: () => { if (failPurpose) throw new Error('用途保存未确认'); } });
  await f.confirm(); await f.click('save'); const parent = f.store.read().records[0];
  assert.ok(parent, 'the real store accepted mathematics before the simulated purpose failure');
  assert.equal(f.ui.snapshot().saved, false); assert.equal(f.data.has(provenance.KEY), false);
  f.store.remove(parent.id); f.events.emit('storage'); failPurpose = false; await f.click('save');
  assert.deepEqual(f.store.read().records, []); assert.equal(f.data.has(provenance.KEY), false);
  assert.equal(f.ui.snapshot().confirmed, false);
});

test('clear epoch, media emptied and destroy remove confirmation and cannot write old source records', async t => {
  const f = harness(t); await f.confirm(); f.store.clear(); f.events.emit('storage');
  assert.equal(f.ui.snapshot().confirmed, false); await f.click('save'); assert.equal(f.store.read().records.length, 0);
  await f.confirm(); f.video.emit('emptied'); assert.equal(f.ui.snapshot().confirmed, false); assert.equal(f.scenes.at(-1), null);
  await f.confirm(); f.ui.destroy(); assert.equal(f.video.listenerCount() + f.document.listenerCount() + f.events.listenerCount(), 0);
  assert.equal(f.container.children.length, 0); assert.equal(f.previewDestroyed(), true);
});

test('parameter replacement removes detached listeners rather than accumulating every past candidate until unmount', async t => {
  const f = harness(t); await f.click('read'); const old = f.parameter('h'); assert.equal(old.listenerCount(), 1);
  await f.click('read'); assert.equal(old.listenerCount(), 0); f.ui.destroy();
});

function visualHarness(t, options = {}) {
  const calls = [], deadlines = [], timers = new Map(); let timerId = 0, captures = 0;
  const document = element('document'), window = element('window'); document.hidden = false;
  const video = element('video'); Object.assign(video, { isConnected: true, currentSrc: 'blob:controlled', src: 'blob:controlled',
    currentTime: 2, duration: 9.4, videoWidth: 3024, videoHeight: 1898, parentElement: { parentElement: element() } });
  const jpeg = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '../breakglass-reader/tests/helpers/fixtures/demo-6451-640x402.jpg')).toString('base64');
  const context = { AbortController, TextDecoder, queueMicrotask, crypto: { randomUUID }, Date, atob, btoa, document, window, video,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => {
      const controller = new AbortController(); deadlines.push({ ms, controller }); return controller.signal;
    } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); const call = { url, init, body }; calls.push(call);
      if (options.fetch) { const custom = options.fetch(call); if (custom !== undefined) return custom; }
      return new Response(JSON.stringify(url === '/api/vision/session' ? { token: 'shared-session' } : { ok: true }));
    } };
  vm.createContext(context);
  for (const name of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js', 'plugin/recognition-contracts.js', 'plugin/live-loop.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', name), 'utf8'), context, { filename: name });
  }
  context.BreakGlass.frameSampling = { capture(_video, signal) {
    captures += 1; if (options.capture) return options.capture(signal);
    return options.frame ? { frameTime: 2, image: jpeg, signature: 'frame' } : null;
  } };
  context.BreakGlass.pluginOverlay = { createLearningOverlay: () => ({ updatePoints() {}, updateSummary() {}, updateStatus() {}, setRecognitionState() {}, destroy() {} }) };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-site/visual-session.js'), 'utf8'), context, { filename: 'visual-session.js' });
  context.fileId = source().id;
  const session = vm.runInContext("BreakGlass.webVisual.createSession({video,source:{kind:'local-file',id:fileId,version:'1',analysisVersion:'1',materialMode:'self-authored'},cssText:''})", context);
  context.session = session;
  const recognize = () => vm.runInContext("session.recognize({kind:'parabola',frameSize:{width:3024,height:1898}})", context);
  t.after(() => session.destroy());
  return { session, recognize, context, calls, deadlines, captures: () => captures };
}

test('an explicit prepare and simultaneous continuous start join one session instead of resetting the shared read budget', async t => {
  const begin = deferred(); const f = visualHarness(t, { fetch: call => call.url === '/api/vision/session' ? begin.promise : undefined });
  const preparing = f.session.prepare(), starting = f.session.start(); await flush();
  assert.equal(f.captures(), 0, 'preparation cannot acquire a frame');
  assert.equal(f.calls.filter(call => call.url === '/api/vision/session').length, 1);
  begin.resolve(new Response(JSON.stringify({ token: 'joined-session' })));
  assert.deepEqual(await Promise.all([preparing, starting]), [true, true]);
  assert.equal(f.calls[0].body.capability, 'recognition-v1'); assert.equal(f.session.snapshot().readCalls, 0);
});

test('stopping session preparation settles promptly even if transport ignores abort and separately revokes a late issued token', async t => {
  const begin = deferred(); const f = visualHarness(t, { fetch: call => call.url === '/api/vision/session' ? begin.promise : undefined });
  let settled = false, result; const preparing = f.session.prepare().then(value => { settled = true; result = value; });
  f.session.stop(); await flush(); await flush();
  assert.equal(settled, true); assert.equal(result, false); assert.equal(f.calls[0].init.signal.aborted, true);
  begin.resolve(new Response(JSON.stringify({ token: 'late-issued-session' }))); await preparing; await flush(); await flush();
  const ended = f.calls.filter(call => call.url === '/api/vision/session/end').map(call => call.body.token);
  assert.deepEqual(ended, ['late-issued-session']); assert.equal(f.captures(), 0);
});

test('recognition total deadline begins before capture and aborts a stalled capture without issuing a model request', async t => {
  const capture = deferred(); const f = visualHarness(t, { capture: () => capture.promise }); await f.session.prepare();
  const reading = f.recognize(), rejected = assert.rejects(reading, /取消/); await flush();
  const deadline = f.deadlines.find(entry => entry.ms === 25000); assert.ok(deadline);
  deadline.controller.abort(); await rejected;
  assert.equal(f.calls.some(call => call.url === '/api/vision/recognition'), false); assert.equal(f.session.snapshot().readCalls, 0);
  capture.resolve(null); await flush();
});

test('a response stream inherits the original capture deadline instead of receiving a fresh full network deadline', async t => {
  let canceled = false;
  const f = visualHarness(t, { frame: true, fetch: call => call.url === '/api/vision/recognition'
    ? new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel() { canceled = true; } })) : undefined });
  await f.session.prepare(); const reading = f.recognize(), rejected = assert.rejects(reading, /取消/); await flush();
  const budgets = f.deadlines.filter(entry => entry.ms === 25000); assert.equal(budgets.length, 2);
  budgets[0].controller.abort(); await rejected; await flush();
  assert.equal(budgets[1].controller.signal.aborted, false, 'the unexpired inner timer cannot extend the first deadline');
  assert.equal(canceled, true); assert.equal(f.session.snapshot().readCalls, 1, 'a begun request still spends its shared read slot');
});
