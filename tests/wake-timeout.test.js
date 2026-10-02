const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');
const { createWakeController } = require('../extension/src/session/wake');
const { createAttempt } = require('../extension/src/attempt/simulator');
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

function setup({ mode = 'off', preset = presetResult(), fallbackAfterMs = 1500 } = {}) {
  const clock = createFakeClock();
  const session = new SessionController({
    videoId: VIDEO_ID,
    targetTime: TARGET_TIME,
    frameSize: { ...FRAME },
    externalAttempt: mode
  });
  const attempt = mode === 'off' ? null : createAttempt({ mode, clock });
  const wake = createWakeController({
    session,
    clock,
    attempt,
    fallbackAfterMs,
    resolvePreset: () => preset
  });
  return { clock, session, attempt, wake };
}

function begin(wake) {
  return wake.begin({ paused: true, currentTime: TARGET_TIME });
}

test('off 主路径同步进入交互，不排任何定时器', () => {
  const { clock, session, wake } = setup();
  const started = begin(wake);
  assert.equal(started.ok, true);
  assert.equal(started.status, 'interactive');
  assert.equal(started.fallback, null);
  assert.equal(started.result.source, 'preset');
  assert.equal(session.status, 'interactive');
  assert.equal(clock.pending(), 0);
});

test('hang 恰好在 1.5 秒回退到匹配的预制结果', () => {
  const { clock, wake } = setup({ mode: 'hang' });
  const started = begin(wake);
  assert.equal(started.status, 'waiting');
  clock.advance(1499);
  assert.equal(wake.getOutcome().status, 'waiting');
  clock.advance(1);
  const outcome = wake.getOutcome();
  assert.equal(outcome.status, 'interactive');
  assert.equal(outcome.fallback, 'timeout');
  assert.equal(outcome.reason, 'timeout');
  assert.equal(outcome.result.fallback, 'timeout');
  assert.equal(outcome.result.source, 'preset');
  assert.equal(outcome.elapsedMs <= 100, true, '判定超时到结果可用应小于 0.1 秒');
  assert.equal(clock.pending(), 0);
});

test('没有匹配预制时超时进入可恢复错误，不画曲线', () => {
  const { clock, session, wake } = setup({ mode: 'hang', preset: null });
  begin(wake);
  clock.advance(1500);
  const outcome = wake.getOutcome();
  assert.equal(outcome.status, 'recoverable-error');
  assert.equal(outcome.reason, 'no_preset');
  assert.equal(outcome.result, null);
  assert.equal(session.status, 'recoverable-error');
  assert.equal(session.getState().result, null);
  assert.equal(clock.pending(), 0);
});

test('预制与当前帧尺寸不匹配时不得回退', () => {
  const { clock, wake } = setup({
    mode: 'hang',
    preset: presetResult({ frameSize: { width: 1280, height: 720 } })
  });
  begin(wake);
  clock.advance(1500);
  assert.equal(wake.getOutcome().status, 'recoverable-error');
  assert.equal(wake.getOutcome().reason, 'no_preset');
});

test('非法的外部结果按失败处理，不进入交互', async () => {
  const { clock, session, wake } = setup({ mode: 'invalid' });
  const started = begin(wake);
  assert.equal(started.status, 'waiting');
  clock.advance(0);
  await flush();
  const outcome = wake.getOutcome();
  assert.equal(outcome.status, 'recoverable-error');
  assert.equal(outcome.reason, 'external_invalid');
  assert.equal(session.getState().result, null);
  assert.equal(clock.pending(), 0);
});

test('迟到的外部结果不能替换已经回退的曲线', async () => {
  const { clock, session, wake } = setup({ mode: 'late' });
  begin(wake);
  clock.advance(1500);
  const settled = wake.getOutcome();
  assert.equal(settled.status, 'interactive');
  assert.equal(settled.fallback, 'timeout');
  clock.advance(2200 - 1500);
  await flush();
  const after = wake.getOutcome();
  assert.equal(after.discarded, true);
  assert.equal(after.status, 'interactive');
  assert.equal(after.requestId, settled.requestId);
  assert.equal(session.getState().result.requestId, settled.requestId);
  assert.equal(session.getState().result.fallback, 'timeout');
});

