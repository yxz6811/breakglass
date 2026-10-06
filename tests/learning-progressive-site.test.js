const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const modules = Promise.all([import('../scripts/learning-site.mjs'), import('../breakglass-reader/tests/helpers/fixtures.mjs')]);
const ORIGIN = 'http://127.0.0.1:4174'; const PASSWORD = 'progressive-test-password';
const answer = () => ({ summary: '只概述本次稀疏教学画面。', keyPoints: ['确认直角条件'], pitfalls: ['确认斜边名称'], objects: [] });
const providerPayload = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer()) } }] }));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function withSite(run, options = {}) {
  const [{ createLearningSiteServer, registeredSources }, fixtures] = await modules;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-progressive-http-'));
  const source = [...registeredSources().values()].find((item) => item.context); const calls = [];
  let server; let base;
  const restart = async (overrides = {}) => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    server = createLearningSiteServer({ settings: fixtures.settings({ learningContextBudgetMs: 1000, ...overrides }), dataDir: directory,
      allowedOrigins: [ORIGIN], fetchImpl: (url, init) => {
        const call = { url, init, body: JSON.parse(init.body) }; calls.push(call);
        return options.provider ? options.provider(call, calls) : providerPayload();
      } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = 'http://127.0.0.1:' + server.address().port;
  };
  function client() {
    const cookies = new Map(); let csrf = ''; let epoch = 0;
    const send = async (route, value, { method = 'POST', token, signal, headers = {} } = {}) => {
      const response = await fetch(base + route, { method, signal,
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: [...cookies].map(([key, text]) => key + '=' + text).join('; '),
          ...(csrf ? { 'x-breakglass-csrf': csrf } : {}), ...(token ? { 'x-breakglass-visual-session': token } : {}), ...headers },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
      const cookie = response.headers.get('set-cookie'); if (cookie) { const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
      const body = await response.json(); if (body.csrfToken) csrf = body.csrfToken; if (body.epoch !== undefined) epoch = body.epoch;
      return { status: response.status, value: body, response };
    };
    const start = () => send('/api/vision/progressive/session', { sourceId: source.source.id, contextSourceId: source.context.id, currentTime: 7, maxFrames: 4 });
    const analyze = (session, overrides = {}, extra = {}) => send('/api/vision/progressive/context', {
      schemaVersion: '1', requestId: 'progressive-' + calls.length, sourceId: source.source.id, videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored',
      frames: session.plan[0].times.map((frameTime) => ({ frameTime, image: fixtures.FRAME_DATA_URL })),
      contextSourceId: source.context.id, windowId: session.plan[0].id, ...overrides }, { token: session.token, ...extra });
    return { send, start, analyze, register: (username) => send('/api/account/register', { username, password: PASSWORD }),
      login: (username) => send('/api/account/login', { username, password: PASSWORD }), get epoch() { return epoch; } };
  }
  await restart();
  try { await run({ client, calls, source, restart, directory, fixtures, getServer: () => server }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('breakglass-progressive-http-'));
    fs.rmSync(directory, { recursive: true, force: true }); }
}

test('explicit progressive sessions freeze allowed sampling, privately reuse AI candidates and keep unknown material closed', async () => {
  await withSite(async ({ client, calls, source }) => {
    const learner = client(); const began = await learner.start(); assert.equal(began.status, 200); assert.equal(began.value.cacheScope, 'guest');
    assert.equal(began.value.plan.length, 1); assert.equal(began.value.plan[0].times.length, 4);
    assert.equal(JSON.stringify(began.value).includes('sessionKey'), false);
    const first = await learner.analyze(began.value); assert.equal(first.status, 200); assert.equal(first.value.cache.hit, false); assert.equal(calls.length, 1);
    const second = await learner.analyze((await learner.start()).value); assert.equal(second.status, 200); assert.equal(second.value.cache.hit, true);
    assert.equal(second.value.cache.label, '来自前次AI分析'); assert.equal(second.value.limitations, first.value.limitations); assert.equal(calls.length, 1);
    const stranger = client(); assert.equal((await stranger.analyze((await stranger.start()).value)).value.cache.hit, false); assert.equal(calls.length, 2);
    assert.equal((await learner.send('/api/vision/progressive/session', { sourceId: 'file-' + 'f'.repeat(64), contextSourceId: null, currentTime: 0, maxFrames: 4 })).status, 403);
    assert.equal((await learner.send('/api/vision/progressive/session', { sourceId: source.source.id, contextSourceId: null, currentTime: 0, maxFrames: 8 })).status, 403);
    assert.equal((await learner.analyze(began.value, { windowId: 'window-99' })).status, 400);
    assert.equal((await learner.analyze(began.value, { frames: [{ frameTime: 1, image: 'bad' }] })).status, 400);
    assert.equal(calls.length, 2);
  });
});

test('account cache survives restart only after new login, isolates another account and clears with a committed deletion epoch', async () => {
  await withSite(async ({ client, calls, restart, directory }) => {
    const alice = client(); await alice.register('cache_alice');
    assert.equal((await alice.analyze((await alice.start()).value)).value.cache.hit, false); assert.equal(calls.length, 1);
    const text = fs.readFileSync(path.join(directory, 'analysis-cache-v1.json'), 'utf8');
    assert.doesNotMatch(text, /sessionKey|image\/jpeg|progressive-test-password|csrfToken/);
    await restart(); await alice.login('cache_alice');
    const reused = await alice.analyze((await alice.start()).value); assert.equal(reused.value.cache.hit, true); assert.equal(calls.length, 1);
    const bob = client(); await bob.register('cache_bob'); assert.equal((await bob.analyze((await bob.start()).value)).value.cache.hit, false); assert.equal(calls.length, 2);
    await alice.send('/api/account/data', { expectedEpoch: alice.epoch }, { method: 'DELETE' });
    const remaining = JSON.parse(fs.readFileSync(path.join(directory, 'analysis-cache-v1.json'), 'utf8')).entries;
    assert.equal(remaining.length, 1, 'only the other account private entry remains');
    assert.equal((await alice.analyze((await alice.start()).value)).value.cache.hit, false); assert.equal(calls.length, 3);
    await alice.send('/api/vision/cache/clear', {});
    assert.equal((await alice.analyze((await alice.start()).value)).value.cache.hit, false); assert.equal(calls.length, 4);
  });
});

test('changed provider configuration and restarted guests cannot reuse an old scope result', async () => {
  await withSite(async ({ client, calls, restart }) => {
    const guest = client(); await guest.analyze((await guest.start()).value); assert.equal(calls.length, 1);
    await restart(); assert.equal((await guest.analyze((await guest.start()).value)).value.cache.hit, false); assert.equal(calls.length, 2);
    const account = client(); await account.register('cache_provider'); await account.analyze((await account.start()).value); assert.equal(calls.length, 3);
    await restart({ model: 'different-model' }); await account.login('cache_provider');
    assert.equal((await account.analyze((await account.start()).value)).value.cache.hit, false); assert.equal(calls.length, 4);
  });
});

test('guest-only cache deletion rotates this browser scope and preserves the logged-in account cache', async () => {
  await withSite(async ({ client, calls, directory }) => {
    const learner = client(); await learner.analyze((await learner.start()).value); assert.equal(calls.length, 1);
    await learner.register('cache_guest_clear'); const accountTask = (await learner.start()).value;
    await learner.analyze(accountTask); assert.equal(calls.length, 2);
    assert.equal((await learner.send('/api/vision/cache/clear-guest', { guestId: 'forged' })).status, 400);
    assert.equal((await learner.send('/api/vision/cache/clear-guest', {})).status, 200);
    assert.equal((await learner.analyze(accountTask)).value.cache.hit, true); assert.equal(calls.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'analysis-cache-v1.json'), 'utf8')).entries.length, 1);
    await learner.send('/api/account/logout', {});
    assert.equal((await learner.analyze((await learner.start()).value)).value.cache.hit, false); assert.equal(calls.length, 3);
  });
});

