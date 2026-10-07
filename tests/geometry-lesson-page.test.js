const test = require('node:test');
const assert = require('node:assert/strict');

require('../extension/src/lesson/reading.js');
require('../extension/src/geometry-lesson/reading.js');
require('../extension/src/geometry-lesson/solve.js');
require('../extension/src/geometry-lesson/session.js');
require('../extension/src/geometry-lesson/view.js');
require('../extension/src/geometry-lesson/request.js');
const { createGeometryLessonPage } = require('../extension/src/page/geometry-lesson.js');

const PRESET_SRC = '../assets/video/geometry/triangle-3-4-5.mp4';

/**
 * @param {number} time
 * @param {string} id
 * @param {object} body
 * @returns {object}
 */
function trianglePoint(time, id, body) {
  return {
    schemaVersion: '1.0.0',
    id,
    readingId: body.readingId,
    videoId: body.videoId,
    time,
    frameSize: { width: body.frameSize.width, height: body.frameSize.height },
    lessonLine: '直角边 3 和 4。',
    kind: 'right-triangle',
    unit: 'cm',
    placement: {
      vertices: {
        A: { x: 100, y: 200 },
        B: { x: 220, y: 200 },
        C: { x: 100, y: 80 }
      }
    },
    given: {
      rightAngleAt: 'A',
      legs: [
        { id: 'AB', from: 'A', to: 'B', length: 3 },
        { id: 'AC', from: 'A', to: 'C', length: 4 }
      ]
    },
    derived: { hypotenuse: { id: 'BC', from: 'B', to: 'C', length: 5 } }
  };
}

/**
 * @returns {Promise<void>}
 */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function settle(times = 12) {
  for (let index = 0; index < times; index += 1) await flush();
}

/**
 * @param {object} [options]
 */
function createHarness(options = {}) {
  const nodes = new Map();
  const documentListeners = new Map();
  /**
   * @param {string} id
   */
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const node = {
      id,
      tagName: id === 'lesson-note' ? 'TEXTAREA' : 'INPUT',
      disabled: false,
      hidden: false,
      value: '',
      textContent: '',
      files: null,
      dataset: {},
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
      addEventListener(type, handler) {
        const list = listeners.get(type) || [];
        list.push(handler);
        listeners.set(type, list);
      },
      removeEventListener(type, handler) {
        const list = (listeners.get(type) || []).filter((item) => item !== handler);
        listeners.set(type, list);
      },
      dispatch(type, event) {
        for (const handler of (listeners.get(type) || []).slice()) {
          handler(Object.assign({ target: node, preventDefault() {} }, event || {}));
        }
      }
    };
    nodes.set(id, node);
    return node;
  }
  for (const id of ['lesson-video', 'source-label', 'lesson-status', 'figure-note', 'derived-value',
    'geometry-overlay', 'wake-button', 'lesson-next', 'reset-button', 'exit-button',
    'parameter-primary', 'parameter-secondary', 'parameter-primary-label', 'parameter-secondary-label',
    'parameter-primary-value', 'parameter-secondary-value', 'local-video', 'preset-video',
    'lesson-cancel', 'lesson-endpoint', 'lesson-note']) element(id);

  const video = element('lesson-video');
  video.tagName = 'VIDEO';
  video.paused = true;
  video.duration = 0;
  video.videoWidth = 0;
  video.videoHeight = 0;
  video.src = '';
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get() { return time; },
    set(value) { time = Number(value); }
  });
  video.pause = () => { video.paused = true; };

  const document = {
    activeElement: null,
    getElementById: (id) => nodes.get(id) || null,
    addEventListener(type, handler) {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    removeEventListener(type, handler) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((item) => item !== handler));
    },
    dispatch(type, event) {
      for (const handler of (documentListeners.get(type) || []).slice()) {
        handler(Object.assign({ target: document, preventDefault() {} }, event || {}));
      }
    }
  };
  const calls = [];
  const timers = [];
  let pending = null;
  const clock = {
    now: () => 0,
    schedule(delay, handler) {
      timers.push({ delay, handler });
      return timers.length;
    },
    clear() {}
  };
  const window = {
    __breakglassGeometryFrames(times) {
      return times.map((item) => ({ time: item, image: 'data:image/jpeg;base64,abc' }));
    }
  };

  const page = createGeometryLessonPage({
    document,
    window,
    clock,
    BreakGlass: global.BreakGlass,
    fetchImpl(url, init) {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (options.mode === 'reject') return Promise.reject(new Error('down'));
      if (options.mode === 'hang' || options.mode === 'manual') {
        return new Promise((resolve) => { pending = resolve; });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => options.payload(body)
      });
    }
  });
  return { page, document, element, video, calls, timers, release: () => pending };
}

