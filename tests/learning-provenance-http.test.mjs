import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLearningHandler } from '../breakglass-learning/src/server.mjs';
import { createAccountStore } from '../breakglass-learning/src/store.mjs';
import { database, provenanceList } from '../breakglass-learning/src/validation.mjs';

const ORIGIN = 'http://127.0.0.1:4173';
const SHA = 'a'.repeat(64);
const TIME = '2026-10-07T08:00:00.000Z';
const PASSWORD = 'provenance-fixture-password';
const clone = value => JSON.parse(JSON.stringify(value));
const route = id => `/api/learning/provenance/${encodeURIComponent(id)}`;
function record(id = 'recognition-record', template = 'parabola', overrides = {}) {
  return { id, kind: 'question', source: { kind: 'manual-notes', id: `manual-file-${SHA}`,
    version: 'video-v1', analysisVersion: '1', materialMode: 'self-authored' }, time: 3,
    title: '学生确认条件', note: '仅保存必要元数据', template,
    snapshot: template === 'parabola' ? { a: 1, h: 2, k: -1 } : { AB: 3, AC: 4, unit: 'cm' },
    origin: 'manual', sourceLabel: '学生确认候选', createdAt: TIME, ...overrides };
}
function metadata(parent = record(), overrides = {}) {
  return { recordId: parent.id, requestId: 'request-1', sourceId: `file-${SHA}`,
    videoVersion: parent.source.version, analysisVersion: parent.source.analysisVersion,
    frameTime: parent.time, frameSize: { width: 1920, height: 1080 }, template: parent.template,
    originalSnapshot: clone(parent.snapshot), placementStatus: 'unknown', map: null,
    profileVersion: 'profile-v1', promptVersion: 'prompt-v1', calibrationVersion: 'calibration-v1',
    confirmation: 'student', attribution: 'student-confirmed-candidate', ...overrides };
}
const item = parent => ({ ...metadata(parent), schemaVersion: '011.1', revision: 1, updatedAt: TIME });
function client(base) {
  let cookie = ''; let csrf = ''; let epoch = 0;
  const send = async (method, uri, body, overrides = {}) => {
    const response = await fetch(`${base}${uri}`, { method,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-breakglass-csrf': csrf } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...overrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const value = await response.json();
    if (value.csrfToken) csrf = value.csrfToken; if (Number.isSafeInteger(value.epoch)) epoch = value.epoch;
    return { status: response.status, value };
  };
  return { send, get epoch() { return epoch; }, get cookie() { return cookie; },
    register: name => send('POST', '/api/account/register', { username: name, password: PASSWORD }),
    login: name => send('POST', '/api/account/login', { username: name, password: PASSWORD }),
    saveRecord: parent => send('PUT', `/api/learning/records/${parent.id}`, { record: parent, expectedEpoch: epoch }),
    save: (parent, value = metadata(parent), revision = 0, expectedEpoch = epoch) =>
      send('PUT', route(parent.id), { metadata: value, expectedRevision: revision, expectedEpoch }) };
}
async function listen(dataDir) {
  const handler = createLearningHandler({ dataDir, allowedOrigins: [ORIGIN] });
  const server = http.createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function fixture(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-provenance-'));
  const server = await listen(dataDir);
  try { await run({ ...server, dataDir, client: () => client(server.base) }); }
  finally {
    await server.close(); const absolute = path.resolve(dataDir);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('breakglass-learning-provenance-'));
    await fs.rm(absolute, { recursive: true, force: true });
  }
}

test('account provenance is optional for legacy files and validates exact parent-associated persisted envelopes', () => {
  const parent = record(); const valid = item(parent);
  assert.deepEqual(provenanceList([valid], [parent]), [valid]);
  const legacy = { id: 'user-1', username: 'learner', passwordSalt: 'a'.repeat(32), passwordHash: 'b'.repeat(128),
    epoch: 0, records: [parent], watch: [], attempts: [] };
  assert.equal(database({ schemaVersion: 1, users: [legacy] }), true);
  assert.equal(database({ schemaVersion: 1, users: [{ ...legacy, provenance: [valid] }] }), true);
  for (const invalid of [[valid, valid], Array(501).fill(valid), [item(record('missing'))], [{ ...valid, checked: true }],
    [{ ...valid, template: 'right-triangle' }], [{ ...valid, confirmation: 'model' }], [{ ...valid, revision: 0 }]]) {
    assert.equal(provenanceList(invalid, [parent]), null);
    assert.equal(database({ schemaVersion: 1, users: [{ ...legacy, provenance: invalid }] }), false);
  }
});

test('HTTP provenance requires authenticated same-origin CSRF and cannot claim automatic checked evidence', async () => {
  await fixture(async ({ client }) => {
    const stranger = client();
    assert.equal((await stranger.send('GET', '/api/learning/provenance')).status, 401);
    assert.equal((await stranger.save(record())).status, 401);
    const user = client(); await user.register('provenance_auth'); await user.saveRecord(record());
    for (const headers of [{ 'x-breakglass-csrf': '' }, { 'x-breakglass-csrf': 'wrong' }, { origin: 'https://untrusted.example' }]) {
      assert.equal((await user.send('PUT', route(record().id), { metadata: metadata(), expectedRevision: 0, expectedEpoch: 0 }, headers)).status, 403);
    }
    for (const patch of [{ confirmation: 'model' }, { placementStatus: 'checked' }, { attribution: 'auto-checked' },
      { checked: true }, { rawResponse: 'unbounded model text' }]) {
      const rejected = await user.save(record(), metadata(record(), patch));
      assert.equal(rejected.status, 400); assert.equal(rejected.value.code, 'invalid_provenance');
    }
    assert.deepEqual((await user.send('GET', '/api/learning/provenance')).value, { provenance: [], epoch: 0 });
  });
});

test('HTTP source, mathematical template, time and parent foreign keys reject mismatches and extra request fields', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('provenance_fields'); await user.saveRecord(record());
    assert.equal((await user.save(record('absent'))).status, 404);
    for (const patch of [{ recordId: 'another' }, { sourceId: `file-${'b'.repeat(64)}` }, { videoVersion: 'v2' },
      { analysisVersion: '2' }, { frameTime: 4 }, { template: 'right-triangle' },
      { originalSnapshot: { a: 1, h: 2, k: -1, answer: 5 } }, { frameSize: { width: 8192, height: 8192 } }]) {
      assert.equal((await user.save(record(), metadata(record(), patch))).status, 400);
    }
    const body = { metadata: metadata(), expectedRevision: 0, expectedEpoch: 0 };
    for (const patch of [{ checked: true }, { expectedRevision: -1 }, { expectedRevision: '0' }, { expectedEpoch: '0' }]) {
      assert.equal((await user.send('PUT', route(record().id), { ...body, ...patch })).status, 400);
    }
    assert.equal((await user.send('PUT', `${route(record().id)}?extra=1`, body)).status, 400);
    assert.equal((await user.send('GET', '/api/learning/provenance?recordId=x')).status, 400);
    assert.equal((await user.send('PUT', '/api/learning/provenance/%2Fprivate', body)).status, 400);
    assert.deepEqual((await user.send('GET', '/api/learning/provenance')).value.provenance, []);
  });
});

