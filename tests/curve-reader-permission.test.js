// Production curve page and current-frame HTTP adapter; only DOM/media/HTTP are controlled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page');

const READER = 'http://localhost:8765/read';
const settle = async () => { await flush(); await flush(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(payload) { return { ok: true, status: 200, json: async () => payload }; }
function resultFor(call, a = 0.8) {
  const body = JSON.parse(call.init.body), time = body.frames[0].time, id = 'current-point';
  return {
    readingId: body.readingId, videoId: body.videoId, duration: body.duration, origin: 'external', dropped: [],
    points: [{ id, time, lessonLine: '此帧显示可调节的抛物线。', curve: {
      requestId: body.readingId + ':' + id, videoId: body.videoId, time,
      frameSize: { ...body.frameSize }, source: 'preset', fallback: null,
      definition: {
        equationId: 'fixture.parabola', parameters: {
          a: { initial: a, min: 0.4, max: 1.2, step: 0.1 },
          h: { initial: 0, min: -2, max: 2, step: 0.1 },
          k: { initial: 0, min: -2, max: 2, step: 0.1 }
        },
        dragParameter: 'h', domain: { min: -4, max: 4 }, range: { min: -4, max: 4 }, yAxis: 'up',
        region: { x: 480, y: 220, width: 960, height: 620 }
      }
    } }]
  };
}
function medium(updates = {}) {
  const source = { kind: 'self-authored', id: 'source-a', version: '1', analysisVersion: '1' };
  return { generation: 1, owner: 'local:guest:0', epoch: 0, source,
    selection: { source, name: 'own.mp4' }, sample: null, ...updates };
}
async function open(t, overrides = {}) {
  const authority = { permitted: true, active: true, generation: 0 };
  const calls = [], scenes = [];
  const h = await createHarness({
    pageOptions: {
      fixedReaderEndpoint: READER, canRead: () => authority.permitted,
      isActive: () => authority.active, getPermissionGeneration: () => authority.generation,
      onScene: scene => scenes.push(scene), ...overrides
    },
    fetchImpl(url, init, fallback) {
      if (init?.method !== 'POST') return fallback(url, init);
      const request = deferred();
      calls.push({ url: String(url), init, ...request });
      return request.promise;
    }
  });
  t.after(() => { h.page.destroy(); h.restore(); });
  const media = medium();
  h.page.onMediaChange(media); h.video.src = 'blob:own-source-a'; h.ready();
  await settle();
  assert.equal(calls.length, 0, 'metadata alone never uploads the borrowed video');
  return { h, authority, calls, scenes, media };
}
async function wake(h) { h.elements['wake-button'].dispatch('click'); await settle(); }
function pageText(h) {
  return ['state-label', 'lesson-status', 'source-note', 'stage-banner-title', 'stage-banner-detail']
    .map(id => h.elements[id].textContent).join('\n');
}
function staticListenerCount(h) {
  return h.document.listenerCount() + h.win.listenerCount()
    + Object.values(h.elements).reduce((count, node) => count + node.listenerCount(), 0);
}

for (const outcome of ['success', 'failure']) test(`off/re-enable aborts the actual old frame read and ignores its late ${outcome}`, async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h); assert.equal(calls.length, 1);
  const old = calls[0]; let aborts = 0;
  assert.ok(old.init.signal instanceof AbortSignal);
  old.init.signal.addEventListener('abort', () => { aborts++; });
  authority.permitted = false; authority.generation++;
  h.page.stopReader(); h.page.stopReader();
  assert.equal(old.init.signal.aborted, true); assert.equal(aborts, 1, 'repeated cancellation aborts once');
  authority.permitted = true; authority.generation++;
  h.video.dispatch('loadedmetadata'); await wake(h); assert.equal(calls.length, 2);
  const current = calls[1], before = { text: pageText(h), scenes: scenes.length, mounts: h.win.__breakglassWakeMounts };
  if (outcome === 'success') old.resolve(response(resultFor(old, 1.1)));
  else old.reject(new Error('late withdrawn request failure'));
  await settle();
  assert.equal(h.overlay(), null); assert.equal(pageText(h), before.text);
  assert.equal(scenes.length, before.scenes); assert.equal(h.win.__breakglassWakeMounts, before.mounts);
  current.resolve(response(resultFor(current, 0.6))); await settle();
  assert.ok(h.overlay()); assert.equal(scenes.at(-1).snapshot.a, 0.6);
  assert.equal(scenes.at(-1).confirmed, false);
});

