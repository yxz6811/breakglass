const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const rules = require('../learning-site/analysis-cache.js');
const modulePromise = import('../scripts/analysis-cache.mjs');
const sourceId = 'file-' + 'a'.repeat(64); const provider = 'provider-' + 'b'.repeat(64);
const scope = { kind: 'account', id: 'student-a', epoch: 1 };
const input = (index = 0) => ({ requestId: 'cache-' + index, sourceId, videoVersion: '1', analysisVersion: '1',
  contextSourceId: null, frames: [{ frameTime: index, image: 'ephemeral-frame-data' }, { frameTime: index + 1, image: 'second-frame-data' }] });
const value = (request) => ({ schemaVersion: '1', requestId: request.requestId, sourceId: request.sourceId,
  videoVersion: '1', analysisVersion: '1', status: 'context', contextSourceId: null,
  observedTimes: request.frames.map((frame) => frame.frameTime), coverage: { start: request.frames[0].frameTime,
    end: request.frames.at(-1).frameTime, frameCount: 2, inputTypes: ['frames'] },
  limitations: '只观察稀疏画面，未处理音频。', summary: '候选概念概述。', keyPoints: [], pitfalls: [], objects: [] });
function directory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-analysis-cache-')); }
function remove(folder) { assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(folder).startsWith('breakglass-analysis-cache-')); fs.rmSync(folder, { recursive: true, force: true }); }

test('progressive plans keep the current window first, preserve every bounded window and reject budget enlargement', () => {
  const plan = rules.plan(600, 341); assert.equal(plan.length, 20); assert.equal(plan[0].id, 'window-11');
  assert.equal(new Set(plan.map((window) => window.id)).size, 20);
  assert.equal(plan.every((window) => window.end - window.start <= 30 && window.times.length === 4), true);
  assert.equal(plan.at(-1).end, 600); assert.equal(plan.at(-1).times.at(-1), 599.999);
  for (const args of [[601, 0], [0, 0], [30, 31], [30, 0, 9], [30, -1]]) assert.throws(() => rules.plan(...args));
  assert.equal(rules.plan(12, 12).length, 1); assert.equal(rules.plan(12, 0, 8)[0].times.length, 8);
});

test('account analysis cache persists structured candidates across process instances, never frames or credentials', async () => {
  const { createAnalysisCache, contextCacheIdentity } = await modulePromise; const folder = directory();
  try {
    const cache = createAnalysisCache({ dataDir: folder }); const request = input(); const identity = contextCacheIdentity(request, provider);
    assert.equal(await cache.put(scope, identity, { ...value(request), image: 'must-not-persist', token: 'must-not-persist' }), true);
    const text = fs.readFileSync(cache.filename, 'utf8');
    for (const forbidden of ['ephemeral-frame-data', 'second-frame-data', 'must-not-persist', 'sessionKey', 'apiKey', '"image"']) assert.equal(text.includes(forbidden), false);
    const restarted = createAnalysisCache({ dataDir: folder }); const cached = await restarted.get(scope, identity);
    assert.equal(cached.value.summary, '候选概念概述。'); assert.equal(cached.value.requestId, request.requestId);
    assert.equal(cached.identity.frames[0].sha256.length, 64);
  } finally { remove(folder); }
});

test('private cached candidates never cross account, epoch, source, subtitle, sampling or provider identities', async () => {
  const { createAnalysisCache, contextCacheIdentity } = await modulePromise; const folder = directory();
  try {
    const cache = createAnalysisCache({ dataDir: folder }); const request = input(); const identity = contextCacheIdentity(request, provider);
    await cache.put(scope, identity, value(request));
    assert.equal(await cache.get({ ...scope, id: 'student-b' }, identity), null);
    for (const override of [{ providerVersion: 'provider-' + 'c'.repeat(64) }, { sourceId: 'file-' + 'd'.repeat(64) },
      { videoVersion: '2' }, { analysisVersion: '2' }, { contextSourceId: 'subtitle-' + 'e'.repeat(64) },
      { frames: contextCacheIdentity({ ...request, frames: [{ frameTime: 0, image: 'changed' }, request.frames[1]] }, provider).frames }]) {
      assert.equal(await cache.get(scope, { ...identity, ...override }), null);
    }
    assert.equal(await cache.get({ ...scope, epoch: 2 }, identity), null);
    assert.equal(await cache.get(scope, identity), null, 'observed newer epoch physically removed the old scope entries');
  } finally { remove(folder); }
});

