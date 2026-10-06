import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLearningHandler } from '../src/server.mjs';
import { createAccountStore } from '../src/store.mjs';
import { database } from '../src/validation.mjs';
import mathLearning from '../../learning-site/math-learning.js';

const ORIGIN = 'http://127.0.0.1:4174';
const PASSWORD = 'development-test-password';
const SOURCE = { kind: 'manual-notes', id: 'manual-example', version: '1', analysisVersion: '1', materialMode: 'self-authored' };
const record = { id: 'record-1', kind: 'question', source: SOURCE, time: 1, title: '原题', note: '原疑问',
  template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'manual', sourceLabel: '学生手工条件', createdAt: '2026-10-06T00:00:00.000Z' };
const metadata = (title = '斜边关系') => ({ title, note: '先确定斜边再平方。', kind: 'pitfall', tags: ['斜边', '单位'] });
const payload = (value = metadata(), revision = 0, epoch = 0) => ({ annotation: value, expectedRevision: revision, expectedEpoch: epoch });

function client(base) {
  let cookie = ''; let csrf = '';
  const send = async (method, route, body, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { origin: ORIGIN, cookie, 'x-breakglass-csrf': csrf,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const value = await response.json(); if (value.csrfToken) csrf = value.csrfToken;
    return { status: response.status, value, headers: response.headers };
  };
  return { send, register: (username) => send('POST', '/api/account/register', { username, password: PASSWORD }),
    login: (username) => send('POST', '/api/account/login', { username, password: PASSWORD }), get cookie() { return cookie; } };
}
async function fixture(run, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-annotation-test-'));
  const handler = createLearningHandler({ dataDir, allowedOrigins: [ORIGIN], ...options });
  const server = http.createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ handler, dataDir, client: () => client(base) }); }
  finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    const target = path.resolve(dataDir); assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('breakglass-annotation-test-')); await fs.rm(target, { recursive: true, force: true });
  }
}
const seed = async (user, name = 'student_a') => { await user.register(name); await user.send('PUT', '/api/learning/records/record-1', { record, expectedEpoch: 0 }); };

test('annotation sidecar is account-private, revision-locked and idempotent without changing original math or evidence', async () => {
  await fixture(async ({ client }) => {
    const alice = client(); const bob = client(); await seed(alice); await bob.register('student_b');
    assert.deepEqual((await alice.send('GET', '/api/annotations/record-1')).value, { annotation: null, epoch: 0 });
    assert.equal((await bob.send('GET', '/api/annotations/record-1')).status, 404);
    assert.equal((await bob.send('PUT', '/api/annotations/record-1', payload())).status, 404);
    const first = await alice.send('PUT', '/api/annotations/record-1', payload()); assert.equal(first.status, 200);
    assert.equal(first.value.annotation.revision, 1);
    assert.deepEqual((await alice.send('PUT', '/api/annotations/record-1', payload())).value, first.value);
    const conflict = await alice.send('PUT', '/api/annotations/record-1', payload(metadata('不同输入')));
    assert.equal(conflict.status, 409); assert.equal(conflict.value.code, 'revision_conflict');
    assert.equal((await alice.send('GET', '/api/annotations')).value.annotations[0].title, metadata().title);
    const second = await alice.send('PUT', '/api/annotations/record-1', payload(metadata('重新读取后保存'), 1));
    assert.equal(second.value.annotation.revision, 2);
    assert.deepEqual((await alice.send('GET', '/api/learning/records')).value.records, [record]);
    assert.deepEqual((await alice.send('GET', '/api/learning/attempts')).value.attempts, []);
    assert.deepEqual((await bob.send('GET', '/api/annotations')).value.annotations, []);
    const racing = await Promise.all([alice.send('PUT', '/api/annotations/record-1', payload(metadata('甲版本'), 2)),
      alice.send('PUT', '/api/annotations/record-1', payload(metadata('乙版本'), 2))]);
    assert.deepEqual(racing.map((reply) => reply.status).sort(), [200, 409]);
  });
});

test('all five extended manual templates persist and are judged by the server while annotations cannot alter their conditions', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('math_student');
    for (const template of mathLearning.TEMPLATE_IDS) {
      const snapshot = mathLearning.templateInfo(template).defaults;
      const original = { ...record, id: `record-${template}`, template, snapshot };
      assert.equal((await user.send('PUT', `/api/learning/records/${original.id}`, { record: original, expectedEpoch: 0 })).status, 200);
      const answer = mathLearning.expectedAnswer(template, snapshot);
      const receipt = await user.send('POST', '/api/learning/attempts', { recordId: original.id, answer, hintUsed: false, expectedEpoch: 0 });
      assert.equal(receipt.status, 200); assert.equal(receipt.value.attempt.outcome, 'correct_independent'); assert.equal(receipt.value.expectedAnswer, answer);
      assert.equal((await user.send('PUT', `/api/annotations/${original.id}`, payload())).status, 200);
      assert.equal((await user.send('PUT', `/api/annotations/${original.id}`, payload({ ...metadata(), snapshot }))).status, 400);
      const fakeVision = { ...original, id: `fake-${template}`, origin: 'vision' };
      assert.equal((await user.send('PUT', `/api/learning/records/${fakeVision.id}`, { record: fakeVision, expectedEpoch: 0 })).status, 400);
    }
    assert.equal((await user.send('GET', '/api/learning/attempts')).value.attempts.length, 5);
  });
});

