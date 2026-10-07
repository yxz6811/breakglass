const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/src/plugin/video-context');

// DOM and media are deterministic doubles; real local-video decoding is verified separately in Edge.
function fixture(options = {}) {
  const document = new EventTarget(); document.hidden = false;
  document.baseURI = 'http://localhost:4174/learning-site/index.html';
  document.defaultView = { location: { origin: 'http://localhost:4174' } };
  const draws = []; const created = []; const updates = [];
  const original = { ownerDocument: document, src: options.source || 'blob:http://localhost:4174/student-file',
    currentTime: 7, paused: false };
  original.currentSrc = original.src;
  let decoder;
  document.createElement = (name) => {
    if (name === 'canvas') {
      const canvas = { width: 0, height: 0, removed: false,
        getContext: () => ({ drawImage: (element) => draws.push(element.currentTime) }),
        toDataURL: () => 'data:image/jpeg;base64,AQID', remove() { this.removed = true; } };
      created.push(canvas); return canvas;
    }
    decoder = new EventTarget(); decoder.time = 0; decoder.readyState = 0;
    decoder.videoWidth = options.width || 640; decoder.videoHeight = options.height || 360;
    decoder.duration = options.duration || 12; decoder.seeking = false;
    decoder.pause = () => { decoder.pauseCalled = true; };
    decoder.removeAttribute = () => { decoder.src = ''; };
    decoder.remove = () => { decoder.removed = true; };
    decoder.load = () => {
      if (decoder.src && !options.holdMetadata) queueMicrotask(() => {
        decoder.readyState = 2; decoder.dispatchEvent(new Event('loadedmetadata')); decoder.dispatchEvent(new Event('loadeddata'));
      });
    };
    Object.defineProperty(decoder, 'currentTime', { get: () => decoder.time, set: (value) => {
      updates.push(value); decoder.time = value; decoder.seeking = true;
      queueMicrotask(() => {
        options.beforeSeeked?.({ document, decoder, original });
        decoder.seeking = false; decoder.dispatchEvent(new Event('seeked'));
      });
    } });
    created.push(decoder); return decoder;
  };
  return { document, original, draws, updates, created, get decoder() { return decoder; } };
}
function assertClean(f) {
  assert.equal(f.decoder.src, ''); assert.equal(f.decoder.pauseCalled, true); assert.equal(f.decoder.removed, true);
  const canvas = f.created.find((value) => Object.hasOwn(value, 'width'));
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.equal(canvas.removed, true);
}

test('local extraction uses a separate muted decoder, captures bounded JPEGs and leaves the student player untouched', async () => {
  const f = fixture();
  const response = await api.extractWindow(f.original, { start: 0, end: 9, maxFrames: 4 });
  assert.deepEqual(response.frames.map((frame) => frame.frameTime), [0, 3, 6, 9]);
  assert.deepEqual(response.coverage, { start: 0, end: 9, frameCount: 4 });
  assert.equal(response.frames.every((frame) => frame.image.startsWith('data:image/jpeg')), true);
  assert.deepEqual(f.draws, [0, 3, 6, 9]); assert.equal(f.decoder.muted, true);
  assert.equal(f.original.currentTime, 7); assert.equal(f.original.paused, false); assertClean(f);
});

test('same-origin authored fixtures are allowed but third-party, other-origin blobs and arbitrary paths are blocked before decode', async () => {
  for (const source of ['https://www.bilibili.com/player.mp4', 'blob:https://example.invalid/id',
    'http://localhost:4174/arbitrary.mp4', 'http://localhost:4174/extension/assets/video/geometry/triangle-3-4-5.mp4?token=secret']) {
    const f = fixture({ source });
    await assert.rejects(api.extractWindow(f.original, { start: 0, end: 1 }), { code: 'unsupported_source' });
    assert.equal(f.created.length, 0);
  }
  const f = fixture({ source: 'http://localhost:4174/extension/assets/video/geometry/triangle-3-4-5.mp4' });
  assert.equal((await api.extractWindow(f.original, { start: 0, end: 1 })).frames.length, 4); assertClean(f);
});

test('source duration/size limits are enforced before drawing and resources are always released', async () => {
  for (const options of [{ width: 1921 }, { height: 1081 }, { duration: 601 }, { duration: 2 }]) {
    const f = fixture(options);
    await assert.rejects(api.extractWindow(f.original, { start: 0, end: 3 }), { code: 'unsupported_media' });
    assert.equal(f.draws.length, 0); assertClean(f);
  }
});

test('one extraction per player rejects overlap; cancellation aborts a stuck decoder and releases the next run', async () => {
  const f = fixture({ holdMetadata: true }); const controller = new AbortController();
  const work = api.extractWindow(f.original, { start: 0, end: 3, signal: controller.signal });
  await assert.rejects(api.extractWindow(f.original, { start: 0, end: 1 }), { code: 'context_busy' });
  controller.abort(new DOMException('student cancelled', 'AbortError'));
  await assert.rejects(work, { name: 'AbortError' }); assertClean(f);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(api.extractWindow(f.original, { start: 0, end: 1, signal: cancelled.signal }), { name: 'AbortError' });
  assertClean(f);
});

test('visibility change, media replacement and generation change invalidate work without a partial result', async () => {
  const f = fixture({ beforeSeeked: ({ document }) => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); } });
  await assert.rejects(api.extractWindow(f.original, { start: 1, end: 3 }), { code: 'context_hidden' });
  assert.equal(f.draws.length, 0); assertClean(f);
  const changed = fixture({ beforeSeeked: ({ original }) => { original.currentSrc = 'blob:http://localhost:4174/new-file'; } });
  await assert.rejects(api.extractWindow(changed.original, { start: 1, end: 3 }), { code: 'context_cancelled' });
  assert.equal(changed.draws.length, 0); assertClean(changed);
  const stale = fixture();
  await assert.rejects(api.extractWindow(stale.original, { start: 1, end: 3, isCurrent: () => false }), { code: 'context_cancelled' });
  assertClean(stale);
});

test('decode failure rejects without seeking the student video and cleans listeners/media buffers', async () => {
  const f = fixture({ holdMetadata: true });
  const work = api.extractWindow(f.original, { start: 0, end: 3 });
  f.decoder.dispatchEvent(new Event('error'));
  await assert.rejects(work, { code: 'decode_failed' }); assertClean(f); assert.equal(f.original.currentTime, 7);
});