test('TTL and the 40-entry bound evict stale data without promoting an old result', async () => {
  const { createAnalysisCache, contextCacheIdentity } = await modulePromise; const folder = directory(); let time = Date.now();
  try {
    const cache = createAnalysisCache({ dataDir: folder, now: () => time });
    for (let index = 0; index < 42; index += 1) { const request = input(index); await cache.put(scope, contextCacheIdentity(request, provider), value(request)); time += 1; }
    assert.equal(JSON.parse(fs.readFileSync(cache.filename, 'utf8')).entries.length, 40);
    assert.equal(await cache.get(scope, contextCacheIdentity(input(), provider)), null);
    assert.ok(await cache.get(scope, contextCacheIdentity(input(41), provider)));
    time += rules.LIMITS.ttlMs;
    assert.equal(await cache.get(scope, contextCacheIdentity(input(41), provider)), null);
    assert.equal(JSON.parse(fs.readFileSync(cache.filename, 'utf8')).entries.length, 0);
  } finally { remove(folder); }
});

test('guest cache is memory-only and account clear/revocation reject late commits', async () => {
  const { createAnalysisCache, contextCacheIdentity } = await modulePromise; const folder = directory();
  try {
    const cache = createAnalysisCache({ dataDir: folder }); const request = input(); const identity = contextCacheIdentity(request, provider);
    const guest = { kind: 'guest', id: 'private-guest-a', epoch: 0 };
    await cache.put(guest, identity, value(request)); assert.ok(await cache.get(guest, identity));
    assert.equal(fs.existsSync(cache.filename), false);
    assert.equal(await createAnalysisCache({ dataDir: folder }).get(guest, identity), null);
    assert.equal(await cache.put(scope, identity, value(request), () => false), false);
    const pending = cache.put(scope, identity, value(request)); const cleared = cache.clear(scope);
    assert.equal(await pending, false); await cleared; assert.equal(await cache.get(scope, identity), null);
    await cache.put(scope, identity, value(request)); await cache.revokeSource(sourceId);
    assert.equal(await cache.get(scope, identity), null);
  } finally { remove(folder); }
});

test('account capability revoked during the actual final rename rolls back disk and cannot reappear after restart', async () => {
  const { createAnalysisCache, contextCacheIdentity } = await modulePromise; const folder = directory();
  const disk = require('node:fs/promises'); const rename = disk.rename;
  try {
    const cache = createAnalysisCache({ dataDir: folder }); const priorRequest = input();
    const priorIdentity = contextCacheIdentity(priorRequest, provider);
    assert.equal(await cache.put(scope, priorIdentity, value(priorRequest)), true);
    const committed = JSON.parse(fs.readFileSync(cache.filename, 'utf8'));
    const rejectedRequest = input(12); const rejectedIdentity = contextCacheIdentity(rejectedRequest, provider);
    let revoked = false; let actualRenames = 0;
    disk.rename = async (...args) => {
      const result = await rename(...args);
      if (args[1] === cache.filename) { actualRenames += 1; revoked = true; }
      return result;
    };
    assert.equal(await cache.put(scope, rejectedIdentity, value(rejectedRequest), () => !revoked), false);
    disk.rename = rename;
    assert.equal(actualRenames, 2, 'real rejected rename and rollback both completed');
    assert.deepEqual(JSON.parse(fs.readFileSync(cache.filename, 'utf8')), committed);
    assert.equal(await cache.get(scope, rejectedIdentity), null);
    assert.equal((await cache.get(scope, priorIdentity)).value.requestId, priorRequest.requestId);
    const restarted = createAnalysisCache({ dataDir: folder });
    assert.equal(await restarted.get(scope, rejectedIdentity), null);
    assert.equal((await restarted.get(scope, priorIdentity)).value.requestId, priorRequest.requestId);
  } finally { disk.rename = rename; remove(folder); }
});

test('malformed persistent candidates and repository destinations fail closed', async () => {
  const { createAnalysisCache } = await modulePromise; const folder = directory();
  try {
    fs.writeFileSync(path.join(folder, 'analysis-cache-v1.json'), JSON.stringify({ schemaVersion: '1', entries: [{ token: 'forged' }] }));
    await assert.rejects(createAnalysisCache({ dataDir: folder }).get(scope, {}), /analysis_cache_unavailable/);
    assert.throws(() => createAnalysisCache({ dataDir: path.resolve(__dirname, '..') }));
    assert.throws(() => createAnalysisCache({ dataDir: 'relative' }));
  } finally { remove(folder); }
});