for (const outcome of ['success', 'failure']) test(`permission generation alone retires a stale ${outcome} and leaves the next gesture usable`, async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h); const old = calls[0];
  authority.generation++;
  if (outcome === 'success') old.resolve(response(resultFor(old)));
  else old.resolve(response({}, 503));
  await settle();
  assert.equal(h.overlay(), null); assert.equal(scenes.some(scene => scene), false);
  assert.equal(h.page.confirmScene(), false);
  await wake(h); assert.equal(calls.length, 2, 'the retired response releases busy without a separate cancellation');
  calls[1].resolve(response(resultFor(calls[1]))); await settle(); assert.ok(h.overlay());
});

for (const gate of ['canRead', 'isActive']) test(`late frame results independently recheck ${gate}`, async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h);
  if (gate === 'canRead') authority.permitted = false;
  else authority.active = false;
  calls[0].resolve(response(resultFor(calls[0]))); await settle();
  assert.equal(h.overlay(), null); assert.equal(scenes.some(scene => scene), false);
  assert.equal(h.page.confirmScene(), false);
});

for (const change of ['owner', 'epoch', 'source', 'generation']) test(`${change} changes abort the current read and allow only the replacement response`, async t => {
  const { h, calls, scenes, media } = await open(t);
  await wake(h); const old = calls[0];
  const updates = change === 'owner' ? { owner: 'account:new-owner' }
    : change === 'epoch' ? { epoch: 1 }
      : change === 'generation' ? { generation: 2 }
        : { generation: 2, source: { ...media.source, id: 'source-b', version: '2' } };
  h.page.onMediaChange(medium(updates));
  if (change === 'source') h.video.src = 'blob:own-source-b';
  assert.equal(old.init.signal.aborted, true);
  await wake(h); assert.equal(calls.length, 2);
  old.resolve(response(resultFor(old, 1.1))); await settle();
  assert.equal(h.overlay(), null); assert.equal(scenes.some(scene => scene), false);
  calls[1].resolve(response(resultFor(calls[1], 0.5))); await settle();
  assert.equal(scenes.at(-1).snapshot.a, 0.5);
});

test('source identity is rechecked on return even when a borrowed source changes in place', async t => {
  const { h, calls, media, scenes } = await open(t);
  await wake(h);
  media.source.version = '2';
  calls[0].resolve(response(resultFor(calls[0]))); await settle();
  assert.equal(h.overlay(), null); assert.equal(scenes.some(scene => scene), false);
  assert.equal(h.page.confirmScene(), false);
});

test('hidden cancels the read, disallows capture, and becoming visible requires a new gesture', async t => {
  const { h, calls, scenes } = await open(t);
  await wake(h); const old = calls[0], captures = h.canvasCaptures.length;
  h.document.hidden = true; h.document.visibilityState = 'hidden'; h.document.dispatch('visibilitychange');
  assert.equal(old.init.signal.aborted, true);
  await wake(h); assert.equal(calls.length, 1); assert.equal(h.canvasCaptures.length, captures);
  h.document.hidden = false; h.document.visibilityState = 'visible'; h.document.dispatch('visibilitychange');
  await settle(); assert.equal(calls.length, 1, 'restoring visibility does not upload');
  old.resolve(response(resultFor(old))); await settle();
  assert.equal(h.overlay(), null); assert.equal(scenes.some(scene => scene), false);
  await wake(h); assert.equal(calls.length, 2);
  calls[1].resolve(response(resultFor(calls[1]))); await settle(); assert.ok(h.overlay());
});

test('AI result is a candidate until a separate authorized confirmScene action', async t => {
  const { h, calls, scenes } = await open(t);
  await wake(h); calls[0].resolve(response(resultFor(calls[0]))); await settle();
  assert.ok(h.overlay()); assert.ok(scenes.some(scene => scene));
  assert.ok(scenes.filter(Boolean).every(scene => !scene.confirmed && scene.requiresConfirmation));
  h.elements['parameter-h'].value = '1'; h.elements['parameter-h'].dispatch('input');
  assert.equal(scenes.at(-1).confirmed, false, 'adjusting coefficients alone does not confirm AI output');
  assert.equal(h.page.confirmScene(), true);
  assert.equal(scenes.at(-1).confirmed, true); assert.equal(scenes.at(-1).requiresConfirmation, false);
  assert.equal(scenes.at(-1).snapshot.h, 1);
  assert.equal(h.page.confirmScene(), false, 'confirmation is a single transition');
});