test('progressive tokens cannot enter classic read/context routes and share the single upstream slot', async () => {
  const begun = deferred(); let upstream;
  await withSite(async ({ client, calls, source, fixtures }) => {
    const learner = client(); const session = (await learner.start()).value;
    const work = learner.analyze(session); await begun.promise;
    assert.equal((await learner.analyze(session)).status, 429);
    const classic = await learner.send('/api/vision/session', { sourceId: source.source.id }); assert.equal(classic.status, 200);
    assert.equal((await learner.send('/api/vision/read', { schemaVersion: '1', requestId: 'classic-while-busy', sourceId: source.source.id,
      videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored', frameTime: 1, image: fixtures.FRAME_DATA_URL }, { token: classic.value.token })).status, 429);
    assert.equal(calls.length, 1);
    assert.equal((await learner.send('/api/vision/session/end', { token: session.token })).status, 200);
    const response = await work; assert.equal(response.status, 409); assert.equal(upstream.aborted, true);
    const next = (await learner.start()).value;
    assert.equal((await learner.send('/api/vision/context', {}, { token: next.token })).status, 403);
    assert.equal((await learner.analyze(next)).status, 403, 'wrong route invalidated the progressive capability');
  }, { provider: (call) => { upstream = call.init.signal; begun.resolve(); return new Promise(() => {}); } });
});

test('logout and material revocation abort actual upstream work and reject late results/cache writes', async () => {
  for (const action of ['logout', 'revoke']) {
    const started = deferred(); let signal;
    await withSite(async ({ client, source, getServer, directory }) => {
      const learner = client(); await learner.register('cache_abort'); const session = (await learner.start()).value;
      const work = learner.analyze(session); await started.promise;
      if (action === 'logout') await learner.send('/api/account/logout', {});
      else await getServer().revokeLearningSource(source.source.id);
      assert.equal(signal.aborted, true); assert.equal((await work).status, 409);
      const filename = path.join(directory, 'analysis-cache-v1.json');
      if (fs.existsSync(filename)) assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).entries.length, 0);
      if (action === 'revoke') assert.equal((await learner.start()).status, 403);
      else assert.equal((await learner.analyze(session)).status, 403);
    }, { provider: (call) => { signal = call.init.signal; started.resolve(); return new Promise(() => {}); } });
  }
});

test('progressive task has an independent 20-model-call budget; failed work never silently starts a new task', async () => {
  await withSite(async ({ client, calls, fixtures }) => {
    const learner = client(); const session = (await learner.start()).value;
    for (let index = 0; index < 20; index += 1) {
      const frames = session.plan[0].times.map((frameTime, frame) => ({ frameTime: frame === 1 ? frameTime + index / 1000 : frameTime, image: fixtures.FRAME_DATA_URL }));
      assert.equal((await learner.analyze(session, { frames })).status, 200);
    }
    assert.equal(calls.length, 20);
    const frames = session.plan[0].times.map((frameTime, frame) => ({ frameTime: frame === 1 ? frameTime + 0.03 : frameTime, image: fixtures.FRAME_DATA_URL }));
    const exhausted = await learner.analyze(session, { frames }); assert.equal(exhausted.status, 429); assert.equal(exhausted.value.code, 'budget_exhausted');
    assert.equal(calls.length, 20);
    assert.equal((await learner.analyze(session)).value.cache.hit, true, 'reusing previous approved work does not spend another upstream call');
  });
});
