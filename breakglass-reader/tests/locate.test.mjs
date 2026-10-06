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

/**
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} color
 * @returns {Buffer}
 */
function canvas(width, height, color) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let index = 0; index < rgb.length; index += 3) {
    rgb[index] = color[0];
    rgb[index + 1] = color[1];
    rgb[index + 2] = color[2];
  }
  return rgb;
}

/**
 * @param {Buffer} rgb
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {[number, number, number]} color
 * @param {number} thick
 */
function dot(rgb, width, height, x, y, color, thick) {
  for (let dy = -thick; dy <= thick; dy += 1) {
    for (let dx = -thick; dx <= thick; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const index = (py * width + px) * 3;
      rgb[index] = color[0];
      rgb[index + 1] = color[1];
      rgb[index + 2] = color[2];
    }
  }
}

/**
 * @param {Buffer} rgb
 * @param {number} width
 * @param {number} height
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {[number, number, number]} color
 * @param {number} min
 * @param {number} max
 * @param {number} [thick]
 */
function drawParabola(rgb, width, height, params, map, color, min, max, thick = 1) {
  for (let x = min; x <= max; x += 0.01) {
    const y = params.a * (x - params.h) ** 2 + params.k;
    dot(rgb, width, height, Math.round(map.ox + map.sx * x), Math.round(map.oy - map.sy * y), color, thick);
  }
}

test('彩色、粉笔色和横纵比例不同的抛物线都能定位，画面上没有的方程仍然拒绝', () => {
  const blue = canvas(640, 360, [232, 214, 168]);
  const blueParams = { a: 1, h: 0, k: 0 };
  const blueMap = { ox: 320, sx: 70, oy: 300, sy: 70 };
  drawParabola(blue, 640, 360, blueParams, blueMap, [30, 90, 220], -2, 2, 1);
  const blueFound = locateCurve(blue, { width: 640, height: 360 }, blueParams);
  assert.ok(blueFound, '亮蓝色、只画出顶点附近的一段也应定位');
  assert.ok(blueFound.score >= 0.72);
  assert.ok(blueFound.drawn.min < -0.5 && blueFound.drawn.max > 0.5);
  assert.equal(locateCurve(blue, { width: 640, height: 360 }, { a: 1, h: 3, k: 8 }), null);

  const chalk = canvas(480, 270, [28, 28, 28]);
  const chalkParams = { a: -0.5, h: 1, k: 4 };
  const chalkMap = { ox: 180, sx: 36, oy: 220, sy: 28 };
  drawParabola(chalk, 480, 270, chalkParams, chalkMap, [245, 245, 240], -1.2, 3.6, 1);
  const chalkFound = locateCurve(chalk, { width: 480, height: 270 }, chalkParams);
  assert.ok(chalkFound, '深色底上的浅色抛物线、纵轴比例不同也应定位');
  assert.ok(chalkFound.drawn.min < 1 && chalkFound.drawn.max > 1);

  const red = canvas(640, 360, [248, 248, 248]);
  const redParams = { a: 0.5, h: -1, k: 2 };
  const redMap = { ox: 360, sx: 55, oy: 250, sy: 40 };
  drawParabola(red, 640, 360, redParams, redMap, [210, 40, 40], -3, 2, 2);
  for (let x = 40; x < 600; x += 1) dot(red, 640, 360, x, 250, [40, 40, 40], 0);
  for (let y = 30; y < 330; y += 1) dot(red, 640, 360, 305, y, [40, 40, 40], 0);
  const redFound = locateCurve(red, { width: 640, height: 360 }, redParams);
  assert.ok(redFound, '较粗的红色抛物线也应定位');
  assert.equal(locateCurve(red, { width: 640, height: 360 }, { a: 1, h: 4, k: -6 }), null);
});

test('只有坐标轴、没有抛物线时对不上这条方程', () => {
  const rgb = canvas(320, 180, [255, 255, 255]);
  for (let x = 20; x < 300; x += 1) dot(rgb, 320, 180, x, 120, [20, 20, 20], 0);
  for (let y = 16; y < 164; y += 1) dot(rgb, 320, 180, 160, y, [20, 20, 20], 0);
  assert.equal(locateCurve(rgb, { width: 320, height: 180 }, { a: 1, h: 0, k: 1 }), null);
});
