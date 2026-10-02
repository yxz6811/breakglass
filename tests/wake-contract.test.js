/**
 * 交接接口契约：以 `.specify/memory/constitution.md` 1.3.0「交接接口」为准。
 * 这里只锁形状（工厂入参、返回方法、状态字段、错误码），行为细节在 wake-timeout.test.js。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SessionController } = require('../extension/src/session/session');
const wakeApi = require('../extension/src/session/wake');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const FRAME = { width: 1920, height: 1080 };
const TARGET_TIME = 12.5;
const WAKE_METHODS = ['start', 'cancel', 'exit', 'onPlaybackChange', 'dispose'];
const WAKE_OPTIONS = ['session', 'config', 'preset', 'clock', 'onChange', 'attempt'];
const STATE_KEYS = ['status', 'requestId', 'result', 'currentParameters', 'initialParameters', 'code', 'message'];

function preset(overrides = {}) {
  return {
    requestId: 'fixture-request',
    videoId: 'fixture-parabola',
    time: TARGET_TIME,
    frameSize: { ...FRAME },
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

function setup({ externalAttempt = 'off', config = {}, attempt } = {}) {
  const clock = createFakeClock();
  const session = new SessionController({
    videoId: 'fixture-parabola',
    targetTime: TARGET_TIME,
    frameSize: { ...FRAME },
    externalAttempt
  });
  const states = [];
  const wake = wakeApi.createWake({
    session,
    config: { enableLocalMock: true, prewarmed: true, fallbackAfterMs: 1500, externalAttempt, ...config },
    preset: preset(),
    clock,
    onChange: (state) => states.push(state),
    ...(attempt ? { attempt } : {})
  });
  return { clock, session, wake, states };
}

function start(wake) {
  return wake.start({ paused: true, currentTime: TARGET_TIME, frameSize: { ...FRAME } });
}

function latest(states) {
  return states[states.length - 1];
}

test('wake 只导出 createWake，入参与返回方法与冻结契约一致', () => {
  assert.deepEqual(Object.keys(wakeApi), ['createWake']);
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'session', 'wake.js'), 'utf8');
  const signature = /function createWake\(\{([^}]*)\}/.exec(source);
  assert.ok(signature, '找不到 createWake 的签名');
  const params = signature[1].split(',').map((item) => item.trim().split(/[=\s]/)[0]).filter(Boolean);
  assert.deepEqual(params, WAKE_OPTIONS);
  const { wake } = setup();
  assert.deepEqual(Object.keys(wake).sort(), [...WAKE_METHODS].sort());
  for (const name of WAKE_METHODS) assert.equal(typeof wake[name], 'function', name + ' 必须是函数');
});

test('onChange 收到与 getState() 同形的状态，且不带被禁的别名字段', () => {
  const { wake, states, session } = setup();
  start(wake);
  assert.equal(states.length >= 1, true);
  const state = latest(states);
  assert.deepEqual(Object.keys(state).sort(), [...STATE_KEYS].sort());
  assert.deepEqual(Object.keys(state).sort(), Object.keys(session.getState()).sort());
  for (const banned of ['reason', 'decisionAt', 'fallback', 'onOutcome', 'isWaiting']) {
    assert.equal(banned in state, false, '状态里不得出现 ' + banned);
  }
});

test('off：start 立即进入交互，来源是 preset 且 fallback 为 null', () => {
  const { clock, wake, states } = setup();
  const started = start(wake);
  assert.equal(started.ok, true);
  assert.equal(typeof started.requestId, 'string');
  const state = latest(states);
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.source, 'preset');
  assert.equal(state.result.fallback, null);
  assert.equal(clock.pending(), 0, '主路径不得留下定时器');
});

test('start 未到目标时间时返回 not_ready，会话不进入可恢复错误', () => {
  const { wake, states } = setup();
  const started = wake.start({ paused: true, currentTime: 3, frameSize: { ...FRAME } });
  assert.equal(started.ok, false);
  assert.equal(started.code, 'not_ready');
  assert.equal(typeof started.message, 'string');
  assert.equal(latest(states).status, 'paused-ready');
});

test('hang：先 waiting，满 fallbackAfterMs 后自动回退为交互', () => {
  const { clock, wake, states } = setup({ externalAttempt: 'hang' });
  assert.equal(start(wake).ok, true);
  assert.equal(latest(states).status, 'waiting');
  assert.equal(clock.pending() >= 1, true, '等待期间必须有看门狗');
  clock.advance(1499);
  assert.equal(latest(states).status, 'waiting');
  clock.advance(1);
  const settled = latest(states);
  assert.equal(settled.status, 'interactive');
  assert.equal(settled.result.source, 'preset');
  assert.equal(settled.result.fallback, 'timeout');
});

test('invalid：外部结果不可用时进入可恢复错误，result 为 null', async () => {
  const { clock, wake, states } = setup({ externalAttempt: 'invalid' });
  start(wake);
  clock.advance(0);
  await flush();
  const state = latest(states);
  assert.equal(state.status, 'recoverable-error');
  assert.equal(state.result, null);
  assert.equal(typeof state.code, 'string');
  assert.equal(state.code.length > 0, true);
  // 现状：校验器的 code（如 invalid_definition）会透传给会话，尚未收敛到交接接口表里的三种。
  // 页面只按 message 显示文案，所以这里锁 message。
  assert.equal(state.message, '外部结果不可用，未进入交互。');
});

test('cancel、exit 与 dispose 都会清掉看门狗', () => {
  const cancelling = setup({ externalAttempt: 'hang' });
  start(cancelling.wake);
  assert.equal(cancelling.wake.cancel().status, 'paused-ready');
  assert.equal(cancelling.clock.pending(), 0);

  const exiting = setup({ externalAttempt: 'hang' });
  start(exiting.wake);
  assert.equal(exiting.wake.exit().status, 'paused-ready');
  assert.equal(exiting.clock.pending(), 0);

  const disposing = setup({ externalAttempt: 'hang' });
  start(disposing.wake);
  disposing.wake.dispose();
  assert.equal(disposing.clock.pending(), 0);
});

test('onPlaybackChange 结束等待并返回会话状态', () => {
  const { clock, wake } = setup({ externalAttempt: 'hang' });
  start(wake);
  const state = wake.onPlaybackChange({ paused: false, currentTime: TARGET_TIME });
  assert.equal(state.status, 'paused-ready');
  assert.equal(clock.pending(), 0);
});

test('测试可以注入 attempt，注入对象会被 start 与 abort', () => {
  const calls = [];
  const attempt = {
    start: () => { calls.push('start'); return Promise.resolve(null); },
    abort: () => { calls.push('abort'); }
  };
  const { wake } = setup({ externalAttempt: 'invalid', attempt });
  start(wake);
  assert.equal(calls.includes('start'), true);
  wake.cancel();
  assert.equal(calls.includes('abort'), true);
});
