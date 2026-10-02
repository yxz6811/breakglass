/**
 * T022：外部尝试替身的契约。模块还没实现时，这些用例应当失败。
 * `hang`、`invalid`、`late` 是确定性替身，不表示真实识别。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateCurveResult } = require('../extension/src/curve/validate');

const SIMULATOR_PATH = path.join(__dirname, '../extension/src/attempt/simulator.js');
const FRAME = { width: 1920, height: 1080 };

/**
 * @returns {object}
 */
function basePreset() {
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
    }
  };
}

/**
 * @returns {object}
 */
function context() {
  return {
    requestId: 'request-1',
    videoId: 'fixture-parabola',
    time: 12.5,
    frameSize: { ...FRAME }
  };
}

/**
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
      timers.set(id, { at: now + delayMs, handler });
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
        timer.handler();
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
 * @param {string} mode
 * @param {ReturnType<typeof createClock>} [clock]
 * @returns {object}
 */
function attempt(mode, clock = createClock()) {
  const api = require('../extension/src/attempt/simulator');
  assert.equal(typeof api.createAttempt, 'function');
  return {
    clock,
    run: api.createAttempt({
      mode,
      clock,
      lateAfterMs: 1500,
      preset: basePreset()
    })
  };
}

/**
 * 观察一个 Promise 是否在假时钟推进后兑现，避免挂住真实事件循环。
 * @param {Promise<unknown>} promise
 * @param {ReturnType<typeof createClock>} clock
 * @param {number} ms
 * @returns {Promise<{ settled: boolean, value: unknown }>}
 */
async function observe(promise, clock, ms) {
  let settled = false;
  let value;
  promise.then((result) => {
    settled = true;
    value = result;
  }, () => {
    settled = true;
  });
  await flush();
  if (!settled && ms > 0) {
    clock.advance(ms);
    await flush();
  }
  return { settled, value };
}

test('off returns the preset immediately', async () => {
  const { clock, run } = attempt('off');
  const seen = await observe(run.start(context()), clock, 0);
  assert.equal(seen.settled, true);
  assert.equal(seen.value.candidate.source, 'preset');
  assert.equal(seen.value.candidate.fallback, null);
  assert.equal(seen.value.candidate.requestId, 'request-1');
  assert.equal(seen.value.candidate.videoId, 'fixture-parabola');
  assert.equal(clock.pending(), 0);
  const check = validateCurveResult(seen.value.candidate, {
    videoId: 'fixture-parabola',
    targetTime: 12.5,
    frameSize: FRAME,
    requestId: 'request-1'
  });
  assert.equal(check.ok, true);
});

test('hang does not return before cancel or timeout', async () => {
  const { clock, run } = attempt('hang');
  const seen = await observe(run.start(context()), clock, 5000);
  assert.equal(seen.settled, false);
  assert.equal(seen.value, undefined);
});

test('invalid returns an illegal candidate before 1500ms', async () => {
  const { clock, run } = attempt('invalid');
  const seen = await observe(run.start(context()), clock, 1499);
  assert.equal(seen.settled, true);
  assert.equal(clock.now() < 1500, true);
  assert.equal(validateCurveResult(seen.value.candidate).ok, false);
});

test('late returns a candidate only after 1500ms', async () => {
  const { clock, run } = attempt('late');
  const pending = run.start(context());
  const early = await observe(pending, clock, 1499);
  assert.equal(early.settled, false);
  clock.advance(1);
  await flush();
  const late = await pending;
  assert.ok(late.candidate);
  assert.equal(late.candidate.requestId, 'request-1');
  assert.equal(clock.now() >= 1500, true);
});

test('the same input always produces the same candidate', async () => {
  for (const mode of ['off', 'invalid', 'late']) {
    const firstClock = createClock();
    const secondClock = createClock();
    const first = attempt(mode, firstClock);
    const second = attempt(mode, secondClock);
    const left = await observe(first.run.start(context()), firstClock, 1500);
    const right = await observe(second.run.start(context()), secondClock, 1500);
    assert.equal(left.settled, true);
    assert.equal(right.settled, true);
    assert.deepEqual(left.value, right.value);
  }
});

test('aborting hang leaves no timer and no result', async () => {
  const { clock, run } = attempt('hang');
  let settled = false;
  run.start(context()).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await flush();
  clock.advance(5000);
  await flush();
  assert.equal(settled, false);
  run.abort();
  clock.advance(5000);
  await flush();
  assert.equal(settled, false);
  assert.equal(clock.pending(), 0);
});

test('aborting late before it fires leaves no timer and no result', async () => {
  const { clock, run } = attempt('late');
  let settled = false;
  run.start(context()).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  clock.advance(1000);
  await flush();
  assert.equal(settled, false);
  run.abort();
  clock.advance(1500);
  await flush();
  assert.equal(settled, false);
  assert.equal(clock.pending(), 0);
});

test('simulator source has no network api, remote address, secret, or model name', () => {
  const source = fs.readFileSync(SIMULATOR_PATH, 'utf8');
  assert.equal(/fetch|XMLHttpRequest|WebSocket|https?:|secret|api[_-]?key|token|authorization|upload|\bmodel\b/i.test(source), false);
});

test('running the simulator does not call fetch', async () => {
  const calls = [];
  const previous = global.fetch;
  global.fetch = (...args) => {
    calls.push(args);
    throw new Error('network');
  };
  try {
    for (const mode of ['off', 'invalid', 'late']) {
      const { clock, run } = attempt(mode);
      await observe(run.start(context()), clock, 1500);
    }
    const hanging = attempt('hang');
    await observe(hanging.run.start(context()), hanging.clock, 1500);
    hanging.run.abort();
  } finally {
    if (previous === undefined) delete global.fetch;
    else global.fetch = previous;
  }
  assert.deepEqual(calls, []);
});