test('HTTP idempotent metadata retains service-generated revision and optimistic changes conflict atomically', async () => {
  await fixture(async ({ client, dataDir }) => {
    const user = client(); await user.register('provenance_revision'); await user.saveRecord(record());
    const first = await user.save(record()); assert.equal(first.status, 200); assert.equal(first.value.provenance.revision, 1);
    assert.match(first.value.provenance.updatedAt, /^\d{4}-\d\d-\d\dT/);
    const replay = await user.save(record()); assert.deepEqual(replay.value, first.value);
    assert.equal((await user.save(record(), metadata(record(), { requestId: 'request-2' }), 0)).status, 409);
    const concurrent = await Promise.all(['request-2', 'request-3'].map(requestId => user.save(record(), metadata(record(), { requestId }), 1)));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const list = (await user.send('GET', '/api/learning/provenance')).value;
    assert.equal(list.provenance.length, 1); assert.equal(list.provenance[0].revision, 2);
    assert.deepEqual((await user.send('GET', '/api/learning/records')).value.records, [record()]);
    const reloaded = createAccountStore({ dataDir, validate: database });
    assert.deepEqual((await reloaded.read()).users[0].provenance, list.provenance);
    assert.deepEqual(await fs.readdir(dataDir), ['accounts-v1.json']);
  });
});

test('HTTP same record IDs across accounts keep independent provenance and deny writes without an owned parent', async () => {
  await fixture(async ({ client }) => {
    const a = client(); const b = client(); await a.register('provenance_a'); await b.register('provenance_b');
    await a.saveRecord(record()); await a.save(record());
    assert.deepEqual((await b.send('GET', '/api/learning/provenance')).value.provenance, []);
    assert.equal((await b.save(record())).status, 404);
    const other = record(record().id, 'right-triangle'); await b.saveRecord(other);
    assert.equal((await b.save(other, metadata())).status, 400);
    const own = await b.save(other, metadata(other, { requestId: 'request-b' })); assert.equal(own.status, 200);
    const listA = (await a.send('GET', '/api/learning/provenance')).value.provenance;
    const listB = (await b.send('GET', '/api/learning/provenance')).value.provenance;
    assert.equal(listA[0].template, 'parabola'); assert.equal(listA[0].requestId, 'request-1');
    assert.equal(listB[0].template, 'right-triangle'); assert.equal(listB[0].requestId, 'request-b');
  });
});

