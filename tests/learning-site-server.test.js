const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

// Actual loopback HTTP and media bytes; all model answers are transport stubs.
// These tests never establish real AI accuracy, learning effects or public release.
const modules = Promise.all([
  import('../scripts/learning-site.mjs'),
  import('../breakglass-reader/tests/helpers/fixtures.mjs')
]);
const ORIGIN = 'http://127.0.0.1:4174';
const OTHER_ORIGIN = 'http://localhost:4174';
const visual = () => ({ schemaVersion: '1', template: 'parabola', snapshot: { a: 1, h: 0, k: 1 },
  area: { x: 0.2, y: 0.2, width: 0.4, height: 0.5 }, title: '抛物线平移',
  explanation: '顶点位置随参数改变，视觉条件仍须校对。', pitfallHint: '留意平移方向。' });
const summary = () => ({ summary: '当前画面观察包含抛物线平移。', keyPoints: ['观察顶点'], pitfalls: ['平移方向'] });
function providerResponse(value) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { headers: { 'content-type': 'application/json' } });
}
async function withSite(run, options = {}) {
  const [{ createLearningSiteServer, registeredSources }, fixtures] = await modules;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-site-http-'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (options.provider) return options.provider({ url, init, body, calls });
    return providerResponse(Array.isArray(body.messages[1].content) ? visual() : summary());
  };
  const server = createLearningSiteServer({ settings: fixtures.settings({ learningReadBudgetMs: 1000,
    learningSummaryBudgetMs: 1000, ...options.settings }), dataDir: directory, fetchImpl,
    allowedOrigins: [ORIGIN, OTHER_ORIGIN] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sources = [...registeredSources().values()];
  const source = sources.find((value) => value.source.title.includes('抛物线'));
  const other = sources.find((value) => value !== source);
  const readBody = (overrides = {}) => ({ schemaVersion: '1', requestId: 'site-request-1',
    sourceId: source.source.id, videoVersion: source.source.version, analysisVersion: '1',
    materialMode: 'self-authored', frameTime: 6.451, image: fixtures.FRAME_DATA_URL, ...overrides });
  const summaryBody = (overrides = {}) => {
    const { frameTime, image, ...metadata } = readBody();
    return { ...metadata, observations: [{ frameTime, title: '抛物线平移', explanation: '顶点位置发生变化。',
      pitfallHint: '留意方向。', template: 'parabola' }], ...overrides };
  };
  const post = (route, value, { token, origin = ORIGIN, headers = {} } = {}) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}),
      ...(token ? { 'x-breakglass-visual-session': token } : {}), ...headers }, body: JSON.stringify(value) });
  const session = async (origin = ORIGIN) => {
    const response = await post('/api/vision/session', { sourceId: source.source.id }, { origin });
    assert.equal(response.status, 200); const value = await response.json();
    assert.match(value.token, /^[0-9a-f-]{36}$/); return value.token;
  };
  function rawPost(route, payload, { token, chunked = false } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(base + route, { method: 'POST', headers: {
        origin: ORIGIN, 'content-type': 'application/json',
        ...(token ? { 'x-breakglass-visual-session': token } : {}),
        ...(chunked ? {} : { 'content-length': Buffer.byteLength(payload) }) } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk)); response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.once('error', reject);
      request.setTimeout(4000, () => request.destroy(new Error('HTTP request timed out')));
      if (chunked) {
        const buffer = Buffer.from(payload);
        for (let offset = 0; offset < buffer.length; offset += 8192) request.write(buffer.subarray(offset, offset + 8192));
        request.end();
      } else request.end(payload);
    });
  }
  try { await run({ base, post, session, readBody, summaryBody, rawPost, calls, source, other, server }); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    // The only recursively deleted path is this test's verified temporary directory.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('breakglass-site-http-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('website HTTP serves only whitelisted scripts/media and rejects secret paths, traversal and foreign Host', { timeout: 8000 }, async () => {
  await withSite(async ({ base, calls }) => {
    const script = await fetch(base + '/extension/src/curve/evaluate.js');
    assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
    assert.match(script.headers.get('content-security-policy'), /object-src 'none'/);
    assert.match(await script.text(), /evaluateWithParameters/);
    for (const route of ['/AGENTS.md', '/.git/config', '/breakglass-reader/.env', '/breakglass-learning/src/store.mjs',
      '/extension/manifest.json', '/learning-site/%5c..%5cAGENTS.md', '/learning-site/%2e%2e%2fAGENTS.md']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404, route); await response.arrayBuffer();
    }
    // Native HTTP is needed: fetch may replace Host with its URL authority.
    const foreignStatus = await new Promise((resolve, reject) => {
      http.get(base + '/api/vision/config', { headers: { host: 'external.invalid' } }, (response) => {
        response.resume(); response.once('end', () => resolve(response.statusCode)); response.once('error', reject);
      }).once('error', reject);
    });
    assert.equal(foreignStatus, 403);
    const redirect = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/learning-site/index.html');
    const range = await fetch(base + '/extension/assets/video/breakglass-demo-9s.mp4', { headers: { range: 'bytes=0-31' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.match(range.headers.get('content-range'), /^bytes 0-31\//);
    const head = await fetch(base + '/extension/assets/video/breakglass-demo-9s.mp4', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.ok(Number(head.headers.get('content-length')) > 0); assert.equal(await head.text(), '');
    const invalidRange = await fetch(base + '/extension/assets/video/breakglass-demo-9s.mp4', { headers: { range: 'bytes=5-2' } });
    assert.equal(invalidRange.status, 416);
    assert.equal(calls.length, 0);
  });
});

test('registered policy returns only the exact self-authored source while unknown/pending sources never call AI', { timeout: 8000 }, async () => {
  await withSite(async ({ base, post, source, calls, readBody }) => {
    const policy = await (await fetch(base + '/api/vision/policy?sourceId=' + source.source.id)).json();
    assert.equal(policy.allowed, true); assert.deepEqual(policy.source, source.source);
    assert.deepEqual(policy.limits, { maxBytes: 64 * 1024 * 1024, maxDuration: 600, maxWidth: 1920, maxHeight: 1080 });
    for (const id of ['file-' + 'f'.repeat(64), 'https://www.bilibili.com/video/pending', 'file-test:unknown']) {
      const unknown = await (await fetch(base + '/api/vision/policy?sourceId=' + encodeURIComponent(id))).json();
      assert.equal(unknown.allowed, false); assert.equal(Object.hasOwn(unknown, 'source'), false);
      assert.match(unknown.reason, /未登记/);
      const session = await post('/api/vision/session', { sourceId: id });
      assert.equal(session.status, 403); assert.equal((await session.json()).code, 'permission_pending');
      const read = await post('/api/vision/read', readBody({ sourceId: id, materialMode: 'licensed' }));
      assert.equal(read.status, 403); await read.text();
    }
    const declared = await post('/api/vision/session', { sourceId: source.source.id, materialMode: 'self-authored' });
    assert.equal(declared.status, 403); await declared.text();
    const config = await (await fetch(base + '/api/vision/config')).json();
    assert.equal(config.supplierConfigured, true);
    assert.equal(config.audioEnabled, false); assert.equal(config.fullVideoUploadEnabled, false);
    assert.doesNotMatch(JSON.stringify(config), /test-key-not-real|vision-test|model\.example/);
    assert.equal(calls.length, 0);
  });
});

test('visual sessions bind exact registered source and Origin; missing/stale tokens and request identity/time fail before AI', { timeout: 8000 }, async () => {
  await withSite(async ({ post, session, readBody, source, other, calls }) => {
    const token = await session();
    for (const options of [{}, { token: 'not-a-token' }, { token, origin: OTHER_ORIGIN },
      { token, origin: 'https://external.invalid' }, { token, origin: null }]) {
      const response = await post('/api/vision/read', readBody(), options);
      assert.equal(response.status, 403); await response.text();
    }
    for (const overrides of [{ sourceId: other.source.id }, { sourceId: 'file-unknown' }, { videoVersion: '2' },
      { analysisVersion: '2' }, { materialMode: 'licensed' }, { materialMode: 'permission-pending' },
      { frameTime: -0.1 }, { frameTime: source.duration + 0.1 }, { frameTime: null }, { frameTime: '1' }]) {
      const response = await post('/api/vision/read', readBody(overrides), { token });
      assert.equal(response.status, 403, JSON.stringify(overrides)); await response.text();
    }
    for (const overrides of [{ prompt: 'override fixed instructions' }, { requestId: 'https://secret.invalid' },
      { schemaVersion: '2' }, { image: 'data:image/png;base64,eA==' }]) {
      const response = await post('/api/vision/read', readBody(overrides), { token });
      assert.equal(response.status, 400, JSON.stringify(overrides)); await response.text();
    }
    const mediaType = await post('/api/vision/read', readBody(), { token, headers: { 'content-type': 'text/plain' } });
    assert.equal(mediaType.status, 415); await mediaType.text();
    assert.equal(calls.length, 0);
    const valid = await post('/api/vision/read', readBody(), { token });
    assert.equal(valid.status, 200);
    const result = await valid.json();
    assert.equal(result.sourceId, source.source.id); assert.equal(result.videoVersion, '1');
    assert.equal(result.frameTime, 6.451); assert.equal(result.requestId, 'site-request-1');
    assert.equal(result.status, 'candidate'); assert.deepEqual(result.result, visual());
    assert.equal(calls.length, 1);
  });
});

test('unconfigured model keeps local policy available and returns explicit 503 without a provider call', { timeout: 8000 }, async () => {
  await withSite(async ({ base, session, post, readBody, source, calls }) => {
    const config = await (await fetch(base + '/api/vision/config')).json();
    assert.equal(config.supplierConfigured, false);
    const policy = await (await fetch(base + '/api/vision/policy?sourceId=' + source.source.id)).json();
    assert.equal(policy.allowed, true); assert.equal(policy.supplierConfigured, false);
    const token = await session();
    const response = await post('/api/vision/read', readBody(), { token });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'unconfigured');
    assert.equal(calls.length, 0);
  }, { settings: { apiKey: '', model: '', baseUrl: '' } });
});

test('HTTP summary uses bounded observations, preserves source identity and derives its times from the input', { timeout: 8000 }, async () => {
  await withSite(async ({ session, post, summaryBody, calls, source }) => {
    const token = await session();
    const body = summaryBody();
    body.observations = [body.observations[0], { ...body.observations[0], frameTime: 1 }, body.observations[0]];
    const response = await post('/api/vision/summarize', body, { token });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.status, 'summary'); assert.equal(result.sourceId, source.source.id);
    assert.deepEqual(result.observedTimes, [1, 6.451]);
    assert.match(result.summary, /仅基于已分析/); assert.match(result.summary, /未包含音频或完整视频/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.messages[1].content.includes('data:image'), false);
    const tooMany = await post('/api/vision/summarize', summaryBody({ observations: Array.from({ length: 21 }, () => body.observations[0]) }), { token });
    assert.equal(tooMany.status, 400); await tooMany.text();
    const outside = await post('/api/vision/summarize', summaryBody({ observations: [{ ...body.observations[0], frameTime: source.duration + 1 }] }), { token });
    assert.equal(outside.status, 403); await outside.text();
    assert.equal(calls.length, 1);
  });
});

test('read has one shared slot, summary remains independent, and session/end aborts upstream and invalidates old tokens', { timeout: 8000 }, async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let held = true;
  await withSite(async ({ post, session, readBody, summaryBody, calls }) => {
    const token = await session();
    const pending = post('/api/vision/read', readBody(), { token });
    const signal = await started;
    const busy = await post('/api/vision/read', readBody(), { token });
    assert.equal(busy.status, 429); await busy.text();
    const secondToken = await session();
    const shared = await post('/api/vision/read', readBody(), { token: secondToken });
    assert.equal(shared.status, 429); await shared.text();
    assert.equal(calls.length, 1);
    const summaryResponse = await post('/api/vision/summarize', summaryBody(), { token });
    assert.equal(summaryResponse.status, 200); await summaryResponse.text();
    assert.equal(calls.length, 2);
    const wrongOriginEnd = await post('/api/vision/session/end', { token }, { origin: OTHER_ORIGIN });
    assert.equal(wrongOriginEnd.status, 200); await wrongOriginEnd.text();
    assert.equal(signal.aborted, false);
    const end = await post('/api/vision/session/end', { token });
    assert.equal(end.status, 200); await end.text();
    assert.equal(signal.aborted, true);
    const cancelled = await pending;
    assert.equal(cancelled.status, 409); await cancelled.text();
    const stale = await post('/api/vision/read', readBody(), { token });
    assert.equal(stale.status, 403); await stale.text();
    const next = await post('/api/vision/read', readBody(), { token: secondToken });
    assert.equal(next.status, 200); await next.text();
    assert.equal(calls.length, 3);
  }, { provider: ({ init, body }) => {
    if (held && Array.isArray(body.messages[1].content)) {
      held = false; entered(init.signal);
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    return providerResponse(Array.isArray(body.messages[1].content) ? visual() : summary());
  } });
});

test('oversized session, frame and chunked summary bodies return HTTP 413 instead of resetting the socket', { timeout: 8000 }, async () => {
  await withSite(async ({ session, readBody, summaryBody, rawPost, calls }) => {
    const oversizedSession = await rawPost('/api/vision/session', JSON.stringify({ sourceId: 'x'.repeat(1200) }));
    assert.equal(oversizedSession.status, 413); assert.match(oversizedSession.body, /上限/);
    const token = await session();
    const frame = await rawPost('/api/vision/read', JSON.stringify(readBody({ image: 'x'.repeat(4 * 1024 * 1024) })), { token });
    assert.equal(frame.status, 413); assert.match(frame.body, /上限/);
    const body = summaryBody(); body.observations[0].explanation = 'x'.repeat(65536);
    const observations = await rawPost('/api/vision/summarize', JSON.stringify(body), { token, chunked: true });
    assert.equal(observations.status, 413); assert.match(observations.body, /上限/);
    assert.equal(calls.length, 0);
  });
});

test('disconnect during an incomplete request body releases the read slot without invoking a model', { timeout: 8000 }, async () => {
  await withSite(async ({ base, server, session, post, readBody, calls }) => {
    const token = await session();
    const received = once(server, 'request');
    const incomplete = http.request(base + '/api/vision/read', { method: 'POST', headers: {
      origin: ORIGIN, 'content-type': 'application/json', 'x-breakglass-visual-session': token } });
    incomplete.on('error', () => {});
    incomplete.write('{"schemaVersion":"1",');
    const [, response] = await received;
    const closed = once(response, 'close');
    const busy = await post('/api/vision/read', readBody(), { token });
    assert.equal(busy.status, 429); await busy.text();
    incomplete.destroy(); await closed;
    assert.equal(calls.length, 0);
    const next = await post('/api/vision/read', readBody(), { token });
    assert.equal(next.status, 200); await next.text();
    assert.equal(calls.length, 1);
  });
});
