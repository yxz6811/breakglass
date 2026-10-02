/**
 * 识别适配开关的配置夹具。T006 完成前，缺省开关不会被收成 off。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../extension/assets/config.json');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { loadPreset } = require('../extension/src/preset/load');

/**
 * @param {object} configBody
 * @returns {Promise<{ ok: boolean, config?: object, result?: object }>}
 */
async function loadWith(configBody) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    const body = target.includes('config') ? configBody : preset;
    return {
      ok: true,
      status: 200,
      json: async () => body
    };
  };
  try {
    return await loadPreset({
      configPath: 'http://local/config.json',
      presetBasePath: 'http://local/presets/'
    });
  } finally {
    global.fetch = original;
  }
}

/**
 * @returns {object}
 */
function runnableConfig(overrides = {}) {
  return {
    enableLocalMock: true,
    fallbackAfterMs: 1500,
    presetKey: 'demo-parabola',
    prewarmed: true,
    externalAttempt: 'off',
    ...overrides
  };
}

test('committed runtime config keeps the vision adapter off', () => {
  assert.equal(config.visionAdapter, 'off');
  assert.equal(config.externalAttempt, 'off');
  assert.equal(config.fallbackAfterMs, 1500);
  const serialized = JSON.stringify(config);
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|model/i.test(serialized), false);
});

test('loadPreset returns fixture only for that exact adapter value', async () => {
  const opened = await loadWith(runnableConfig({ visionAdapter: 'fixture' }));
  assert.equal(opened.ok, true);
  assert.equal(opened.config.visionAdapter, 'fixture');
});

test('loadPreset treats a missing or unknown visionAdapter as off', async () => {
  const missing = await loadWith(runnableConfig());
  assert.equal(missing.ok, true);
  assert.equal(missing.config.visionAdapter, 'off');

  for (const visionAdapter of ['', 'live', 'on', 'Fixture']) {
    const loaded = await loadWith(runnableConfig({ visionAdapter }));
    assert.equal(loaded.ok, true);
    assert.equal(loaded.config.visionAdapter, 'off', visionAdapter);
  }
});
