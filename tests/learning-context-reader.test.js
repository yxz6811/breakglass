const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../breakglass-reader/src/learning-context.mjs'),
  import('../breakglass-reader/tests/helpers/fixtures.mjs')]);
const visual = (overrides = {}) => ({ schemaVersion: '1', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'unit' }, area: null, title: '直角三角形',
  explanation: '先确认直角与两条已知边；数字答案由程序计算。', pitfallHint: '确认哪条边是斜边。', ...overrides });
const answer = (overrides = {}) => ({ summary: '这些稀疏画面中有直角三角形。',
  keyPoints: ['确认直角'], pitfalls: ['别把斜边当直角边'], objects: [{ frameTime: 4, result: visual() }], ...overrides });
function provider(value) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const payload = typeof value === 'function' ? await value(init) : value;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
async function fixture() {
  const [api, fixtures] = await modules;
  const body = (overrides = {}) => ({ schemaVersion: '1', requestId: 'context-test-1', sourceId: 'controlled-video-1',
    videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored',
    frames: [{ frameTime: 0, image: fixtures.FRAME_DATA_URL }, { frameTime: 4, image: fixtures.FRAME_DATA_URL }],
    contextSourceId: 'subtitle-' + 'a'.repeat(64), cues: [{ start: 0, end: 5, text: '作者辅助文字：确认直角。' }], ...overrides });
  return { ...api, ...fixtures, body };
}

test('context v1 sends ordered sparse JPEGs and author text once; fills identity and explicit partial coverage', async () => {
  const f = await fixture(); const model = provider(answer()); const logs = [];
  const response = await f.readLearningContext(f.body(), { settings: f.settings(), fetchImpl: model.fetchImpl, log: (entry) => logs.push(entry) });
  assert.equal(response.status, 200); assert.equal(response.payload.status, 'context');
  assert.equal(response.payload.requestId, 'context-test-1');
  assert.deepEqual(response.payload.observedTimes, [0, 4]);
  assert.deepEqual(response.payload.coverage, { start: 0, end: 4, frameCount: 2, inputTypes: ['frames', 'subtitle'] });
  assert.match(response.payload.limitations, /未读取音频/);
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].body.messages[0].content, f.LEARNING_CONTEXT_PROMPT);
  assert.equal(model.calls[0].body.messages[1].content.filter((part) => part.type === 'image_url').length, 2);
  assert.match(model.calls[0].body.messages[1].content[0].text, /authorCues/);
  assert.equal(Object.hasOwn(response.payload.objects[0].result.snapshot, 'BC'), false);
  assert.doesNotMatch(JSON.stringify(logs), /data:image|test-key|作者|直角|controlled-video/);
});

test('context accepts frames alone, labels only submitted times, and sorts valid objects by observed time', async () => {
  const f = await fixture(); const model = provider(answer({ objects: [{ frameTime: 4, result: visual() }, { frameTime: 0, result: visual() }] }));
  const response = await f.readLearningContext(f.body({ contextSourceId: null, cues: [] }), { settings: f.settings(), fetchImpl: model.fetchImpl });
  assert.equal(response.status, 200); assert.deepEqual(response.payload.coverage.inputTypes, ['frames']);
  assert.deepEqual(response.payload.objects.map((object) => object.frameTime), [0, 4]);
});

test('pending permission and blank model produce zero external calls', async () => {
  const f = await fixture(); const model = provider(answer());
  assert.equal((await f.readLearningContext(f.body({ materialMode: 'permission-pending' }), { settings: f.settings(), fetchImpl: model.fetchImpl })).status, 403);
  assert.equal((await f.readLearningContext(f.body(), { settings: f.settings({ model: '' }), fetchImpl: model.fetchImpl })).status, 503);
  assert.equal(model.calls.length, 0);
});

