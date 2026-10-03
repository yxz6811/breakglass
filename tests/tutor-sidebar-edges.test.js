// AI 侧边栏的边缘测试。期望来自 specs/004-figures-and-tutor 的故事 2 与 contracts/tutor-turn.md。
// 失败表示实现和契约不一致；本文件只记录问题，不改提问实现。
const test = require('node:test');
const assert = require('node:assert/strict');
const tutor = require('../extension/src/tutor/ask');
const numbers = require('../extension/src/tutor/numbers');
const figures = require('../extension/src/tutor/figures');
const geometry = require('../extension/src/geometry/figures');
const preset = require('../extension/assets/presets/demo-parabola.json');

const ORIGINAL = { a: 1, h: 0, k: 1 };
const LOCAL_BASE = {
  ...preset.definition,
  domain: { min: -4, max: 4 },
  range: { min: -4, max: 4 },
  region: {
    x: preset.frameSize.width * 0.08,
    y: preset.frameSize.height * 0.08,
    width: preset.frameSize.width * 0.84,
    height: preset.frameSize.height * 0.78
  }
};

/**
 * 与 figureSession.getState() 相同形状的图形。定义是副本，改范围不会碰到预设夹具。
 * @param {'parabola' | 'line' | 'circle' | 'sine'} kind
 * @param {Record<string, number>} [overrides]
 */
function figureOf(kind, overrides = {}) {
  const source = kind === 'parabola' ? preset.definition : LOCAL_BASE;
  const figure = geometry.createFigure(kind, JSON.parse(JSON.stringify(source)));
  figure.parameters = { ...figure.parameters, ...overrides };
  return figure;
}

/**
 * @param {'parabola' | 'line' | 'circle' | 'sine'} kind
 * @param {Record<string, number>} [overrides]
 * @param {boolean} [interactive]
 */
function snapshotOf(kind, overrides = {}, interactive = true) {
  return tutor.snapshotFrom(figureOf(kind, overrides), { requestId: 'request-edge', interactive });
}

/**
 * @param {string} text
 * @param {Record<string, number>} [overrides]
 * @param {'parabola' | 'line' | 'circle' | 'sine'} [kind]
 */
function askPreset(text, overrides, kind = 'parabola') {
  const snapshot = snapshotOf(kind, overrides);
  let thrown = null;
  let answer = null;
  try {
    answer = tutor.ask(snapshot, text);
  } catch (error) {
    thrown = error;
  }
  return { snapshot, answer, thrown };
}

/**
 * 整句不能改图，系数保持原样。
 * @param {string} text
 * @param {Partial<Record<'a' | 'h' | 'k', number>>} [overrides]
 */
function assertKeepsCurve(text, overrides) {
  const { answer, thrown } = askPreset(text, overrides);
  assert.equal(thrown, null, text + (thrown ? ' 抛出了 ' + thrown.message : ''));
  assert.equal(answer.changed, false, text + ' → ' + answer.reply);
  assert.deepEqual(answer.parameters, { ...ORIGINAL, ...overrides }, text + ' → ' + answer.reply);
  assert.match(answer.reply, /没有改|图像不变/, text + ' → ' + answer.reply);
  return answer;
}

test('同一句里同一个系数的两个不同的数，整句不改图', () => {
  const cases = [
    'k 改成 1 改成 2',
    'k 增加 1 减少 2',
    'h 改成 1 和 2',
    '把开口改成 0.5 和 0.8',
    '把顶点高度往上 1 改成 -1',
    'k 增加到 2 增加 3'
  ];
  const failures = [];
  for (const text of cases) {
    try {
      assertKeepsCurve(text);
    } catch (error) {
      failures.push(error.message);
    }
  }
  assert.deepEqual(failures, []);
});

test('写到一半的系数不能被丢掉后只改另一项', () => {
  assertKeepsCurve('把开口改成 0.5，把顶点高度改成');
});

test('数字被截成前缀时，不能按那个前缀改图', () => {
  const failures = [];
  /**
   * @param {string} text
   * @param {(answer: object) => boolean} bad
   */
  function check(text, bad) {
    const { answer, thrown } = askPreset(text);
    if (thrown || bad(answer)) failures.push(text + ' → ' + (thrown ? thrown.message : answer.reply));
  }
  check('把水平位置改成一百', (answer) => answer.parameters.h === 1 || (answer.changed && answer.parameters.h !== 2));
  check('把顶点高度改成负一百', (answer) => answer.parameters.k === -1 || (answer.changed && answer.parameters.k !== -2));
  check('把水平位置改成 1e2', (answer) => answer.parameters.h === 1);
  check('把水平位置改成 2e-1', (answer) => answer.parameters.h === 2 || (answer.changed && Math.abs(answer.parameters.h - 0.2) > 1e-9));
  check('把开口改成 1.2.3', (answer) => answer.changed || answer.parameters.a !== 1 || /改为 1\.2/.test(answer.reply));
  assert.deepEqual(failures, []);
});

