const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { once } = require('node:events');

// Real loopback HTTP with simulated trusted TLS proxy headers and explicitly
// artificial approval files. This never establishes TLS/public/cloud/legal validation.
const PUBLIC = 'https://learning.example.com';
const LOCAL = 'http://127.0.0.1:4174';
const PASSWORD = 'production-test-password';
const PROOF = 'TEST FIXTURE ONLY: not a copyright license or production approval.';
const sha = (text) => createHash('sha256').update(text).digest('hex');
function send(base, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(base + route, { method, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.once('error', reject);
      response.once('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let value;
        try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, headers: response.headers, value }); });
    });
    request.once('error', reject); request.setTimeout(5000, () => request.destroy(new Error('bounded HTTP timeout'))); request.end(payload);
  });
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
async function fixture(run, { settings: suppliedSettings, audioSettings: suppliedAudioSettings, audioExtractImpl, fetchImpl } = {}) {
  const [{ createLearningSiteServer, registeredSources }, { inspectRelease, supplierRuntimeFingerprint }, { loadSettings }, { loadAudioSettings }, { createLearningHandler }] = await Promise.all([
    import('../scripts/learning-site.mjs'), import('../scripts/learning-release.mjs'), import('../breakglass-reader/src/settings.mjs'),
    import('../scripts/learning-audio.mjs'), import('../breakglass-learning/src/server.mjs')]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-production-http-'));
  const dataDir = path.join(directory, 'data'); const filename = path.join(directory, 'release.json'); const secret = randomBytes(32).toString('base64url');
  const settings = suppliedSettings || loadSettings({}); const audioSettings = suppliedAudioSettings || loadAudioSettings({});
  const seedHandler = createLearningHandler({ dataDir, allowedOrigins: [LOCAL] });
  const seed = http.createServer(async (request, response) => { if (!await seedHandler(request, response)) { response.writeHead(404); response.end(); } });
  const seedBase = await listen(seed); let server;
  try {
    const alice = await send(seedBase, 'POST', '/api/account/register', { username: 'approved_alice', password: PASSWORD }, { origin: LOCAL });
    const bob = await send(seedBase, 'POST', '/api/account/register', { username: 'unapproved_bob', password: PASSWORD }, { origin: LOCAL });
    assert.equal(alice.status, 201); assert.equal(bob.status, 201); await close(seed);
    const evidence = [];
    for (const kind of ['rights', 'privacy', 'regional-release', 'supplier-data-flow']) {
      const file = `${kind}.txt`; await fs.writeFile(path.join(directory, file), PROOF);
      evidence.push({ id: `test-${kind}`, kind, file, sha256: sha(PROOF), countries: ['CN'], audience: ['adults'], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    }
    const manifest = { schemaVersion: '1', mode: 'production-pilot', publicOrigin: PUBLIC, dataDir,
      operator: { name: 'Test fixture operator', contact: 'fixture@example.com' }, countries: ['CN'], audience: ['adults'],
      expiresAt: new Date(Date.now() + 3600000).toISOString(), runtimeFingerprint: supplierRuntimeFingerprint(settings, audioSettings), evidence,
      accounts: [{ id: alice.value.user.id, country: 'CN', ageBand: 'adult', guardianEvidenceId: null }] };
    await fs.writeFile(filename, JSON.stringify(manifest));
    const inspected = await inspectRelease(filename, { edgeSecret: secret, expectedFingerprint: supplierRuntimeFingerprint(settings, audioSettings) });
    assert.equal(inspected.report.ready, true);
    server = createLearningSiteServer({ settings, audioSettings, dataDir, allowedOrigins: [PUBLIC], releasePolicy: inspected.policy,
      ...(fetchImpl ? { fetchImpl } : {}), ...(audioExtractImpl ? { audioExtractImpl } : {}) });
    const base = await listen(server);
    const edge = { host: 'learning.example.com', 'x-forwarded-proto': 'https', 'x-breakglass-edge-secret': secret };
    const request = (method, route, body, overrides = {}) => send(base, method, route, body, { ...edge, ...overrides });
    const login = (username, overrides = {}) => request('POST', '/api/account/login', { username, password: PASSWORD }, { origin: PUBLIC, ...overrides });
    await run({ request, login, inspected, manifest, filename, directory, secret, server, alice: alice.value, bob: bob.value,
      source: [...registeredSources().values()][0] });
  } finally {
    if (seed.listening) await close(seed); if (server?.listening) await close(server);
    const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('breakglass-production-http-')); await fs.rm(target, { recursive: true, force: true });
  }
}
const cookie = (reply) => reply.headers['set-cookie'][0].split(';')[0];
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const providerResponse = (value) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));

