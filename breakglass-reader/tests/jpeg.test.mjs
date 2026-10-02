import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJpegDataUrl, jpegSize, sameAspect } from '../src/jpeg.mjs';
import { FRAME_DATA_URL, JPEG_SIZE, SOURCE_SIZE } from './helpers/fixtures.mjs';

test('从页面那样的 data URL 读出 JPEG 宽高', () => {
  const bytes = decodeJpegDataUrl(FRAME_DATA_URL);
  assert.ok(bytes);
  assert.deepEqual(jpegSize(bytes), JPEG_SIZE);
});

test('不是 JPEG data URL 的一律读不出', () => {
  assert.equal(decodeJpegDataUrl('data:image/png;base64,iVBORw0KGgo='), null);
  assert.equal(decodeJpegDataUrl('data:image/jpeg;base64,'), null);
  assert.equal(decodeJpegDataUrl('data:image/jpeg;base64,@@@'), null);
  assert.equal(decodeJpegDataUrl('data:image/jpeg;base64,iVBORw0KGgo='), null);
  assert.equal(decodeJpegDataUrl(42), null);
});

test('跳过 APP 段，读到帧头里的宽高', () => {
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x96, 0x02, 0x80, 0x03]);
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof, Buffer.alloc(12)]);
  assert.deepEqual(jpegSize(bytes), { width: 640, height: 406 });
});

test('没有帧头就先碰到扫描段时读不出', () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]);
  assert.equal(jpegSize(bytes), null);
});

test('宽高比例和源尺寸一致才算同一帧', () => {
  assert.equal(sameAspect(JPEG_SIZE, SOURCE_SIZE), true);
  assert.equal(sameAspect({ width: 640, height: 360 }, SOURCE_SIZE), false);
  assert.equal(sameAspect({ width: 640, height: 360 }, { width: 1920, height: 1080 }), true);
});
