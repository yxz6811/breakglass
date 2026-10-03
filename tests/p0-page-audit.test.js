/**
 * P0 演示页边缘：失败态必须能退出，拖动按位移而不是跳到指针，卸载时卸下覆盖层。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');
const preset = require('../extension/assets/presets/demo-parabola.json');

/**
 * 假页面里 1920×1080 在默认矩形上的指针横坐标。
 * 内容区 left=100、scale=1280/1920。区域按预制画幅换进这一帧。
 * @param {number} mathX
 * @returns {number}
 */
function clientXFor(mathX) {
  const videoWidth = 1920;
  const scale = 1280 / videoWidth;
  const region = preset.definition.region;
  const domain = preset.definition.domain;
  const scaleX = videoWidth / preset.frameSize.width;
  const sourceX = region.x * scaleX +
    ((mathX - domain.min) / (domain.max - domain.min)) * region.width * scaleX;
  return 100 + sourceX * scale;
}

async function readyHarness(config) {
  const harness = await createHarness(config ? { config } : undefined);
  harness.ready();
  return harness;
}

test('空格不会破壁，点击舞台外部会退出并保持暂停', async () => {
  const harness = await readyHarness();
  try {
    harness.document.dispatch('keydown', { key: ' ' });
    assert.equal(harness.overlay(), null);
    harness.elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    harness.stage.dispatch('click', { target: harness.video });
    assert.ok(harness.overlay(), '点视频或原生控制条不退出');
    const control = harness.document.createElement('div');
    harness.video.appendChild(control);
    harness.stage.dispatch('click', { target: control });
    assert.ok(harness.overlay(), '点在播放器内部也不退出');
    harness.stage.dispatch('click', { target: harness.stage });
    assert.equal(harness.overlay(), null);
    assert.equal(harness.video.paused, true);
  } finally {
    harness.restore();
  }
});

test('从曲线一侧按下不会把顶点跳到指针，松手或取消后不再跟随', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    const path = overlay.querySelector('path');
    const at = (clientX) => ({ target: path, clientX, clientY: 400, pointerId: 1 });
    overlay.dispatch('pointerdown', at(clientXFor(-2)));
    overlay.dispatch('pointermove', at(clientXFor(-2)));
    assert.equal(harness.elements['parameter-h-value'].textContent, '0.0');
    overlay.dispatch('pointermove', at(clientXFor(-1)));
    assert.equal(harness.elements['parameter-h-value'].textContent, '1.0');
    overlay.dispatch('pointercancel', at(clientXFor(2)));
    overlay.dispatch('pointermove', at(clientXFor(2)));
    assert.equal(harness.elements['parameter-h-value'].textContent, '1.0');
  } finally {
    harness.restore();
  }
});

test('失败态可以从初始禁用的退出按钮和 Esc 离开', async () => {
  const harness = await readyHarness({ externalAttempt: 'invalid' });
  try {
    const { elements } = harness;
    assert.equal(elements['exit-button'].disabled, true);
    elements['wake-button'].dispatch('click');
    harness.advance(0);
    await flush();
    assert.equal(elements['retry-button'].hidden, false);
    assert.equal(elements['exit-button'].disabled, false);
    harness.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(elements['retry-button'].hidden, true);
    assert.equal(elements['exit-button'].disabled, true);
    assert.equal(elements['state-label'].textContent.includes('外部结果不可用'), false);
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('播放会清掉失败提示，而不是把错误说明留在已经结束的会话上', async () => {
  const harness = await readyHarness({ externalAttempt: 'invalid' });
  try {
    const { elements, video } = harness;
    elements['wake-button'].dispatch('click');
    harness.advance(0);
    await flush();
    assert.equal(elements['state-label'].classList.contains('is-error'), true);
    video.paused = false;
    video.dispatch('play');
    assert.equal(video.paused, false);
    assert.equal(elements['retry-button'].hidden, true);
    assert.equal(elements['exit-button'].disabled, true);
    assert.equal(elements['state-label'].classList.contains('is-error'), false);
    assert.equal(elements['source-label'].textContent, '等待素材');
    assert.equal(elements['state-label'].textContent.includes('外部结果不可用'), false);
  } finally {
    harness.restore();
  }
});

test('等待中可以退出，超时后的结果不再打开', async () => {
  const harness = await readyHarness({ externalAttempt: 'hang' });
  try {
    const { elements } = harness;
    elements['wake-button'].dispatch('click');
    assert.equal(elements['exit-button'].disabled, false);
    elements['exit-button'].dispatch('click');
    harness.advance(2000);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
    assert.equal(elements['cancel-button'].hidden, true);
  } finally {
    harness.restore();
  }
});

test('页面转入后台时卸下覆盖层', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    let destroyed = 0;
    harness.win.BreakGlassUI = { docks: [{ destroy() { destroyed += 1; } }] };
    harness.win.dispatch('pagehide');
    assert.equal(destroyed, 1, '转入后台时应卸下顶栏');
    assert.equal(harness.overlay(), null);
    assert.equal(harness.win.__breakglassAlignment, null);
    assert.equal(harness.elements['reset-button'].disabled, true);
    assert.equal(harness.elements['exit-button'].disabled, true);
    assert.equal(harness.elements['parameter-h'].disabled, true);
    assert.equal(harness.elements['waiting-bar'].hidden, true);
  } finally {
    harness.restore();
  }
});

test('配置没加载成功时不挂包内片子，随后的视频错误也不改口', async () => {
  const harness = await createHarness({
    config: { prewarmed: false },
    packagedVideoErrors: true
  });
  try {
    harness.advance(20);
    await flush();
    assert.equal(harness.elements['runtime-note'].textContent, '配置加载失败');
    assert.equal(harness.elements['state-label'].textContent.includes('预制结果未启用或尚未预热'), true);
    assert.equal(String(harness.video.src).includes('breakglass-demo-9s.mp4'), false);
    assert.equal(harness.elements['state-label'].textContent.includes('视频无法加载'), false);
  } finally {
    harness.restore();
  }
});

test('object-fit 不是 contain 时重算不抛错，已画的曲线还留在原位', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    const before = harness.overlay().querySelector('path').getAttribute('d');
    const previous = global.getComputedStyle;
    global.getComputedStyle = () => ({ objectFit: 'cover', objectPosition: '50% 50%' });
    assert.doesNotThrow(() => harness.win.dispatch('resize'));
    assert.equal(harness.overlay().querySelector('path').getAttribute('d'), before);
    global.getComputedStyle = previous;
  } finally {
    harness.restore();
  }
});
