// 提问区的数：读法、按步长取值与夹取、滑块和回答共用的格式化。
const test = require('node:test');
const assert = require('node:assert/strict');
const numbers = require('../extension/src/tutor/numbers');
const preset = require('../extension/assets/presets/demo-parabola.json');

const items = preset.definition.parameters;

test('读出阿拉伯数字、全角、负号、分数与中文数字', () => {
  const cases = [
    ['1', 1], ['-1', -1], ['+2', 2], ['0.5', 0.5], ['.5', 0.5], ['1/2', 0.5], ['-3/4', -0.75],
    ['－１.５', -1.5], ['−2', -2], ['负 1', -1], ['负一', -1], ['一点五', 1.5], ['负零点五', -0.5],
    ['十', 10], ['十二', 12], ['二十', 20], ['九十九', 99], ['两', 2], ['二分之一', 0.5], ['负四分之三', -0.75],
    ['2分之1', 0.5], ['0', 0], ['-0', 0]
  ];
  for (const [text, expected] of cases) {
    assert.equal(numbers.parseNumber(text), expected, text);
  }
  assert.equal(Object.is(numbers.parseNumber('-0'), 0), true, '-0 应写作 0');
});

test('写法不对、分母为 0 或过大的数不算', () => {
  for (const text of ['', '负', 'abc', '1/0', '零分之一', '一二', '十十', '1e309', '2000000', '1..2', null, 3]) {
    assert.equal(numbers.parseNumber(text), null, String(text));
  }
});

test('句子里的数的写法能被正则找到', () => {
  const pattern = new RegExp(numbers.NUMBER_SOURCE, 'g');
  const found = '把 k 改成 -1，再把开口改成负零点五，x 取 1/2'.match(pattern);
  assert.deepEqual(found, ['-1', '负零点五', '1/2']);
});

test('范围内且在格子上的数原样采用', () => {
  assert.deepEqual(numbers.adoptValue(items.a, 0.5), { adopted: 0.5, adjusted: false, clamped: null });
  assert.deepEqual(numbers.adoptValue(items.k, -1), { adopted: -1, adjusted: false, clamped: null });
  assert.equal(Object.is(numbers.adoptValue(items.h, 0.3).adopted, 0.3), true, '不得带出 0.30000000000000004');
  assert.equal(Object.is(numbers.adoptValue(items.h, 0).adopted, 0), true);
  assert.equal(Object.is(numbers.adoptValue(items.h, -0).adopted, 0), true, '-0 应采用为 0');
});

test('越界的数夹到上限或下限，并标明夹取', () => {
  assert.deepEqual(numbers.adoptValue(items.a, 5), { adopted: 1.2, adjusted: true, clamped: 'max' });
  assert.deepEqual(numbers.adoptValue(items.a, 0), { adopted: 0.4, adjusted: true, clamped: 'min' });
  assert.deepEqual(numbers.adoptValue(items.k, -9), { adopted: -2, adjusted: true, clamped: 'min' });
});

test('两格之间取最近一格；等距时取更靠近 0 的一格', () => {
  assert.equal(numbers.adoptValue(items.a, 0.56).adopted, 0.6);
  assert.equal(numbers.adoptValue(items.a, 0.54).adopted, 0.5);
  assert.equal(numbers.adoptValue(items.a, 0.55).adopted, 0.5);
  assert.equal(numbers.adoptValue(items.k, -0.55).adopted, -0.5);
  assert.equal(numbers.adoptValue(items.h, 1 / 3).adopted, 0.3);
  assert.equal(numbers.adoptValue(items.h, 0.55).adjusted, true);
  const grid = { min: -1, max: 1, step: 0.2 };
  assert.equal(numbers.adoptValue(grid, 0.1).adopted, 0);
  assert.equal(numbers.adoptValue(grid, -0.1).adopted, 0);
  const symmetric = { min: -0.1, max: 0.1, step: 0.2 };
  assert.equal(numbers.adoptValue(symmetric, 0).adopted, 0.1, '两格离 0 一样远时取较大的一格');
});

test('没有步长时只夹取；定义不完整时不给值', () => {
  assert.deepEqual(numbers.adoptValue({ min: 0, max: 1 }, 0.123), { adopted: 0.123, adjusted: false, clamped: null });
  assert.equal(numbers.adoptValue({ min: 0, max: 1 }, NaN), null);
  assert.equal(numbers.adoptValue({ min: 1, max: 0, step: 0.1 }, 0.5), null);
  assert.equal(numbers.adoptValue(undefined, 0.5), null);
});

/**
 * 改动前页面滑块标签的写法，用来确认搬进 numbers.js 后结果不变。
 * @param {number} value
 * @param {{ step: number } | undefined} item
 * @returns {string}
 */
function legacySliderLabel(value, item) {
  const precision = item && item.step > 0 ? Math.min(12, Math.max(1, -Math.floor(Math.log10(item.step)))) : 1;
  const rounded = Number(value.toFixed(precision));
  const tolerance = Math.max(Number.EPSILON * Math.max(Math.abs(value), Math.abs(rounded)) * 32, item ? item.step * 1e-9 : 0);
  return (rounded !== 0 || value === 0) && Math.abs(rounded - value) <= tolerance
    ? value.toFixed(precision) : String(Number(value.toPrecision(12)));
}

test('系数写法与原来的滑块标签逐个一致', () => {
  const steps = [undefined, { step: 0.1 }, { step: 0.05 }, { step: 0.25 }, { step: 1 }, { step: 0.001 }];
  const values = [0, 1, -1, 1.2, 0.3, 0.1 + 0.2, -2, 0.123456, 1e-7, 12.5, -0.55, 2 / 3, 1234.5678];
  for (const item of steps) {
    for (const value of values) {
      assert.equal(numbers.formatParameter(value, item), legacySliderLabel(value, item), `${value} @ ${item && item.step}`);
    }
  }
  assert.equal(numbers.formatParameter(1, items.a), '1.0');
  assert.equal(numbers.formatParameter(-1, items.k), '-1.0');
  assert.equal(numbers.formatParameter(0.1 + 0.2, items.h), '0.3');
});

test('读数最多 4 位小数，-0 写作 0', () => {
  assert.equal(numbers.formatReading(2), '2');
  assert.equal(numbers.formatReading(2.00004), '2');
  assert.equal(numbers.formatReading(1 / 3), '0.3333');
  assert.equal(numbers.formatReading(-1.5), '-1.5');
  assert.equal(numbers.formatReading(-0.00001), '0');
  assert.equal(numbers.formatReading(NaN), '');
});
