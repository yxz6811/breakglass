/**
 * 路演现场会碰到、但主路径测试覆盖不到的操作。
 * 断言写的是现场不能翻车的行为。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

/**
 * 默认夹具矩形上，数学横坐标对应的指针位置。
 * @param {number} mathX
 * @returns {number}
 */
function clientXFor(mathX) {
  const scale = 1280 / 1920;
  const sourceX = 480 + ((mathX + 4) / 8) * 960;
  return 100 + sourceX * scale;
}

/**
 * @param {object} [config]
 */
async function readyHarness(config) {
  const harness = await createHarness(config ? { config } : undefined);
  harness.ready();
  return harness;
}

test('点在画面上不会把曲线清掉，只有点到画面外面才退出', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    overlay.dispatch('pointerdown', { target: overlay, clientX: 400, clientY: 400, pointerId: 1 });
    harness.stage.dispatch('click', { target: overlay });
    assert.ok(harness.overlay(), '点在覆盖层空白处应留下曲线，方便讲解时指画面');
    harness.stage.dispatch('click', { target: harness.video });
    assert.equal(harness.overlay(), null);
    assert.equal(harness.video.paused, true);
  } finally {
    harness.restore();
  }
});

test('控制点落在曲线顶点上，而不是落在相邻采样点旁边', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    const path = overlay.querySelector('path');
    overlay.dispatch('pointerdown', { target: path, clientX: clientXFor(0), clientY: 400, pointerId: 1 });
    overlay.dispatch('pointermove', { target: path, clientX: clientXFor(0.15), clientY: 400, pointerId: 1 });
    const handle = overlay.querySelector('circle');
    const hx = Number(handle.getAttribute('cx'));
    const hy = Number(handle.getAttribute('cy'));
    const drawn = [...path.getAttribute('d').matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    const nearest = drawn.reduce((best, point) => {
      const distance = Math.hypot(point.x - hx, point.y - hy);
      return distance < best ? distance : best;
    }, Infinity);
    assert.ok(nearest <= 0.02, '控制点与曲线顶点距离 ' + nearest);
    assert.equal(harness.win.__breakglassAlignment.withinTolerance, true);
  } finally {
    harness.restore();
  }
});

test('拖动中途重置或窗口变化后，松手前的移动不能把参数拽回去', async () => {
  const harness = await readyHarness();
  try {
    const { elements, video } = harness;
    elements['wake-button'].dispatch('click');
    const overlay = harness.overlay();
    const path = overlay.querySelector('path');
    const move = (mathX) => overlay.dispatch('pointermove', {
      target: path, clientX: clientXFor(mathX), clientY: 400, pointerId: 1
    });
    overlay.dispatch('pointerdown', { target: path, clientX: clientXFor(0), clientY: 400, pointerId: 1 });
    move(1);
    assert.equal(elements['parameter-h-value'].textContent, '1.0');
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-h-value'].textContent, '0.0');
    move(2);
    assert.equal(elements['parameter-h-value'].textContent, '0.0', '重置后不应继续沿用按下时的位移');

    overlay.dispatch('pointerdown', { target: path, clientX: clientXFor(0), clientY: 400, pointerId: 2 });
    move(1);
    video.rect = { left: 0, top: 0, width: 640, height: 360 };
    harness.win.dispatch('resize');
    overlay.dispatch('pointermove', { target: path, clientX: clientXFor(1), clientY: 400, pointerId: 2 });
    assert.equal(elements['parameter-h-value'].textContent, '1.0', '缩放后旧的指针位移不能再改参数');
    overlay.dispatch('lostpointercapture', { pointerId: 2 });
    overlay.dispatch('pointermove', { target: path, clientX: clientXFor(2), clientY: 200, pointerId: 2 });
    assert.equal(elements['parameter-h-value'].textContent, '1.0');
  } finally {
    harness.restore();
  }
});

