const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');
const { createWake } = require('../extension/src/session/wake');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const FRAME = { width: 1920, height: 1080 };
const TIME = 12.5;

function cachedCurve(overrides = {}) {
  return {
    requestId: 'reading-1:point-1',
    videoId: 'user-video',
    time: TIME,
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

function setup(options = {}) {
  const curve = Object.hasOwn(options, 'curve') ? options.curve : cachedCurve();
  const session = new SessionController({
    videoId: 'user-video', targetTime: TIME, frameSize: { ...FRAME }, ...options.session
  });
  const states = [];
  const calls = [];
  const clock = createFakeClock();
  const instrumentedClock = {
    now: clock.now,
    schedule(...args) { calls.push('schedule'); return clock.schedule(...args); },
    clear(...args) { calls.push('clear'); return clock.clear(...args); }
  };
  const config = {
    enableLocalMock: false,
    prewarmed: false,
    fallbackAfterMs: 999,
    externalAttempt: 'hang',
    visionAdapter: 'fixture',
    ...options.config
  };
  const attempt = {
    start() { calls.push('attempt.start'); throw new Error('cached reading must not start an attempt'); },
    abort() { calls.push('attempt.abort'); }
  };
  const wake = createWake({
    session, config, preset: curve, clock: instrumentedClock,
    onChange: (state) => states.push(state),
    attempt,
    cachedReading: true,
    ...options.factory
  });
  return { wake, session, curve, clock, calls, states };
}

function startCached(wake, overrides = {}) {
  return wake.startCached({ paused: true, currentTime: TIME, frameSize: { ...FRAME }, ...overrides });
}

function assertUnavailable(setupResult) {
  const result = startCached(setupResult.wake);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'external_unavailable');
  assert.equal(result.message, '外部结果不可用，未进入交互。');
  assert.equal(setupResult.session.getState().status, 'recoverable-error');
  assert.equal(setupResult.session.getState().result, null);
  assert.deepEqual(setupResult.calls, []);
}

test('startCached 即时通过规则层 beginWait/resolve，禁用本地 Mock 也可消费阅读缓存', () => {
  const current = setup();
  const order = [];
  for (const method of ['beginWait', 'resolve']) {
    const original = current.session[method].bind(current.session);
    current.session[method] = (...args) => { order.push(method); return original(...args); };
  }
  const begun = startCached(current.wake);
  const state = current.session.getState();
  assert.equal(begun.ok, true);
  assert.deepEqual(order, ['beginWait', 'resolve']);
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.requestId, begun.requestId);
  assert.notEqual(begun.requestId, current.curve.requestId);
  assert.equal(current.curve.requestId, 'reading-1:point-1');
  assert.equal(state.result.source, 'preset');
  assert.equal(state.result.fallback, null);
  assert.deepEqual(state.result.definition, current.curve.definition);
  assert.deepEqual(state.result.frameSize, FRAME);
  assert.deepEqual(current.calls, []);
  assert.equal(current.clock.pending(), 0);
  assert.deepEqual(current.states.map((state) => state.status), ['interactive']);
});

test('startCached 不读 Mock/fixture 配置、不需要时钟、不发起替身', () => {
  const config = {};
  for (const name of ['enableLocalMock', 'prewarmed', 'fallbackAfterMs', 'externalAttempt', 'visionAdapter']) {
    Object.defineProperty(config, name, { get() { throw new Error('cached reading cannot inspect ' + name); } });
  }
  const current = setup({ factory: { config, clock: undefined } });
  assert.equal(startCached(current.wake).ok, true);
  assert.deepEqual(current.calls, []);
});

test('缓存入口只允许 cachedReading 严格为 true，其他值不改变会话', () => {
  for (const cachedReading of [undefined, false, 1, 'true', {}]) {
    const current = setup({ factory: { cachedReading } });
    const before = current.session.getState();
    const result = startCached(current.wake);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'external_unavailable');
    assert.deepEqual(current.session.getState(), before);
    assert.deepEqual(current.calls, []);
    assert.deepEqual(current.states, []);
  }
});

test('缓存入口要求真实暂停、有限时间和正整数源尺寸，不生成等待', () => {
  for (const playback of [
    { paused: false }, { paused: 'true' }, { currentTime: NaN }, { currentTime: Infinity },
    { currentTime: '12.5' }, { currentTime: TIME + 0.201 },
    { frameSize: null }, { frameSize: { width: 0, height: 1080 } },
    { frameSize: { width: Infinity, height: 1080 } },
    { frameSize: { width: 1920.5, height: 1080 } },
    { frameSize: { width: '1920', height: 1080 } }
  ]) {
    const current = setup();
    const result = startCached(current.wake, playback);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_ready');
    assert.equal(current.session.getState().status, 'paused-ready');
    assert.equal(current.session.sequence, 0);
    assert.deepEqual(current.calls, []);
  }
});

