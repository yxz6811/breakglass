const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const modules = Promise.all([import('../scripts/learning-site.mjs'), import('../breakglass-reader/tests/helpers/fixtures.mjs')]);
const ORIGIN = 'http://127.0.0.1:4174';
const visual = () => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'unit' },
  area: null, title: '直角三角形', explanation: '两条直角边需要校对。', pitfallHint: '确认斜边。' });
const context = () => ({ summary: '只概述已提供的稀疏教学画面。', keyPoints: ['确认直角'], pitfalls: ['确认边的名称'], objects: [] });
function payload(answer) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
    { headers: { 'content-type': 'application/json' } });
}
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
async function withSite(run, options = {}) {
  const [{ createLearningSiteServer, registeredSources }, fixtures] = await modules;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-context-http-'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); const call = { url, init, body }; calls.push(call);
    if (options.provider) return options.provider(call, calls);
    return payload(body.messages[0].content.includes('本次仅收到') ? context() : visual());
  };
  const server = createLearningSiteServer({ settings: fixtures.settings({ learningContextBudgetMs: 1000, ...options.settings }),
    dataDir: directory, fetchImpl, allowedOrigins: [ORIGIN] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const source = [...registeredSources().values()].find((entry) => entry.context);
  const metadata = { schemaVersion: '1', requestId: 'context-site-test', sourceId: source.source.id,
    videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored' };
  const body = (overrides = {}) => ({ ...metadata,
    frames: [{ frameTime: 1, image: fixtures.FRAME_DATA_URL }, { frameTime: 7, image: fixtures.FRAME_DATA_URL }],
    contextSourceId: source.context.id, ...overrides });
  const read = (overrides = {}) => ({ ...metadata, frameTime: 1, image: fixtures.FRAME_DATA_URL, ...overrides });
  const post = (route, value, token, signal, headers = {}) => fetch(base + '/api/vision/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN,
      ...(token ? { 'x-breakglass-visual-session': token } : {}), ...headers }, body: JSON.stringify(value), signal });
  const open = async () => {
    const response = await post('session', { sourceId: source.source.id }); assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  try { await run({ base, source, body, read, post, open, calls, fixtures }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('context gateway registers author subtitle SHA, exposes identity only and derives exact author cues server-side', async () => {
  await withSite(async ({ base, source, body, open, post, calls }) => {
    const text = fs.readFileSync(path.join(__dirname, '../extension/assets/video/geometry/triangle-3-4-5.zh.vtt'), 'utf8');
    const id = 'subtitle-' + createHash('sha256').update(text).digest('hex');
    assert.equal(source.context.id, id);
    const policy = await (await fetch(base + '/api/vision/policy?sourceId=' + source.source.id)).json();
    assert.equal(policy.context.id, id); assert.equal(Object.hasOwn(policy.context, 'cues'), false);
    assert.equal((await fetch(base + '/extension/assets/video/geometry/triangle-3-4-5.zh.vtt')).status, 404);
    const response = await post('context', body(), await open()); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.contextSourceId, id);
    assert.deepEqual(value.coverage.inputTypes, ['frames', 'subtitle']);
    const data = JSON.parse(calls[0].body.messages[1].content[0].text);
    assert.deepEqual(data.authorCues, source.context.cues.slice(0, 2));
    assert.equal(calls.length, 1);
  });
});

test('context gateway rejects external cue text, forged subtitle identity and wrong origins before model work', async () => {
  await withSite(async ({ body, open, post, calls }) => {
    const token = await open();
    assert.equal((await post('context', body({ cues: [{ start: 0, end: 1, text: 'uploaded arbitrary subtitle' }] }), token)).status, 400);
    assert.equal((await post('context', body({ contextSourceId: 'subtitle-' + 'f'.repeat(64) }), token)).status, 400);
    assert.equal((await post('context', body(), token, undefined, { origin: 'https://www.bilibili.com' })).status, 403);
    assert.equal((await post('context', body(), 'forged-token')).status, 403);
    assert.equal(calls.length, 0);
  });
});

test('context accepts frames alone and truthfully labels an empty registered subtitle window as frames only', async () => {
  await withSite(async ({ body, open, post, calls, fixtures }) => {
    const token = await open();
    const response = await post('context', body({ contextSourceId: null }), token);
    assert.equal(response.status, 200); const value = await response.json();
    assert.equal(value.contextSourceId, null); assert.deepEqual(value.coverage.inputTypes, ['frames']);
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content[0].text).authorCues, []);
    const gap = await post('context', body({ frames: [{ frameTime: 4.0005, image: fixtures.FRAME_DATA_URL }] }), token);
    assert.equal(gap.status, 200); const gapValue = await gap.json();
    assert.notEqual(gapValue.contextSourceId, null); assert.deepEqual(gapValue.coverage.inputTypes, ['frames']);
  });
});

test('pending/unknown video licensing and out-of-source times cannot be promoted by client metadata', async () => {
  await withSite(async ({ body, open, post, calls }) => {
    assert.equal((await post('session', { sourceId: 'file-' + 'f'.repeat(64) })).status, 403);
    const token = await open();
    assert.equal((await post('context', body({ materialMode: 'permission-pending' }), token)).status, 403);
    assert.equal((await post('context', body({ sourceId: 'file-' + 'f'.repeat(64) }), token)).status, 403);
    const input = body(); input.frames[1].frameTime = 13;
    assert.equal((await post('context', input, token)).status, 403); assert.equal(calls.length, 0);
  });
});

test('unconfigured context service returns 503 and transmits zero material to a supplier', async () => {
  await withSite(async ({ body, open, post, calls }) => {
    const response = await post('context', body(), await open()); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'unconfigured'); assert.equal(calls.length, 0);
  }, { settings: { model: '' } });
});

