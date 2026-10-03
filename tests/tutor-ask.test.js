// 一次提问：快照 + 一句话 → 写回的系数、读数与回答。回答里的数必须能在画面上核对。
const test = require('node:test');
const assert = require('node:assert/strict');
const tutor = require('../extension/src/tutor/ask');
const numbers = require('../extension/src/tutor/numbers');
const figures = require('../extension/src/tutor/figures');
const model = require('../extension/src/geometry/figures');
const preset = require('../extension/assets/presets/demo-parabola.json');

/** 页面切到本地图形时用的坐标窗口，与 main.js 的 selectFigure 一致。 */
const LOCAL_BASE = {
  ...preset.definition,
  domain: { min: -4, max: 4 },
  range: { min: -4, max: 4 },
  region: { x: preset.frameSize.width * 0.08, y: preset.frameSize.height * 0.08, width: preset.frameSize.width * 0.84, height: preset.frameSize.height * 0.78 }
};

/**
 * 画面上的图形，形状与 figureSession.getState() 相同。
 * @param {'parabola' | 'line' | 'circle' | 'sine'} kind
 * @param {Record<string, number>} [overrides]
 */
function figureOf(kind, overrides = {}) {
  const figure = JSON.parse(JSON.stringify(model.createFigure(kind, kind === 'parabola' ? preset.definition : LOCAL_BASE)));
  figure.parameters = { ...figure.parameters, ...overrides };
  return figure;
}

/**
 * @param {'parabola' | 'line' | 'circle' | 'sine'} kind
 * @param {Record<string, number>} [overrides]
 * @param {boolean} [interactive]
 */
function snapshotOf(kind, overrides, interactive = true) {
  return tutor.snapshotFrom(figureOf(kind, overrides), { requestId: 'request-7', interactive });
}

/**
 * @param {string} text
 * @param {Partial<Record<'a' | 'h' | 'k', number>>} [overrides]
 */
function askPreset(text, overrides) {
  const snapshot = snapshotOf('parabola', overrides);
  return { snapshot, answer: tutor.ask(snapshot, text) };
}

/**
 * 回答里允许出现的数：改前值、实际采用的值、差值、范围与步长、读数、坐标窗口边界。
 * @param {object} snapshot
 * @param {object} answer
 * @returns {number[]}
 */
function allowedNumbers(snapshot, answer) {
  const allowed = [snapshot.domain.min, snapshot.domain.max, snapshot.range.min, snapshot.range.max];
  for (const item of Object.values(snapshot.parameters)) allowed.push(item.value, item.min, item.max, item.step);
  for (const item of answer.adjustments) allowed.push(item.before, item.adopted, Math.abs(item.adopted - item.before));
  for (const read of answer.reads) {
    if (read.target === 'parameter') allowed.push(read.value);
    else allowed.push(read.x, ...read.values);
  }
  return allowed;
}

/**
 * @param {string} reply
 * @returns {number[]}
 */
