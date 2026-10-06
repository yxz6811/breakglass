const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../learning-site/records');
const source = { kind: 'manual-notes', id: `manual-file-${'a'.repeat(64)}`, version: '1', analysisVersion: '1', materialMode: 'self-authored', title: '我输入的条件' };
const input = () => ({ id: 'record-1', kind: 'pitfall', source, time: 3, title: '两条直角边', note: '提醒我不要相加。',
  template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'manual', sourceLabel: '学生手工条件', createdAt: '2026-10-06T00:00:00.000Z' });
function harness() {
  const values = new Map(); let serial = 0; let stamp = 0;
  return api.createLocalStore({ getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    { id: () => `attempt-${++serial}`, now: () => new Date(Date.UTC(2026, 9, 6, 0, 0, ++stamp)).toISOString() });
}
test('personal pitfalls stay distinct from actual wrong answers and hints never count as independent', () => {
  const store = harness(); const record = store.save(input());
  assert.equal(api.filterRecords(store.read().records, [], { kind: 'wrong' }).length, 0);
  assert.equal(api.learningState(record, []), '待验证');
  const wrong = store.attempt(record.id, 7, false); assert.equal(wrong.outcome, 'wrong');
  assert.equal(api.filterRecords(store.read().records, store.read().attempts, { kind: 'wrong' }).length, 1);
  assert.equal(api.learningState(record, store.read().attempts), '需要复练');
  store.attempt(record.id, 5, true); assert.equal(api.learningState(record, store.read().attempts), '使用提示完成');
  store.attempt(record.id, 5, false); assert.equal(api.learningState(record, store.read().attempts), '最近一次独立正确');
  assert.equal(store.read().records[0].kind, 'pitfall');
});
test('idempotent imports are atomic; conflicting ids and stale clear epochs do not write', () => {
  const store = harness(); const record = input();
  assert.deepEqual(store.merge([record, record]), { added: 1, skipped: 1 });
  assert.throws(() => store.merge([{ ...record, id: 'record-2' }, { ...record, note: '同ID不同内容' }]), /冲突/);
  assert.equal(store.read().records.length, 1);
  store.clear(); assert.throws(() => store.save(record, 0), /已清除/); assert.equal(store.read().records.length, 0);
});
test('minimal local data rejects media, malformed answers, false manual AI origins and invalid mathematics', () => {
  const store = harness(); const record = store.save(input());
  assert.throws(() => store.save({ ...input(), frame: 'data:image/jpeg;base64,private' }), /规定/);
  assert.throws(() => store.save({ ...input(), note: 'https://private.example/course' }), /地址/);
  assert.throws(() => store.save({ ...input(), origin: 'vision' }), /冒充/);
  assert.throws(() => store.attempt(record.id, NaN, false), /有限/);
  assert.throws(() => api.expectedAnswer({ template: 'parabola', snapshot: { a: 0, h: 0, k: 1 } }), /无效/);
  assert.equal(JSON.stringify(store.read()).includes('data:image'), false);
});
test('file recovery is fingerprint-bound and the parabola vertex uses actual signed h/k', () => {
  assert.equal(api.fileId(source), `file-${'a'.repeat(64)}`);
  assert.equal(api.fileId({ kind: 'visual-session', id: 'same-title' }), null);
  const parabola = { template: 'parabola', snapshot: { a: -2, h: -3, k: 4 } };
  assert.equal(api.judge(parabola, { h: -3, k: 4 }), true);
  assert.equal(api.judge(parabola, { h: 3, k: 4 }), false);
});
test('guest and account decisions agree at small-triangle and large signed-vertex tolerance boundaries', async () => {
  const backend = await import('../breakglass-learning/src/validation.mjs');
  const triangle = { template: 'right-triangle', snapshot: { AB: 3e-4, AC: 4e-4, unit: 'cm' } };
  const parabola = { template: 'parabola', snapshot: { a: -2, h: -1e5, k: 3e5 } };
  for (const [record, answers] of [[triangle, [5e-4, 5e-4 + 0.9e-9, 5e-4 + 1.1e-9, 5e-4 + 5e-7]],
    [parabola, [{ h: -1e5, k: 3e5 }, { h: -1e5 + 5e-10, k: 3e5 }, { h: -1e5 + 2e-9, k: 3e5 }, { h: -1e5, k: 3e5 + 0.1 }]]]) {
    for (const answer of answers) assert.equal(api.judge(record, answer), backend.judge(record.template, record.snapshot, answer).correct);
  }
  const store = harness(); const record = store.save(input());
  assert.equal(store.attempt(record.id, 5, true).outcome, 'correct_with_hint');
  assert.equal(store.attempt(record.id, 5, false).outcome, 'correct_independent');
});
test('private pending-permission watch metadata is valid without granting AI or record-content permission', () => {
  const store = harness();
  const pending = { kind: 'local-file', id: `file-${'b'.repeat(64)}`, version: '1', analysisVersion: '1', materialMode: 'permission-pending', title: '我的本地课程' };
  store.saveWatch({ source: pending, time: 4, duration: 12 });
  assert.equal(store.read().watch[0].source.materialMode, 'permission-pending');
  assert.equal(store.read().records.length, 0);
  assert.throws(() => store.save({ ...input(), source: pending }), /来源/);
  assert.throws(() => store.saveWatch({ source: { ...pending, id: 'https://private' }, time: 4, duration: 12 }), /来源/);
  assert.throws(() => store.saveWatch({ source: pending, time: 4, duration: 12, image: 'private' }), /结构/);
});
test('plugin package import keeps source/id and rejects misleading flags, extra media and oversized files', () => {
  const plugin = { ...input(), source: { ...source, kind: 'visual-session', id: 'pilot-triangle-3-4-5' }, origin: 'vision' };
  const pack = { schemaVersion: '1', origin: 'breakglass-plugin', aiGeneratedContentPresent: true, records: [plugin] };
  assert.equal(api.parsePluginPackage(JSON.stringify(pack))[0].id, plugin.id);
  assert.throws(() => api.parsePluginPackage(JSON.stringify({ ...pack, aiGeneratedContentPresent: false })), /标识/);
  assert.throws(() => api.parsePluginPackage(JSON.stringify({ ...pack, records: [{ ...plugin, frame: 'private' }] })));
  assert.throws(() => api.parsePluginPackage('a'.repeat(256 * 1024 + 1)), /256/);
});
test('shared record contract preserves author fixtures and rejects fields before canonical copying', () => {
  const author = { ...input(), source: { ...source, kind: 'creator-layer', id: 'author-fixture', version: 'v2' }, origin: 'author', sourceLabel: '作者知识层' };
  const pack = { schemaVersion: '1', origin: 'breakglass-plugin', aiGeneratedContentPresent: false, records: [author] };
  assert.deepEqual(api.parsePluginPackage(JSON.stringify(pack)), [author]);
  assert.throws(() => api.validateRecord({ ...author, createdAt: 'October 6, 2026' }), /ISO/);
  assert.throws(() => api.validateRecord({ ...author, source: { ...author.source, media: 'private' } }), /来源/);
  assert.throws(() => api.validateRecord({ ...author, snapshot: { ...author.snapshot, rawFrame: 'private' } }), /三角形/);
  assert.throws(() => api.validateRecord({ ...author, source: { ...author.source, kind: 'manual-notes', id: 'manual-file-invalid' }, origin: 'manual' }), /来源/);
});