test('改目标时间或定位后，画面时间和曲线绑定保持一致', async () => {
  const harness = await readyHarness();
  try {
    const { elements, video } = harness;
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    elements['target-time'].value = '30';
    elements['target-time'].dispatch('input');
    assert.equal(harness.overlay(), null, '视频还停在 6 秒时，目标改成 30 应撤下曲线');
    assert.equal(elements['wake-button'].disabled, true);

    elements['target-time'].value = '6';
    elements['target-time'].dispatch('input');
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    elements['target-time'].value = '30';
    elements['jump-target'].dispatch('click');
    assert.equal(video.currentTime, 30);
    assert.equal(video.paused, true);
    elements['exit-button'].dispatch('click');
    assert.equal(elements['wake-button'].disabled, false, '定位到 30 秒后应能立刻再次破壁，不能还记着旧的 6 秒');
  } finally {
    harness.restore();
  }
});

test('目标时间空着或为负数时，定位不会把视频跳到 0 或抛错', async () => {
  const harness = await readyHarness();
  try {
    const { elements, video } = harness;
    elements['wake-button'].dispatch('click');
    elements['target-time'].value = '';
    elements['jump-target'].dispatch('click');
    assert.equal(video.currentTime, 6);
    assert.ok(harness.overlay(), '无效输入不应把已经对齐的曲线清掉');
    assert.match(elements['state-label'].textContent, /有效/);
    elements['target-time'].value = '-3';
    assert.doesNotThrow(() => elements['jump-target'].dispatch('click'));
    assert.equal(video.currentTime, 6);
  } finally {
    harness.restore();
  }
});

test('等待时改目标时间，超时后不能把旧帧的曲线画出来', async () => {
  const harness = await readyHarness({ externalAttempt: 'hang' });
  try {
    const { elements } = harness;
    elements['wake-button'].dispatch('click');
    assert.equal(elements['cancel-button'].hidden, false);
    elements['target-time'].value = '30';
    elements['target-time'].dispatch('input');
    assert.equal(elements['cancel-button'].hidden, true);
    harness.advance(2000);
    await flush();
    assert.equal(harness.overlay(), null);
    assert.equal(elements['source-label'].textContent, '等待素材');
  } finally {
    harness.restore();
  }
});

test('停在 6.2 秒仍可破壁，连续快捷键只留一层', async () => {
  const harness = await readyHarness();
  try {
    const { elements, video, stage } = harness;
    video.currentTime = 6.2;
    video.dispatch('pause');
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    harness.document.dispatch('keydown', { altKey: true, key: 'b' });
    harness.document.dispatch('keydown', { altKey: true, key: 'B' });
    assert.equal(stage.children.filter((child) => child.tagName === 'SVG').length, 1);
    video.currentTime = 6.21;
    video.dispatch('timeupdate');
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('常见分辨率都能破壁，退出后不留下上一帧的对齐结论', async () => {
  const harness = await readyHarness();
  try {
    const { elements, video } = harness;
    const sizes = [
      [1920, 1080], [1280, 720], [1366, 768], [2560, 1440],
      [2880, 1800], [1512, 982], [3024, 1898], [3840, 2160],
      [1080, 1920], [640, 480]
    ];
    for (const [width, height] of sizes) {
      elements['exit-button'].dispatch('click');
      video.videoWidth = width;
      video.videoHeight = height;
      video.currentTime = 6;
      video.paused = true;
      video.dispatch('pause');
      assert.equal(elements['wake-button'].disabled, false, width + '×' + height);
      elements['wake-button'].dispatch('click');
      assert.ok(harness.overlay(), width + '×' + height + ' 应出现曲线');
      assert.equal(elements['source-label'].textContent, '预先准备的示例');
      assert.equal(harness.win.__breakglassAlignment.withinTolerance, true, width + '×' + height);
    }
    elements['exit-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    assert.equal(harness.win.__breakglassAlignment, null);
  } finally {
    harness.restore();
  }
});

test('视频报错时卸下曲线并留下说明', async () => {
  const harness = await readyHarness();
  try {
    harness.elements['wake-button'].dispatch('click');
    harness.video.dispatch('error');
    assert.equal(harness.overlay(), null);
    assert.match(harness.elements['state-label'].textContent, /无法加载/);
    assert.equal(harness.elements['wake-button'].disabled, true);
  } finally {
    harness.restore();
  }
});
