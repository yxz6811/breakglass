// 一句中文 → 意图。只看改哪个系数、读哪个点，不算 y。
const test = require('node:test');
const assert = require('node:assert/strict');
const figures = require('../extension/src/tutor/figures');
const parser = require('../extension/src/tutor/parse');

const parabola = figures.get('parabola');

/**
 * @param {string} text
 */
function parse(text) {
  return parser.parse(text, parabola);
}

test('统一写法：全角、减号、大小写与空白', () => {
  assert.equal(parser.normalize('  把 K　改成 －１  '), '把 k 改成 -1');
  assert.equal(parser.normalize('x−1'), 'x-1');
  assert.equal(parser.normalize(null), '');
  assert.equal(Array.from(parser.normalize('啊'.repeat(300))).length, parser.MAX_LENGTH);
});

test('认出修改一个系数的常见说法', () => {
  const cases = [
    ['把顶点高度改成 -1', { name: 'k', spoken: -1 }],
    ['k=-1', { name: 'k', spoken: -1 }],
    ['h 调到 1', { name: 'h', spoken: 1 }],
    ['如果开口是 0.5，图像怎么变', { name: 'a', spoken: 0.5 }],
    ['把开口改成负零点五', { name: 'a', spoken: -0.5 }],
    ['顶点高度从 1 改到 -1', { name: 'k', spoken: -1 }],
    ['K 为 1/2 的话', { name: 'k', spoken: 0.5 }],
    ['k -1', { name: 'k', spoken: -1 }]
  ];
  for (const [text, expected] of cases) {
    const intent = parse(text);
    assert.deepEqual(intent.problems, [], text);
    assert.deepEqual(intent.sets, [expected], text);
  }
});

test('一句里改两个系数', () => {
  const intent = parse('把开口改成 0.8，顶点高度改成 -1');
  assert.deepEqual(intent.sets, [{ name: 'a', spoken: 0.8 }, { name: 'k', spoken: -1 }]);
  assert.deepEqual(parse('a 改成 0.8 和 k 改成 -1').sets, [{ name: 'a', spoken: 0.8 }, { name: 'k', spoken: -1 }]);
});

test('把顶点移到一个坐标，同时改左右位置和顶点高度', () => {
  const intent = parse('把顶点移到 (1, -1)');
  assert.deepEqual(intent.problems, []);
  assert.deepEqual(intent.sets, [{ name: 'h', spoken: 1 }, { name: 'k', spoken: -1 }]);
  assert.deepEqual(parse('顶点移到（0.5，2）').sets, [{ name: 'h', spoken: 0.5 }, { name: 'k', spoken: 2 }]);
});

test('认出横坐标上的读数', () => {
  const cases = [
    ['x 等于 1 时 y 是多少', 1],
    ['当x=2时，y等于多少？', 2],
    ['横坐标是 0.5 的时候纵坐标是多少', 0.5],
    ['f(1) 是多少', 1],
    ['x 取负一时呢', -1]
  ];
  for (const [text, x] of cases) {
    const intent = parse(text);
    assert.deepEqual(intent.problems, [], text);
    assert.deepEqual(intent.sets, [], text);
    assert.deepEqual(intent.reads, [{ target: 'x', x }], text);
  }
});

test('认出顶点与系数当前值的读法', () => {
  assert.deepEqual(parse('顶点在哪里').reads, [{ target: 'vertex' }]);
  assert.deepEqual(parse('顶点坐标是多少？').reads, [{ target: 'vertex' }]);
  assert.deepEqual(parse('k 现在是多少').reads, [{ target: 'parameter', name: 'k' }]);
  assert.deepEqual(parse('开口是多少').reads, [{ target: 'parameter', name: 'a' }]);
  assert.deepEqual(parse('顶点横坐标是多少').reads, [{ target: 'parameter', name: 'h' }]);
});

test('先改再读：同一句里的读数排在修改之后', () => {
  const intent = parse('如果开口是 0.5，x 等于 1 时 y 是多少');
  assert.deepEqual(intent.problems, []);
  assert.deepEqual(intent.sets, [{ name: 'a', spoken: 0.5 }]);
  assert.deepEqual(intent.reads, [{ target: 'x', x: 1 }]);
  const tight = parse('k 是 1 时 x=2 时 y 是多少');
  assert.deepEqual(tight.sets, [{ name: 'k', spoken: 1 }]);
  assert.deepEqual(tight.reads, [{ target: 'x', x: 2 }]);
});

test('单个字母不在别的英文单词里误命中', () => {
  const intent = parse('max 是多少');
  assert.deepEqual(intent.sets, []);
  assert.deepEqual(intent.reads, []);
  assert.deepEqual(parse('ok').sets, []);
});

test('其他图形的系数整句拒绝，即使另一项能改', () => {
  const only = parse('把半径改成 3');
  assert.equal(only.problems[0].kind, 'foreign');
  assert.equal(only.problems[0].word, '半径');
  const mixed = parse('把开口改成 0.8，斜率改成 2');
  assert.equal(mixed.problems.some((problem) => problem.kind === 'foreign' && problem.word === '斜率'), true);
});

test('同一系数两个不同的数算冲突；相同的数只算一次', () => {
  const conflict = parse('k 改成 1，k 改成 2');
  assert.deepEqual(conflict.problems, [{ kind: 'duplicate', name: 'k' }]);
  const same = parse('k 改成 1，顶点高度改成 1');
  assert.deepEqual(same.problems, []);
  assert.deepEqual(same.sets, [{ name: 'k', spoken: 1 }]);
  const vertex = parse('顶点移到 (1, 2)，k 改成 -1');
  assert.deepEqual(vertex.problems, [{ kind: 'duplicate', name: 'k' }]);
});

