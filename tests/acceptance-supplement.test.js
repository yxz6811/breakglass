/**
 * 《BreakGlass｜验收补充项（2026-10-02）》编号 11–20 的自动化执行。
 * 用假 DOM 驱动真实 main.js，配合静态断言；逐条对应文档里的「操作步骤」。
 * 需要真实浏览器或改配置重启扩展的步骤在测试名里注明范围。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, flush } = require('./helpers/fake-page.js');

const extensionDir = path.join(__dirname, '..', 'extension');
const readText = (rel) => fs.readFileSync(path.join(extensionDir, rel), 'utf8');
const preset = require('../extension/assets/presets/demo-parabola.json');
const config = require('../extension/assets/config.json');

async function interactive(configOverrides) {
  const harness = await createHarness(configOverrides ? { config: configOverrides } : undefined);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

test('11 目标时间默认 6 秒，破壁后来源为「预先准备的示例」', async () => {
  assert.equal(preset.time, 6, '预制时间应为 6 秒');
  assert.match(readText('demo/index.html'), /id="target-time"[^>]*value="6"/);
  const harness = await interactive();
  try {
    const { elements } = harness;
    assert.equal(elements['target-time'].value, '6');
    assert.notEqual(harness.overlay(), null, '应出现覆盖层');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    assert.match(elements['source-note'].textContent, /预先准备/);
  } finally {
    harness.restore();
  }
});

test('12 三个滑块 a/h/k 都能联动曲线', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    const ranges = { a: ['0.4', '1.2'], h: ['-2', '2'], k: ['-2', '2'] };
    const path = () => harness.overlay().querySelector('path').getAttribute('d');
    for (const name of ['a', 'h', 'k']) {
      const slider = elements['parameter-' + name];
      const output = elements['parameter-' + name + '-value'];
      assert.equal(slider.disabled, false, name + ' 应可用');
      assert.match(readText('demo/index.html'), new RegExp('id="parameter-' + name + '"[^>]*min="' + ranges[name][0] + '"'));
      assert.match(readText('demo/index.html'), new RegExp('id="parameter-' + name + '"[^>]*max="' + ranges[name][1] + '"'));
      const before = path();
      slider.value = name === 'a' ? '1.2' : '1.5';
      slider.dispatch('input');
      assert.notEqual(path(), before, name + ' 变化后曲线应重绘');
      assert.equal(output.textContent, Number(slider.value).toFixed(1));
      assert.match(slider.getAttribute('aria-valuetext'), /范围/);
    }
  } finally {
    harness.restore();
  }
});

test('13 参数越界被钳制在范围内', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    elements['parameter-a'].value = '9';
    elements['parameter-a'].dispatch('input');
    assert.equal(elements['parameter-a-value'].textContent, '1.2', 'a 超过上限应钳制到 1.2');
    elements['parameter-k'].value = '-99';
    elements['parameter-k'].dispatch('input');
    assert.equal(elements['parameter-k-value'].textContent, '-2.0', 'k 低于下限应钳制到 -2');
    assert.match(elements['parameter-a'].getAttribute('aria-valuetext'), /^1\.2/);
  } finally {
    harness.restore();
  }
});

test('14 重置回到初值且交互层保留', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    elements['parameter-a'].value = '1.2';
    elements['parameter-a'].dispatch('input');
    elements['parameter-h'].value = '1.5';
    elements['parameter-h'].dispatch('input');
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-a-value'].textContent, '0.8');
    assert.equal(elements['parameter-h-value'].textContent, '0.0');
    assert.equal(elements['parameter-k-value'].textContent, '0.0');
    assert.notEqual(harness.overlay(), null, '交互层必须保留');
    assert.equal(elements['reset-reason'].textContent, '');
  } finally {
    harness.restore();
  }
});

test('15 退出移除交互层，随后播放不会自行恢复', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    elements['exit-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    assert.equal(harness.video.paused, true, '退出后视频保持暂停');
    harness.video.paused = false;
    harness.video.dispatch('play');
    assert.equal(harness.overlay(), null, '播放不会重新挂上覆盖层');
    assert.equal(elements['reset-button'].disabled, true);
    assert.equal(elements['exit-button'].disabled, true);
  } finally {
    harness.restore();
  }
});

test('16 等待态：进度条、取消、退出可用，1.5 秒后回退并说明原因', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    assert.equal(elements['waiting-bar'].hidden, false, '应出现等待条');
    assert.equal(elements['waiting-bar'].style.getPropertyValue('--wait-ms'), '1500ms');
    assert.equal(elements['cancel-button'].hidden, false, '可取消');
    assert.equal(elements['exit-button'].disabled, false, '等待中可退出');
    harness.advance(1499);
    assert.equal(elements['source-label'].textContent, '等待素材');
    harness.advance(1);
    assert.equal(elements['waiting-bar'].hidden, true);
    assert.equal(elements['source-label'].textContent, '预先准备的示例 · 超时回退');
    assert.match(elements['source-note'].textContent, /1\.5 秒/);
    assert.notEqual(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('17 识别适配（需先改 config）来源为「识别结果」且不显示百分比', async () => {
  assert.equal(config.visionAdapter, 'off', '提交配置必须是 off');
  const harness = await interactive({ visionAdapter: 'fixture', externalAttempt: 'off' });
  try {
    const { elements } = harness;
    assert.equal(elements['source-label'].textContent, '识别结果');
    assert.equal(elements['source-note'].textContent, '随演示打包的识别样例，尚未接通外部识别。');
    assert.doesNotMatch(elements['source-note'].textContent, /%/);
    assert.doesNotMatch(elements['source-label'].textContent, /已接通/);
    assert.notEqual(harness.overlay(), null);
    assert.equal(elements['parameter-a'].disabled, false, '识别结果同样可调节');
  } finally {
    harness.restore();
  }
});

test('18 全程无远程请求，扩展权限仍为空', async () => {
  const manifest = require('../extension/manifest.json');
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.host_permissions, []);
  const seen = [];
  const original = global.fetch;
  // 用会读取包内样例的识别路径来抓真实调用；off 主路径不读文件，抓不到。
  const harness = await createHarness({ config: { visionAdapter: 'fixture', externalAttempt: 'off' } });
  try {
    const inner = global.fetch;
    global.fetch = (url, options) => { seen.push(String(url)); return inner(url, options); };
    harness.ready();
    harness.elements['wake-button'].dispatch('click');
    await flush();
    harness.elements['parameter-h'].dispatch('input');
    harness.elements['reset-button'].dispatch('click');
    assert.equal(seen.length > 0, true, '应只读取扩展包内文件：' + JSON.stringify(seen));
    for (const url of seen) {
      assert.match(url, /^\.\.\/assets\//, '读取路径必须是扩展包内相对路径：' + url);
    }
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|html|css|json)$/.test(entry.name)) files.push(full);
      }
    };
    walk(extensionDir);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
      assert.doesNotMatch(text, /https?:\/\//, '不得出现远程地址：' + file);
    }
  } finally {
    global.fetch = original;
    harness.restore();
  }
});

test('19 键盘焦点可见，禁用按钮说明原因', async () => {
  const css = readText('demo/demo.css');
  const html = readText('demo/index.html');
  assert.match(css, /:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.match(html, /id="wake-button"[^>]*aria-describedby="wake-reason"/);
  assert.match(html, /class="sr-only" id="wake-reason"/);
  const harness = await createHarness();
  try {
    const { elements } = harness;
    harness.ready();
    assert.equal(elements['wake-button'].disabled, false);
    assert.equal(elements['wake-reason'].textContent, '');
    harness.video.paused = false;
    harness.video.dispatch('play');
    assert.equal(elements['wake-button'].disabled, true);
    assert.match(elements['wake-reason'].textContent, /请先暂停视频/);
  } finally {
    harness.restore();
  }
});

test('20 可恢复错误：立刻播报、重试为主操作、退出可用', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'invalid' } });
  try {
    const { elements } = harness;
    harness.ready();
    elements['wake-button'].dispatch('click');
    harness.advance(0);
    await flush();
    assert.equal(elements['state-label'].getAttribute('aria-live'), 'assertive');
    assert.match(elements['state-label'].textContent, /外部结果不可用/);
    assert.equal(elements['retry-button'].dataset.variant, 'primary');
    assert.equal(elements['wake-button'].dataset.variant, 'ghost');
    assert.equal(elements['retry-button'].hidden, false);
    assert.equal(elements['exit-button'].disabled, false);
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});
