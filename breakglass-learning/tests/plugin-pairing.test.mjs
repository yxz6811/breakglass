import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLearningHandler } from '../src/server.mjs';
import { createAccountStore } from '../src/store.mjs';

const ORIGIN = 'http://127.0.0.1:4174';
const CLIENT_ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
const OTHER_ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
const PASSWORD = 'development-test-password';
const SOURCE = { kind: 'visual-session', id: 'triangle-lesson', version: '1', analysisVersion: '1',
  materialMode: 'self-authored', title: '自制几何素材' };
const record = (id = 'plugin-record', override = {}) => ({ id, kind: 'pitfall', source: { ...SOURCE }, time: 3,
  title: '三角形条件', note: '检查斜边。', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'unit' },
  origin: 'vision', sourceLabel: 'AI候选，学生已核对', createdAt: '2026-10-06T00:00:00.000Z', ...override });

async function listener(dataDir, now) {
  const handle = createLearningHandler({ dataDir, now, allowedOrigins: [ORIGIN] });
  const server = http.createServer(async (request, response) => {
    if (!await handle(request, response)) { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  } };
}
async function send(base, method, route, body, headers = {}) {
  const response = await fetch(base + route, { method, headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, value: text ? JSON.parse(text) : null };
}
function website(base) {
  let cookie = ''; let csrf = '';
  const request = async (method, route, body, headers = {}) => {
    const result = await send(base, method, route, body, { origin: ORIGIN,
      ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-breakglass-csrf': csrf } : {}), ...headers });
    if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
    if (result.value?.csrfToken) csrf = result.value.csrfToken;
    return result;
  };
  return { request, register: (username) => request('POST', '/api/account/register', { username, password: PASSWORD }),
    login: (username) => request('POST', '/api/account/login', { username, password: PASSWORD }),
    pairing: () => request('POST', '/api/account/plugin-pairing', {}), get cookie() { return cookie; } };
}
function plugin(base, token, clientOrigin = CLIENT_ORIGIN) {
  return (method, route, body, headers = {}) => send(base, method, route, body,
    { authorization: `Bearer ${token}`, 'x-breakglass-client-origin': clientOrigin, ...headers });
}
async function connect(base, code, clientOrigin = CLIENT_ORIGIN, headers = {}) {
  return send(base, 'POST', '/api/plugin/connect', { code, clientOrigin }, headers);
}
async function pair(base, user, clientOrigin = CLIENT_ORIGIN) {
  const generated = await user.pairing(); assert.equal(generated.status, 200);
  const result = await connect(base, generated.value.code, clientOrigin); assert.equal(result.status, 200);
  return { request: plugin(base, result.value.token, clientOrigin), ...result.value, code: generated.value.code };
}
async function fixture(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-pairing-'));
  let time = Date.parse('2026-10-06T00:00:00.000Z');
  const server = await listener(dataDir, () => time);
  try { await run({ ...server, dataDir, website: () => website(server.base), advance: (amount) => { time += amount; }, now: () => time }); }
  finally {
    await server.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('breakglass-learning-pairing-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

test('网站登录和CSRF才可签发120秒一次性码，token只用于显式插件配对且不持久化', async () => {
  await fixture(async ({ website, base, dataDir, now }) => {
    const user = website();
    assert.equal((await user.pairing()).status, 401);
    await user.register('student_a');
    assert.equal((await user.request('POST', '/api/account/plugin-pairing', {}, { 'x-breakglass-csrf': '' })).status, 403);
    assert.equal((await user.request('POST', '/api/account/plugin-pairing', { automaticImport: true })).status, 400);
    const generated = await user.pairing();
    assert.deepEqual(Object.keys(generated.value).sort(), ['code', 'expiresAt', 'user']);
    assert.match(generated.value.code, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(generated.value.expiresAt, now() + 120000);
    const joined = await connect(base, generated.value.code);
    assert.equal(joined.status, 200); assert.match(joined.value.token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(Object.keys(joined.value).sort(), ['epoch', 'expiresAt', 'token', 'user']);
    assert.deepEqual(joined.value.user, generated.value.user);
    const extension = plugin(base, joined.value.token);
    const me = await extension('GET', '/api/plugin/me');
    assert.deepEqual(me.value, { user: joined.value.user, epoch: 0, expiresAt: joined.value.expiresAt });
    assert.deepEqual((await extension('GET', '/api/plugin/records')).value.records, []);
    const exported = (await user.request('GET', '/api/learning/export')).value;
    assert.doesNotMatch(JSON.stringify(exported), /pairing|token|csrf|session|password/i);
    const stored = await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8');
    assert.ok(!stored.includes(generated.value.code)); assert.ok(!stored.includes(joined.value.token));
    assert.doesNotMatch(stored, /parentKey|clientOrigin|csrfToken|pluginTokens|pairingCodes/);
  });
});

test('插件Origin与专用头精确绑定，无Origin后台合法而网站、其他扩展和缺头均拒绝', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a');
    const generated = await user.pairing();
    assert.equal((await connect(base, generated.value.code, 'http://127.0.0.1:4174')).status, 403);
    assert.equal((await connect(base, generated.value.code, CLIENT_ORIGIN, { origin: ORIGIN })).status, 403);
    assert.equal((await connect(base, generated.value.code, CLIENT_ORIGIN, { origin: OTHER_ORIGIN })).status, 403);
    assert.equal((await connect(base, generated.value.code, CLIENT_ORIGIN, { 'x-breakglass-client-origin': OTHER_ORIGIN })).status, 403);
    const joined = await connect(base, generated.value.code, CLIENT_ORIGIN, { origin: CLIENT_ORIGIN });
    assert.equal(joined.status, 200); assert.equal(joined.headers.get('access-control-allow-origin'), CLIENT_ORIGIN);
    const extension = plugin(base, joined.value.token);
    assert.equal((await extension('GET', '/api/plugin/me')).status, 200);
    assert.equal((await extension('GET', '/api/plugin/me', undefined, { origin: CLIENT_ORIGIN })).status, 200);
    for (const origin of [ORIGIN, 'https://untrusted.example', 'null']) {
      assert.equal((await extension('GET', '/api/plugin/me', undefined, { origin })).status, 403);
    }
    assert.equal((await extension('GET', '/api/plugin/me', undefined, { origin: OTHER_ORIGIN })).status, 403);
    assert.equal((await extension('GET', '/api/plugin/me', undefined, { 'x-breakglass-client-origin': OTHER_ORIGIN })).status, 401);
    assert.equal((await send(base, 'GET', '/api/plugin/me', undefined, { authorization: `Bearer ${joined.value.token}` })).status, 403);
    assert.equal((await extension('GET', '/api/plugin/me', undefined, { authorization: 'Bearer wrong' })).status, 401);
  });
});

test('配对码并发重用仅成功一次，新码失效旧码，过期和无效代码不能连接', async () => {
  await fixture(async ({ website, base, advance }) => {
    const user = website(); await user.register('student_a');
    const generated = await user.pairing();
    const races = await Promise.all([connect(base, generated.value.code), connect(base, generated.value.code)]);
    assert.deepEqual(races.map((result) => result.status).sort(), [200, 401]);
    assert.equal((await connect(base, generated.value.code)).value.code, 'pairing_expired');
    const old = await user.pairing(); const current = await user.pairing();
    assert.equal((await connect(base, old.value.code)).status, 401);
    advance(120001);
    assert.equal((await connect(base, current.value.code)).status, 401);
    assert.equal((await connect(base, 'a'.repeat(22))).status, 401);
    assert.equal((await connect(base, 'a'.repeat(23))).status, 400);
    assert.equal((await connect(base, 'wrong')).status, 400);
    assert.equal((await pair(base, user)).epoch, 0);
  });
});

test('配对记录同值PUT幂等、冲突保留原值，并在网站当前账户立即可见', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a'); const joined = await pair(base, user);
    const item = record();
    assert.equal((await joined.request('PUT', '/api/plugin/records/plugin-record', { record: item, expectedEpoch: 0 })).status, 200);
    const retries = await Promise.all(Array.from({ length: 5 }, () => joined.request('PUT', '/api/plugin/records/plugin-record', { record: item, expectedEpoch: 0 })));
    assert.ok(retries.every((result) => result.status === 200));
    const conflict = await joined.request('PUT', '/api/plugin/records/plugin-record', { record: { ...item, note: '不同内容' }, expectedEpoch: 0 });
    assert.equal(conflict.status, 409); assert.equal(conflict.value.code, 'record_conflict');
    const visible = (await user.request('GET', '/api/learning/records')).value.records;
    assert.deepEqual(visible, [item]);
    for (const invalid of [record('plugin-record', { snapshot: { AB: -3, AC: 4, unit: 'unit' } }),
      record('plugin-record', { frame: 'data:image/jpeg;base64,secret' }),
      record('plugin-record', { source: { ...SOURCE, materialMode: 'permission-pending' } }),
      record('plugin-record', { note: 'https://untrusted.example/media' })]) {
      assert.equal((await joined.request('PUT', '/api/plugin/records/plugin-record', { record: invalid, expectedEpoch: 0 })).status, 400);
    }
    assert.equal((await joined.request('PUT', '/api/plugin/records/another-id', { record: item, expectedEpoch: 0 })).status, 400);
    assert.deepEqual((await user.request('GET', '/api/learning/records')).value.records, [item]);
  });
});

test('两账户连接读取和同ID写入隔离；单账户全局撤销不影响另一个账户', async () => {
  await fixture(async ({ website, base }) => {
    const a = website(); const b = website(); await a.register('student_a'); await b.register('student_b');
    const first = await pair(base, a); const second = await pair(base, a, OTHER_ORIGIN); const other = await pair(base, b);
    await first.request('PUT', '/api/plugin/records/plugin-record', { record: record(), expectedEpoch: 0 });
    assert.deepEqual((await other.request('GET', '/api/plugin/records')).value.records, []);
    await other.request('PUT', '/api/plugin/records/plugin-record', { record: record('plugin-record', { note: '账户乙私有' }), expectedEpoch: 0 });
    assert.equal((await second.request('GET', '/api/plugin/records')).value.records[0].note, '检查斜边。');
    assert.equal((await other.request('GET', '/api/plugin/records')).value.records[0].note, '账户乙私有');
    const pending = await a.pairing();
    assert.equal((await a.request('DELETE', '/api/account/plugin-pairing', {}, { 'x-breakglass-csrf': '' })).status, 403);
    assert.equal((await first.request('GET', '/api/plugin/me')).status, 200);
    assert.equal((await a.request('DELETE', '/api/account/plugin-pairing', {})).status, 200);
    assert.equal((await first.request('GET', '/api/plugin/me')).status, 401);
    assert.equal((await second.request('GET', '/api/plugin/me')).status, 401);
    assert.equal((await connect(base, pending.value.code)).status, 401);
    assert.equal((await other.request('GET', '/api/plugin/me')).status, 200);
    assert.equal((await a.request('GET', '/api/learning/records')).value.records.length, 1);
  });
});

test('父网页登录退出、切账号或过期使旧插件连接和待配对代码失效', async () => {
  await fixture(async ({ website, base, advance }) => {
    const user = website(); await user.register('student_a'); const joined = await pair(base, user);
    const pending = await user.pairing();
    await user.request('POST', '/api/account/logout', {});
    assert.equal((await joined.request('GET', '/api/plugin/me')).status, 401);
    assert.equal((await joined.request('PUT', '/api/plugin/records/plugin-record', { record: record(), expectedEpoch: 0 })).status, 401);
    assert.equal((await connect(base, pending.value.code)).status, 401);
    await user.login('student_a'); const again = await pair(base, user);
    await user.register('student_b');
    assert.equal((await again.request('GET', '/api/plugin/me')).status, 401);
    const next = await pair(base, user);
    assert.equal(next.user.username, 'student_b');
    assert.deepEqual((await next.request('GET', '/api/plugin/records')).value.records, []);
    advance(8 * 60 * 60 * 1000 + 1);
    assert.equal((await next.request('GET', '/api/plugin/me')).status, 401);
    assert.deepEqual((await user.request('GET', '/api/account/me')).value, { user: null });
  });
});

test('删除推进账户epoch拒绝插件旧记录及观看重放，不得复活已清除数据', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a'); const joined = await pair(base, user);
    await joined.request('PUT', '/api/plugin/records/plugin-record', { record: record(), expectedEpoch: 0 });
    await joined.request('PUT', `/api/plugin/watch/${SOURCE.id}`, { source: SOURCE, time: 3, duration: 12, expectedEpoch: 0 });
    const cleared = await user.request('DELETE', '/api/account/data', { expectedEpoch: 0 });
    assert.equal(cleared.value.epoch, 1);
    for (const [route, payload] of [['/api/plugin/records/plugin-record', { record: record() }],
      [`/api/plugin/watch/${SOURCE.id}`, { source: SOURCE, time: 3, duration: 12 }]]) {
      const stale = await joined.request('PUT', route, { ...payload, expectedEpoch: 0 });
      assert.equal(stale.status, 409); assert.equal(stale.value.code, 'epoch_conflict');
    }
    const me = await joined.request('GET', '/api/plugin/me'); assert.equal(me.value.epoch, 1);
    assert.deepEqual((await joined.request('GET', '/api/plugin/records')).value.records, []);
    assert.deepEqual((await joined.request('GET', '/api/plugin/watch')).value.items, []);
    assert.equal((await joined.request('PUT', '/api/plugin/records/new-record', { record: record('new-record'), expectedEpoch: 1 })).status, 200);
  });
});