test('增减说法记成相对变化，改成某数仍是绝对值', () => {
  const cases = [
    ['k 增加 0.5', { name: 'k', delta: 0.5 }],
    ['顶点高度再加 1', { name: 'k', delta: 1 }],
    ['把开口减小 0.2', { name: 'a', delta: -0.2 }],
    ['h 降低了 1/2', { name: 'h', delta: -0.5 }],
    ['k 增加到 2', { name: 'k', spoken: 2 }]
  ];
  for (const [text, expected] of cases) {
    const intent = parse(text);
    assert.deepEqual(intent.problems, [], text);
    assert.deepEqual(intent.sets, [expected], text);
  }
  assert.deepEqual(parse('开口加大一点').sets, [], '「一点」不是加 1');
});

test('平移说法落到对应系数', () => {
  const cases = [
    ['抛物线向下平移 1 个单位', { name: 'k', delta: -1 }],
    ['往上移 2', { name: 'k', delta: 2 }],
    ['图像向左平移 0.5', { name: 'h', delta: -0.5 }],
    ['右移 3', { name: 'h', delta: 3 }],
    ['k 向下平移 1', { name: 'k', delta: -1 }]
  ];
  for (const [text, expected] of cases) {
    const intent = parse(text);
    assert.deepEqual(intent.problems, [], text);
    assert.deepEqual(intent.sets, [expected], text);
  }
  const both = parse('向右平移 1，再向下平移 2');
  assert.deepEqual(both.sets, [{ name: 'h', delta: 1 }, { name: 'k', delta: -2 }]);
  assert.deepEqual(parse('往上移一点').sets, [], '「一点」不是移 1');
  assert.deepEqual(parse('把上下位置改成 2').sets, [{ name: 'k', spoken: 2 }], '说法里的「上下」不算平移');
  const moved = parse('顶点向上平移 1');
  assert.deepEqual(moved.sets, [{ name: 'k', delta: 1 }]);
  assert.deepEqual(moved.reads, [{ target: 'vertex' }]);
});

test('有数没目标、空句与对不上的话', () => {
  assert.deepEqual(parse('改成 3').problems, [{ kind: 'no_target' }]);
  assert.deepEqual(parse('   ').problems, [{ kind: 'empty' }]);
  const vague = parse('看一下图像');
  assert.deepEqual(vague.problems, []);
  assert.deepEqual(vague.sets, []);
  assert.deepEqual(vague.reads, []);
  assert.deepEqual(parse('开口改成一个更大的').sets, [], '「一个」不是要改成 1');
});

test('没有顶点的图形问顶点会被拒绝', () => {
  const line = figures.get('line');
  assert.deepEqual(parser.parse('顶点在哪里', line).problems, [{ kind: 'no_vertex' }]);
  assert.deepEqual(parser.parse('把顶点高度改成 -1', line).problems, [{ kind: 'no_vertex' }]);
  assert.deepEqual(parser.parse('向左平移 1', line).problems, [{ kind: 'no_shift' }]);
  assert.deepEqual(parser.parse('向下平移 1', line).sets, [{ name: 'b', delta: -1 }]);
  assert.deepEqual(parser.parse('把斜率改成 2', line).sets, [{ name: 'm', spoken: 2 }], '自己登记的说法不算其他图形');
  assert.deepEqual(parser.parse('把开口改成 2', line).problems, [{ kind: 'foreign', word: '开口', owner: '抛物线' }]);
  assert.deepEqual(parser.parse('顶点在哪里', figures.get('sine')).problems, [{ kind: 'no_vertex' }]);
});

test('圆的关键点叫圆心：可读、可移，问顶点会被拒绝', () => {
  const circle = figures.get('circle');
  assert.equal(circle.pointWord, '圆心');
  assert.deepEqual(parser.parse('圆心在哪', circle).reads, [{ target: 'vertex' }]);
  assert.deepEqual(parser.parse('把圆心移到 (1, -1)', circle).sets, [{ name: 'h', spoken: 1 }, { name: 'k', spoken: -1 }]);
  assert.deepEqual(parser.parse('圆心纵坐标改成 2', circle).sets, [{ name: 'k', spoken: 2 }]);
  assert.deepEqual(parser.parse('顶点在哪', circle).problems, [{ kind: 'no_vertex' }]);
  assert.deepEqual(parser.parse('把圆心移到 (1, -1)', parabola).problems, [{ kind: 'foreign', word: '圆心', owner: '圆' }]);
});

test('登记会拒绝缺字段、说法冲突与重复登记', () => {
  assert.throws(() => figures.register({ label: 'x', aliases: {}, valuesAt() {} }), /kind/);
  assert.throws(() => figures.register({ kind: 'test.no-values', label: 'x', aliases: { a: ['a'] } }), /valuesAt/);
  assert.throws(() => figures.register({ kind: 'test.clash', label: 'x', aliases: { a: ['p'], b: ['P'] }, valuesAt() { return []; } }), /同时指向/);
  assert.throws(() => figures.register({ kind: 'parabola', label: '抛物线', aliases: { a: ['a'] }, valuesAt() { return []; } }), /重复登记/);
  assert.equal(figures.get('unknown'), null);
  assert.deepEqual(figures.list().slice(0, 4), ['parabola', 'line', 'circle', 'sine']);
});

test('登记的叫法与图形模型给滑块的标签逐字相同', () => {
  const model = require('../extension/src/geometry/figures');
  const preset = require('../extension/assets/presets/demo-parabola.json');
  for (const kind of ['line', 'circle', 'sine']) {
    const definition = model.createFigure(kind, preset.definition).definition;
    for (const [name, item] of Object.entries(definition.parameters)) {
      assert.equal(figures.get(kind).names[name], item.label, kind + ' ' + name);
    }
  }
});
