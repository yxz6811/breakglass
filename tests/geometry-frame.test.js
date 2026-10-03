const test = require('node:test');
const assert = require('node:assert/strict');
const { captureFrame, isFrameCurrent } = require('../extension/src/geometry-scene/frame.js');
function video() { return { paused: true, seeking: false, readyState: 2, currentTime: 6, duration: 20, videoWidth: 1920, videoHeight: 1080, currentSrc: 'blob:one' }; }
function canvas(hook = () => {}) { return { getContext: () => ({ drawImage: hook }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }; }
test('capture uses exactly the paused frame and preserves source dimensions independently of JPEG', () => {
  const source = video(); const output = canvas();
  const result = captureFrame({ video: source, requestId: 'read-1', videoId: 'video-1', createCanvas: () => output });
  assert.equal(result.ok, true);
  assert.equal(output.width, 640); assert.equal(output.height, 360);
  assert.deepEqual(result.body.frameSize, { width: 1920, height: 1080 });
  assert.equal(result.body.frameTime, 6);
  assert.deepEqual(Object.keys(result.context).sort(), ['frameSize', 'frameTime', 'requestId', 'sceneRevision', 'videoId']);
  assert.equal(isFrameCurrent(source, result.context, 'video-1'), true);
  assert.equal(isFrameCurrent(source, result.context, 'video-2'), false);
});
test('playing, seeking, missing dimensions and undecoded frames never capture', () => {
  for (const change of [{ paused: false }, { seeking: true }, { readyState: 1 }, { videoWidth: 0 }, { currentTime: NaN }, { duration: Infinity }]) {
    let drew = false;
    const result = captureFrame({ video: { ...video(), ...change }, requestId: 'r', videoId: 'v', createCanvas: () => canvas(() => { drew = true; }) });
    assert.equal(result.ok, false); assert.equal(drew, false);
  }
});
test('changing time or source during canvas capture invalidates the frame', () => {
  for (const property of ['currentTime', 'currentSrc']) {
    const source = video();
    const result = captureFrame({ video: source, requestId: 'r', videoId: 'v', createCanvas: () => canvas(() => { source[property] = property === 'currentTime' ? 7 : 'blob:two'; }) });
    assert.equal(result.code, 'stale_frame');
  }
});
test('canvas security errors and unsupported image encoders are recoverable', () => {
  const source = video();
  const result = captureFrame({ video: source, requestId: 'r', videoId: 'v', createCanvas: () => ({ getContext() { throw new Error('private details'); } }) });
  assert.equal(result.code, 'capture_failed'); assert.doesNotMatch(result.message, /private/);
  const unsupported = canvas(); unsupported.toDataURL = () => 'data:image/png;base64,AAAA';
  assert.equal(captureFrame({ video: source, requestId: 'r', videoId: 'v', createCanvas: () => unsupported }).code, 'capture_failed');
});
