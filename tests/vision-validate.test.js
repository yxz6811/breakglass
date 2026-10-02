/**
 * T003：识别样例（vision）的校验夹具。实现见 extension/src/curve/validate.js（T004）。
 * 这些用例在 T004 之前必须失败。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCurveResult } = require('../extension/src/curve/validate');

const FRAME = { width: 1920, height: 1080 };
const ALLOW_VISION = { allowVision: true };

function definition(overrides = {}) {
  return {
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
    region: { x: 100, y: 80, width: 640, height: 360 },
    ...overrides
  };
}

function visionCandidate(overrides = {}) {
  return {
    requestId: 'fixture-request',
    videoId: 'fixture-parabola',
    time: 12.5,
    frameSize: { ...FRAME },
    source: 'vision',
    fallback: null,
    evidence: 'packaged-sample',
    definition: definition(),
    ...overrides
  };
}

function presetCandidate(overrides = {}) {
  const candidate = visionCandidate({ source: 'preset', ...overrides });
  // 只有调用方没有显式给 evidence 时才去掉它（用于验证「预制不得夹带 evidence」）。
  if (!Object.prototype.hasOwnProperty.call(overrides, 'evidence')) delete candidate.evidence;
  return candidate;
}

test('没有 allowVision 时 vision 仍被拒绝', () => {
  const result = validateCurveResult(visionCandidate());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_source');
});

test('allowVision 且 evidence 为 packaged-sample、fallback 为 null、confidence 缺省时通过', () => {
  const result = validateCurveResult(visionCandidate(), ALLOW_VISION);
  assert.equal(result.ok, true);
  assert.equal(result.value.source, 'vision');
  assert.equal(result.value.fallback, null);
  assert.equal(result.value.evidence, 'packaged-sample');
  assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'confidence'), false, '不得补写 confidence');
  assert.equal(result.value.confidence, undefined);
});

test('evidence 缺失或不是 packaged-sample 都拒绝', () => {
  const missing = visionCandidate();
  delete missing.evidence;
  assert.equal(validateCurveResult(missing, ALLOW_VISION).ok, false);
  for (const evidence of ['', 'live', 'vision', 'PACKAGED-SAMPLE', 1, null]) {
    const result = validateCurveResult(visionCandidate({ evidence }), ALLOW_VISION);
    assert.equal(result.ok, false, 'evidence=' + JSON.stringify(evidence));
  }
});

test('vision 的 fallback 必须是 null', () => {
  const result = validateCurveResult(visionCandidate({ fallback: 'timeout' }), ALLOW_VISION);
  assert.equal(result.ok, false);
});

test('confidence 存在时必须是 0 到 1 的有限数', () => {
  for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1, 1.1, '0.9', null]) {
    const result = validateCurveResult(visionCandidate({ confidence }), ALLOW_VISION);
    assert.equal(result.ok, false, 'confidence=' + String(confidence));
  }
  for (const confidence of [0.5, 0.75, 1]) {
    assert.equal(validateCurveResult(visionCandidate({ confidence }), ALLOW_VISION).ok, true, 'confidence=' + confidence);
  }
  // 0 是合法有限数，但低于 0.5 门槛，属于低可信度拒绝。
  assert.equal(validateCurveResult(visionCandidate({ confidence: 0 }), ALLOW_VISION).code, 'low_confidence');
});

test('confidence 低于 0.5 拒绝，等于 0.5 通过', () => {
  assert.equal(validateCurveResult(visionCandidate({ confidence: 0.49 }), ALLOW_VISION).ok, false);
  const boundary = validateCurveResult(visionCandidate({ confidence: 0.5 }), ALLOW_VISION);
  assert.equal(boundary.ok, true);
  assert.equal(boundary.value.confidence, 0.5);
});

test('confidence 缺省时不显示也不编造百分比', () => {
  const result = validateCurveResult(visionCandidate(), ALLOW_VISION);
  assert.equal(result.ok, true);
  assert.equal('confidence' in result.value, false);
  assert.equal(JSON.stringify(result.value).includes('percent'), false);
});

test('preset 携带 evidence 被拒绝', () => {
  const result = validateCurveResult(presetCandidate({ evidence: 'packaged-sample' }), ALLOW_VISION);
  assert.equal(result.ok, false);
  assert.equal(validateCurveResult(presetCandidate(), ALLOW_VISION).ok, true, '普通预制结果不受影响');
});

test('001 的既有拒绝条件仍然生效', () => {
  const withoutTime = visionCandidate();
  delete withoutTime.time;
  assert.equal(validateCurveResult(withoutTime, ALLOW_VISION).code, 'invalid_time', '非有限 time');
  assert.equal(validateCurveResult(visionCandidate({ videoId: '' }), ALLOW_VISION).code, 'invalid_video_id');
  assert.equal(validateCurveResult(visionCandidate({ definition: definition({ equationId: 'nope.curve' }) }), ALLOW_VISION).code, 'unknown_equation');
  assert.equal(validateCurveResult(visionCandidate({ definition: definition({ region: { x: 1900, y: 80, width: 640, height: 360 } }) }), ALLOW_VISION).code, 'invalid_region', '越界 region');
  assert.equal(validateCurveResult(visionCandidate({ frameSize: { width: 0, height: 1080 } }), ALLOW_VISION).code, 'invalid_frame_size');
  const noDrag = definition();
  delete noDrag.dragParameter;
  assert.equal(validateCurveResult(visionCandidate({ definition: noDrag }), ALLOW_VISION).code, 'invalid_drag_parameter');
  const incomplete = definition();
  delete incomplete.parameters.k;
  assert.equal(validateCurveResult(visionCandidate({ definition: incomplete }), ALLOW_VISION).code, 'incomplete_parameters');
});

test('上下文不匹配仍然拒绝（视频、时间、画幅、请求号）', () => {
  const context = { allowVision: true, videoId: 'fixture-parabola', targetTime: 12.5, frameSize: { ...FRAME }, requestId: 'fixture-request' };
  assert.equal(validateCurveResult(visionCandidate(), context).ok, true, '全部匹配时通过');
  assert.equal(validateCurveResult(visionCandidate(), { ...context, videoId: 'other' }).code, 'video_mismatch');
  assert.equal(validateCurveResult(visionCandidate(), { ...context, targetTime: 13.1 }).code, 'time_mismatch');
  assert.equal(validateCurveResult(visionCandidate(), { ...context, frameSize: { width: 1280, height: 720 } }).code, 'frame_mismatch');
  assert.equal(validateCurveResult(visionCandidate(), { ...context, requestId: 'other' }).code, 'request_mismatch');
  assert.equal(validateCurveResult(visionCandidate({ time: 12.7 }), context).ok, true, '±0.2 秒内仍通过');
});

test('夹具本身不含密钥、上传地址或模型名', () => {
  const text = JSON.stringify(visionCandidate({ confidence: 0.9 }));
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /api[_-]?key|secret|token|authorization|model/i);
});
