const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto').webcrypto;
const pluginContracts = require('../extension/src/plugin/contracts');
const pluginRegistry = require('../extension/src/plugin/registry');
const pluginRecords = require('../extension/src/plugin/record-store');
const pluginAccountSync = require('../extension/src/plugin/account-sync');
const extensionId = 'a'.repeat(32);
const authToken = 'secret_token_'.padEnd(43, 'x');
const ownSender = { id: extensionId, url: 'chrome-extension://' + extensionId + '/plugin/status.html' };
const contentSender = { id: extensionId, url: 'http://localhost:4173/learning-lab/lesson.html',
  tab: { id: 1 }, frameId: 0, documentId: 'document-1' };
function setup() {
  const local = {}; const session = {}; const requests = []; const notifications = []; const accessLevels = [];
  let listener;
  function storage(target) {
    return { setAccessLevel: async (value) => { accessLevels.push(value); },
      get: async (keys) => keys === null ? structuredClone(target) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(target[key])])),
      set: async (value) => { Object.assign(target, structuredClone(value)); },
      remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete target[key]; },
      clear: async () => { for (const key of Object.keys(target)) delete target[key]; } };
  }
  const chrome = { storage: { local: storage(local), session: storage(session) },
    runtime: { id: extensionId, getURL: (relative) => 'chrome-extension://' + extensionId + '/' + relative,
      onMessage: { addListener: (fn) => { listener = fn; } } },
    tabs: { get: async () => ({ url: contentSender.url, active: true }),
      sendMessage: async (...args) => { notifications.push(args); }, create: async () => {},
      onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } },
    action: { onClicked: { addListener: () => {} } } };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    let body = { epoch: 0 };
    if (url.endsWith('/connect')) body = { token: authToken, user: { id: 'account-a', username: 'student-a' }, epoch: 0, expiresAt: Date.now() + 60000 };
    if (url.endsWith('/me')) body = { user: { id: 'account-a', username: 'student-a' }, epoch: 0, expiresAt: Date.now() + 60000 };
    if (url.endsWith('/records')) body = { records: [], epoch: 0 };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/background/service-worker.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, { chrome, fetch, crypto, AbortSignal, AbortController, TextDecoder, Date, setTimeout,
    clearTimeout, structuredClone, BreakGlass: { pluginContracts: { ...pluginContracts,
      validateRecord: (value, expected) => pluginContracts.validateRecord(structuredClone(value), structuredClone(expected)) },
      pluginRegistry, pluginRecords, pluginAccountSync } });
  const send = (message, sender = ownSender) => new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });
  return { local, session, requests, notifications, accessLevels, send };
}
test('background only allows packaged status pages to pair or access account records', async () => {
  const h = setup();
  const blocked = await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: true }, contentSender);
  assert.equal(blocked.ok, false); assert.equal(h.requests.length, 0);
  const wrongId = await h.send({ type: 'plugin:account:state' }, { ...ownSender, id: 'b'.repeat(32) });
  assert.equal(wrongId.ok, false);
  const result = await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: true });
  assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes(authToken), false);
  assert.equal(h.session.pluginPairedAccountV1.token, authToken);
  assert.equal(JSON.stringify(h.local).includes(authToken), false);
  assert.deepEqual(structuredClone(h.accessLevels), [{ accessLevel: 'TRUSTED_CONTEXTS' }, { accessLevel: 'TRUSTED_CONTEXTS' }]);
  const state = await h.send({ type: 'plugin:account:state' }); assert.equal(JSON.stringify(state).includes(authToken), false);
});
test('saving controlled student records preserves local ID before authenticated account write', async () => {
  const h = setup(); await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: true });
  const begun = await h.send({ type: 'plugin:begin', lessonId: pluginRegistry.lessons[0].id }, contentSender);
  const record = { kind: 'question', source: begun.source, time: 3, title: '如何求斜边？', note: '想用面积理解。',
    template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'vision', sourceLabel: 'AI视觉候选，已核对' };
  const saved = await h.send({ type: 'plugin:save', token: begun.token, record }, contentSender);
  assert.equal(saved.ok, true, JSON.stringify(saved)); assert.equal(saved.storage, 'local'); assert.equal(saved.syncStatus, 'confirmed');
  assert.equal(JSON.stringify(saved).includes(authToken), false);
  const stored = h.local.pluginLearningRecordsV1.records[0]; assert.equal(stored.id, saved.id);
  const write = h.requests.find((r) => r.options.method === 'PUT');
  assert.deepEqual(JSON.parse(write.options.body).record, stored);
  assert.equal(write.options.headers.Authorization, 'Bearer ' + authToken);
  assert.equal(write.options.credentials, 'omit'); assert.equal(write.options.redirect, 'error');
});
test('local clearing cancels pending sync and notifies visual session without deleting account data', async () => {
  const h = setup(); await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: true });
  const begun = await h.send({ type: 'plugin:begin', lessonId: pluginRegistry.lessons[0].id }, contentSender);
  const result = await h.send({ type: 'plugin:clear' }); assert.equal(result.ok, true);
  assert.equal(h.session.pluginPairedAccountV1.token, authToken); assert.equal(h.session['visualSession:1'], undefined);
  assert.deepEqual(h.local.pluginLearningRecordsV1.records, []); assert.deepEqual(h.local.pluginAccountQueueV1.records, []);
  assert.equal(h.notifications.length, 1); assert.equal(h.notifications[0][1].token, begun.token);
  assert.equal(h.requests.some((r) => r.options.method === 'DELETE'), false);
  const late = await h.send({ type: 'plugin:watch', token: begun.token, time: 3 }, contentSender); assert.equal(late.ok, false);
});
test('controlled watch metadata stays minimal and unrelated content cannot select a different source', async () => {
  const h = setup(); await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: true });
  const begun = await h.send({ type: 'plugin:begin', lessonId: pluginRegistry.lessons[0].id }, contentSender);
  const watch = await h.send({ type: 'plugin:watch-begin', lessonId: pluginRegistry.lessons[0].id }, contentSender);
  const result = await h.send({ type: 'plugin:watch', token: watch.token, time: 4, source: { id: 'other' } }, contentSender);
  assert.equal(result.ok, true);
  const write = h.requests.find((r) => r.url.includes('/watch/'));
  assert.deepEqual(JSON.parse(write.options.body), { source: begun.source, time: 4, duration: 12, expectedEpoch: 0 });
  const invalid = await h.send({ type: 'plugin:watch', token: watch.token, time: 13 }, contentSender); assert.equal(invalid.ok, false);
  const unrelated = await h.send({ type: 'plugin:watch', token: watch.token, time: 4 }, { ...contentSender, url: 'https://www.bilibili.com/video/abc' });
  assert.equal(unrelated.ok, false); assert.equal(h.requests.filter((r) => r.url.includes('/watch/')).length, 1);
});
test('old guest import only accepts selected existing local IDs, never content-supplied records', async () => {
  const h = setup(); await h.send({ type: 'plugin:account:connect', code: 'c'.repeat(22), enabled: false });
  const absent = await h.send({ type: 'plugin:account:import', ids: ['not-in-local'] }); assert.equal(absent.ok, false);
  const content = await h.send({ type: 'plugin:account:import', ids: ['record-1'] }, contentSender); assert.equal(content.ok, false);
  assert.equal(h.requests.filter((r) => r.options.method === 'PUT').length, 0);
});
