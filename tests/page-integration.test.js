// 静态契约测试：故事 2 之后的扩展表面、配置与页面结构。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.join(__dirname, '..', 'extension');

function readText(rel) { return fs.readFileSync(path.join(extensionDir, rel), 'utf8'); }
function readJson(rel) { return JSON.parse(readText(rel)); }
function pageStyles(rel) {
  const links = [...readText(rel).matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /\brel\s*=\s*["']stylesheet["']/i.test(match[0]));
  const hrefs = links.map((match) => {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[0]);
    assert.ok(href, '样式链接缺少 href：' + rel);
    assert.doesNotMatch(href[1], /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, '样式必须来自扩展包：' + rel);
    return href[1];
  });
  const css = hrefs.map((href) => {
    const file = path.resolve(extensionDir, path.dirname(rel), href.split(/[?#]/)[0]);
    const relative = path.relative(extensionDir, file);
    assert.equal(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), false,
      '样式不能越出扩展包：' + href);
    assert.equal(fs.existsSync(file), true, '缺少页面实际加载的样式：' + href);
    return fs.readFileSync(file, 'utf8');
  }).join('\n');
  return { hrefs, css };
}
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
    '../src/geometry/figures.js',
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
    '../src/curve/current-frame.js',
    '../src/tutor/numbers.js',
    '../src/tutor/figures.js',
    '../src/tutor/parse.js',
    '../src/tutor/ask.js',
    '../src/page/main.js',
    '../src/page/mount-context.js',
    '../src/geometry-scene/validate.js', '../src/geometry-scene/solve.js', '../src/geometry-scene/actions.js',
    '../src/geometry-session/session.js', '../src/geometry-scene/frame.js', '../src/geometry-scene/request.js',
    '../src/geometry-scene/view.js', '../src/page/geometry.js',
    '../src/plugin/math-learning.js', '../src/plugin/contracts.js', '../src/plugin/frame-sampler.js',
    '../src/plugin/live-loop.js', '../src/plugin/overlay.js', '../src/plugin/particle-renderer.js',
    '../src/plugin/video-context.js', './workspace.js'
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

test('006仅新增显式activeTab和本机reader权限，不放宽旧页面脚本策略', () => {
  const manifest = readJson('manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:8787/*', 'http://127.0.0.1:4174/*']);
  assert.equal('content_scripts' in manifest, false);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
});

test('扩展不含远程地址或动态代码，005 仅保留本机 reader 文本示例', () => {
  const files = listFiles(path.join(extensionDir, 'src'), (file) => file.endsWith('.js'));
  assert.equal(files.length >= 9, true);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let withoutSvgNamespace = text.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    // 005 契约授权显式的本地 reader；仅排除这个文件的错误提示示例，实际 URL/网络代码仍被检查。
    const relative = path.relative(extensionDir, file).split(path.sep).join('/');
    if (relative === 'src/geometry-scene/request.js') {
      withoutSvgNamespace = withoutSvgNamespace.replaceAll('例如 http://127.0.0.1:8787。', '例如本机地址。');
    }
    if (relative === 'src/background/service-worker.js') {
      withoutSvgNamespace = withoutSvgNamespace.replaceAll('http://127.0.0.1:8787/learning/', 'LOCAL_READER/learning/');
    }
    if (relative === 'src/plugin/account-sync.js') withoutSvgNamespace = withoutSvgNamespace.replaceAll('http://127.0.0.1:4174/api/plugin', 'LOCAL_ACCOUNT/api/plugin');
    assert.doesNotMatch(withoutSvgNamespace, /https?:\/\//, '远程地址：' + file);
    assert.doesNotMatch(text, /\bXMLHttpRequest\b|WebSocket|EventSource|importScripts|\beval\s*\(|new\s+Function/, '动态或网络代码：' + file);
  }
  const attemptSource = readText('src/attempt/simulator.js');
  assert.doesNotMatch(attemptSource, /api[_-]?key|secret|token|authorization|model/i);
  const { buildUrl } = require('../extension/src/geometry-scene/request.js');
  assert.equal(buildUrl('http://127.0.0.1:8787', 'read'), 'http://127.0.0.1:8787/geometry/read');
  for (const url of ['https://example.com', 'http://user:secret@127.0.0.1:8787',
    'http://localhost.example.com:8787', 'http://127.0.0.1.example.com:8787']) {
    assert.throws(() => buildUrl(url, 'read'), '005 不得把远程或带凭据的地址当成本机：' + url);
  }
});

test('页面只调用 createWake，不维护第二套唤醒或替身', () => {
  const main = readText('src/page/main.js');
  const wake = readText('src/session/wake.js');
  assert.match(main, /wakeApi\.createWake\(/);
  assert.match(main, /onChange:/);
  assert.match(main, /canWake\(/);
  assert.match(main, /const decidedAt = localClock.now\(\)/);
  assert.match(main, /record\('fallback-dom-ready'/);
  assert.match(main, /record\('fallback-frame-ready'/);
  assert.match(main, /requestAnimationFrame/);
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
  assert.match(main, /listen\(document, 'fullscreenchange', drawCurve\)/);
  assert.match(main, /listen\(window, 'orientationchange', drawCurve\)/);
  assert.match(main, /ResizeObserver/);
  assert.match(main, /matchMedia/);
  assert.match(main, /alignment.mathPointToPage/);
});

test('入口不可用时不会注入未验证页面', () => {
  const manifest = readJson('manifest.json');
  assert.equal('content_scripts' in manifest, false);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:8787/*', 'http://127.0.0.1:4174/*']);
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
  for (const [page, own] of [['demo/index.html', './demo.css'], ['demo/geometry.html', './geometry.css']]) {
    const styles = pageStyles(page);
    const shared = styles.hrefs.indexOf('../src/ui/theme.css');
    assert.ok(shared >= 0 && shared < styles.hrefs.indexOf(own), '公共主题须在页面样式之前加载：' + page);
    assert.match(styles.css, /:focus-visible[^{]*\{[^}]*outline\s*:\s*2px\s+solid\s+var\(\s*--accent\s*\)/);
    assert.match(styles.css, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    assert.match(styles.css, /\[\s*hidden\s*\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/);
  }
  const { css } = pageStyles('demo/index.html');
  assert.match(css, /--glass-tint-top/);
  assert.match(css, /--motion-enter/);
  assert.match(css, /\.lg-dock\s*\{/);
  assert.match(css, /\.lg-item\s*\{/);
  assert.match(css, /\.waiting-bar__fill\s*\{/);
});

test('顶栏脚本在扩展包内且不引远程资源', () => {
  for (const rel of ['src/ui/magnify.js', 'src/ui/liquid-glass.js']) {
    assert.equal(fs.existsSync(path.join(extensionDir, rel)), true, '缺少 ' + rel);
    const source = readText(rel);
    assert.doesNotMatch(source, /https?:\/\//, rel + ' 不得引远程资源');
  }
});

test('提问区在控制栏里，有标签、记录区和默认禁用的送出', () => {
  const html = readText('demo/index.html');
  const panel = /<aside class="control-panel"[\s\S]*?<\/aside>/.exec(html);
  assert.ok(panel, '缺少控制栏');
  assert.match(panel[0], /<section class="tutor" aria-labelledby="tutor-title">/);
  assert.match(panel[0], /<label class="sr-only" for="tutor-input">[^<]+<\/label>/);
  assert.match(panel[0], /id="tutor-log"[^>]*role="log"[^>]*aria-live="polite"/);
  assert.match(panel[0], /<input id="tutor-input"[^>]*maxlength="120"[^>]*disabled/);
  assert.match(panel[0], /<button type="submit" id="tutor-send" disabled>/);
  for (const tag of panel[0].match(/<button type="button" data-tutor-example="[^"]+"[^>]*>/g) || []) {
    assert.match(tag, /disabled/, '示例按钮在破壁前不可用：' + tag);
  }
  assert.equal((panel[0].match(/data-tutor-example=/g) || []).length >= 2, true, '至少给出两个示例');
});

test('回答里的系数叫法与滑块标签逐字相同', () => {
  const html = readText('demo/index.html');
  const parabola = require('../extension/src/tutor/figures').get('parabola');
  for (const [name, label] of Object.entries(parabola.names)) {
    assert.match(html, new RegExp('<label for="parameter-' + name + '">' + label + '</label>'), name);
  }
});

test('提问模块不发请求，也不碰 DOM', () => {
  for (const rel of ['src/tutor/numbers.js', 'src/tutor/figures.js', 'src/tutor/parse.js', 'src/tutor/ask.js']) {
    const source = readText(rel);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\//, rel + ' 不得发请求');
    assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|innerHTML|localStorage|sessionStorage/, rel + ' 只做纯函数');
  }
});
