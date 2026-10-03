// 一次提问：快照 + 一句话 → 写回的系数、读数与回答。回答里的数必须能在画面上核对。
const test = require('node:test');
const assert = require('node:assert/strict');
const tutor = require('../extension/src/tutor/ask');
const numbers = require('../extension/src/tutor/numbers');
const figures = require('../extension/src/tutor/figures');
const preset = require('../extension/assets/presets/demo-parabola.json');

/**
 * 预设抛物线进入交互后的会话状态。
 * @param {Partial<Record<'a' | 'h' | 'k', number>>} [overrides]
 * @param {string} [status]
 */
function presetState(overrides = {}, status = 'interactive') {
  const current = Object.fromEntries(Object.entries(preset.definition.parameters).map(([name, item]) => [name, item.initial]));
  return {
    status,
    requestId: 'request-7',
    result: { ...preset, requestId: 'request-7' },
    currentParameters: { ...current, ...overrides }
  };
}

/**
 * @param {string} text
 * @param {Partial<Record<'a' | 'h' | 'k', number>>} [overrides]
 */
function askPreset(text, overrides) {
  const snapshot = tutor.snapshotFrom(presetState(overrides));
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

test('快照来自会话：系数值、范围、窗口与是否在交互', () => {
  const snapshot = tutor.snapshotFrom(presetState({ k: -1 }));
  assert.equal(snapshot.requestId, 'request-7');
  assert.equal(snapshot.equationId, 'fixture.parabola');
  assert.equal(snapshot.interactive, true);
  assert.deepEqual(snapshot.parameters.k, { value: -1, min: -2, max: 2, step: 0.1 });
  assert.deepEqual(snapshot.domain, { min: -2.5, max: 2.5 });
  assert.deepEqual(snapshot.range, { min: 0, max: 8 });
  assert.equal(tutor.snapshotFrom(presetState({}, 'paused-ready')).interactive, false);
  assert.equal(tutor.snapshotFrom(presetState({ a: NaN })).interactive, false);
  assert.equal(tutor.snapshotFrom(null).interactive, false);
  assert.equal(tutor.snapshotFrom({ status: 'interactive', requestId: 'r', result: null, currentParameters: null }).interactive, false);
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
  const idle = tutor.ask(tutor.snapshotFrom(presetState({}, 'paused-ready')), 'k 改成 -1');
  assert.equal(idle.kind, 'unavailable');
  assert.equal(idle.changed, false);
  assert.match(idle.reply, /先破壁/);

  const unknown = tutor.snapshotFrom(presetState());
  unknown.equationId = 'fixture.unknown';
  assert.equal(tutor.ask(unknown, 'k 改成 -1').kind, 'unavailable');

  figures.register({
    equationId: 'test.broken',
    label: '坏图形',
    aliases: { k: ['k'] },
    valuesAt() { return [Infinity]; }
  });
  const broken = { ...tutor.snapshotFrom(presetState()), equationId: 'test.broken', parameters: { k: { value: 0, min: -1, max: 1, step: 0.1 } } };
  const failed = tutor.ask(broken, 'k 改成 0.5，x=1 时 y 是多少');
  assert.equal(failed.kind, 'unavailable');
  assert.equal(failed.changed, false);
  assert.deepEqual(failed.parameters, { k: 0 });
  assert.match(failed.reply, /没算出来，图像没有改/);
});

test('一个 x 上有两个 y 或没有点的图形', () => {
  figures.register({
    equationId: 'test.circle',
    label: '圆',
    names: { r: '半径 r' },
    aliases: { r: ['半径', 'r'] },
    valuesAt(snapshot, values, x) {
      const inside = values.r * values.r - x * x;
      if (inside < 0) return [];
      if (inside === 0) return [0];
      return [Math.sqrt(inside), -Math.sqrt(inside)];
    }
  });
  const snapshot = {
    requestId: 'request-circle', equationId: 'test.circle', interactive: true,
    parameters: { r: { value: 2, min: 0.5, max: 3, step: 0.5 } },
    domain: { min: -3, max: 3 }, range: { min: -3, max: 3 }
  };
  const two = tutor.ask(snapshot, 'x 等于 0 时 y 是多少');
  assert.deepEqual(two.reads[0].values, [2, -2]);
  assert.match(two.reply, /x = 0 时有两个 y：y = 2 或 y = -2。这些点都在当前坐标窗口内/);
  const none = tutor.ask(snapshot, 'x=3 时 y 是多少');
  assert.deepEqual(none.reads[0].values, []);
  assert.match(none.reply, /x = 3 时，圆上没有点/);
  assert.match(tutor.ask(snapshot, '把半径改成 2.5').reply, /半径 r 从 2\.0 改为 2\.5/);
  assert.match(tutor.ask(snapshot, '顶点在哪').reply, /没有顶点/);
});

test('回答里的每个数都能在画面上核对', () => {
  const questions = [
    '把顶点高度改成 -1', '把开口改成 9', '把开口改成 0.56', 'k 改成 -7', 'h 调到 1.25',
    'x 等于 1 时 y 是多少', 'x=2 时 y 是多少', 'x 等于 3 时 y 是多少', 'f(-1.5) 是多少',
    '顶点在哪里', 'k 现在是多少', '如果开口是 0.5，x 等于 2 时 y 是多少', '把顶点移到 (1, -1)',
    '把开口改成 0.8，顶点高度改成 -1', '把半径改成 3', '改成 3', 'k 改成 1，k 改成 2',
    'k 增加 0.5', '开口减小 0.25', '向下平移 100', '向右平移 0.75，x=1 时 y 是多少', '顶点向上平移 1'
  ];
  const states = [{}, { a: 1.2, h: -2, k: 2 }, { a: 0.4, h: 1.5, k: -1.5 }];
  for (const overrides of states) {
    for (const text of questions) {
      const { snapshot, answer } = askPreset(text, overrides);
      const allowed = allowedNumbers(snapshot, answer);
      for (const value of numbersIn(answer.reply)) {
        const known = allowed.some((candidate) => Math.abs(candidate - value) <= 5e-5 + 1e-9 * Math.abs(candidate));
        assert.equal(known, true, `「${text}」的回答出现了画面上没有的数 ${value}：${answer.reply}`);
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
