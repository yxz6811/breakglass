// 开播前阅读接线：用假 DOM 驱动真实 main.js。阅读请求是测试替身，不连网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

const ENDPOINT = 'local-reader/lesson';
const PREPARED = '../assets/video/breakglass-demo-9s.mp4';

/**
 * 这次阅读里的一处。曲线和包内示例同一套参数，只换视频编号和时间。
 * @param {string} videoId
 * @param {number} time
 * @param {string} id
 * @param {{ frameSize?: { width: number, height: number } }} [overrides]
 * @returns {object}
 */
function lessonPoint(videoId, time, id, overrides) {
  const extra = overrides || {};
  return {
    id,
    time,
    lessonLine: id + ' 这一处的课。',
    curve: {
      requestId: 'lesson-' + id,
      videoId,
      time,
      frameSize: extra.frameSize || { width: 1920, height: 1080 },
      source: 'preset',
      fallback: null,
      definition: {
        equationId: 'fixture.parabola',
        parameters: {
          a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
          h: { initial: 0, min: -2, max: 2, step: 0.1 },
          k: { initial: 0, min: -2, max: 2, step: 0.1 }
        },
        dragParameter: 'h',
        domain: { min: -4, max: 4 },
        range: { min: -4, max: 4 },
        yAxis: 'up',
        region: { x: 480, y: 220, width: 960, height: 620 }
      }
    }
  };
}

/**
 * 选一支别人的片子并等元数据到位。阅读请求交给 respond；不给就一直挂着。
 * @param {Awaited<ReturnType<typeof createHarness>>} harness
 * @param {{ endpoint?: string, note?: string, duration?: number, time?: number, playing?: boolean, respond?: (init: object) => Promise<object>, beforeLoad?: Function }} [options]
 * @returns {Promise<{ calls: { url: string, init: object }[] }>}
 */
async function openForeign(harness, options = {}) {
  const endpoint = options.endpoint === undefined ? ENDPOINT : options.endpoint;
  const calls = [];
  const base = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (endpoint && String(url) === endpoint) {
      calls.push({ url: String(url), init });
      return options.respond ? options.respond(init) : new Promise(() => {});
    }
    return base(url, init);
  };
  harness.win.__breakglassLessonFrames = options.frames || ((times) => times.map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' })));
  const { elements, video } = harness;
  elements['lesson-endpoint'].value = endpoint;
  elements['lesson-note'].value = options.note || '';
  elements['local-video'].files = [new Blob(['video'], { type: 'video/mp4' })];
  elements['local-video'].dispatch('change');
  video.duration = options.duration || 12;
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.paused = !options.playing;
  video.currentTime = options.time || 0;
  if (options.beforeLoad) options.beforeLoad();
  video.dispatch('loadedmetadata');
  await flush();
  await flush();
  await flush();
  return { calls };
}

/**
 * @param {Awaited<ReturnType<typeof createHarness>>} harness
 * @returns {string}
 */
function status(harness) {
  return harness.elements['lesson-status'].textContent;
}

test('9 秒片照旧走单点示例，不进入阅读', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    video.src = PREPARED;
    video.duration = 9;
    harness.ready();
    await flush();
    assert.equal(win.__breakglassLesson.binding(), null);
    assert.equal(elements['lesson-next'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
  } finally {
    harness.restore();
  }
});

test('别人的片子：隐藏采样后发一次请求，舞台时间不动，第一处到之前不能破壁', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    const mountsBefore = win.__breakglassWakeMounts;
    const seeks = [];
    let recording = false;
    video.addEventListener('seeked', () => { if (recording) seeks.push(video.currentTime); });
    const { calls } = await openForeign(harness, { time: 6, beforeLoad: () => { recording = true; } });
    const binding = win.__breakglassLesson.binding();
    assert.equal(binding.phase, 'reading');
    assert.equal(binding.duration, 12);
    assert.equal(calls.length, 1);
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['courseText', 'duration', 'frameSize', 'frames', 'readingId', 'videoId']);
    assert.deepEqual(sent.frameSize, { width: 1920, height: 1080 });
    assert.equal(sent.readingId, binding.readingId);
    assert.equal(sent.videoId, binding.videoId);
    assert.equal(sent.frames.length, 8);
    assert.deepEqual(seeks, [], '采样不能拖动舞台上的片子');
    assert.equal(video.currentTime, 6);
    assert.equal(win.__breakglassWakeMounts, mountsBefore);
    assert.equal(elements['wake-button'].disabled, false, '有效暂停帧可主动识别，不能沿用包内曲线');
    assert.equal(harness.overlay(), null);
    assert.match(elements['state-label'].textContent, /暂停帧|识别/);
    assert.equal(status(harness).includes('这次没有课程文本。'), true);
    assert.equal(elements['lesson-cancel'].hidden, false);
  } finally {
    harness.restore();
  }
});

