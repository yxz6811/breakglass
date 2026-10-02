// 故事 3 页面行为：窗口 / 全屏 / 方向 / DPR / 元素尺寸变化后的重算与 2% 测量输出。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/fake-page.js');

async function interactiveHarness() {
  const harness = await createHarness();
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  return harness;
}

test('交互出现后暴露布局读数，但不把自画路径当成 2% 实测', async () => {
  const harness = await interactiveHarness();
  try {
    const report = harness.win.__breakglassAlignment;
    assert.ok(report, '交互出现后应可读取对齐测量');
    assert.equal(report.samples, 9);
    assert.equal(report.tolerance, 0.02);
    assert.equal(report.measured, false);
    assert.equal(report.withinTolerance, null);
    assert.equal(report.maxRatio, null);
    assert.equal(report.contentRect.width, 1280);
    assert.equal(report.contentRect.height, 720);
    assert.equal(report.contentRect.left, 100);
    assert.equal(report.contentRect.top, 90);
    assert.equal(report.scale, 1280 / 1920);
  } finally {
    harness.restore();
  }
});

test('窗口大小变化后重算内容矩形与覆盖层位置', async () => {
  const harness = await interactiveHarness();
  try {
    const overlay = harness.overlay();
    harness.video.rect = { left: 60, top: 20, width: 960, height: 540 };
    harness.win.dispatch('resize');
    const report = harness.win.__breakglassAlignment;
    assert.equal(report.contentRect.left, 60);
    assert.equal(report.contentRect.top, 20);
    assert.equal(report.contentRect.width, 960);
    assert.equal(report.scale, 0.5);
    assert.equal(overlay.style.left, '10px');
    assert.equal(overlay.style.top, '20px');
    assert.equal(overlay.style.width, '960px');
    assert.equal(overlay.getAttribute('viewBox'), '0 0 960 540');
  } finally {
    harness.restore();
  }
});

test('全屏、方向变化与视频元素尺寸变化都会重算', async () => {
  const harness = await interactiveHarness();
  try {
    harness.video.rect = { left: 0, top: 0, width: 640, height: 480 };
    harness.document.dispatch('fullscreenchange');
    assert.equal(harness.win.__breakglassAlignment.contentRect.width, 640);
    assert.equal(harness.win.__breakglassAlignment.contentRect.height, 360);

    harness.video.rect = { left: 0, top: 0, width: 400, height: 700 };
    harness.win.dispatch('orientationchange');
    assert.equal(harness.win.__breakglassAlignment.contentRect.width, 400);
    assert.equal(harness.win.__breakglassAlignment.contentRect.height, 225);

    harness.video.rect = { left: 0, top: 0, width: 800, height: 450 };
    assert.equal(harness.observers.length >= 1, true, '应挂上 ResizeObserver');
    for (const observer of harness.observers) observer.callback();
    assert.equal(harness.win.__breakglassAlignment.contentRect.width, 800);
  } finally {
    harness.restore();
  }
});

test('设备像素比变化后重新挂载监听并重算', async () => {
  const harness = await interactiveHarness();
  try {
    const before = harness.mediaQueries.length;
    assert.equal(before, 1);
    harness.video.rect = { left: 0, top: 0, width: 1280, height: 720 };
    harness.win.devicePixelRatio = 2;
    for (const media of harness.mediaQueries.slice()) {
      for (const handler of media.handlers.slice()) handler({ matches: true });
    }
    assert.equal(harness.mediaQueries.length, before + 1, '应按新的 DPR 重新挂载监听');
    assert.equal(harness.mediaQueries[harness.mediaQueries.length - 1].media.includes('2dppx'), true);
    assert.equal(harness.win.__breakglassAlignment.contentRect.width, 1280);
    assert.equal(harness.win.__breakglassAlignment.contentRect.top, 0);
  } finally {
    harness.restore();
  }
});

test('pagehide 释放监听并清空测量输出', async () => {
  const harness = await interactiveHarness();
  try {
    assert.ok(harness.win.__breakglassAlignment);
    harness.win.dispatch('pagehide');
    assert.equal(harness.win.__breakglassAlignment, null);
    assert.equal(harness.elements['reset-button'].disabled, true);
    assert.equal(harness.elements['parameter-a'].disabled, true);
    for (const observer of harness.observers) assert.equal(observer.disconnected, true);
  } finally {
    harness.restore();
  }
});
