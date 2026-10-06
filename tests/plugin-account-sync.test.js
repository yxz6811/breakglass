const test = require('node:test');
const assert = require('node:assert/strict');
const { createSync, ENDPOINT } = require('../extension/src/plugin/account-sync');
const { validateRecord } = require('../extension/src/plugin/contracts');
const { sourceFor, lessons } = require('../extension/src/plugin/registry');
const origin = 'chrome-extension://' + 'a'.repeat(32);
const source = sourceFor(lessons[0]);
const record = (id = 'record-1') => ({ id, kind: 'question', source, time: 4,
  title: '斜边如何求？', note: '想用面积理解。', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
  origin: 'vision', sourceLabel: 'AI视觉候选，人工核对', createdAt: '2026-10-06T00:00:00.000Z' });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness({ responder, timeoutMs = 1000, initialQueue, initialSession } = {}) {
  let local = initialQueue; let session = initialSession; let user = { id: 'account-a', username: 'student-a' };
  let epoch = 0; const requests = []; const writes = []; let online = true;
  let running = 0; let maxRunning = 0;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const sync = createSync({ getQueue: async () => local && structuredClone(local), setQueue: async (value) => { local = structuredClone(value); writes.push(local); },
    getSession: async () => session && structuredClone(session), setSession: async (value) => { session = value && structuredClone(value); },
    clientOrigin: origin, validateRecord, timeoutMs, now: () => 1000,
    fetch: async (url, options) => {
      requests.push({ url, options }); running += 1; maxRunning = Math.max(maxRunning, running);
      try {
        if (!online) throw new Error('offline');
        if (responder) { const custom = await responder(url, options, response); if (custom) return custom; }
        if (url.endsWith('/connect')) return response({ token: 't'.repeat(43), user, epoch, expiresAt: 100000 });
        if (url.endsWith('/me')) return response({ user, epoch, expiresAt: 100000 });
        if (url.endsWith('/records')) return response({ records: [record()], epoch });
        if (url.endsWith('/disconnect')) return response({ ok: true });
        return response({ epoch, record: options.body && JSON.parse(options.body).record });
      } finally { running -= 1; }
    }
  });
  return { sync, requests, writes, local: () => local, session: () => session,
    setOnline: (value) => { online = value; }, setEpoch: (value) => { epoch = value; },
    setUser: (value) => { user = value; }, maxRunning: () => maxRunning };
}
test('pairing stores token only in session and returns no credential to UI', async () => {
  const h = harness(); const result = await h.sync.connect('c'.repeat(22), true);
  assert.deepEqual(result, { user: { id: 'account-a', username: 'student-a' }, enabled: true });
  const publicState = await h.sync.snapshot(); assert.equal(publicState.paired, true);
  assert.equal(JSON.stringify(publicState).includes('t'.repeat(43)), false);
  assert.equal(JSON.stringify(h.local()).includes('t'.repeat(43)), false);
  assert.equal(h.session().token, 't'.repeat(43));
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { code: 'c'.repeat(22), clientOrigin: origin });
  assert.equal(h.requests[0].options.credentials, 'omit'); assert.equal(h.requests[0].options.redirect, 'error');
  assert.equal(h.requests[0].options.headers['X-BreakGlass-Client-Origin'], origin);
  assert.equal(h.requests[0].url, ENDPOINT + '/connect');
});
test('unpaired or disabled saves never upload, explicit reviewed import leaves auto setting disabled', async () => {
  const h = harness(); assert.equal((await h.sync.enqueue(record())).syncStatus, 'not-paired');
  await h.sync.connect('c'.repeat(22)); assert.equal((await h.sync.enqueue(record())).syncStatus, 'disabled');
  assert.equal(h.requests.length, 1);
  assert.equal((await h.sync.importRecords([record()])).syncStatus, 'confirmed');
  assert.equal((await h.sync.snapshot()).enabled, false);
  assert.equal(h.requests.length, 3); assert.equal(h.requests[2].options.headers.Authorization, 'Bearer ' + 't'.repeat(43));
});
test('future saves are persisted before one account confirmation, with stable original ID/source', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true);
  const result = await h.sync.enqueue(record()); assert.equal(result.syncStatus, 'confirmed');
  const write = JSON.parse(h.requests[1].options.body); assert.deepEqual(write, { record: record(), expectedEpoch: 0 });
  assert.equal(h.writes.some((value) => value.records.some((r) => r.id === 'record-1')), true);
  assert.equal(h.local().records.length, 0); assert.equal(JSON.stringify(h.local()).includes('image'), false);
});
test('offline failure retains bounded queue without automatic retry, explicit retry checks same epoch', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false);
  assert.equal((await h.sync.enqueue(record())).syncStatus, 'queued');
  assert.equal(h.requests.length, 2); assert.equal(h.local().records.length, 1);
  await tick(); assert.equal(h.requests.length, 2);
  h.setOnline(true); await h.sync.retry();
  assert.equal(h.requests[2].url, ENDPOINT + '/me'); assert.equal(h.requests[3].url, ENDPOINT + '/records/record-1');
  assert.equal(h.local().records.length, 0);
});
test('website deletion epoch invalidates old queue before retry rather than refreshing and resurrecting it', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false);
  await h.sync.enqueue(record()); h.setOnline(true); h.setEpoch(1);
  await assert.rejects(h.sync.retry(), /代次/);
  assert.equal((await h.sync.snapshot()).paired, false); assert.deepEqual(h.local().records, []);
  assert.equal(h.requests.filter((r) => r.options.method === 'PUT').length, 1);
});
test('different account on me invalidates pending queue instead of migrating it', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false);
  await h.sync.enqueue(record()); h.setOnline(true); h.setUser({ id: 'account-b', username: 'student-b' });
  await assert.rejects(h.sync.retry(), /账号/);
  assert.equal(h.local().records.length, 0); assert.equal((await h.sync.snapshot()).paired, false);
});
test('401 and 409 from writes erase token and stale queue while preserving local save responsibility', async () => {
  for (const status of [401, 409]) {
    const h = harness({ responder: async (url, options, response) => options.method === 'PUT' ? response({ error: 'invalid' }, status) : null });
    await h.sync.connect('c'.repeat(22), true);
    assert.equal((await h.sync.enqueue(record())).syncStatus, 'cancelled');
    assert.equal(h.session(), null); assert.deepEqual(h.local().records, []);
  }
});
test('queue limit is 100 and rejects malformed media-bearing records before upload', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false);
  await assert.rejects(h.sync.importRecords(Array.from({ length: 100 }, (_, i) => record('r-' + i))), /offline/);
  await assert.rejects(h.sync.enqueue(record('r-101')), /100/);
  await assert.rejects(h.sync.enqueue({ ...record('bad'), image: 'data:image/jpeg;base64,secret' }), /只保存/);
  assert.equal(h.local().records.length, 100);
});
test('parallel saves and watch share one HTTP lane and do not lose queue records', async () => {
  const h = harness({ responder: async () => { await tick(); return null; } });
  await h.sync.connect('c'.repeat(22), true);
  const binding = await h.sync.snapshot();
  await Promise.all([h.sync.enqueue(record('r-1'), binding), h.sync.enqueue(record('r-2'), binding),
    h.sync.watch({ source, time: 3, duration: 12 }, binding)]);
  assert.equal(h.maxRunning(), 1); assert.equal(h.local().records.length, 0);
  assert.deepEqual(h.requests.filter((r) => r.url.includes('/records/')).map((r) => JSON.parse(r.options.body).record.id), ['r-1', 'r-2']);
  assert.equal(h.requests.some((r) => r.url.includes('/watch/')), true);
});
test('clear aborts pending write and late response cannot report confirmation or restore queue', async () => {
  let release; let started;
  const begun = new Promise((resolve) => { started = resolve; });
  const h = harness({ responder: (url, options, response) => {
    if (options.method !== 'PUT') return null;
    started(); return new Promise((resolve) => { release = () => resolve(response({ epoch: 0 })); });
  } });
  await h.sync.connect('c'.repeat(22), true); const saving = h.sync.enqueue(record()); await begun;
  await h.sync.clearPending(); release();
  assert.equal((await saving).syncStatus, 'cancelled'); assert.equal(h.local().records.length, 0);
  assert.equal((await h.sync.snapshot()).paired, true);
});
test('record saved across a new pairing cannot be attached to the replacement account', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); const old = await h.sync.snapshot();
  h.setUser({ id: 'account-b', username: 'student-b' }); await h.sync.connect('d'.repeat(22), true);
  assert.equal((await h.sync.enqueue(record(), old)).syncStatus, 'cancelled');
  assert.equal(h.requests.filter((r) => r.options.method === 'PUT').length, 0);
});
test('disconnect clears session and queued records without deleting either server or local source records', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false); await h.sync.enqueue(record());
  h.setOnline(true); await h.sync.disconnect();
  assert.equal(h.session(), null); assert.deepEqual(h.local().records, []);
  assert.equal(h.requests.at(-1).url, ENDPOINT + '/disconnect');
  assert.equal(h.requests.some((r) => r.options.method === 'DELETE'), false);
});
test('timeout cancels the request once and retains queue for explicit retry', async () => {
  const h = harness({ timeoutMs: 10, responder: (url, options) => {
    if (options.method !== 'PUT') return null;
    return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => {
      const error = new Error('timeout'); error.name = 'AbortError'; reject(error);
    }, { once: true }); });
  } });
  await h.sync.connect('c'.repeat(22), true);
  assert.equal((await h.sync.enqueue(record())).syncStatus, 'queued');
  assert.equal(h.requests.length, 2); assert.equal(h.local().records.length, 1);
  assert.match((await h.sync.snapshot()).message, /超时/);
});
test('restart without session never replays persisted queue to a new pairing', async () => {
  const h = harness({ initialQueue: { schemaVersion: 1, accountId: 'account-a', epoch: 0, records: [record()] } });
  assert.equal((await h.sync.snapshot()).paired, false);
  await assert.rejects(h.sync.retry(), /失效/); assert.equal(h.requests.length, 0);
  h.setUser({ id: 'account-b', username: 'student-b' }); await h.sync.connect('c'.repeat(22), true);
  assert.deepEqual(h.local().records, []); assert.equal(h.requests.length, 1);
});
test('disabling auto sync succeeds offline and future saves do not enter queue', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false);
  await h.sync.enable(false); assert.equal(h.session().enabled, false);
  assert.equal((await h.sync.enqueue(record())).syncStatus, 'disabled');
  assert.equal(h.requests.length, 1); assert.deepEqual(h.local().records, []);
});
test('failed replacement pairing cannot continue using the old account token or old queue', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false); await h.sync.enqueue(record());
  await assert.rejects(h.sync.connect('d'.repeat(22), true), /offline/);
  assert.equal(h.session(), null); assert.deepEqual(h.local().records, []);
  assert.equal((await h.sync.enqueue(record('new'))).syncStatus, 'not-paired');
});
test('same record ID with different content is rejected rather than confirming the old content', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false); await h.sync.enqueue(record());
  await assert.rejects(h.sync.enqueue({ ...record(), note: '替换内容' }), /冲突/);
  assert.equal(h.local().records[0].note, record().note);
});
test('new save and watch events never automatically retry a failed older queue item', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); const binding = await h.sync.snapshot();
  h.setOnline(false); await h.sync.enqueue(record('old')); h.setOnline(true);
  const count = h.requests.length;
  assert.equal((await h.sync.enqueue(record('new'))).syncStatus, 'queued');
  assert.equal((await h.sync.watch({ source, time: 4, duration: 12 }, binding)).watchAccepted, false);
  assert.equal(h.requests.length, count); assert.equal(h.local().records.length, 2);
  await h.sync.retry(); assert.equal(h.local().records.length, 0);
});
test('rehydrated session queue requires an explicit epoch check before any replay', async () => {
  const h = harness({ initialQueue: { schemaVersion: 1, accountId: 'account-a', epoch: 0, records: [record()], retryRequired: false },
    initialSession: { token: 't'.repeat(43), user: { id: 'account-a', username: 'student-a' }, epoch: 0, expiresAt: 100000, enabled: true } });
  assert.equal((await h.sync.snapshot()).retryRequired, true);
  await h.sync.enqueue(record('new')); assert.equal(h.requests.length, 0);
  await h.sync.retry(); assert.equal(h.requests[0].url, ENDPOINT + '/me'); assert.equal(h.local().records.length, 0);
});
test('watch-only network failure can be restarted by a fresh explicit playback without trapping an empty record queue', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); const binding = await h.sync.snapshot();
  h.setOnline(false); const missed = await h.sync.watch({ source, time: 4, duration: 12 }, binding);
  assert.equal(missed.watchConfirmed, false); assert.equal(h.local().retryRequired, false);
  h.setOnline(true); const completed = await h.sync.watch({ source, time: 5, duration: 12 }, binding);
  assert.equal(completed.watchConfirmed, true);
});
test('reviewed import confirms the same account epoch and sends only the chosen IDs, leaving older failed items paused', async () => {
  const h = harness(); await h.sync.connect('c'.repeat(22), true); h.setOnline(false); await h.sync.enqueue(record('old'));
  h.setOnline(true); const count = h.requests.length;
  const result = await h.sync.importRecords([record('chosen')]); assert.equal(result.syncStatus, 'confirmed');
  assert.deepEqual(h.requests.slice(count).map((r) => r.url), [ENDPOINT + '/me', ENDPOINT + '/records/chosen']);
  assert.deepEqual(h.local().records.map((r) => r.id), ['old']); assert.equal(h.local().retryRequired, true);
});
