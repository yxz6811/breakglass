// 页面集成测试：用最小假 DOM 驱动真实的 extension/src/page/main.js，验证故事 2 的可见状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

test('off 主路径：破壁后挂载覆盖层并持续显示来源', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    assert.equal(elements['runtime-note'].textContent.includes('off'), true);
    harness.ready();
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    assert.ok(overlay, '破壁后应挂载覆盖层');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(elements['retry-button'].hidden, true);
    const pathNode = overlay.querySelector('path');
    const points = [...pathNode.getAttribute('d').matchAll(/([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    assert.equal(points.length, 81);
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-h'].value, '0');
    harness.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(harness.overlay(), null);
    assert.equal(video.paused, true);
  } finally {
    harness.restore();
  }
});

test('hang：等待态可取消，1.5 秒后自动回退并持续显示原因', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null, '等待中不得有曲线');
    assert.equal(elements['cancel-button'].hidden, false);
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['state-label'].textContent.includes('正在等待外部结果'), true);
    harness.advance(1499);
    assert.equal(harness.overlay(), null);
    harness.advance(1);
    assert.ok(harness.overlay(), '1.5 秒后应自动出现曲线');
    assert.equal(elements['source-label'].textContent, '预先准备的示例 · 超时回退');
    assert.equal(elements['source-note'].textContent.includes('1.5 秒'), true);
    assert.equal(elements['cancel-button'].hidden, true);
    const summary = harness.win.__breakglassLatency.summary();
    assert.equal(summary['fallback-visible'].count >= 1, true, '应记录回退显现耗时');
    assert.equal(summary['fallback-visible'].max <= 100, true, 'SC-003 口径应小于 0.1 秒');
  } finally {
    harness.restore();
  }
});

test('取消等待：回到暂停画面，等待提示消失', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'late' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    assert.equal(elements['cancel-button'].hidden, false);
    elements['cancel-button'].dispatch('click');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
    assert.equal(elements['state-label'].textContent.includes('已取消等待'), true);
    harness.advance(5000);
    assert.equal(harness.overlay(), null, '迟到结果不得再打开交互层');
  } finally {
    harness.restore();
  }
});

test('invalid：非法外部结果进入可恢复错误并提供重试', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'invalid' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    harness.advance(0);
    await flush();
    assert.equal(harness.overlay(), null);
    assert.equal(elements['retry-button'].hidden, false);
    assert.equal(elements['state-label'].textContent.includes('外部结果不可用'), true);
    assert.equal(elements['source-label'].textContent, '等待素材');
    elements['retry-button'].dispatch('click');
    assert.equal(elements['state-label'].textContent.includes('正在等待外部结果'), true);
  } finally {
    harness.restore();
  }
});

test('目标时间跟随输入框：默认是预制时间，改到别的时间并暂停在那里可以破壁', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    assert.equal(elements['target-time'].value, '6');
    assert.equal(elements['state-label'].textContent, '正式视频素材尚未提供，加载视频后可验证交互。');
    assert.equal(elements['asset-empty'].hidden, false);
    assert.equal(video.src, undefined);
    harness.ready();
    video.currentTime = 4;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    elements['target-time'].value = '4';
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay(), '输入 4 并暂停在 4 应出现曲线');
  } finally {
    harness.restore();
  }
});

test('只有宽度、高度还是 0 时不把破壁记成准备结果不可用', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    harness.ready();
    video.videoWidth = 3024;
    video.videoHeight = 0;
    video.currentTime = 6;
    video.paused = true;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    assert.equal(elements['state-label'].textContent, '请先暂停在目标时间。');
    assert.equal(elements['source-label'].textContent, '等待素材');
  } finally {
    harness.restore();
  }
});

test('播放会让等待或交互状态一起结束', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const { elements, video } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    video.paused = false;
    video.dispatch('play');
    assert.equal(elements['cancel-button'].hidden, true);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
  } finally {
    harness.restore();
  }
});
