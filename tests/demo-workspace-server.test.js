const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const modules = Promise.all([import('../scripts/demo-workspace.mjs'), import('../scripts/learning-site.mjs'),
  import('../breakglass-reader/tests/helpers/fixtures.mjs')]);
const ORIGIN = 'http://localhost:8765';
function send(response, status, value, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value));
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
function raw(base, route, { method = 'GET', body, headers = {}, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const request = http.request(base + route, { method, headers: { host: 'localhost:8765',
      ...(bytes ? { 'content-type': 'application/json', ...(chunked ? {} : { 'content-length': bytes.length }) } : {}), ...headers } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
        json: () => JSON.parse(Buffer.concat(chunks)) }));
    });
    request.once('error', reject);
    if (bytes && chunked) {
      for (let offset = 0; offset < bytes.length; offset += 8192) request.write(bytes.subarray(offset, offset + 8192));
      request.end();
    } else request.end(bytes);
  });
}
async function withWorkspace(run, options = {}) {
  const [{ createDemoWorkspaceServer, WORKSPACE_LIMITS, READER_ROUTES }, { createLearningSiteServer }, fixtures] = await modules;
  const seen = []; const targets = [];
  const gateway = options.gateway || http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const entry = { path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() };
    seen.push({ kind: 'api', ...entry });
    if (request.url === '/api/deployment') send(response, 200, { mode: options.production ? 'production-pilot' : 'local-development' });
    else if (options.api) await options.api(request, response, entry);
    else send(response, 200, { ok: true });
  });
  const reader = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const entry = { path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() };
    seen.push({ kind: 'reader', ...entry });
    if (options.reader) await options.reader(request, response, entry); else send(response, 200, { ok: true });
  });
  await listen(gateway); await listen(reader);
  let server;
  const httpRequest = (transport, callback) => {
    targets.push(transport);
    if (options.disconnected && transport.port === 4174) {
      const connection = new (require('node:events').EventEmitter)();
      connection.end = () => queueMicrotask(() => connection.emit('error', new Error('offline')));
      connection.destroy = () => {}; return connection;
    }
    assert.equal(transport.hostname, '127.0.0.1'); assert.ok([4174, 8787].includes(transport.port));
    return http.request({ ...transport, port: (transport.port === 4174 ? gateway : reader).address().port }, callback);
  };
  server = createDemoWorkspaceServer({ httpRequest, env: {},
    ...(options.ephemeralOrigin ? { publicOrigin: () => `http://127.0.0.1:${server.address().port}` } : {}) });
  const port = await listen(server); const base = `http://127.0.0.1:${port}`;
  try { await run({ server, base, seen, targets, fixtures, WORKSPACE_LIMITS, READER_ROUTES,
    createLearningSiteServer, raw: (route, init) => raw(base, route, init) }); }
  finally { await close(server); await close(gateway); await close(reader); }
}