test('annotation rejects media, credentials, unknown math/evidence fields, malformed revisions and tag overflow', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await seed(user);
    for (const value of [{ ...metadata(), snapshot: { AB: 5, AC: 12 } }, { ...metadata(), correct: true },
      { ...metadata(), title: 'https://private.example/course' }, { ...metadata(), note: 'cookie=secret' },
      { ...metadata(), kind: 'wrong' }, { ...metadata(), tags: Array(9).fill('原因') }, { ...metadata(), tags: ['重复', ' 重复 '] },
      { ...metadata(), tags: ['x'.repeat(25)] }, { ...metadata(), note: 'data:image/png;base64,secret' }, { ...metadata(), title: '\u202e隐藏' }]) {
      assert.equal((await user.send('PUT', '/api/annotations/record-1', payload(value))).status, 400);
    }
    for (const revision of [-1, 1.5, '0', Number.MAX_SAFE_INTEGER]) assert.equal((await user.send('PUT', '/api/annotations/record-1', payload(metadata(), revision))).status, 400);
    assert.equal((await user.send('PUT', '/api/annotations/record-1', { ...payload(), frame: 'private' })).status, 400);
    assert.equal((await user.send('PUT', '/api/annotations/record-1', payload(), { 'x-breakglass-csrf': '' })).status, 403);
    assert.equal((await user.send('PUT', '/api/annotations/record-1', payload(), { origin: 'https://other.example' })).status, 403);
    assert.equal((await user.send('GET', '/api/annotations?user=someone')).status, 400);
    assert.deepEqual((await user.send('GET', '/api/annotations')).value.annotations, []);
    const literal = { ...metadata(), title: '<img src=x onerror=alert(1)>', note: '' };
    assert.equal((await user.send('PUT', '/api/annotations/record-1', payload(literal))).value.annotation.title, literal.title);
  });
});

test('record deletion and both clear paths remove annotations; old epochs cannot recreate a deleted record annotation', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await seed(user);
    for (const [index, route] of ['/api/learning/records/record-1', '/api/learning/records', '/api/account/data'].entries()) {
      const epoch = index;
      if (index) await user.send('PUT', '/api/learning/records/record-1', { record, expectedEpoch: epoch });
      await user.send('PUT', '/api/annotations/record-1', payload(metadata(), 0, epoch));
      assert.equal((await user.send('DELETE', route, { expectedEpoch: epoch })).status, 200);
      assert.deepEqual((await user.send('GET', '/api/annotations')).value, { annotations: [], epoch: epoch + 1 });
      const late = await user.send('PUT', '/api/annotations/record-1', payload(metadata('迟到编辑'), 1, epoch));
      assert.equal(late.status, 409); assert.equal(late.value.code, 'epoch_conflict');
      assert.equal((await user.send('GET', '/api/annotations/record-1')).status, 404);
    }
  });
});

test('legacy account storage opens unchanged; sidecar persists without exporting fields into original v1 records', async () => {
  await fixture(async ({ client, dataDir }) => {
    const user = client(); await seed(user);
    const filename = path.join(dataDir, 'accounts-v1.json');
    const state = JSON.parse(await fs.readFile(filename, 'utf8')); delete state.users[0].annotations;
    const legacy = JSON.stringify(state); await fs.writeFile(filename, legacy);
    assert.deepEqual(await createAccountStore({ dataDir, validate: database }).read(), state);
    const restarted = createLearningHandler({ dataDir, allowedOrigins: [ORIGIN] });
    assert.equal(await restarted.privateScope({ headers: { cookie: user.cookie } }), null);
    assert.equal(await fs.readFile(filename, 'utf8'), legacy);
    await user.send('PUT', '/api/annotations/record-1', payload());
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    assert.equal(data.users[0].annotations[0].recordId, 'record-1'); assert.deepEqual(data.users[0].records, [record]);
    const exported = (await user.send('GET', '/api/learning/export')).value;
    assert.deepEqual(exported.records, [record]); assert.equal(Object.hasOwn(exported.records[0], 'tags'), false);
  });
});

