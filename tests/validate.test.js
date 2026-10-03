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

test('a region that only overflows by a rounding ulp still fits', () => {
  const fitted = validResult({
    frameSize: { width: 0.3, height: 10 },
    definition: {
      ...validResult().definition,
      region: { x: 0.1, y: 0, width: 0.2, height: 1 }
    }
  });
  assert.equal(0.1 + 0.2 > 0.3, true);
  assert.equal(validateCurveResult(fitted).ok, true);
  fitted.definition.region.width = 0.21;
  assert.equal(validateCurveResult(fitted).code, 'invalid_region');
});

test('rejects unknown equation and mismatched context', () => {
  assert.equal(validateCurveResult(validResult({
    definition: { ...validResult().definition, equationId: 'unknown' }
  })).code, 'unknown_equation');
  assert.equal(validateCurveResult(validResult(), { videoId: 'other-video' }).code, 'video_mismatch');
  assert.equal(validateCurveResult(validResult(), { targetTime: 9 }).code, 'time_mismatch');
});

test('rejects coefficients and drag targets outside the registered equation', () => {
  const unused = validResult();
  unused.definition.parameters.unused = { initial: 1, min: 0, max: 2, step: 0.1 };
  unused.definition.dragParameter = 'unused';
  assert.equal(validateCurveResult(unused).code, 'unknown_parameter');

  for (const name of ['unused', '__proto__', 'toString']) {
    const invalid = validResult();
    invalid.definition.dragParameter = name;
    assert.equal(validateCurveResult(invalid).code, 'invalid_drag_parameter');
  }
});

test('rejects finite coefficients that overflow initially or after a valid slider adjustment', () => {
  const initialOverflow = validResult();
  initialOverflow.definition.parameters.a = { initial: 1e308, min: 1e308, max: 1e308, step: 1 };
  assert.equal(validateCurveResult(initialOverflow).code, 'invalid_curve_values');

  const laterOverflow = validResult();
  laterOverflow.definition.parameters.a.max = 1e308;
  assert.equal(validateCurveResult(laterOverflow).code, 'invalid_curve_values', 'initial alone is safe but max is not');

  const shiftedOverflow = validResult();
  shiftedOverflow.definition.parameters.h.max = 1e308;
  assert.equal(validateCurveResult(shiftedOverflow).code, 'invalid_curve_values', 'extreme horizontal shift must be checked');
});

test('keeps every adjustable parabola nonzero without excluding small or negative coefficients', () => {
  for (const a of [
    { initial: 0, min: -1, max: 1, step: 0.1 },
    { initial: 1, min: 0, max: 1.2, step: 0.1 },
    { initial: -1, min: -1.2, max: 1, step: 0.1 }
  ]) {
    const degenerate = validResult();
    degenerate.definition.parameters.a = a;
    assert.equal(validateCurveResult(degenerate).code, 'invalid_curve_values');
  }

  for (const sign of [1, -1]) {
    const small = validResult();
    small.definition.parameters.a = {
      initial: sign * 0.0001,
      min: sign > 0 ? 0.00005 : -0.00015,
      max: sign > 0 ? 0.00015 : -0.00005,
      step: 0.00001
    };
    assert.equal(validateCurveResult(small).ok, true, 'small coefficient sign=' + sign);
  }
});

test('rejects finite endpoints whose span overflows drawing and slider arithmetic', () => {
  for (const key of ['domain', 'range']) {
    const wide = validResult();
    wide.definition[key] = { min: -1e308, max: 1e308 };
    assert.equal(validateCurveResult(wide).code, 'invalid_bounds');
  }
  const wideParameter = validResult();
  wideParameter.definition.parameters.h = { initial: 0, min: -1e308, max: 1e308, step: 1 };
  assert.equal(validateCurveResult(wideParameter).code, 'invalid_parameter_range');
});
