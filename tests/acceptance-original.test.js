/**
 * 按飞书《演示验收清单》原文第 1–10 行重测。
 * 用假 DOM 驱动真实 main.js；预期结果与当前实现不一致的行在测试名里标出。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, flush } = require('./helpers/fake-page.js');

const extensionDir = path.join(__dirname, '..', 'extension');
const readText = (rel) => fs.readFileSync(path.join(extensionDir, rel), 'utf8');
const preset = require('../extension/assets/presets/demo-parabola.json');

async function interactive(configOverrides) {
  const harness = await createHarness(configOverrides ? { config: configOverrides } : undefined);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

const pathData = (harness) => harness.overlay().querySelector('path').getAttribute('d');
const handleX = (harness) => Number(harness.overlay().querySelector('circle').getAttribute('cx'));

test('1 播放/暂停：可播放可暂停，按钮文案随状态切换', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    harness.ready();
    assert.equal(video.paused, true);
    elements['play-toggle'].dispatch('click');
    assert.equal(video.paused, false, '点击后应开始播放');
    video.dispatch('play');
    assert.equal(elements['play-toggle'].getAttribute('aria-label'), '暂停视频');
    elements['play-toggle'].dispatch('click');
    assert.equal(video.paused, true, '再点击应暂停');
    video.dispatch('pause');
  } finally {
    harness.restore();
  }
});

test('2 定位到 12.5 秒：输入框能填 12.5，但包内成片只有 9 秒 → 该行预期需改为 6 秒', async () => {
  const videoReadme = readText('assets/video/README.md');
  assert.match(videoReadme, /9 秒/, '包内成片是 9 秒');
  assert.match(videoReadme, /目标时间初值设为 6 秒/, '演示页默认目标时间是 6 秒');
  assert.equal(preset.time, 6, '预制时间也是 6 秒');
  const harness = await createHarness();
  try {
    const { elements } = harness;
    harness.ready();
    assert.equal(elements['target-time'].value, '6', '默认目标是 6 秒');
    elements['target-time'].value = '12.5';
    elements['jump-target'].dispatch('click');
    assert.equal(harness.elements['target-time'].value, '12.5', '输入框接受 12.5，但 9 秒片子到不了 12.5 秒');
  } finally {
    harness.restore();
  }
});

test('3 停在目标帧后出现抛物线与控制点（当前默认 6 秒，不是 12.5 秒）', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.notEqual(harness.overlay(), null, '应出现抛物线覆盖层');
    assert.equal(harness.video.currentTime, 6);
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    assert.equal(elements['parameter-h'].disabled, false, '控制点对应的 h 可调');
  } finally {
    harness.restore();
  }
});

test('4 拖动控制点或滑杆，改变水平位置 h', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.match(readText('src/page/main.js'), /circle r="10"[^>]*tabindex="0"/, '控制点可聚焦、可拖动');
    const before = pathData(harness);
    elements['parameter-h'].value = '1.5';
    elements['parameter-h'].dispatch('input');
    assert.equal(elements['parameter-h-value'].textContent, '1.5');
    assert.notEqual(pathData(harness), before, '曲线应随 h 重绘');
    assert.notEqual(handleX(harness), 0, '控制点应跟着移动');
  } finally {
    harness.restore();
  }
});

test('5 改变 h 后曲线、顶点与 h 数字同步', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    const samples = [];
    for (const value of ['0', '1', '-2']) {
      elements['parameter-h'].value = value;
      elements['parameter-h'].dispatch('input');
      samples.push({ value, text: elements['parameter-h-value'].textContent, cx: handleX(harness), d: pathData(harness) });
    }
    assert.equal(samples[0].text, '0.0');
    assert.equal(samples[1].text, '1.0');
    assert.equal(samples[2].text, '-2.0');
    assert.equal(new Set(samples.map((s) => s.d)).size, 3, '三次曲线都不同');
    assert.equal(new Set(samples.map((s) => s.cx)).size, 3, '控制点三次位置都不同');
  } finally {
    harness.restore();
  }
});

test('6 将 h 拖到 ±2 并继续越界：只在 -2~2 内变化', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    elements['parameter-h'].value = '5';
    elements['parameter-h'].dispatch('input');
    assert.equal(elements['parameter-h-value'].textContent, '2.0');
    elements['parameter-h'].value = '-9';
    elements['parameter-h'].dispatch('input');
    assert.equal(elements['parameter-h-value'].textContent, '-2.0');
    assert.match(elements['parameter-h'].getAttribute('aria-valuetext'), /范围 -2 到 2/);
  } finally {
    harness.restore();
  }
});

test('7 尝试调整 a 或 k：现在可调 → 文档预期「无调整入口、不可调」已过时', async () => {
  const html = readText('demo/index.html');
  assert.match(html, /id="parameter-a"/, 'a 已有滑块');
  assert.match(html, /id="parameter-k"/, 'k 已有滑块');
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.equal(elements['parameter-a'].disabled, false);
    assert.equal(elements['parameter-k'].disabled, false);
    const before = pathData(harness);
    elements['parameter-a'].value = '1.2';
    elements['parameter-a'].dispatch('input');
    const afterA = pathData(harness);
    assert.notEqual(afterA, before, 'a 能改变曲线');
    elements['parameter-k'].value = '1.5';
    elements['parameter-k'].dispatch('input');
    assert.notEqual(pathData(harness), afterA, 'k 能改变曲线');
    assert.equal(elements['parameter-a-value'].textContent, '1.2');
    assert.equal(elements['parameter-k-value'].textContent, '1.5');
  } finally {
    harness.restore();
  }
});

test('8 点击重置：h 回 0，交互层保留，视频仍暂停在目标帧（默认 6 秒）', async () => {
  const harness = await interactive();
  try {
    const { elements, video } = harness;
    elements['parameter-h'].value = '1.5';
    elements['parameter-h'].dispatch('input');
    elements['parameter-a'].value = '1.2';
    elements['parameter-a'].dispatch('input');
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-h-value'].textContent, '0.0');
    assert.equal(elements['parameter-a-value'].textContent, '1.0');
    assert.equal(elements['parameter-k-value'].textContent, '1.0');
    assert.notEqual(harness.overlay(), null, '交互层保留');
    assert.equal(video.paused, true, '视频仍保持暂停');
    assert.equal(video.currentTime, 6, '仍停在目标帧');
  } finally {
    harness.restore();
  }
});

test('9 点击退出：曲线与控制点消失，视频仍保持暂停', async () => {
  const harness = await interactive();
  try {
    const { elements, video } = harness;
    elements['exit-button'].dispatch('click');
    assert.equal(harness.overlay(), null, '覆盖层已移除');
    assert.equal(video.paused, true, '视频保持暂停');
    assert.equal(elements['parameter-h'].disabled, true, '参数区不可调');
  } finally {
    harness.restore();
  }
});

test('10 来源标注：唤醒后始终为「预先准备的示例」', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    assert.match(elements['source-note'].textContent, /预先准备/);
    assert.doesNotMatch(elements['source-label'].textContent, /识别结果/);
  } finally {
    harness.restore();
  }
});