test('缓存入口保留会话既有播放时间容差，缓存自身时间必须精确对应目标', () => {
  const near = setup();
  assert.equal(startCached(near.wake, { currentTime: TIME + 0.2 }).ok, true);
  assertUnavailable(setup({ curve: cachedCurve({ time: TIME + 0.1 }) }));
});

test('缓存入口拒绝另一视频的结果，不把视频编号改装成当前视频', () => {
  assertUnavailable(setup({ curve: cachedCurve({ videoId: 'other-video' }) }));
});

test('缓存入口拒绝源画幅不匹配，不缩放阅读区域', () => {
  const current = setup({ curve: cachedCurve({ frameSize: { width: 1280, height: 720 } }) });
  assertUnavailable(current);
  assert.deepEqual(current.curve.frameSize, { width: 1280, height: 720 });
  assert.deepEqual(current.session.frameSize, FRAME);
});

test('当前播放尺寸必须同时匹配会话源尺寸，不重写会话画幅', () => {
  const current = setup({ session: { frameSize: { width: 1280, height: 720 } } });
  const result = startCached(current.wake);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'external_unavailable');
  assert.equal(current.session.getState().result, null);
  assert.deepEqual(current.session.frameSize, { width: 1280, height: 720 });
  assert.deepEqual(current.calls, []);
});

test('缓存入口拒绝 vision、timeout 和夹带识别样例证据，不能洗成 preset 成功', () => {
  for (const patch of [
    { source: 'vision', evidence: 'packaged-sample' }, { fallback: 'timeout' },
    { evidence: 'packaged-sample' }, { source: undefined }, { fallback: undefined }
  ]) assertUnavailable(setup({ curve: cachedCurve(patch) }));
});

test('缓存仍通过共享校验器拒绝缺失身份、越界和不可有限求值的数据', () => {
  const missingId = cachedCurve({ requestId: '' });
  const outside = cachedCurve();
  outside.definition.region.x = FRAME.width;
  const invalidMath = cachedCurve();
  invalidMath.definition.parameters.a.max = Number.MAX_VALUE;
  const missingParameter = cachedCurve();
  delete missingParameter.definition.parameters.k;
  for (const curve of [null, {}, missingId, outside, invalidMath, missingParameter]) assertUnavailable(setup({ curve }));
});

test('同一缓存可用于首尾时间帧，0 秒不被误作没有目标时间', () => {
  for (const targetTime of [0, 30]) {
    const current = setup({
      curve: cachedCurve({ time: targetTime }),
      session: { targetTime }
    });
    assert.equal(startCached(current.wake, { currentTime: targetTime }).ok, true);
    assert.equal(current.session.getState().result.time, targetTime);
  }
});

test('已有交互会话不能被缓存入口覆盖，也不产生新的编号', () => {
  const current = setup();
  assert.equal(startCached(current.wake).ok, true);
  const before = current.session.getState();
  const duplicate = startCached(current.wake);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'session_active');
  assert.deepEqual(current.session.getState(), before);
  assert.equal(current.session.sequence, 1);
  assert.deepEqual(current.calls, []);
});

test('缓存交互退出和重新进入生成新编号，外部对象修改不能污染已建立会话', () => {
  const current = setup();
  const first = startCached(current.wake);
  current.curve.definition.parameters.h.max = 999;
  current.curve.definition.region.x = 300;
  assert.equal(current.session.getState().result.definition.parameters.h.max, 2);
  assert.equal(current.session.getState().result.definition.region.x, 100);
  current.curve.definition.parameters.h.max = 2;
  current.curve.definition.region.x = 100;
  assert.equal(current.wake.exit().status, 'paused-ready');
  const second = startCached(current.wake);
  assert.equal(second.ok, true);
  assert.notEqual(second.requestId, first.requestId);
  assert.equal(current.wake.cancel().status, 'paused-ready');
  assert.equal(current.clock.pending(), 0);
});

test('缓存流程没有迟到看门狗，时间前进不把 null fallback 改为 timeout', async () => {
  const current = setup();
  const started = startCached(current.wake);
  const before = current.session.getState();
  current.clock.advance(30000);
  await flush();
  assert.equal(started.ok, true);
  assert.deepEqual(current.session.getState(), before);
  assert.deepEqual(current.calls, []);
});
