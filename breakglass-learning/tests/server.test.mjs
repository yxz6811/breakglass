import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLearningHandler } from '../src/server.mjs';
import { createAccountStore } from '../src/store.mjs';
import { readLearning } from '../../breakglass-reader/src/learning.mjs';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'development-test-password';
const SOURCE = { kind: 'manual-notes', id: 'manual-file-test-sha', version: '1', analysisVersion: '1',
  materialMode: 'self-authored', title: '我的手工学习' };
const record = (id = 'record-1', overrides = {}) => ({ id, kind: 'pitfall', source: { ...SOURCE }, time: 3,
  title: '直角三角形关系', note: '我想检查斜边是否等于直角边之和。', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'unit' }, origin: 'manual', sourceLabel: '我的手工条件',
  createdAt: '2026-10-06T00:00:00.000Z', ...overrides });

async function removeTestDirectory(dataDir) {
  const absolute = path.resolve(dataDir);
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
  assert.ok(path.basename(absolute).startsWith('breakglass-learning-'));
  await fs.rm(absolute, { recursive: true, force: true });
}

async function listen(dataDir) {
  const handler = createLearningHandler({ dataDir, allowedOrigins: [ORIGIN] });
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) { res.writeHead(404); res.end('static fallback'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}
function client(base) {
  let cookie = ''; let csrf = ''; let epoch = 0;
  const send = async (method, route, body, overrides = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { origin: ORIGIN,
      ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-breakglass-csrf': csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...overrides },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text(); let value;
    try { value = JSON.parse(text); } catch { value = text; }
    if (value?.csrfToken) csrf = value.csrfToken;
    if (Number.isSafeInteger(value?.epoch)) epoch = value.epoch;
    return { status: response.status, value, headers: response.headers };
  };
  return { send, register: (username) => send('POST', '/api/account/register', { username, password: PASSWORD }),
    login: (username, password = PASSWORD) => send('POST', '/api/account/login', { username, password }),
    get cookie() { return cookie; }, get csrf() { return csrf; }, get epoch() { return epoch; } };
}
async function fixture(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-test-'));
  const server = await listen(dataDir);
  try { await run({ ...server, dataDir, client: () => client(server.base) }); }
  finally { await server.close(); await removeTestDirectory(dataDir); }
}

test('真实注册登录退出使用HttpOnly cookie、CSRF和盐化scrypt持久化，不泄露凭据', async () => {
  await fixture(async ({ client, dataDir }) => {
    const user = client();
    assert.deepEqual((await user.send('GET', '/api/account/me')).value, { user: null });
    const registered = await user.register('Learner_1');
    assert.equal(registered.status, 201); assert.equal(registered.value.user.username, 'learner_1');
    assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api/);
    assert.equal(registered.value.epoch, 0); assert.ok(registered.value.csrfToken);
    assert.doesNotMatch(JSON.stringify(registered.value), /password|salt|hash|session/i);
    const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8'));
    assert.match(stored.users[0].passwordSalt, /^[a-f0-9]{32}$/);
    assert.match(stored.users[0].passwordHash, /^[a-f0-9]{128}$/);
    assert.notEqual(stored.users[0].passwordHash, PASSWORD);
    assert.doesNotMatch(JSON.stringify(stored), /development-test-password|csrfToken|breakglass_local_session/);
    const oldCookie = user.cookie;
    assert.equal((await user.send('POST', '/api/account/logout', {})).status, 200);
    assert.deepEqual((await user.send('GET', '/api/account/me', undefined, { cookie: oldCookie })).value, { user: null });
    assert.equal((await user.login('LEARNER_1')).status, 200);
    assert.notEqual(user.cookie, oldCookie);
    assert.equal((await user.register('learner_1')).status, 409);
  });
});

test('用户名密码固定约束、Origin和CSRF拒绝保护所有写入', async () => {
  await fixture(async ({ client }) => {
    const user = client();
    for (const credentials of [{ username: 'ab', password: PASSWORD }, { username: 'http://site', password: PASSWORD },
      { username: 'good_name', password: 'short' }, { username: 'good_name', password: PASSWORD, extra: true }]) {
      assert.equal((await user.send('POST', '/api/account/register', credentials)).status, 400);
    }
    assert.equal((await user.send('POST', '/api/account/register', { username: 'learner', password: PASSWORD }, { origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await user.register('学生甲')).status, 201);
    for (const headers of [{ 'x-breakglass-csrf': '' }, { 'x-breakglass-csrf': 'wrong' }, { origin: 'https://untrusted.example' }]) {
      assert.equal((await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 }, headers)).status, 403);
      assert.equal((await user.send('DELETE', '/api/account/data', { expectedEpoch: 0 }, headers)).status, 403);
    }
    assert.deepEqual((await user.send('GET', '/api/learning/records')).value.records, []);
    assert.equal((await user.send('POST', '/api/account/logout', {}, { 'x-breakglass-csrf': '' })).status, 403);
  });
});

test('账户之间完全隔离，同id独立保存、幂等PUT与冲突409', async () => {
  await fixture(async ({ client }) => {
    const a = client(); const b = client();
    await a.register('student_a'); await b.register('student_b');
    const item = record();
    assert.equal((await a.send('PUT', '/api/learning/records/record-1', { record: item, expectedEpoch: 0 })).status, 200);
    assert.equal((await a.send('PUT', '/api/learning/records/record-1', { record: { ...item }, expectedEpoch: 0 })).status, 200);
    assert.equal((await a.send('PUT', '/api/learning/records/record-1', { record: { ...item, note: '另一条记录' }, expectedEpoch: 0 })).status, 409);
    assert.equal((await a.send('GET', '/api/learning/records')).value.records.length, 1);
    assert.deepEqual((await b.send('GET', '/api/learning/records')).value.records, []);
    assert.equal((await b.send('DELETE', '/api/learning/records/record-1', { expectedEpoch: 0 })).status, 404);
    assert.equal((await b.send('POST', '/api/learning/attempts', { recordId: 'record-1', answer: 5, hintUsed: false, expectedEpoch: 0 })).status, 404);
    assert.equal((await b.send('PUT', '/api/learning/records/record-1', { record: { ...item, note: '属于账户乙' }, expectedEpoch: 0 })).status, 200);
    assert.equal((await a.send('GET', '/api/learning/records')).value.records[0].note, item.note);
    assert.equal((await b.send('GET', '/api/learning/records')).value.records[0].note, '属于账户乙');
  });
});

test('删除推进账户epoch，串行并发迟到写入不得复活记录，账号互不影响', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const other = client(); await user.register('student_a'); await other.register('student_b');
    await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 });
    const deleted = await user.send('DELETE', '/api/learning/records/record-1', { expectedEpoch: 0 });
    assert.equal(deleted.status, 200); assert.equal(deleted.value.epoch, 1);
    const late = await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 });
    assert.equal(late.status, 409); assert.equal(late.value.code, 'epoch_conflict');
    assert.deepEqual((await user.send('GET', '/api/learning/records')).value.records, []);
    assert.equal((await other.send('GET', '/api/learning/records')).value.epoch, 0);
    await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 1 });
    const racing = await Promise.all([
      user.send('DELETE', '/api/learning/records', { expectedEpoch: 1 }),
      user.send('PUT', '/api/learning/records/record-2', { record: record('record-2'), expectedEpoch: 1 })
    ]);
    assert.equal(racing[0].status, 200);
    assert.ok([200, 409].includes(racing[1].status));
    assert.deepEqual((await user.send('GET', '/api/learning/records')).value.records, []);
    assert.equal((await user.send('GET', '/api/learning/records')).value.epoch, 2);
  });
});

