// The real page and current-frame adapter run here; DOM, media encoding and HTTP are controlled doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page');

const READER = 'http://127.0.0.1:8787/read';
const settle = async () => { await flush(); await flush(); };
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
function resultFor(call) {
  const body = JSON.parse(call.init.body), time = body.frames[0].time, id = 'current-point';
  return {
    readingId: body.readingId, videoId: body.videoId, duration: body.duration, origin: 'external', dropped: [],
    points: [{ id, time, lessonLine: '这一帧的抛物线可以改变参数。', curve: {
      requestId: body.readingId + ':' + id, videoId: body.videoId, time,
      frameSize: { ...body.frameSize }, source: 'preset', fallback: null,
      definition: {
        equationId: 'fixture.parabola',
        parameters: {
          a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
          h: { initial: 0, min: -2, max: 2, step: 0.1 },
          k: { initial: 0, min: -2, max: 2, step: 0.1 }
        },
        dragParameter: 'h', domain: { min: -4, max: 4 }, range: { min: -4, max: 4 }, yAxis: 'up',
        region: { x: 480, y: 220, width: 960, height: 620 }
      }
    } }]
  };
}
function interceptReader(h) {
  const calls = [], base = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (init?.method === 'POST') {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const call = { url: String(url), init, resolve, reject };
      calls.push(call); return promise;
    }
    return base(url, init);
  };
  return calls;
}
async function openPaused(h, { time = 10.75, endpoint = READER } = {}) {
  h.elements['lesson-endpoint'].value = '';
  h.elements['local-video'].files = [new Blob(['own video'], { type: 'video/mp4' })];
  h.elements['local-video'].dispatch('change');
  Object.assign(h.video, { duration: 14, videoWidth: 1920, videoHeight: 1080, paused: true, seeking: false, readyState: 2 });
  h.video.currentTime = time; h.video.dispatch('loadedmetadata'); h.video.dispatch('loadeddata'); h.video.dispatch('pause');
  await settle();
  // Set the address without a change event: no automatic lesson pre-reading is requested by this setup.
  h.elements['lesson-endpoint'].value = endpoint;
  h.win.__breakglassLessonFrames = () => { throw new Error('current-frame reading must not use the lesson sampling hook'); };
}
async function wake(h, shortcut = false) {
  if (shortcut) h.document.dispatch('keydown', { key: 'b', altKey: true, target: h.stage });
  else h.elements['wake-button'].dispatch('click');
  await settle();
}
function pageText(h) {
  return ['state-label', 'lesson-status', 'source-note', 'stage-banner-title', 'stage-banner-detail']
    .map((id) => h.elements[id].textContent).join('\n');
}
function singleRead(calls) { return calls.filter((call) => JSON.parse(call.init.body).frames?.length === 1); }

