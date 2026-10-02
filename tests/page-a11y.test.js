/**
 * 可访问性细节：错误播报、禁用原因、滑块读屏文本、控制点热区。
 * 行为用假 DOM 驱动真实 main.js；结构用静态断言。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, flush } = require('./helpers/fake-page.js');

const extensionDir = path.join(__dirname, '..', 'extension');
function readText(rel) { return fs.readFileSync(path.join(extensionDir, rel), 'utf8'); }

async function interactive(config) {
  const harness = await createHarness(config ? { config } : undefined);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

test('禁用原因节点已接线，并有 sr-only 样式', () => {
  const html = readText('demo/index.html');
  assert.match(html, /id="wake-button"[^>]*aria-describedby="wake-reason"/);
  assert.match(html, /id="reset-button"[^>]*aria-describedby="reset-reason"/);
  assert.match(html, /class="sr-only" id="wake-reason"/);
  assert.match(html, /class="sr-only" id="reset-reason"/);
  assert.match(readText('demo/demo.css'), /\.sr-only\s*\{/);
});

test('错误态切到 assertive，等待与交互态保持 polite', async () => {
  const failing = await createHarness({ config: { externalAttempt: 'invalid' } });
  try {
    failing.ready();
    failing.elements['wake-button'].dispatch('click');
    failing.advance(0);
    await flush();
    assert.equal(failing.elements['state-label'].getAttribute('aria-live'), 'assertive', '失败要立刻播报');
  } finally {
    failing.restore();
  }

  const waiting = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    waiting.ready();
    waiting.elements['wake-button'].dispatch('click');
    assert.equal(waiting.elements['state-label'].getAttribute('aria-live'), 'polite');
    waiting.advance(1500);
    await flush();
    assert.equal(waiting.elements['state-label'].getAttribute('aria-live'), 'polite', '回退成功后回到礼貌播报');
  } finally {
    waiting.restore();
  }
});

test('破壁不可用时给出原因，出现交互层后说明为什么不能再点', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.equal(elements['wake-button'].disabled, true);
    assert.match(elements['wake-reason'].textContent, /交互层已经出现/);
    assert.equal(elements['reset-button'].disabled, false);
    assert.equal(elements['reset-reason'].textContent, '', '可用时不写原因');
  } finally {
    harness.restore();
  }
});

test('暂停在目标时间时破壁可用且不写原因', async () => {
  const harness = await createHarness();
  try {
    harness.ready();
    assert.equal(harness.elements['wake-button'].disabled, false);
    assert.equal(harness.elements['wake-reason'].textContent, '');
    assert.equal(harness.elements['reset-reason'].textContent, '需要先出现可交互的曲线再重置。');
  } finally {
    harness.restore();
  }
});

test('播放中破壁给出暂停原因', async () => {
  const harness = await createHarness();
  try {
    harness.ready();
    harness.video.paused = false;
    harness.video.dispatch('play');
    assert.equal(harness.elements['wake-button'].disabled, true);
    assert.match(harness.elements['wake-reason'].textContent, /请先暂停视频/);
  } finally {
    harness.restore();
  }
});

test('滑块带读屏用的取值与范围说明', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.equal(elements['parameter-a'].getAttribute('aria-valuetext'), '0.8（范围 0.4 到 1.2）');
    assert.equal(elements['parameter-h'].getAttribute('aria-valuetext'), '0.0（范围 -2 到 2）');
    elements['parameter-k'].value = '-1.5';
    elements['parameter-k'].dispatch('input');
    assert.equal(elements['parameter-k'].getAttribute('aria-valuetext'), '-1.5（范围 -2 到 2）');
  } finally {
    harness.restore();
  }
});

test('控制点有更大的透明热区，且第一个圆仍是可见控制点', async () => {
  const main = readText('src/page/main.js');
  assert.match(main, /r="18"[^>]*aria-hidden="true"/, '热区圆必须存在且对读屏隐藏');
  assert.match(main, /r="10"[^>]*tabindex="0"/, '可见控制点仍可聚焦');
  const harness = await interactive();
  try {
    const overlay = harness.overlay();
    const circles = overlay.children.filter((child) => child.tagName === 'CIRCLE');
    assert.equal(circles.length, 2, '一个可见控制点 + 一个热区');
    assert.equal(overlay.querySelector('circle'), circles[0], '拖动逻辑依赖第一个圆是可见控制点');
    assert.equal(Number(circles[0].getAttribute('cx')) > 0, true, '拖动仍然写入可见控制点');
  } finally {
    harness.restore();
  }
});