test('程序判定直角三角形和顶点复练，区分提示后正确与独立正确，不篡改个人标记', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('student_a');
    await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 });
    for (const [answer, hintUsed, outcome] of [[7, false, 'wrong'], [5, true, 'correct_with_hint'], [5, false, 'correct_independent']]) {
      const result = await user.send('POST', '/api/learning/attempts', { recordId: 'record-1', answer, hintUsed, expectedEpoch: 0 });
      assert.equal(result.status, 200); assert.equal(result.value.attempt.outcome, outcome);
      assert.equal(result.value.expectedAnswer, 5);
    }
    const parabola = record('record-p', { kind: 'question', template: 'parabola', snapshot: { a: 2, h: -3, k: 4 } });
    await user.send('PUT', '/api/learning/records/record-p', { record: parabola, expectedEpoch: 0 });
    const vertex = await user.send('POST', '/api/learning/attempts', { recordId: 'record-p', answer: { h: -3, k: 4 }, hintUsed: false, expectedEpoch: 0 });
    assert.equal(vertex.value.attempt.correct, true); assert.deepEqual(vertex.value.expectedAnswer, { h: -3, k: 4 });
    assert.equal((await user.send('POST', '/api/learning/attempts', { recordId: 'record-p', answer: { h: '-3', k: 4 }, hintUsed: false, expectedEpoch: 0 })).status, 400);
    const attempts = await user.send('GET', '/api/learning/attempts?recordId=record-1');
    assert.equal(attempts.value.attempts.length, 3);
    assert.equal((await user.send('GET', '/api/learning/records')).value.records[0].kind, 'pitfall');
    await user.send('DELETE', '/api/learning/records/record-1', { expectedEpoch: 0 });
    assert.deepEqual((await user.send('GET', '/api/learning/attempts?recordId=record-1')).value.attempts, []);
  });
});