test('internal scope checks and awaited revocation reject deletion/logout/account-switch late analysis identities', async () => {
  await fixture(async ({ client, handler, dataDir }) => {
    const guest = { headers: {} }; assert.equal(await handler.privateScope(guest), null);
    assert.equal(await handler.isPrivateScopeCurrent(guest, null), true);
    const user = client(); await seed(user); const request = { headers: { cookie: user.cookie } };
    const owner = await handler.privateScope(request); assert.ok(owner.sessionKey); assert.equal(owner.epoch, 0);
    assert.equal(handler.isPrivateScopeLive(owner), true);
    assert.equal(await handler.isPrivateScopeCurrent(request, null), false);
    assert.equal(await handler.isPrivateScopeCurrent(request, owner), true);
    const notifications = []; let release;
    const detached = handler.onPrivateScopeInvalidated(async (event) => { notifications.push(event);
      if (event.reason === 'data_epoch') await new Promise((resolve) => { release = resolve; }); });
    let done = false; const removing = user.send('DELETE', '/api/learning/records', { expectedEpoch: 0 }).then((reply) => { done = true; return reply; });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false); assert.equal(await handler.isPrivateScopeCurrent(request, owner), false);
    assert.equal(handler.isPrivateScopeLive(owner), false);
    release(); assert.equal((await removing).status, 200);
    assert.equal(notifications[0].epoch, 1);
    const afterClear = await handler.privateScope(request);
    assert.equal(handler.isPrivateScopeLive(afterClear), true);
    await user.login('student_a'); assert.equal(await handler.isPrivateScopeCurrent(request, afterClear), false);
    assert.equal(handler.isPrivateScopeLive(afterClear), false);
    assert.ok(notifications.some((event) => event.reason === 'session_replaced'));
    const nextRequest = { headers: { cookie: user.cookie } }; const nextOwner = await handler.privateScope(nextRequest);
    await user.send('POST', '/api/account/logout', {}); assert.equal(await handler.isPrivateScopeCurrent(nextRequest, nextOwner), false);
    assert.equal(handler.isPrivateScopeLive(nextOwner), false);
    assert.equal(notifications.at(-1).reason, 'logout'); detached();
    assert.doesNotMatch(await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8'), /sessionKey|csrfToken|cookie/i);
  });
});

test('synchronous private scope guard rejects expiry between async validation and cache commit before any session sweep', async () => {
  let time = Date.parse('2026-10-07T00:00:00.000Z');
  await fixture(async ({ client, handler }) => {
    const user = client(); await seed(user, 'expiring_student'); const request = { headers: { cookie: user.cookie } };
    const saved = await handler.privateScope(request);
    assert.equal(await handler.isPrivateScopeCurrent(request, saved), true);
    assert.equal(handler.isPrivateScopeLive(saved), true);
    for (const bad of [null, undefined, { ...saved, id: 'another-account' }, { ...saved, epoch: saved.epoch + 1 },
      { ...saved, sessionKey: 'not-a-session' }, { ...saved, epoch: '0' }]) assert.equal(handler.isPrivateScopeLive(bad), false);
    time += 8 * 60 * 60 * 1000;
    // No async request or sweep occurs between these two checks.
    assert.equal(handler.isPrivateScopeLive(saved), false);
    assert.equal(await handler.isPrivateScopeCurrent(request, saved), false);
    assert.equal(await handler.privateScope(request), null);
    assert.equal(handler.isPrivateScopeLive(saved), false);
    const loggedIn = await user.login('expiring_student'); assert.equal(loggedIn.status, 200);
    const renewed = await handler.privateScope({ headers: { cookie: user.cookie } });
    assert.equal(handler.isPrivateScopeLive(renewed), true); assert.notEqual(renewed.sessionKey, saved.sessionKey);
    assert.equal(handler.isPrivateScopeLive(saved), false);
  }, { now: () => time });
});

test('secure deployment cookie flag marks creation and expiry without changing the default development cookie', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const created = await user.register('secure_student');
    assert.match(created.headers.get('set-cookie'), /; Secure$/);
    const exit = await user.send('POST', '/api/account/logout', {}); assert.match(exit.headers.get('set-cookie'), /Max-Age=0; Secure$/);
  }, { secureCookies: true });
  assert.throws(() => createLearningHandler({ secureCookies: 'true' }), /布尔/);
});

test('production approval hook runs after correct credentials, sees only public identity and refuses unapproved login', async () => {
  const approvals = []; let allowed = false;
  await fixture(async ({ client }) => {
    const user = client(); await user.register('approved_student'); await user.send('POST', '/api/account/logout', {});
    const wrong = await user.send('POST', '/api/account/login', { username: 'approved_student', password: 'incorrect-password' });
    assert.equal(wrong.status, 401); assert.equal(approvals.length, 0);
    const blocked = await user.login('approved_student'); assert.equal(blocked.status, 403); assert.equal(blocked.value.code, 'release_not_approved');
    assert.deepEqual(Object.keys(approvals[0].user).sort(), ['id', 'username']); assert.equal(approvals[0].phase, 'login');
    assert.deepEqual((await user.send('GET', '/api/account/me')).value, { user: null });
    allowed = true; assert.equal((await user.login('approved_student')).status, 200);
  }, { authorizeAccount: async (user, phase) => { approvals.push({ user, phase }); return allowed; } });
  assert.throws(() => createLearningHandler({ authorizeAccount: false }), /函数/);
});
