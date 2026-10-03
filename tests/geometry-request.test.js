const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUrl, requestGeometry, BODY_LIMIT } = require('../extension/src/geometry-scene/request.js');
const body = { schemaVersion: '1.0.0', requestId: 'read-1', videoId: 'video-1', frameTime: 6, frameSize: { width: 1920, height: 1080 }, image: 'data:image/jpeg;base64,AAAA' };
const candidate = { schemaVersion: '1.0.0', requestId: 'read-1', videoId: 'video-1', frameTime: 6, status: 'candidate', scene: { ...body, sceneRevision: 0 } };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function options(extra = {}) { return { url: 'http://127.0.0.1:8787', kind: 'read', body, ...extra }; }
test('addresses only resolve the explicit local reader geometry route', () => {
  assert.equal(buildUrl('http://localhost:8787/read?anything=1', 'ask'), 'http://localhost:8787/geometry/ask');
  for (const url of ['https://example.com', 'http://user:secret@localhost', 'file:///private', 'http://127.0.0.1.example.com']) assert.throws(() => buildUrl(url, 'read'));
});
test('valid response is bound to the same video, frame and source dimensions', async () => {
  let accepted; let failure; let calls = 0;
  requestGeometry(options({ fetchImpl: async () => { calls++; return { ok: true, json: async () => candidate }; }, onSuccess: (value) => { accepted = value; }, onFailure: (value) => { failure = value; } }));
  await flush(); assert.equal(calls, 1); assert.equal(accepted, candidate); assert.equal(failure, undefined);
});
test('wrong frame and wrong JPEG-source dimensions are rejected', async () => {
  for (const changed of [{ ...candidate, frameTime: 7 }, { ...candidate, scene: { ...candidate.scene, frameSize: { width: 640, height: 360 } } }]) {
    let accepted = false; let failure;
    requestGeometry(options({ fetchImpl: async () => ({ ok: true, json: async () => changed }), onSuccess: () => { accepted = true; }, onFailure: (value) => { failure = value; } }));
    await flush(); assert.equal(accepted, false); assert.equal(failure.code, 'stale_response');
  }
});
test('cancel propagates to fetch and ignores a provider that resolves late', async () => {
  let resolveFetch; let signal; let outcomes = 0;
  const handle = requestGeometry(options({ fetchImpl: (url, init) => { signal = init.signal; return new Promise((resolve) => { resolveFetch = resolve; }); }, onSuccess: () => { outcomes++; }, onFailure: () => { outcomes++; } }));
  await flush(); handle.cancel(); assert.equal(signal.aborted, true);
  resolveFetch({ ok: true, json: async () => candidate }); await flush(); assert.equal(outcomes, 0);
});
test('timeout aborts once and never accepts late success', async () => {
  let deadline; let signal; let finishFetch; let outcomes = [];
  requestGeometry(options({ clock: { schedule: (delay, fn) => { assert.equal(delay, 30000); deadline = fn; return 1; }, clear() {} }, fetchImpl: (url, init) => { signal = init.signal; return new Promise((resolve) => { finishFetch = resolve; }); }, onSuccess: () => outcomes.push('success'), onFailure: (error) => outcomes.push(error.code) }));
  await flush(); deadline(); assert.equal(signal.aborted, true);
  finishFetch({ ok: true, json: async () => candidate }); await flush(); assert.deepEqual(outcomes, ['timeout']);
});
test('oversized payload and missing model fail honestly without a mock fallback', async () => {
  let called = false; let failure;
  requestGeometry(options({ body: { ...body, image: 'a'.repeat(BODY_LIMIT) }, fetchImpl: async () => { called = true; }, onFailure: (error) => { failure = error; } }));
  await flush(); assert.equal(called, false); assert.equal(failure.code, 'invalid_input');
  requestGeometry(options({ fetchImpl: async () => ({ ok: false, status: 503 }), onFailure: (error) => { failure = error; } }));
  await flush(); assert.equal(failure.code, 'model_unconfigured');
});
test('an action response cannot target a superseded scene revision', async () => {
  const scene = { requestId: body.requestId, videoId: body.videoId, frameTime: body.frameTime, frameSize: body.frameSize, sceneRevision: 1 };
  let failure;
  requestGeometry(options({ kind: 'ask', body: { schemaVersion: '1.0.0', actionRequestId: 'ask-1', scene, text: 'AB 改为 6' }, fetchImpl: async () => ({ ok: true, json: async () => ({ schemaVersion: '1.0.0', actionRequestId: 'ask-1', context: { ...scene, sceneRevision: 0 }, status: 'actions', actions: [{ type: 'explain_change' }] }) }), onFailure: (error) => { failure = error; } }));
  await flush(); assert.equal(failure.code, 'stale_response');
  let accepted;
  requestGeometry(options({ kind: 'ask', body: { schemaVersion: '1.0.0', actionRequestId: 'ask-1', scene, text: '当前 BC 是多少' }, fetchImpl: async () => ({ ok: true, json: async () => ({ schemaVersion: '1.0.0', actionRequestId: 'ask-1', context: scene, status: 'actions', actions: [{ type: 'explain_change' }] }) }), onSuccess: (value) => { accepted = value; } }));
  await flush(); assert.equal(accepted.status, 'actions');
});
test('response envelopes reject undeclared fields and unsupported responses with actions', async () => {
  let failure;
  requestGeometry(options({ fetchImpl: async () => ({ ok: true, json: async () => ({ ...candidate, execute: 'arbitrary code' }) }), onFailure: (value) => { failure = value; } }));
  await flush(); assert.equal(failure.code, 'stale_response');
  const scene = { requestId: body.requestId, videoId: body.videoId, frameTime: body.frameTime, frameSize: body.frameSize, sceneRevision: 1 };
  requestGeometry(options({ kind: 'ask', body: { schemaVersion: '1.0.0', actionRequestId: 'ask-2', scene, text: '不支持' }, fetchImpl: async () => ({ ok: true, json: async () => ({ schemaVersion: '1.0.0', actionRequestId: 'ask-2', context: scene, status: 'unsupported', actions: [{ type: 'restore_original' }] }) }), onFailure: (value) => { failure = value; } }));
  await flush(); assert.equal(failure.code, 'stale_response');
});