test('第一处通过就暂停并定位，停稳后才用这一处的曲线重建唤醒', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness, { playing: true });
    const binding = win.__breakglassLesson.binding();
    const mountsBefore = win.__breakglassWakeMounts;
    video.holdSeeks = true;
    const offered = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 3.75, 'p4'));
    assert.equal(offered.ok, true);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 3.75);
    assert.equal(win.__breakglassWakeMounts, mountsBefore, '定位没停稳之前不换曲线');
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['lesson-next'].disabled, true);
    harness.document.dispatch('keydown', { key: 'b', altKey: true });
    assert.equal(harness.overlay(), null);
    assert.equal(elements['state-label'].textContent, '正在定位，停稳后才能破壁。');
    harness.finishSeek();
    assert.equal(win.__breakglassWakeMounts, mountsBefore + 1);
    assert.equal(elements['wake-button'].disabled, false);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    assert.equal(elements['source-label'].textContent, '这次阅读');
    assert.equal(elements['source-note'].textContent, '这一帧在阅读时已经算好。');
    assert.equal(elements['source-note'].textContent.includes('识别结果'), false);
    assert.equal(elements['source-label'].textContent.includes('识别结果'), false);
  } finally {
    harness.restore();
  }
});

test('阅读点的系数超出页面初始滑块范围时，滑块按这一处的范围走', async () => {
  const harness = await createHarness();
  try {
    const { elements, win } = harness;
    await openForeign(harness);
    const binding = win.__breakglassLesson.binding();
    const point = lessonPoint(binding.videoId, 3.75, 'p4');
    point.curve.definition.parameters = {
      a: { initial: -1, min: -1.5, max: -0.5, step: 0.1 },
      h: { initial: 3, min: 1, max: 5, step: 0.1 },
      k: { initial: -0.5, min: -2.5, max: 1.5, step: 0.1 }
    };
    point.curve.definition.domain = { min: 0, max: 6 };
    assert.equal(win.__breakglassLesson.offer(point).ok, true);
    harness.finishSeek();
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    const a = elements['parameter-a'];
    const h = elements['parameter-h'];
    assert.deepEqual([a.min, a.max, a.step, a.value], ['-1.5', '-0.5', '0.1', '-1']);
    assert.deepEqual([h.min, h.max, h.value], ['1', '5', '3']);
    assert.equal(elements['parameter-k'].min, '-2.5');
    assert.equal(elements['parameter-a-value'].textContent, '-1.0');
  } finally {
    harness.restore();
  }
});

test('尺寸对不上的点直接丢掉：时间、覆盖层和唤醒都不动', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness, { time: 1 });
    const binding = win.__breakglassLesson.binding();
    const mountsBefore = win.__breakglassWakeMounts;
    const small = { frameSize: { width: 1280, height: 720 } };
    const early = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 3.75, 'small-1', small));
    assert.equal(early.ok, false);
    assert.equal(early.reason, '抛物线没有通过检查');
    assert.equal(video.currentTime, 1);
    assert.equal(win.__breakglassWakeMounts, mountsBefore);
    assert.equal(elements['wake-button'].disabled, false, '坏阅读点不会妨碍重新识别有效暂停帧');
    assert.equal(status(harness).includes('丢掉一处：抛物线没有通过检查。'), true);

    win.__breakglassLesson.offer(lessonPoint(binding.videoId, 5.25, 'p5'));
    elements['wake-button'].dispatch('click');
    const shown = harness.overlay();
    assert.ok(shown);
    const mountsShown = win.__breakglassWakeMounts;
    const late = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 9.75, 'small-2', small));
    assert.equal(late.ok, false);
    assert.equal(harness.overlay(), shown);
    assert.equal(video.currentTime, 5.25);
    assert.equal(win.__breakglassWakeMounts, mountsShown);
    const foreign = win.__breakglassLesson.offer(lessonPoint('fixture-parabola', 10, 'other'));
    assert.equal(foreign.reason, '不是这一段视频');
    assert.deepEqual(win.__breakglassLesson.dropped().map((item) => item.reason), ['抛物线没有通过检查', '抛物线没有通过检查', '不是这一段视频']);
    assert.deepEqual(win.__breakglassLesson.points().map((item) => item.id), ['p5']);
  } finally {
    harness.restore();
  }
});

