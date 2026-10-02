// 视觉规范落地后的页面行为：顶栏按钮、三个参数滑块、等待条、状态样式。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

async function interactiveHarness(config) {
  const harness = await createHarness(config ? { config } : undefined);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  return harness;
}

test('三个参数滑块随会话出现，并可以逐个调节', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    assert.equal(elements['parameter-a'].disabled, false);
    assert.equal(elements['parameter-h'].disabled, false);
    assert.equal(elements['parameter-k'].disabled, false);
    assert.equal(elements['parameter-a-value'].textContent, '0.8');
    assert.equal(elements['parameter-h-value'].textContent, '0.0');
    elements['parameter-a'].value = '1.2';
    elements['parameter-a'].dispatch('input');
    assert.equal(elements['parameter-a-value'].textContent, '1.2');
    elements['parameter-k'].value = '9';
    elements['parameter-k'].dispatch('input');
    assert.equal(elements['parameter-k-value'].textContent, '2.0', '超出范围应被钳制');
    elements['parameter-h'].value = '-1';
    elements['parameter-h'].dispatch('input');
    assert.equal(elements['parameter-h-value'].textContent, '-1.0');
    const path = harness.overlay().querySelector('path').getAttribute('d');
    assert.equal(path.split('M').length - 1, 1);
  } finally {
    harness.restore();
  }
});

test('等待态显示等待条与进度时长，回退后收起并标记来源', async () => {
  const harness = await interactiveHarness({ externalAttempt: 'hang' });
  try {
    const { elements } = harness;
    assert.equal(elements['waiting-bar'].hidden, false);
    assert.equal(elements['waiting-bar'].style.getPropertyValue('--wait-ms'), '1500ms');
    assert.equal(elements['state-label'].classList.contains('is-error'), false);
    harness.advance(1500);
    assert.equal(elements['waiting-bar'].hidden, true);
    assert.equal(elements['source-label'].textContent, '预先准备的示例 · 超时回退');
    assert.equal(elements['source-label'].classList.contains('is-fallback'), true);
    assert.equal(harness.overlay() !== null, true);
  } finally {
    harness.restore();
  }
});

test('可恢复错误把重试升为主操作并标出错误样式', async () => {
  const harness = await interactiveHarness({ externalAttempt: 'invalid' });
  try {
    const { elements } = harness;
    harness.advance(0);
    await flush();
    assert.equal(elements['retry-button'].hidden, false);
    assert.equal(elements['retry-button'].dataset.variant, 'primary');
    assert.equal(elements['wake-button'].dataset.variant, 'ghost');
    assert.equal(elements['state-label'].classList.contains('is-error'), true);
    assert.equal(elements['waiting-bar'].hidden, true);
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('退出后顶栏复位：主操作回到破壁，滑块与等待条收起', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    elements['exit-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    assert.equal(elements['wake-button'].dataset.variant, 'primary');
    assert.equal(elements['reset-button'].disabled, true);
    assert.equal(elements['parameter-a'].disabled, true);
    assert.equal(elements['waiting-bar'].hidden, true);
  } finally {
    harness.restore();
  }
});
