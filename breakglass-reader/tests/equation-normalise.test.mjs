import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEquation, EQUATION_LIMITS } from '../src/equation-normalise.mjs';

test('general coefficient conversion is deterministic and agrees with its original polynomial', () => {
  const candidates = [
    { form: 'general', a: 1.1, b: -1.1, c: -1 },
    { form: 'general', a: -2, b: 8, c: 3 },
    { form: 'general', a: 0.25, b: 1.5, c: -2 },
    { form: 'general', a: 1e-6, b: 0, c: 1e6 }
  ];
  const converted = normaliseEquation(candidates[0]);
  assert.equal(converted.form, 'general');
  assert.equal(converted.params.h, 0.5);
  assert.ok(Math.abs(converted.params.k + 1.275) < 1e-12);
  for (const raw of candidates) {
    const value = normaliseEquation(raw); assert.equal(value.ok, true);
    for (const x of [-10, -3, 0, 4, 10]) {
      const original = raw.a * x * x + raw.b * x + raw.c;
      const actual = value.params.a * (x - value.params.h) ** 2 + value.params.k;
      assert.ok(Math.abs(original - actual) <= 1e-10 * Math.max(1, Math.abs(original)));
    }
  }
});
test('vertex and old a/h/k retain coefficients, exact limits and a sign', () => {
  for (const a of [EQUATION_LIMITS.minimumA, -EQUATION_LIMITS.minimumA, 1e6, -1e6]) {
    for (const raw of [{ a, h: -1e6, k: 1e6 }, { form: 'vertex', a, h: -1e6, k: 1e6 }]) {
      const result = normaliseEquation(raw); assert.equal(result.ok, true);
      assert.deepEqual(result.params, { a, h: -1e6, k: 1e6 });
    }
  }
  assert.deepEqual(normaliseEquation({ form: 'general', a: 1, b: 0, c: 0 }).params, { a: 1, h: 0, k: 0 });
});
test('reject incomplete/unknown, string, nonfinite, out-of-range and unsafe normalized values', () => {
  const cases = [null, [], 'y=x²', { a: 1, h: 0 }, { form: 'other', a: 1, h: 0, k: 0 },
    { form: 'general', a: 1, b: 0, c: 0, h: 0 }, { a: 1, h: 0, k: 0, confidence: 1 },
    { a: '1', h: 0, k: 0 }, { a: true, h: 0, k: 0 }, { a: null, h: 0, k: 0 },
    { a: NaN, h: 0, k: 0 }, { a: 1, h: Infinity, k: 0 }, { a: 0, h: 0, k: 0 },
    { a: 1e-7, h: 0, k: 0 }, { a: 1e6 + 1, h: 0, k: 0 }, { a: 1, h: 0, k: -1e6 - 1 },
    { form: 'general', a: 1e-6, b: 10, c: 0 }, // h outside the allowed range
    { form: 'general', a: 1, b: 1e6, c: 0 }, // k outside the allowed range
    { form: 'general', a: 1, b: Number.MAX_VALUE, c: 0 },
    Object.assign(Object.create({ inherited: true }), { a: 1, h: 0, k: 0 })];
  for (const candidate of cases) assert.deepEqual(normaliseEquation(candidate), { ok: false, reason: 'equation_invalid' });
});
test('never execute accessors, toJSON, inherited fields or symbol fields', () => {
  let invoked = 0;
  const candidate = { h: 0, k: 0 };
  Object.defineProperty(candidate, 'a', { enumerable: true, get() { invoked++; return 1; } });
  assert.equal(normaliseEquation(candidate).ok, false); assert.equal(invoked, 0);
  assert.equal(normaliseEquation({ a: 1, h: 0, k: 0, toJSON() { invoked++; return {}; } }).ok, false);
  assert.equal(normaliseEquation({ a: 1, h: 0, k: 0, [Symbol('extra')]: true }).ok, false);
  assert.equal(invoked, 0);
  assert.equal(normaliseEquation(Object.assign(Object.create(null), { a: 1, h: 0, k: 0 })).ok, true);
});
test('general conversion never reads absent h/k through inherited getters', () => {
  const previous = ['h', 'k'].map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]);
  let invoked = 0; let result;
  try {
    for (const [key] of previous) Object.defineProperty(Object.prototype, key, { configurable: true,
      get() { invoked++; throw new Error('inherited getter should never run'); } });
    result = normaliseEquation({ form: 'general', a: 1, b: -2, c: 3 });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
  assert.equal(invoked, 0);
  assert.deepEqual(result, { ok: true, params: { a: 1, h: 1, k: 2 }, form: 'general' });
});
