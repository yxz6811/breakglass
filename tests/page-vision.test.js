/**
 * T009：演示页来源文案的静态契约。实现见 extension/src/page/main.js 与 extension/demo/index.html（T011）。
 * 只检查页面侧能不能如实区分识别样例；合法性判定在结果规则侧。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.join(__dirname, '..', 'extension');
function readText(rel) { return fs.readFileSync(path.join(extensionDir, rel), 'utf8'); }

test('来源区存在，且页面按 evidence 区分识别样例', () => {
  const html = readText('demo/index.html');
  const main = readText('src/page/main.js');
  assert.match(html, /id="source-label"/);
  assert.match(html, /id="source-note"/);
  assert.match(main, /evidence === 'packaged-sample'/, '页面必须按 evidence 判断是否是打包样例');
  assert.match(main, /识别结果/, '识别样例的来源文案');
  assert.match(main, /随演示打包的识别样例，尚未接通外部识别。/, '识别样例的说明文案');
});

test('默认关闭时的预制与超时文案保持不变', () => {
  const main = readText('src/page/main.js');
  assert.match(main, /预先准备的示例 · 超时回退/);
  assert.match(main, /因等待超过 1\.5 秒，改用预先准备的示例。/);
  assert.match(main, /这是扩展包内预先准备的示例，不代表实时识别成功。/);
});

test('识别来源是合法来源，不得被当成警示态', () => {
  const main = readText('src/page/main.js');
  assert.equal(main.includes("source !== 'preset'"), false, '不得再用「非预制即警示」判断');
  assert.match(main, /is-warn/);
});

test('页面不显示置信度，也不出现已接通或准确率', () => {
  for (const rel of ['demo/index.html', 'src/page/main.js']) {
    const text = readText(rel);
    assert.doesNotMatch(text, /confidence/, rel + ' 不得读或显示 confidence');
    assert.doesNotMatch(text, /已接通|准确率|accuracy|percent/i, rel);
  }
});

test('页面脚本不新增远程地址、动态代码或密钥', () => {
  for (const rel of ['demo/index.html', 'src/page/main.js']) {
    const text = readText(rel).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.doesNotMatch(text, /https?:\/\//, rel + ' 不得出现远程地址');
    assert.doesNotMatch(text, /XMLHttpRequest|WebSocket|EventSource|\beval\s*\(|new\s+Function/, rel);
    assert.doesNotMatch(text, /api[_-]?key|secret|token|authorization|\bmodel\b/i, rel);
  }
});
