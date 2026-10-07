const test = require('node:test');
const assert = require('node:assert/strict');
const provenance = require('../learning-site/provenance');
const records = require('../learning-site/records');
const { createClient } = require('../learning-site/account-client');

const SHA = 'a'.repeat(64);
const TIME = '2026-10-07T08:00:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
function record(id = 'recognition-record', template = 'parabola', overrides = {}) {
  return { id, kind: 'question', source: { kind: 'manual-notes', id: `manual-file-${SHA}`,
    version: 'video-v1', analysisVersion: '1', materialMode: 'self-authored' }, time: 3,
    title: '学生确认的条件', note: '原候选仍可校对', template,
    snapshot: template === 'parabola' ? { a: 1, h: 2, k: -1 } : { AB: 3, AC: 4, unit: 'cm' },
    origin: 'manual', sourceLabel: '学生确认候选', createdAt: TIME, ...overrides };
}
function metadata(parent = record(), overrides = {}) {
  return { recordId: parent.id, requestId: 'recognition-request-1', sourceId: `file-${SHA}`,
    videoVersion: 'video-v1', analysisVersion: '1', frameTime: parent.time,
    frameSize: { width: 1920, height: 1080 }, template: parent.template,
    originalSnapshot: clone(parent.snapshot), placementStatus: 'unknown', map: null,
    profileVersion: 'profile-v1', promptVersion: 'prompt-v1', calibrationVersion: 'calibration-v1',
    confirmation: 'student', attribution: 'student-confirmed-candidate', ...overrides };
}
function persisted(parent = record(), overrides = {}) {
  return { ...metadata(parent), schemaVersion: '011.1', revision: 1, updatedAt: TIME, ...overrides };
}
function fixture(options = {}) {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const parent = records.createLocalStore(storage); parent.save(record());
  const sidecar = provenance.createStore({ storage, recordsStore: parent, now: () => TIME, ...options });
  return { data, storage, parent, sidecar };
}
const hasCode = code => error => error.code === code;

test('valid provenance retains separate original candidate and immutable student-corrected mathematics', () => {
  const parent = record(); const input = metadata(parent, { originalSnapshot: { a: 2, h: -3, k: 1 } });
  const checked = provenance.validateMetadata(input, parent);
  assert.deepEqual(checked, input); checked.originalSnapshot.a = 9;
  assert.equal(input.originalSnapshot.a, 2); assert.equal(parent.snapshot.a, 1);
  const triangle = record('triangle', 'right-triangle');
  assert.deepEqual(provenance.validateMetadata(metadata(triangle), triangle).originalSnapshot, triangle.snapshot);
  const local = record('local', 'parabola', { source: { ...parent.source, kind: 'local-file', id: `file-${SHA}` } });
  assert.equal(provenance.validateMetadata(metadata(local), local).sourceId, `file-${SHA}`);
});

test('strict metadata rejects missing/extra/hidden/symbol/accessor/prototype fields without invoking getters', () => {
  const parent = record(); const missing = metadata(); delete missing.map;
  const hidden = metadata(); Object.defineProperty(hidden, 'checked', { value: true });
  const symbol = metadata(); symbol[Symbol('checked')] = true;
  let invoked = false; const accessor = metadata(); Object.defineProperty(accessor, 'requestId', {
    enumerable: true, get() { invoked = true; return 'fake'; } });
  for (const input of [missing, { ...metadata(), checked: true }, hidden, symbol, accessor,
    Object.assign(Object.create(null), metadata()), [], Object.assign(Object.create({ inherited: true }), metadata())]) {
    assert.throws(() => provenance.validateMetadata(input, parent));
  }
  assert.equal(invoked, false);
});

test('source identity, version, time, record and template foreign keys must match the immutable parent', () => {
  for (const patch of [{ recordId: 'other' }, { sourceId: `file-${'b'.repeat(64)}` },
    { videoVersion: 'video-v2' }, { analysisVersion: 'analysis-v2' }, { frameTime: 3.00001 },
    { frameTime: -1 }, { frameTime: 601 }, { frameTime: Infinity }, { template: 'right-triangle' }]) {
    assert.throws(() => provenance.validateMetadata(metadata(record(), patch), record()));
  }
  assert.throws(() => provenance.validateMetadata(metadata(), undefined));
  const generic = record('generic', 'parabola', { source: { ...record().source, id: 'manual-generic' } });
  assert.throws(() => provenance.validateMetadata(metadata(generic), generic));
  const unsupported = record('line', 'line', { snapshot: { m: 1, b: 0 } });
  assert.throws(() => provenance.validateMetadata(metadata(unsupported), unsupported));
});

