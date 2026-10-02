/**
 * 识别样例的校验夹具。T004 完成前，证据与置信度相关的用例应当失败。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCurveResult, DEFAULT_TIME_TOLERANCE } = require('../extension/src/curve/validate');

const ALLOW_VISION = { allowVision: true };

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function visionResult(overrides = {}) {
  return {
    requestId: 'request-vision-1',
    videoId: 'fixture-parabola',
    time: 6,
    frameSize: { width: 1920, height: 1080 },
    source: 'vision',
    fallback: null,
    evidence: 'packaged-sample',
    definition: {
      equationId: 'fixture.parabola',
      parameters: {
        a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
        h: { initial: 0, min: -2, max: 2, step: 0.1 },
        k: { initial: 0, min: -2, max: 2, step: 0.1 }
      },
      dragParameter: 'h',
      domain: { min: -4, max: 4 },
      range: { min: -4, max: 4 },
      yAxis: 'up',
      region: { x: 480, y: 220, width: 960, height: 620 }
    },
    ...overrides
  };
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function presetResult(overrides = {}) {
  return visionResult({
    requestId: 'request-preset-1',
    source: 'preset',
    evidence: undefined,
    ...overrides
  });
}

test('rejects vision unless allowVision is exactly true', () => {
  const blocked = validateCurveResult(visionResult());
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'invalid_source');
  assert.equal(validateCurveResult(visionResult(), { allowVision: false }).code, 'invalid_source');
});

test('accepts a packaged vision sample without inventing confidence', () => {
  const input = visionResult();
  delete input.confidence;
  const result = validateCurveResult(input, ALLOW_VISION);
  assert.equal(result.ok, true);
  assert.equal(result.value.source, 'vision');
  assert.equal(result.value.evidence, 'packaged-sample');
  assert.equal(result.value.fallback, null);
  assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'confidence'), false);
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|model/i.test(JSON.stringify(input)), false);
});

test('rejects vision samples without packaged-sample evidence', () => {
  const missing = visionResult();
  delete missing.evidence;
  assert.equal(validateCurveResult(missing, ALLOW_VISION).code, 'invalid_evidence');
  assert.equal(validateCurveResult(visionResult({ evidence: 'live' }), ALLOW_VISION).code, 'invalid_evidence');
  assert.equal(validateCurveResult(visionResult({ evidence: null }), ALLOW_VISION).code, 'invalid_evidence');
});

test('rejects vision samples whose fallback is not null', () => {
  assert.equal(validateCurveResult(visionResult({ fallback: 'timeout' }), ALLOW_VISION).ok, false);
});

test('rejects preset results that carry evidence', () => {
  assert.equal(validateCurveResult(presetResult({ evidence: 'packaged-sample' })).code, 'invalid_evidence');
});

test('checks confidence only when it is present', () => {
  const absent = visionResult();
  delete absent.confidence;
  assert.equal(validateCurveResult(absent, ALLOW_VISION).ok, true);

  assert.equal(validateCurveResult(visionResult({ confidence: 0.5 }), ALLOW_VISION).ok, true);
  assert.equal(validateCurveResult(visionResult({ confidence: 1 }), ALLOW_VISION).ok, true);
  assert.equal(validateCurveResult(visionResult({ confidence: 0.49 }), ALLOW_VISION).code, 'invalid_confidence');
  assert.equal(validateCurveResult(visionResult({ confidence: 0 }), ALLOW_VISION).code, 'invalid_confidence');
  assert.equal(validateCurveResult(visionResult({ confidence: -0.1 }), ALLOW_VISION).code, 'invalid_confidence');
  assert.equal(validateCurveResult(visionResult({ confidence: 1.1 }), ALLOW_VISION).code, 'invalid_confidence');
  assert.equal(validateCurveResult(visionResult({ confidence: Number.NaN }), ALLOW_VISION).code, 'invalid_confidence');
  const passed = validateCurveResult(visionResult({ confidence: 0.5 }), ALLOW_VISION);
  assert.equal(passed.value.confidence, 0.5);
});

test('still rejects broken vision samples for shape, region, equation and video', () => {
  assert.equal(validateCurveResult(visionResult({ time: Number.NaN }), ALLOW_VISION).code, 'invalid_time');
  const stepped = visionResult();
  stepped.definition = {
    ...stepped.definition,
    parameters: {
      ...stepped.definition.parameters,
      h: { initial: 0, min: -2, max: 2, step: 0 }
    }
  };
  assert.equal(validateCurveResult(stepped, ALLOW_VISION).code, 'invalid_parameter_range');
  const outside = visionResult();
  outside.definition = {
    ...outside.definition,
    region: { x: 1800, y: 0, width: 200, height: 100 }
  };
  assert.equal(validateCurveResult(outside, ALLOW_VISION).code, 'invalid_region');
  const unknown = visionResult();
  unknown.definition = { ...unknown.definition, equationId: 'unknown.curve' };
  assert.equal(validateCurveResult(unknown, ALLOW_VISION).code, 'unknown_equation');
  assert.equal(validateCurveResult(visionResult(), {
    allowVision: true,
    videoId: 'other-video'
  }).code, 'video_mismatch');
});

test('compares vision time in seconds with the default tolerance', () => {
  assert.equal(DEFAULT_TIME_TOLERANCE, 0.2);
  const onEdge = validateCurveResult(visionResult({ time: 0.2 }), {
    allowVision: true,
    targetTime: 0
  });
  assert.equal(onEdge.ok, true);
  assert.equal(validateCurveResult(visionResult({ time: 0.41 }), {
    allowVision: true,
    targetTime: 0
  }).code, 'time_mismatch');
});
