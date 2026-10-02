const test = require('node:test');
const assert = require('node:assert/strict');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { placeRegionInFrame } = require('../extension/src/preset/place-in-frame');

test('3024×1898 的预制区域按当前帧宽高比例放进 1920×1080', () => {
  assert.equal(preset.frameSize.width, 3024);
  assert.equal(preset.frameSize.height, 1898);
  const region = preset.definition.region;
  assert.deepEqual(region, { x: 629, y: 561, width: 538, height: 866 });
  const frame = { width: 1920, height: 1080 };
  const placed = placeRegionInFrame(preset.frameSize, region, frame);
  const scaleX = frame.width / preset.frameSize.width;
  const scaleY = frame.height / preset.frameSize.height;
  assert.deepEqual(placed.frameSize, frame);
  assert.equal(placed.region.x, region.x * scaleX);
  assert.equal(placed.region.y, region.y * scaleY);
  assert.equal(placed.region.width, region.width * scaleX);
  assert.equal(placed.region.height, region.height * scaleY);
  assert.notEqual(placed.region.x, region.x);
  assert.equal(placed.region.x + placed.region.width <= frame.width, true);
  assert.equal(placed.region.y + placed.region.height <= frame.height, true);
  assert.deepEqual(preset.definition.region, { x: 629, y: 561, width: 538, height: 866 });
  assert.deepEqual(preset.frameSize, { width: 3024, height: 1898 });
});

test('当前帧与准备画幅相同时区域保持原值', () => {
  const region = { x: 480, y: 220, width: 960, height: 620 };
  const frame = { width: 1920, height: 1080 };
  const placed = placeRegionInFrame(frame, region, frame);
  assert.deepEqual(placed.region, region);
  assert.deepEqual(placed.frameSize, frame);
});

test('刚好铺满的区域换到 31 像素宽时不会被浮点误差拒绝', () => {
  const prepared = { width: 1920, height: 1080 };
  const region = { x: 0, y: 0, width: 1920, height: 1080 };
  const frame = { width: 31, height: 1080 };
  const placed = placeRegionInFrame(prepared, region, frame);
  assert.ok(placed);
  assert.equal(placed.region.x + placed.region.width <= frame.width, true);
  assert.equal(placed.region.y + placed.region.height <= frame.height, true);
  assert.equal(placed.region.width > 0, true);
});

test('超出准备画幅的区域换算后仍放不进当前帧', () => {
  const placed = placeRegionInFrame(
    { width: 1920, height: 1080 },
    { x: 0, y: 0, width: 2000, height: 1080 },
    { width: 3024, height: 1898 }
  );
  assert.equal(placed, null);
});
