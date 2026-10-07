const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecordStore } = require('../extension/src/plugin/record-store');
const { validateRecord } = require('../extension/src/plugin/contracts');
const { sourceFor, lessons } = require('../extension/src/plugin/registry');
const source = sourceFor(lessons[0]);
const input = () => ({ kind: 'question', source, time: 4, title: '为什么斜边不是两边相加？', note: '想用图形面积理解。',
  template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'vision', sourceLabel: 'AI视觉候选，人工核对' });
function harness() {
  let state; let seq = 0;
  return createRecordStore({ get: async () => state && structuredClone(state), set: async (next) => { state = structuredClone(next); },
    validate: validateRecord, id: () => `record-${++seq}`, now: () => '2026-10-06T00:00:00.000Z' });
}
test('only minimal structured student records are persisted', async () => {
  const store = harness(); const saved = await store.save(input(), 0, { source, duration: 12 });
  assert.equal(saved.kind, 'question'); assert.equal(saved.snapshot.AB, 3);
  assert.equal(JSON.stringify(saved).includes('data:image'), false);
  await assert.rejects(store.save({ ...input(), frame: 'data:image/jpeg;base64,secret' }, 0, { source, duration: 12 }));
  const listed = await store.list(); listed.records[0].snapshot.AB = 999;
  assert.equal((await store.list()).records[0].snapshot.AB, 3);
});
test('clear is ordered with pending saves and rejects old-session write-back', async () => {
  const store = harness();
  const first = store.save(input(), 0, { source, duration: 12 });
  const clearing = store.clear();
  const late = store.save(input(), 0, { source, duration: 12 });
  await first; assert.equal(await clearing, 1); await assert.rejects(late, /清除/);
  assert.deepEqual((await store.list()).records, []);
  await store.save(input(), 1, { source, duration: 12 });
  assert.equal((await store.list()).records.length, 1);
});
test('pending rights and mismatched video version do not create records', async () => {
  const store = harness();
  await assert.rejects(store.save({ ...input(), source: { ...source, materialMode: 'permission-pending' } }, 0, { source, duration: 12 }));
  await assert.rejects(store.save({ ...input(), source: { ...source, version: '2' } }, 0, { source, duration: 12 }));
  assert.equal((await store.list()).records.length, 0);
});
test('clear recovers a corrupt record schema and invalidates its old epoch', async () => {
  let raw = { schemaVersion: 0, epoch: 7, records: 'corrupted' };
  const store = createRecordStore({ get: async () => raw, set: async (state) => { raw = state; }, validate: validateRecord });
  await assert.rejects(store.list(), /格式异常/);
  assert.equal(await store.clear(), 8);
  await assert.rejects(store.save(input(), 7, { source, duration: 12 }), /清除/);
  assert.deepEqual((await store.list()).records, []);
});
