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
  harness.win.__breakglassLessonFrames = (times) => times.map((time) => ({ time, image: 'data:image/jpeg;base64,AA==' }));
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
 * 模拟退回后 9 秒片的元数据到位并停在 6 秒。
 * @param {Awaited<ReturnType<typeof createHarness>>} harness
 */
function preparedLoaded(harness) {
  const { video } = harness;
  video.duration = 9;
  video.paused = true;
  video.currentTime = 6;
  video.dispatch('loadedmetadata');
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
    assert.deepEqual(Object.keys(sent).sort(), ['courseText', 'duration', 'frames', 'readingId', 'videoId']);
    assert.equal(sent.readingId, binding.readingId);
    assert.equal(sent.videoId, binding.videoId);
    assert.equal(sent.frames.length, 8);
    assert.deepEqual(seeks, [], '采样不能拖动舞台上的片子');
    assert.equal(video.currentTime, 6);
    assert.equal(win.__breakglassWakeMounts, mountsBefore);
    assert.equal(elements['wake-button'].disabled, true, '还没有点时不能把示例曲线画到别人的片子上');
    harness.document.dispatch('keydown', { key: 'b', altKey: true });
    assert.equal(harness.overlay(), null);
    assert.equal(elements['state-label'].textContent, '正在读，第一处读好后会停在那一帧。');
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
    const offered = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 4, 'p4'));
    assert.equal(offered.ok, true);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 4);
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

test('尺寸对不上的点直接丢掉：时间、覆盖层和唤醒都不动', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness, { time: 1 });
    const binding = win.__breakglassLesson.binding();
    const mountsBefore = win.__breakglassWakeMounts;
    const small = { frameSize: { width: 1280, height: 720 } };
    const early = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 4, 'small-1', small));
    assert.equal(early.ok, false);
    assert.equal(early.reason, '抛物线没有通过检查');
    assert.equal(video.currentTime, 1);
    assert.equal(win.__breakglassWakeMounts, mountsBefore);
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(status(harness).includes('丢掉一处：抛物线没有通过检查。'), true);

    win.__breakglassLesson.offer(lessonPoint(binding.videoId, 5, 'p5'));
    elements['wake-button'].dispatch('click');
    const shown = harness.overlay();
    assert.ok(shown);
    const mountsShown = win.__breakglassWakeMounts;
    const late = win.__breakglassLesson.offer(lessonPoint(binding.videoId, 9, 'small-2', small));
    assert.equal(late.ok, false);
    assert.equal(harness.overlay(), shown);
    assert.equal(video.currentTime, 5);
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
    lesson.offer(lessonPoint(binding.videoId, 4, 'p4'));
    elements['wake-button'].dispatch('click');
    const first = harness.overlay();
    assert.ok(first);
    const mountsAtFirst = win.__breakglassWakeMounts;

    assert.equal(elements['lesson-next'].disabled, false);
    elements['lesson-next'].dispatch('click');
    assert.equal(status(harness).includes('下一处还在读。'), true);
    assert.equal(video.currentTime, 4);
    assert.equal(harness.overlay(), first, '还在读时不重算，也不换曲线');
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst);

    lesson.offer(lessonPoint(binding.videoId, 8, 'p8'));
    lesson.offer(lessonPoint(binding.videoId, 2, 'p2'));
    assert.equal(video.currentTime, 4, '后到的点只入库');
    assert.equal(harness.overlay(), first);
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst);
    assert.deepEqual(lesson.points().map((item) => item.time), [2, 4, 8]);

    video.holdSeeks = true;
    elements['lesson-next'].dispatch('click');
    assert.equal(harness.overlay(), null, '先卸下当前曲线');
    assert.equal(video.currentTime, 8);
    assert.equal(elements['wake-button'].disabled, true);
    assert.equal(elements['lesson-next'].disabled, true);
    harness.finishSeek();
    assert.equal(win.__breakglassWakeMounts, mountsAtFirst + 1);
    assert.deepEqual(lesson.jumps(), [{ before: 4, after: 8, wakeDisabled: true }]);
    assert.equal(elements['wake-button'].disabled, false);

    lesson.finish();
    assert.equal(lesson.binding().phase, 'ready');
    assert.equal(elements['lesson-next'].disabled, true);
    assert.equal(status(harness).includes('没有下一处。'), true);
    elements['lesson-next'].dispatch('click');
    assert.equal(video.currentTime, 8);
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
            points: [lessonPoint(sent.videoId, 6, 'p6'), lessonPoint(sent.videoId, 3, 'p3')]
          })
        });
      }
    });
    await flush();
    const lesson = win.__breakglassLesson;
    assert.equal(video.currentTime, 6);
    assert.deepEqual(lesson.points().map((item) => item.id), ['p3', 'p6']);
    assert.equal(lesson.binding().phase, 'ready');
    assert.equal(elements['lesson-next'].disabled, true);
    assert.equal(status(harness).includes('读完了，共 2 处。'), true);
  } finally {
    harness.restore();
  }
});

