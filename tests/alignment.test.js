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
  sampleAlignment
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
      assert.equal(withinX, true, frame.name);
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
