/**
 * T007：识别样例的成功路径。实现见 extension/src/session/wake.js 等（T010）。
 * 时钟由测试注入；样例通过真实 fetch 读取包内文件，不使用真实 setTimeout。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SessionController } = require('../extension/src/session/session');
const wakeApi = require('../extension/src/session/wake');
const { createFakeClock, flush } = require('./helpers/fake-clock.js');

const PRESET = require('../extension/assets/presets/demo-parabola.json');
const VISION = require('../extension/assets/vision/fixture-parabola.json');
const FRAME = { width: 1920, height: 1080 };
const TARGET_TIME = 6;
const STATE_KEYS = ['status', 'requestId', 'result', 'currentParameters', 'initialParameters', 'code', 'message'];

async function withVisionFile(run, candidate = VISION) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (!target.includes('vision/fixture-parabola.json')) throw new Error('意外的读取路径：' + target);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(candidate)) };
  };
  try {
    return await run();
  } finally {
    global.fetch = original;
  }
}

function setup({ visionAdapter = 'off', externalAttempt = 'off', frameSize = { ...FRAME } } = {}) {
  const clock = createFakeClock();
  const session = new SessionController({
    videoId: VISION.videoId,
    targetTime: TARGET_TIME,
    frameSize: { ...frameSize },
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
      visionAdapter
    },
    preset: JSON.parse(JSON.stringify(PRESET)),
    clock,
    onChange: (state) => states.push(state)
  });
  return { clock, session, wake, states, latest: () => states[states.length - 1] };
}

function start(wake, frameSize = { ...FRAME }) {
  return wake.start({ paused: true, currentTime: TARGET_TIME, frameSize });
}

test('visionAdapter 为 off 时走预制主路径，不出现 vision', async () => {
  const h = setup({ visionAdapter: 'off' });
  const started = start(h.wake);
  assert.equal(started.ok, true);
  const state = h.latest();
  assert.equal(state.status, 'interactive');
  assert.equal(state.result.source, 'preset');
  assert.equal(state.result.fallback, null);
  assert.equal(state.result.evidence, undefined);
  assert.equal(h.clock.pending(), 0, '主路径不得留下定时器');
});

test('visionAdapter 缺省或其他值时按 off 处理，不读识别样例', async () => {
  for (const value of [undefined, '', 'on', 'FIXTURE', true]) {
    const h = setup({ visionAdapter: value });
    start(h.wake);
    assert.equal(h.latest().result.source, 'preset', 'visionAdapter=' + JSON.stringify(value));
  }
});

test('fixture + 样例匹配时进入 interactive，来源为 vision 且带 evidence', async () => {
  await withVisionFile(async () => {
    const h = setup({ visionAdapter: 'fixture' });
    const started = start(h.wake);
    assert.equal(started.ok, true);
    await flush();
    const state = h.latest();
    assert.equal(state.status, 'interactive');
    assert.equal(state.result.source, 'vision');
    assert.equal(state.result.fallback, null);
    assert.equal(state.result.evidence, 'packaged-sample');
    assert.equal(state.requestId, state.result.requestId);
    assert.deepEqual(Object.keys(state).sort(), [...STATE_KEYS].sort());
    assert.equal(h.clock.pending(), 0, '识别成功不得人为等待 1500ms');
  });
});

test('识别样例的参数范围仍然满足 min ≤ initial ≤ max 且 step > 0', async () => {
  await withVisionFile(async () => {
    const h = setup({ visionAdapter: 'fixture' });
    start(h.wake);
    await flush();
    const parameters = h.latest().result.definition.parameters;
    for (const name of Object.keys(parameters)) {
      const item = parameters[name];
      assert.equal(item.min <= item.initial && item.initial <= item.max, true, name);
      assert.equal(item.step > 0, true, name);
    }
    assert.equal(h.session.getState().currentParameters.a >= 0.4, true);
  });
});

test('识别样例不经过预制缓存：preset 为 null 时也能进入交互', async () => {
  await withVisionFile(async () => {
    const clock = createFakeClock();
    const session = new SessionController({ videoId: VISION.videoId, targetTime: TARGET_TIME, frameSize: { ...FRAME }, externalAttempt: 'off' });
    const states = [];
    const wake = wakeApi.createWake({
      session,
      config: { enableLocalMock: true, prewarmed: true, fallbackAfterMs: 1500, externalAttempt: 'off', visionAdapter: 'fixture' },
      preset: null,
      clock,
      onChange: (state) => states.push(state)
    });
    start(wake);
    await flush();
    assert.equal(states[states.length - 1].result.source, 'vision');
  });
});

test('包内样例文件本身符合契约（可被同一校验器放行）', () => {
  const { validateCurveResult } = require('../extension/src/curve/validate');
  const check = validateCurveResult(VISION, { allowVision: true });
  assert.equal(check.ok, true, check.message);
  assert.equal(VISION.evidence, 'packaged-sample');
  assert.equal(VISION.videoId.includes('fixture'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(VISION, 'confidence'), false);
  const raw = fs.readFileSync(path.join(__dirname, '..', 'extension', 'assets', 'vision', 'fixture-parabola.json'), 'utf8');
  assert.equal(raw.includes('//'), false, 'JSON 内不得写注释');
  assert.doesNotMatch(raw, /https?:\/\/|api[_-]?key|secret|token|authorization|\bmodel\b/i);
});