test('finite original snapshot validation rejects unsupported or malformed mathematics', () => {
  for (const originalSnapshot of [{ a: NaN, h: 2, k: -1 },
    { a: 1, h: Infinity, k: -1 }, { a: 1, h: 2, k: -1, answer: 5 }, { a: 1, h: 2 }, []]) {
    assert.throws(() => provenance.validateMetadata(metadata(record(), { originalSnapshot }), record()));
  }
  const triangle = record('triangle', 'right-triangle');
  for (const originalSnapshot of [{ AB: 0, AC: 4, unit: 'cm' }, { AB: 3, AC: -4, unit: 'cm' },
    { AB: 3, AC: 4, unit: 'script' }, { AB: 3, AC: 4, unit: 'cm', BC: 5 }]) {
    assert.throws(() => provenance.validateMetadata(metadata(triangle, { originalSnapshot }), triangle));
  }
});

test('frame dimensions and student calibration are bounded finite independent coordinates', () => {
  const calibrated = metadata(record(), { placementStatus: 'student-calibrated', map: { ox: 100, oy: 200, sx: 20, sy: 25 } });
  assert.deepEqual(provenance.validateMetadata(calibrated, record()).map, calibrated.map);
  for (const frameSize of [{ width: 0, height: 1080 }, { width: 1920.5, height: 1080 },
    { width: 8193, height: 1 }, { width: 8192, height: 8192 }, { width: 100, height: 100, roi: true }]) {
    assert.throws(() => provenance.validateMetadata(metadata(record(), { frameSize }), record()));
  }
  for (const patch of [{ placementStatus: 'unknown', map: calibrated.map }, { placementStatus: 'student-calibrated', map: null },
    { map: { ...calibrated.map, ox: -1 } }, { map: { ...calibrated.map, oy: 1081 } },
    { map: { ...calibrated.map, sx: 0 } }, { map: { ...calibrated.map, sy: Infinity } },
    { map: { ...calibrated.map, sy: 8193 } }, { map: { ...calibrated.map, checked: true } }]) {
    assert.throws(() => provenance.validateMetadata({ ...calibrated, ...patch }, record()));
  }
});

test('student metadata cannot claim automatic confirmation, verified pixels, extra model evidence or unsupported identifiers', () => {
  for (const patch of [{ confirmation: 'model' }, { confirmation: true }, { attribution: 'auto-checked' },
    { placementStatus: 'checked' }, { placementStatus: 'auto-calibrated' }, { formulaStatus: 'checked' },
    { rawResponse: 'model text' }, { image: 'data:image/jpeg;base64,raw' }, { requestId: '' },
    { profileVersion: 'p'.repeat(129) }, { promptVersion: 'https://example.test/prompt' }, { calibrationVersion: 'version 1' }]) {
    assert.throws(() => provenance.validateMetadata(metadata(record(), patch), record()));
  }
});

