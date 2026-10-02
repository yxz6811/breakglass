const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');

function result(requestId, overrides = {}) {
  return {
    requestId,
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

function controller(options = {}) {
  return new SessionController({
    videoId: 'fixture-parabola',
    targetTime: 12.5,
    frameSize: { width: 1920, height: 1080 },
    ...options
  });
}

test('only wakes while paused at the target time', () => {
  const session = controller();
  assert.equal(session.beginWait({ paused: false, currentTime: 12.5 }).code, 'not_ready');
  assert.equal(session.beginWait({ paused: true, currentTime: 10 }).code, 'not_ready');
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).ok, true);
});

test('resolves, clamps the drag parameter and resets without leaving', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(pending.requestId)).ok, true);
  assert.equal(session.updateParameter('h', 99).session.currentParameters.h, 2);
  assert.equal(session.reset().session.currentParameters.h, 0);
  assert.equal(session.getState().status, 'interactive');
});

test('old request results cannot replace a newer wait', () => {
  const session = controller();
  const first = session.beginWait({ paused: true, currentTime: 12.5 });
  session.cancel();
  const second = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(first.requestId)).ok, false);
  assert.equal(session.resolve(result(second.requestId)).ok, true);
});

test('non-off external attempts wait, and never report vision success', () => {
  for (const externalAttempt of ['hang', 'invalid', 'late']) {
    const session = controller({ externalAttempt });
    const started = session.beginWait({ paused: true, currentTime: 12.5 });
    assert.equal(started.ok, true);
    assert.equal(session.getState().status, 'waiting');
    assert.equal(session.getState().result, null, '等待中不得有可绘制结果');
    // 外部候选如果标成 vision，仍然被确定性校验拒绝（本功能没有 vision 生产者）。
    assert.equal(session.resolve(result(started.requestId, { source: 'vision' })).ok, false);
    assert.notEqual(session.getState().status, 'interactive');
    assert.equal(session.getState().result, null);
    // 失败路径只留下可恢复错误，不留下曲线。
    session.fail('external_invalid', '外部结果不可用，未进入交互。');
    assert.equal(session.getState().status, 'recoverable-error');
    assert.equal(session.getState().result, null);
    // 可恢复错误之后可以重新等待。
    assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).ok, true);
  }
});

test('fail() clears the pending state and keeps the reason for retry', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  const state = session.fail('no_preset', '当前帧没有可用的准备结果，无法进入交互。');
  assert.equal(state.status, 'recoverable-error');
  assert.equal(state.requestId, null);
  assert.equal(state.result, null);
  assert.equal(session.error.code, 'no_preset');
  assert.equal(session.resolve(result(pending.requestId)).ok, false);
  assert.equal(session.cancel().status, 'paused-ready');
  assert.equal(session.error, null);
});

test('only one session may be active at a time', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).code, 'session_active');
  assert.equal(session.resolve(result(pending.requestId)).ok, true);
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).code, 'session_active');
  session.exit();
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).ok, true);
});

test('playing or leaving the target time ends a pending or interactive session', () => {
  const waiting = controller();
  const pending = waiting.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(waiting.onPlaybackChange({ paused: false, currentTime: 12.5 }).status, 'paused-ready');
  assert.equal(waiting.resolve(result(pending.requestId)).ok, false);

  const interactive = controller();
  const request = interactive.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(interactive.resolve(result(request.requestId)).ok, true);
  assert.equal(interactive.onPlaybackChange({ paused: true, currentTime: 10 }).status, 'paused-ready');
  assert.equal(interactive.getState().result, null);
});

test('exit clears the active session and returns to paused-ready', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  session.resolve(result(pending.requestId));
  assert.equal(session.exit().status, 'paused-ready');
  assert.equal(session.getState().result, null);
});
