// 契约测试：ownership.md「交接接口」登记的 createWake 形状必须真实可用。
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');
const { createWake } = require('../extension/src/session/wake');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const VIDEO_ID = 'fixture-parabola';
const TARGET_TIME = 12.5;
const FRAME = { width: 1920, height: 1080 };

function presetResult(overrides = {}) {
  return {
    requestId: 'fixture-request-001',
    videoId: VIDEO_ID,
    time: TARGET_TIME,
    frameSize: { ...FRAME },
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
      region: { x: 100, y: 80, width: 640, height: 360 }
    },
    ...overrides
  };
}

function setup({ externalAttempt = 'off', preset = presetResult(), config = {} } = {}) {
  const clock = createFakeClock();
  const session = new SessionController({
    videoId: VIDEO_ID,
    targetTime: TARGET_TIME,
    frameSize: { ...FRAME },
    externalAttempt
  });
  const states = [];
  const wake = createWake({
    session,
    config: { enableLocalMock: true, prewarmed: true, fallbackAfterMs: 1500, externalAttempt, ...config },
    preset,
    now: () => clock.now(),
    schedule: (handler, delayMs) => clock.schedule(delayMs, handler),
    clearTimer: (handle) => clock.clear(handle),
    onChange: (state) => states.push(state)
  });
  return { clock, session, wake, states };
}

function start(wake) {
  return wake.start({ paused: true, currentTime: TARGET_TIME, frameSize: { ...FRAME } });
}

test('createWake 暴露 ownership.md 登记的方法', () => {
  const { wake } = setup();
  for (const name of ['start', 'cancel', 'exit', 'onPlaybackChange', 'dispose', 'getState']) {
    assert.equal(typeof wake[name], 'function', '缺少方法 ' + name);
  }
});

test('off：start 立即进入交互，source 为 preset、fallback 为 null', () => {
  const { clock, wake, states } = setup();
  const state = start(wake);
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.source, 'preset');
  assert.equal(state.result.fallback, null);
  assert.equal(clock.pending(), 0, '主路径不得留下定时器');
  assert.equal(states.length >= 1, true);
  assert.equal(states[states.length - 1].status, 'interactive');
});

test('hang：start 进入 waiting，1500ms 后无需再次点击即回退', () => {
  const { clock, wake, states } = setup({ externalAttempt: 'hang' });
  assert.equal(start(wake).status, 'waiting');
  clock.advance(1499);
  assert.equal(wake.getState().status, 'waiting');
  clock.advance(1);
  const settled = wake.getState();
  assert.equal(settled.status, 'interactive');
  assert.equal(settled.result.source, 'preset');
  assert.equal(settled.result.fallback, 'timeout');
  assert.equal(states.some((state) => state.result && state.result.fallback === 'timeout'), true);
});

test('invalid：recoverable-error 带 code 与 message，且没有可绘制结果', async () => {
  const { clock, wake } = setup({ externalAttempt: 'invalid' });
  assert.equal(start(wake).status, 'waiting');
  clock.advance(0);
  await flush();
  const state = wake.getState();
  assert.equal(state.status, 'recoverable-error');
  assert.equal(state.result, null);
  assert.equal(typeof state.code, 'string');
  assert.equal(typeof state.message, 'string');
});

test('config 决定行为：未预热时超时也进入可恢复错误', () => {
  const { clock, wake } = setup({ externalAttempt: 'hang', config: { prewarmed: false } });
  start(wake);
  clock.advance(1500);
  const state = wake.getState();
  assert.equal(state.status, 'recoverable-error');
  assert.equal(state.code, 'no_preset');
  assert.equal(state.result, null);
});

test('cancel / exit / dispose 都清理定时器', () => {
  const cancelling = setup({ externalAttempt: 'hang' });
  start(cancelling.wake);
  assert.equal(cancelling.clock.pending(), 1);
  assert.equal(cancelling.wake.cancel().status, 'paused-ready');
  assert.equal(cancelling.clock.pending(), 0);

  const exiting = setup({ externalAttempt: 'hang' });
  start(exiting.wake);
  assert.equal(exiting.wake.exit().status, 'paused-ready');
  assert.equal(exiting.clock.pending(), 0);
  assert.equal(exiting.session.status, 'paused-ready');

  const disposing = setup({ externalAttempt: 'hang' });
  start(disposing.wake);
  disposing.wake.dispose();
  assert.equal(disposing.clock.pending(), 0);
  assert.equal(disposing.wake.isWaiting(), false);
});

test('onPlaybackChange 会结束等待', () => {
  const { clock, wake } = setup({ externalAttempt: 'hang' });
  start(wake);
  const state = wake.onPlaybackChange({ paused: false, currentTime: TARGET_TIME });
  assert.equal(state.status, 'paused-ready');
  assert.equal(clock.pending(), 0);
  assert.equal(wake.isWaiting(), false);
});

test('不在目标时间时 start 返回 not_ready', () => {
  const { wake } = setup();
  const state = wake.start({ paused: true, currentTime: 9, frameSize: { ...FRAME } });
  assert.equal(state.ok, false);
  assert.equal(state.code, 'not_ready');
});