test('下一个：还在读就留在原地，有更晚的点就先卸下曲线再过去，读完没有下一处就禁用', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness);
    const lesson = win.__breakglassLesson;
    const binding = lesson.binding();
    lesson.offer(lessonPoint(binding.videoId, 3.75, 'p4'));
    elements['wake-button'].dispatch('click');
    const first = harness.overlay();
    assert.ok(first);
    const mountsAtFirst = win.__breakglassWakeMounts;

    assert.equal(elements['lesson-next'].disabled, false);
    elements['lesson-next'].dispatch('click');
    assert.equal(status(harness).includes('下一处还在读。'), true);
    assert.equal(video.currentTime, 3.75);
    assert.equal(harness.overlay(), first, '还在读时不重算，也不换曲线');
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst);

    lesson.offer(lessonPoint(binding.videoId, 8.25, 'p8'));
    lesson.offer(lessonPoint(binding.videoId, 2.25, 'p2'));
    assert.equal(video.currentTime, 3.75, '后到的点只入库');
    assert.equal(harness.overlay(), first);
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst);
    assert.deepEqual(lesson.points().map((item) => item.time), [2.25, 3.75, 8.25]);

    video.holdSeeks = true;
    elements['lesson-next'].dispatch('click');
    assert.equal(harness.overlay(), null, '先卸下当前曲线');
    assert.equal(video.currentTime, 8.25);
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['lesson-next'].disabled, true);
    harness.finishSeek();
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst + 1);
    assert.deepEqual(lesson.jumps(), [{ before: 3.75, after: 8.25, wakeDisabled: true }]);
    assert.equal(elements['wake-button'].disabled, false);

    lesson.finish();
    assert.equal(lesson.binding().phase, 'ready');
    assert.equal(elements['lesson-next'].disabled, true);
    assert.equal(status(harness).includes('没有下一处。'), true);
    elements['lesson-next'].dispatch('click');
    assert.equal(video.currentTime, 8.25);
    assert.equal(lesson.jumps().length, 1);
  } finally {
    harness.restore();
  }
});

test('回包里先到的点先停；更早的后到点只入库，读完后没有下一处', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness, {
      respond: (init) => {
        const sent = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            readingId: sent.readingId,
            videoId: sent.videoId,
            origin: 'external',
            duration: sent.duration,
            points: [lessonPoint(sent.videoId, 6.75, 'p6'), lessonPoint(sent.videoId, 2.25, 'p3')]
          })
        });
      }
    });
    await flush();
    const lesson = win.__breakglassLesson;
    assert.equal(video.currentTime, 6.75);
    assert.deepEqual(lesson.points().map((item) => item.id), ['p3', 'p6']);
    assert.equal(lesson.binding().phase, 'ready');
    assert.equal(elements['lesson-next'].disabled, true);
    assert.equal(status(harness).includes('读完了，共 2 处。'), true);
  } finally {
    harness.restore();
  }
});

test('空白地址：不发请求，用户选的片子留在画面上', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    const { calls } = await openForeign(harness, { endpoint: '' });
    assert.equal(calls.length, 0);
    assert.match(String(video.src), /^blob:/);
    assert.equal(video.getAttribute('data-video-id'), null);
    assert.equal(win.__breakglassLesson.binding(), null);
    assert.deepEqual(win.__breakglassLesson.points(), []);
    assert.equal(status(harness), '还没开始看。填上阅读地址后，这支片子会被看。');
    assert.equal(elements['stage-banner'].dataset.mode, 'need-address');
    assert.equal(elements['stage-banner-title'].textContent, '填入本机阅读地址');
    assert.equal(elements['lesson-endpoint'].classList.contains('is-needed'), true);
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
    elements['preset-video'].dispatch('click');
    await flush();
    assert.equal(String(video.src), PREPARED);
  } finally {
    harness.restore();
  }
});

