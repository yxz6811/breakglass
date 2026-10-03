/**
 * P0 边缘夹具：坐标关键字、不完整对齐测量、时间容差，以及 y 轴方向。
 * 断言写的是契约应有的行为。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getContentRect, resolvePosition } = require('../extension/src/geometry/content-rect');
const { mathPointToSource, sampleAlignment } = require('../extension/src/geometry/alignment');
const { validateCurveResult } = require('../extension/src/curve/validate');
const { SessionController } = require('../extension/src/session/session');

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

function curve(overrides = {}) {
  return {
    requestId: 'request-1',
    videoId: 'fixture-parabola',
    time: 6,
    frameSize: { width: 1920, height: 1080 },
    source: 'preset',
    fallback: null,
    definition: {
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
    },
    ...overrides
  };
}

test('center left 与 center right 按关键字落到对应轴', () => {
  assert.deepEqual(resolvePosition('center left'), { x: { percent: 0 }, y: { percent: 50 } });
  assert.deepEqual(resolvePosition('center right'), { x: { percent: 100 }, y: { percent: 50 } });
  assert.deepEqual(resolvePosition('left center'), resolvePosition('center left'));
  assert.deepEqual(resolvePosition('right center'), resolvePosition('center right'));
  const box = { left: 0, top: 0, width: 1200, height: 600 };
  const left = getContentRect({
    elementRect: box,
    videoWidth: 1920,
    videoHeight: 1080,
    objectPosition: 'center left'
  });
  assert.equal(left.contentRect.left, 0);
  assert.deepEqual(resolvePosition('50% left'), { x: { percent: 50 }, y: { percent: 50 } });
});

test('yAxis down 把较大的 y 放在区域下沿', () => {
  const down = {
    ...definition,
    yAxis: 'down',
    parameters: definition.parameters
  };
  const atMax = mathPointToSource(down, { a: 1, h: 0, k: 4 }, 0);
  const atMin = mathPointToSource(down, { a: 1, h: 0, k: -4 }, 0);
  assert.equal(atMax.y, definition.region.y + definition.region.height);
  assert.equal(atMin.y, definition.region.y);
});

test('采样包含不在等距格上的顶点，缺测点不能算通过', () => {
  const parameters = { a: 0.8, h: 0.5, k: 0 };
  const contentRect = { left: 0, top: 0, width: 640, height: 360 };
  const report = sampleAlignment({
    definition,
    parameters,
    scale: 1,
    contentRect,
    samples: 9
  });
  assert.equal(report.points.some((point) => point.mathX === 0.5), true);
  assert.equal(report.points[0].mathX, definition.domain.min);
  assert.equal(report.points[report.points.length - 1].mathX, definition.domain.max);
  assert.equal(report.withinTolerance, true);

  const missing = sampleAlignment({
    definition,
    parameters: { a: 0.8, h: 0, k: 0 },
    scale: 1,
    contentRect,
    samples: 9,
    readActual: () => null
  });
  assert.equal(missing.withinTolerance, false);
  assert.equal(missing.points.every((point) => point.ratio === null), true);

  let seen = 0;
  const partial = sampleAlignment({
    definition,
    parameters: { a: 0.8, h: 0, k: 0 },
    scale: 1,
    contentRect,
    samples: 9,
    readActual(mathX) {
      seen += 1;
      if (seen === 1) return null;
      const ratio = (mathX - definition.domain.min) / (definition.domain.max - definition.domain.min);
      return {
        x: (definition.region.x + ratio * definition.region.width),
        y: definition.region.y + definition.region.height / 2
      };
    }
  });
  assert.equal(partial.withinTolerance, false);
});

test('NaN 时间容差回退到默认 ±0.2 秒，而不是放行任意时间', () => {
  const far = curve();
  far.time = 9;
  assert.equal(validateCurveResult(far, { targetTime: 6, timeTolerance: Number.NaN }).code, 'time_mismatch');
  const near = curve();
  near.time = 6.2;
  assert.equal(validateCurveResult(near, { targetTime: 6, timeTolerance: Number.NaN }).ok, true);
  assert.equal(validateCurveResult(curve({ time: 6.21 }), { targetTime: 6 }).code, 'time_mismatch');
  const session = new SessionController({ videoId: 'fixture-parabola', targetTime: 6, frameSize: { width: 1920, height: 1080 } });
  assert.equal(session.canWake({ paused: true, currentTime: 6.2 }), true);
  assert.equal(session.canWake({ paused: true, currentTime: 6.21 }), false);
});
