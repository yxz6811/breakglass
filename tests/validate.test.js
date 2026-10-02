const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCurveResult } = require('../extension/src/curve/validate');

function validResult(overrides = {}) {
  return {
    requestId: 'request-1',
    videoId: 'fixture-parabola',
    time: 12.5,
    frameSize: { width: 1920, height: 1080 },
    source: 'preset',
    fallback: null,
    definition: {
      equationId: 'fixture.parabola',
      parameters: {
        a: { initial: 1, min: 0.4, max: 1.2, step: 0.1 },
        h: { initial: 0, min: -2, max: 2, step: 0.1 },
        k: { initial: 0, min: -2, max: 2, step: 0.1 }
      },
      dragParameter: 'h',
      domain: { min: -4, max: 4 },
      range: { min: -4, max: 4 },
      yAxis: 'up',
      region: { x: 100, y: 80, width: 640, height: 360 }
    },
    ...overrides
  };
}

test('accepts a valid preset result', () => {
  assert.equal(validateCurveResult(validResult()).ok, true);
});

test('rejects vision results in the P0 preset path', () => {
  const result = validateCurveResult(validResult({ source: 'vision' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_source');
});

test('rejects missing fields, non-finite values and invalid region', () => {
  assert.equal(validateCurveResult(validResult({ requestId: '' })).ok, false);
  assert.equal(validateCurveResult(validResult({ time: Number.NaN })).ok, false);
  assert.equal(validateCurveResult(validResult({
    definition: { ...validResult().definition, region: { x: 1800, y: 0, width: 200, height: 100 } }
  })).code, 'invalid_region');
});

test('rejects unknown equation and mismatched context', () => {
  assert.equal(validateCurveResult(validResult({
    definition: { ...validResult().definition, equationId: 'unknown' }
  })).code, 'unknown_equation');
  assert.equal(validateCurveResult(validResult(), { videoId: 'other-video' }).code, 'video_mismatch');
  assert.equal(validateCurveResult(validResult(), { targetTime: 9 }).code, 'time_mismatch');
});
