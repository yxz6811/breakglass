// Spec 004 故事 1：本地图形与页面真实状态，不扩大 Constitution 的识别白名单或 P0。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, flush } = require('./helpers/fake-page.js');

const extensionDir = path.join(__dirname, '..', 'extension');

async function interactive(options) {
  const harness = await createHarness(options);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

function session(harness) { return harness.win.BreakGlass.figureSession; }
function curvePath(harness) { return harness.overlay().querySelector('path').getAttribute('d'); }
function select(harness, kind) {
  harness.elements['figure-kind'].value = kind;
  harness.elements['figure-kind'].dispatch('change');
  assert.equal(session(harness).getState().kind, kind);
}
function closeTo(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 应接近 ${expected}`);
}
function changedValue(item) {
  return item.initial + 2 * item.step <= item.max
    ? item.initial + 2 * item.step : item.initial - 2 * item.step;
}

test('particle adapter preserves signed sine phase and represents zero amplitude as a constant line', async () => {
  const harness = await createHarness();
  const math = require('../learning-site/math-learning');
  try {
    const adapt = harness.win.BreakGlass.curvePage.toLearningScene;
    for (const a of [-2, 0, 2]) for (const h of [-2, 0, 2]) {
      const k = 1; const mapped = adapt({ kind: 'sine', parameters: { a, h, k } });
      assert.equal(math.validateSnapshot(mapped.template, mapped.snapshot).ok, true);
      assert.equal(mapped.template, a === 0 ? 'line' : 'sine');
      if (a === 0) { assert.equal(mapped.degeneracy, 'zero-amplitude-sine'); assert.deepEqual(mapped.snapshot, { m: 0, b: k }); }
      for (const x of [-10, -Math.PI, -0.5, 0, 0.75, Math.PI, 10]) {
        const p = mapped.snapshot;
        const actual = mapped.template === 'line' ? p.m * x + p.b : p.A * Math.sin(p.omega * x + p.phi) + p.k;
        closeTo(actual, a * Math.sin(x - h) + k);
      }
    }
    assert.equal(math.validateSnapshot('sine', { A: 0, omega: 1, phi: 0, k: 1 }).ok, false,
      'the new positive-amplitude sine contract remains unchanged');
  } finally { harness.restore(); }
});

// 直接把真实 SVG 的路径像素还原为数学坐标，用独立算式核对绘制结果。
function renderedPoints(harness, figure) {
  const scale = Math.min(harness.video.rect.width / harness.video.videoWidth,
    harness.video.rect.height / harness.video.videoHeight);
  const { domain, range, region, yAxis } = figure.definition;
  return [...curvePath(harness).matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => {
    const xRatio = (Number(match[1]) / scale - region.x) / region.width;
    const yRatio = (Number(match[2]) / scale - region.y) / region.height;
    return {
      x: domain.min + xRatio * (domain.max - domain.min),
      y: yAxis === 'up' ? range.max - yRatio * (range.max - range.min)
        : range.min + yRatio * (range.max - range.min)
    };
  });
}

function figureUi(harness) {
  const { elements } = harness;
  const ids = ['figure-kind', 'figure-title', 'figure-formula', 'figure-note',
    'source-label', 'source-note', 'parabola-parameters', 'local-parameters',
    'parameter-a', 'parameter-h', 'parameter-k', 'parameter-a-value', 'parameter-h-value', 'parameter-k-value',
    'parameter-figure-1', 'parameter-figure-2', 'parameter-figure-3',
    'parameter-figure-1-value', 'parameter-figure-2-value', 'parameter-figure-3-value'];
  return Object.fromEntries(ids.map((id) => [id, {
    value: elements[id].value, text: elements[id].textContent,
    hidden: elements[id].hidden, disabled: elements[id].disabled
  }]));
}

test('图形选择器和本地滑块有标签，脚本从扩展包加载', () => {
  const html = fs.readFileSync(path.join(extensionDir, 'demo/index.html'), 'utf8');
  assert.match(html, /<label[^>]*for="figure-kind"/);
  const picker = /<select[^>]*id="figure-kind"[^>]*>/.exec(html);
  assert.ok(picker);
  assert.match(picker[0], /disabled/);
  assert.match(picker[0], /aria-describedby="figure-note"/);
  for (const kind of ['parabola', 'line', 'circle', 'sine']) {
    assert.match(html, new RegExp('<option[^>]*value="' + kind + '"'));
  }
  for (const index of [1, 2, 3]) {
    assert.match(html, new RegExp('<label[^>]*id="figure-label-' + index + '"[^>]*for="parameter-figure-' + index + '"'));
    assert.match(html, new RegExp('<input[^>]*id="parameter-figure-' + index + '"[^>]*type="range"[^>]*disabled'));
    assert.match(html, new RegExp('<output[^>]*id="parameter-figure-' + index + '-value"[^>]*for="parameter-figure-' + index + '"'));
  }
  assert.ok(html.indexOf('../src/geometry/figures.js') > -1);
  assert.ok(html.indexOf('../src/geometry/figures.js') < html.indexOf('../src/page/main.js'));
});

test('破壁前和 1500ms 等待中不接受切换、更新或读数', async () => {
  const harness = await createHarness({ config: { externalAttempt: 'hang' } });
  try {
    const api = session(harness);
    assert.equal(api.getState(), null);
    assert.equal(harness.elements['figure-kind'].disabled, true);
    assert.equal(api.select('line').ok, false);
    assert.equal(api.updateParameters({ m: 1 }).ok, false);
    assert.equal(api.readAt(0).ok, false);
    harness.ready();
    harness.elements['figure-kind'].value = 'circle';
    harness.elements['figure-kind'].dispatch('change');
    assert.equal(harness.elements['figure-kind'].value, 'parabola');
    assert.equal(api.getState(), null);
    assert.equal(harness.overlay(), null);
    harness.elements['wake-button'].dispatch('click');
    assert.equal(harness.elements['figure-kind'].disabled, true);
    assert.equal(api.select('sine').ok, false);
    harness.advance(1499);
    assert.equal(api.getState(), null);
    harness.advance(1);
    assert.equal(api.getState().kind, 'parabola');
    assert.equal(harness.elements['figure-kind'].disabled, false);
    assert.match(harness.elements['source-label'].textContent, /超时回退/);
  } finally { harness.restore(); }
});

test('四种图形切换后各自滑块改变真实 SVG，显示当前参数与本地来源', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    const overlay = harness.overlay();
    for (const kind of ['line', 'circle', 'sine', 'parabola']) {
      select(harness, kind);
      assert.equal(harness.overlay(), overlay, '复用覆盖层，仅显示当前图形');
      const before = curvePath(harness);
      assert.ok(before.length > 0, kind + ' 初始图形可见');
      const figure = session(harness).getState();
      const names = Object.keys(figure.definition.parameters);
      const name = names[0];
      const value = changedValue(figure.definition.parameters[name]);
      const control = kind === 'parabola' ? elements['parameter-' + name] : elements['parameter-figure-1'];
      const output = kind === 'parabola' ? elements['parameter-' + name + '-value'] : elements['parameter-figure-1-value'];
      assert.equal(control.disabled, false);
      control.value = String(value);
      control.dispatch('input');
      closeTo(session(harness).getState().parameters[name], value);
      closeTo(Number(output.textContent), value);
      assert.notEqual(curvePath(harness), before, kind + ' 按新数值重画');
      assert.equal(overlay.querySelector('path.curve-hit').getAttribute('d'), curvePath(harness));
      assert.match(elements['figure-title'].textContent, new RegExp(figure.label));
      assert.ok(elements['figure-formula'].textContent.length > 0);
      assert.equal(elements['parabola-parameters'].hidden, kind !== 'parabola');
      assert.equal(elements['local-parameters'].hidden, kind === 'parabola');
      if (kind !== 'parabola') {
        assert.match(elements['source-label'].textContent, /本地数学图形/);
        assert.match(elements['source-label'].textContent, new RegExp(figure.label));
        assert.match(elements['source-note'].textContent, /未从视频识别/);
        assert.equal(harness.win.__breakglassAlignment, null, '本地图形不伪装成视频对齐证据');
        assert.equal(elements['figure-row-3'].hidden, names.length < 3);
        names.forEach((parameter, index) => {
          assert.match(elements['figure-label-' + (index + 1)].textContent, new RegExp(parameter));
          assert.equal(elements['parameter-figure-' + (index + 1)].min, String(figure.definition.parameters[parameter].min));
          assert.equal(elements['parameter-figure-' + (index + 1)].max, String(figure.definition.parameters[parameter].max));
        });
      }
    }
    assert.match(elements['source-label'].textContent, /预先准备的示例/);
  } finally { harness.restore(); }
});

test('离开抛物线后旧 a/h/k 控件无法改当前本地图形或原有结果', async () => {
  const harness = await interactive();
  try {
    const api = session(harness);
    const originalParabola = api.getState();
    for (const kind of ['line', 'circle', 'sine']) {
      select(harness, kind);
      const before = api.getState();
      const beforePath = curvePath(harness);
      for (const name of ['a', 'h', 'k']) {
        assert.equal(harness.elements['parameter-' + name].disabled, true);
        harness.elements['parameter-' + name].value = '1.7';
        harness.elements['parameter-' + name].dispatch('input');
      }
      assert.deepEqual(api.getState(), before);
      assert.equal(curvePath(harness), beforePath);
    }
    select(harness, 'parabola');
    assert.deepEqual(api.getState().parameters, originalParabola.parameters);
    const before = api.getState();
    harness.elements['parameter-figure-1'].value = '1.5';
    harness.elements['parameter-figure-1'].dispatch('input');
    assert.deepEqual(api.getState(), before, '隐藏的本地滑块不影响抛物线');
  } finally { harness.restore(); }
});

test('重置只恢复当前图形的初值，并把实际系数同步回滑块', async () => {
  const harness = await interactive();
  try {
    const api = session(harness);
    for (const kind of ['line', 'circle', 'sine', 'parabola']) {
      select(harness, kind);
      const initial = api.getState();
      const initialPath = curvePath(harness);
      const updates = Object.fromEntries(Object.entries(initial.definition.parameters).map(([name, item]) => [name, changedValue(item)]));
      assert.equal(api.updateParameters(updates).ok, true);
      assert.notEqual(curvePath(harness), initialPath);
      harness.elements['reset-button'].dispatch('click');
      assert.equal(api.getState().kind, kind);
      assert.deepEqual(api.getState().parameters, initial.parameters);
      assert.equal(curvePath(harness), initialPath);
      assert.equal(harness.elements['figure-kind'].value, kind);
    }
  } finally { harness.restore(); }
});

test('API 返回快照，未知图形、未知参数和非有限批量更新均保持原图', async () => {
  const harness = await interactive();
  try {
    select(harness, 'line');
    const api = session(harness);
    const initial = api.getState();
    const initialPath = curvePath(harness);
    const copy = api.getState();
    copy.parameters.m = 999;
    copy.definition.parameters.m.max = 999;
    copy.definition.domain.min = 999;
    assert.deepEqual(api.getState(), initial, '外部调用者无法修改画面使用的状态');
    assert.equal(api.select('triangle').ok, false);
    assert.deepEqual(api.getState(), initial);
    for (const updates of [{ m: 1.7, r: 1 }, { m: 1.7, b: Infinity }, { m: Number.NaN }, { m: '1.7' }]) {
      assert.equal(api.updateParameters(updates).ok, false);
      assert.deepEqual(api.getState(), initial, '整组更新被拒绝：' + String(updates));
      assert.equal(curvePath(harness), initialPath);
    }
    assert.equal(api.updateParameters({ m: 1.7, b: -0.5 }).ok, true);
    assert.deepEqual(api.getState().parameters, { m: 1.7, b: -0.5 });
    assert.notEqual(curvePath(harness), initialPath);
  } finally { harness.restore(); }
});

test('四种图形的读数和真实路径使用同一组修改后的系数', async () => {
  const harness = await interactive();
  try {
    const api = session(harness);
    const cases = [
      { kind: 'line', parameters: { m: 1.7, b: 0.5 }, x: 0.25,
        y: (p, x) => p.m * x + p.b },
      { kind: 'sine', parameters: { a: 1.8, h: 0.3, k: 1.5 }, x: 0.75,
        y: (p, x) => p.a * Math.sin(x - p.h) + p.k },
      { kind: 'parabola', parameters: { a: 0.8, h: -0.4, k: 1.5 }, x: 0.25,
        y: (p, x) => p.a * (x - p.h) ** 2 + p.k }
    ];
    for (const item of cases) {
      select(harness, item.kind);
      assert.equal(api.updateParameters(item.parameters).ok, true);
      const figure = api.getState();
      const reading = api.readAt(item.x);
      assert.equal(reading.ok, true);
      assert.equal(reading.values.length, 1);
      closeTo(reading.values[0], item.y(figure.parameters, item.x));
      assert.equal(reading.visible[0], true);
      const points = renderedPoints(harness, figure);
      assert.ok(points.length > 10);
      // SVG 输出保留两位小数，按图中一个数学单位的像素数允许这一舍入误差。
      for (const point of points) closeTo(point.y, item.y(figure.parameters, point.x), 0.003);
    }

    select(harness, 'circle');
    assert.equal(api.updateParameters({ h: 0.3, k: 1.5, r: 0.8 }).ok, true);
    const circle = api.getState();
    const { h, k, r } = circle.parameters;
    const centerReading = api.readAt(h);
    assert.deepEqual(centerReading.values, [k + r, k - r]);
    assert.deepEqual(centerReading.visible, [true, true]);
    const reading = api.readAt(h + r / 2);
    closeTo(reading.values[0], k + r * Math.sqrt(3) / 2);
    closeTo(reading.values[1], k - r * Math.sqrt(3) / 2);
    const points = renderedPoints(harness, circle);
    assert.ok(points.length > 20);
    assert.ok(points.some((point) => point.y > k) && points.some((point) => point.y < k));
    for (const point of points) closeTo((point.x - h) ** 2 + (point.y - k) ** 2, r ** 2, 0.003);
    assert.deepEqual(api.readAt(h + 2 * r).values, [], '圆外横坐标没有解');
    assert.equal(api.readAt(h + r).values.length, 1, '切点只有一个值');
  } finally { harness.restore(); }
});

test('完全越界不画假边，窗口外读数仍保留真实数值并标明不可见', async () => {
  const harness = await interactive();
  try {
    const api = session(harness);
    select(harness, 'line');
    assert.equal(api.updateParameters({ m: 4, b: 1 }).ok, true);
    assert.deepEqual(api.readAt(2).values, [9]);
    assert.deepEqual(api.readAt(2).visible, [false]);
    for (const point of renderedPoints(harness, api.getState())) closeTo(point.y, 4 * point.x + 1, 0.003);
    select(harness, 'circle');
    const radius = api.getState().definition.parameters.r.max;
    assert.equal(api.updateParameters({ h: 0, k: 0, r: radius }).ok, true);
    assert.equal(curvePath(harness), '');
    assert.equal(harness.overlay().querySelector('path.curve-hit').getAttribute('d'), '');
    assert.deepEqual(api.readAt(0).values, [radius, -radius]);
    assert.deepEqual(api.readAt(0).visible, [false, false]);
    select(harness, 'sine');
    assert.equal(api.updateParameters({ a: 4, h: 0, k: 2 }).ok, true);
    assert.deepEqual(api.readAt(Math.PI / 2).values, [6]);
    assert.deepEqual(api.readAt(Math.PI / 2).visible, [false]);
    for (const point of renderedPoints(harness, api.getState())) closeTo(point.y, 4 * Math.sin(point.x) + 2, 0.003);
    select(harness, 'parabola');
    const figure = api.getState();
    const x = figure.definition.domain.max + 1;
    const p = figure.parameters;
    closeTo(api.readAt(x).values[0], p.a * (x - p.h) ** 2 + p.k);
    assert.deepEqual(api.readAt(x).visible, [false]);
    assert.equal(api.readAt(Number.NaN).ok, false);
    assert.equal(api.readAt(Infinity).ok, false);
    assert.equal(api.readAt('0').ok, false);
  } finally { harness.restore(); }
});

test('越界系数使用实际可用数值，API、滑块和读数一致', async () => {
  const harness = await interactive();
  try {
    select(harness, 'line');
    const api = session(harness);
    const figure = api.getState();
    const changed = api.updateParameters({ m: 999 });
    assert.equal(changed.ok, true);
    assert.equal(changed.changes.m.requested, 999);
    assert.equal(changed.changes.m.clamped, true);
    assert.equal(changed.changes.m.after, figure.definition.parameters.m.max);
    assert.equal(api.getState().parameters.m, changed.changes.m.after);
    assert.equal(Number(harness.elements['parameter-figure-1'].value), changed.changes.m.after);
    assert.equal(Number(harness.elements['parameter-figure-1-value'].textContent), changed.changes.m.after);
    closeTo(api.readAt(0.25).values[0], changed.changes.m.after * 0.25 + figure.parameters.b);
  } finally { harness.restore(); }
});

test('退出、播放和换视频都清空图形，下一次破壁回到抛物线', async () => {
  const harness = await interactive();
  try {
    const api = session(harness);
    select(harness, 'circle');
    harness.elements['exit-button'].dispatch('click');
    assert.equal(api.getState(), null);
    assert.equal(harness.overlay(), null);
    assert.equal(harness.elements['figure-kind'].disabled, true);
    assert.equal(api.reset().ok, false);
    harness.elements['wake-button'].dispatch('click');
    assert.equal(api.getState().kind, 'parabola');
    select(harness, 'sine');
    harness.video.paused = false;
    harness.video.dispatch('play');
    assert.equal(api.getState(), null);
    assert.equal(harness.overlay(), null);
    harness.video.paused = true;
    harness.video.dispatch('pause');
    harness.elements['wake-button'].dispatch('click');
    assert.equal(api.getState().kind, 'parabola');
    select(harness, 'line');
    harness.elements['local-video'].files = [new Blob(['video'], { type: 'video/mp4' })];
    harness.elements['local-video'].dispatch('change');
    assert.equal(api.getState(), null);
    assert.equal(harness.overlay(), null);
    assert.equal(harness.elements['figure-kind'].disabled, true);
    harness.elements['preset-video'].dispatch('click');
    await flush();
    harness.ready();
    harness.elements['wake-button'].dispatch('click');
    assert.equal(api.getState().kind, 'parabola');
  } finally { harness.restore(); }
});

test('显示映射失效时切换、更新和重置均原子拒绝，恢复后可以操作', async () => {
  let objectFit = 'contain';
  const harness = await interactive({ getComputedStyle: () => ({ objectFit, objectPosition: '50% 50%' }) });
  try {
    const api = session(harness);
    const overlay = harness.overlay();
    const before = api.getState();
    const beforePath = curvePath(harness);
    const beforeUi = figureUi(harness);
    objectFit = 'fill';
    const selected = api.select('circle');
    assert.equal(selected.ok, false);
    assert.equal(selected.code, 'mapping_unavailable');
    assert.deepEqual(api.getState(), before);
    assert.equal(harness.overlay(), overlay);
    assert.equal(curvePath(harness), beforePath);
    assert.deepEqual(figureUi(harness), beforeUi);
    harness.elements['figure-kind'].value = 'circle';
    harness.elements['figure-kind'].dispatch('change');
    assert.equal(harness.elements['figure-kind'].value, 'parabola');
    assert.deepEqual(api.getState(), before);
    assert.deepEqual(figureUi(harness), beforeUi);

    objectFit = 'contain';
    assert.equal(api.select('circle').ok, true);
    assert.equal(api.updateParameters({ r: 1.7 }).ok, true);
    const circle = api.getState();
    const circlePath = curvePath(harness);
    const circleUi = figureUi(harness);
    objectFit = 'fill';
    for (const operation of [() => api.updateParameters({ r: 2 }), () => api.reset()]) {
      const result = operation();
      assert.equal(result.ok, false);
      assert.equal(result.code, 'mapping_unavailable');
      assert.deepEqual(api.getState(), circle);
      assert.equal(harness.overlay(), overlay);
      assert.equal(curvePath(harness), circlePath);
      assert.deepEqual(figureUi(harness), circleUi);
    }
    objectFit = 'contain';
    assert.equal(api.reset().ok, true);
    assert.equal(api.getState().parameters.r, circle.definition.parameters.r.initial);
  } finally { harness.restore(); }
});

test('抛物线滑块在映射不可用时还原实际系数，不改变真实路径', async () => {
  let objectFit = 'contain';
  const harness = await interactive({ getComputedStyle: () => ({ objectFit, objectPosition: '50% 50%' }) });
  try {
    const api = session(harness);
    assert.equal(api.updateParameters({ a: 0.8, h: 0.3, k: 1.5 }).ok, true);
    const before = api.getState();
    const beforePath = curvePath(harness);
    const beforeUi = figureUi(harness);
    objectFit = 'fill';
    for (const name of ['a', 'h', 'k']) {
      const input = harness.elements['parameter-' + name];
      input.value = String(before.definition.parameters[name].max);
      input.dispatch('input');
      assert.equal(Number(input.value), before.parameters[name]);
      assert.deepEqual(api.getState(), before);
      assert.equal(curvePath(harness), beforePath);
      assert.deepEqual(figureUi(harness), beforeUi);
    }
    assert.match(harness.elements['state-label'].textContent, /没有改图/);
  } finally { harness.restore(); }
});

test('全窗外大圆提示调整或重置，隐藏拖动点，重置后恢复可见', async () => {
  const harness = await interactive();
  try {
    select(harness, 'circle');
    const api = session(harness);
    const overlay = harness.overlay();
    assert.equal(api.updateParameters({ h: 0, k: 0, r: 8 }).ok, true);
    assert.equal(curvePath(harness), '');
    assert.equal(overlay.querySelector('path.curve-hit').getAttribute('d'), '');
    assert.match(harness.elements['figure-note'].textContent, /坐标窗口外.*调整.*重置/);
    assert.match(harness.elements['state-label'].textContent, /坐标窗口外.*调整.*重置/);
    assert.doesNotMatch(harness.elements['state-label'].textContent, /拖.*控制点/);
    assert.equal(overlay.querySelector('circle').style.display, 'none');
    assert.equal(overlay.querySelector('circle').getAttribute('tabindex'), '-1');
    assert.equal(overlay.querySelector('circle.curve-hit').style.display, 'none');
    assert.equal(api.reset().ok, true);
    assert.ok(curvePath(harness).length > 0);
    assert.doesNotMatch(harness.elements['figure-note'].textContent, /坐标窗口外/);
    assert.doesNotMatch(harness.elements['state-label'].textContent, /坐标窗口外/);
    assert.equal(overlay.querySelector('circle').style.display, '');
    assert.equal(overlay.querySelector('circle').getAttribute('tabindex'), '0');
  } finally { harness.restore(); }
});

test('本地图形遮住视频里的原曲线并隐藏舞台提示，回到抛物线恢复提示', async () => {
  const harness = await interactive();
  try {
    const { elements } = harness;
    const overlay = harness.overlay();
    assert.equal(elements['stage-banner'].hidden, false);
    assert.equal(elements['stage-banner'].dataset.mode, 'open');
    for (const kind of ['line', 'circle', 'sine']) {
      select(harness, kind);
      assert.equal(elements['stage-banner'].hidden, true);
      const group = overlay.querySelector('g.figure-coordinates');
      assert.equal(group.style.display, '');
      assert.equal(group.children[0].tagName, 'RECT');
      const rect = /^<rect\b[^>]*>/.exec(group.innerHTML);
      assert.ok(rect, '本地坐标背景必须是最底层');
      const [x, y, width, height] = overlay.getAttribute('viewBox').split(/\s+/).map(Number);
      for (const [name, expected] of Object.entries({ x, y, width, height })) {
        const attribute = new RegExp('\\b' + name + '="([^"]+)"').exec(rect[0]);
        assert.ok(attribute, '背景缺少 ' + name);
        assert.equal(Number(attribute[1]), expected, '背景覆盖完整 SVG ' + name);
      }
      const paths = overlay.children.filter((child) => child.tagName === 'PATH');
      assert.equal(paths.length, 2, '只保留当前数学曲线和它的透明热区');
      assert.equal(paths.filter((child) => !child.classList.contains('curve-hit')).length, 1);
      assert.equal(paths[0].getAttribute('d'), curvePath(harness));
      assert.equal(paths[1].getAttribute('d'), curvePath(harness));
      assert.equal(group.children.some((child) => child.tagName === 'PATH'), false);
    }
    select(harness, 'parabola');
    assert.equal(elements['stage-banner'].hidden, false);
    assert.equal(elements['stage-banner'].dataset.mode, 'open');
    assert.equal(elements['stage-banner-title'].textContent, '破壁已打开');
    assert.equal(overlay.querySelector('g.figure-coordinates').style.display, 'none');
  } finally { harness.restore(); }
});
