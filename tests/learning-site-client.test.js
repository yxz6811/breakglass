const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../learning-site/account-client');
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
test('account changes abort reads and discard late old-account replies even if transport ignores abort', async () => {
  let active = 'alice'; let resolveOld; let oldSignal; const changes = [];
  const client = createClient({ onChange: (state) => changes.push(state.user && state.user.id), fetch: async (path, options) => {
    if (path === '/api/account/me') return reply({ user: { id: active, username: active }, csrfToken: `${active}-csrf`, epoch: 0 });
    if (path === '/api/account/login') { active = JSON.parse(options.body).username; return reply({}); }
    if (path === '/api/learning/records') { oldSignal = options.signal; return new Promise((resolve) => { resolveOld = resolve; }); }
    throw new Error('unexpected path');
  } });
  await client.refresh(); const old = client.records();
  const rejected = assert.rejects(old, (error) => error.code === 'stale_session');
  await client.login({ username: 'bob', password: 'not-stored' }); assert.equal(oldSignal.aborted, true);
  resolveOld(reply({ records: [{ title: 'alice private' }] })); await rejected;
  assert.equal(client.snapshot().user.id, 'bob'); assert.ok(changes.includes(null));
  assert.equal(JSON.stringify(client.snapshot()).includes('csrf'), false);
});
test('writes carry same-origin credentials, current CSRF and deletion epoch; failure never advances the epoch', async () => {
  const calls = []; let deletes = 0;
  const client = createClient({ fetch: async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/account/me') return reply({ user: { id: 'alice', username: 'alice' }, csrfToken: 'private-token', epoch: 3 });
    if (options.method === 'DELETE') return ++deletes === 1 ? reply({ epoch: 4 }) : reply({ message: '未删除', code: 'failed' }, 503);
    return reply({ epoch: 4 });
  } });
  await client.refresh(); await client.clearRecords(); await client.saveRecord({ id: 'record-1' });
  const saved = calls.find((call) => call.options.method === 'PUT');
  assert.equal(saved.options.credentials, 'same-origin'); assert.equal(saved.options.headers['X-BreakGlass-CSRF'], 'private-token');
  assert.equal(JSON.parse(saved.options.body).expectedEpoch, 4);
  await assert.rejects(client.deleteAccountData(), /未删除/); assert.equal(client.snapshot().epoch, 4);
});
test('logout clears visible identity before awaiting service but only reports completion on a successful response', async () => {
  const changes = [];
  const client = createClient({ onChange: (state) => changes.push(state.user), fetch: async (path) => path.endsWith('/me')
    ? reply({ user: { id: 'u1', username: 'alice' }, csrfToken: 'csrf', epoch: 0 }) : reply({ message: '服务不可用' }, 503) });
  await client.refresh(); await assert.rejects(client.logout(), /服务不可用/);
  assert.equal(client.snapshot().user, null); assert.equal(changes.at(-1), null);
});
test('refresh detects an external cookie account change and rejects the old in-flight save result', async () => {
  let active = 'alice'; let resolveSave; let signal;
  const client = createClient({ fetch: async (path, options) => {
    if (path === '/api/account/me') return reply({ user: active ? { id: active, username: active } : null, csrfToken: `${active}-csrf`, epoch: 0 });
    if (options.method === 'PUT') { signal = options.signal; return new Promise((resolve) => { resolveSave = resolve; }); }
    throw new Error('unexpected request');
  } });
  await client.refresh(); const aliceGeneration = client.snapshot().generation;
  const old = client.saveRecord({ id: 'private-alice' });
  const rejected = assert.rejects(old, (error) => error.code === 'stale_session');
  active = 'bob'; await client.refresh();
  assert.ok(client.snapshot().generation > aliceGeneration); assert.equal(signal.aborted, true);
  resolveSave(reply({ record: { id: 'private-alice' }, epoch: 7 })); await rejected;
  assert.equal(client.snapshot().user.id, 'bob'); assert.equal(client.snapshot().epoch, 0);
  const bobGeneration = client.snapshot().generation;
  active = null; await client.refresh(); assert.ok(client.snapshot().generation > bobGeneration);
  assert.equal(client.snapshot().user, null);
});
test('bounded request timeout is reported as unconfirmed service work, even when fetch ignores abort', async () => {
  let signal; let resolveLate;
  const client = createClient({ requestTimeoutMs: 15, fetch: async (path, options) => {
    if (path === '/api/account/me') return reply({ user: { id: 'alice', username: 'alice' }, csrfToken: 'csrf', epoch: 2 });
    signal = options.signal; return new Promise((resolve) => { resolveLate = resolve; });
  } });
  await client.refresh(); const owner = client.snapshot().generation;
  await assert.rejects(client.saveRecord({ id: 'timeout-record' }), (error) => error.code === 'request_timeout' && /超时/.test(error.message));
  assert.equal(signal.aborted, true); assert.equal(client.snapshot().generation, owner); assert.equal(client.snapshot().epoch, 2);
  resolveLate(reply({ epoch: 3 })); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.snapshot().epoch, 2);
});
test('deletion supersedes old write acknowledgements and their earlier data epoch', async () => {
  let resolveSave; let signal;
  const client = createClient({ fetch: async (path, options) => {
    if (path === '/api/account/me') return reply({ user: { id: 'alice', username: 'alice' }, csrfToken: 'csrf', epoch: 0 });
    if (options.method === 'PUT') { signal = options.signal; return new Promise((resolve) => { resolveSave = resolve; }); }
    if (options.method === 'DELETE') return reply({ epoch: 1, ok: true });
    throw new Error('unexpected request');
  } });
  await client.refresh(); const old = client.saveRecord({ id: 'old-record' });
  const rejected = assert.rejects(old, (error) => error.code === 'stale_session');
  await client.deleteAccountData(); assert.equal(signal.aborted, true);
  resolveSave(reply({ record: { id: 'old-record' }, epoch: 0 })); await rejected;
  assert.equal(client.snapshot().epoch, 1); assert.equal(client.snapshot().user.id, 'alice');
});

test('refresh of same account detects external deletion epoch and invalidates stale saves', async () => {
  let epoch = 0; let resolveSave; let signal;
  const client = createClient({ fetch: async (route, options) => {
    if (route === '/api/account/me') return reply({ user: { id: 'alice', username: 'alice' }, csrfToken: 'csrf', epoch });
    signal = options.signal; return new Promise((resolve) => { resolveSave = resolve; });
  } });
  await client.refresh(); const original = client.snapshot().generation;
  const old = client.saveRecord({ id: 'pre-deletion' }); const rejected = assert.rejects(old, (error) => error.code === 'stale_session');
  epoch = 1; await client.refresh(); assert.ok(client.snapshot().generation > original); assert.equal(signal.aborted, true);
  resolveSave(reply({ epoch: 0 })); await rejected; assert.equal(client.snapshot().epoch, 1);
});
