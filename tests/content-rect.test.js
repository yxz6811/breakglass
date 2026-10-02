const test = require('node:test');
const assert = require('node:assert/strict');
const { getContentRect, resolvePosition } = require('../extension/src/geometry/content-rect');

const elementRect = { left: 10, top: 20, width: 1200, height: 600 };

test('contain computes pillarbox content from source dimensions', () => {
  const result = getContentRect({
    elementRect,
    videoWidth: 1920,
    videoHeight: 1080,
    objectFit: 'contain',
    objectPosition: '50% 50%'
  });
  assert.equal(result.scale, 600 / 1080);
  assert.equal(result.contentRect.width, 1920 * (600 / 1080));
  assert.equal(result.contentRect.height, 600);
  assert.equal(result.contentRect.left, 10 + (1200 - result.contentRect.width) / 2);
});

test('contain computes letterbox content when the container is taller', () => {
  const result = getContentRect({
    elementRect: { left: 0, top: 0, width: 600, height: 1000 },
    videoWidth: 1920,
    videoHeight: 1080,
    objectFit: 'contain',
    objectPosition: '50% 50%'
  });
  assert.equal(result.contentRect.width, 600);
  assert.equal(result.contentRect.height, 600 / (1920 / 1080));
  assert.equal(result.contentRect.top, (1000 - result.contentRect.height) / 2);
});

test('invalid geometry returns null', () => {
  assert.equal(getContentRect({ elementRect, videoWidth: 0, videoHeight: 1080 }), null);
});
test('单关键字 object-position 按 CSS 语义补齐另一轴', () => {
  const box = { left: 0, top: 0, width: 1200, height: 600 };
  const slack = 1200 - 1920 * (600 / 1080);
  assert.equal(getContentRect({ elementRect: box, videoWidth: 1920, videoHeight: 1080, objectPosition: 'left' }).contentRect.left, 0);
  assert.equal(getContentRect({ elementRect: box, videoWidth: 1920, videoHeight: 1080, objectPosition: 'top' }).contentRect.left, slack / 2);
  const tall = getContentRect({ elementRect: { left: 0, top: 0, width: 600, height: 1000 }, videoWidth: 1920, videoHeight: 1080, objectPosition: 'left' });
  assert.equal(tall.contentRect.top, (1000 - 1080 * (600 / 1920)) / 2);
});

test('object-position 支持 px 长度并在剩余空间内夹住', () => {
  const box = { left: 0, top: 0, width: 1200, height: 600 };
  const slack = 1200 - 1920 * (600 / 1080);
  const left = (objectPosition) => getContentRect({ elementRect: box, videoWidth: 1920, videoHeight: 1080, objectPosition }).contentRect.left;
  assert.equal(left('0px 50%'), 0);
  assert.equal(left('40px 50%'), 40);
  assert.equal(left('500px 50%'), slack);
  assert.equal(left('-10px 50%'), 0);
});

test('数字型与无单位 0 可以解析，无法识别的声明回退到 50%', () => {
  const box = { left: 0, top: 0, width: 1200, height: 600 };
  const slack = 1200 - 1920 * (600 / 1080);
  const left = (objectPosition) => getContentRect({ elementRect: box, videoWidth: 1920, videoHeight: 1080, objectPosition }).contentRect.left;
  assert.equal(left(0), 0);
  assert.equal(left('180% 50%'), slack);
  assert.equal(left('nonsense whatever'), slack / 2);
  assert.equal(left(''), slack / 2);
  assert.equal(left('12'), slack / 2);
});

test('关键字组合与顺序等价', () => {
  assert.deepEqual(resolvePosition('top left'), resolvePosition('left top'));
  assert.deepEqual(resolvePosition('center'), { x: { percent: 50 }, y: { percent: 50 } });
  assert.deepEqual(resolvePosition('right bottom'), { x: { percent: 100 }, y: { percent: 100 } });
  assert.deepEqual(resolvePosition('left left'), { x: { percent: 50 }, y: { percent: 50 } });
  const box = { left: 0, top: 0, width: 600, height: 1000 };
  const bottomRight = getContentRect({ elementRect: box, videoWidth: 1920, videoHeight: 1080, objectPosition: 'bottom right' });
  assert.equal(bottomRight.contentRect.top, 1000 - 1080 * (600 / 1920));
});

test('非有限的 videoWidth / videoHeight 返回 null', () => {
  assert.equal(getContentRect({ elementRect, videoWidth: Number.NaN, videoHeight: 1080 }), null);
  assert.equal(getContentRect({ elementRect, videoWidth: 1920, videoHeight: Infinity }), null);
  assert.equal(getContentRect({ elementRect, videoWidth: -1, videoHeight: 1080 }), null);
});
