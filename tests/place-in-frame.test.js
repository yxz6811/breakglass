const test = require('node:test');
const assert = require('node:assert/strict');
const preset = require('../extension/assets/presets/demo-parabola.json');
const { placeRegionInFrame } = require('../extension/src/preset/place-in-frame');

test('1920×1080 的预制区域按当前帧宽高比例放进 3024×1898', () => {
  assert.equal(preset.frameSize.width, 1920);
  assert.equal(preset.frameSize.height, 1080);
  const region = preset.definition.region;
  assert.deepEqual(region, { x: 480, y: 220, width: 960, height: 620 });
  const frame = { width: 3024, height: 1898 };
  const placed = placeRegionInFrame(preset.frameSize, region, frame);
  const scaleX = frame.width / preset.frameSize.width;
  const scaleY = frame.height / preset.frameSize.height;
  assert.deepEqual(placed.frameSize, frame);
  assert.equal(placed.region.x, region.x * scaleX);
  assert.equal(placed.region.y, region.y * scaleY);
  assert.equal(placed.region.width, region.width * scaleX);
  assert.equal(placed.region.height, region.height * scaleY);
  assert.equal(placed.region.x, 756);
  assert.equal(placed.region.width, 1512);
  assert.equal(placed.region.y, 220 * 1898 / 1080);
  assert.equal(placed.region.height, 620 * 1898 / 1080);
  assert.equal(placed.region.x + placed.region.width <= frame.width, true);
  assert.equal(placed.region.y + placed.region.height <= frame.height, true);
  assert.deepEqual(preset.definition.region, { x: 480, y: 220, width: 960, height: 620 });
  assert.deepEqual(preset.frameSize, { width: 1920, height: 1080 });
});

test('当前帧与准备画幅相同时区域保持原值', () => {
  const region = { x: 480, y: 220, width: 960, height: 620 };
  const frame = { width: 1920, height: 1080 };
  const placed = placeRegionInFrame(frame, region, frame);
  assert.deepEqual(placed.region, region);
  assert.deepEqual(placed.frameSize, frame);
});

test('超出准备画幅的区域换算后仍放不进当前帧', () => {
  const placed = placeRegionInFrame(
    { width: 1920, height: 1080 },
    { x: 0, y: 0, width: 2000, height: 1080 },
    { width: 3024, height: 1898 }
  );
  assert.equal(placed, null);
});