test('观看、最小导出及账户学习数据清除，无原视频/截图/凭据', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('student_a');
    await user.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 });
    const watch = await user.send('PUT', `/api/learning/watch/${SOURCE.id}`, { source: SOURCE, time: 4, duration: 12, expectedEpoch: 0 });
    assert.equal(watch.status, 200); assert.equal(watch.value.item.time, 4);
    assert.equal((await user.send('GET', '/api/learning/watch')).value.items.length, 1);
    await user.send('POST', '/api/learning/attempts', { recordId: 'record-1', answer: 5, hintUsed: false, expectedEpoch: 0 });
    const exported = await user.send('GET', '/api/learning/export');
    assert.deepEqual(Object.keys(exported.value).sort(), ['schemaVersion', 'user', 'epoch', 'records', 'watch', 'attempts'].sort());
    assert.doesNotMatch(JSON.stringify(exported.value), /password|csrfToken|data:image|blob:|session|http:\/\//i);
    const clearing = await user.send('DELETE', '/api/account/data', { expectedEpoch: 0 });
    assert.equal(clearing.status, 200); assert.equal(clearing.value.epoch, 1);
    const data = (await user.send('GET', '/api/learning/export')).value;
    assert.deepEqual(data.records, []); assert.deepEqual(data.watch, []); assert.deepEqual(data.attempts, []);
    assert.equal((await user.send('GET', '/api/account/me')).value.user.username, 'student_a');
    assert.equal((await user.send('PUT', `/api/learning/watch/${SOURCE.id}`, { source: SOURCE, time: 4, duration: 12, expectedEpoch: 0 })).status, 409);
  });
});

test('媒体地址、未知字段、pending来源、越界时间和记录身份均拒绝', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('student_a');
    for (const item of [record('record-1', { frame: 'data:image/jpeg;base64,secret' }), record('record-1', { note: 'http://media.example/video.mp4' }),
      record('record-1', { source: { ...SOURCE, materialMode: 'permission-pending' } }), record('record-1', { time: 601 }),
      record('record-1', { source: { ...SOURCE, id: 'data:secret' } })]) {
      assert.equal((await user.send('PUT', '/api/learning/records/record-1', { record: item, expectedEpoch: 0 })).status, 400);
    }
    assert.equal((await user.send('PUT', '/api/learning/records/path-other', { record: record(), expectedEpoch: 0 })).status, 400);
    for (const id of ['%ZZ', 'bad%2Fpath', 'data:media']) {
      assert.equal((await user.send('DELETE', `/api/learning/records/${id}`, { expectedEpoch: 0 })).status, 400);
    }
    for (const item of [{ source: { ...SOURCE, url: 'http://video' }, time: 0, duration: 12 },
      { source: SOURCE, time: 13, duration: 12 }, { source: SOURCE, time: 1, duration: 601 }]) {
      assert.equal((await user.send('PUT', `/api/learning/watch/${SOURCE.id}`, { ...item, expectedEpoch: 0 })).status, 400);
    }
    assert.deepEqual((await user.send('GET', '/api/learning/records')).value.records, []);
  });
});