function numbersIn(reply) {
  return (reply.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

test('快照来自画面上的图形：系数值、范围、叫法、窗口与是否在交互', () => {
  const snapshot = snapshotOf('parabola', { k: -1 });
  assert.equal(snapshot.requestId, 'request-7');
  assert.equal(snapshot.kind, 'parabola');
  assert.equal(snapshot.interactive, true);
  assert.deepEqual(snapshot.parameters.k, { value: -1, min: -2, max: 2, step: 0.1, label: null });
  assert.deepEqual(snapshot.domain, { min: -2.5, max: 2.5 });
  assert.deepEqual(snapshot.range, { min: 0, max: 8 });
  assert.equal(snapshot.figure.kind, 'parabola');
  assert.equal(snapshot.figure.parameters.k, -1);
  assert.equal(snapshotOf('line').parameters.m.label, '斜率 m');
  assert.deepEqual(snapshotOf('circle').domain, { min: -4, max: 4 });
  assert.equal(snapshotOf('parabola', {}, false).interactive, false);
  assert.equal(snapshotOf('parabola', { a: NaN }).interactive, false);
  assert.equal(snapshotOf('parabola', { a: null }).interactive, false);
  assert.equal(tutor.snapshotFrom(figureOf('parabola')).interactive, false, '没有会话信息时不算在交互');
  assert.equal(tutor.snapshotFrom(null, { requestId: 'r', interactive: true }).interactive, false);
  assert.equal(tutor.snapshotFrom({ kind: 'line', parameters: null, definition: null }, { requestId: 'r', interactive: true }).interactive, false);
});

test('改一个系数：回答里的数就是实际采用的数', () => {
  const { answer } = askPreset('把顶点高度改成 -1');
  assert.equal(answer.kind, 'applied');
  assert.equal(answer.changed, true);
  assert.deepEqual(answer.parameters, { a: 1, h: 0, k: -1 });
  assert.deepEqual(answer.adjustments, [{ name: 'k', before: 1, spoken: -1, adopted: -1, adjusted: false, clamped: null }]);
  assert.equal(answer.reply, '顶点高度 k 从 1.0 改为 -1.0，抛物线向下平移 2.0。顶点现在是 (0.0, -1.0)。');
});

test('开口变化说明变窄或变宽', () => {
  assert.match(askPreset('把开口改成 0.5').answer.reply, /开口宽窄 a 从 1\.0 改为 0\.5，开口变宽/);
  assert.match(askPreset('a=1.2').answer.reply, /开口宽窄 a 从 1\.0 改为 1\.2，开口变窄/);
});

test('一句改两个系数，回答列出每一项', () => {
  const { answer } = askPreset('把开口改成 0.8，顶点高度改成 -1');
  assert.deepEqual(answer.parameters, { a: 0.8, h: 0, k: -1 });
  assert.match(answer.reply, /开口宽窄 a 从 1\.0 改为 0\.8/);
  assert.match(answer.reply, /顶点高度 k 从 1\.0 改为 -1\.0/);
});

test('越界时采用夹取后的数，并且不复述越界的原话', () => {
  const { answer } = askPreset('把开口改成 9');
  assert.equal(answer.parameters.a, 1.2);
  assert.equal(answer.adjustments[0].clamped, 'max');
  assert.match(answer.reply, /允许范围是 0\.4 到 1\.2，已从 1\.0 改为上限 1\.2/);
  assert.equal(numbersIn(answer.reply).includes(9), false);
  const low = askPreset('k 改成 -7').answer;
  assert.equal(low.parameters.k, -2);
  assert.match(low.reply, /改为下限 -2\.0/);
});

test('落在两格之间按步长取值，并说明', () => {
  const { answer } = askPreset('把开口改成 0.56');
  assert.equal(answer.parameters.a, 0.6);
  assert.equal(answer.adjustments[0].adjusted, true);
  assert.match(answer.reply, /只能按 0\.1 一格调整，已从 1\.0 改为 0\.6/);
  assert.equal(numbersIn(answer.reply).includes(0.56), false);
});

test('增减与平移从当前值算起，越界同样夹取', () => {
  const raise = askPreset('k 增加 0.5').answer;
  assert.deepEqual(raise.parameters, { a: 1, h: 0, k: 1.5 });
  assert.equal(raise.reply, '顶点高度 k 从 1.0 改为 1.5，抛物线向上平移 0.5。顶点现在是 (0.0, 1.5)。');
  const shifted = askPreset('抛物线向左平移 0.5 个单位', { h: 1 }).answer;
  assert.deepEqual(shifted.parameters, { a: 1, h: 0.5, k: 1 });
  assert.match(shifted.reply, /水平位置 h 从 1\.0 改为 0\.5，抛物线向左平移 0\.5/);
  const floor = askPreset('向下平移 100').answer;
  assert.equal(floor.parameters.k, -2);
  assert.equal(floor.adjustments[0].clamped, 'min');
  assert.equal(numbersIn(floor.reply).includes(100), false);
  const noise = askPreset('开口增加 0.1', { a: 0.4 }).answer;
  assert.equal(noise.parameters.a, 0.5);
  assert.equal(noise.adjustments[0].adjusted, false, '0.4 + 0.1 的浮点尾数不算按步长调整');
});

test('改成当前值：不改图，并说图像不变', () => {
  const same = askPreset('k 改成 1').answer;
  assert.equal(same.kind, 'applied');
  assert.equal(same.changed, false);
  assert.match(same.reply, /顶点高度 k 已经是 1\.0，图像不变/);
  const atMax = askPreset('a 改成 5', { a: 1.2 }).answer;
  assert.equal(atMax.changed, false);
  assert.match(atMax.reply, /已经在上限 1\.2，图像不变/);
});

test('横坐标上的读数与求值一致，不改系数', () => {
  const { answer } = askPreset('x 等于 1 时 y 是多少');
  assert.equal(answer.kind, 'read');
  assert.equal(answer.changed, false);
  assert.deepEqual(answer.parameters, { a: 1, h: 0, k: 1 });
  assert.deepEqual(answer.reads, [{ target: 'x', x: 1, values: [2], inside: [true], xInside: true }]);
  assert.equal(answer.reply, 'x = 1 时，y = 1.0 × (1 − 0.0)² + 1.0 = 2。这个点在当前坐标窗口内。');
});

test('负系数代入时加括号', () => {
  const { answer } = askPreset('f(1) 是多少', { h: -1, k: -1 });
  assert.match(answer.reply, /y = 1\.0 × \(1 − \(-1\.0\)\)² \+ \(-1\.0\) = 3/);
});

test('纵坐标落在窗口外：给出真实的 y，并说明在窗口外', () => {
  const { answer } = askPreset('x=2 时 y 是多少', { a: 1.2, k: 2 });
  assert.equal(answer.reads[0].values[0], 1.2 * 4 + 2);
  assert.deepEqual(answer.reads[0].inside, [true]);
  assert.match(answer.reply, /= 6\.8。这个点在当前坐标窗口内/);
  const outside = askPreset('x=2 时 y 是多少', { a: 1.2, k: 2, h: -2 }).answer;
  assert.equal(outside.reads[0].values[0], 1.2 * 16 + 2);
  assert.match(outside.reply, /= 21\.2。纵坐标窗口是 0 到 8，这个点在窗口外，画面上看不到这一段/);
});

test('横坐标落在窗口外：照算，并说明', () => {
  const { answer } = askPreset('x 等于 3 时 y 是多少');
  assert.equal(answer.reads[0].values[0], 10);
  assert.equal(answer.reads[0].xInside, false);
  assert.match(answer.reply, /横坐标窗口是 -2\.5 到 2\.5，这个点在窗口外/);
});

test('顶点与系数当前值', () => {
  assert.match(askPreset('顶点在哪里').answer.reply, /^顶点是 \(0\.0, 1\.0\)。这个点在当前坐标窗口内。$/);
  const below = askPreset('顶点在哪', { k: -1 }).answer;
  assert.match(below.reply, /顶点是 \(0\.0, -1\.0\)。纵坐标窗口是 0 到 8，这个点在窗口外/);
  assert.equal(askPreset('k 现在是多少').answer.reply, '顶点高度 k 现在是 1.0。');
});

test('先改再读：读数用改完的曲线', () => {
  const { answer } = askPreset('如果开口是 0.5，x 等于 2 时 y 是多少');
  assert.equal(answer.kind, 'applied');
  assert.equal(answer.changed, true);
  assert.deepEqual(answer.parameters, { a: 0.5, h: 0, k: 1 });
  assert.equal(answer.reads[0].values[0], 0.5 * 4 + 1);
  assert.match(answer.reply, /开口宽窄 a 从 1\.0 改为 0\.5，开口变宽。改完以后，x = 2 时，y = 0\.5 × \(2 − 0\.0\)² \+ 1\.0 = 3。/);
});

test('把顶点移到一个坐标', () => {
  const { answer } = askPreset('把顶点移到 (1, -1)');
  assert.deepEqual(answer.parameters, { a: 1, h: 1, k: -1 });
  assert.match(answer.reply, /水平位置 h 从 0\.0 改为 1\.0，抛物线向右平移 1\.0/);
  assert.match(answer.reply, /顶点现在是 \(1\.0, -1\.0\)/);
});

test('无法执行的提问不改系数，并说明没有改', () => {
  const cases = [
    ['把半径改成 3', /当前是抛物线，没有半径。图像没有改/],
    ['把开口改成 0.8，斜率改成 2', /没有斜率。图像没有改/],
    ['k 改成 1，k 改成 2', /说了两个不同的数/],
    ['改成 3', /没说要改哪个系数/],
    ['今天天气怎么样', /没对上要改的系数或要读的点，图像没有改/],
    ['', /先写一句问题/]
  ];
  for (const [text, reply] of cases) {
    const { answer } = askPreset(text);
    assert.equal(answer.kind, 'unchanged', text);
    assert.equal(answer.changed, false, text);
    assert.deepEqual(answer.parameters, { a: 1, h: 0, k: 1 }, text);
    assert.match(answer.reply, reply, text);
    assert.equal(/\d/.test(answer.reply), false, '拒绝的回答不出现阿拉伯数字：' + text);
  }
});

test('不在交互状态、图形未登记、求值失败都不改图', () => {
  const idle = tutor.ask(snapshotOf('parabola', {}, false), 'k 改成 -1');
  assert.equal(idle.kind, 'unavailable');
  assert.equal(idle.changed, false);
  assert.match(idle.reply, /先破壁/);
  assert.match(tutor.ask(tutor.snapshotFrom(null, { requestId: 'r', interactive: true }), 'k 改成 -1').reply, /先破壁/);

  const unknown = snapshotOf('parabola');
  unknown.kind = 'fixture.unknown';
  assert.equal(tutor.ask(unknown, 'k 改成 -1').kind, 'unavailable');

  figures.register({
    kind: 'test.broken',
    label: '坏图形',
    aliases: { k: ['k'] },
    valuesAt() { return [Infinity]; }
  });
  const broken = { ...snapshotOf('parabola'), kind: 'test.broken', parameters: { k: { value: 0, min: -1, max: 1, step: 0.1, label: null } } };
  const failed = tutor.ask(broken, 'k 改成 0.5，x=1 时 y 是多少');
  assert.equal(failed.kind, 'unavailable');
  assert.equal(failed.changed, false);
  assert.deepEqual(failed.parameters, { k: 0 });
  assert.match(failed.reply, /没算出来，图像没有改/);
});

test('直线：斜率与截距按滑块叫法改，读数带代入过程', () => {
  const snapshot = snapshotOf('line');
  const steeper = tutor.ask(snapshot, '把斜率改成 2');
  assert.deepEqual(steeper.parameters, { m: 2, b: 1 });
  assert.match(steeper.reply, /^斜率 m 从 1\.0 改为 2\.0，直线变陡/);
  assert.match(tutor.ask(snapshot, '斜率改成 -1').reply, /直线改为从左上往右下/);
  assert.match(tutor.ask(snapshot, 'm 改成 0').reply, /直线变成水平线/);

  const lower = tutor.ask(snapshot, '截距减小 1');
  assert.deepEqual(lower.parameters, { m: 1, b: 0 });
  assert.match(lower.reply, /^截距 b 从 1\.0 改为 0\.0，直线向下平移 1\.0/);
  assert.equal(tutor.ask(snapshot, '向上平移 0.5').parameters.b, 1.5);

  const read = tutor.ask(snapshot, 'x 等于 1 时 y 是多少');
  assert.deepEqual(read.reads[0].values, model.readAt(figureOf('line'), 1).values);
  assert.match(read.reply, /^x = 1 时，y = 1\.0 × 1 \+ 1\.0 = 2。这个点在当前坐标窗口内/);
  assert.match(tutor.ask(snapshot, 'x=-2 时 y 是多少').reply, /y = 1\.0 × \(-2\) \+ 1\.0 = -1/);
});

test('圆：一个 x 上有两个、一个或没有 y，圆心可读可移', () => {
  const snapshot = snapshotOf('circle');
  const two = tutor.ask(snapshot, 'x 等于 0 时 y 是多少');
  assert.deepEqual(two.reads[0].values, [2, 0]);
  assert.match(two.reply, /^x = 0 时有两个 y：y = 2 或 y = 0。这些点都在当前坐标窗口内/);
  const one = tutor.ask(snapshot, 'x=1 时 y 是多少');
  assert.deepEqual(one.reads[0].values, [1]);
  assert.match(one.reply, /^x = 1 时，y = 1。这个点在当前坐标窗口内/);
  const none = tutor.ask(snapshot, 'x=3 时 y 是多少');
  assert.deepEqual(none.reads[0].values, []);
  assert.match(none.reply, /^x = 3 时，圆上没有点/);
  for (const x of [0, 1, 3, -0.5]) {
    assert.deepEqual(tutor.ask(snapshot, 'x=' + x + ' 时 y 是多少').reads[0].values, model.readAt(figureOf('circle'), x).values);
  }

  const bigger = tutor.ask(snapshot, '把半径改成 2.5');
  assert.deepEqual(bigger.parameters, { h: 0, k: 1, r: 2.5 });
  assert.match(bigger.reply, /^半径 r 从 1\.0 改为 2\.5，圆变大/);
  const moved = tutor.ask(snapshot, '把圆心移到 (1, -1)');
  assert.deepEqual(moved.parameters, { h: 1, k: -1, r: 1 });
  assert.match(moved.reply, /圆心横坐标 h 从 0\.0 改为 1\.0，圆向右平移 1\.0。圆心纵坐标 k 从 1\.0 改为 -1\.0，圆向下平移 2\.0。圆心现在是 \(1\.0, -1\.0\)/);
  assert.match(tutor.ask(snapshot, '圆心在哪').reply, /^圆心是 \(0\.0, 1\.0\)/);
  assert.deepEqual(tutor.ask(snapshot, '向左平移 0.5').parameters, { h: -0.5, k: 1, r: 1 });
  assert.match(tutor.ask(snapshot, '帮助').reply, /圆心在哪里。能改的系数：圆心横坐标 h、圆心纵坐标 k、半径 r/);

  const vertex = tutor.ask(snapshot, '顶点在哪');
  assert.equal(vertex.kind, 'unchanged');
  assert.match(vertex.reply, /^当前的圆没有顶点。图像没有改。可以问圆心在哪里/);
  assert.match(tutor.ask(snapshot, '把开口改成 0.5').reply, /^当前是圆，没有开口/);
});

test('正弦：振幅与平移，读数按弧度代入', () => {
  const snapshot = snapshotOf('sine');
  const read = tutor.ask(snapshot, 'x 等于 1 时 y 是多少');
  const expected = model.readAt(figureOf('sine'), 1).values[0];
  assert.equal(read.reads[0].values[0], expected);
  assert.ok(Math.abs(expected - (Math.sin(1) + 1)) < 1e-12);
  assert.match(read.reply, new RegExp('^x = 1 时，y = 1\\.0 × sin\\(1 − 0\\.0\\) \\+ 1\\.0 = ' + numbers.formatReading(expected).replace('.', '\\.')));

  const right = tutor.ask(snapshot, '向右平移 1');
  assert.deepEqual(right.parameters, { a: 1, h: 1, k: 1 });
  assert.match(right.reply, /^左右位置 h 从 0\.0 改为 1\.0，图像向右平移 1\.0/);
  assert.match(tutor.ask(snapshot, '把振幅改成 2').reply, /^振幅 a 从 1\.0 改为 2\.0，波峰波谷离中线更远/);
  assert.match(tutor.ask(snapshot, '把振幅改成 -2').reply, /图像上下翻转/);
  assert.match(tutor.ask(snapshot, '振幅改成 0').reply, /图像变成一条水平线/);
  assert.match(tutor.ask(snapshot, '顶点在哪').reply, /^当前的正弦没有顶点。图像没有改。$/);
  assert.match(tutor.ask(snapshot, '把半径改成 2').reply, /^当前是正弦，没有半径/);
});

test('只属于抛物线的说法不会把别的图形改回抛物线', () => {
  for (const kind of ['line', 'circle', 'sine']) {
    const snapshot = snapshotOf(kind);
    for (const text of ['把顶点高度改成 -1', '把开口改成 0.5', '开口变大一点']) {
      const answer = tutor.ask(snapshot, text);
      assert.equal(answer.changed, false, kind + '：' + text);
      assert.deepEqual(answer.parameters, figureOf(kind).parameters, kind + '：' + text);
      assert.equal(/\d/.test(answer.reply), false, '拒绝的回答不出现阿拉伯数字：' + kind + '：' + text);
    }
  }
  assert.match(tutor.ask(snapshotOf('line'), '把顶点高度改成 -1').reply, /^当前的直线没有顶点/);
  assert.match(tutor.ask(snapshotOf('line'), '向左平移 1').reply, /^当前的直线不能用这种说法平移。图像没有改。直线左右平移要同时看斜率和截距/);
});

/** 每种图形各问一组，回答里的数都要能在画面上核对。 */
const INVARIANT_QUESTIONS = {
  parabola: {
    states: [{}, { a: 1.2, h: -2, k: 2 }, { a: 0.4, h: 1.5, k: -1.5 }],
    questions: [
      '把顶点高度改成 -1', '把开口改成 9', '把开口改成 0.56', 'k 改成 -7', 'h 调到 1.25',
      'x 等于 1 时 y 是多少', 'x=2 时 y 是多少', 'x 等于 3 时 y 是多少', 'f(-1.5) 是多少',
      '顶点在哪里', 'k 现在是多少', '如果开口是 0.5，x 等于 2 时 y 是多少', '把顶点移到 (1, -1)',
      '把开口改成 0.8，顶点高度改成 -1', '把半径改成 3', '改成 3', 'k 改成 1，k 改成 2',
      'k 增加 0.5', '开口减小 0.25', '向下平移 100', '向右平移 0.75，x=1 时 y 是多少', '顶点向上平移 1'
    ]
  },
  line: {
    states: [{}, { m: -3.7, b: -2 }, { m: 0, b: 2 }],
    questions: [
      '把斜率改成 2', '截距减小 1', 'x 等于 1 时 y 是多少', '向上平移 0.5，x=-2 时 y 是多少',
      '斜率改成 9', 'x=4 时 y 是多少', 'm 改成 0.33', 'b 现在是多少', '把开口改成 2', '向左平移 1'
    ]
  },
  circle: {
    states: [{}, { h: -2, k: 2, r: 8 }, { h: 1.3, k: -0.7, r: 0.1 }],
    questions: [
      '把半径改成 2', '把圆心移到 (1, -1)', 'x 等于 0 时 y 是多少', 'x=1 时 y 是多少', 'x=1.35 时 y 是多少',
      '圆心在哪', '半径增加 0.25', '向左平移 3，x=-1 时 y 是多少', '半径改成 100', '顶点在哪'
    ]
  },
  sine: {
    states: [{}, { a: -4, h: 2, k: -2 }, { a: 0, h: -1.1, k: 0.3 }],
    questions: [
      '把振幅改成 2', '向右平移 1', 'x 等于 1 时 y 是多少', 'x=2.5 时 y 是多少', '振幅改成 -3',
      '上下位置改成 -5', '振幅增加 0.15，x=-3.9 时 y 是多少', '相位改成 0.5', '把半径改成 1'
    ]
  }
};

test('回答里的每个数都能在画面上核对', () => {
  for (const [kind, { states, questions }] of Object.entries(INVARIANT_QUESTIONS)) {
    for (const overrides of states) {
      for (const text of questions) {
        const snapshot = snapshotOf(kind, overrides);
        const answer = tutor.ask(snapshot, text);
        const allowed = allowedNumbers(snapshot, answer);
        for (const value of numbersIn(answer.reply)) {
          const known = allowed.some((candidate) => Math.abs(candidate - value) <= 5e-5 + 1e-9 * Math.abs(candidate));
          assert.equal(known, true, `${kind}「${text}」的回答出现了画面上没有的数 ${value}：${answer.reply}`);
        }
      }
    }
  }
});

test('回答与滑块标签用同一个格式化', () => {
  const { snapshot, answer } = askPreset('k 改成 0.3');
  const label = numbers.formatParameter(answer.parameters.k, snapshot.parameters.k);
  assert.equal(label, '0.3');
  assert.match(answer.reply, new RegExp('改为 ' + label.replace('.', '\\.') + '，'));
});