test('插件观看数据按同一来源结构保存；pending只允许私人位置而不许素材识别记录', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a'); const joined = await pair(base, user);
    const source = { ...SOURCE, materialMode: 'permission-pending' };
    const watched = await joined.request('PUT', `/api/plugin/watch/${source.id}`, { source, time: 4, duration: 12, expectedEpoch: 0 });
    assert.equal(watched.status, 200); assert.equal(watched.value.item.source.materialMode, 'permission-pending');
    assert.deepEqual(Object.keys(watched.value.item).sort(), ['duration', 'source', 'time', 'updatedAt']);
    assert.equal((await user.request('GET', '/api/learning/watch')).value.items[0].time, 4);
    assert.equal((await joined.request('PUT', `/api/plugin/watch/${source.id}`, { source, time: 13, duration: 12, expectedEpoch: 0 })).status, 400);
    assert.equal((await joined.request('PUT', '/api/plugin/records/plugin-record', { record: record('plugin-record', { source }), expectedEpoch: 0 })).status, 400);
    assert.equal((await joined.request('PUT', '/api/plugin/watch/wrong-source', { source, time: 4, duration: 12, expectedEpoch: 0 })).status, 400);
  });
});

test('插件权限拒绝作答、导出、账户管理和删除，断开只撤销当前连接', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a'); const first = await pair(base, user); const second = await pair(base, user);
    for (const [method, route, body] of [['GET', '/api/plugin/export'], ['POST', '/api/plugin/attempts', {}],
      ['DELETE', '/api/plugin/records/plugin-record', {}], ['POST', '/api/plugin/login', {}]]) {
      const result = await first.request(method, route, body);
      assert.equal(result.status, 404); assert.equal(result.value.code, 'plugin_scope_rejected');
    }
    assert.equal((await first.request('GET', '/api/learning/records')).status, 401);
    assert.equal((await first.request('DELETE', '/api/account/data', { expectedEpoch: 0 })).status, 403);
    assert.equal((await first.request('POST', '/api/plugin/disconnect', { unexpected: true })).status, 400);
    assert.equal((await first.request('POST', '/api/plugin/disconnect', {})).status, 200);
    assert.equal((await first.request('GET', '/api/plugin/me')).status, 401);
    assert.equal((await second.request('GET', '/api/plugin/me')).status, 200);
  });
});

