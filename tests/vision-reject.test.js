/**
 * T012：不合格识别候选不得变成成功。实现见 extension/src/session/wake.js（T013）。
 * 样例通过 fetch 替身注入，时钟由测试注入。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');
const wakeApi = require('../extension/src/session/wake');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const PRESET = require('../extension/assets/presets/demo-parabola.json');
const VISION = require('../extension/assets/vision/fixture-parabola.json');
const FRAME = { width: 1920, height: 1080 };
const TARGET_TIME = 6;
const FAIL_CODE = 'external_unavailable';
const FAIL_MESSAGE = '外部结果不可用，未进入交互。';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function setup({ candidate = VISION, externalAttempt = 'off', withPreset = true } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => clone(candidate) });
  const clock = createFakeClock();
  const session = new SessionController({
    videoId: VISION.videoId,
    targetTime: TARGET_TIME,
    frameSize: { ...FRAME },
    externalAttempt
  });
  const states = [];
  const wake = wakeApi.createWake({
    session,
    config: { enableLocalMock: true, prewarmed: true, fallbackAfterMs: 1500, externalAttempt, visionAdapter: 'fixture' },
    preset: withPreset ? clone(PRESET) : null,
    clock,
    onChange: (state) => states.push(state)
  });
  return {
    clock, session, wake, states,
    latest: () => states[states.length - 1],
    restore: () => { global.fetch = original; }
  };
}

function start(wake) {
  return wake.start({ paused: true, currentTime: TARGET_TIME, frameSize: { ...FRAME } });
}

const BAD_CANDIDATES = [
  ['缺 evidence', () => { const c = clone(VISION); delete c.evidence; return c; }],
  ['evidence 不是 packaged-sample', () => clone({ ...VISION, evidence: 'live' })],
  ['confidence 低于 0.5', () => clone({ ...VISION, confidence: 0.49 })],
  ['confidence 非有限', () => clone({ ...VISION, confidence: Number.POSITIVE_INFINITY })],
  ['region 越出样例自己的画幅', () => { const c = clone(VISION); c.definition.region = { x: 1500, y: 100, width: 900, height: 400 }; return c; }],
  ['videoId 不匹配', () => clone({ ...VISION, videoId: 'other-video' })],
  ['time 超出 ±0.2 秒', () => clone({ ...VISION, time: 6.5 })],
  ['未知 equationId', () => { const c = clone(VISION); c.definition.equationId = 'nope.curve'; return c; }],
  ['fallback 不是 null', () => clone({ ...VISION, fallback: 'timeout' })]
];

for (const [label, mutate] of BAD_CANDIDATES) {
  test(label + ' → 可恢复错误，不绘制', async () => {
    const h = setup({ candidate: mutate() });
    try {
      start(h.wake);
      await flush();
      const state = h.latest();
      assert.equal(state.status, 'recoverable-error', label);
      assert.equal(state.code, FAIL_CODE);
      assert.equal(state.message, FAIL_MESSAGE);
      assert.equal(state.result, null);
      assert.equal(h.states.some((item) => item.status === 'interactive'), false, '不得进入交互');
    } finally {
      h.restore();
    }
  });
}

test('存在匹配预制时，坏识别候选也不得把预制画成识别成功', async () => {
  const h = setup({ candidate: (() => { const c = clone(VISION); delete c.evidence; return c; })(), withPreset: true });
  try {
    start(h.wake);
    await flush();
    assert.equal(h.latest().status, 'recoverable-error');
    assert.equal(h.latest().result, null, '不得自动顶上预制结果');
    assert.equal(h.session.getState().result, null);
  } finally {
    h.restore();
  }
});

test('非 off 的外部演练优先：visionAdapter 打开也不走识别样例', async () => {
  for (const externalAttempt of ['hang', 'invalid', 'late']) {
    const h = setup({ externalAttempt });
    try {
      start(h.wake);
      assert.equal(h.latest().status, 'waiting', externalAttempt + ' 必须先进入等待');
      assert.equal(h.clock.pending() >= 1, true, externalAttempt + ' 必须有 1500ms 看门狗');
      h.clock.advance(1500);
      await flush();
      const state = h.latest();
      assert.notEqual(state.result && state.result.source, 'vision', externalAttempt + ' 不得进入识别');
    } finally {
      h.restore();
    }
  }
});

test('hang 演练仍按 1500ms 回退到预制并保留超时来源', async () => {
  const h = setup({ externalAttempt: 'hang' });
  try {
    start(h.wake);
    h.clock.advance(1499);
    assert.equal(h.latest().status, 'waiting');
    h.clock.advance(1);
    const state = h.latest();
    assert.equal(state.status, 'interactive');
    assert.equal(state.result.source, 'preset');
    assert.equal(state.result.fallback, 'timeout');
  } finally {
    h.restore();
  }
});

test('取消或退出后，迟到的识别样例不得再打开交互', async () => {
  const cancelled = setup();
  try {
    start(cancelled.wake);
    assert.equal(cancelled.wake.cancel().status, 'paused-ready');
    await flush();
    assert.equal(cancelled.session.getState().status, 'paused-ready');
    assert.equal(cancelled.states.some((item) => item.status === 'interactive'), false);
  } finally {
    cancelled.restore();
  }

  const exited = setup();
  try {
    start(exited.wake);
    exited.wake.exit();
    await flush();
    assert.equal(exited.states.some((item) => item.status === 'interactive'), false);
  } finally {
    exited.restore();
  }
});

test('离开目标时间后，识别样例结算被丢弃', async () => {
  const h = setup();
  try {
    start(h.wake);
    h.wake.onPlaybackChange({ paused: false, currentTime: TARGET_TIME });
    await flush();
    assert.equal(h.session.getState().status, 'paused-ready');
    assert.equal(h.states.some((item) => item.status === 'interactive'), false);
  } finally {
    h.restore();
  }
});

test('读取失败时按外部结果不可用处理', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    const clock = createFakeClock();
    const session = new SessionController({ videoId: VISION.videoId, targetTime: TARGET_TIME, frameSize: { ...FRAME }, externalAttempt: 'off' });
    const states = [];
    const wake = wakeApi.createWake({
      session,
      config: { enableLocalMock: true, prewarmed: true, fallbackAfterMs: 1500, externalAttempt: 'off', visionAdapter: 'fixture' },
      preset: clone(PRESET),
      clock,
      onChange: (state) => states.push(state)
    });
    start(wake);
    await flush();
    const state = states[states.length - 1];
    assert.equal(state.status, 'recoverable-error');
    assert.equal(state.code, FAIL_CODE);
    assert.equal(state.message, FAIL_MESSAGE);
    assert.equal(state.result, null);
  } finally {
    global.fetch = original;
  }
});
