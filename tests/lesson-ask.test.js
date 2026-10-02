// 当次阅读请求：只用调用方给的地址和 fetchImpl，不碰全局 fetch，不连真实网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ask = require('../extension/src/lesson/ask.js');

const ASK_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'lesson', 'ask.js'), 'utf8');

/**
 * 只记录排程的假时钟。fire() 手动触发到点的回调。
 * @returns {{ schedule: Function, clear: Function, delays: number[], cleared: unknown[], fire: Function }}
 */
function fakeClock() {
  const pending = new Map();
  let sequence = 0;
  const clock = {
    delays: [],
    cleared: [],
    schedule(delay, handler) {
      sequence += 1;
      clock.delays.push(delay);
      pending.set(sequence, handler);
      return sequence;
    },
    clear(id) {
      clock.cleared.push(id);
      pending.delete(id);
    },
    fire() {
      const handlers = [...pending.values()];
      pending.clear();
      handlers.forEach((handler) => handler());
    }
  };
  return clock;
}

/**
 * @param {object} [extra]
 * @returns {object}
 */
function body(extra) {
  return ask.requestBody(Object.assign({
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    duration: 12,
    courseText: '',
    frames: [{ time: 0.75, image: 'data:image/jpeg;base64,AA==' }]
  }, extra || {}));
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }

/**
 * 测试期间把全局 fetch 换成会报错的替身，证明模块从不直接联网。
 * @param {Function} run
 */
async function withoutGlobalFetch(run) {
  const previous = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = () => { touched += 1; throw new Error('不应使用全局 fetch'); };
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
  assert.equal(touched, 0);
}

test('课程说明：空着可以，8000 字以内照发，超过就不发正文', () => {
  const empty = ask.prepareCourse('');
  assert.equal(empty.ok, true);
  assert.equal(empty.empty, true);
  assert.equal(empty.message, '这次没有课程文本。');
  const wide = '𝑥'.repeat(8000);
  assert.equal(ask.prepareCourse(wide).ok, true, '按码点计数，代理对不算两个字');
  const long = ask.prepareCourse('课'.repeat(8001));
  assert.equal(long.ok, false);
  assert.equal(long.courseText, '');
  assert.equal(long.message, '请把课程说明缩短到 8000 字以内。');
  assert.equal(body({ courseText: '课'.repeat(8001) }).courseText, '');
});

test('请求体只有五个字段，画面最多 8 张，每张只带时间和图片', () => {
  const frames = Array.from({ length: 10 }, (_, index) => ({ time: index, image: 'data:image/jpeg;base64,AA==', extra: 'drop' }));
  const sent = body({ frames, secret: 'nope', origin: 'external' });
  assert.deepEqual(Object.keys(sent).sort(), ['courseText', 'duration', 'frames', 'readingId', 'videoId']);
  assert.equal(sent.frames.length, 8);
  sent.frames.forEach((frame) => assert.deepEqual(Object.keys(frame).sort(), ['image', 'time']));
});

test('回包要对上这一次的阅读编号、视频编号，且来源是 external', () => {
  const request = body();
  const good = { readingId: 'reading-1', videoId: 'local-binding-1', origin: 'external', points: [] };
  assert.equal(ask.acceptResponse(request, good), good);
  assert.equal(ask.acceptResponse(request, { ...good, readingId: 'reading-0' }), null);
  assert.equal(ask.acceptResponse(request, { ...good, videoId: 'local-binding-0' }), null);
  assert.equal(ask.acceptResponse(request, { ...good, origin: 'preset' }), null);
  assert.equal(ask.acceptResponse(request, null), null);
});

test('空白地址和夹具片子不发请求', async () => {
  await withoutGlobalFetch(async () => {
    const failures = [];
    let calls = 0;
    const fetchImpl = () => { calls += 1; return new Promise(() => {}); };
    ask.startLessonAsk({ url: '   ', body: body(), fetchImpl, clock: fakeClock(), onFailure: (code) => failures.push(code) });
    ask.startLessonAsk({ url: 'local-reader', body: body({ videoId: 'fixture-parabola' }), fetchImpl, clock: fakeClock(), onFailure: (code) => failures.push(code) });
    assert.deepEqual(failures, ['empty', 'unavailable']);
    assert.equal(calls, 0);
  });
});