test('pending素材可明确保存私人观看元数据，不能放行数学记录或AI处理', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const other = client(); await user.register('student_a'); await other.register('student_b');
    const source = { kind: 'local-file', id: `file-${'b'.repeat(64)}`, version: '1', analysisVersion: '1',
      materialMode: 'permission-pending', title: '仅本地观看的文件' };
    const saved = await user.send('PUT', `/api/learning/watch/${source.id}`, { source, time: 5, duration: 12, expectedEpoch: 0 });
    assert.equal(saved.status, 200); assert.equal(saved.value.item.source.materialMode, 'permission-pending');
    assert.equal((await user.send('GET', '/api/learning/watch')).value.items.length, 1);
    assert.deepEqual((await other.send('GET', '/api/learning/watch')).value.items, []);
    const pendingRecord = record('record-pending', { source, origin: 'vision', sourceLabel: '未获准处理的候选' });
    assert.equal((await user.send('PUT', '/api/learning/records/record-pending', { record: pendingRecord, expectedEpoch: 0 })).status, 400);
    let uploaded = false;
    const visual = await readLearning({ schemaVersion: '1', requestId: 'pending-test', sourceId: source.id,
      videoVersion: source.version, analysisVersion: '1', materialMode: source.materialMode, frameTime: 5, image: 'not-an-image' },
    { settings: {}, fetchImpl: async () => { uploaded = true; throw new Error('must_not_upload'); } });
    assert.equal(visual.status, 403); assert.equal(visual.payload.code, 'permission_pending'); assert.equal(uploaded, false);
    const exported = (await user.send('GET', '/api/learning/export')).value;
    assert.deepEqual(exported.records, []); assert.deepEqual(exported.attempts, []);
    assert.deepEqual(Object.keys(exported.watch[0]).sort(), ['source', 'time', 'duration', 'updatedAt'].sort());
    assert.doesNotMatch(JSON.stringify(exported), /data:|blob:|file:\/\/|http:\/\/|image|subtitle|transcript/);
  });
});

test('同用户名同密码并发注册只有一个账户落盘，其他请求冲突且不覆盖凭据', async () => {
  await fixture(async ({ client, dataDir }) => {
    const first = client(); const second = client(); const third = client();
    const results = await Promise.all([first.register('same_user'), second.register('same_user'), third.register('same_user')]);
    assert.deepEqual(results.map((item) => item.status).sort(), [201, 409, 409]);
    const state = JSON.parse(await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8'));
    assert.equal(state.users.length, 1); assert.equal(state.users[0].username, 'same_user');
    assert.equal((await client().login('same_user')).status, 200);
    assert.deepEqual(await fs.readdir(dataDir), ['accounts-v1.json']);
  });
});

test('完整文件指纹来源只保存数学快照与观看元数据，手工来源不能伪装AI视觉', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('student_a');
    const source = { kind: 'local-file', id: `file-${'a'.repeat(64)}`, version: '1', analysisVersion: '1',
      materialMode: 'self-authored', title: '已登记自制素材' };
    const visual = record('record-file', { source, origin: 'vision', sourceLabel: 'AI视觉候选，学生已核对' });
    const stored = await user.send('PUT', '/api/learning/records/record-file', { record: visual, expectedEpoch: 0 });
    assert.equal(stored.status, 200); assert.equal(stored.value.record.source.id, source.id);
    assert.equal((await user.send('PUT', `/api/learning/watch/${source.id}`, { source, time: 10, duration: 600, expectedEpoch: 0 })).status, 200);
    assert.equal((await user.send('PUT', '/api/learning/records/record-manual', { record: record('record-manual', { origin: 'vision' }), expectedEpoch: 0 })).status, 400);
    const exported = (await user.send('GET', '/api/learning/export')).value;
    assert.equal(exported.records.length, 1);
    assert.doesNotMatch(JSON.stringify(exported), /data:|blob:|file:\/\/|http:\/\//);
  });
});