test('否定和是非问句不改图', () => {
  const failures = [];
  for (const text of [
    '不要把顶点高度改成 -1',
    '别把顶点高度改成 -1',
    '是不是把顶点高度改成 -1',
    '不要把开口改成 0.5，x=1 时 y 是多少'
  ]) {
    try {
      assertKeepsCurve(text);
    } catch (error) {
      failures.push(error.message);
    }
  }
  assert.deepEqual(failures, []);
});

test('顶点的高度、从甲移到乙、顶点是某个点，都要改到那个点', () => {
  const failures = [];
  const height = askPreset('把顶点的高度改成 -1');
  if (height.thrown || height.answer.parameters.k !== -1 || !height.answer.changed) {
    failures.push('把顶点的高度改成 -1 → ' + (height.thrown ? height.thrown.message : height.answer.reply));
  }
  for (const text of ['顶点从 (0, 0) 移到 (1, -1)', '顶点是 (1, -1)']) {
    const { answer, thrown } = askPreset(text);
    const parameters = answer && answer.parameters;
    if (thrown || !parameters || parameters.h !== 1 || parameters.k !== -1 || parameters.a !== 1) {
      failures.push(text + ' → ' + (thrown ? thrown.message : answer.reply));
    }
  }
  assert.deepEqual(failures, []);
});

test('有中文数字但没点名系数时，要说明没点名，而不是说完全对不上', () => {
  const { answer, thrown } = askPreset('改成负一');
  assert.equal(thrown, null);
  assert.equal(answer.changed, false);
  assert.deepEqual(answer.parameters, ORIGINAL);
  assert.match(answer.reply, /没说要改哪个系数/);
});

test('点了名的系数配上无效或带量词的数字时，不能说没点名系数', () => {
  const failures = [];
  const invalid = askPreset('把开口改成 1/0');
  if (invalid.thrown || invalid.answer.changed || /没说要改哪个系数/.test(invalid.answer.reply) || !/开口/.test(invalid.answer.reply)) {
    failures.push('1/0 → ' + (invalid.thrown ? invalid.thrown.message : invalid.answer.reply));
  }
  for (const [text, key, expected] of [['把顶点高度改成 0 个', 'k', 0], ['向下平移 1 个', 'k', 0]]) {
    const { answer, thrown } = askPreset(text);
    if (thrown || answer.parameters[key] !== expected || /没说要改哪个系数/.test(answer.reply)) {
      failures.push(text + ' → ' + (thrown ? thrown.message : answer.reply));
    }
  }
  assert.deepEqual(failures, []);
});

test('「几」出现在「几何」里，或顺口提到的系数，不算一次读数', () => {
  const geometryMention = assertKeepsCurve('这是几何题，开口别动');
  assert.doesNotMatch(geometryMention.reply, /现在是/);

  const { answer, thrown } = askPreset('x 等于 1 时 y 是多少，开口');
  assert.equal(thrown, null);
  assert.equal(answer.changed, false);
  assert.deepEqual(answer.parameters, ORIGINAL);
  assert.equal(answer.reads.length, 1, answer.reply);
  assert.equal(answer.reads[0].target, 'x');
  assert.doesNotMatch(answer.reply, /开口宽窄 a 现在是/);
});

test('一句里点了五个横坐标，五个都要回答', () => {
  const { answer, thrown } = askPreset('x=1、x=2、x=3、x=4、x=5 时 y 是多少');
  assert.equal(thrown, null);
  assert.equal(answer.changed, false);
  assert.deepEqual(answer.reads.map((read) => read.x), [1, 2, 3, 4, 5], answer.reply);
  assert.match(answer.reply, /x = 5/);
});

test('步长把越界值又挪进范围后，不能把这个值叫成上限', () => {
  const figure = figureOf('parabola', { a: 0.3 });
  figure.definition.parameters.a = { ...figure.definition.parameters.a, min: 0, max: 1, step: 0.3 };
  const snapshot = tutor.snapshotFrom(figure, { requestId: 'request-edge', interactive: true });
  const answer = tutor.ask(snapshot, '把开口改成 5');
  assert.equal(answer.parameters.a, 0.9, answer.reply);
  assert.match(answer.reply, /1\.0/, answer.reply);
  assert.doesNotMatch(answer.reply, /上限 0\.9/, answer.reply);
});

