// 页面集成测试：用最小假 DOM 驱动真实的 extension/src/page/main.js，验证故事 2 的可见状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, flush } = require('./helpers/fake-page.js');
const preset = require('../extension/assets/presets/demo-parabola.json');

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
    assert.equal(elements['exit-button'].disabled, false, '等待中仍然可以退出');
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
    assert.equal(elements['exit-button'].disabled, false, '可恢复错误必须提供重试与退出');
    assert.equal(elements['state-label'].textContent.includes('外部结果不可用'), true);
    assert.equal(elements['source-label'].textContent, '等待素材');
    elements['retry-button'].dispatch('click');
    assert.equal(elements['state-label'].textContent.includes('正在等待外部结果'), true);
  } finally {
    harness.restore();
  }
});

test('目标时间默认是 6 秒，会话仍跟随输入框当前值', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    const html = fs.readFileSync(path.join(__dirname, '../extension/demo/index.html'), 'utf8');
    assert.match(html, /id="target-time"[^>]*value="6"/);
    assert.equal(elements['target-time'].value, '6');
    assert.equal(elements['state-label'].textContent, '先选择一个视频。文件留在这台浏览器里。');
    assert.equal(elements['asset-empty'].hidden, false);
    assert.equal(video.src, '');
    harness.ready();
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay(), '默认 6 秒并暂停在 6 应出现曲线');
    harness.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(harness.overlay(), null);
    elements['target-time'].value = '4';
    video.currentTime = 6;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    video.currentTime = 4;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, true, '准备结果是 6 秒，停在 4 秒不能破壁');
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    assert.match(elements['state-label'].textContent, /6/);
    elements['target-time'].value = '6.1';
    video.currentTime = 6.1;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay(), '停在准备结果时间容差内仍可破壁');
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

test('3024×1898 破壁时把预制区域换算进当前帧，来源仍是预先准备的示例', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    const frame = { width: 3024, height: 1898 };
    harness.ready();
    video.videoWidth = frame.width;
    video.videoHeight = frame.height;
    video.paused = true;
    video.currentTime = 6;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    assert.ok(overlay, '3024×1898 应能破壁');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    const pathNode = overlay.querySelector('path');
    const points = [...pathNode.getAttribute('d').matchAll(/([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    const scaleX = frame.width / preset.frameSize.width;
    const scaleY = frame.height / preset.frameSize.height;
    const region = preset.definition.region;
    const sourceX = (region.x + region.width / 2) * scaleX;
    const sourceY = (region.y + region.height / 2) * scaleY;
    const displayScale = Math.min(video.rect.width / frame.width, video.rect.height / frame.height);
    const mid = points[40];
    assert.ok(Math.abs(Number(mid[2]) - sourceX * displayScale) < 0.02);
    assert.ok(Math.abs(Number(mid[3]) - sourceY * displayScale) < 0.02);
    const unscaledX = (region.x + region.width / 2) * displayScale;
    assert.ok(Math.abs(Number(mid[2]) - unscaledX) > 1, '不能只改 frameSize 而留下 1920×1080 的区域');
    harness.document.dispatch('keydown', { key: 'Escape' });
    elements['wake-button'].dispatch('click');
    const again = [...harness.overlay().querySelector('path').getAttribute('d').matchAll(/([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    assert.equal(again[40][2], mid[2]);
    assert.equal(again[40][3], mid[3]);
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

test('选择本地视频只换成浏览器内地址，并卸下已有曲线', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    harness.ready();
    video.setAttribute('data-video-id', 'fixture-parabola');
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    const input = elements['local-video'];
    input.files = [new Blob(['not-a-video'], { type: 'text/plain' })];
    input.dispatch('change');
    assert.equal(video.getAttribute('data-video-id'), 'fixture-parabola');
    assert.ok(harness.overlay(), '非视频文件不应换掉当前画面');
    input.files = [new Blob(['video'], { type: 'video/mp4' })];
    input.dispatch('change');
    assert.match(String(video.src), /^blob:/);
    assert.equal(video.getAttribute('data-video-id'), null);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['wake-button'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null, '新视频的尺寸还没到，不能用上一帧破壁');
    assert.equal(elements['state-label'].textContent, '正在读取所选视频。');
    video.dispatch('loadedmetadata');
    assert.equal(elements['wake-button'].disabled, false);
  } finally {
    harness.restore();
  }
});
