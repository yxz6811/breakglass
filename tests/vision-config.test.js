/**
 * T005：识别开关的配置夹具。实现见 extension/assets/config.json 与 extension/src/preset/load.js（T006）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../extension/assets/config.json');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { loadPreset } = require('../extension/src/preset/load');

const CONFIG_PATH = 'http://local/config.json';
const PRESET_BASE = 'http://local/presets/';

function baseConfig(overrides = {}) {
  return {
    enableLocalMock: true,
    prewarmed: true,
    presetKey: 'demo-parabola',
    fallbackAfterMs: 1500,
    externalAttempt: 'off',
    ...overrides
  };
}

async function withConfig(configBody, run) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    return { ok: true, status: 200, json: async () => (target.includes('config') ? configBody : preset) };
  };
  try {
    return await run();
  } finally {
    global.fetch = original;
  }
}

function load(body) {
  return withConfig(body, () => loadPreset({ configPath: CONFIG_PATH, presetBasePath: PRESET_BASE }));
}

test('提交配置保持关闭：visionAdapter 为 off，其余开关不变', () => {
  assert.equal(config.visionAdapter, 'off', '随扩展提交的识别开关必须是 off');
  assert.equal(config.externalAttempt, 'off');
  assert.equal(config.fallbackAfterMs, 1500);
  assert.equal(config.enableLocalMock, true);
  assert.equal(config.prewarmed, true);
  const serialized = JSON.stringify(config);
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|model/i.test(serialized), false);
});

test('visionAdapter 只有 fixture 才生效，其余一律按 off', async () => {
  const enabled = await load(baseConfig({ visionAdapter: 'fixture' }));
  assert.equal(enabled.ok, true);
  assert.equal(enabled.config.visionAdapter, 'fixture');

  for (const value of [undefined, '', 'on', 'FIXTURE', 'true', true, null, 0, 'vision', 'off']) {
    const loaded = await load(baseConfig(value === undefined ? {} : { visionAdapter: value }));
    assert.equal(loaded.ok, true, 'config=' + JSON.stringify(value));
    assert.equal(loaded.config.visionAdapter, 'off', '值 ' + JSON.stringify(value) + ' 必须按 off 处理');
  }
});

test('预制不可用时仍按值归一化开关（识别路径不受 enableLocalMock 约束）', async () => {
  const disabled = await load(baseConfig({ enableLocalMock: false, visionAdapter: 'on' }));
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'preset_disabled');
  assert.equal(disabled.config.visionAdapter, 'off', '无效值在失败路径上也要归一化');

  // 契约只在 visionAdapter === fixture 且 externalAttempt === off 时走识别样例，不要求 enableLocalMock。
  const kept = await load(baseConfig({ enableLocalMock: false, visionAdapter: 'fixture' }));
  assert.equal(kept.code, 'preset_disabled');
  assert.equal(kept.config.visionAdapter, 'fixture', 'fixture 是合法值，不因预制不可用被改写');
});

test('load.js 不新增远程地址、上传或模型名', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'preset', 'load.js'), 'utf8');
  assert.doesNotMatch(source, /api[_-]?key|secret|token|authorization|upload|\bmodel\b/i);
});
