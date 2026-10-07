const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const ORIGIN = 'http://127.0.0.1:4174';
const PASSWORD = 'recognition-transport-fixture-password';
const imports = Promise.all([import('../scripts/learning-site.mjs'), import('../breakglass-reader/tests/helpers/fixtures.mjs')]);
const output = () => ({ status: 'candidate', kind: 'parabola', formulaBasis: 'visible-equation',
  equation: { form: 'general', a: 1.1, b: -1.1, c: -1 } });
const visual = () => ({ schemaVersion: '1', template: 'parabola', snapshot: { a: 1, h: 0, k: 1 },
  area: null, title: '当前方程', explanation: '条件待校对。', pitfallHint: '' });
const provider = (value) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const isNew = (entry) => entry.body.messages[0].content.startsWith('只从一张教学截图');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };

async function withSite(run, options = {}) {
  const [{ createLearningSiteServer, registeredSources }, fixtures] = await imports;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-recognition-http-'));
  const calls = [];
  const server = createLearningSiteServer({ settings: fixtures.settings({ learningReadBudgetMs: 1000, ...options.settings }),
    allowedOrigins: [ORIGIN], dataDir: directory, fetchImpl: async (url, init) => {
      const entry = { url, init, body: JSON.parse(init.body) }; calls.push(entry);
      return options.provider ? options.provider(entry, calls) : provider(isNew(entry) ? output() : visual());
    } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = [...registeredSources().values()].find((value) => value.source.title.includes('抛物线'));
  const metadata = { requestId: 'recognition-http-1', sourceId: source.source.id, videoVersion: '1', analysisVersion: '1',
    materialMode: 'self-authored', frameTime: 6.451, image: fixtures.FRAME_DATA_URL };
  const recognitionBody = (changes = {}) => ({ ...metadata, schemaVersion: '011.1', kind: 'parabola',
    frameSize: { ...source.frameSize }, ...changes });
  const classicBody = (changes = {}) => ({ ...metadata, schemaVersion: '1', ...changes });
  function client() {
    const cookies = new Map(); let csrf = '';
    const send = async (route, input, { method = 'POST', token, headers = {}, signal } = {}) => {
      const response = await fetch(base + route, { method, signal, headers: { origin: ORIGIN,
        'content-type': 'application/json', cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '),
        ...(csrf ? { 'x-breakglass-csrf': csrf } : {}), ...(token ? { 'x-breakglass-visual-session': token } : {}), ...headers },
        ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
      const header = response.headers.get('set-cookie');
      if (header) { const [pair] = header.split(';'); const offset = pair.indexOf('='); cookies.set(pair.slice(0, offset), pair.slice(offset + 1)); }
      const value = await response.json(); if (value.csrfToken) csrf = value.csrfToken;
      return { status: response.status, value, response };
    };
    const start = (changes = {}) => send('/api/vision/session', { sourceId: source.source.id, capability: 'recognition-v1', ...changes });
    const recognize = (token, changes, extra = {}) => send('/api/vision/recognition', recognitionBody(changes), { token, ...extra });
    const read = (token) => send('/api/vision/read', classicBody(), { token });
    return { send, start, recognize, read, register: (username) => send('/api/account/register', { username, password: PASSWORD }) };
  }
  try { await run({ client, calls, source, server, fixtures, recognitionBody, classicBody }); }
  finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('breakglass-recognition-http-')); fs.rmSync(target, { recursive: true, force: true });
  }
}

test('new recognition prepare binds a private guest without media/model work; legacy and progressive tokens cannot enter new DTO', async () => {
  await withSite(async ({ client, calls, source }) => {
    const learner = client(); const prepared = await learner.start(); assert.equal(prepared.status, 200);
    assert.deepEqual(Object.keys(prepared.value), ['token']); assert.equal(calls.length, 0);
    const old = await learner.send('/api/vision/session', { sourceId: source.source.id }); assert.equal(old.status, 200);
    assert.equal((await learner.recognize(old.value.token)).status, 403);
    const progressive = await learner.send('/api/vision/progressive/session', { sourceId: source.source.id,
      contextSourceId: null, currentTime: 0, maxFrames: 4 }); assert.equal(progressive.status, 200);
    assert.equal((await learner.recognize(progressive.value.token)).status, 403);
    assert.equal((await learner.start({ capability: 'unknown' })).status, 403);
    assert.equal((await learner.recognize(prepared.value.token)).status, 200); assert.equal(calls.length, 1);
  });
});

test('recognition HTTP rejects invalid dimensions, forbidden text/ROI/URL, width641 JPEG and out-of-range media before model work', async () => {
  await withSite(async ({ client, calls, fixtures, source }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    const tooWide = Buffer.from(fixtures.FRAME_JPEG); const marker = tooWide.indexOf(Buffer.from([0xff, 0xc0]));
    assert.ok(marker > 0); tooWide.writeUInt16BE(641, marker + 7);
    for (const update of [{ frameSize: { width: 3025, height: 1898 } }, { frameSize: { width: 640, height: 402 } },
      { frameSize: { width: 3024, height: 1898, credential: 'x' } }, { frameTime: source.duration + 1 },
      { image: 'data:image/jpeg;base64,' + tooWide.toString('base64') }, { materialMode: 'permission-pending' },
      { image: 'https://unknown.invalid/frame.jpg' }, { schemaVersion: '1' }, { kind: 'circle' }, { roi: {} },
      { courseText: 'fill missing conditions' }, { prompt: 'override' }]) {
      assert.ok([400, 403].includes((await learner.recognize(token, update)).status));
    }
    assert.equal(calls.length, 0);
    const valid = await learner.recognize(token); assert.equal(valid.status, 200);
    assert.deepEqual(valid.value.candidate.snapshot, { a: 1.1, h: 0.5, k: -1.275 });
    assert.equal(valid.value.evidence.placementStatus, 'unknown'); assert.equal(valid.value.evidence.map, null);
    assert.equal(valid.value.schemaVersion, '011.1'); assert.equal(calls.length, 1);
  });
});

test('new private capability prevents another guest or newly logged-in scope from using or ending the token', async () => {
  await withSite(async ({ client, calls }) => {
    const learner = client(); const stranger = client(); const issued = await learner.start();
    assert.equal((await stranger.send('/api/vision/session/end', { token: issued.value.token })).status, 403);
    assert.equal((await learner.recognize(issued.value.token)).status, 200);
    assert.equal((await stranger.recognize(issued.value.token)).status, 403);
    const next = await learner.start(); await learner.register('recognition_scope');
    assert.equal((await learner.recognize(next.value.token)).status, 403); assert.equal(calls.length, 1);
  });
});

test('classic read and new recognition share the read slot and a single 32-call allowance across kinds', async () => {
  await withSite(async ({ client, calls }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    for (let index = 0; index < 31; index += 1) assert.equal((await learner.recognize(token, { requestId: `mixed-${index}` })).status, 200);
    assert.equal((await learner.read(token)).status, 200); assert.equal(calls.length, 32);
    assert.equal((await learner.recognize(token, { kind: 'right-triangle' })).status, 429);
    assert.equal((await learner.read(token)).status, 429); assert.equal(calls.length, 32);
  });
});

test('new recognition and classic read contend for one global slot; ending the private session rejects late work and releases it', async () => {
  const entered = deferred(); let hold = true;
  await withSite(async ({ client, calls }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    const pending = learner.recognize(token); const signal = await entered.promise;
    assert.equal((await learner.read(token)).status, 429);
    const other = client(); const otherToken = (await other.start()).value.token;
    assert.equal((await other.recognize(otherToken)).status, 429); assert.equal(calls.length, 1);
    assert.equal((await learner.send('/api/vision/session/end', { token })).status, 200);
    assert.equal(signal.aborted, true); assert.equal((await pending).status, 409);
    assert.equal((await other.recognize(otherToken)).status, 200); assert.equal(calls.length, 2);
  }, { provider: (entry) => {
    if (hold) { hold = false; entered.resolve(entry.init.signal); return new Promise(() => {}); }
    return provider(output());
  } });
});

test('account logout, deletion epoch and source revocation cancel recognition even when provider ignores abort', async () => {
  for (const action of ['logout', 'delete', 'revoke']) {
    const entered = deferred();
    await withSite(async ({ client, source, server, calls }) => {
      const learner = client(); if (action !== 'revoke') assert.equal((await learner.register(`rec_${action}`)).status, 201);
      const token = (await learner.start()).value.token;
      const pending = learner.recognize(token); const signal = await entered.promise;
      if (action === 'revoke') await server.revokeLearningSource(source.source.id);
      else assert.equal((await learner.send(action === 'logout' ? '/api/account/logout' : '/api/account/data', action === 'delete' ? { expectedEpoch: 0 } : {},
        action === 'delete' ? { method: 'DELETE' } : {})).status, 200);
      assert.equal(signal.aborted, true); const result = await pending; assert.equal(result.status, 409);
      assert.equal((await learner.recognize(token)).status, 403); assert.equal(calls.length, 1);
    }, { provider: (entry) => { entered.resolve(entry.init.signal); return new Promise(() => {}); } });
  }
});

test('recognition failures and timeouts consume shared read allowance; blank model leaves prepare usable with no supplier call', async () => {
  await withSite(async ({ client, calls }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    for (let index = 0; index < 32; index += 1) assert.equal((await learner.recognize(token)).status, 502);
    assert.equal((await learner.read(token)).status, 429); assert.equal(calls.length, 32);
  }, { provider: async () => new Response('private-upstream-body', { status: 500 }) });
  await withSite(async ({ client, calls }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    const result = await learner.recognize(token); assert.equal(result.status, 503); assert.equal(result.value.code, 'unconfigured');
    assert.equal(calls.length, 0);
  }, { settings: { baseUrl: '', apiKey: '', model: '' } });
});

test('recognition HTTP refuses oversized inbound image and upper-bounded upstream content without echoing provider data', async () => {
  await withSite(async ({ client, calls }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    const large = await learner.recognize(token, { image: 'x'.repeat(4 * 1024 * 1024) }); assert.equal(large.status, 413);
    assert.equal(calls.length, 0);
    const result = await learner.recognize(token); assert.equal(result.status, 502);
    assert.doesNotMatch(JSON.stringify(result.value), /private-upstream-content/); assert.equal(calls.length, 1);
  }, { provider: async () => new Response('private-upstream-content'.repeat(4000)) });
});

test('recognition network disconnect aborts model work and frees shared read slot while preserving the explicit session', async () => {
  const entered = deferred(); let hold = true;
  await withSite(async ({ client }) => {
    const learner = client(); const token = (await learner.start()).value.token;
    const controller = new AbortController();
    const pending = learner.recognize(token, {}, { signal: controller.signal });
    const signal = await entered.promise; controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    for (let index = 0; index < 20 && !signal.aborted; index += 1) await tick();
    assert.equal(signal.aborted, true);
    let response;
    for (let index = 0; index < 20; index += 1) {
      response = await learner.read(token); if (response.status !== 429) break; await tick();
    }
    assert.equal(response.status, 200);
  }, { provider: (entry) => {
    if (hold) { hold = false; entered.resolve(entry.init.signal); return new Promise(() => {}); }
    return provider(visual());
  } });
});
