/**
 * 校验、求值、会话和预制加载的边缘情况。
 * 断言写的是契约应有的行为。失败项是运行时已经打到的问题，不是夹具抄写错误。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateCurveResult } = require('../extension/src/curve/validate');
const { evaluateCurve, evaluateWithParameters } = require('../extension/src/curve/evaluate');
const { SessionController } = require('../extension/src/session/session');
const { loadPreset } = require('../extension/src/preset/load');
const preset = require('../extension/assets/presets/demo-parabola.json');

const root = path.join(__dirname, '..');

/**
 * @param {string} requestId
 * @param {number} [time]
 * @returns {object}
 */
function result(requestId, time = 12.5) {
  return {
    requestId,
    videoId: 'fixture-parabola',
    time,
    frameSize: { width: 1920, height: 1080 },
    source: 'preset',
    fallback: null,
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
    }
  };
}

/**
 * @param {number} [targetTime]
 * @returns {SessionController}
 */
function controller(targetTime = 12.5) {
  return new SessionController({
    videoId: 'fixture-parabola',
    targetTime,
    frameSize: { width: 1920, height: 1080 }
  });
}

test('rejects empty, non-object and non-finite curve results', () => {
  assert.equal(validateCurveResult(null).code, 'invalid_shape');
  assert.equal(validateCurveResult([]).code, 'invalid_request_id');
  assert.equal(validateCurveResult(result('')).code, 'invalid_request_id');
  assert.equal(validateCurveResult(result('request-1', Number.POSITIVE_INFINITY)).code, 'invalid_time');
  assert.equal(validateCurveResult(result('request-1', Number.NaN)).code, 'invalid_time');
  const missingFallback = result('request-1');
  delete missingFallback.fallback;
  assert.equal(validateCurveResult(missingFallback).code, 'invalid_fallback');
  assert.equal(validateCurveResult(result('request-1')).ok, true);
  const timeout = result('request-1');
  timeout.fallback = 'timeout';
  assert.equal(validateCurveResult(timeout).ok, true);
  const badFallback = result('request-1');
  badFallback.fallback = 'error';
  assert.equal(validateCurveResult(badFallback).code, 'invalid_fallback');
});

test('rejects broken parameter bounds, axes, regions and context mismatches', () => {
  const step = result('request-1');
  step.definition.parameters.h.step = 0;
  assert.equal(validateCurveResult(step).code, 'invalid_parameter_range');

  const outside = result('request-1');
  outside.definition.parameters.h.initial = 9;
  assert.equal(validateCurveResult(outside).code, 'invalid_parameter_range');

  const drag = result('request-1');
  drag.definition.dragParameter = 'a';
  assert.equal(validateCurveResult(drag).ok, true);
  drag.definition.dragParameter = 'missing';
  assert.equal(validateCurveResult(drag).code, 'invalid_drag_parameter');

  const domain = result('request-1');
  domain.definition.domain = { min: 4, max: 4 };
  assert.equal(validateCurveResult(domain).code, 'invalid_bounds');

  const axis = result('request-1');
  axis.definition.yAxis = 'left';
  assert.equal(validateCurveResult(axis).code, 'invalid_axis');

  const fullFrame = result('request-1');
  fullFrame.definition.region = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(validateCurveResult(fullFrame).ok, true);

  const negative = result('request-1');
  negative.definition.region = { x: -1, y: 0, width: 10, height: 10 };
  assert.equal(validateCurveResult(negative).code, 'invalid_region');

  assert.equal(validateCurveResult(result('request-1', 12.7), { targetTime: 12.5, timeTolerance: 0.2 }).ok, true);
  assert.equal(validateCurveResult(result('request-1', 12.71), { targetTime: 12.5 }).code, 'time_mismatch');
  assert.equal(validateCurveResult(result('request-1'), {
    frameSize: { width: 1280, height: 720 }
  }).code, 'frame_mismatch');
  assert.equal(validateCurveResult(result('request-1'), { requestId: 'request-2' }).code, 'request_mismatch');
  assert.equal(validateCurveResult(result('request-1'), { videoId: 'other' }).code, 'video_mismatch');
});

test('evaluates a zero initial and rejects a non-finite x', () => {
  const definition = result('request-1').definition;
  definition.parameters.h.initial = 0;
  definition.parameters.k.initial = 0;
  definition.parameters.a.initial = 1;
  assert.equal(evaluateCurve(definition, 2), 4);
  assert.throws(() => evaluateCurve(definition, Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => evaluateWithParameters(definition, { a: 1, h: 0, k: 0 }, Number.NaN), TypeError);
});

test('the shipped fixture stays finite across its domain', () => {
  assert.equal(validateCurveResult(preset).ok, true);
  for (let index = 0; index <= 80; index += 1) {
    const x = preset.definition.domain.min +
      (preset.definition.domain.max - preset.definition.domain.min) * index / 80;
    assert.equal(Number.isFinite(evaluateCurve(preset.definition, x)), true);
  }
});

test('a fixture that cannot be evaluated must not become drawable', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  const candidate = result(pending.requestId);
  candidate.definition.parameters = {
    h: { initial: 0, min: -2, max: 2, step: 0.1 }
  };
  const resolved = session.resolve(candidate);
  assert.equal(resolved.ok, false);
  assert.notEqual(session.getState().status, 'interactive');
  assert.throws(() => evaluateCurve(candidate.definition, 0), TypeError);
});

