const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluators, evaluateCurve, evaluateWithParameters } = require('../extension/src/curve/evaluate');

const definition = {
  equationId: 'fixture.parabola',
  parameters: {
    a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
    h: { initial: 0, min: -2, max: 2, step: 0.1 },
    k: { initial: 0, min: -2, max: 2, step: 0.1 }
  }
};

test('registers only the fixture parabola evaluator', () => {
  assert.deepEqual(Object.keys(evaluators), ['fixture.parabola']);
});

test('evaluates the fixture parabola from initial parameters', () => {
  assert.equal(evaluateCurve(definition, 0), 0);
  assert.equal(evaluateCurve(definition, 2), 3.2);
});

test('evaluates with the supplied parameters', () => {
  assert.equal(evaluateWithParameters(definition, { a: 1, h: 1, k: -1 }, 1), -1);
});

test('rejects an unknown equation id and a non-finite x', () => {
  assert.throws(() => evaluateCurve({ equationId: 'official.parabola', parameters: {} }, 0), /未知 equationId/);
  assert.throws(() => evaluateCurve(definition, Number.NaN), TypeError);
});

test('rejects undeclared, inherited and zero parabola coefficients at evaluation', () => {
  assert.throws(() => evaluateWithParameters(definition, { a: 1, h: 0, k: 0, unused: 2 }, 1), /未知参数/);
  assert.throws(() => evaluateWithParameters(definition, Object.create({ a: 1, h: 0, k: 0 }), 1), /有限数值/);
  assert.throws(() => evaluateWithParameters(definition, { a: 0, h: 0, k: 1 }, 1), /不得为 0/);
  assert.equal(evaluateWithParameters(definition, { a: 0.0001, h: 0, k: 0 }, 2), 0.0004);
});