test('front door serves explicit dependencies and standard single media Range, HEAD, MIME and security headers', async () => {
  await withWorkspace(async ({ raw, fixtures, targets, server, WORKSPACE_LIMITS }) => {
    assert.equal(server.maxConnections, 64); assert.equal(server.headersTimeout, 10000);
    assert.equal(server.keepAliveTimeout, 5000); assert.equal(WORKSPACE_LIMITS.readerSlots, 4);
    const root = await raw('/'); assert.equal(root.status, 302); assert.equal(root.headers.location, '/extension/demo/index.html');
    for (const [route, type] of [['/extension/demo/index.html', 'html'], ['/extension/demo/geometry.html', 'html'],
      ['/extension/assets/config.json', 'json'], ['/extension/assets/presets/demo-parabola.json', 'json'],
      ['/extension/assets/vision/fixture-parabola.json', 'json'], ['/extension/src/curve/current-frame.js', 'javascript'],
      ['/learning-site/account-client.js', 'javascript'], ['/learning-site/index.html', 'html'],
      ['/site/assets/breakglass-brand/logo-aperture-fracture.svg', 'svg'], ['/extension/assets/video/geometry/triangle-3-4-5.zh.vtt', 'vtt']]) {
      const response = await raw(route); assert.equal(response.status, 200, route); assert.match(response.headers['content-type'], new RegExp(type));
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
    }
    const mediaPath = '/extension/assets/video/breakglass-demo-9s.mp4';
    const localFile = fs.readFileSync(path.join(fixtures.EXTENSION_DIR, 'assets/video/breakglass-demo-9s.mp4'));
    const head = await raw(mediaPath, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), localFile.length);
    for (const [range, start, end] of [['bytes=0-31', 0, 31], ['bytes=32-', 32, localFile.length - 1],
      ['bytes=-24', localFile.length - 24, localFile.length - 1]]) {
      const response = await raw(mediaPath, { headers: { range } }); assert.equal(response.status, 206);
      assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${localFile.length}`);
      assert.deepEqual(response.body, localFile.subarray(start, end + 1));
    }
    for (const range of ['bytes=0-1,3-4', 'bytes=-0', 'bytes=10-9', `bytes=${localFile.length}-`]) {
      const response = await raw(mediaPath, { headers: { range } }); assert.equal(response.status, 416);
      assert.equal(response.headers['content-range'], `bytes */${localFile.length}`);
    }
    assert.equal(targets.length, 0);
  });
});

test('unknown Host/Origin, encoded traversal, nonwhitelisted paths/methods/queries and client proxy targets are rejected before upstream', async () => {
  await withWorkspace(async ({ raw, targets }) => {
    for (const route of ['/AGENTS.md', '/.git/config', '/breakglass-reader/.env', '/breakglass-learning/src/store.mjs',
      '/extension/manifest.json', '/extension/demo/../index.html', '/extension/demo/%2e%2e%2findex.html',
      '/extension/demo/%252e%252e/index.html', '/extension/demo/%5c..%5cAGENTS.md', '/api/plugin/me', '/api/unknown'])
      assert.equal((await raw(route)).status, 404, route);
    assert.equal((await raw('/api/account/me', { headers: { host: 'localhost:4174' } })).status, 403);
    assert.equal((await raw('/api/account/me', { headers: { host: 'evil.invalid:8765' } })).status, 403);
    assert.equal((await raw('/api/account/me', { headers: { origin: 'http://localhost:4174' } })).status, 403);
    assert.equal((await raw('/api/account/me', { headers: { origin: 'http://127.0.0.1:8765' } })).status, 403);
    assert.equal((await raw('/api/account/login', { method: 'POST', body: {} })).status, 403);
    assert.equal((await raw('/api/account/login', { method: 'POST', body: {}, headers: { origin: 'null' } })).status, 403);
    assert.equal((await raw('/api/account/me', { method: 'POST', headers: { origin: ORIGIN } })).status, 405);
    assert.equal((await raw('/api/account/me?upstream=http://example.com')).status, 400);
    assert.equal((await raw('/api/learning/attempts?recordId=a&recordId=b')).status, 400);
    assert.equal((await raw('/api/vision/policy?sourceId=http%3Aevil')).status, 400);
    assert.equal((await raw('/geometry/ask?url=http://example.com', { method: 'POST', body: {}, headers: { origin: ORIGIN } })).status, 400);
    assert.equal(targets.length, 0);
    const alias = await raw('/api/account/me', { headers: { host: '127.0.0.1:8765', origin: 'http://127.0.0.1:8765' } });
    assert.equal(alias.status, 200);
  });
});

test('website proxy preserves original Origin/cookie/CSRF/session headers, exact flow methods/query and only fixed safe cookies', async () => {
  await withWorkspace(async ({ raw, seen }) => {
    const init = { method: 'POST', body: { username: 'test', password: 'do-not-log' }, headers: { origin: ORIGIN,
      cookie: 'breakglass_local_session=local-only', 'x-breakglass-csrf': 'csrf-token', 'x-breakglass-visual-session': 'visual-token',
      authorization: 'Bearer must-not-forward', 'x-forwarded-host': 'evil.invalid', 'x-breakglass-plugin-token': 'private-plugin' } };
    const response = await raw('/api/account/login', init); assert.equal(response.status, 201);
    assert.equal(response.headers['set-cookie'].length, 2);
    assert.match(response.headers['set-cookie'][0], /^breakglass_local_session=/);
    assert.match(response.headers['set-cookie'][1], /^breakglass_analysis_guest=/);
    assert.equal(response.headers.location, undefined); assert.equal(response.headers['x-supplier-secret'], undefined);
    const actual = seen.find((entry) => entry.path === '/api/account/login');
    assert.equal(actual.headers.origin, ORIGIN); assert.equal(actual.headers.cookie, init.headers.cookie);
    assert.equal(actual.headers['x-breakglass-csrf'], 'csrf-token'); assert.equal(actual.headers['x-breakglass-visual-session'], 'visual-token');
    assert.equal(actual.headers.authorization, undefined); assert.equal(actual.headers['x-forwarded-host'], undefined);
    assert.equal(actual.headers['x-breakglass-plugin-token'], undefined); assert.equal(actual.body, JSON.stringify(init.body));
    assert.equal(seen[0].headers.cookie, undefined); assert.equal(seen[0].headers['x-breakglass-csrf'], undefined);
    for (const [route, method] of [['/api/learning/flow', 'GET'], ['/api/learning/flow/purposes/r:1', 'PUT'],
      ['/api/learning/flow/reviews/r-1', 'PUT'], ['/api/learning/flow/exercises', 'POST'],
      ['/api/learning/flow/exercises/e-1/help', 'POST'], ['/api/learning/flow/exercises/e-1/attempts', 'POST'],
      ['/api/learning/attempts?recordId=r%3A1', 'GET'], ['/api/vision/policy?sourceId=file-abcd', 'GET']]) {
      const result = await raw(route, { method, ...(method !== 'GET' ? { body: {} } : {}), headers: { origin: ORIGIN } });
      assert.equal(result.status, 201, route);
    }
  }, { api: async (_, response) => send(response, 201, { ok: true }, { 'set-cookie': [
    'breakglass_local_session=test; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800',
    'breakglass_analysis_guest=guest; HttpOnly; SameSite=Strict; Path=/api/vision',
    'attacker=a; HttpOnly; SameSite=Strict; Path=/api',
    'breakglass_local_session=x; HttpOnly; SameSite=Strict; Path=/',
    'breakglass_local_session=x; HttpOnly; SameSite=Strict; Path=/api; Domain=localhost',
    'breakglass_local_session=x; SameSite=Lax; Path=/api'
  ], location: 'https://evil.invalid/', 'x-supplier-secret': 'hidden' }) });
});

test('reader validates frozen math/frame fields, strips every private header and Set-Cookie, and preserves separate budgets', async () => {
  await withWorkspace(async ({ raw, seen, fixtures, READER_ROUTES }) => {
    assert.equal(READER_ROUTES['/read'].ms, 300000); assert.equal(READER_ROUTES['/geometry/read'].ms, 30000);
    assert.equal(READER_ROUTES['/geometry/ask'].ms, 10000);
    const headers = { origin: ORIGIN, cookie: 'breakglass_local_session=private', authorization: 'Bearer private',
      'x-breakglass-csrf': 'private', 'x-breakglass-visual-session': 'private', 'x-breakglass-plugin-token': 'private',
      'x-breakglass-edge-secret': 'private', 'x-forwarded-for': 'remote' };
    const scene = { schemaVersion: '1.0.0', kind: 'right-triangle', requestId: 'read-1', videoId: 'video-1',
      frameTime: 2, frameSize: { width: 1920, height: 1080 }, sceneRevision: 1, rightAngleAt: 'A',
      labels: { A: 'A', B: 'B', C: 'C' }, vertices: null, lengths: { AB: 3, AC: 4 }, unit: 'unit',
      source: 'manual', originSource: 'manual', editedByUser: true };
    const bodies = [['/read', fixtures.lessonRequest()], ['/geometry/read', { schemaVersion: '1.0.0',
      requestId: 'geo-read', videoId: 'video-1', frameTime: 2, frameSize: fixtures.SOURCE_SIZE, image: fixtures.FRAME_DATA_URL }],
    ['/geometry/ask', { schemaVersion: '1.0.0', actionRequestId: 'ask-1', scene, text: '改变AB' }]];
    for (const [route, body] of bodies) {
      const response = await raw(route, { method: 'POST', body, headers }); assert.equal(response.status, 200, route);
      assert.equal(response.headers['set-cookie'], undefined);
      const actual = seen.at(-1); assert.equal(actual.headers.origin, ORIGIN); assert.equal(actual.body, JSON.stringify(body));
      assert.equal(actual.headers.cookie, undefined); assert.equal(actual.headers.authorization, undefined);
      assert.ok(Object.keys(actual.headers).every((key) => !key.startsWith('x-')));
    }
    assert.equal(seen.filter((entry) => entry.kind === 'api').length, 0);
    const calls = seen.length;
    assert.equal((await raw('/read', { method: 'POST', body: { ...fixtures.lessonRequest(), csrf: 'private' }, headers })).status, 400);
    const malformed = fixtures.lessonRequest(); malformed.frames[0].cookie = 'private';
    assert.equal((await raw('/read', { method: 'POST', body: malformed, headers })).status, 400);
    assert.equal((await raw('/geometry/ask', { method: 'POST', body: { ...bodies[2][1], upstream: 'http://evil' }, headers })).status, 400);
    assert.equal(seen.length, calls);
  }, { reader: async (_, response) => send(response, 200, { ok: true }, {
    'set-cookie': 'breakglass_local_session=reader; HttpOnly; SameSite=Strict; Path=/api' }) });
});

test('proxy limits declared/chunked bodies and bounded responses, rejects malformed JSON and non JSON', async () => {
  await withWorkspace(async ({ raw, seen, fixtures }) => {
    const before = seen.length;
    for (const chunked of [false, true]) assert.equal((await raw('/api/account/login', {
      method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(2048) }), chunked, headers: { origin: ORIGIN } })).status, 413);
    assert.equal((await raw('/api/account/login', { method: 'POST', body: '{broken', headers: { origin: ORIGIN } })).status, 400);
    assert.equal((await raw('/api/account/login', { method: 'POST', body: '{}', headers: { origin: ORIGIN, 'content-type': 'text/plain' } })).status, 415);
    assert.equal(seen.length, before);
    assert.equal((await raw('/read', { method: 'POST', body: fixtures.lessonRequest(), headers: { origin: ORIGIN } })).status, 502);
  }, { reader: async (_, response) => send(response, 200, { oversized: 'x'.repeat(2 * 1024 * 1024) }) });
});

test('missing gateway is honest 503 and production gateway/env refuse account forwarding while static preview remains', async () => {
  const [{ createDemoWorkspaceServer }] = await modules;
  for (const env of [{ NODE_ENV: 'production' }, { BREAKGLASS_RELEASE_MANIFEST: 'release.json' }])
    assert.throws(() => createDemoWorkspaceServer({ env }), /development_only/);
  assert.throws(() => createDemoWorkspaceServer({ env: {}, publicOrigin: 'https://remote.invalid' }), /invalid_host/);
  await withWorkspace(async ({ raw }) => {
    assert.equal((await raw('/api/account/me')).status, 503);
    assert.equal((await raw('/api/account/me')).json().code, 'service_not_connected');
    assert.equal((await raw('/extension/demo/index.html')).status, 200);
  }, { disconnected: true });
  await withWorkspace(async ({ raw, seen }) => {
    const response = await raw('/api/account/login', { method: 'POST', body: {}, headers: { origin: ORIGIN } });
    assert.equal(response.status, 403); assert.equal(response.json().code, 'development_only');
    assert.equal(seen.length, 1); assert.equal(seen[0].path, '/api/deployment');
    assert.equal((await raw('/extension/demo/index.html')).status, 200);
  }, { production: true });
});

test('real gateway session is reused: GET without Origin works, cross-Origin/CSRF violations stay rejected', async () => {
  const [, { createLearningSiteServer }] = await modules;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-workspace-http-'));
  const gateway = createLearningSiteServer({ dataDir: directory });
  try {
    await withWorkspace(async ({ raw }) => {
      const credentials = { username: 'workspace-student', password: 'Local-Test-Password-123' };
      const registered = await raw('/api/account/register', { method: 'POST', body: credentials, headers: { origin: ORIGIN } });
      assert.equal(registered.status, 201); const cookie = registered.headers['set-cookie'][0].split(';')[0];
      assert.match(registered.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\/api/);
      const me = await raw('/api/account/me', { headers: { cookie } }); assert.equal(me.status, 200);
      const account = me.json(); assert.equal(account.user.username, credentials.username); assert.ok(account.csrfToken);
      const mutation = { method: 'DELETE', body: { expectedEpoch: account.epoch }, headers: { origin: ORIGIN, cookie } };
      assert.equal((await raw('/api/learning/records', mutation)).status, 403);
      assert.equal((await raw('/api/learning/records', { ...mutation,
        headers: { ...mutation.headers, 'x-breakglass-csrf': account.csrfToken } })).status, 200);
      assert.equal((await raw('/api/account/me', { headers: { cookie, origin: 'http://localhost:4174' } })).status, 403);
      assert.equal((await raw('/api/account/logout', { method: 'POST', body: {},
        headers: { origin: ORIGIN, cookie, 'x-breakglass-csrf': account.csrfToken } })).status, 200);
      const loggedOut = (await raw('/api/account/me', { headers: { cookie } })).json(); assert.equal(loggedOut.user, null);
    }, { gateway });
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('breakglass-workspace-http-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ephemeral factory origin uses browser-style same-origin host and blocks runtime origins without overriding fixed upstream', async () => {
  await withWorkspace(async ({ base, seen, targets }) => {
    const response = await raw(base, '/api/account/me', { headers: { host: new URL(base).host } }); assert.equal(response.status, 200);
    const post = await raw(base, '/api/account/login', { method: 'POST', body: {}, headers: { host: new URL(base).host, origin: base } });
    assert.equal(post.status, 200); assert.equal(seen.at(-1).headers.origin, base);
    assert.equal((await raw(base, '/api/account/me')).status, 403);
    assert.ok(targets.every((value) => value.port === 4174 && value.hostname === '127.0.0.1'));
  }, { ephemeralOrigin: true });
});

test('client cancellation aborts fixed reader upstream and releases the bounded reader slot', async () => {
  let started; const startedPromise = new Promise((resolve) => { started = resolve; });
  let closed; const closedPromise = new Promise((resolve) => { closed = resolve; });
  await withWorkspace(async ({ base, fixtures, raw }) => {
    const pending = http.request(base + '/read', { method: 'POST', headers: { host: 'localhost:8765', origin: ORIGIN,
      'content-type': 'application/json' } }); pending.on('error', () => {}); pending.end(JSON.stringify(fixtures.lessonRequest()));
    await startedPromise; pending.destroy(); await closedPromise;
    assert.equal((await raw('/api/account/me')).status, 200);
  }, { reader: async (_, response) => { response.once('close', closed); started(); } });
});

test('reader and API deadlines cancel upstream without replacing each other', async (t) => {
  for (const [kind, ms] of [['reader', 300000], ['api', 10000]]) {
    let started; const startedPromise = new Promise((resolve) => { started = resolve; });
    let closed; const closedPromise = new Promise((resolve) => { closed = resolve; });
    await withWorkspace(async ({ raw, fixtures }) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const pending = kind === 'reader' ? raw('/read', { method: 'POST', body: fixtures.lessonRequest(), headers: { origin: ORIGIN } })
          : raw('/api/account/me');
        await startedPromise; let settled = false; pending.then(() => { settled = true; });
        t.mock.timers.tick(ms - 1); await new Promise((resolve) => setImmediate(resolve)); assert.equal(settled, false);
        t.mock.timers.tick(1);
        const result = await pending; assert.equal(result.status, 504); assert.equal(result.json().code, 'upstream_timeout');
        await closedPromise;
      } finally { t.mock.timers.reset(); }
    }, { [kind]: async (_, response) => { response.once('close', closed); started(); } });
  }
});

test('four live reader requests are bounded; a fifth gets 429 and disconnects release slots', async () => {
  let count = 0; let ready; const readyPromise = new Promise((resolve) => { ready = resolve; });
  let disconnects = 0; let disconnected;
  const disconnectedPromise = new Promise((resolve) => { disconnected = resolve; });
  await withWorkspace(async ({ base, raw, fixtures }) => {
    const requests = Array.from({ length: 4 }, () => {
      const request = http.request(base + '/read', { method: 'POST', headers: { host: 'localhost:8765', origin: ORIGIN,
        'content-type': 'application/json' } }); request.on('error', () => {}); request.end(JSON.stringify(fixtures.lessonRequest()));
      return request;
    });
    try {
      await readyPromise;
      const extra = await raw('/read', { method: 'POST', body: fixtures.lessonRequest(), headers: { origin: ORIGIN } });
      assert.equal(extra.status, 429);
    } finally { requests.forEach((request) => request.destroy()); await disconnectedPromise; }
  }, { reader: async (_, response) => {
    response.once('close', () => { if (++disconnects === 4) disconnected(); });
    if (++count === 4) ready();
  } });
});

test('slow incomplete upload gets the independent 10-second deadline and closes before any credential forwarding', async (t) => {
  await withWorkspace(async ({ server, base, seen }) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const accepted = once(server, 'request');
      const responsePromise = new Promise((resolve, reject) => {
        const request = http.request(base + '/api/account/login', { method: 'POST', headers: { host: 'localhost:8765',
          origin: ORIGIN, 'content-type': 'application/json', 'content-length': 100 } }, (response) => {
          const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
          response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
        });
        request.once('error', reject); request.write('{');
      });
      await accepted; t.mock.timers.tick(10000);
      const response = await responsePromise; assert.equal(response.status, 408);
      assert.equal(response.headers.connection, 'close'); assert.equal(seen.length, 0);
    } finally { t.mock.timers.reset(); }
  });
});

test('upstream chunked overflow and malformed/non-JSON JSON responses fail closed, with no cookies returned', async () => {
  for (const mode of ['chunked', 'malformed', 'non-json']) {
    await withWorkspace(async ({ raw, fixtures }) => {
      const response = await raw('/read', { method: 'POST', body: fixtures.lessonRequest(), headers: { origin: ORIGIN } });
      assert.equal(response.status, 502); assert.equal(response.headers['set-cookie'], undefined);
    }, { reader: async (_, response) => {
      response.writeHead(200, { 'content-type': mode === 'non-json' ? 'text/html' : 'application/json',
        'set-cookie': 'breakglass_local_session=invalid; HttpOnly; SameSite=Strict; Path=/api' });
      if (mode === 'chunked') { response.write('{"padding":"'); for (let i = 0; i < 34; i++) response.write('x'.repeat(65536)); response.end('"}'); }
      else response.end(mode === 'malformed' ? '{oops' : '<script>bad</script>');
    } });
  }
});
