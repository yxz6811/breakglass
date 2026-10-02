const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAttempt, ATTEMPT_MODES, DEFAULT_LATE_AFTER_MS } = require('../extension/src/attempt/simulator');
const { validateCurveResult } = require('../extension/src/curve/validate');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const ctx = {
  requestId: 'request-1',
  videoId: 'fixture-parabola',
  time: 12.5,
  frameSize: { width: 1920, height: 1080 }
};

test('只接受契约里的四种 externalAttempt 取值', () => {
  assert.deepEqual(ATTEMPT_MODES, ['off', 'hang', 'invalid', 'late']);
  for (const mode of ATTEMPT_MODES) {
    assert.equal(createAttempt({ mode, clock: createFakeClock() }).mode, mode);
  }
  assert.throws(() => createAttempt({ mode: 'fast', clock: createFakeClock() }), /未知 externalAttempt/);
});

test('off 不排任何定时器，也不产生外部结果', async () => {
  const clock = createFakeClock();
  const attempt = createAttempt({ mode: 'off', clock });
  const promise = attempt.start(ctx);
  assert.equal(clock.pending(), 0);
  assert.equal(await promise, null);
});

test('hang 永不返回，且不留下定时器', async () => {
  const clock = createFakeClock();
  const attempt = createAttempt({ mode: 'hang', clock });
  let settled = false;
  attempt.start(ctx).then(() => { settled = true; });
  clock.advance(60000);
  await flush();
  assert.equal(settled, false);
  assert.equal(clock.pending(), 0);
});

test('invalid 返回一份必须被确定性校验拒绝的候选', async () => {
  const clock = createFakeClock();
  const attempt = createAttempt({ mode: 'invalid', clock });
  const promise = attempt.start(ctx);
  assert.equal(clock.pending(), 1);
  clock.advance(0);
  const payload = await promise;
  assert.equal(payload.ctx.requestId, ctx.requestId);
  assert.equal(payload.candidate.requestId, ctx.requestId);
  assert.equal(payload.candidate.source, 'vision');
  assert.equal(validateCurveResult(payload.candidate).ok, false);
  assert.equal(clock.pending(), 0);
});

test('late 在回退窗口之后才返回，且编号已经过期', async () => {
  const clock = createFakeClock();
  const attempt = createAttempt({ mode: 'late', clock });
  const promise = attempt.start(ctx);
  clock.advance(DEFAULT_LATE_AFTER_MS - 1);
  assert.equal(clock.pending(), 1);
  clock.advance(1);
  const payload = await promise;
  assert.equal(payload.candidate.requestId, ctx.requestId + '-late');
  assert.equal(validateCurveResult(payload.candidate, { requestId: ctx.requestId }).code, 'request_mismatch');
  assert.equal(clock.pending(), 0);
});

test('abort 清理定时器并压制迟到结果', async () => {
  const clock = createFakeClock();
  const attempt = createAttempt({ mode: 'late', clock });
  let settled = false;
  attempt.start(ctx).then(() => { settled = true; });
  attempt.abort();
  assert.equal(clock.pending(), 0);
  clock.advance(DEFAULT_LATE_AFTER_MS + 1000);
  await flush();
  assert.equal(settled, false);
  assert.equal(attempt.isAborted(), true);
  assert.equal(await attempt.start(ctx), null);
});

test('替身不含任何网络访问', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/attempt/simulator.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
});
