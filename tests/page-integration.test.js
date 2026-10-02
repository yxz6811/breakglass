// 静态契约测试：故事 2 之后的扩展表面、配置与页面结构。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.join(__dirname, '..', 'extension');

function readText(rel) { return fs.readFileSync(path.join(extensionDir, rel), 'utf8'); }
function readJson(rel) { return JSON.parse(readText(rel)); }
function listFiles(dir, filter) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full, filter));
    else if (filter(full)) found.push(full);
  }
  return found;
}

test('演示页按依赖顺序加载本地脚本', () => {
  const html = readText('demo/index.html');
  const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  const sources = [];
  for (const tag of tags) {
    const match = /\bsrc="([^"]+)"/.exec(tag);
    assert.ok(match, '不允许内联 script：' + tag);
    sources.push(match[1]);
  }
  assert.deepEqual(sources, [
    '../src/curve/validate.js',
    '../src/curve/evaluate.js',
    '../src/geometry/content-rect.js',
    '../src/geometry/alignment.js',
    '../src/session/session.js',
    '../src/attempt/simulator.js',
    '../src/session/wake.js',
    '../src/telemetry/latency.js',
    '../src/ui/magnify.js',
    '../src/ui/liquid-glass.js',
    '../src/preset/load.js',
    '../src/preset/place-in-frame.js',
    '../src/lesson/reading.js',
    '../src/lesson/ask.js',
    '../src/page/main.js'
  ]);
  for (const src of sources) {
    assert.doesNotMatch(src, /^(https?:)?\/\//);
    assert.equal(fs.existsSync(path.join(extensionDir, 'demo', src)), true, '缺少脚本：' + src);
  }
});

test('等待与失败控件存在且默认不可用', () => {
  const html = readText('demo/index.html');
  const cancel = /<button[^>]*id="cancel-button"[^>]*>/.exec(html);
  const retry = /<button[^>]*id="retry-button"[^>]*>/.exec(html);
  assert.ok(cancel, '缺少取消等待按钮');
  assert.ok(retry, '缺少重试按钮');
  assert.match(cancel[0], /type="button"/);
  assert.match(cancel[0], /hidden/);
  assert.match(cancel[0], /disabled/);
  assert.match(retry[0], /hidden/);
  assert.match(retry[0], /disabled/);
  assert.match(html, /id="state-label"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /Alt\+B/);
  assert.match(html, /Esc/);
});

test('RuntimeConfig 保持离线主路径并保留 1.5 秒回退', () => {
  const config = readJson('assets/config.json');
  assert.equal(config.enableLocalMock, true);
  assert.equal(config.fallbackAfterMs, 1500);
  assert.equal(config.prewarmed, true);
  assert.equal(config.externalAttempt, 'off', '默认演示配置必须保持 off');
  assert.equal(/secret|api[_-]?key|token|authorization|https?:|upload|model/i.test(JSON.stringify(config)), false);
});