test('等待中取消后回到暂停，迟到结果不再进入交互', async () => {
  const { clock, session, wake } = setup({ mode: 'late' });
  begin(wake);
  // late 模式下有两个定时器：唤醒看门狗与替身自己的迟到定时器。
  assert.equal(clock.pending(), 2);
  const outcome = wake.cancel();
  assert.equal(outcome.status, 'paused-ready');
  assert.equal(outcome.reason, 'cancelled');
  assert.equal(session.status, 'paused-ready');
  assert.equal(clock.pending(), 0);
  clock.advance(5000);
  await flush();
  assert.equal(session.status, 'paused-ready');
  assert.equal(session.getState().result, null);
  assert.equal(wake.isWaiting(), false);
});

test('连续五次唤醒只保留最新一次的结果编号', () => {
  const { clock, session, wake } = setup();
  const seen = [];
  for (let index = 0; index < 5; index += 1) {
    const started = begin(wake);
    assert.equal(started.ok, true);
    seen.push(started.requestId);
    assert.equal(session.getState().result.requestId, started.requestId);
    wake.cancel();
    assert.equal(session.getState().result, null);
  }
  assert.deepEqual(seen, ['request-1', 'request-2', 'request-3', 'request-4', 'request-5']);
  assert.equal(clock.pending(), 0);
});

test('播放或离开目标时间会结束等待并清理定时器', () => {
  const { clock, session, wake } = setup({ mode: 'hang' });
  begin(wake);
  assert.equal(clock.pending(), 1);
  const state = wake.onPlaybackChange({ paused: false, currentTime: TARGET_TIME });
  assert.equal(state.status, 'paused-ready');
  assert.equal(wake.isWaiting(), false);
  assert.equal(clock.pending(), 0);
  clock.advance(3000);
  assert.equal(session.status, 'paused-ready');
  assert.equal(session.getState().result, null);
});

test('针对其它视频的外部候选被拒绝而不是绘制', () => {
  const { clock, wake } = setup({ mode: 'hang' });
  const started = begin(wake);
  const outcome = wake.onExternal({
    ctx: { requestId: started.requestId, videoId: VIDEO_ID, time: TARGET_TIME, frameSize: { ...FRAME } },
    candidate: presetResult({ videoId: 'other-video' })
  });
  assert.equal(outcome.status, 'recoverable-error');
  assert.equal(outcome.reason, 'external_invalid');
  assert.equal(clock.pending(), 0);
});

test('等待中重复唤醒被会话拒绝，且不改变当前编号', () => {
  const { wake } = setup({ mode: 'hang' });
  const first = begin(wake);
  const second = begin(wake);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'session_active');
  assert.equal(wake.getOutcome().requestId, first.requestId);
});

test('dispose 清理定时器并放弃在途请求', () => {
  const { clock, wake } = setup({ mode: 'hang' });
  begin(wake);
  wake.dispose();
  assert.equal(clock.pending(), 0);
  assert.equal(wake.isWaiting(), false);
  clock.advance(5000);
  assert.equal(wake.getOutcome().status, 'waiting', '已释放的等待不再推进');
});

test('目标时间容差内的唤醒仍然使用当前暂停时间', () => {
  const { wake } = setup();
  const started = wake.begin({ paused: true, currentTime: 12.4 });
  assert.equal(started.ok, true);
  assert.equal(started.status, 'interactive');
  assert.equal(started.result.time, TARGET_TIME);
});

test('不在目标时间时唤醒被拒绝', () => {
  const { wake } = setup();
  const started = wake.begin({ paused: true, currentTime: 9 });
  assert.equal(started.ok, false);
  assert.equal(started.code, 'not_ready');
});

test('可恢复错误之后可以重试', () => {
  const { clock, session, wake } = setup({ mode: 'hang', preset: null });
  begin(wake);
  clock.advance(1500);
  assert.equal(session.status, 'recoverable-error');
  const retry = begin(wake);
  assert.equal(retry.ok, true);
  assert.equal(retry.status, 'waiting');
  assert.equal(retry.requestId, 'request-2');
});
