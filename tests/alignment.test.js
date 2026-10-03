// 故事 3 纯函数测试：三层坐标、内容矩形内的往返一致性、2% 偏差口径。
const test = require('node:test');
const assert = require('node:assert/strict');
const { getContentRect } = require('../extension/src/geometry/content-rect');
const {
  DEFAULT_TOLERANCE,
  mathPointToSource,
  mathPointToPage,
  sourcePointToPage,
  pagePointToSource,
  deviationRatio,
  withinTolerance,
  sampleAlignment,
  visibleCurvePolylines
} = require('../extension/src/geometry/alignment');

const definition = {
  equationId: 'fixture.parabola',
  parameters: {
    a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
    h: { initial: 0, min: -2, max: 2, step: 0.1 },
    k: { initial: 0, min: -2, max: 2, step: 0.1 }
  },
  dragParameter: 'h',
  domain: { min: -4, max: 4 },
  range: { min: -4, max: 4 },
  yAxis: 'up',
  region: { x: 480, y: 220, width: 960, height: 620 }
};
const parameters = { a: 0.8, h: 0, k: 0 };

const FRAMES = [
  { name: '16:9', elementRect: { left: 0, top: 0, width: 1280, height: 720 }, videoWidth: 1920, videoHeight: 1080 },
  { name: '4:3', elementRect: { left: 0, top: 0, width: 1000, height: 1000 }, videoWidth: 640, videoHeight: 480 },
  { name: '竖屏', elementRect: { left: 0, top: 0, width: 800, height: 600 }, videoWidth: 1080, videoHeight: 1920 },
  { name: '带黑边', elementRect: { left: 20, top: 10, width: 1200, height: 800 }, videoWidth: 1920, videoHeight: 1080 }
];

function contentRectOf(frame) {
  const rect = getContentRect(frame);
  assert.ok(rect, frame.name + ' 应该能算出内容矩形');
  return rect;
}

test('四种画幅下数学点都映射为有限数值', () => {
  for (const frame of FRAMES) {
    const rect = contentRectOf(frame);
    for (let index = 0; index <= 8; index += 1) {
      const mathX = definition.domain.min + (definition.domain.max - definition.domain.min) * index / 8;
      const point = mathPointToPage(definition, parameters, mathX, rect.scale);
      assert.equal(Number.isFinite(point.x) && Number.isFinite(point.y), true, frame.name + ' x=' + mathX);
    }
  }
});

test('超出 range 的纵坐标贴在 region 边上', () => {
  const source = mathPointToSource(definition, parameters, definition.domain.max);
  assert.equal(source.y, definition.region.y);
  assert.equal(source.y >= definition.region.y, true);
  assert.equal(source.y <= definition.region.y + definition.region.height, true);
});

test('数学点先落到 region 源像素，再按 scale 得到页面点', () => {
  const source = mathPointToSource(definition, parameters, 0);
  assert.equal(source.x, definition.region.x + definition.region.width / 2);
  assert.equal(source.y, definition.region.y + definition.region.height / 2);
  const rect = contentRectOf(FRAMES[0]);
  const page = mathPointToPage(definition, parameters, 0, rect.scale);
  assert.equal(page.x, source.x * rect.scale);
  assert.equal(page.y, source.y * rect.scale);
});

test('源像素与页面像素可以往返换算', () => {
  for (const frame of FRAMES) {
    const rect = contentRectOf(frame);
    const point = { x: 960, y: 530 };
    const back = pagePointToSource(sourcePointToPage(point, rect.scale), rect.scale);
    assert.equal(Math.abs(back.x - point.x) < 1e-9, true, frame.name);
    assert.equal(Math.abs(back.y - point.y) < 1e-9, true, frame.name);
  }
});

test('映射结果落在内容矩形内（黑边不参与对齐）', () => {
  for (const frame of FRAMES) {
    const rect = contentRectOf(frame);
    for (let index = 0; index <= 8; index += 1) {
      const mathX = definition.domain.min + (definition.domain.max - definition.domain.min) * index / 8;
      const point = mathPointToPage(definition, parameters, mathX, rect.scale);
      const withinX = point.x >= definition.region.x * rect.scale - 1e-9 &&
        point.x <= (definition.region.x + definition.region.width) * rect.scale + 1e-9;
      const withinY = point.y >= definition.region.y * rect.scale - 1e-9 &&
        point.y <= (definition.region.y + definition.region.height) * rect.scale + 1e-9;
      assert.equal(withinX, true, frame.name);
      assert.equal(withinY, true, frame.name + ' y');
    }
  }
});