test('persisted sidecar envelope accepts only schema, positive revision and exact ISO time', () => {
  assert.deepEqual(provenance.validate(persisted(), record()), persisted());
  for (const patch of [{ schemaVersion: '1' }, { revision: 0 }, { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { updatedAt: '2026-02-30T08:00:00.000Z' },
    { updatedAt: '2026-10-07T08:00:00Z' }, { epoch: 0 }]) {
    assert.throws(() => provenance.validate(persisted(record(), patch), record()));
  }
});

test('local saves are immutable and idempotent, while changed content uses optimistic revision', () => {
  const { parent, sidecar } = fixture(); const before = parent.read();
  const first = sidecar.save(metadata(), 0, 0); assert.equal(first.revision, 1);
  assert.deepEqual(sidecar.save(metadata(), 0, 0), first);
  assert.throws(() => sidecar.save(metadata(record(), { requestId: 'new-request' }), 0, 0), hasCode('revision_conflict'));
  const second = sidecar.save(metadata(record(), { requestId: 'new-request' }), 0, 1);
  assert.equal(second.revision, 2); assert.equal(sidecar.read().items.length, 1);
  assert.deepEqual(parent.read(), before); first.originalSnapshot.a = 7;
  assert.equal(sidecar.read().items[0].originalSnapshot.a, 1);
});

test('local idempotence does not exempt malformed expectedRevision values from the write contract', () => {
  const { sidecar } = fixture(); sidecar.save(metadata(), 0, 0);
  for (const invalid of [-1, 1.5, '0', NaN, Infinity]) {
    assert.throws(() => sidecar.save(metadata(), 0, invalid), hasCode('revision_conflict'));
  }
});

test('parent deletion prunes provenance and prevents recreation before a parent exists', () => {
  const { parent, sidecar, data } = fixture(); sidecar.save(metadata(), 0, 0);
  parent.remove(record().id); assert.deepEqual(sidecar.read().items, []);
  assert.deepEqual(JSON.parse(data.get(provenance.KEY)).items, []);
  assert.throws(() => sidecar.save(metadata(), 0, 1), hasCode('record_not_found'));
  parent.save(record()); assert.equal(sidecar.save(metadata(), 0, 0).revision, 1);
});

test('record clear epochs purge old metadata and reject stale writes even after parent recreation', () => {
  const { parent, sidecar, data } = fixture(); sidecar.save(metadata(), 0, 0);
  parent.clear(); assert.deepEqual(sidecar.read(), { schemaVersion: '011.1', epoch: 1, items: [] });
  assert.equal(data.has(provenance.KEY), false); parent.save(record());
  assert.throws(() => sidecar.save(metadata(), 0, 0), hasCode('epoch_conflict'));
  sidecar.save(metadata(), 1, 0); sidecar.clear(); assert.deepEqual(sidecar.read().items, []);
  assert.equal(parent.read().records.length, 1);
});

test('local save rechecks parent existence immediately before writing sidecar', () => {
  const f = fixture();
  const sidecar = provenance.createStore({ storage: f.storage, recordsStore: f.parent,
    now: () => { f.parent.remove(record().id); return TIME; } });
  assert.throws(() => sidecar.save(metadata(), 0, 0), hasCode('record_not_found'));
  assert.equal(f.data.has(provenance.KEY), false);
});

test('corrupt, duplicate and over-limit local metadata fail closed without rewriting bytes', () => {
  const { sidecar, data } = fixture();
  const cases = ['{broken', JSON.stringify({ schemaVersion: '011.1', epoch: 0, items: [persisted(), persisted()] }),
    JSON.stringify({ schemaVersion: '011.1', epoch: 0, items: [persisted()], checked: true }),
    JSON.stringify({ schemaVersion: '011.1', epoch: 0, items: Array(501).fill(persisted()) }),
    ' '.repeat(provenance.MAX_BYTES + 1)];
  for (const raw of cases) {
    data.set(provenance.KEY, raw); assert.throws(() => sidecar.read()); assert.equal(data.get(provenance.KEY), raw);
  }
  sidecar.clear(); assert.deepEqual(sidecar.read().items, []);
});

test('local before-write epoch guard rejects a concurrent clear without resurrecting metadata', () => {
  const f = fixture();
  const sidecar = provenance.createStore({ storage: f.storage, recordsStore: f.parent,
    now: () => { f.parent.clear(); return TIME; } });
  assert.throws(() => sidecar.save(metadata(), 0, 0), hasCode('epoch_conflict'));
  assert.equal(f.data.has(provenance.KEY), false);
});

const response = (value, status = 200) => ({ status, ok: status < 400, json: async () => value });
test('provenance account client uses fixed routes, same-origin CSRF, revision and current epoch without retry', async () => {
  const calls = []; const client = createClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/account/me') return response({ user: { id: 'learner', username: 'learner' }, csrfToken: 'test-csrf', epoch: 4 });
    if (options.method === 'PUT') return response({ code: 'revision_conflict', error: '保留输入' }, 409);
    return response({ provenance: [persisted()], epoch: 4 });
  } });
  await client.refresh(); await client.provenance();
  await assert.rejects(client.saveProvenance(record().id, metadata(), 2), hasCode('revision_conflict'));
  const write = calls.find(c => c.options.method === 'PUT');
  assert.equal(write.url, '/api/learning/provenance/recognition-record');
  assert.deepEqual(JSON.parse(write.options.body), { metadata: metadata(), expectedRevision: 2, expectedEpoch: 4 });
  assert.equal(write.options.credentials, 'same-origin'); assert.equal(write.options.headers['X-BreakGlass-CSRF'], 'test-csrf');
  assert.equal(calls.filter(c => c.options.method === 'PUT').length, 1);
});

test('provenance reads and writes reject late responses after account or epoch generation changes', async () => {
  for (const mode of ['account', 'epoch']) {
    let active = 'alice'; let epoch = 0; let resolve; let signal;
    const delayed = new Promise(done => { resolve = done; });
    const client = createClient({ fetch: async (url, options) => {
      if (url === '/api/account/me') return response({ user: { id: active, username: active }, csrfToken: 'test', epoch });
      signal = options.signal; return delayed;
    } });
    await client.refresh(); const pending = mode === 'account' ? client.provenance() : client.saveProvenance(record().id, metadata());
    const rejected = assert.rejects(pending, hasCode('stale_session'));
    if (mode === 'account') active = 'bob'; else epoch = 1;
    await client.refresh(); assert.equal(signal.aborted, true);
    resolve(response({ provenance: mode === 'account' ? [persisted()] : persisted(), epoch: 0 })); await rejected;
    assert.equal(client.snapshot().epoch, epoch); assert.equal(client.snapshot().user.id, active);
  }
});