test('片子已经选中后再填阅读地址，会开始看', async () => {
  const harness = await createHarness();
  try {
    const { elements } = harness;
    await openForeign(harness, { endpoint: '' });
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (String(url) === ENDPOINT) {
        calls.push({ url: String(url), init });
        return new Promise(() => {});
      }
      return previous(url, init);
    };
    elements['lesson-endpoint'].value = ENDPOINT;
    elements['lesson-endpoint'].dispatch('change');
    await flush();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(elements['stage-banner'].hidden, false);
    assert.equal(elements['stage-banner'].dataset.mode, 'looking');
    assert.equal(elements['stage-banner-title'].textContent, 'AI 正在看这段画面');
    assert.equal(elements['lesson-endpoint'].classList.contains('is-needed'), false);
    assert.match(status(harness), /正在读这段视频/);
  } finally {
    harness.restore();
  }
});

test('这次浏览里填过的地址会补回，再选片子直接开始看', async () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); }
  };
  const first = await createHarness();
  try {
    first.elements['lesson-endpoint'].value = ENDPOINT;
    first.elements['lesson-endpoint'].dispatch('change');
    assert.equal(store.get('breakglass.lessonEndpoint'), ENDPOINT);
  } finally {
    first.restore();
  }
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    assert.equal(elements['lesson-endpoint'].value, ENDPOINT);
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (String(url) === ENDPOINT) {
        calls.push({ url: String(url), init });
        return new Promise(() => {});
      }
      return previous(url, init);
    };
    harness.win.__breakglassLessonFrames = (times) => times.map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' }));
    elements['local-video'].files = [new Blob(['video'], { type: 'video/mp4' })];
    elements['local-video'].dispatch('change');
    video.duration = 12;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.dispatch('loadedmetadata');
    await flush();
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(elements['stage-banner-title'].textContent, 'AI 正在看这段画面');
  } finally {
    delete globalThis.sessionStorage;
    harness.restore();
  }
});

test('断网且一处都没有：片子留在画面上', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    const { calls } = await openForeign(harness, { respond: () => Promise.reject(new TypeError('offline')) });
    await flush();
    assert.equal(calls.length, 1);
    assert.match(String(video.src), /^blob:/);
    assert.equal(status(harness), '外部阅读没有返回可用结果。这支片子留在画面上。');
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('5 分钟零通过：片子留在画面上，不换回 9 秒片', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness);
    harness.advance(299999);
    assert.equal(win.__breakglassLesson.binding().phase, 'reading');
    assert.match(String(video.src), /^blob:/);
    harness.advance(1);
    assert.match(String(video.src), /^blob:/);
    assert.equal(status(harness), '这次没读完。这支片子留在画面上。');
    elements['wake-button'].dispatch('click');
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('取消阅读：停下请求，已存的点留着，5 分钟后也不退回', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    const { calls } = await openForeign(harness);
    const lesson = win.__breakglassLesson;
    lesson.offer(lessonPoint(lesson.binding().videoId, 3.75, 'p4'));
    elements['lesson-cancel'].dispatch('click');
    assert.equal(calls[0].init.signal.aborted, true);
    assert.equal(lesson.binding().phase, 'ready');
    assert.equal(elements['lesson-cancel'].hidden, true);
    assert.equal(status(harness).includes('已取消阅读。'), true);
    harness.advance(300000);
    assert.match(String(video.src), /^blob:/);
    assert.deepEqual(lesson.points().map((item) => item.id), ['p4']);
    elements['wake-button'].dispatch('click');
    assert.equal(elements['source-label'].textContent, '这次阅读');
  } finally {
    harness.restore();
  }
});

test('已经存了点之后请求失败，只结束阅读，不退回', async () => {
  const harness = await createHarness();
  try {
    const { video, win } = harness;
    let fail = null;
    await openForeign(harness, { respond: () => new Promise((resolve, reject) => { fail = reject; }) });
    const lesson = win.__breakglassLesson;
    lesson.offer(lessonPoint(lesson.binding().videoId, 3.75, 'p4'));
    fail(new TypeError('offline'));
    await flush();
    await flush();
    assert.equal(lesson.binding().phase, 'ready');
    assert.match(String(video.src), /^blob:/);
    assert.equal(status(harness).includes('外部阅读没有返回可用结果。'), true);
    assert.deepEqual(lesson.points().map((item) => item.id), ['p4']);
  } finally {
    harness.restore();
  }
});

