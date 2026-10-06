const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const pedagogy = require('../learning-site/pedagogy');
const records = require('../learning-site/records');
const geometry = require('../extension/src/geometry-scene/validate');
const curve = require('../extension/src/curve/evaluate');
const TIME = '2026-10-06T00:00:00.000Z';
const NEW_ID = 'b7b025b0-56d3-4a33-af50-45b8b94a8918';
const input = (template = 'right-triangle', snapshot) => ({ id: 'original-record', kind: 'pitfall',
  source: { kind: 'local-file', id: `file-${'a'.repeat(64)}`, version: '1', analysisVersion: '1',
    materialMode: 'self-authored', title: '受控自制素材' }, time: 3,
  title: '已核对的数学条件', note: '我容易忽略条件。', template,
  snapshot: snapshot || (template === 'right-triangle' ? { AB: 3, AC: 4, unit: 'cm' } : { a: -2, h: -3, k: 4 }),
  origin: 'vision', sourceLabel: 'AI候选，学生已核对', createdAt: TIME });

test('三层提示由思路到关系和代入，不直接给出斜边或顶点结果', () => {
  const triangle = pedagogy.hints(input()); assert.equal(triangle.length, 3);
  assert.match(triangle[0], /直角/); assert.match(triangle[1], /BC²=AB²\+AC²/);
  assert.match(triangle[2], /\(3\)²\+\(4\)²/); assert.doesNotMatch(triangle.join(''), /BC\s*=\s*5|BC为5/);
  const parabola = pedagogy.hints(input('parabola')); assert.equal(parabola.length, 3);
  assert.match(parabola[0], /平方项/); assert.match(parabola[1], /h影响左右/);
  assert.match(parabola[2], /设为零/); assert.doesNotMatch(parabola.join(''), /顶点[:：是为].*\(-3.*4/);
});

test('预测变更使用实际数学：AB增且AC不变使BC增加，h加1使顶点右移', () => {
  const original = input(); const before = structuredClone(original);
  const result = pedagogy.prediction(original);
  assert.equal(result.correct, 'increase'); assert.equal(result.options.length, 3);
  assert.equal(result.snapshot.AB, 4); assert.equal(result.snapshot.AC, 4);
  assert.ok(Math.hypot(result.snapshot.AB, result.snapshot.AC) > records.expectedAnswer(original));
  assert.equal(records.validSnapshot(original.template, result.snapshot), true);
  const p = input('parabola'); const predicted = pedagogy.prediction(p);
  assert.equal(predicted.correct, 'right'); assert.deepEqual(predicted.snapshot, { a: -2, h: -2, k: 4 });
  const definition = { equationId: 'fixture.parabola' };
  for (const x of [-5, 0, 4]) {
    assert.equal(curve.evaluateWithParameters(definition, predicted.snapshot, x + 1), curve.evaluateWithParameters(definition, p.snapshot, x));
  }
  result.snapshot.AB = 40; assert.deepEqual(original, before);
});

test('变式返回独立严格v1记录，新的非AI手工来源可保存且不得覆盖原题', () => {
  const original = input(); const before = structuredClone(original);
  const variant = pedagogy.createVariant(original, { id: NEW_ID, now: TIME });
  assert.equal(variant.id, NEW_ID); assert.equal(variant.kind, 'question'); assert.equal(variant.time, 0);
  assert.deepEqual(variant.source, { kind: 'manual-notes', id: `variant-${NEW_ID}`, version: '1', analysisVersion: '1',
    materialMode: 'self-authored', title: '程序生成变式' });
  assert.equal(variant.origin, 'manual'); assert.match(variant.sourceLabel, /非AI.*original-record/);
  assert.ok(variant.sourceLabel.length <= 120); assert.deepEqual(records.validateRecord(variant), variant);
  assert.ok(variant.snapshot.AB > original.snapshot.AB); assert.equal(variant.snapshot.AC, original.snapshot.AC);
  assert.notEqual(records.expectedAnswer(variant), records.expectedAnswer(original));
  assert.deepEqual(original, before); variant.source.title = 'changed'; variant.snapshot.AB = 999;
  assert.deepEqual(original, before);
  assert.throws(() => pedagogy.createVariant(original, { id: original.id }), /独立标识/);
});

test('两模板20个序号的变式数学都有效，答案取自新条件并区别原条件', () => {
  for (const template of ['right-triangle', 'parabola']) {
    const original = input(template); const conditions = new Set();
    for (let index = 1; index <= 20; index += 1) {
      const variant = pedagogy.createVariant(original, { id: NEW_ID, now: TIME, index });
      assert.equal(records.validSnapshot(template, variant.snapshot), true);
      assert.equal(records.judge(variant, records.expectedAnswer(variant)), true);
      assert.equal(records.judge(variant, records.expectedAnswer(original)), false);
      conditions.add(JSON.stringify(variant.snapshot));
      if (template === 'right-triangle') {
        const v = variant.snapshot;
        const scene = geometry.validateScene({ schemaVersion: '1.0.0', kind: 'right-triangle', requestId: 'variant-check',
          videoId: 'variant-check', frameTime: 0, frameSize: { width: 1, height: 1 }, sceneRevision: 0,
          rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, vertices: null,
          lengths: { AB: v.AB, AC: v.AC }, unit: v.unit, source: 'preset', originSource: 'preset', editedByUser: false });
        assert.equal(scene.ok, true);
      }
    }
    assert.equal(conditions.size, 20);
  }
});

test('学生解释独立保存原数学来源与快照，未评分且不生成作答或掌握结论', () => {
  const original = input('parabola'); const before = structuredClone(original);
  const explanation = pedagogy.createExplanation(original, { text: '  平方项为零时看到顶点；a改变开口。  ', id: NEW_ID, now: TIME });
  assert.equal(explanation.title, '学生自我解释'); assert.equal(explanation.kind, 'question');
  assert.equal(explanation.note, '平方项为零时看到顶点；a改变开口。');
  assert.deepEqual(explanation.source, original.source); assert.deepEqual(explanation.snapshot, original.snapshot);
  assert.equal(explanation.origin, original.origin); assert.equal(explanation.time, original.time);
  assert.match(explanation.sourceLabel, /学生解释.*未自动评分/);
  assert.deepEqual(records.validateRecord(explanation), explanation);
  assert.equal('answer' in explanation, false); assert.equal('correct' in explanation, false);
  explanation.source.title = 'changed'; explanation.snapshot.k = 99; assert.deepEqual(original, before);
  const manual = { ...input(), source: { kind: 'manual-notes', id: 'my-input', version: '1', analysisVersion: '1',
    materialMode: 'self-authored' }, origin: 'manual' };
  assert.equal(pedagogy.createExplanation(manual, { text: '我需要判断哪条边是斜边。' }).origin, 'manual');
});

test('解释拒绝空白、超限、媒体地址、凭证、控制字符和复用ID，不静默截断内容', () => {
  for (const text of ['', '   ', 'a'.repeat(1001), 'https://private.example/video', 'cookie: secret', 'a\u0000b']) {
    assert.throws(() => pedagogy.createExplanation(input(), { text, id: NEW_ID, now: TIME }));
  }
  assert.equal(pedagogy.createExplanation(input(), { text: 'a'.repeat(1000), id: NEW_ID, now: TIME }).note.length, 1000);
  assert.throws(() => pedagogy.createExplanation(input(), { text: '我的解释', id: 'original-record' }), /独立标识/);
  assert.throws(() => pedagogy.createExplanation(input(), { text: '我的解释', now: 'yesterday' }), /ISO/);
});

test('极端或无效数学明确拒绝预测变式，原记录完整保留', () => {
  for (const original of [input('right-triangle', { AB: 1e100, AC: 1e100, unit: 'cm' }),
    input('right-triangle', { AB: 1e-12, AC: 1, unit: 'cm' }), input('right-triangle', { AB: -3, AC: 4, unit: 'cm' }),
    input('parabola', { a: 1, h: 1e10, k: 0 }), input('parabola', { a: 1e-10, h: 0, k: 0 }),
    input('parabola', { a: 0, h: 0, k: 0 }), input('parabola', { a: NaN, h: 0, k: 0 })]) {
    const before = structuredClone(original);
    assert.throws(() => pedagogy.prediction(original));
    assert.throws(() => pedagogy.createVariant(original, { id: NEW_ID, now: TIME }));
    assert.deepEqual(original, before);
  }
  for (const index of [0, -1, 21, 1.5, '1', Infinity]) assert.throws(() => pedagogy.createVariant(input(), { id: NEW_ID, index }));
  assert.throws(() => pedagogy.createVariant(input(), { id: 'not-a-uuid' }), /UUID/);
  assert.throws(() => pedagogy.createVariant(input(), { id: NEW_ID, now: 'invalid' }), /ISO/);
  assert.throws(() => pedagogy.createVariant({ ...input(), id: 'a'.repeat(128) }, { id: NEW_ID }), /标识过长/);
  for (const method of ['hints', 'prediction', 'createVariant', 'createExplanation']) {
    assert.throws(() => pedagogy[method]({ ...input(), template: 'circle' }));
    assert.throws(() => pedagogy[method]({ ...input(), source: { ...input().source, materialMode: 'permission-pending' } }));
  }
});

test('浏览器IIFE与CommonJS导出同一纯能力，无DOM或网络依赖', () => {
  const sandbox = { crypto: { randomUUID: () => NEW_ID }, Date };
  vm.createContext(sandbox);
  for (const module of ['../extension/src/curve/evaluate', '../extension/src/geometry-scene/validate',
    '../extension/src/plugin/contracts', '../learning-site/records', '../learning-site/pedagogy']) {
    vm.runInContext(fs.readFileSync(require.resolve(module), 'utf8'), sandbox);
  }
  assert.deepEqual(Object.keys(sandbox.BreakGlass.pedagogy), ['hints', 'prediction', 'createVariant', 'createExplanation']);
  sandbox.inputJSON = JSON.stringify(input());
  assert.equal(vm.runInContext('BreakGlass.pedagogy.prediction(JSON.parse(inputJSON)).correct', sandbox), 'increase');
  assert.equal(vm.runInContext('BreakGlass.pedagogy.createVariant(JSON.parse(inputJSON)).source.kind', sandbox), 'manual-notes');
});
