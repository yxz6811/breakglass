/**
 * T021：唤醒看门狗的契约。模块还没实现时，这些用例应当失败。
 * 时钟由测试注入，不使用真实的 setTimeout。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');
const { validateCurveResult } = require('../extension/src/curve/validate');

const FRAME = { width: 1920, height: 1080 };

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function basePreset(overrides = {}) {
  return {
    requestId: 'fixture-request',
    videoId: 'fixture-parabola',
    time: 12.5,
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

/**
 * 同步推进的假时钟。到点的定时器按注册顺序执行。
 * @returns {{ now: () => number, schedule: Function, clear: Function, advance: Function, pending: () => number }}
 */
function createClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now() {
      return now;
    },
    /**
     * @param {number} delayMs
     * @param {Function} handler
     * @returns {number}
     */
    schedule(delayMs, handler) {
      const id = ++sequence;
      timers.set(id, { at: now + delayMs, fn: handler });
      return id;
    },
    /**
     * @param {number} id
     */
    clear(id) {
      timers.delete(id);
    },
    /**
     * @param {number} ms
     */
    advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pending() {
      return timers.size;
    }
  };
}

/**
 * @returns {Promise<void>}
 */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * @param {object} [overrides]
 * @returns {{ clock: ReturnType<typeof createClock>, changes: object[], session: SessionController, wake: object, latest: () => object }}
 */
function harness(overrides = {}) {
  const api = require('../extension/src/session/wake');
  assert.equal(typeof api.createWake, 'function');
  const clock = createClock();
  const changes = [];
  const config = {
    enableLocalMock: true,
    fallbackAfterMs: 1500,
    presetKey: 'demo-parabola',
    prewarmed: true,
    externalAttempt: 'off',
    ...overrides.config
  };
  const preset = Object.prototype.hasOwnProperty.call(overrides, 'preset') ? overrides.preset : basePreset();
  const sessionOptions = overrides.session || {};
  const session = new SessionController({
    videoId: sessionOptions.videoId || 'fixture-parabola',
    targetTime: sessionOptions.targetTime ?? 12.5,
    frameSize: sessionOptions.frameSize || { ...FRAME },
    externalAttempt: config.externalAttempt
  });
  const wake = api.createWake({
    session,
    config,
    preset,
    clock,
    onChange: (state) => changes.push(structuredClone(state)),
    ...(overrides.attempt ? { attempt: overrides.attempt } : {})
  });
  return {
    clock,
    changes,
    session,
    wake,
    latest: () => changes.at(-1)
  };
}

/**
 * @param {ReturnType<typeof harness>} h
 * @param {number} [time]
 * @returns {void}
 */
function start(h, time = 12.5) {
  h.wake.start({ paused: true, currentTime: time, frameSize: { ...FRAME } });
}

/**
 * 页面状态和会话状态必须一致；result 为空表示没有可绘制曲线。
 * @param {ReturnType<typeof harness>} h
 */
function assertAligned(h) {
  const state = h.latest();
  const session = h.session.getState();
  assert.equal(session.status, state.status);
  assert.equal(session.code, state.code);
  assert.equal(session.message, state.message);
  if (state.result == null) {
    assert.equal(session.result, null);
    return;
  }
  assert.ok(session.result);
  assert.equal(session.result.requestId, state.result.requestId);
  assert.equal(session.result.source, state.result.source);
  assert.equal(session.result.fallback, state.result.fallback);
}

/**
 * @param {object | null | undefined} result
 */
function assertDrawablePreset(result) {
  assert.ok(result);
  assert.equal(result.source, 'preset');
  assert.equal(result.source === 'vision', false);
  assert.equal(/识别成功/.test(JSON.stringify(result)), false);
  const check = validateCurveResult(result, {
    videoId: 'fixture-parabola',
    targetTime: 12.5,
    timeTolerance: 0.2,
    frameSize: FRAME,
    requestId: result.requestId
  });
  assert.equal(check.ok, true);
}

test('fixture preset stays inside the curve contract', () => {
  const preset = basePreset();
  const check = validateCurveResult(preset, {
    videoId: preset.videoId,
    targetTime: preset.time,
    timeTolerance: 0.2,
    frameSize: preset.frameSize,
    requestId: preset.requestId
  });
  assert.equal(check.ok, true);
  assert.equal(/secret|api[_-]?key|token|https?:/i.test(JSON.stringify(preset)), false);
});

test('off enters interactive immediately with a preset and no fallback', async () => {
  const h = harness();
  start(h);
  await flush();
  const state = h.latest();
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.fallback, null);
  assertDrawablePreset(state.result);
  assert.equal(h.clock.pending(), 0);
  assertAligned(h);
});