test('课程说明超过 8000 字：不发正文，并在阅读状态里说明', async () => {
  const harness = await createHarness();
  try {
    const { calls } = await openForeign(harness, { note: '课'.repeat(8001) });
    assert.equal(JSON.parse(calls[0].init.body).courseText, '');
    assert.equal(status(harness).includes('请把课程说明缩短到 8000 字以内。'), true);
  } finally {
    harness.restore();
  }
});

test('两组计时分开记，不混进回退、等待或识别；自比对齐不算 2% 已通过', async () => {
  const harness = await createHarness();
  try {
    const { elements, win } = harness;
    await openForeign(harness);
    const lesson = win.__breakglassLesson;
    harness.advance(250);
    lesson.offer(lessonPoint(lesson.binding().videoId, 3.75, 'p4'));
    for (let round = 0; round < 20; round += 1) {
      elements['wake-button'].dispatch('click');
      assert.ok(harness.overlay());
      harness.frame();
      harness.frame();
      harness.document.dispatch('keydown', { key: 'Escape' });
    }
    elements['wake-button'].dispatch('click');
    harness.frame();
    harness.frame();
    const summary = win.__breakglassLatency.summary();
    assert.equal(summary['lesson-first-point'].count, 1);
    assert.equal(summary['lesson-first-point'].max, 250);
    assert.equal(summary['lesson-first-point'].cache, 'hot');
    assert.equal(summary['lesson-wake-frame-ready'].count, 21);
    assert.equal(summary['lesson-wake-frame-ready'].cache, 'hot');
    assert.equal(summary['fallback-visible'], undefined);
    assert.equal(summary['network-wait'], undefined);
    assert.equal(summary['vision-decision'], undefined);
    assert.equal(win.__breakglassAlignment.measured, false);
    assert.equal(win.__breakglassAlignment.maxRatio, null);
    const verdict = lesson.acceptance();
    assert.equal(verdict.wakeVisible.count, 21);
    assert.equal(verdict.wakeVisible.p95 <= 100, true);
    assert.equal(verdict.measured, false);
    assert.equal(verdict.maxRatio, null);
    assert.equal(verdict.passed, false, '没有真实测过对齐，不能算通过');
  } finally {
    harness.restore();
  }
});

test('未发送的帧时间被拒绝，只有请求中的点可以定位和破壁', async () => {
  const harness = await createHarness();
  try {
    const { calls } = await openForeign(harness, { time: 1 });
    const sent = JSON.parse(calls[0].init.body);
    const lesson = harness.win.__breakglassLesson;
    assert.equal(sent.frames.some((frame) => frame.time === 4), false);
    assert.deepEqual(lesson.offer(lessonPoint(sent.videoId, 4, 'unsampled')), { ok: false, reason: '时间无效' });
    assert.equal(harness.video.currentTime, 1);
    assert.equal(harness.overlay(), null);
    assert.deepEqual(lesson.points(), []);
    const time = sent.frames[2].time;
    assert.equal(lesson.offer(lessonPoint(sent.videoId, time, 'sampled')).ok, true);
    assert.equal(harness.video.currentTime, time);
    harness.elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
  } finally { harness.restore(); }
});

test('换片后旧阅读结果不能定位到新视频', async () => {
  const harness = await createHarness();
  try {
    const first = await openForeign(harness);
    const old = JSON.parse(first.calls[0].init.body);
    await openForeign(harness, { time: 1 });
    const lesson = harness.win.__breakglassLesson;
    assert.notEqual(lesson.binding().videoId, old.videoId);
    assert.equal(lesson.offer(lessonPoint(old.videoId, old.frames[0].time, 'old')).ok, false);
    assert.equal(harness.video.currentTime, 1);
    assert.deepEqual(lesson.points(), []);
  } finally { harness.restore(); }
});

