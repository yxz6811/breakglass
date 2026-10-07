const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const ORIGIN = 'http://localhost:8765';

async function fixture(run, options = {}) {
  const { createDemoWorkspaceServer, WORKSPACE_STATIC_FILES } = await import('../scripts/demo-workspace.mjs');
  const seen = [];
  const gateway = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const entry = { path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
    seen.push(entry);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/deployment') response.end(JSON.stringify({ mode: 'local-development' }));
    else if (options.respond) options.respond(response, entry);
    else response.end(JSON.stringify({ ok: true }));
  });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const server = createDemoWorkspaceServer({ env: {}, httpRequest: (options, callback) => {
    assert.equal(options.hostname, '127.0.0.1'); assert.equal(options.port, 4174);
    return http.request({ ...options, port: gateway.address().port }, callback);
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const send = (route, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(`http://127.0.0.1:${server.address().port}${route}`, { method,
      headers: { host: 'localhost:8765', origin: ORIGIN, 'content-type': 'application/json',
        ...(payload ? { 'content-length': payload.length } : {}), ...headers } }, (response) => {
      const chunks = []; response.on('data', (part) => chunks.push(part)); response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, value: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject); request.setTimeout(4000, () => request.destroy(new Error('bounded HTTP timeout')));
    request.end(payload);
  });
  try { await run({ send, seen, WORKSPACE_STATIC_FILES }); }
  finally {
    server.closeAllConnections(); gateway.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => gateway.close(resolve))]);
  }
}

test('frontdoor forwards only fixed recognition/provenance routes with methods, identity headers and finite defaults', async () => {
  await fixture(async ({ send, seen, WORKSPACE_STATIC_FILES }) => {
    for (const file of ['extension/src/plugin/recognition-contracts.js', 'learning-site/learning-evidence.js',
      'learning-site/provenance.js', 'learning-site/recognition-workbench.js']) assert.equal(WORKSPACE_STATIC_FILES.includes(file), true);
    assert.equal((await send('/extension/src/plugin/recognition-contracts.js')).status, 200);
    const headers = { cookie: 'breakglass_analysis_guest=bound-guest', 'x-breakglass-visual-session': 'private-session',
      'x-breakglass-csrf': 'account-csrf', authorization: 'must-not-forward' };
    assert.equal((await send('/api/vision/recognition', { method: 'POST', body: { schemaVersion: '011.1' }, headers })).status, 200);
    assert.equal((await send('/api/learning/provenance')).status, 200);
    assert.equal((await send('/api/learning/provenance/record-1', { method: 'PUT', body: { metadata: {} }, headers })).status, 200);
    const recognition = seen.find((entry) => entry.path === '/api/vision/recognition');
    assert.equal(recognition.headers['x-breakglass-visual-session'], headers['x-breakglass-visual-session']);
    assert.equal(recognition.headers.cookie, headers.cookie); assert.equal(recognition.headers.authorization, undefined);
    assert.equal(recognition.headers.origin, ORIGIN);
    assert.equal((await send('/api/vision/recognition', { method: 'GET' })).status, 405);
    assert.equal((await send('/api/learning/provenance/record-1', { method: 'DELETE' })).status, 405);
    assert.equal((await send('/api/vision/recognition?provider=other', { method: 'POST', body: {} })).status, 400);
    assert.equal((await send('/api/learning/provenance/bad%2Fid', { method: 'PUT', body: {} })).status, 404);
    assert.equal((await send('/api/learning/provenance/record-1', { method: 'PUT', body: { note: 'x'.repeat(65536) } })).status, 413);
    assert.equal((await send('/api/vision/recognition', { method: 'POST', body: { image: 'x'.repeat(4 * 1024 * 1024) } })).status, 413);
  });
});

test('frontdoor recognition alone uses a 64KiB response stream bound rather than the old learning API 8MiB budget', async () => {
  for (const declared of [false, true]) {
    await fixture(async ({ send }) => {
      const oversized = await send('/api/vision/recognition', { method: 'POST', body: {} });
      assert.equal(oversized.status, 502); assert.match(oversized.value, /upstream_response_too_large/);
      assert.doesNotMatch(oversized.value, /private-output-marker/);
      const legacy = await send('/api/vision/read', { method: 'POST', body: {} });
      assert.equal(legacy.status, 200); assert.match(legacy.value, /private-output-marker/);
    }, { respond(response) {
      const text = JSON.stringify({ data: 'private-output-marker'.repeat(4000) });
      if (declared) response.setHeader('content-length', Buffer.byteLength(text));
      response.end(text);
    } });
  }
});