test('偏差比例以内容区域较短边为分母', () => {
  const contentRect = { left: 0, top: 0, width: 1200, height: 600 };
  assert.equal(deviationRatio({ x: 10, y: 10 }, { x: 10, y: 10 }, contentRect), 0);
  assert.equal(deviationRatio({ x: 0, y: 0 }, { x: 12, y: 0 }, contentRect), 12 / 600);
  assert.equal(deviationRatio({ x: 0, y: 0 }, { x: 0, y: -6 }, contentRect), 6 / 600);
  assert.equal(deviationRatio({ x: 0, y: 0 }, { x: 3, y: 4 }, contentRect), 5 / 600);
  assert.equal(deviationRatio(null, { x: 0, y: 0 }, contentRect), null);
  assert.equal(deviationRatio({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: 0, height: 0 }), null);
});

test('2% 阈值包含边界值', () => {
  assert.equal(DEFAULT_TOLERANCE, 0.02);
  assert.equal(withinTolerance(0), true);
  assert.equal(withinTolerance(0.02), true);
  assert.equal(withinTolerance(0.0200001), false);
  assert.equal(withinTolerance(NaN), false);
  assert.equal(withinTolerance(null), false);
  assert.equal(withinTolerance((57 * 0.02) / 57), true);
  assert.equal(withinTolerance(-0.001), false);
});

test('sampleAlignment 用实测点与期望点给出最大偏差', () => {
  const rect = contentRectOf(FRAMES[3]);
  const contentRect = rect.contentRect;
  const shorter = Math.min(contentRect.width, contentRect.height);

  const clean = sampleAlignment({ definition, parameters, scale: rect.scale, contentRect, samples: 9 });
  assert.equal(clean.points.length, 9);
  assert.equal(clean.maxRatio, 0);
  assert.equal(clean.withinTolerance, true);
  assert.equal(clean.points[0].mathX, definition.domain.min);
  assert.equal(clean.points[8].mathX, definition.domain.max);

  const drift = (factor) => (mathX) => {
    const expected = mathPointToPage(definition, parameters, mathX, rect.scale);
    return { x: expected.x + shorter * factor, y: expected.y };
  };
  const within = sampleAlignment({ definition, parameters, scale: rect.scale, contentRect, samples: 9, readActual: drift(0.01) });
  assert.equal(Math.abs(within.maxRatio - 0.01) < 1e-9, true);
  assert.equal(within.withinTolerance, true);

  const over = sampleAlignment({ definition, parameters, scale: rect.scale, contentRect, samples: 9, readActual: drift(0.03) });
  assert.equal(Math.abs(over.maxRatio - 0.03) < 1e-9, true);
  assert.equal(over.withinTolerance, false);

  const missing = sampleAlignment({
    definition, parameters, scale: rect.scale, contentRect, samples: 9,
    readActual: () => null
  });
  assert.equal(missing.maxRatio, 0);
  assert.equal(missing.points.every((point) => point.actual === null && point.ratio === null), true);
});

test('采样点数可以指定，且不改变映射结果', () => {
  const rect = contentRectOf(FRAMES[0]);
  const five = sampleAlignment({ definition, parameters, scale: rect.scale, contentRect: rect.contentRect, samples: 5 });
  assert.equal(five.points.length, 5);
  const nine = sampleAlignment({ definition, parameters, scale: rect.scale, contentRect: rect.contentRect, samples: 9 });
  assert.equal(nine.points[4].mathX, 0);
  assert.equal(Math.abs(five.points[2].expected.x - nine.points[4].expected.x) < 1e-9, true);
});