test('a withdrawn unconfirmed candidate cannot be confirmed after permission is restored', async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h); calls[0].resolve(response(resultFor(calls[0]))); await settle();
  assert.ok(h.overlay());
  authority.permitted = false;
  assert.equal(h.page.confirmScene(), false, 'confirmation checks current permission independently');
  authority.generation++; h.page.stopReader();
  assert.equal(h.overlay(), null); assert.equal(scenes.at(-1), null);
  authority.permitted = true; authority.generation++;
  assert.equal(h.page.confirmScene(), false);
  await wake(h); assert.equal(calls.length, 2, 'the removed AI candidate is not reused as a cached scene');
  calls[1].resolve(response(resultFor(calls[1], 0.5))); await settle();
  assert.equal(scenes.at(-1).confirmed, false);
});

test('permission generation alone also prevents confirming an already displayed old candidate', async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h); calls[0].resolve(response(resultFor(calls[0]))); await settle();
  authority.generation++;
  assert.equal(h.page.confirmScene(), false);
  assert.equal(scenes.at(-1).confirmed, false);
});

test('reader off preserves confirmed mathematics and permits local coefficient changes without requests', async t => {
  const { h, authority, calls, scenes } = await open(t);
  await wake(h); calls[0].resolve(response(resultFor(calls[0]))); await settle();
  assert.equal(h.page.confirmScene(), true);
  h.elements['parameter-h'].value = '1'; h.elements['parameter-h'].dispatch('input');
  const overlay = h.overlay(), snapshot = h.page.getSnapshot();
  authority.permitted = false; authority.generation++; h.page.stopReader();
  assert.equal(h.overlay(), overlay); assert.deepEqual(h.page.getSnapshot(), snapshot);
  assert.equal(scenes.at(-1).confirmed, true);
  h.elements['parameter-h'].value = '1.5'; h.elements['parameter-h'].dispatch('input');
  assert.equal(scenes.at(-1).snapshot.h, 1.5); assert.equal(scenes.at(-1).confirmed, true);
  assert.equal(calls.length, 1); assert.equal(h.video.src, 'blob:own-source-a');
});

test('destroy aborts the actual read and releases static listeners, timers, frames and media watchers', async t => {
  const { h, calls, scenes } = await open(t);
  await wake(h); const old = calls[0];
  assert.ok(staticListenerCount(h) > 20); assert.ok(h.timers.size > 0);
  h.page.destroy(); h.page.destroy();
  assert.equal(old.init.signal.aborted, true); assert.equal(staticListenerCount(h), 0);
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
  assert.ok(h.observers.every(observer => observer.disconnected));
  assert.ok(h.mediaQueries.every(query => query.handlers.length === 0));
  const sceneCount = scenes.length, mounts = h.win.__breakglassWakeMounts;
  old.resolve(response(resultFor(old))); await settle();
  h.video.dispatch('loadedmetadata'); h.document.dispatch('keydown', { key: 'b', altKey: true, target: h.stage });
  h.elements['wake-button'].dispatch('click'); h.win.dispatch('resize'); await settle();
  assert.equal(calls.length, 1); assert.equal(scenes.length, sceneCount);
  assert.equal(h.win.__breakglassWakeMounts, mounts); assert.equal(h.overlay(), null);
  assert.equal(h.page.confirmScene(), false);
});

for (const outcome of ['success', 'failure']) test(`destroy during configuration boot prevents late ${outcome} from mounting or restoring listeners`, async t => {
  const config = deferred();
  const h = await createHarness({ pageOptions: {}, configPromise: config.promise });
  t.after(() => { h.page.destroy(); h.restore(); });
  assert.ok(staticListenerCount(h) > 20); assert.equal(h.win.__breakglassWakeMounts, 0);
  h.page.destroy(); assert.equal(staticListenerCount(h), 0);
  if (outcome === 'success') config.resolve({ enableLocalMock: true, fallbackAfterMs: 1500,
    presetKey: 'demo-parabola', prewarmed: true, externalAttempt: 'off' });
  else config.reject(new Error('late config failure'));
  await settle();
  h.ready(); h.elements['wake-button'].dispatch('click'); await settle();
  assert.equal(h.win.__breakglassWakeMounts, 0); assert.equal(h.overlay(), null);
  assert.equal(staticListenerCount(h), 0); assert.equal(h.observers.length, 0);
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
});