test('hang stays waiting and draws nothing before 1500ms', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  h.clock.advance(1499);
  await flush();
  assert.equal(h.latest().status, 'waiting');
  assert.equal(h.latest().result, null);
  assert.equal(h.clock.pending() > 0, true);
  assertAligned(h);
});

test('hang falls back at 1500ms without another start', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  h.clock.advance(1500);
  await flush();
  const state = h.latest();
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.fallback, 'timeout');
  assertDrawablePreset(state.result);
  assert.equal(h.clock.pending(), 0);
  assertAligned(h);
});

test('a cancelled request id is not drawn when the watchdog fires', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  const requestId = h.latest().requestId;
  h.wake.cancel();
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'paused-ready');
  assert.equal(h.latest().result, null);
  assert.equal(h.changes.some((state) => state.status === 'interactive' && state.result && state.result.requestId === requestId), false);
  assertAligned(h);
});

test('video mismatch at fallback does not draw', async () => {
  const h = harness({
    config: { externalAttempt: 'hang' },
    preset: basePreset({ videoId: 'other-video' })
  });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'recoverable-error');
  assert.equal(h.latest().result, null);
  assert.equal(h.clock.pending(), 0);
  assertAligned(h);
});

test('time outside ±0.2s at fallback does not draw', async () => {
  const h = harness({
    config: { externalAttempt: 'hang' },
    preset: basePreset({ time: 20 })
  });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'recoverable-error');
  assert.equal(h.latest().result, null);
  assertAligned(h);
});

test('a preset authored at another resolution scales onto the current frame', async () => {
  const region = { x: 100, y: 80, width: 640, height: 360 };
  const preset = basePreset({
    frameSize: { width: 1280, height: 720 },
    definition: { ...basePreset().definition, region: { ...region } }
  });
  const h = harness({
    config: { externalAttempt: 'hang' },
    preset
  });
  start(h);
  h.clock.advance(1500);
  await flush();
  const state = h.latest();
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.frameSize.width, FRAME.width);
  assert.equal(state.result.frameSize.height, FRAME.height);
  assert.equal(state.result.definition.region.x, 150);
  assert.equal(state.result.definition.region.y, 120);
  assert.equal(state.result.definition.region.width, 960);
  assert.equal(state.result.definition.region.height, 540);
  assert.equal(preset.definition.region.x, 100);
  assert.equal(preset.frameSize.width, 1280);
  assertAligned(h);
});

test('the shipped preset draws on a 3024×1898 frame paused at 6s', async () => {
  const shipped = require('../extension/assets/presets/demo-parabola.json');
  const frame = { width: 3024, height: 1898 };
  const h = harness({
    config: { externalAttempt: 'off' },
    preset: shipped,
    session: {
      targetTime: shipped.time,
      frameSize: { width: shipped.frameSize.width, height: shipped.frameSize.height }
    }
  });
  h.wake.start({ paused: true, currentTime: 6, frameSize: frame });
  await flush();
  const state = h.latest();
  assert.equal(shipped.time, 6);
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.frameSize.width, 3024);
  assert.equal(state.result.frameSize.height, 1898);
  assert.equal(state.result.definition.region.x, shipped.definition.region.x * (3024 / 1920));
  assert.equal(state.result.definition.region.y, shipped.definition.region.y * (1898 / 1080));
  assert.equal(state.result.source, 'preset');
  assert.equal(state.result.fallback, null);
  assert.equal(shipped.frameSize.width, 1920);
  assertAligned(h);
});

test('a late result does not replace the timeout curve', async () => {
  const h = harness({ config: { externalAttempt: 'late' } });
  start(h);
  h.clock.advance(1500);
  await flush();
  const first = h.latest();
  assert.equal(first.status, 'interactive');
  assert.equal(first.result.fallback, 'timeout');
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'interactive');
  assert.equal(h.latest().result.requestId, first.result.requestId);
  assert.equal(h.latest().result.fallback, 'timeout');
  assert.equal(h.latest().result.source, 'preset');
  assertAligned(h);
});

test('prewarmed false becomes a recoverable error with no curve', async () => {
  const h = harness({ config: { externalAttempt: 'hang', prewarmed: false } });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'recoverable-error');
  assert.equal(h.latest().result, null);
  assert.doesNotMatch(String(h.latest().message || ''), /识别成功/);
  assertAligned(h);
});

test('a missing preset becomes a recoverable error with no curve', async () => {
  const h = harness({ config: { externalAttempt: 'hang' }, preset: null });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().status, 'recoverable-error');
  assert.equal(h.latest().result, null);
  assertAligned(h);
});

test('an invalid external result is not drawn as success', async () => {
  const h = harness({ config: { externalAttempt: 'invalid' } });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.changes.some((state) => state.status === 'interactive'), false);
  assert.equal(h.latest().status, 'recoverable-error');
  assert.equal(h.latest().result, null);
  assertAligned(h);
});

