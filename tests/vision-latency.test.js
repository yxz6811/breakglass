/**
 * T014：识别判定耗时单独记录，不混进预制回退。实现见 extension/src/page/main.js（T015）。
 * 用假 DOM 驱动真实 main.js；样例由测试替身从扩展目录读取。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

const BANNED = ['extension-open', 'video-first-frame', 'network-wait', 'p1-init'];
const VISION_NAME = 'vision-decision';

async function wakeWith(harness) {
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

test('识别成功记录一条 vision-decision，且不写入 fallback-visible', async () => {
  const harness = await createHarness({ config: { visionAdapter: 'fixture', externalAttempt: 'off' } });
  try {
    harness.ready();
    await wakeWith(harness);
    const log = harness.win.__breakglassLatency;
    assert.ok(log, '页面必须暴露只读计时输出');
    const summary = log.summary();
    assert.equal(typeof summary[VISION_NAME], 'object', '必须记录 vision-decision');
    assert.equal(summary[VISION_NAME].count >= 1, true);
    assert.equal('fallback-visible' in summary, false, '识别路径不得写入 fallback-visible');
    assert.equal('vision-decision->svg-visible' in summary, false);
    const sample = log.snapshot()[VISION_NAME][0];
    assert.deepEqual(Object.keys(sample).sort(), ['cache', 'ms', 'status'], '样本只含名称、毫秒数与缓存状态');
    assert.equal(['hot', 'cold'].includes(sample.cache), true);
    assert.equal(Number.isFinite(sample.ms), true);
    assert.equal(sample.ms >= 0, true);
    assert.equal(harness.elements['source-label'].textContent, '识别结果');
  } finally {
    harness.restore();
  }
});

test('识别失败也记录 vision-decision，仍然不碰 fallback-visible', async () => {
  const original = globalThis.fetch;
  const harness = await createHarness({ config: { visionAdapter: 'fixture', externalAttempt: 'off' } });
  try {
    harness.ready();
    // 让样例读取失败：识别路径必须记一次判定耗时，并进入可恢复错误。
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await wakeWith(harness);
    const summary = harness.win.__breakglassLatency.summary();
    assert.equal(typeof summary[VISION_NAME], 'object');
    assert.equal(summary[VISION_NAME].count >= 1, true);
    assert.equal('fallback-visible' in summary, false);
    assert.equal(harness.elements['source-label'].textContent, '等待素材');
  } finally {
    globalThis.fetch = original;
    harness.restore();
  }
});

test('预制路径不写 vision-decision，超时回退分别写 DOM 和帧时序', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    harness.ready();
    harness.elements['wake-button'].dispatch('click');
    harness.advance(1500);
    await flush();
    harness.frame();
    harness.frame();
    const summary = harness.win.__breakglassLatency.summary();
    assert.equal(VISION_NAME in summary, false, '预制路径不得写识别计时');
    assert.equal(typeof summary['fallback-dom-ready'], 'object');
    assert.equal(summary['fallback-frame-ready'].count, 1);
  } finally {
    harness.restore();
  }
});

test('两组耗时分开可查，且不含被排除的四个名称', async () => {
  const vision = await createHarness({ config: { visionAdapter: 'fixture', externalAttempt: 'off' } });
  try {
    vision.ready();
    await wakeWith(vision);
    const summary = vision.win.__breakglassLatency.summary();
    for (const name of BANNED) {
      assert.equal(name in summary, false, name + ' 不得出现在计时里');
    }
    for (const name of Object.keys(summary)) {
      assert.equal(BANNED.includes(name), false, name);
    }
  } finally {
    vision.restore();
  }
});
