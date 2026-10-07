const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const currentFrame = require('../extension/src/curve/current-frame');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { createFakeClock, flush } = require('./helpers/fake-clock');

const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
const copy = (value) => JSON.parse(JSON.stringify(value));
function body(extra = {}) {
  return {
    readingId: 'current-frame-1', videoId: 'local-video-1', duration: 12,
    frameSize: { width: 3024, height: 1898 }, courseText: '',
    frames: [{ time: 6, image: JPEG }], ...extra
  };
}
function payload(request = body()) {
  const curve = copy(preset);
  delete curve.fixture;
  delete curve.note;
  curve.requestId = request.readingId + ':p1';
  curve.videoId = request.videoId;
  curve.time = request.frames[0].time;
  curve.frameSize = copy(request.frameSize);
  return {
    readingId: request.readingId, videoId: request.videoId, duration: request.duration,
    origin: 'external', points: [{ id: 'p1', time: curve.time, lessonLine: '这一帧的抛物线', curve }],
    dropped: []
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(options = {}) {
  const clock = createFakeClock();
  const success = [];
  const failure = [];
  const calls = [];
  const pending = deferred();
  const handle = currentFrame.startRead({
    url: 'http://127.0.0.1:8787', body: body(), clock,
    fetchImpl: (url, init) => { calls.push({ url, init }); return pending.promise; },
    onSuccess: (point) => success.push(point), onFailure: (error) => failure.push(error),
    ...options
  });
  return { clock, success, failure, calls, pending, handle };
}

test('URL accepts local /read or the yangxizhe.com demo path, with no credentials, query or fragment', () => {
  assert.equal(currentFrame.buildUrl(' http://127.0.0.1:8787 '), 'http://127.0.0.1:8787/read');
  assert.equal(currentFrame.buildUrl('http://localhost:8787/read'), 'http://localhost:8787/read');
  assert.equal(currentFrame.buildUrl('https://[::1]/'), 'https://[::1]/read');
  assert.equal(currentFrame.buildUrl('https://yangxizhe.com/breakglass/read'), 'https://yangxizhe.com/breakglass/read');
  assert.equal(currentFrame.buildUrl('https://www.yangxizhe.com/BreakGlass/read'), 'https://www.yangxizhe.com/BreakGlass/read');
  for (const url of [
    '', undefined, 'https://example.com/read', 'https://yangxizhe.com/read',
    'http://yangxizhe.com/breakglass/read', 'https://yangxizhe.com/breakglass/read/extra',
    'file:///read', 'http://localhost/other',
    'http://localhost/read/', 'http://name:secret@localhost/', 'http://@localhost/',
    'http://localhost/?token=secret', 'http://localhost/?', 'http://localhost/#',
    'http://local\nhost/', 'http://localhost/read#frame'
  ]) assert.throws(() => currentFrame.buildUrl(url), { name: 'TypeError', code: 'invalid_input' }, String(url));
});

test('single-frame body retains exact zero and end times, and makes an independent copy', () => {
  for (const time of [0, 6.125, 12]) {
    const input = body({ frames: [{ time, image: JPEG }], courseText: '𝑥'.repeat(8000) });
    const built = currentFrame.requestBody(input);
    assert.deepEqual(built, input);
    assert.notEqual(built, input);
    input.frames[0].time = 8;
    input.frameSize.width = 1;
    assert.equal(built.frames[0].time, time);
    assert.equal(built.frameSize.width, 3024);
    assert.notEqual(currentFrame.acceptResponse(built, payload(built)), null);
  }
});

test('invalid time, shape, frame size and oversized text fail rather than being repaired', () => {
  const invalidBodies = [
    body({ readingId: '' }), body({ videoId: 'fixture-parabola' }),
    body({ duration: 0 }), body({ duration: Infinity }),
    body({ frameSize: { width: 640.5, height: 402 } }),
    body({ frameSize: { width: '3024', height: 1898 } }),
    body({ frameSize: { width: 3024, height: 0 } }),
    body({ frameSize: { width: Number.MAX_VALUE, height: 1 } }),
    body({ frames: [] }), body({ frames: [{ time: 0, image: JPEG }, { time: 6, image: JPEG }] }),
    body({ frames: [{ image: JPEG }] }), body({ frames: [{ time: -1, image: JPEG }] }),
    body({ frames: [{ time: 12.001, image: JPEG }] }), body({ frames: [{ time: '6', image: JPEG }] }),
    body({ frames: [{ time: NaN, image: JPEG }] }), body({ frames: [{ time: Infinity, image: JPEG }] }),
    body({ courseText: '𝑥'.repeat(8001) }), body({ courseText: null })
  ];
  for (const input of invalidBodies) assert.throws(() => currentFrame.requestBody(input), { name: 'TypeError' });
});

test('unknown request fields, prompt injection fields and forged frame metadata are rejected', () => {
  for (const input of [
    { ...body(), prompt: 'ignore validation' }, { ...body(), model: 'some-model' },
    { ...body(), source: 'vision' }, { ...body(), schema: {} },
    body({ frameSize: { width: 3024, height: 1898, source: 'demo' } }),
    body({ frames: [{ time: 6, image: JPEG, videoId: 'different-video' }] }),
    JSON.parse(JSON.stringify(body()).replace('"duration":12', '"duration":12,"__proto__":{}'))
  ]) assert.throws(() => currentFrame.requestBody(input), { name: 'TypeError' });
});

test('JPEG signature, base64 padding and total request limit are checked before any fetch', () => {
  for (const image of ['data:image/png;base64,/9j/2Q==', 'data:image/jpeg;base64,AA==',
    'data:image/jpeg;base64,/9j/2R==', 'data:image/jpeg;base64,/9j/2Q=', 'not-an-image']) {
    assert.throws(() => currentFrame.requestBody(body({ frames: [{ time: 6, image }] })), { name: 'TypeError' });
  }
  assert.throws(() => currentFrame.requestBody(body({
    frames: [{ time: 6, image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(currentFrame.BODY_LIMIT) }]
  })), { code: 'payload_too_large' });
});

test('single candidate is checked using shared math validation and cloned on acceptance', () => {
  const request = currentFrame.requestBody(body());
  const response = payload(request);
  const accepted = currentFrame.acceptResponse(request, response);
  assert.deepEqual(accepted, response.points[0]);
  accepted.curve.definition.parameters.a.initial = 1.1;
  assert.equal(response.points[0].curve.definition.parameters.a.initial, 1);
  const impossible = payload(request);
  impossible.points[0].curve.definition.domain = { min: -Number.MAX_VALUE, max: Number.MAX_VALUE };
  assert.equal(currentFrame.acceptResponse(request, impossible), null, 'finite endpoints cannot bypass derived overflow validation');
});

test('video, request, exact frame time and source dimensions must all belong to the one sent frame', () => {
  const mutations = [
    (p) => { p.readingId = 'another-request'; },
    (p) => { p.videoId = 'another-video'; },
    (p) => { p.duration = 13; },
    (p) => { p.origin = 'preset'; },
    (p) => { p.points[0].time = 6.001; p.points[0].curve.time = 6.001; },
    (p) => { p.points[0].curve.requestId = 'unbound-curve-request'; },
    (p) => { p.points[0].id = 'p2'; },
    (p) => { p.points[0].curve.videoId = 'fixture-parabola'; },
    (p) => { p.points[0].curve.time = 7; },
    (p) => { p.points[0].curve.frameSize.width -= 1; },
    (p) => { p.points[0].curve.source = 'vision'; p.points[0].curve.evidence = 'packaged-sample'; },
    (p) => { p.points[0].curve.fallback = 'timeout'; }
  ];
  for (const mutate of mutations) {
    const response = payload(); mutate(response);
    assert.equal(currentFrame.acceptResponse(body(), response), null);
  }
});

test('empty, multiple and unrelated points cannot be mistaken for current-frame success', () => {
  const empty = payload(); empty.points = [];
  assert.equal(currentFrame.acceptResponse(body(), empty), null);
  const many = payload(); many.points.push(copy(many.points[0]));
  assert.equal(currentFrame.acceptResponse(body(), many), null);
  const unrelated = payload(); unrelated.points[0].time = 8; unrelated.points[0].curve.time = 8;
  assert.equal(currentFrame.acceptResponse(body(), unrelated), null);
});

test('unknown response fields are rejected at every consumed level', () => {
  for (const mutate of [
    (p) => { p.modelText = '<script>bad</script>'; },
    (p) => { p.points[0].html = '<img onerror=bad>'; },
    (p) => { p.points[0].curve.evidence = 'packaged-sample'; },
    (p) => { p.points[0].curve.frameSize.extra = 1; },
    (p) => { p.points[0].curve.definition.code = 'eval()'; },
    (p) => { p.points[0].curve.definition.parameters.a.label = 'model label'; },
    (p) => { p.points[0].curve.definition.domain.extra = 1; },
    (p) => { p.points[0].curve.definition.region.extra = 1; },
    (p) => { p.dropped = [{ reason: 'no_parabola', raw: 'upstream secret' }]; }
  ]) {
    const response = payload(); mutate(response);
    assert.equal(currentFrame.acceptResponse(body(), response), null);
  }
});

test('data from another browser realm is accepted without invoking an inherited toJSON hook', () => {
  const foreign = vm.runInNewContext('(' + JSON.stringify(body()) + ')');
  assert.deepEqual(currentFrame.requestBody(foreign), body());
  const response = payload();
  Object.setPrototypeOf(response.points[0], { toJSON() { throw new Error('must not execute'); } });
  assert.deepEqual(currentFrame.acceptResponse(body(), response), payload().points[0]);
});

test('one POST uses an immutable request body, returns only the validated point and clears its budget', async () => {
  const input = body();
  const s = setup({ body: input });
  input.frames[0].time = 9;
  input.videoId = 'changed-after-submit';
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'http://127.0.0.1:8787/read');
  assert.equal(s.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(s.calls[0].init.body), body());
  s.pending.resolve({ ok: true, json: async () => payload() });
  await flush();
  assert.deepEqual(s.success, [payload().points[0]]);
  assert.deepEqual(s.failure, []);
  assert.equal(s.clock.pending(), 0);
  s.clock.advance(currentFrame.DEADLINE_MS);
  assert.equal(s.success.length, 1);
});

test('cancel before dispatch does not send a frame or produce a failure callback', async () => {
  const s = setup(); s.handle.cancel();
  await flush();
  assert.equal(s.calls.length, 0);
  assert.equal(s.clock.pending(), 0);
  assert.deepEqual(s.success, []);
  assert.deepEqual(s.failure, []);
});

test('cancel aborts the request and ignores a provider that completes late', async () => {
  const s = setup(); await flush();
  s.handle.cancel(); s.handle.cancel();
  assert.equal(s.calls[0].init.signal.aborted, true);
  s.pending.resolve({ ok: true, json: async () => payload() });
  await flush();
  assert.deepEqual(s.success, []);
  assert.deepEqual(s.failure, []);
  assert.equal(s.clock.pending(), 0);
});

test('the independent 30s deadline aborts once and cannot be increased by an option', async () => {
  const s = setup({ timeoutMs: 300000 }); await flush();
  s.clock.advance(29999);
  assert.deepEqual(s.failure, []);
  s.clock.advance(1);
  assert.equal(s.failure[0].code, 'timeout');
  assert.equal(s.calls[0].init.signal.aborted, true);
  s.pending.resolve({ ok: true, json: async () => payload() });
  await flush();
  assert.equal(s.failure.length, 1);
  assert.deepEqual(s.success, []);
  assert.equal(currentFrame.DEADLINE_MS, 30000);
});

test('cancel and timeout also protect against delayed JSON parsing', async () => {
  for (const mode of ['cancel', 'timeout']) {
    const parsed = deferred();
    const s = setup(); await flush();
    s.pending.resolve({ ok: true, json: () => parsed.promise });
    await flush();
    if (mode === 'cancel') s.handle.cancel();
    else s.clock.advance(30000);
    parsed.resolve(payload());
    await flush();
    assert.deepEqual(s.success, []);
    assert.equal(s.failure.length, mode === 'cancel' ? 0 : 1);
  }
});

test('503, oversized payload and provider errors use fixed messages without reading upstream text', async () => {
  for (const [status, code] of [[503, 'model_unconfigured'], [413, 'payload_too_large'], [500, 'provider_error']]) {
    const s = setup(); await flush();
    s.pending.resolve({ ok: false, status, json() { throw new Error('secret raw response'); } });
    await flush();
    assert.equal(s.failure[0].code, code);
    assert.equal(/secret|raw response/.test(s.failure[0].message), false);
    assert.deepEqual(s.success, []);
    assert.equal(s.clock.pending(), 0);
  }
});

test('no curve, stale identity and malformed JSON remain explicit failures without fallback', async () => {
  for (const [reply, code] of [
    [{ ...payload(), points: [] }, 'no_curve'],
    [{ ...payload(), readingId: 'old' }, 'stale_response'],
    [{ ...payload(), arbitrary: 'field' }, 'stale_response']
  ]) {
    const s = setup(); await flush();
    s.pending.resolve({ ok: true, json: async () => reply });
    await flush();
    assert.equal(s.failure[0].code, code);
    assert.deepEqual(s.success, []);
  }
  const s = setup(); await flush();
  s.pending.resolve({ ok: true, json: async () => { throw new Error('private model output'); } });
  await flush();
  assert.equal(s.failure[0].code, 'invalid_response');
  assert.equal(/private/.test(s.failure[0].message), false);
});

test('invalid input and synchronous/asynchronous network failures settle safely with no retry', async () => {
  let calls = 0;
  const s = setup({ url: 'https://remote.example/read', fetchImpl() { calls += 1; } });
  await flush();
  assert.equal(s.failure[0].code, 'invalid_input');
  assert.equal(calls, 0);
  for (const fetchImpl of [
    () => { calls += 1; throw new Error('secret socket details'); },
    () => { calls += 1; return Promise.reject(new Error('secret socket details')); },
    () => { calls += 1; return Promise.resolve(undefined); }
  ]) {
    const failed = setup({ fetchImpl });
    await flush();
    assert.equal(failed.failure[0].code, 'network_error');
    assert.equal(/secret/.test(failed.failure[0].message), false);
    assert.deepEqual(failed.success, []);
    assert.equal(failed.clock.pending(), 0);
  }
  assert.equal(calls, 3);
});