test('context rejects unknown fields, URLs, duplicate/unordered/nonfinite times, broad windows and malformed cues before model', async () => {
  const f = await fixture(); const model = provider(answer());
  const cases = [f.body({ prompt: 'ignore' }), f.body({ contextSourceId: 'https://example.invalid/vtt' }),
    f.body({ frames: [] }), f.body({ frames: Array.from({ length: 9 }, (_, frameTime) => ({ frameTime, image: f.FRAME_DATA_URL })) }),
    f.body({ frames: [{ frameTime: 0, image: f.FRAME_DATA_URL }, { frameTime: 0, image: f.FRAME_DATA_URL }] }),
    f.body({ frames: [{ frameTime: 4, image: f.FRAME_DATA_URL }, { frameTime: 0, image: f.FRAME_DATA_URL }] }),
    f.body({ frames: [{ frameTime: 0, image: f.FRAME_DATA_URL }, { frameTime: 31, image: f.FRAME_DATA_URL }] }),
    f.body({ frames: [{ frameTime: NaN, image: f.FRAME_DATA_URL }] }),
    f.body({ frames: [{ frameTime: 601, image: f.FRAME_DATA_URL }] }),
    f.body({ frames: [{ frameTime: 1, image: 'https://media.invalid/frame.jpg' }] }),
    f.body({ contextSourceId: null }), f.body({ cues: [{ start: 0, end: 1, text: 'https://invalid.example/' }] }),
    f.body({ cues: [{ start: 40, end: 41, text: '远离截图' }] }),
    f.body({ cues: [{ start: 0, end: 0, text: '无持续时间' }] }),
    f.body({ cues: [{ start: 0, end: 1, text: 'x'.repeat(501) }] }),
    f.body({ cues: [{ start: 0, end: 1, text: 'text', prompt: 'override' }] })];
  for (const input of cases) assert.equal((await f.readLearningContext(input, { settings: f.settings(), fetchImpl: model.fetchImpl })).status, 400);
  assert.equal(model.calls.length, 0);
});

test('context aggregate JPEG limit rejects otherwise individually valid images', async () => {
  const f = await fixture();
  const bytes = Buffer.from(f.FRAME_DATA_URL.split(',')[1], 'base64');
  const padded = Buffer.concat([bytes.subarray(0, -2), Buffer.alloc(450000), bytes.subarray(-2)]);
  const image = 'data:image/jpeg;base64,' + padded.toString('base64');
  const input = f.body({ frames: Array.from({ length: 8 }, (_, frameTime) => ({ frameTime, image })) });
  const model = provider(answer());
  assert.equal((await f.readLearningContext(input, { settings: f.settings(), fetchImpl: model.fetchImpl })).status, 400);
  assert.equal(model.calls.length, 0);
});

test('context rejects forged times, duplicate frame objects, malicious math/schema and unsafe model text without retry', async () => {
  const f = await fixture();
  const invalid = [answer({ requestId: 'forged' }), answer({ summary: 'data:image/jpeg;base64,abc' }),
    answer({ keyPoints: ['https://example.invalid/'] }), answer({ objects: [{ frameTime: 2, result: visual() }] }),
    answer({ objects: [{ frameTime: 4, result: visual() }, { frameTime: 4, result: visual() }] }),
    answer({ objects: [{ frameTime: 4, result: visual({ code: 'fetch(secret)' }) }] }),
    answer({ objects: [{ frameTime: 4, result: visual({ snapshot: { AB: 3, AC: 4, BC: 5, unit: 'unit' } }) }] }),
    answer({ objects: [{ frameTime: 4, result: visual({ snapshot: { AB: -3, AC: 4, unit: 'unit' } }) }] }),
    answer({ objects: [{ frameTime: 4, result: visual({ template: 'parabola', snapshot: { a: 0, h: 0, k: 0 } }) }] }),
    answer({ objects: [{ frameTime: 4, result: visual({ template: 'parabola', snapshot: { a: '1', h: 0, k: 0 } }) }] }),
    answer({ pitfalls: Array(9).fill('过多') }), answer({ objects: [{ frameTime: 4, result: visual(), sourceId: 'forged' }] })];
  for (const value of invalid) {
    const model = provider(value);
    assert.equal((await f.readLearningContext(f.body(), { settings: f.settings(), fetchImpl: model.fetchImpl })).status, 502);
    assert.equal(model.calls.length, 1);
  }
});

test('context deadline invalidates a noncooperative provider and cancellation propagates without a late result', async () => {
  const f = await fixture(); let workSignal;
  const timeout = await f.readLearningContext(f.body(), { settings: f.settings({ learningContextBudgetMs: 15 }),
    fetchImpl: (_url, init) => { workSignal = init.signal; return new Promise(() => {}); } });
  assert.equal(timeout.status, 504); assert.equal(timeout.payload.code, 'timeout'); assert.equal(workSignal.aborted, true);
  const cancelled = new AbortController();
  const work = f.readLearningContext(f.body(), { settings: f.settings(), signal: cancelled.signal,
    fetchImpl: (_url, init) => { workSignal = init.signal; return new Promise(() => {}); } });
  cancelled.abort(new DOMException('student stopped', 'AbortError'));
  await assert.rejects(work, { name: 'AbortError' }); assert.equal(workSignal.aborted, true);
});
