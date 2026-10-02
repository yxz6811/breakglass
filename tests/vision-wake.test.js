/**
 * 识别样例的唤醒夹具。T010 完成前，打开 fixture 仍会走预制成功路径。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SessionController } = require('../extension/src/session/session');
const wakeApi = require('../extension/src/session/wake');
const { createFakeClock } = require('./helpers/fake-clock.js');

const FRAME = { width: 1920, height: 1080 };
const TARGET_TIME = 6;
const WAKE_OPTIONS = ['session', 'config', 'preset', 'clock', 'onChange', 'attempt'];
const STATE_KEYS = ['status', 'requestId', 'result', 'currentParameters', 'initialParameters', 'code', 'message'];
const FIXTURE_PATH = path.join(__dirname, '..', 'extension', 'assets', 'vision', 'fixture-parabola.json');
const README_PATH = path.join(__dirname, '..', 'extension', 'assets', 'vision', 'README.md');

/**
 * @param {object} [overrides]
 * @returns {object}
 */
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

/**
 * @param {{ visionAdapter?: string, externalAttempt?: string, presetResult?: object | null, config?: object }} [options]
 * @returns {{ clock: object, session: SessionController, wake: object, states: object[] }}
 */
function setup({ visionAdapter, externalAttempt = 'off', presetResult, config = {} } = {}) {
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
    config: {
      enableLocalMock: true,
      prewarmed: true,
      fallbackAfterMs: 1500,
      externalAttempt,
      visionAdapter,
      ...config
    },
    preset: presetResult === undefined ? preset() : presetResult,
    clock,
    onChange: (state) => states.push(state)
  });
  return { clock, session, wake, states };
}

/**
 * @param {object} wake
 * @returns {{ ok: boolean, requestId?: string, code?: string, message?: string }}
 */
function start(wake) {
  return wake.start({ paused: true, currentTime: TARGET_TIME, frameSize: { ...FRAME } });
}

/**
 * @param {object[]} states
 * @returns {object}
 */
function latest(states) {
  return states[states.length - 1];
}

/**
 * @param {object} parameters
 */
function assertParameterBounds(parameters) {
  for (const [name, item] of Object.entries(parameters)) {
    assert.equal(item.min <= item.initial && item.initial <= item.max, true, name);
    assert.equal(item.step > 0, true, name);
  }
}

test('打包样例标明识别证据，且说明它不是正式素材', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const readme = fs.readFileSync(README_PATH, 'utf8');
  assert.equal(fixture.source, 'vision');
  assert.equal(fixture.fallback, null);
  assert.equal(fixture.evidence, 'packaged-sample');
  assert.equal(fixture.videoId.includes('fixture'), true);
  assert.equal(fixture.definition.equationId, 'fixture.parabola');
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, 'confidence'), false);
  assertParameterBounds(fixture.definition.parameters);
  const region = fixture.definition.region;
  assert.equal(region.width > 0 && region.height > 0, true);
  assert.equal(region.x >= 0 && region.y >= 0, true);
  assert.equal(region.x + region.width <= fixture.frameSize.width, true);
  assert.equal(region.y + region.height <= fixture.frameSize.height, true);
  assert.match(readme, /不是正式网课素材/);
  assert.match(readme, /也不代表外部识别已接通/);
  const serialized = JSON.stringify(fixture) + readme;
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|\bmodel\b/i.test(serialized), false);
});

test('createWake 不新增参数，页面状态也不新增字段', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'session', 'wake.js'), 'utf8');
  const signature = /function createWake\(\{([^}]*)\}/.exec(source);
  assert.ok(signature, '找不到 createWake 的签名');
  const params = signature[1].split(',').map((item) => item.trim().split(/[=\s]/)[0]).filter(Boolean);
  assert.deepEqual(params, WAKE_OPTIONS);
  const { wake, states } = setup();
  start(wake);
  assert.deepEqual(Object.keys(latest(states)).sort(), [...STATE_KEYS].sort());
});

test('visionAdapter 为 off、缺省或其他值时立即进入预制交互', () => {
  for (const visionAdapter of ['off', undefined, '', 'live', 'Fixture']) {
    const { clock, wake, states } = setup({ visionAdapter });
    const started = start(wake);
    assert.equal(started.ok, true, String(visionAdapter));
    const state = latest(states);
    assert.equal(state.status, 'interactive', String(visionAdapter));
    assert.equal(state.result.source, 'preset', String(visionAdapter));
    assert.equal(state.result.fallback, null, String(visionAdapter));
    assert.equal(state.result.evidence, undefined, String(visionAdapter));
    assert.equal(clock.pending(), 0, String(visionAdapter));
  }
});

test('fixture 且 externalAttempt 为 off 时，匹配样例进入识别交互', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const { clock, session, wake, states } = setup({ visionAdapter: 'fixture' });
  const started = start(wake);
  assert.equal(started.ok, true);
  assert.equal(clock.pending(), 0, '识别样例不得留下 1500ms 看门狗');
  const state = latest(states);
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.source, 'vision');
  assert.equal(state.result.fallback, null);
  assert.equal(state.result.evidence, 'packaged-sample');
  assert.equal(Object.prototype.hasOwnProperty.call(state.result, 'confidence'), false);
  assert.equal(state.result.requestId, started.requestId);
  assert.equal(state.requestId, started.requestId);
  assert.notEqual(state.result.requestId, fixture.requestId);
  assert.equal(state.result.videoId, fixture.videoId);
  assert.equal(Math.abs(state.result.time - TARGET_TIME) <= 0.2, true);
  assert.deepEqual(state.result.frameSize, FRAME);
  assertParameterBounds(state.result.definition.parameters);
  assert.deepEqual(Object.keys(state).sort(), [...STATE_KEYS].sort());

  session.updateParameter('h', 99);
  assert.equal(session.getState().currentParameters.h, 2);
  session.reset();
  assert.equal(session.getState().currentParameters.h, 0);
  assert.equal(wake.exit().status, 'paused-ready');
});

test('识别样例不依赖同时传入的预制结果', () => {
  const { wake, states } = setup({ visionAdapter: 'fixture', presetResult: null });
  const started = start(wake);
  assert.equal(started.ok, true);
  assert.equal(latest(states).result.source, 'vision');
  assert.equal(latest(states).result.evidence, 'packaged-sample');
});

test('fixture 不能压过 hang 的预制超时回退', () => {
  const { clock, wake, states } = setup({ visionAdapter: 'fixture', externalAttempt: 'hang' });
  assert.equal(start(wake).ok, true);
  assert.equal(latest(states).status, 'waiting');
  assert.equal(latest(states).result, null);
  clock.advance(1500);
  const settled = latest(states);
  assert.equal(settled.status, 'interactive');
  assert.equal(settled.result.source, 'preset');
  assert.equal(settled.result.fallback, 'timeout');
  assert.equal(settled.result.evidence, undefined);
});

test('播放离开目标时间后结束识别会话', () => {
  const { wake } = setup({ visionAdapter: 'fixture' });
  start(wake);
  const state = wake.onPlaybackChange({ paused: false, currentTime: TARGET_TIME });
  assert.equal(state.status, 'paused-ready');
  assert.equal(state.result, null);
});