test('开口系数变成 0 时，不能说成开口向下', () => {
  const figure = figureOf('parabola', { a: 1 });
  figure.definition.parameters.a = { ...figure.definition.parameters.a, min: -2, max: 2, step: 0.1 };
  const snapshot = tutor.snapshotFrom(figure, { requestId: 'request-edge', interactive: true });
  const answer = tutor.ask(snapshot, '把开口改成 0');
  assert.equal(answer.parameters.a, 0, answer.reply);
  assert.doesNotMatch(answer.reply, /开口改为向下/, answer.reply);
});

/**
 * 从代入句里取出印出来的 a、x、h、k、y。
 * @param {string} reply
 * @returns {{ a: number, x: number, h: number, k: number, y: number } | null}
 */
function printedSubstitution(reply) {
  const text = reply.replace(/−/g, '-');
  const match = /y = (-?\d+(?:\.\d+)?) × \((-?\d+(?:\.\d+)?) - (?:\((-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?))\)² \+ (?:\((-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)) = (-?\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  return {
    a: Number(match[1]),
    x: Number(match[2]),
    h: Number(match[3] != null ? match[3] : match[4]),
    k: Number(match[5] != null ? match[5] : match[6]),
    y: Number(match[7])
  };
}

test('回答里印出的代入式，按印出的数再算，要得到印出的 y', () => {
  const failures = [];
  for (const token of ['1/3', '2/3', '1/7', '3/7', '5/3', '0.15', '1.05', '-1.25']) {
    const { answer, thrown } = askPreset('x 等于 ' + token + ' 时 y 是多少');
    if (thrown || !answer) {
      failures.push(token + ' 抛出 ' + (thrown && thrown.message));
      continue;
    }
    const printed = printedSubstitution(answer.reply);
    if (!printed) {
      failures.push(token + ' 没有代入式：' + answer.reply);
      continue;
    }
    const computed = printed.a * (printed.x - printed.h) ** 2 + printed.k;
    if (Number(computed.toFixed(4)) !== printed.y) {
      failures.push(`${token}: 印出 ${printed.y}，用印出的数算出 ${computed}（四位 ${Number(computed.toFixed(4))}） ${answer.reply}`);
    }
  }
  assert.deepEqual(failures, []);
});

/**
 * @param {object} snapshot
 * @param {string} text
 * @param {string} label
 * @param {string[]} failures
 */
function expectNoThrowUnavailable(snapshot, text, label, failures) {
  try {
    const answer = tutor.ask(snapshot, text);
    if (answer.kind !== 'unavailable' || answer.changed) failures.push(label + ' → ' + answer.kind + ' ' + answer.reply);
  } catch (error) {
    failures.push(label + ' 抛出 ' + error.message);
  }
}

/**
 * @param {string} kind
 * @param {Record<string, { value: number, min: number, max: number, step: number, label?: string }>} parameters
 * @param {object} extra
 */
function rawSnapshot(kind, parameters, extra) {
  const current = {};
  const definitionParameters = {};
  for (const [name, item] of Object.entries(parameters)) {
    current[name] = item.value;
    definitionParameters[name] = { initial: item.value, min: item.min, max: item.max, step: item.step, label: item.label || name };
  }
  return tutor.snapshotFrom({
    kind,
    parameters: current,
    definition: {
      parameters: definitionParameters,
      domain: { min: -4, max: 4 },
      range: { min: -4, max: 4 },
      yAxis: 'up',
      region: { x: 0, y: 0, width: 10, height: 10 }
    }
  }, { requestId: 'r', interactive: true, ...extra });
}

test('讲解或读数中途出错时返回没算出来，不能把异常抛出', () => {
  const failures = [];
  figures.register({
    kind: 'test-sidebar-missing',
    label: '缺系数',
    aliases: { m: ['斜率'], b: ['截距'] },
    valuesAt() { return [0]; }
  });
  expectNoThrowUnavailable(rawSnapshot('test-sidebar-missing', {
    b: { value: 1, min: -4, max: 4, step: 0.1, label: '截距 b' }
  }), '斜率是多少', '缺系数', failures);

  figures.register({
    kind: 'test-sidebar-work',
    label: '坏过程',
    aliases: { k: ['k'] },
    valuesAt() { return [1]; },
    showWork() { throw new Error('showWork'); }
  });
  expectNoThrowUnavailable(rawSnapshot('test-sidebar-work', {
    k: { value: 1, min: -2, max: 2, step: 0.1, label: 'k' }
  }), 'x=1 时 y 是多少', '代入过程', failures);

  figures.register({
    kind: 'test-sidebar-describe',
    label: '坏说明',
    aliases: { k: ['k'] },
    valuesAt() { return [1]; },
    describe() { throw new Error('describe'); }
  });
  try {
    const described = tutor.ask(rawSnapshot('test-sidebar-describe', {
      k: { value: 1, min: -2, max: 2, step: 0.1, label: 'k' }
    }), 'k 改成 0');
    if (described.kind !== 'unavailable' || described.changed || described.parameters.k !== 1) {
      failures.push('变化说明 → ' + described.kind + ' ' + JSON.stringify(described.parameters) + ' ' + described.reply);
    }
  } catch (error) {
    failures.push('变化说明 抛出 ' + error.message);
  }
  assert.deepEqual(failures, []);
});

test('已经能画的直线、圆、正弦，提问区也要能改它的系数', () => {
  const cases = [
    ['line', '把斜率改成 2', 'm', 2],
    ['circle', '把半径改成 2', 'r', 2],
    ['sine', '把振幅改成 2', 'a', 2]
  ];
  const failures = [];
  for (const [kind, text, name, expected] of cases) {
    const { answer, thrown } = askPreset(text, {}, kind);
    if (thrown) {
      failures.push(kind + ' 抛出 ' + thrown.message);
      continue;
    }
    if (answer.kind !== 'applied' || answer.parameters[name] !== expected) {
      failures.push(`${kind}: ${answer.kind} ${answer.reply}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('窗口边界算在内，刚出界要说明，并且不说画在边上', () => {
  const onEdge = askPreset('x 等于 2.5 时 y 是多少');
  assert.equal(onEdge.answer.reads[0].xInside, true);
  assert.equal(onEdge.answer.reads[0].inside[0], true, onEdge.answer.reply);
  const outside = askPreset('x 等于 2.6 时 y 是多少');
  assert.equal(outside.answer.reads[0].xInside, false);
  assert.match(outside.answer.reply, /窗口外/);
  assert.doesNotMatch(outside.answer.reply, /边上|贴边|直角/);
});

test('中文坐标、左右位置和相同的数这些说法仍然成立', () => {
  const moved = askPreset('顶点移到 (负一, 二分之一)');
  assert.deepEqual(moved.answer.parameters, { a: 1, h: -1, k: 0.5 }, moved.answer.reply);
  const side = askPreset('把左右位置改成 1');
  assert.deepEqual(side.answer.parameters, { a: 1, h: 1, k: 1 }, side.answer.reply);
  assert.equal(side.answer.adjustments.length, 1);
  const same = askPreset('k 改成 1 改成 1');
  assert.equal(same.answer.changed, false, same.answer.reply);
  assert.deepEqual(same.answer.parameters, ORIGINAL);
  const half = askPreset('x 等于 1/2 时 y 是多少');
  const words = askPreset('x 等于二分之一时 y 是多少');
  assert.equal(half.answer.reads[0].values[0], words.answer.reads[0].values[0]);
});

test('圆上一个点在窗口内、一个点在窗口外时，要分开说明', () => {
  const figure = figureOf('circle', { h: 0, k: 0, r: 2 });
  figure.definition.range = { min: 0, max: 3 };
  const answer = tutor.ask(tutor.snapshotFrom(figure, { requestId: 'circle', interactive: true }), 'x 等于 0 时 y 是多少');
  assert.deepEqual(answer.reads[0].values, [2, -2]);
  assert.deepEqual(answer.reads[0].inside, [true, false]);
  assert.match(answer.reply, /有的点在窗口外/);
  assert.doesNotMatch(answer.reply, /都在当前坐标窗口内|边上|贴边/);
});

test('问句不会改写快照，拒绝语里也没有阿拉伯数字', () => {
  const snapshot = snapshotOf('parabola');
  const before = JSON.stringify(snapshot);
  const answer = tutor.ask(snapshot, '把半径改成 3');
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(answer.changed, false);
  assert.equal(/\d/.test(answer.reply), false, answer.reply);
  assert.equal(numbers.adoptValue(preset.definition.parameters.h, 0.3).adopted, 0.3);
});