test('drag values stay finite and inside the validated range', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(pending.requestId)).ok, true);

  session.updateParameter('h', Number.NaN);
  assert.equal(Number.isFinite(session.getState().currentParameters.h), true);
  session.updateParameter('h', 'nope');
  assert.equal(Number.isFinite(session.getState().currentParameters.h), true);
  session.updateParameter('h', undefined);
  assert.equal(Number.isFinite(session.getState().currentParameters.h), true);
  assert.equal(session.updateParameter('h', null).ok, false);
  assert.equal(session.updateParameter('h', '').ok, false);
  assert.equal(session.getState().currentParameters.h, 0);

  assert.equal(session.updateParameter('h', Number.POSITIVE_INFINITY).session.currentParameters.h, 2);
  assert.equal(session.updateParameter('h', -99).session.currentParameters.h, -2);
  assert.equal(session.updateParameter('a', 1).code, 'parameter_not_draggable');
  assert.equal(session.getState().currentParameters.a, 0.8);
});

test('callers cannot widen bounds after the result has been accepted', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  const input = result(pending.requestId);
  assert.equal(session.resolve(input).ok, true);
  input.definition.parameters.h.max = 50;
  session.updateParameter('h', 40);
  assert.ok(session.getState().currentParameters.h <= 2);
});

test('getState returns a copy so callers cannot widen accepted bounds', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(pending.requestId)).ok, true);
  const exposed = session.getState().result;
  exposed.definition.parameters.h.max = 50;
  session.updateParameter('h', 40);
  assert.ok(session.getState().currentParameters.h <= 2);
  assert.equal(session.getState().result.definition.parameters.h.max, 2);
});

test('result time is compared with the session target, not only the wake instant', () => {
  const session = controller(10);
  const pending = session.beginWait({ paused: true, currentTime: 10.051 });
  assert.equal(pending.ok, true);
  const resolved = session.resolve(result(pending.requestId, 10.251));
  assert.equal(resolved.ok, false);
  assert.notEqual(session.getState().status, 'interactive');
});

test('playback or an unusable clock clears a waiting request', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.onPlaybackChange({ paused: false, currentTime: 12.5 }).status, 'paused-ready');
  assert.equal(session.resolve(result(pending.requestId)).code, 'no_pending');

  const again = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.onPlaybackChange({ paused: true, currentTime: Number.NaN }).status, 'paused-ready');
  assert.equal(session.resolve(result(again.requestId)).code, 'no_pending');
});

test('leaving the tolerance edge ends an interactive session', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  session.resolve(result(pending.requestId));
  assert.equal(session.onPlaybackChange({ paused: true, currentTime: 12.7 }).status, 'interactive');
  assert.equal(session.onPlaybackChange({ paused: true, currentTime: 12.71 }).status, 'paused-ready');
  assert.equal(session.getState().result, null);
});

test('cancel drops the request id that was waiting', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.cancel().status, 'paused-ready');
  assert.equal(session.resolve(result(pending.requestId)).code, 'no_pending');
});

test('session rejects vision results and a mismatched frame', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  const vision = result(pending.requestId);
  vision.source = 'vision';
  assert.equal(session.resolve(vision).code, 'invalid_source');
  assert.equal(session.getState().status, 'waiting');

  const frame = result(pending.requestId);
  frame.frameSize = { width: 1280, height: 720 };
  frame.definition.region = { x: 0, y: 0, width: 640, height: 360 };
  assert.equal(session.resolve(frame).code, 'frame_mismatch');
  assert.equal(session.getState().result, null);
});

test('preset loading reports disabled and invalid payloads without a drawable result', async () => {
  const original = global.fetch;
  /**
   * @param {(url: string) => { ok?: boolean, status?: number, body?: object }} route
   * @param {() => Promise<object>} run
   */
  async function withFetch(route, run) {
    global.fetch = async (url) => {
      const hit = route(String(url));
      return {
        ok: hit.ok !== false,
        status: hit.status || 200,
        json: async () => hit.body
      };
    };
    try {
      return await run();
    } finally {
      global.fetch = original;
    }
  }

  const disabled = await withFetch((url) => {
    if (url.includes('config')) {
      return {
        body: {
          enableLocalMock: false,
          prewarmed: true,
          presetKey: 'demo-parabola',
          fallbackAfterMs: 1500,
          externalAttempt: 'off'
        }
      };
    }
    return { body: preset };
  }, () => loadPreset({ configPath: 'http://local/config.json', presetBasePath: 'http://local/presets/' }));
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'preset_disabled');
  assert.equal(disabled.result, undefined);

  const invalid = await withFetch((url) => {
    if (url.includes('config')) {
      return {
        body: {
          enableLocalMock: true,
          prewarmed: true,
          presetKey: 'demo-parabola',
          fallbackAfterMs: 1500,
          externalAttempt: 'off'
        }
      };
    }
    return { body: { source: 'vision' } };
  }, () => loadPreset({ configPath: 'http://local/config.json', presetBasePath: 'http://local/presets/' }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.result, undefined);
});

test('preset loading fails closed when the validator was not loaded', () => {
  const child = spawnSync(process.execPath, ['-e', `
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        enableLocalMock: true,
        prewarmed: true,
        presetKey: 'demo-parabola',
        fallbackAfterMs: 1500,
        externalAttempt: 'off'
      })
    });
    const { loadPreset } = require('./extension/src/preset/load');
    loadPreset({ configPath: 'http://local/config.json', presetBasePath: 'http://local/presets/' })
      .then((value) => {
        if (!value || value.ok !== false || value.result) process.exit(1);
        process.exit(0);
      })
      .catch(() => process.exit(2));
  `], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0);
});
