import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from '../src/settings.mjs';
import { loadModelProfile, buildModelRequest, modelProfileIdentity, ModelProfileError } from '../src/model-profile.mjs';
import { askModel } from '../src/model.mjs';
import { askGeometryModel } from '../src/geometry-model.mjs';
import { readGeometry } from '../src/geometry-scene.mjs';
import { readLearning } from '../src/learning.mjs';
import { readLearningContext } from '../src/learning-context.mjs';
import { summarizeLearning } from '../src/learning-summary.mjs';
import { settings, FRAME_DATA_URL, SOURCE_SIZE } from './helpers/fixtures.mjs';

const picture = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: FRAME_DATA_URL } }] }];
const controller = () => new AbortController();
function fakeReply(content) { return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) }; }
const metadata = { schemaVersion: '1', requestId: 'profile-1', sourceId: 'source-1', videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored' };

test('default and fixed/omit profiles build the same finite supplier policy for both entries', async () => {
  const defaultBody = buildModelRequest(settings(), picture);
  assert.equal(defaultBody.temperature, 0);
  assert.equal(Object.hasOwn(defaultBody, 'reasoning_effort'), false);
  assert.equal(Object.hasOwn(defaultBody, 'response_format'), false);
  for (const policy of ['fixed', 'omit']) {
    const configured = settings({ jsonMode: true, modelProfile: loadModelProfile({
      READER_TEMPERATURE_POLICY: policy, READER_TEMPERATURE: '1', READER_REASONING_EFFORT: 'max'
    }) });
    const calls = [];
    const fetchImpl = async (_url, init) => { calls.push(JSON.parse(init.body)); return fakeReply({ hasParabola: false }); };
    assert.equal((await askModel({ settings: configured, dataUrl: FRAME_DATA_URL, image: { width: 640, height: 402 },
      time: 1, courseText: '', signal: controller().signal, fetchImpl })).ok, true);
    assert.deepEqual(await askGeometryModel({ settings: configured, messages: picture, signal: controller().signal, fetchImpl }), { hasParabola: false });
    assert.equal(calls.length, 2);
    for (const body of calls) {
      assert.equal(Object.hasOwn(body, 'temperature'), policy === 'fixed');
      if (policy === 'fixed') assert.equal(body.temperature, 1);
      assert.equal(body.reasoning_effort, 'max');
      assert.deepEqual(body.response_format, { type: 'json_object' });
    }
  }
});
test('unknown profile values fail closed and identity contains no secrets or arbitrary settings', () => {
  for (const env of [{ READER_TEMPERATURE_POLICY: 'auto' }, { READER_TEMPERATURE: '' }, { READER_TEMPERATURE: '1garbage' },
    { READER_TEMPERATURE: '0x1' }, { READER_TEMPERATURE: 'NaN' }, { READER_TEMPERATURE: 'Infinity' },
    { READER_TEMPERATURE: '-0.1' }, { READER_TEMPERATURE: '2.1' }, { READER_REASONING_EFFORT: 'extra' },
    { READER_IMAGE_TRANSPORT: 'upload' }]) assert.throws(() => loadSettings(env), { code: 'invalid_model_profile' });
  const value = modelProfileIdentity(settings({ apiKey: 'PRIVATE-KEY', baseUrl: 'https://secret.example/', model: 'private-model', jsonMode: true }));
  assert.deepEqual(value, { profileVersion: 'recognition-profile-v1', temperaturePolicy: 'fixed', temperature: 0,
    reasoningEffort: '', imageTransport: 'inline', jsonMode: true });
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|secret|private-model/);
  assert.notDeepEqual(value, modelProfileIdentity(settings({ modelProfile: loadModelProfile({ READER_TEMPERATURE: '1' }) })));
  const omitted = modelProfileIdentity(settings({ modelProfile: loadModelProfile({ READER_TEMPERATURE_POLICY: 'omit' }) }));
  assert.equal(omitted.temperature, null);
  const defaults = loadSettings({});
  assert.equal(defaults.budgetMs, 240000); assert.equal(defaults.geometryReadBudgetMs, 30000);
  assert.equal(defaults.geometryAskBudgetMs, 10000); assert.equal(defaults.learningReadBudgetMs, 30000);
});
test('public-url rejects current data URL before any call; text-only summary is not an image upload', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return fakeReply({}); };
  const configured = settings({ modelProfile: loadModelProfile({ READER_IMAGE_TRANSPORT: 'public-url' }) });
  assert.throws(() => buildModelRequest(configured, picture), { code: 'unsupported_image_transport' });
  const curve = await askModel({ settings: configured, dataUrl: FRAME_DATA_URL, image: { width: 640, height: 402 },
    time: 1, courseText: '', signal: controller().signal, fetchImpl });
  assert.deepEqual(curve, { ok: false, reason: 'unsupported_image_transport', transport: true });
  await assert.rejects(askGeometryModel({ settings: configured, messages: picture, signal: controller().signal, fetchImpl }), { code: 'unsupported_image_transport' });
  assert.equal(calls, 0);
  assert.equal(buildModelRequest(configured, [{ role: 'user', content: 'bounded observations' }]).temperature, 0);
  const malformed = { ...loadModelProfile(), injected: 'secret' };
  assert.throws(() => buildModelRequest(settings({ modelProfile: malformed }), picture), ModelProfileError);
});
test('missing base configuration cannot call either entry even when used directly', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('should not call'); };
  for (const absent of ['baseUrl', 'apiKey', 'model']) {
    const configured = settings({ [absent]: '' });
    assert.equal((await askModel({ settings: configured, dataUrl: FRAME_DATA_URL, image: { width: 640, height: 402 },
      time: 1, courseText: '', signal: controller().signal, fetchImpl })).reason, 'unconfigured');
    await assert.rejects(askGeometryModel({ settings: configured, messages: picture, signal: controller().signal, fetchImpl }), { code: 'unconfigured' });
  }
  assert.equal(calls, 0);
});
test('existing geometry/learning/context errors keep old envelope and code but explain unsupported transport safely', async () => {
  const configured = settings({ modelProfile: loadModelProfile({ READER_IMAGE_TRANSPORT: 'public-url' }) });
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('should not call'); };
  const results = await Promise.all([
    readGeometry({ schemaVersion: '1.0.0', requestId: 'geometry-p1', videoId: 'video-1', frameTime: 1,
      frameSize: SOURCE_SIZE, image: FRAME_DATA_URL }, { settings: configured, fetchImpl }),
    readLearning({ ...metadata, frameTime: 1, image: FRAME_DATA_URL }, { settings: configured, fetchImpl }),
    readLearningContext({ ...metadata, frames: [{ frameTime: 1, image: FRAME_DATA_URL }], contextSourceId: null, cues: [] },
      { settings: configured, fetchImpl })
  ]);
  for (const result of results) {
    assert.equal(result.status, 502); assert.equal(result.payload.code, 'model_failed');
    assert.deepEqual(Object.keys(result.payload).sort(), ['code', 'error']);
    assert.match(result.payload.error, /不支持 inline JPEG/);
    assert.doesNotMatch(JSON.stringify(result.payload), /test-key-not-real|data:image|model.example/);
  }
  assert.equal(calls, 0);
});
test('learning and summary receive the same optional reasoning policy without changing their schemas', async () => {
  const configured = settings({ modelProfile: loadModelProfile({ READER_TEMPERATURE_POLICY: 'omit', READER_REASONING_EFFORT: 'high' }) });
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return fakeReply(calls.length === 1 ? { schemaVersion: '1', status: 'unsupported' } : { summary: '所列观察', keyPoints: [], pitfalls: [] });
  };
  assert.equal((await readLearning({ ...metadata, frameTime: 1, image: FRAME_DATA_URL }, { settings: configured, fetchImpl })).payload.status, 'unsupported');
  const summary = await summarizeLearning({ ...metadata, observations: [{ frameTime: 1, title: '有限观察', explanation: '截图候选',
    pitfallHint: '', template: 'parabola' }] }, { settings: configured, fetchImpl });
  assert.equal(summary.payload.status, 'summary');
  assert.equal(calls.length, 2);
  for (const body of calls) { assert.equal(Object.hasOwn(body, 'temperature'), false); assert.equal(body.reasoning_effort, 'high'); }
});
