import test from 'node:test';
import assert from 'node:assert/strict';
import { fitAxes, placeCurve, sliderRanges } from '../src/geometry.mjs';
import { accurateAnchors, alignment, JPEG_SIZE, MEASURED_DOTS, SOURCE_SIZE } from './helpers/fixtures.mjs';

/**
 * @param {{ a: number, h: number, k: number }} params
 * @param {object} placement
 * @returns {object}
 */
function definitionOf(params, placement) {
  return {
    equationId: 'fixture.parabola',
    parameters: sliderRanges(params),
    dragParameter: 'h',
    domain: placement.domain,
    range: placement.range,
    yAxis: 'up',
    region: placement.region
  };
}

test('模型看准时，算出的区域让页面把红点画回原处', () => {
  const params = { a: 1, h: 0, k: 1 };
  const axes = fitAxes(accurateAnchors(), JPEG_SIZE);
  assert.equal(axes.ok, true);
  const placement = placeCurve(params, { min: -2.5, max: 2.5 }, axes.map, JPEG_SIZE, SOURCE_SIZE);
  assert.equal(placement.ok, true);
  assert.deepEqual(placement.domain, { min: -2.5, max: 2.5 });

  const definition = definitionOf(params, placement);
  const shortSide = Math.min(SOURCE_SIZE.width, SOURCE_SIZE.height);
  for (const dot of MEASURED_DOTS.filter((item) => item.y === item.x ** 2 + 1)) {
    const drawn = alignment.mathPointToSource(definition, null, dot.x);
    const ratio = Math.hypot(drawn.x - dot.sx, drawn.y - dot.sy) / shortSide;
    assert.ok(ratio < 0.005, `x=${dot.x} 偏了 ${ratio}`);
  }
  assert.ok(Math.abs(placement.region.x - 629) < 4, `左边 ${placement.region.x}`);
  assert.ok(Math.abs(placement.region.width - 538) < 4, `宽 ${placement.region.width}`);
});

test('锚点前后不一致时整帧丢掉', () => {
  const anchors = accurateAnchors();
  anchors[0] = { ...anchors[0], px: anchors[0].px + 30 };
  assert.deepEqual(fitAxes(anchors, JPEG_SIZE), { ok: false, reason: 'anchors_disagree' });
});

test('y 轴读反、点太少或全在一条线上都不拟合', () => {
  const flipped = accurateAnchors().map((item) => ({ ...item, py: 402 - item.py }));
  assert.equal(fitAxes(flipped, JPEG_SIZE).reason, 'axis_direction');
  assert.equal(fitAxes(accurateAnchors().slice(0, 2), JPEG_SIZE).reason, 'too_few_anchors');
  const flat = [{ x: 0, y: 1, px: 10, py: 10 }, { x: 1, y: 1, px: 20, py: 10 }, { x: 2, y: 1, px: 30, py: 10 }];
  assert.equal(fitAxes(flat, JPEG_SIZE).reason, 'degenerate_anchors');
  assert.equal(fitAxes('不是数组', JPEG_SIZE).reason, 'too_few_anchors');
});

test('曲线伸出画面顶端时收窄横坐标，区域留在画面里', () => {
  const params = { a: 1, h: 0, k: 1 };
  const axes = fitAxes(accurateAnchors(), JPEG_SIZE);
  const placement = placeCurve(params, { min: -10, max: 10 }, axes.map, JPEG_SIZE, SOURCE_SIZE);
  assert.equal(placement.ok, true);
  assert.ok(placement.domain.min > -10 && placement.domain.max < 10);
  const { region } = placement;
  assert.ok(region.x >= 0 && region.y >= 0);
  assert.ok(region.x + region.width <= SOURCE_SIZE.width);
  assert.ok(region.y + region.height <= SOURCE_SIZE.height);
  const top = alignment.mathPointToSource(definitionOf(params, placement), null, placement.domain.max);
  assert.ok(top.y >= 0);
});

test('顶点在画面外、或画出的范围无效时不给区域', () => {
  const axes = fitAxes(accurateAnchors(), JPEG_SIZE);
  assert.equal(placeCurve({ a: 1, h: 0, k: 40 }, { min: -1, max: 1 }, axes.map, JPEG_SIZE, SOURCE_SIZE).reason, 'outside_frame');
  assert.equal(placeCurve({ a: 1, h: 0, k: 1 }, { min: 2, max: 1 }, axes.map, JPEG_SIZE, SOURCE_SIZE).reason, 'curve_extent');
  assert.equal(placeCurve({ a: 1, h: 0, k: 1 }, { min: Number.NaN, max: 1 }, axes.map, JPEG_SIZE, SOURCE_SIZE).reason, 'curve_extent');
});

test('开口向下也能放进画面', () => {
  const axes = fitAxes(accurateAnchors(), JPEG_SIZE);
  const placement = placeCurve({ a: -1, h: 0, k: 5 }, { min: -2, max: 2 }, axes.map, JPEG_SIZE, SOURCE_SIZE);
  assert.equal(placement.ok, true);
  assert.ok(placement.range.max > 5 && placement.range.min < 1);
});

test('滑块范围围着读数，a 为负时也包住初值', () => {
  const ranges = sliderRanges({ a: -1, h: 3, k: -0.5 });
  assert.deepEqual(ranges.a, { initial: -1, min: -1.5, max: -0.5, step: 0.1 });
  assert.deepEqual(ranges.h, { initial: 3, min: 1, max: 5, step: 0.1 });
  assert.deepEqual(ranges.k, { initial: -0.5, min: -2.5, max: 1.5, step: 0.1 });
});