test('manifest 仍然没有主机权限、内容脚本与远程脚本', () => {
  const manifest = readJson('manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.host_permissions, []);
  assert.equal('content_scripts' in manifest, false);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
});

test('扩展源码不发请求、不含密钥或远程地址', () => {
  const files = listFiles(path.join(extensionDir, 'src'), (file) => file.endsWith('.js'));
  assert.equal(files.length >= 9, true);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const withoutSvgNamespace = text.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.doesNotMatch(withoutSvgNamespace, /https?:\/\//, '远程地址：' + file);
    assert.doesNotMatch(text, /\bXMLHttpRequest\b|WebSocket|EventSource|importScripts|\beval\s*\(|new\s+Function/, '动态或网络代码：' + file);
  }
  const attemptSource = readText('src/attempt/simulator.js');
  assert.doesNotMatch(attemptSource, /api[_-]?key|secret|token|authorization|model/i);
});

test('页面只调用 createWake，不维护第二套唤醒或替身', () => {
  const main = readText('src/page/main.js');
  const wake = readText('src/session/wake.js');
  assert.match(main, /wakeApi\.createWake\(/);
  assert.match(main, /onChange:/);
  assert.match(main, /canWake\(/);
  assert.match(main, /mark\('timeout-decided'\)/);
  assert.match(main, /mark\('svg-visible'\)/);
  assert.match(main, /fallback === 'timeout'/);
  assert.match(main, /不代表实时识别成功/);
  assert.doesNotMatch(main, /createWakeController|onOutcome|resolvePreset|isWaiting|decisionAt|attemptApi|beginWait|session\.fail|\.current\b/);
  assert.doesNotMatch(wake, /createWakeController|onOutcome|function begin\(/);
  assert.match(wake, /schedule\(delayMs, handler\)|time\.schedule\(/);
});
test('覆盖层绝对定位并接入多画幅重算与测量', () => {
  const main = readText('src/page/main.js');
  assert.equal(main.includes("overlay.style.position = 'absolute'"), true);
  assert.match(main, /viewBox/);
  assert.match(main, /contentRect.left - stageRect.left/);
  assert.match(main, /__breakglassAlignment/);
  assert.equal(main.includes("addEventListener('fullscreenchange'"), true);
  assert.equal(main.includes("addEventListener('orientationchange'"), true);
  assert.match(main, /ResizeObserver/);
  assert.match(main, /matchMedia/);
  assert.match(main, /alignment.mathPointToPage/);
});

test('入口不可用时不会注入未验证页面', () => {
  const manifest = readJson('manifest.json');
  assert.equal('content_scripts' in manifest, false);
  assert.deepEqual(manifest.host_permissions, []);
  assert.equal('web_accessible_resources' in manifest, false);
});

test('液态玻璃顶栏承载既有控件，且都带无障碍名称', () => {
  const html = readText('demo/index.html');
  assert.match(html, /class="lg-dock"[^>]*data-liquid-glass/);
  assert.match(html, /class="lg-glass" aria-hidden="true"/);
  for (const id of ['play-toggle', 'jump-target', 'wake-button', 'cancel-button', 'retry-button', 'reset-button', 'fullscreen-button', 'exit-button']) {
    const tag = new RegExp('<button[^>]*id="' + id + '"[^>]*>').exec(html);
    assert.ok(tag, '缺少顶栏按钮 ' + id);
    assert.match(tag[0], /class="lg-item"/, id + ' 应在液态玻璃顶栏内');
    assert.match(tag[0], /aria-label="[^"]+"/, id + ' 需要无障碍名称');
  }
  assert.match(html, /id="source-label"/);
  assert.match(html, /id="waiting-bar"[^>]*aria-busy="true"/);
  assert.match(html, /id="waiting-progress"/);
});

test('三个参数滑块的范围与预制一致', () => {
  const html = readText('demo/index.html');
  const preset = readJson('assets/presets/demo-parabola.json');
  for (const name of ['a', 'h', 'k']) {
    const tag = new RegExp('<input[^>]*id="parameter-' + name + '"[^>]*>').exec(html);
    assert.ok(tag, '缺少滑块 parameter-' + name);
    const item = preset.definition.parameters[name];
    assert.match(tag[0], new RegExp('min="' + item.min + '"'));
    assert.match(tag[0], new RegExp('max="' + item.max + '"'));
    assert.match(tag[0], new RegExp('step="' + item.step + '"'));
  }
});

test('样式表包含玻璃令牌、焦点可见与降级规则', () => {
  const css = readText('demo/demo.css');
  assert.match(css, /--glass-tint-top/);
  assert.match(css, /--motion-enter/);
  assert.match(css, /:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.match(css, /\.lg-dock\s*\{/);
  assert.match(css, /\.lg-item\s*\{/);
  assert.match(css, /\.waiting-bar__fill\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});

test('顶栏脚本在扩展包内且不引远程资源', () => {
  for (const rel of ['src/ui/magnify.js', 'src/ui/liquid-glass.js']) {
    assert.equal(fs.existsSync(path.join(extensionDir, rel)), true, '缺少 ' + rel);
    const source = readText(rel);
    assert.doesNotMatch(source, /https?:\/\//, rel + ' 不得引远程资源');
  }
});