test('空白地址：不发请求，立刻回到 9 秒片并恢复单点示例', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    const { calls } = await openForeign(harness, { endpoint: '' });
    assert.equal(calls.length, 0);
    assert.equal(String(video.src), PREPARED);
    assert.equal(video.getAttribute('data-video-id'), 'fixture-parabola');
    assert.equal(win.__breakglassLesson.binding(), null);
    assert.deepEqual(win.__breakglassLesson.points(), []);
    assert.equal(status(harness), '外部阅读没有返回可用结果。已回到预先准备的片子。');
    preparedLoaded(harness);
    elements['wake-button'].dispatch('click');
    assert.ok(harness.overlay());
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
  } finally {
    harness.restore();
  }
});

test('断网且一处都没有：回到 9 秒片', async () => {
  const harness = await createHarness();
  try {
    const { elements, video } = harness;
    const { calls } = await openForeign(harness, { respond: () => Promise.reject(new TypeError('offline')) });
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(String(video.src), PREPARED);
    assert.equal(status(harness).includes('已回到预先准备的片子。'), true);
    preparedLoaded(harness);
    elements['wake-button'].dispatch('click');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
  } finally {
    harness.restore();
  }
});

test('5 分钟零通过：回到 9 秒片；那支片子也加载失败时如实说', async () => {
  const harness = await createHarness();
  try {
    const { elements, video, win } = harness;
    await openForeign(harness);
    harness.advance(299999);
    assert.equal(win.__breakglassLesson.binding().phase, 'reading');
    assert.match(String(video.src), /^blob:/);
    harness.advance(1);
    assert.equal(String(video.src), PREPARED);
    assert.equal(status(harness), '这次没读完。已回到预先准备的片子。');
    preparedLoaded(harness);
    elements['wake-button'].dispatch('click');
    assert.equal(elements['source-label'].textContent, '预先准备的示例');
    video.dispatch('error');
    assert.equal(status(harness), '这次没读完。预先准备的片子没有加载出来。');
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
    lesson.offer(lessonPoint(lesson.binding().videoId, 4, 'p4'));
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
    lesson.offer(lessonPoint(lesson.binding().videoId, 4, 'p4'));
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
    lesson.offer(lessonPoint(lesson.binding().videoId, 4, 'p4'));
    for (let round = 0; round < 20; round += 1) {
      elements['wake-button'].dispatch('click');
      assert.ok(harness.overlay());
      harness.document.dispatch('keydown', { key: 'Escape' });
    }
    elements['wake-button'].dispatch('click');
    const summary = win.__breakglassLatency.summary();
    assert.equal(summary['lesson-first-point'].count, 1);
    assert.equal(summary['lesson-first-point'].max, 250);
    assert.equal(summary['lesson-first-point'].cache, 'hot');
    assert.equal(summary['lesson-wake-visible'].count, 21);
    assert.equal(summary['lesson-wake-visible'].cache, 'hot');
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