test('production gateway construction refuses unsafe supplier routing without tightening the development transport contract', { timeout: 10000 }, async () => {
  const { createLearningSiteServer } = await import('../scripts/learning-site.mjs');
  const fixtures = await import('../breakglass-reader/tests/helpers/fixtures.mjs');
  await fixture(async ({ inspected, manifest }) => {
    for (const baseUrl of ['http://public-provider.example.com/v1', 'https://user:password@provider.example.com/v1',
      'https://provider.example.com/v1?key=private', 'https://provider.example.com/v1#private', 'not a URL']) {
      for (const audio of [false, true]) assert.throws(() => createLearningSiteServer({ dataDir: manifest.dataDir,
        allowedOrigins: [PUBLIC], releasePolicy: inspected.policy,
        ...(audio ? { audioSettings: { baseUrl } } : { settings: fixtures.settings({ baseUrl }) }) }), /supplier_runtime_config_invalid/);
    }
    let development;
    assert.doesNotThrow(() => { development = createLearningSiteServer({ dataDir: manifest.dataDir, allowedOrigins: [LOCAL],
      settings: fixtures.settings({ baseUrl: 'http://public-provider.example.com/v1' }), fetchImpl: async () => providerResponse({}) }); });
    development.closeAllConnections();
  });
});
test('production classic and progressive supplier requests explicitly reject redirects and do not expose redirected content', { timeout: 15000 }, async () => {
  const fixtures = await import('../breakglass-reader/tests/helpers/fixtures.mjs');
  for (const progressive of [false, true]) {
    const calls = [];
    await fixture(async ({ request, login, source }) => {
      const approved = await login('approved_alice'); const auth = { cookie: cookie(approved), origin: PUBLIC, 'x-breakglass-csrf': approved.value.csrfToken };
      const session = await request('POST', progressive ? '/api/vision/progressive/session' : '/api/vision/session',
        progressive ? { sourceId: source.source.id, contextSourceId: null, currentTime: 0, maxFrames: 4 } : { sourceId: source.source.id }, auth);
      assert.equal(session.status, 200); const window = progressive ? session.value.plan[0] : null;
      const metadata = { schemaVersion: '1', requestId: `production-redirect-${progressive}`, sourceId: source.source.id,
        videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored' };
      const body = progressive ? { ...metadata, contextSourceId: null, windowId: window.id,
        frames: window.times.map((frameTime) => ({ frameTime, image: fixtures.FRAME_DATA_URL })) }
        : { ...metadata, frameTime: 1, image: fixtures.FRAME_DATA_URL };
      const result = await request('POST', progressive ? '/api/vision/progressive/context' : '/api/vision/read', body,
        { ...auth, 'x-breakglass-visual-session': session.value.token });
      assert.equal(result.status, 502); assert.equal(calls.length, 1);
      assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].url, 'https://model.example/v1/chat/completions');
      assert.doesNotMatch(JSON.stringify(result.value), /redirected-private-content|redirect-target/);
    }, { settings: fixtures.settings(), fetchImpl: async (url, options) => { calls.push({ url, options });
      return new Response('redirected-private-content', { status: 302, headers: { location: 'https://redirect-target.example/v1' } }); } });
  }
});
test('actual production gateway serves only through trusted loopback HTTPS proxy headers and blocks registration, public plugin and guest APIs', { timeout: 10000 }, async () => {
  await fixture(async ({ request }) => {
    const page = await request('GET', '/learning-site/index.html'); assert.equal(page.status, 200);
    assert.match(page.headers['strict-transport-security'], /max-age/);
    const status = await request('GET', '/api/deployment'); assert.equal(status.value.registrationEnabled, false);
    assert.equal(status.value.publicDeploymentVerified, false); assert.equal(status.value.pluginConnectionMode, 'local-only');
    for (const headers of [{ 'x-breakglass-edge-secret': 'wrong' }, { 'x-breakglass-edge-secret': '' }, { host: '127.0.0.1' },
      { host: 'learning.example.com:443' }, { 'x-forwarded-proto': 'http' }]) assert.equal((await request('GET', '/api/deployment', undefined, headers)).status, 403);
    assert.equal((await request('POST', '/api/account/register', { username: 'public_student', password: PASSWORD }, { origin: PUBLIC })).status, 403);
    for (const route of ['/api/plugin/connect', '/api/account/plugin-pairing']) assert.equal((await request('POST', route, {}, { origin: PUBLIC })).status, 403);
    for (const route of ['/api/learning/records', '/api/annotations', '/api/vision/config', '/api/audio/config']) {
      const blocked = await request('GET', route); assert.equal(blocked.status, 403); assert.equal(blocked.value.code, 'release_not_approved');
    }
    assert.equal((await request('POST', '/api/vision/session', { sourceId: 'not-registered' }, { origin: PUBLIC })).status, 403);
  });
});
test('approved login emits Secure cookie; unapproved accounts and missing/foreign mutation Origin or CSRF are refused', { timeout: 10000 }, async () => {
  await fixture(async ({ request, login, manifest, source }) => {
    assert.equal((await login('approved_alice', { origin: '' })).status, 403);
    assert.equal((await login('approved_alice', { origin: 'https://foreign.example.com' })).status, 403);
    const unapproved = await login('unapproved_bob'); assert.equal(unapproved.status, 403); assert.equal(unapproved.value.code, 'release_not_approved');
    const approved = await login('approved_alice'); assert.equal(approved.status, 200); assert.match(approved.headers['set-cookie'][0], /; Secure$/);
    assert.equal(approved.value.user.id, manifest.accounts[0].id);
    const auth = { cookie: cookie(approved), origin: PUBLIC, 'x-breakglass-csrf': approved.value.csrfToken };
    assert.equal((await request('GET', '/api/learning/records', undefined, auth)).status, 200);
    const record = { id: 'prod-record', kind: 'question', source: { kind: 'manual-notes', id: 'manual-test', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
      time: 0, title: '手工条件', note: '检查斜边', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'manual', sourceLabel: '学生手工条件', createdAt: new Date().toISOString() };
    assert.equal((await request('PUT', '/api/learning/records/prod-record', { record, expectedEpoch: 0 }, { ...auth, origin: '' })).status, 403);
    assert.equal((await request('PUT', '/api/learning/records/prod-record', { record, expectedEpoch: 0 }, { ...auth, 'x-breakglass-csrf': '' })).status, 403);
    assert.equal((await request('PUT', '/api/learning/records/prod-record', { record, expectedEpoch: 0 }, auth)).status, 200);
    const attempted = await request('POST', '/api/learning/attempts', { recordId: 'prod-record', answer: 5, hintUsed: false, expectedEpoch: 0 }, auth);
    assert.equal(attempted.value.attempt.outcome, 'correct_independent');
    const emptyModel = await request('GET', '/api/vision/config', undefined, auth); assert.equal(emptyModel.value.supplierConfigured, false);
    assert.equal((await request('POST', '/api/vision/session', { sourceId: source.source.id }, auth)).status, 503);
    assert.equal((await request('POST', '/api/vision/progressive/session', { sourceId: source.source.id, contextSourceId: null, currentTime: 0, maxFrames: 4 }, auth)).status, 503);
    assert.equal((await request('POST', '/api/audio/session', { sourceId: source.source.id }, auth)).status, 503);
    const logout = await request('POST', '/api/account/logout', {}, auth); assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0; Secure$/);
    assert.equal((await request('GET', '/api/learning/records', undefined, auth)).status, 403);
  });
});
test('real gateway rechecks approval files for member APIs and approved login; changed proof does not silently preserve account access', { timeout: 10000 }, async () => {
  await fixture(async ({ request, login, directory, manifest }) => {
    const approved = await login('approved_alice'); const auth = { cookie: cookie(approved), origin: PUBLIC, 'x-breakglass-csrf': approved.value.csrfToken };
    assert.equal((await request('GET', '/api/annotations', undefined, auth)).status, 200);
    await fs.writeFile(path.join(directory, manifest.evidence[0].file), 'TEST FIXTURE REVOKED');
    for (const route of ['/api/learning/records', '/api/annotations', '/api/vision/config', '/api/audio/config']) assert.equal((await request('GET', route, undefined, auth)).status, 403);
    const rejected = await login('approved_alice'); assert.equal(rejected.status, 403); assert.equal(rejected.value.code, 'release_not_approved');
  });
});
test('production classic and progressive discard model replies after approval withdrawal and never cache the late explanation', { timeout: 15000 }, async () => {
  const fixtures = await import('../breakglass-reader/tests/helpers/fixtures.mjs');
  for (const progressive of [false, true]) {
    const upstream = deferred(); const started = deferred(); let calls = 0;
    await fixture(async ({ request, login, directory, manifest, source }) => {
      const approved = await login('approved_alice'); const auth = { cookie: cookie(approved), origin: PUBLIC, 'x-breakglass-csrf': approved.value.csrfToken };
      const session = await request('POST', progressive ? '/api/vision/progressive/session' : '/api/vision/session',
        progressive ? { sourceId: source.source.id, contextSourceId: null, currentTime: 0, maxFrames: 4 } : { sourceId: source.source.id }, auth);
      assert.equal(session.status, 200);
      const window = progressive ? session.value.plan[0] : null;
      const metadata = { schemaVersion: '1', requestId: `late-production-${progressive}`, sourceId: source.source.id,
        videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored' };
      const body = progressive ? { ...metadata, contextSourceId: null, windowId: window.id,
        frames: window.times.map((frameTime) => ({ frameTime, image: fixtures.FRAME_DATA_URL })) }
        : { ...metadata, frameTime: 1, image: fixtures.FRAME_DATA_URL };
      const pending = request('POST', progressive ? '/api/vision/progressive/context' : '/api/vision/read', body,
        { ...auth, 'x-breakglass-visual-session': session.value.token });
      await started.promise;
      await fs.writeFile(path.join(directory, manifest.evidence[0].file), 'TEST FIXTURE WITHDRAWN DURING MODEL WORK');
      const visual = { schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, area: null,
        title: '测试条件', explanation: 'private-test-late-explanation', pitfallHint: '确认斜边' };
      upstream.resolve(providerResponse(progressive ? { summary: 'private-test-late-summary', keyPoints: ['确认条件'], pitfalls: ['斜边'],
        objects: [{ frameTime: window.times[0], result: visual }] } : visual));
      const discarded = await pending; assert.ok(discarded.status >= 400); assert.equal(calls, 1);
      assert.doesNotMatch(JSON.stringify(discarded.value), /private-test-late/);
      const stored = await fs.readFile(path.join(manifest.dataDir, 'analysis-cache-v1.json'), 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; return ''; });
      assert.doesNotMatch(stored, /private-test-late/); if (stored) assert.deepEqual(JSON.parse(stored).entries, []);
    }, { settings: fixtures.settings({ learningReadBudgetMs: 3000, learningContextBudgetMs: 3000 }), fetchImpl: async () => { calls += 1; started.resolve(); return upstream.promise; } });
  }
});
test('production audio approval withdrawal blocks upload after extraction and discards an already sent transcript', { timeout: 15000 }, async () => {
  const { pcmToWav } = await import('../scripts/learning-audio.mjs');
  const wav = pcmToWav(Buffer.alloc(32000));
  for (const stage of ['extract', 'upstream']) {
    const extracting = deferred(); const uploading = deferred(); const started = deferred(); let uploads = 0;
    await fixture(async ({ request, login, directory, manifest, source }) => {
      const approved = await login('approved_alice'); const auth = { cookie: cookie(approved), origin: PUBLIC, 'x-breakglass-csrf': approved.value.csrfToken };
      const session = await request('POST', '/api/audio/session', { sourceId: source.source.id }, auth); assert.equal(session.status, 200);
      const pending = request('POST', '/api/audio/transcribe', { token: session.value.token, start: 0, end: 1 }, auth);
      await started.promise; await fs.writeFile(path.join(directory, manifest.evidence[0].file), 'TEST AUDIO APPROVAL WITHDRAWN');
      if (stage === 'extract') extracting.resolve({ wav, seconds: 1 });
      else uploading.resolve(new Response(JSON.stringify({ text: 'private-test-late-transcript' })));
      const discarded = await pending; assert.ok(discarded.status >= 400); assert.equal(uploads, stage === 'extract' ? 0 : 1);
      assert.doesNotMatch(JSON.stringify(discarded.value), /private-test-late-transcript/);
    }, { audioSettings: { baseUrl: 'https://asr.example.com/v1', model: 'asr-test', apiKey: 'test-key-not-real', ffmpegPath: process.execPath, maxCalls: 4 },
      audioExtractImpl: async () => { if (stage === 'extract') { started.resolve(); return extracting.promise; } return { wav, seconds: 1 }; },
      fetchImpl: async (url, options) => { uploads += 1; started.resolve(); assert.equal(options.redirect, 'error');
        assert.equal(url, 'https://asr.example.com/v1/audio/transcriptions'); return uploading.promise; } });
  }
});
test('public account handler constructor requires an explicit production origin, Secure cookies, matching sole allowlist and approval hook', async () => {
  const { createLearningHandler } = await import('../breakglass-learning/src/server.mjs');
  assert.throws(() => createLearningHandler({ allowedOrigins: [PUBLIC], secureCookies: true }), /loopback/);
  for (const config of [{}, { productionOrigin: PUBLIC }, { productionOrigin: PUBLIC, secureCookies: true },
    { productionOrigin: PUBLIC, secureCookies: true, authorizeAccount: () => true, allowedOrigins: [PUBLIC, LOCAL] },
    ...['http://learning.example.com', 'https://localhost', 'https://127.0.0.1', PUBLIC + '/path', PUBLIC + '/', PUBLIC + ':443', 'https://u:p@learning.example.com'].map((productionOrigin) =>
      ({ productionOrigin, allowedOrigins: [productionOrigin], secureCookies: true, authorizeAccount: () => true }))]) {
    if (!Object.keys(config).length) continue;
    assert.throws(() => createLearningHandler({ allowedOrigins: [PUBLIC], ...config }), /生产/);
  }
  assert.equal(typeof createLearningHandler({ productionOrigin: PUBLIC, allowedOrigins: [PUBLIC], secureCookies: true, authorizeAccount: () => false }), 'function');
});
