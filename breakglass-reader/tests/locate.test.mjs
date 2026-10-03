import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJpegRgb } from '../src/jpeg.mjs';
import { locateCurve } from '../src/locate.mjs';
import { placeCurve, sliderRanges } from '../src/geometry.mjs';
import { FRAME_JPEG, JPEG_SIZE, MEASURED_DOTS, SOURCE_SIZE, alignment } from './helpers/fixtures.mjs';

test('巨大有限顶点不进入无法前进的采样循环', () => {
  const image = { width: 32, height: 32 };
  const rgb = Buffer.alloc(image.width * image.height * 3);
  assert.equal(locateCurve(rgb, image, { a: 1, h: 1e308, k: 1 }), null);
  assert.equal(locateCurve(rgb, image, { a: 1, h: 1e16, k: 1 }), null);
});

test('纯 RGB 夹具可定位抛物线，不依赖 ffmpeg', () => {
  const image = { width: 120, height: 96 };
  const rgb = Buffer.alloc(image.width * image.height * 3, 255);
  for (let x = -2.6; x <= 2.6; x += 0.005) {
    const px = Math.round(60 + 14 * x);
    const py = Math.round(84 - 14 * (x * x + 1));
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
    rgb.fill(0, (py * image.width + px) * 3, (py * image.width + px) * 3 + 3);
  }
  const located = locateCurve(rgb, image, { a: 1, h: 0, k: 1 });
  assert.ok(located);
  assert.ok(located.score >= 0.72);
  assert.ok(located.drawn.min < 0 && located.drawn.max > 0);
});

test('9 秒片这一帧按 y = x^2 + 1 量出来的点，偏差比例低于 2%', async () => {
  const rgb = await decodeJpegRgb(FRAME_JPEG, JPEG_SIZE);
  assert.ok(rgb, '需要本机 ffmpeg 才能把 JPEG 解成像素');
  const located = locateCurve(rgb, JPEG_SIZE, { a: 1, h: 0, k: 1 });
  assert.ok(located);
  assert.ok(located.score >= 0.72);
  const placement = placeCurve({ a: 1, h: 0, k: 1 }, located.drawn, located.map, JPEG_SIZE, SOURCE_SIZE);
  assert.equal(placement.ok, true);
  const definition = {
    equationId: 'fixture.parabola',
    parameters: sliderRanges({ a: 1, h: 0, k: 1 }),
    dragParameter: 'h',
    domain: placement.domain,
    range: placement.range,
    yAxis: 'up',
    region: placement.region
  };
  const short = Math.min(SOURCE_SIZE.width, SOURCE_SIZE.height);
  for (const dot of MEASURED_DOTS.filter((item) => item.y === item.x ** 2 + 1)) {
    const drawn = alignment.mathPointToSource(definition, null, dot.x);
    const ratio = Math.hypot(drawn.x - dot.sx, drawn.y - dot.sy) / short;
    assert.ok(ratio < 0.02, `x=${dot.x} 偏了 ${ratio}`);
  }
});

test('图上没有的方程量不到线', async () => {
  const rgb = await decodeJpegRgb(FRAME_JPEG, JPEG_SIZE);
  assert.ok(rgb);
  assert.equal(locateCurve(rgb, JPEG_SIZE, { a: 1, h: 8, k: 40 }), null);
});