test('部分截图失败时按实际发送的两张帧绑定，拒绝计划中未发送的时间', async () => {
  const h = await createHarness();
  try {
    const { calls } = await openForeign(h, { frames: (times) => times.slice(0, 2).map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' })) });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.frames.length, 2);
    assert.equal(h.win.__breakglassLesson.offer(lessonPoint(sent.videoId, 3.75, 'not-sent')).ok, false);
    assert.equal(h.win.__breakglassLesson.offer(lessonPoint(sent.videoId, 2.25, 'sent')).ok, true);
  } finally { h.restore(); }
});

test('小系数初值完整显示，不被滑块步长的格式化舍入成零', async () => {
  const harness = await createHarness();
  try {
    const { calls } = await openForeign(harness);
    const sent = JSON.parse(calls[0].init.body);
    const point = lessonPoint(sent.videoId, sent.frames[0].time, 'tiny');
    point.curve.definition.parameters.a = { initial: 0.00012345, min: 0.00006, max: 0.00019, step: 0.00001 };
    assert.equal(harness.win.__breakglassLesson.offer(point).ok, true);
    harness.elements['wake-button'].dispatch('click');
    assert.equal(harness.elements['parameter-a-value'].textContent, '0.00012345');
  } finally { harness.restore(); }
});

test('画面上分开写明正在看、可以破壁和破壁已打开', async () => {
  const harness = await createHarness();
  try {
    const { elements } = harness;
    assert.equal(elements['stage-banner'].hidden, true);
    harness.ready();
    assert.equal(elements['stage-banner'].dataset.mode, 'ready');
    assert.equal(elements['stage-banner-title'].textContent, '可以破壁');
    assert.match(elements['stage-banner-detail'].textContent, /曲线还没出现/);
    elements['wake-button'].dispatch('click');
    assert.equal(elements['stage-banner'].dataset.mode, 'open');
    assert.equal(elements['stage-banner-title'].textContent, '破壁已打开');
    harness.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(elements['stage-banner'].dataset.mode, 'ready');

    await openForeign(harness);
    assert.equal(elements['stage-banner'].hidden, false);
    assert.equal(elements['stage-banner'].dataset.mode, 'looking');
    assert.equal(elements['stage-banner-title'].textContent, 'AI 正在看这段画面');
    assert.match(elements['stage-banner-detail'].textContent, /破壁还没开始/);
    const binding = harness.win.__breakglassLesson.binding();
    harness.video.holdSeeks = true;
    harness.win.__breakglassLesson.offer(lessonPoint(binding.videoId, 3.75, 'banner'));
    assert.equal(elements['stage-banner'].dataset.mode, 'seeking');
    assert.equal(elements['stage-banner-title'].textContent, '正在停到这一帧');
    harness.finishSeek();
    assert.equal(elements['stage-banner'].dataset.mode, 'ready');
    elements['wake-button'].dispatch('click');
    assert.equal(elements['stage-banner'].dataset.mode, 'open');
    assert.match(elements['stage-banner-detail'].textContent, /这次阅读/);
  } finally {
    harness.restore();
  }
});

test('离开页面取消尚未落定的隐藏采样，迟到截图不能再发阅读请求', async () => {
  const harness = await createHarness();
  let completeFrames;
  try {
    const frames = new Promise((resolve) => { completeFrames = resolve; });
    const { calls } = await openForeign(harness, { frames: () => frames });
    assert.equal(calls.length, 0);
    const binding = harness.win.__breakglassLesson.binding();
    assert.equal(binding.phase, 'reading');
    harness.win.dispatch('pagehide');
    completeFrames([{ time: 0.75, image: 'data:image/jpeg;base64,AA==' }]);
    await flush();
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(harness.win.__breakglassLesson.binding().phase, 'ready');
    harness.advance(300000);
    assert.equal(calls.length, 0);
  } finally { harness.restore(); }
});

test('离开页面清掉阅读地址输入的延迟，不启动已卸载的阅读', async () => {
  const harness = await createHarness();
  try {
    await openForeign(harness, { endpoint: '' });
    const calls = [];
    const base = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (String(url) === ENDPOINT) {
        calls.push({ url: String(url), init });
        return new Promise(() => {});
      }
      return base(url, init);
    };
    harness.elements['lesson-endpoint'].value = ENDPOINT;
    harness.elements['lesson-endpoint'].dispatch('input');
    harness.win.dispatch('pagehide');
    harness.advance(300);
    await flush();
    await flush();
    assert.equal(calls.length, 0);
    assert.equal(harness.win.__breakglassLesson.binding(), null);
  } finally { harness.restore(); }
});
