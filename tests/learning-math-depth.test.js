const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const math = require('../learning-site/math-learning');
const records = require('../learning-site/records');
const pedagogy = require('../learning-site/pedagogy');
const contracts = require('../extension/src/plugin/contracts');
const TIME = '2026-10-07T00:00:00.000Z';
const UUID = 'f3caac22-2ae5-4d7d-a284-843a30658a72';
const input = (template) => ({ id: `record-${template}`, kind: 'question', source: { kind: 'manual-notes', id: `study-${template}`,
  version: '1', analysisVersion: '1', materialMode: 'self-authored', title: '我的手工条件' }, time: 0,
  title: math.templateInfo(template).title, note: '我主动保存的条件。', template, snapshot: math.templateInfo(template).defaults,
  origin: 'manual', sourceLabel: '学生手工条件；程序计算，非视频识别', createdAt: TIME });
function storeHarness() {
  const values = new Map(); let index = 0;
  return records.createLocalStore({ getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    { id: () => `attempt-${++index}`, now: () => new Date(Date.parse(TIME) + index * 1000).toISOString() });
}

test('five manual templates have strict mathematical conditions and parameter budgets', () => {
  for (const template of math.TEMPLATE_IDS) {
    const snapshot = math.templateInfo(template).defaults;
    assert.equal(math.validateSnapshot(template, snapshot).ok, true);
    assert.equal(math.validateSnapshot(template, { ...snapshot, code: 'alert(1)' }).ok, false);
    for (const field of math.templateInfo(template).fields) {
      for (const bad of [NaN, Infinity, -Infinity, '1', field.min - 1, field.max + 1]) {
        assert.equal(math.validateSnapshot(template, { ...snapshot, [field.key]: bad }).ok, false);
      }
    }
    const getter = { ...snapshot }; let reads = 0;
    Object.defineProperty(getter, Object.keys(snapshot)[0], { enumerable: true, get() { reads += 1; return 1; } });
    assert.equal(math.validateSnapshot(template, getter).ok, false); assert.equal(reads, 0);
    assert.equal(math.validateSnapshot(template, Object.assign(Object.create({ secret: 'private' }), snapshot)).ok, false);
  }
  assert.equal(math.validateSnapshot('similar-triangles', { a: 1, b: 2, c: 3, scale: 2, unit: 'cm' }).ok, false);
  assert.equal(math.validateSnapshot('similar-triangles', { a: 1, b: 2, c: 2.9999999, scale: 2, unit: 'cm' }).ok, false);
  assert.equal(math.validateSnapshot('similar-triangles', { a: 2, b: 2, c: 3, scale: 2, unit: 'cm' }).ok, true);
  assert.equal(math.validateSnapshot('cuboid', { length: 1, width: 2, height: 3, unit: 'https://private' }).ok, false);
});

test('answers are deterministic and physical concepts do not depend on irrelevant parameters', async () => {
  const backend = await import('../breakglass-learning/src/validation.mjs');
  const expected = { line: 1, circle: 9 * Math.PI, sine: 2 * Math.PI, 'similar-triangles': 4, cuboid: 24 };
  for (const template of math.TEMPLATE_IDS) {
    const record = input(template); const value = expected[template];
    assert.equal(records.expectedAnswer(record), value);
    for (const answer of [value, value + Math.max(1e-9, Math.abs(value) * 1e-6) * 0.9,
      value + Math.max(1e-9, Math.abs(value) * 1e-6) * 1.1, value + 1, NaN, '1', {}]) {
      assert.equal(records.judge(record, answer), math.judge(template, record.snapshot, answer)?.correct === true);
      assert.deepEqual(backend.judge(template, record.snapshot, answer), math.judge(template, record.snapshot, answer));
    }
  }
  assert.equal(math.expectedAnswer('line', { m: -20, b: -3 }), -3);
  assert.equal(math.expectedAnswer('circle', { h: 20, k: -20, r: 3 }), 9 * Math.PI);
  assert.equal(math.expectedAnswer('sine', { A: 10, omega: 1, phi: 2 * Math.PI, k: 20 }), 2 * Math.PI);
  assert.equal(math.expectedAnswer('similar-triangles', { a: 2, b: 3, c: 4, scale: 2, unit: 'm' }), 4);
});

test('manual templates save and produce real answer receipts while video recognition remains two-template-only', () => {
  const store = storeHarness();
  for (const template of math.TEMPLATE_IDS) {
    const record = input(template); assert.deepEqual(contracts.validateRecord(record, { source: record.source, duration: 600 }).value, record);
    store.save(record); assert.equal(store.attempt(record.id, records.expectedAnswer(record) + 1, false).outcome, 'wrong');
    assert.equal(store.attempt(record.id, records.expectedAnswer(record), true).outcome, 'correct_with_hint');
    assert.equal(store.attempt(record.id, records.expectedAnswer(record), false).outcome, 'correct_independent');
    const source = { ...record.source, kind: 'visual-session' };
    for (const origin of ['vision', 'manual']) assert.equal(contracts.validateRecord({ ...record, source, origin }, { source, duration: 600 }).ok, false);
    assert.equal(contracts.validateVisualResult({ schemaVersion: '1', template, snapshot: record.snapshot,
      area: null, title: record.title, explanation: '候选解释', pitfallHint: '' }).ok, false);
    assert.equal(contracts.validatePoints([{ id: 'new-point', start: 0, end: 1, area: null, title: record.title,
      explanation: '手工条件', template, snapshot: record.snapshot, origin: 'manual', sourceLabel: record.sourceLabel }], { source: record.source, duration: 600 }).ok, false);
  }
  assert.equal(store.read().records.length, 5); assert.equal(store.read().attempts.length, 15);
});

test('predictions, progressive hints and twenty independent variants follow actual parameter mathematics', () => {
  for (const template of math.TEMPLATE_IDS) {
    const original = input(template); const before = structuredClone(original);
    assert.equal(pedagogy.hints(original).length, 3);
    const prediction = pedagogy.prediction(original); assert.equal(records.validSnapshot(template, prediction.snapshot), true);
    const oldAnswer = records.expectedAnswer(original), newAnswer = math.expectedAnswer(template, prediction.snapshot);
    assert.equal(prediction.correct, newAnswer === oldAnswer ? 'same' : newAnswer > oldAnswer ? 'increase' : 'decrease');
    const conditions = new Set();
    for (let index = 1; index <= 20; index += 1) {
      const variant = pedagogy.createVariant(original, { id: UUID, now: TIME, index });
      assert.equal(variant.origin, 'manual'); assert.equal(variant.source.kind, 'manual-notes');
      assert.notEqual(records.expectedAnswer(variant), oldAnswer); assert.equal(records.judge(variant, records.expectedAnswer(variant)), true);
      conditions.add(JSON.stringify(variant.snapshot)); assert.notEqual(variant.id, original.id);
    }
    assert.equal(conditions.size, 20); assert.deepEqual(original, before);
    for (const field of math.templateInfo(template).fields) {
      for (const value of [field.min, field.max]) {
        const edge = { ...original.snapshot, [field.key]: value };
        if (math.validateSnapshot(template, edge).ok) assert.equal(math.validateSnapshot(template, math.prediction(template, edge).snapshot).ok, true);
      }
    }
  }
});

test('graphs only use actual judged answers, distinguish diagnostic receipts and show unknown states', () => {
  const record = { ...input('line'), source: { ...input('line').source, id: 'diagnostic-linear-intercept-test' } };
  const unknown = math.learningGraph({ records: [record], attempts: [], watch: [{ time: 600 }] });
  assert.ok(unknown.every((item) => item.state === '待验证'));
  const receipt = { id: 'attempt-1', recordId: record.id, answer: 1, hintUsed: false, correct: true, outcome: 'correct_independent', createdAt: TIME };
  const get = (attempt) => math.learningGraph({ records: [record], attempts: [attempt] }).find((n) => n.template === 'line');
  assert.equal(get(receipt).state, '最近一次独立正确'); assert.equal(get(receipt).diagnosticCount, 1); assert.equal(get(receipt).practiceCount, 0);
  assert.equal(get({ ...receipt, hintUsed: true, outcome: 'correct_with_hint' }).state, '使用提示完成');
  assert.equal(get({ ...receipt, answer: 2, correct: false, outcome: 'wrong' }).state, '需要复练');
  for (const invalid of [{ ...receipt, answer: 2 }, { ...receipt, hintUsed: true }, { ...receipt, createdAt: '2026-02-30T00:00:00.000Z' },
    { ...receipt, recordId: 'unrelated' }]) assert.equal(get(invalid).state, '待验证');
  assert.equal(get(receipt).prerequisites[0], 'coordinate-vertex');
});

test('hint fading and review suggestions respond to independent history and reset after help or errors', () => {
  const store = storeHarness(); const record = store.save(input('line'));
  assert.equal(math.historyPlan(record, []).days, null); assert.equal(records.nextReview([], record.id), null);
  const now = () => Date.parse(store.read().attempts.at(-1).createdAt);
  const plan = () => math.historyPlan(record, store.read().attempts);
  store.attempt(record.id, 1, false); assert.equal(plan().days, 7); assert.equal(plan().suggestedHintCount, 3);
  store.attempt(record.id, 1, false); assert.equal(plan().days, 14); assert.equal(plan().suggestedHintCount, 1);
  assert.equal(Date.parse(records.nextReview(store.read().attempts, record.id)), now() + 14 * 86400000);
  store.attempt(record.id, 1, false); assert.equal(plan().days, 28);
  store.attempt(record.id, 1, true); assert.equal(plan().days, 3); assert.equal(plan().suggestedHintCount, 3);
  store.attempt(record.id, 2, false); assert.equal(plan().days, 1); assert.equal(plan().independentStreak, 0);
});

test('deterministic SVG contains finite program geometry and browser modules match server mathematics', () => {
  for (const template of math.TEMPLATE_IDS) {
    const svg = math.sceneSVG(template, input(template).snapshot); assert.match(svg, /^<svg/); assert.match(svg, /role="img"/);
    assert.doesNotMatch(svg, /NaN|Infinity|onload|<script|foreignObject/); assert.match(svg, /<path/);
    assert.equal(svg, math.sceneSVG(template, input(template).snapshot));
  }
  const sandbox = { crypto: { randomUUID: () => UUID }, Date }; vm.createContext(sandbox);
  for (const file of ['../extension/src/curve/evaluate', '../extension/src/geometry-scene/validate', '../extension/src/plugin/math-learning',
    '../extension/src/plugin/contracts', '../learning-site/records', '../learning-site/pedagogy']) vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), sandbox);
  sandbox.recordJSON = JSON.stringify(input('cuboid'));
  assert.equal(vm.runInContext('BreakGlass.webRecords.expectedAnswer(JSON.parse(recordJSON))', sandbox), 24);
  assert.equal(vm.runInContext('BreakGlass.pedagogy.createVariant(JSON.parse(recordJSON)).template', sandbox), 'cuboid');
  assert.equal(vm.runInContext('BreakGlass.pluginContracts.validateVisualResult({schemaVersion:"1",template:"line",snapshot:{m:1,b:2},area:null,title:"直线",explanation:"说明",pitfallHint:""}).ok', sandbox), false);
});
