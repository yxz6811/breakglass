// 引导文案必须和定位按钮的实际跳转一致，避免用户按提示却到不了能破壁的那一秒。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/fake-page.js');

test('还没有画面时，Alt+B 提示先选择视频', async () => {
  const harness = await createHarness();
  try {
    harness.document.dispatch('keydown', { altKey: true, key: 'b' });
    assert.equal(harness.elements['state-label'].textContent, '先选择一个视频。文件留在这台浏览器里。');
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('目标时间改离准备结果后，定位文案和跳转是同一个秒数', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    elements['exit-button'].dispatch('click');
    elements['target-time'].value = '30';
    elements['target-time'].dispatch('input');
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['jump-target'].getAttribute('aria-label'), '定位到第 30 秒');
    assert.match(elements['state-label'].textContent, /30/);
    assert.match(elements['state-label'].textContent, /6/);
    assert.equal(elements['state-label'].textContent.includes('点定位，停在第 6 秒'), false);
    elements['jump-target'].dispatch('click');
    assert.equal(video.currentTime, 30);
    assert.equal(harness.overlay(), null);
    assert.equal(elements['wake-button'].disabled, true);
  } finally {
    harness.restore();
  }
});

test('停在画面外时，点定位会落到按钮宣布的那一秒', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    harness.ready();
    video.currentTime = 0;
    video.dispatch('timeupdate');
    assert.equal(elements['jump-target'].getAttribute('aria-label'), '定位到第 6 秒');
    assert.match(elements['state-label'].textContent, /点定位，停在第 6 秒/);
    elements['jump-target'].dispatch('click');
    assert.equal(video.currentTime, 6);
    assert.equal(video.paused, true);
    assert.equal(elements['wake-button'].disabled, false);
  } finally {
    harness.restore();
  }
});