test('click and Alt+B read one actual paused frame at any legal time and automatically open its curve', async () => {
  for (const enableLocalMock of [true, false]) for (const time of [0, 2.25, 10.75]) for (const shortcut of [false, true]) {
    const h = await createHarness({ config: { enableLocalMock } });
    try {
      const calls = interceptReader(h); await openPaused(h, { time });
      const source = h.video.src, mounts = h.win.__breakglassWakeMounts ?? 0;
      assert.equal(h.elements['wake-button'].disabled, false, `${time}, mock=${enableLocalMock}: a paused external frame is actionable`);
      await wake(h, shortcut);
      assert.equal(calls.length, 1);
      const call = calls[0], body = JSON.parse(call.init.body);
      assert.equal(call.url, READER); assert.equal(call.init.method, 'POST');
      assert.equal(body.frames.length, 1); assert.equal(body.frames[0].time, time);
      assert.deepEqual(body.frameSize, { width: 1920, height: 1080 });
      assert.equal(body.duration, 14); assert.notEqual(body.videoId, 'fixture-parabola');
      assert.match(body.frames[0].image, /^data:image\/jpeg;base64,/);
      assert.equal(h.canvasCaptures.length, 1);
      assert.equal(h.canvasCaptures[0].source, h.video, 'the canvas draws the stage video, not a hidden sampler');
      assert.equal(h.canvasCaptures[0].captureTime, time);
      assert.ok(h.canvasCaptures[0].width > 0 && h.canvasCaptures[0].width <= 640);
      assert.equal(h.canvasEncodes[0].type, 'image/jpeg');
      assert.equal(h.video.currentTime, time); assert.equal(h.video.src, source); assert.equal(h.overlay(), null);
      await wake(h, !shortcut); assert.equal(calls.length, 1, 'a second gesture does not duplicate the pending read');
      call.resolve(response(resultFor(call))); await settle();
      assert.ok(h.overlay(), 'the validated response opens the overlay without a second wake gesture');
      assert.equal(h.win.__breakglassWakeMounts, mounts + 1);
      assert.equal(h.video.currentTime, time); assert.equal(h.video.src, source);
      assert.match(h.elements['source-label'].textContent, /当前帧识别/);
      assert.equal(h.elements['source-note'].textContent.includes('随演示打包'), false);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('a paused own video with no reader address prompts for configuration without capturing or uploading', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h, { endpoint: '' });
    const source = h.video.src;
    assert.equal(h.elements['wake-button'].disabled, false, 'the button can explain the missing address');
    await wake(h); await wake(h, true);
    assert.equal(calls.length, 0); assert.equal(h.canvasCaptures.length, 0); assert.equal(h.overlay(), null);
    assert.equal(h.video.src, source); assert.equal(h.video.currentTime, 10.75);
    assert.match(pageText(h), /地址|reader/i);
    h.advance(30000); await settle();
    assert.equal(calls.length, 0); assert.equal(h.video.src, source);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('an exact cached current curve wakes again without reading, while seeking to another frame requires a fresh capture', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h); await wake(h);
    calls[0].resolve(response(resultFor(calls[0]))); await settle(); assert.ok(h.overlay());
    const captures = h.canvasCaptures.length;
    h.elements['exit-button'].dispatch('click'); await settle(); assert.equal(h.overlay(), null);
    await wake(h);
    assert.ok(h.overlay()); assert.equal(calls.length, 1); assert.equal(h.canvasCaptures.length, captures);
    h.video.seeking = true; h.video.dispatch('seeking');
    h.video.currentTime = 11.5; h.video.seeking = false; h.video.dispatch('seeked'); h.video.dispatch('timeupdate');
    await wake(h);
    assert.equal(calls.length, 2); assert.equal(h.overlay(), null);
    assert.equal(JSON.parse(calls[1].init.body).frames[0].time, 11.5);
    assert.equal(h.canvasCaptures.at(-1).captureTime, 11.5);
    calls[1].resolve(response(resultFor(calls[1]))); await settle(); assert.ok(h.overlay());
    assert.equal(h.video.currentTime, 11.5);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('explicit current-frame reading stops pre-reading and late lesson points cannot move or replace its frame', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h);
    h.elements['lesson-endpoint'].value = READER;
    h.win.__breakglassLessonFrames = (times) => times.map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' }));
    h.elements['local-video'].files = [new Blob(['own video'], { type: 'video/mp4' })]; h.elements['local-video'].dispatch('change');
    Object.assign(h.video, { duration: 14, videoWidth: 1920, videoHeight: 1080, readyState: 2, paused: true });
    h.video.currentTime = 11.25; h.video.dispatch('loadedmetadata'); await settle();
    assert.equal(calls.length, 1); assert.ok(JSON.parse(calls[0].init.body).frames.length > 1);
    const lesson = calls[0], mounts = h.win.__breakglassWakeMounts;
    await wake(h);
    assert.equal(lesson.init.signal.aborted, true, 'the competing lesson request is canceled first');
    assert.equal(calls.length, 2); assert.equal(singleRead(calls).length, 1);
    const current = calls[1]; assert.equal(JSON.parse(current.init.body).frames[0].time, 11.25);
    lesson.resolve(response(resultFor(lesson))); await settle();
    assert.equal(h.video.currentTime, 11.25); assert.equal(h.overlay(), null); assert.equal(h.win.__breakglassWakeMounts, mounts);
    current.resolve(response(resultFor(current))); await settle();
    assert.ok(h.overlay()); assert.equal(h.video.currentTime, 11.25); assert.equal(h.win.__breakglassWakeMounts, mounts + 1);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('network, service and no-curve failures keep the own video and retry captures its current paused frame', async () => {
  for (const failure of ['network', 'service', 'empty']) {
    const h = await createHarness();
    try {
      const calls = interceptReader(h); await openPaused(h); const source = h.video.src;
      await wake(h); assert.equal(calls.length, 1);
      if (failure === 'network') calls[0].reject(new TypeError('offline'));
      else if (failure === 'service') calls[0].resolve(response({}, 503));
      else { const payload = resultFor(calls[0]); payload.points = []; calls[0].resolve(response(payload)); }
      await settle(); h.advance(1500); await settle();
      assert.equal(h.overlay(), null); assert.equal(h.video.src, source); assert.equal(h.video.currentTime, 10.75);
      assert.equal(h.elements['retry-button'].hidden, false); assert.equal(h.elements['retry-button'].disabled, false);
      h.video.currentTime = 11.25; h.video.dispatch('timeupdate');
      h.elements['retry-button'].dispatch('click'); await settle();
      assert.equal(calls.length, 2, failure);
      assert.equal(JSON.parse(calls[1].init.body).frames[0].time, 11.25);
      assert.equal(h.canvasCaptures.at(-1).captureTime, 11.25);
      calls[1].resolve(response(resultFor(calls[1]))); await settle();
      assert.ok(h.overlay()); assert.equal(h.video.src, source);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('the independent thirty-second deadline cannot trigger the packaged fifteen-hundred-millisecond fallback', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h); const source = h.video.src;
    await wake(h); assert.equal(calls.length, 1);
    h.advance(1500); await settle();
    assert.equal(calls[0].init.signal.aborted, false); assert.equal(h.overlay(), null); assert.equal(h.video.src, source);
    h.advance(28499); await settle(); assert.equal(calls[0].init.signal.aborted, false);
    h.advance(1); await settle(); assert.equal(calls[0].init.signal.aborted, true);
    assert.equal(h.overlay(), null); assert.equal(h.video.src, source);
    assert.equal(h.elements['retry-button'].hidden, false); assert.equal(h.elements['retry-button'].disabled, false);
    assert.match(pageText(h), /超过 30 秒|超时/);
    calls[0].resolve(response(resultFor(calls[0]))); await settle(); assert.equal(h.overlay(), null);
    assert.equal(calls.length, 1);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('responses with foreign identities, frame data, origin or unsupported curve fields never mount', async () => {
  const mutations = [
    (p) => { p.origin = 'mock'; }, (p) => { p.readingId = 'other-read'; },
    (p) => { p.points[0].curve.videoId = 'other-video'; }, (p) => { p.points[0].time += 1; p.points[0].curve.time += 1; },
    (p) => { p.points[0].curve.frameSize.width = 1280; },
    (p) => { p.points[0].curve.definition.parameters.a.initial = Infinity; },
    (p) => { p.points[0].curve.fallback = 'timeout'; }, (p) => { p.points.push(structuredClone(p.points[0])); }
  ];
  for (const mutate of mutations) {
    const h = await createHarness();
    try {
      const calls = interceptReader(h); await openPaused(h); const source = h.video.src, mounts = h.win.__breakglassWakeMounts;
      await wake(h); assert.equal(calls.length, 1);
      const payload = resultFor(calls[0]); mutate(payload); calls[0].resolve(response(payload)); await settle();
      assert.equal(h.overlay(), null); assert.equal(h.win.__breakglassWakeMounts, mounts);
      assert.equal(h.video.src, source); assert.equal(h.video.currentTime, 10.75);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('undecoded, playing, seeking or invalid source frames cannot draw a canvas or make a read request', async () => {
  for (const invalid of [
    { readyState: 0 }, { readyState: 1 }, { paused: false }, { seeking: true },
    { currentTime: -1 }, { currentTime: NaN }, { currentTime: 15 },
    { videoWidth: 0 }, { videoHeight: 0 }, { videoWidth: Infinity }, { duration: Infinity }
  ]) {
    const h = await createHarness();
    try {
      const calls = interceptReader(h); await openPaused(h); Object.assign(h.video, invalid); h.video.dispatch('timeupdate');
      await wake(h); await wake(h, true);
      assert.equal(calls.length, 0, JSON.stringify(invalid)); assert.equal(h.canvasCaptures.length, 0);
      assert.equal(h.overlay(), null);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('cancel, Escape and exit abort current-frame work and a late response cannot open an overlay', async () => {
  for (const action of ['cancel', 'escape', 'exit']) {
    const h = await createHarness();
    try {
      const calls = interceptReader(h); await openPaused(h); await wake(h); assert.equal(calls.length, 1);
      const mounts = h.win.__breakglassWakeMounts, source = h.video.src;
      if (action === 'escape') h.document.dispatch('keydown', { key: 'Escape', target: h.stage });
      else {
        const button = h.elements[action === 'cancel' ? 'cancel-button' : 'exit-button'];
        assert.equal(button.disabled, false); button.dispatch('click');
      }
      await settle(); assert.equal(calls[0].init.signal.aborted, true, action);
      calls[0].resolve(response(resultFor(calls[0]))); await settle();
      assert.equal(h.overlay(), null); assert.equal(h.win.__breakglassWakeMounts, mounts);
      assert.equal(h.video.src, source); assert.equal(h.video.currentTime, 10.75);
      assert.equal(calls.length, 1);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('media, source, address and lifecycle changes retire current-frame reads before any late reply', async () => {
  for (const event of ['play', 'seeking', 'error', 'resize', 'time', 'file', 'address', 'pagehide']) {
    const h = await createHarness();
    try {
      const calls = interceptReader(h); await openPaused(h); await wake(h); assert.equal(calls.length, 1);
      const current = calls[0], mounts = h.win.__breakglassWakeMounts;
      if (event === 'play') { h.video.paused = false; h.video.dispatch('play'); }
      else if (event === 'seeking') { h.video.seeking = true; h.video.dispatch('seeking'); }
      else if (event === 'resize') { h.video.videoWidth = 1280; h.video.dispatch('resize'); }
      else if (event === 'time') { h.video.currentTime = 11.5; h.video.dispatch('timeupdate'); }
      else if (event === 'file') {
        h.elements['local-video'].files = [new Blob(['another video'], { type: 'video/mp4' })]; h.elements['local-video'].dispatch('change');
      } else if (event === 'address') {
        h.elements['lesson-endpoint'].value = 'http://127.0.0.1:8788/read'; h.elements['lesson-endpoint'].dispatch('input');
      } else if (event === 'pagehide') h.win.dispatch('pagehide');
      else h.video.dispatch('error');
      await settle(); assert.equal(current.init.signal.aborted, true, event);
      const time = h.video.currentTime, source = h.video.src;
      current.resolve(response(resultFor(current))); await settle();
      assert.equal(h.overlay(), null, event); assert.equal(h.win.__breakglassWakeMounts, mounts, event);
      assert.equal(h.video.currentTime, time, event); assert.equal(h.video.src, source, event);
      assert.equal(singleRead(calls).length, 1, 'invalidating events do not automatically read another current frame');
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('canvas encoding errors never upload a fake image or substitute the packaged demo', async () => {
  for (const canvas of [
    { context: false }, { drawError: new Error('tainted drawing') },
    { encodeError: new Error('tainted canvas') }, { image: 'data:,' }, { image: 'not-a-jpeg' }
  ]) {
    const h = await createHarness({ canvas });
    try {
      const calls = interceptReader(h); await openPaused(h); const source = h.video.src;
      await wake(h); h.advance(30000); await settle();
      assert.equal(calls.length, 0); assert.equal(h.overlay(), null);
      assert.equal(h.video.src, source); assert.equal(h.video.currentTime, 10.75);
    } finally { h.win.dispatch('pagehide'); h.restore(); }
  }
});

test('Alt+B ignores editable targets, extra modifiers and repeated keys while a deliberate shortcut reads once', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h);
    h.elements['state-label'].isContentEditable = true;
    const events = [
      ...['lesson-endpoint', 'tutor-input', 'parameter-h', 'figure-kind', 'state-label']
        .map((id) => ({ key: 'b', altKey: true, target: h.elements[id] })),
      { key: 'b', altKey: true, ctrlKey: true, target: h.stage },
      { key: 'b', altKey: true, metaKey: true, target: h.stage },
      { key: 'b', altKey: true, shiftKey: true, target: h.stage },
      { key: 'b', altKey: true, repeat: true, target: h.stage },
      { key: 'b', altKey: false, target: h.stage }
    ];
    for (const event of events) {
      h.document.dispatch('keydown', event); await settle();
      assert.equal(calls.length, 0, 'typing or another shortcut must not upload a frame');
      assert.equal(h.canvasCaptures.length, 0);
    }
    h.document.dispatch('keydown', { key: 'B', altKey: true, target: h.stage }); await settle();
    assert.equal(calls.length, 1); assert.equal(h.canvasCaptures.length, 1);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('a target beyond the own video duration cannot seek or invalidate its cached curve', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h); await wake(h);
    calls[0].resolve(response(resultFor(calls[0]))); await settle(); assert.ok(h.overlay());
    h.elements['exit-button'].dispatch('click'); await settle();
    const source = h.video.src, time = h.video.currentTime, captures = h.canvasCaptures.length;
    assert.equal(h.elements['jump-target'].disabled, false);
    h.elements['target-time'].value = '15'; h.elements['jump-target'].dispatch('click'); await settle();
    assert.equal(h.video.currentTime, time); assert.equal(h.video.src, source);
    assert.equal(calls.length, 1); assert.equal(h.canvasCaptures.length, captures);
    await wake(h); assert.ok(h.overlay(), 'invalid seeking must retain the exact cached curve');
    assert.equal(calls.length, 1);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('a successful current-frame read keeps already accepted later lesson points usable through next', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h);
    h.elements['lesson-endpoint'].value = READER;
    h.win.__breakglassLessonFrames = (times) => times.map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' }));
    h.elements['local-video'].files = [new Blob(['own video'], { type: 'video/mp4' })]; h.elements['local-video'].dispatch('change');
    Object.assign(h.video, { duration: 14, videoWidth: 1920, videoHeight: 1080, readyState: 2, paused: true });
    h.video.currentTime = 0; h.video.dispatch('loadedmetadata'); await settle();
    assert.equal(calls.length, 1);
    const request = JSON.parse(calls[0].init.body), payload = resultFor(calls[0]);
    const first = payload.points[0], middle = structuredClone(first), later = structuredClone(first);
    first.id = 'early'; first.lessonLine = '较早的缓存曲线。'; first.time = request.frames[1].time;
    first.curve.time = first.time; first.curve.requestId = request.readingId + ':early';
    middle.id = 'middle'; middle.lessonLine = '已经看过的中间缓存曲线。'; middle.time = request.frames[3].time;
    middle.curve.time = middle.time; middle.curve.requestId = request.readingId + ':middle';
    later.id = 'later'; later.lessonLine = '较晚的缓存曲线。'; later.time = request.frames.at(-1).time;
    later.curve.time = later.time; later.curve.requestId = request.readingId + ':later';
    payload.points = [first, middle, later]; calls[0].resolve(response(payload)); await settle();
    assert.equal(middle.time, 6.125); assert.equal(later.time, 13.125);
    assert.equal(h.win.__breakglassLesson.points().length, 3);
    h.video.seeking = true; h.video.dispatch('seeking'); h.video.currentTime = 10.75;
    h.video.seeking = false; h.video.dispatch('seeked'); h.video.dispatch('timeupdate');
    await wake(h); assert.equal(calls.length, 2);
    calls[1].resolve(response(resultFor(calls[1]))); await settle(); assert.ok(h.overlay());
    assert.equal(h.elements['lesson-next'].disabled, false, 'accepted later points remain available after the single-frame read');
    h.elements['lesson-next'].dispatch('click'); await settle(); h.finishSeek(); await settle();
    assert.equal(h.video.currentTime, later.time, 'next advances from the current 10.75-second frame, skipping the earlier 6.125-second point');
    assert.equal(h.overlay(), null);
    await wake(h); assert.ok(h.overlay());
    assert.equal(calls.length, 2, 'opening the accepted lesson point does not upload another current frame');
    assert.equal(h.elements['source-label'].textContent, '这次阅读');
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});

test('a valid explicit jump during a pending read cancels it and a retry reads the newly paused frame', async () => {
  const h = await createHarness();
  try {
    const calls = interceptReader(h); await openPaused(h); await wake(h); assert.equal(calls.length, 1);
    const first = calls[0];
    assert.equal(h.elements['jump-target'].disabled, false, 'recognition does not trap the user at its old frame');
    h.elements['target-time'].value = '11.5'; h.elements['target-time'].dispatch('input');
    h.elements['jump-target'].dispatch('click'); await settle();
    assert.equal(first.init.signal.aborted, true); assert.equal(h.video.currentTime, 11.5); assert.equal(h.video.paused, true);
    first.resolve(response(resultFor(first))); await settle(); assert.equal(h.overlay(), null);
    await wake(h); assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].init.body).frames[0].time, 11.5);
    calls[1].resolve(response(resultFor(calls[1]))); await settle(); assert.ok(h.overlay());
    assert.equal(h.video.currentTime, 11.5);
  } finally { h.win.dispatch('pagehide'); h.restore(); }
});
