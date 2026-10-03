const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/fake-page.js');

test('DOM 准备和双 rAF 的绘制机会分开记，不能在挂载时报告首帧', async () => {
  const h = await createHarness();
  try {
    h.ready();
    h.elements['wake-button'].dispatch('click');
    const log = h.win.__breakglassLatency;
    assert.equal(log.summary()['preset-wake-dom-ready'].count, 1);
    assert.equal(log.summary()['preset-wake-frame-ready'], undefined);
    h.frame();
    assert.equal(log.summary()['preset-wake-frame-ready'], undefined);
    h.frame();
    assert.equal(log.summary()['preset-wake-frame-ready'].max, 32);
    assert.equal(log.measurement().pixelPresentationVerified, false);
  } finally { h.restore(); }
});

test('首帧前退出或隐藏页面不留下可见耗时样本', async () => {
  const h = await createHarness();
  try {
    h.ready();
    h.elements['wake-button'].dispatch('click');
    h.frame();
    h.document.dispatch('keydown', { key: 'Escape' });
    h.frame();
    assert.equal(h.win.__breakglassLatency.summary()['preset-wake-frame-ready'], undefined);
    h.document.visibilityState = 'hidden';
    h.elements['wake-button'].dispatch('click');
    h.frame();
    h.frame();
    assert.equal(h.win.__breakglassLatency.summary()['preset-wake-frame-ready'], undefined);
  } finally { h.restore(); }
});

test('两个帧回调之间隐藏再恢复，不把后台停留时间记作首帧', async () => {
  const h = await createHarness();
  try {
    h.ready();
    h.elements['wake-button'].dispatch('click');
    h.frame();
    h.document.visibilityState = 'hidden';
    h.document.dispatch('visibilitychange');
    h.advance(10000);
    h.document.visibilityState = 'visible';
    h.document.dispatch('visibilitychange');
    h.frame();
    assert.equal(h.win.__breakglassLatency.summary()['preset-wake-frame-ready'], undefined);
  } finally { h.restore(); }
});

test('零视频显示区域不会留下空 SVG 或禁用退出入口', async () => {
  const h = await createHarness();
  try {
    h.ready();
    h.video.rect.width = 0;
    h.elements['wake-button'].dispatch('click');
    assert.equal(h.overlay(), null);
    assert.match(h.elements['state-label'].textContent, /曲线无法绘制/);
    assert.equal(h.elements['exit-button'].disabled, false);
  } finally { h.restore(); }
});

test('绘图意外失败时清理 SVG，提供重试和退出，恢复后可再次破壁', async () => {
  const h = await createHarness();
  const alignment = h.win.BreakGlass.alignment;
  const original = alignment.mathPointToPage;
  try {
    h.ready();
    alignment.mathPointToPage = () => { throw new TypeError('test rendering failure'); };
    h.elements['wake-button'].dispatch('click');
    assert.equal(h.overlay(), null);
    assert.equal(h.elements['retry-button'].hidden, false);
    assert.equal(h.elements['retry-button'].disabled, false);
    assert.equal(h.elements['exit-button'].disabled, false);
    assert.match(h.elements['state-label'].textContent, /曲线无法绘制/);
    alignment.mathPointToPage = original;
    h.elements['retry-button'].dispatch('click');
    assert.ok(h.overlay());
    alignment.mathPointToPage = () => { throw new TypeError('test reset rendering failure'); };
    h.elements['reset-button'].dispatch('click');
    assert.equal(h.overlay(), null);
    assert.match(h.elements['state-label'].textContent, /曲线无法绘制/);
  } finally { alignment.mathPointToPage = original; h.restore(); }
});