test('重启保留账户和记录，运行时会话失效，凭据正确后可重新登录', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-restart-'));
  let server = await listen(dataDir);
  try {
    const before = client(server.base); await before.register('persist_user');
    await before.send('PUT', '/api/learning/records/record-1', { record: record(), expectedEpoch: 0 });
    const oldCookie = before.cookie; await server.close(); server = await listen(dataDir);
    const after = client(server.base);
    assert.deepEqual((await after.send('GET', '/api/account/me', undefined, { cookie: oldCookie })).value, { user: null });
    assert.equal((await after.login('persist_user')).status, 200);
    assert.equal((await after.send('GET', '/api/learning/records')).value.records.length, 1);
    assert.equal((await after.register('persist_user')).status, 409);
  } finally { await server.close(); await removeTestDirectory(dataDir); }
});

test('登录失败限流，缺少登录不可越权读取或写入', async () => {
  await fixture(async ({ client }) => {
    const registered = client(); await registered.register('student_a');
    const stranger = client();
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await stranger.login('student_a', 'incorrect-password')).status, 401);
    const throttled = await stranger.login('student_a', PASSWORD);
    assert.equal(throttled.status, 429); assert.equal(throttled.value.code, 'rate_limited');
    for (const route of ['/api/learning/records', '/api/learning/watch', '/api/learning/attempts', '/api/learning/export']) {
      assert.equal((await stranger.send('GET', route)).status, 401);
    }
    assert.equal((await stranger.send('DELETE', '/api/account/data', { expectedEpoch: 0 })).status, 401);
  });
});

test('请求体上限与CORS预检固定，非API回交宿主，未知API拒绝', async () => {
  await fixture(async ({ client, base }) => {
    const user = client(); await user.register('student_a');
    assert.equal((await user.send('POST', '/api/account/login', { username: 'student_a', password: 'x'.repeat(3000) })).status, 413);
    assert.equal((await user.send('PUT', '/api/learning/records/record-1', { padding: 'x'.repeat(64 * 1024) })).status, 413);
    assert.equal((await user.send('GET', '/api/unknown')).status, 404);
    const preflight = await fetch(`${base}/api/learning/records`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-breakglass-csrf/);
    const fallback = await fetch(`${base}/learning/`); assert.equal(await fallback.text(), 'static fallback');
  });
});

test('数据目录拒绝仓库内路径，损坏数据失败关闭且不覆盖原文件', async () => {
  assert.throws(() => createLearningHandler({ dataDir: path.resolve('breakglass-learning/data') }), /仓库/);
  assert.throws(() => createLearningHandler({ allowedOrigins: ['https://public.example'] }), /loopback/);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-corrupt-'));
  await fs.writeFile(path.join(dataDir, 'accounts-v1.json'), '{corrupt');
  const server = await listen(dataDir);
  try {
    const user = client(server.base);
    const result = await user.register('student_a'); assert.equal(result.status, 503);
    assert.equal(await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8'), '{corrupt');
    assert.doesNotMatch(JSON.stringify(result.value), /accounts-v1|learning-corrupt/);
  } finally { await server.close(); await removeTestDirectory(dataDir); }
});

test('原子存储写入顺序稳定，失败事务不改变已有状态', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-store-'));
  const validate = (state) => state.schemaVersion === 1 && Array.isArray(state.users);
  const store = createAccountStore({ dataDir, validate });
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, number) => store.transact((state) => { state.users.push({ number }); return number; })));
    assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
    await assert.rejects(store.transact((state) => { state.users = []; throw new Error('fail'); }));
    assert.equal((await store.read()).users.length, 8);
    assert.deepEqual((await fs.readdir(dataDir)), ['accounts-v1.json']);
    const restarted = createAccountStore({ dataDir, validate }); assert.equal((await restarted.read()).users.length, 8);
  } finally { await removeTestDirectory(dataDir); }
});