/**
 * @param {object} harness
 */
function openOwnVideo(harness) {
  harness.element('lesson-endpoint').value = 'http://127.0.0.1:8787';
  const input = harness.element('local-video');
  input.files = [new Blob(['video'], { type: 'video/mp4' })];
  input.dispatch('change');
  harness.video.duration = 8;
  harness.video.videoWidth = 640;
  harness.video.videoHeight = 360;
  harness.video.dispatch('loadedmetadata');
}

test('暂停本身不发请求；可播放且地址已填后破壁只取已存直角三角形', async () => {
  const times = global.BreakGlass.lesson.sampleTimes(8);
  const harness = createHarness({
    payload(body) {
      return {
        schemaVersion: '1.0.0',
        origin: 'external',
        readingId: body.readingId,
        videoId: body.videoId,
        duration: body.duration,
        points: [trianglePoint(times[0], 'g1', body), trianglePoint(times[2], 'g2', body)]
      };
    }
  });
  harness.video.duration = 8;
  harness.video.videoWidth = 640;
  harness.video.videoHeight = 360;
  harness.video.dispatch('pause');
  await settle();
  assert.equal(harness.calls.length, 0);

  openOwnVideo(harness);
  await settle();
  assert.equal(harness.calls.length, 1);
  const body = harness.calls[0].body;
  assert.equal(body.schemaVersion, '1.0.0');
  assert.equal(body.frames.length, 8);
  assert.equal(Object.hasOwn(body, 'prompt'), false);
  assert.match(harness.calls[0].url, /\/geometry\/lesson$/);
  assert.equal(harness.video.paused, true);
  assert.equal(harness.video.currentTime, times[0]);
  assert.equal(harness.element('wake-button').disabled, true);

  harness.video.dispatch('seeked');
  assert.equal(harness.element('wake-button').disabled, false);
  const before = harness.calls.length;
  harness.element('wake-button').dispatch('click');
  assert.equal(harness.calls.length, before);
  assert.equal(harness.element('source-label').textContent, '这次几何阅读');
  assert.match(harness.element('derived-value').textContent, /斜边 5/);
  harness.element('parameter-primary').value = '6';
  harness.element('parameter-primary').dispatch('input');
  assert.match(harness.element('derived-value').textContent, /直角边 6 与 4，斜边 7\.211/);
  assert.equal(harness.element('parameter-secondary-value').textContent, '4');
  harness.page.dispose();
});