test('POST 一次 JSON，5 分钟没回就按超时失败并中止请求', async () => {
  await withoutGlobalFetch(async () => {
    const clock = fakeClock();
    const calls = [];
    const failures = [];
    ask.startLessonAsk({
      url: 'local-reader',
      body: body(),
      fetchImpl: (url, init) => { calls.push({ url, init }); return new Promise(() => {}); },
      clock,
      onFailure: (code) => failures.push(code)
    });
    assert.deepEqual(clock.delays, [300000]);
    assert.equal(ask.DEADLINE_MS, 300000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'local-reader');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), body());
    assert.equal(calls[0].init.signal.aborted, false);
    clock.fire();
    assert.deepEqual(failures, ['timeout']);
    assert.equal(calls[0].init.signal.aborted, true);
  });
});

test('非 2xx、断网和对不上的回包都算 unavailable', async () => {
  await withoutGlobalFetch(async () => {
    const mismatched = { readingId: 'reading-9', videoId: 'local-binding-1', origin: 'external', points: [] };
    const cases = [
      () => Promise.resolve({ ok: false, status: 502, json: async () => ({}) }),
      () => Promise.reject(new TypeError('offline')),
      () => Promise.resolve({ ok: true, status: 200, json: async () => mismatched })
    ];
    for (const fetchImpl of cases) {
      const failures = [];
      const successes = [];
      ask.startLessonAsk({ url: 'local-reader', body: body(), fetchImpl, clock: fakeClock(), onFailure: (code) => failures.push(code), onSuccess: (payload) => successes.push(payload) });
      await flush();
      assert.deepEqual(failures, ['unavailable']);
      assert.equal(successes.length, 0);
    }
  });
});

test('对得上的回包交给 onSuccess，并清掉超时', async () => {
  await withoutGlobalFetch(async () => {
    const clock = fakeClock();
    const payload = { readingId: 'reading-1', videoId: 'local-binding-1', origin: 'external', points: [] };
    const successes = [];
    const failures = [];
    ask.startLessonAsk({
      url: 'local-reader',
      body: body(),
      fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => payload }),
      clock,
      onSuccess: (value) => successes.push(value),
      onFailure: (code) => failures.push(code)
    });
    await flush();
    assert.deepEqual(successes, [payload]);
    assert.deepEqual(failures, []);
    assert.equal(clock.cleared.length, 1);
    clock.fire();
    assert.deepEqual(failures, [], '超时已经清掉');
  });
});

test('取消只停下请求，不当作失败，迟到的回包也不再交出去', async () => {
  await withoutGlobalFetch(async () => {
    const clock = fakeClock();
    let release = null;
    let signal = null;
    const successes = [];
    const failures = [];
    const handle = ask.startLessonAsk({
      url: 'local-reader',
      body: body(),
      fetchImpl: (url, init) => {
        signal = init.signal;
        return new Promise((resolve) => { release = resolve; });
      },
      clock,
      onSuccess: (value) => successes.push(value),
      onFailure: (code) => failures.push(code)
    });
    handle.cancel();
    assert.equal(signal.aborted, true);
    assert.equal(clock.cleared.length, 1);
    release({ ok: true, status: 200, json: async () => ({ readingId: 'reading-1', videoId: 'local-binding-1', origin: 'external', points: [] }) });
    await flush();
    clock.fire();
    assert.deepEqual(failures, []);
    assert.deepEqual(successes, []);
  });
});

test('模块里没有固定地址，也不直接调用全局 fetch', () => {
  assert.doesNotMatch(ASK_SOURCE, /https?:\/\//);
  assert.doesNotMatch(ASK_SOURCE, /\bfetch\(/);
});