test('context and current-frame reads share one in-flight slot; ending the session aborts the actual upstream signal', async () => {
  const started = deferred(); let upstream;
  await withSite(async ({ body, read, open, post, calls }) => {
    const token = await open();
    const work = post('context', body(), token); await started.promise;
    assert.equal((await post('read', read(), token)).status, 429);
    assert.equal((await post('context', body(), token)).status, 429); assert.equal(calls.length, 1);
    assert.equal((await post('session/end', { token })).status, 200);
    const response = await work; assert.equal(response.status, 409); assert.equal(upstream.aborted, true);
    assert.equal((await post('context', body(), token)).status, 403);
    const next = await post('context', body(), await open()); assert.equal(next.status, 200);
  }, { provider: (call, calls) => {
    if (calls.length === 1) { upstream = call.init.signal; started.resolve(); return new Promise(() => {}); }
    return payload(context());
  } });
});

test('context transport disconnection cancels supplier work and does not leave the shared read slot occupied', async () => {
  const started = deferred(); const aborted = deferred(); let upstream;
  await withSite(async ({ body, open, post }) => {
    const token = await open(); const controller = new AbortController();
    const work = post('context', body(), token, controller.signal); await started.promise;
    controller.abort(); await assert.rejects(work, { name: 'AbortError' }); await aborted.promise;
    assert.equal(upstream.aborted, true);
    const response = await post('context', body(), token); assert.equal(response.status, 200);
  }, { provider: (call, calls) => {
    if (calls.length === 1) {
      upstream = call.init.signal; upstream.addEventListener('abort', () => aborted.resolve(), { once: true });
      started.resolve(); return new Promise(() => {});
    }
    return payload(context());
  } });
});

test('session quotas enforce 32 single-frame reads and four context calls without retry or extra supplier work', async () => {
  await withSite(async ({ body, read, open, post, calls }) => {
    const token = await open();
    for (let index = 0; index < 32; index += 1) assert.equal((await post('read', read({ requestId: 'read-' + index }), token)).status, 200);
    assert.equal((await post('read', read(), token)).status, 429); assert.equal(calls.length, 32);
    for (let index = 0; index < 4; index += 1) assert.equal((await post('context', body({ requestId: 'context-' + index }), token)).status, 200);
    assert.equal((await post('context', body(), token)).status, 429); assert.equal(calls.length, 36);
  });
});