test('合法的大域与小系数不会在采样乘法中溢出', () => {
  const { validateCurveResult } = require('../extension/src/curve/validate');
  const wide = {
    ...definition,
    domain: { min: 0, max: 1e307 },
    parameters: {
      a: { initial: 1e-308, min: 1e-308, max: 1e-308, step: 1e-309 },
      h: definition.parameters.h,
      k: definition.parameters.k
    }
  };
  assert.equal(validateCurveResult({
    requestId: 'wide-domain', videoId: 'fixture-wide', time: 0,
    frameSize: { width: 1920, height: 1080 }, source: 'preset', fallback: null,
    definition: wide
  }).ok, true, 'the entire adjustable definition can be evaluated finitely');
  const report = sampleAlignment({
    definition: wide, parameters: { a: 1e-308, h: 0, k: 0 },
    scale: 1, contentRect: { width: 1920, height: 1080 }, samples: 81
  });
  assert.equal(report.points.length, 81);
  assert.equal(report.points.at(-1).mathX, wide.domain.max);
  assert.equal(report.points.every((point) => Number.isFinite(point.mathX) &&
    Number.isFinite(point.expected.x) && Number.isFinite(point.expected.y)), true);
});

test('极大但有限的越界 y 仍贴在正确边缘，不因比例差值溢出翻转', () => {
  const { validateCurveResult } = require('../extension/src/curve/validate');
  const extreme = {
    ...definition,
    range: { min: 0, max: 1e308 },
    parameters: {
      a: definition.parameters.a,
      h: definition.parameters.h,
      k: { initial: -1e308, min: -1e308, max: -1e308, step: 1 }
    }
  };
  assert.equal(validateCurveResult({
    requestId: 'extreme-y', videoId: 'fixture-extreme-y', time: 0,
    frameSize: { width: 1920, height: 1080 }, source: 'preset', fallback: null,
    definition: extreme
  }).ok, true);
  const parameters = { a: 0.8, h: 0, k: -1e308 };
  assert.equal(mathPointToSource(extreme, parameters, 0).y,
    extreme.region.y + extreme.region.height, 'up axis clips below-range y to the bottom edge');
  assert.equal(mathPointToSource({ ...extreme, yAxis: 'down' }, parameters, 0).y,
    extreme.region.y, 'down axis clips below-range y to the top edge');
});

const chart = {
  ...definition,
  domain: { min: -2.5, max: 2.5 },
  range: { min: 0, max: 8 }
};

test('顶点落到窗口下方时，两臂在边界断开，不连成底边直线', () => {
  const missed = visibleCurvePolylines(chart, { a: 1, h: 0, k: -8 }, 81);
  assert.equal(missed.length, 0);
  const arms = visibleCurvePolylines(chart, { a: 1, h: 0, k: -2 }, 81);
  assert.equal(arms.length, 2);
  const root = Math.sqrt(2);
  assert.ok(arms[0].every((point) => point.x < -root + 1e-6 && point.y >= 0 && point.y <= 8));
  assert.ok(arms[1].every((point) => point.x > root - 1e-6 && point.y >= 0 && point.y <= 8));
  assert.ok(Math.abs(arms[0][arms[0].length - 1].y) < 1e-6);
  assert.ok(Math.abs(arms[1][0].y) < 1e-6);
  assert.ok(Math.abs(arms[0][arms[0].length - 1].x + root) < 1e-6);
  assert.ok(Math.abs(arms[1][0].x - root) < 1e-6);
});

test('顶点左右移出后，只保留窗口内的弧，不沿顶边画到角上', () => {
  const lines = visibleCurvePolylines(chart, { a: 1, h: 2, k: 1 }, 81);
  assert.equal(lines.length, 1);
  const line = lines[0];
  const entry = 2 - Math.sqrt(7);
  assert.ok(Math.abs(line[0].x - entry) < 1e-6);
  assert.ok(Math.abs(line[0].y - 8) < 1e-6);
  assert.ok(line.some((point) => Math.abs(point.x - 2) < 1e-9 && Math.abs(point.y - 1) < 1e-9));
  assert.equal(line.filter((point) => Math.abs(point.y - 8) < 1e-6).length, 1);
  assert.equal(line.at(-1).x, chart.domain.max);
});

test('整段都在窗口内时仍是从左到右的一条弧', () => {
  const lines = visibleCurvePolylines(chart, { a: 1, h: 0, k: 1 }, 81);
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0].x, chart.domain.min);
  assert.equal(lines[0].at(-1).x, chart.domain.max);
  assert.ok(lines[0].every((point) => point.y > 0 && point.y < 8));
});