test('HTTP parent deletion cascades provenance and stale epochs cannot recreate it after parent reinsert', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('provenance_delete');
    const kept = record('kept'); await user.saveRecord(record()); await user.saveRecord(kept);
    await user.save(record()); await user.save(kept);
    const deletion = await user.send('DELETE', `/api/learning/records/${record().id}`, { expectedEpoch: 0 });
    assert.equal(deletion.status, 200); assert.equal(deletion.value.epoch, 1);
    const list = (await user.send('GET', '/api/learning/provenance')).value;
    assert.deepEqual(list.provenance.map(p => p.recordId), ['kept']); assert.equal(list.epoch, 1);
    const stale = await user.save(record(), metadata(), 0, 0);
    assert.equal(stale.status, 409); assert.equal(stale.value.code, 'epoch_conflict');
    assert.equal((await user.save(record(), metadata(), 0, 1)).status, 404);
    await user.saveRecord(record()); assert.equal((await user.save(record(), metadata(), 0, 0)).status, 409);
    assert.equal((await user.save(record())).value.provenance.revision, 1);
  });
});

test('HTTP clear records and delete account data cascade provenance while preserving the login identity', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('provenance_clear'); await user.saveRecord(record()); await user.save(record());
    const clear = await user.send('DELETE', '/api/learning/records', { expectedEpoch: 0 });
    assert.equal(clear.status, 200); assert.equal(clear.value.epoch, 1);
    assert.deepEqual((await user.send('GET', '/api/learning/provenance')).value, { provenance: [], epoch: 1 });
    await user.saveRecord(record()); await user.save(record());
    const deletion = await user.send('DELETE', '/api/account/data', { expectedEpoch: 1 });
    assert.equal(deletion.status, 200); assert.equal(deletion.value.epoch, 2);
    const exported = (await user.send('GET', '/api/learning/export')).value;
    assert.deepEqual(exported.records, []); assert.deepEqual(exported.provenance, []);
    assert.equal((await user.send('GET', '/api/account/me')).value.user.username, 'provenance_clear');
    assert.equal((await user.save(record(), metadata(), 0, 1)).value.code, 'epoch_conflict');
  });
});

test('HTTP export contains only independent student provenance, and logout does not erase approved history', async () => {
  await fixture(async ({ client, dataDir }) => {
    const user = client(); await user.register('provenance_export'); await user.saveRecord(record());
    await user.save(record(), metadata(record(), { placementStatus: 'student-calibrated', map: { ox: 200, oy: 400, sx: 30, sy: 40 } }));
    const exported = (await user.send('GET', '/api/learning/export')).value;
    assert.deepEqual(Object.keys(exported).sort(), ['schemaVersion', 'user', 'epoch', 'records', 'watch', 'attempts', 'provenance'].sort());
    assert.equal(exported.provenance[0].confirmation, 'student');
    assert.equal(exported.provenance[0].placementStatus, 'student-calibrated');
    assert.doesNotMatch(JSON.stringify(exported), /password|csrfToken|data:image|blob:|cookie|session|rawResponse|auto-checked/i);
    const oldCookie = user.cookie; assert.equal((await user.send('POST', '/api/account/logout', {})).status, 200);
    assert.equal((await user.send('GET', '/api/learning/provenance', undefined, { cookie: oldCookie })).status, 401);
    assert.equal((await user.login('provenance_export')).status, 200);
    assert.deepEqual((await user.send('GET', '/api/learning/provenance')).value.provenance, exported.provenance);
    const raw = await fs.readFile(path.join(dataDir, 'accounts-v1.json'), 'utf8');
    assert.doesNotMatch(raw, /provenance-fixture-password|csrfToken|data:image|blob:|rawResponse/);
  });
});

test('HTTP provenance body size remains bounded and invalid oversized writes leave prior state intact', async () => {
  await fixture(async ({ client }) => {
    const user = client(); await user.register('provenance_bound'); await user.saveRecord(record()); await user.save(record());
    const oversized = await user.send('PUT', route(record().id), {
      metadata: { ...metadata(), image: 'x'.repeat(64 * 1024) }, expectedRevision: 1, expectedEpoch: 0 });
    assert.equal(oversized.status, 413); assert.equal(oversized.value.code, 'payload_too_large');
    assert.equal((await user.send('GET', '/api/learning/provenance')).value.provenance[0].revision, 1);
  });
});