test('cancel returns to paused-ready and clears the watchdog', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  h.wake.cancel();
  assert.equal(h.latest().status, 'paused-ready');
  assert.equal(h.latest().result, null);
  assert.equal(h.clock.pending(), 0);
  assertAligned(h);
});

test('a result arriving after cancel does not open interactive', async () => {
  const h = harness({ config: { externalAttempt: 'invalid' } });
  start(h);
  h.wake.cancel();
  h.clock.advance(1500);
  await flush();
  assert.equal(h.changes.some((state) => state.status === 'interactive'), false);
  assert.equal(h.latest().status, 'paused-ready');
  assert.equal(h.latest().result, null);
  assertAligned(h);
});

test('five exit and wake cycles keep only the latest matching result', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    start(h);
    h.clock.advance(1500);
    await flush();
    assert.equal(h.latest().status, 'interactive');
    assert.equal(h.latest().result.fallback, 'timeout');
    ids.push(h.latest().result.requestId);
    h.wake.exit();
    assert.equal(h.latest().result, null);
    assert.equal(h.clock.pending(), 0);
  }
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right, 'en', { numeric: true })));
});

test('five frame changes drop the previous curve', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  for (let index = 0; index < 5; index += 1) {
    start(h);
    h.clock.advance(1500);
    await flush();
    const requestId = h.latest().result.requestId;
    h.wake.onPlaybackChange({ paused: true, currentTime: 30 });
    const afterLeave = h.changes.length;
    assert.equal(h.latest().result, null);
    assert.equal(h.clock.pending(), 0);
    h.clock.advance(1500);
    await flush();
    assert.equal(h.changes.slice(afterLeave).some((state) => state.result && state.result.requestId === requestId), false);
  }
  assert.equal(h.latest().result, null);
});

test('playback during a wait ends the session and clears the timer', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  h.wake.onPlaybackChange({ paused: false, currentTime: 12.5 });
  assert.equal(h.latest().status, 'paused-ready');
  assert.equal(h.clock.pending(), 0);
  h.clock.advance(1500);
  await flush();
  assert.equal(h.latest().result, null);
  assert.equal(h.changes.some((state) => state.status === 'interactive'), false);
});

test('leaving the target time ends the session and clears the timer', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  h.wake.onPlaybackChange({ paused: true, currentTime: 12.71 });
  assert.equal(h.latest().status, 'paused-ready');
  assert.equal(h.latest().result, null);
  assert.equal(h.clock.pending(), 0);
  assertAligned(h);
});

test('a second start while waiting does not open another session', async () => {
  const h = harness({ config: { externalAttempt: 'hang' } });
  start(h);
  const requestId = h.latest().requestId;
  const timers = h.clock.pending();
  start(h);
  await flush();
  assert.equal(h.latest().status, 'waiting');
  assert.equal(h.latest().requestId, requestId);
  assert.equal(h.clock.pending(), timers);
  assert.equal(h.latest().result, null);
});

test('request ids increase across wakes', async () => {
  const h = harness({ config: { externalAttempt: 'off' } });
  const ids = [];
  for (let index = 0; index < 3; index += 1) {
    start(h);
    await flush();
    ids.push(h.latest().result.requestId);
    h.wake.exit();
  }
  const numbers = ids.map((id) => {
    const match = String(id).match(/(\d+)$/);
    assert.ok(match);
    return Number(match[1]);
  });
  assert.deepEqual(numbers, [...numbers].sort((left, right) => left - right));
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(numbers[0] < numbers[1] && numbers[1] < numbers[2], true);
});

test('a vision candidate never becomes interactive', async () => {
  const h = harness({
    config: { externalAttempt: 'invalid' },
    attempt: {
      /**
       * @param {object} ctx
       * @returns {Promise<object>}
       */
      start(ctx) {
        return Promise.resolve({
          ctx,
          candidate: { ...basePreset(), requestId: ctx.requestId, source: 'vision', fallback: null }
        });
      },
      abort() {}
    }
  });
  start(h);
  await flush();
  h.clock.advance(1500);
  await flush();
  assert.equal(h.changes.some((state) => state.status === 'interactive'), false);
  assert.equal(h.latest().result, null);
  assert.equal(h.session.getState().result, null);
});

test('enableLocalMock false does not turn a timeout into a preset success', async () => {
  const h = harness({ config: { externalAttempt: 'hang', enableLocalMock: false } });
  start(h);
  h.clock.advance(1500);
  await flush();
  assert.notEqual(h.latest().status, 'interactive');
  assert.equal(h.latest().result, null);
  assert.equal(h.session.getState().result, null);
});