test('下一个只走向更晚的已存点，定位完成前不能破壁，后到的更早点不拉回播放头', async () => {
  const times = global.BreakGlass.lesson.sampleTimes(8);
  const forward = createHarness({
    payload(body) {
      return {
        schemaVersion: '1.0.0',
        origin: 'external',
        readingId: body.readingId,
        videoId: body.videoId,
        duration: body.duration,
        points: [trianglePoint(times[0], 'g1', body), trianglePoint(times[2], 'g2', body)]
      };
    }
  });
  openOwnVideo(forward);
  await settle();
  forward.video.dispatch('seeked');
  forward.element('lesson-next').dispatch('click');
  assert.equal(forward.video.currentTime, times[2]);
  assert.equal(forward.element('wake-button').disabled, true);
  forward.video.dispatch('seeked');
  assert.equal(forward.element('wake-button').disabled, false);
  forward.element('wake-button').dispatch('click');
  assert.equal(forward.element('source-label').textContent, '这次几何阅读');
  forward.page.dispose();

  const rewind = createHarness({
    payload(body) {
      return {
        schemaVersion: '1.0.0',
        origin: 'external',
        readingId: body.readingId,
        videoId: body.videoId,
        duration: body.duration,
        points: [trianglePoint(times[2], 'later', body), trianglePoint(times[0], 'earlier', body)]
      };
    }
  });
  openOwnVideo(rewind);
  await settle();
  rewind.video.dispatch('seeked');
  const stayed = rewind.video.currentTime;
  assert.equal(stayed, times[2]);
  rewind.element('lesson-next').dispatch('click');
  assert.equal(rewind.video.currentTime, stayed);
  assert.equal(rewind.element('lesson-next').disabled, true);
  assert.equal(rewind.element('lesson-next').getAttribute('aria-label'), '没有下一处');
  assert.match(rewind.element('lesson-status').textContent, /没有下一处/);
  rewind.page.dispose();
});

test('失败、空地址和超时留下自己的片子；预设不发阅读请求', async () => {
  const failed = createHarness({ mode: 'reject' });
  openOwnVideo(failed);
  await settle();
  const src = failed.video.src;
  assert.match(src, /^blob:/);
  assert.equal(failed.element('wake-button').disabled, true);
  assert.match(failed.element('lesson-status').textContent, /片子留在画面上/);
  assert.equal(failed.element('source-label').textContent, '等待自己的视频');
  failed.page.dispose();

  const empty = createHarness();
  const input = empty.element('local-video');
  input.files = [new Blob(['video'], { type: 'video/mp4' })];
  input.dispatch('change');
  const emptySrc = empty.video.src;
  empty.video.duration = 8;
  empty.video.videoWidth = 640;
  empty.video.videoHeight = 360;
  empty.video.dispatch('loadedmetadata');
  await settle();
  assert.equal(empty.calls.length, 0);
  assert.match(empty.element('lesson-status').textContent, /阅读地址/);
  assert.equal(empty.video.src, emptySrc);
  assert.match(emptySrc, /^blob:/);
  empty.page.dispose();

  const slow = createHarness({ mode: 'hang' });
  openOwnVideo(slow);
  await settle();
  const slowSrc = slow.video.src;
  assert.equal(slow.element('lesson-next').getAttribute('aria-label'), '还在读');
  assert.equal(slow.video.currentTime, 0);
  slow.element('lesson-next').dispatch('click');
  assert.match(slow.element('lesson-status').textContent, /还在读/);
  assert.equal(slow.video.currentTime, 0);
  const timer = slow.timers.find((item) => item.delay === 300000);
  assert.ok(timer);
  timer.handler();
  await settle();
  assert.equal(slow.video.src, slowSrc);
  assert.match(slow.element('lesson-status').textContent, /没读完/);
  assert.equal(slow.element('wake-button').disabled, true);
  slow.page.dispose();

  const preset = createHarness();
  preset.element('preset-video').dispatch('click');
  preset.video.duration = 8;
  preset.video.videoWidth = 640;
  preset.video.videoHeight = 360;
  preset.video.dispatch('loadedmetadata');
  await settle();
  assert.equal(preset.calls.length, 0);
  assert.equal(preset.video.src, PRESET_SRC);
  assert.equal(preset.element('source-label').textContent, '预先准备的示例');
  preset.element('wake-button').dispatch('click');
  assert.equal(preset.calls.length, 0);
  assert.match(preset.element('derived-value').textContent, /斜边 5/);
  preset.page.dispose();
});
