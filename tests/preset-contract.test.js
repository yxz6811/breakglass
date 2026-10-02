const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../extension/assets/config.json');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { validateCurveResult } = require('../extension/src/curve/validate');

test('runtime config stays on the offline preset path', () => {
  assert.equal(config.enableLocalMock, true);
  assert.equal(config.fallbackAfterMs, 1500);
  assert.equal(config.presetKey, 'demo-parabola');
  assert.equal(config.prewarmed, true);
  assert.equal(config.externalAttempt, 'off');
  const serialized = JSON.stringify(config);
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|model/i.test(serialized), false);
});

test('demo preset is a valid fixture and not a vision result', () => {
  assert.equal(validateCurveResult(preset).ok, true);
  assert.equal(preset.source, 'preset');
  assert.equal(preset.fallback, null);
  assert.equal(preset.definition.equationId, 'fixture.parabola');
  assert.equal(preset.videoId.includes('fixture'), true);
  assert.equal(preset.fixture, true);
  assert.match(preset.note, /不是|不代表|夹具/);
});