test('配对和连接共享每IP分钟20次额度，过期窗口恢复且不无限保留代码', async () => {
  await fixture(async ({ website, base, advance }) => {
    const user = website(); await user.register('student_a'); const generated = await user.pairing();
    for (let index = 0; index < 19; index += 1) assert.equal((await connect(base, 'a'.repeat(22))).status, 401);
    assert.equal((await connect(base, generated.value.code)).status, 429);
    assert.equal((await user.pairing()).status, 429);
    advance(60001);
    assert.equal((await connect(base, generated.value.code)).status, 200);
    assert.equal((await user.pairing()).status, 200);
  });
});

test('插件连接2KiB与记录64KiB请求限额、扩展预检固定且网站预检不获插件权限', async () => {
  await fixture(async ({ website, base }) => {
    const user = website(); await user.register('student_a'); const joined = await pair(base, user);
    assert.equal((await send(base, 'POST', '/api/plugin/connect', { padding: 'a'.repeat(2048) })).status, 413);
    assert.equal((await joined.request('PUT', '/api/plugin/records/plugin-record', { padding: 'a'.repeat(64 * 1024) })).status, 413);
    const allowed = await fetch(base + '/api/plugin/records', { method: 'OPTIONS', headers: { origin: CLIENT_ORIGIN } });
    assert.equal(allowed.status, 204); assert.equal(allowed.headers.get('access-control-allow-origin'), CLIENT_ORIGIN);
    assert.equal(allowed.headers.get('access-control-allow-headers'), 'content-type, authorization, x-breakglass-client-origin');
    assert.doesNotMatch(allowed.headers.get('access-control-allow-methods'), /DELETE/);
    const rejected = await fetch(base + '/api/plugin/records', { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assert.equal(rejected.status, 403);
  });
});

test('服务重启令牌和码失效但学习记录持久化，重新登录配对恢复当前账户', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-pairing-restart-'));
  let server = await listener(dataDir, Date.now);
  try {
    const user = website(server.base); await user.register('student_a'); const joined = await pair(server.base, user);
    await joined.request('PUT', '/api/plugin/records/plugin-record', { record: record(), expectedEpoch: 0 });
    const pending = await user.pairing(); await server.close(); server = await listener(dataDir, Date.now);
    assert.equal((await plugin(server.base, joined.token)('GET', '/api/plugin/me')).status, 401);
    assert.equal((await connect(server.base, pending.value.code)).status, 401);
    const returning = website(server.base); await returning.login('student_a'); const rejoined = await pair(server.base, returning);
    assert.deepEqual((await rejoined.request('GET', '/api/plugin/records')).value.records, [record()]);
  } finally {
    await server.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('breakglass-learning-pairing-restart-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('每账户最多16个插件连接，达上限不驱逐已有连接，撤销后可重新配对', async () => {
  await fixture(async ({ website, base, advance }) => {
    const user = website(); await user.register('student_a'); let first;
    for (let index = 0; index < 16; index += 1) {
      if (index % 8 === 0) advance(60001);
      const joined = await pair(base, user); first ||= joined;
    }
    advance(60001);
    const code = await user.pairing(); const denied = await connect(base, code.value.code);
    assert.equal(denied.status, 409); assert.equal(denied.value.code, 'plugin_connection_limit');
    assert.equal((await first.request('GET', '/api/plugin/me')).status, 200);
    await user.request('DELETE', '/api/account/plugin-pairing', {});
    assert.equal((await first.request('GET', '/api/plugin/me')).status, 401);
    assert.equal((await pair(base, user)).user.username, 'student_a');
  });
});

test('原子提交前权限失效时丢弃已写临时快照，磁盘旧状态保持且临时文件清理', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-pairing-commit-'));
  const store = createAccountStore({ dataDir, validate: (state) => state.schemaVersion === 1 && Array.isArray(state.users) });
  try {
    await store.transact((state) => { state.users.push({ id: 'already-saved' }); });
    await assert.rejects(store.transact((state) => { state.users.push({ id: 'revoked-late-write' }); },
      { beforeCommit: () => { throw Object.assign(new Error('connection revoked'), { status: 401 }); } }), /connection revoked/);
    assert.deepEqual((await store.read()).users, [{ id: 'already-saved' }]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8')).users, [{ id: 'already-saved' }]);
    assert.deepEqual(await fs.readdir(dataDir), ['accounts-v1.json']);
  } finally {
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('breakglass-learning-pairing-commit-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
