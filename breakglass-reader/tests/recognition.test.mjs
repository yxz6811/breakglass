import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecognition, RECOGNITION_PROMPT } from '../src/recognition.mjs';
import { FRAME_DATA_URL, SOURCE_SIZE, settings } from './helpers/fixtures.mjs';

const request = (changes = {}) => ({ schemaVersion: '011.1', requestId: 'recognition-reader-1', sourceId: 'file-' + 'a'.repeat(64),
  videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored', kind: 'parabola', frameTime: 6.451,
  frameSize: { ...SOURCE_SIZE }, image: FRAME_DATA_URL, ...changes });
const answer = (changes = {}) => ({ status: 'candidate', kind: 'parabola', formulaBasis: 'visible-equation',
  equation: { form: 'general', a: 1.1, b: -1.1, c: -1 }, ...changes });
const provider = (value) => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const run = (body, value, options = {}) => readRecognition(body, { settings: settings(), fetchImpl: provider(value), ...options });

test('new recognition normalizes general coefficients deterministically and leaves all placement unknown', async () => {
  const value = await run(request(), answer()); assert.equal(value.status, 200);
  assert.deepEqual(value.payload.candidate.snapshot, { a: 1.1, h: 0.5, k: -1.275 });
  assert.equal(value.payload.evidence.mathStatus, 'consistent'); assert.equal(value.payload.evidence.placementStatus, 'unknown');
  assert.equal(value.payload.evidence.map, null); assert.equal(value.payload.evidence.calibrationBasis, 'none');
  assert.equal(value.payload.limitations.includes('student_confirmation_required'), true);
  assert.match(RECOGNITION_PROMPT, /不自行换算顶点/);
});

test('recognition negative answers return no invented conditions; malformed or ambiguous guesses fail closed', async () => {
  for (const status of ['unsupported', 'insufficient']) {
    const result = await run(request(), { status }); assert.equal(result.status, 200);
    assert.equal(result.payload.candidate, null); assert.equal(result.payload.evidence.formulaBasis, 'none');
    assert.equal(result.payload.evidence.mathStatus, 'insufficient');
  }
  for (const output of [answer({ equation: { form: 'general', a: 0, b: 1, c: 1 } }),
    answer({ equation: { form: 'general', a: '1.1', b: -1.1, c: -1 } }), answer({ anchors: [] }),
    answer({ confidence: 1 }), { status: 'insufficient', equation: { a: 1, h: 0, k: 0 } },
    answer({ kind: 'right-triangle' }), answer({ formulaBasis: 'none' }),
    answer({ equation: { form: 'general', a: 1e-6, b: 1e6, c: 0 } })]) {
    assert.equal((await run(request(), output)).status, 502);
  }
});

test('new triangle recognition uses only explicit finite lengths, supports independent board and rejects missing right angle', async () => {
  const triangle = { status: 'candidate', kind: 'right-triangle', formulaBasis: 'visible-lengths', rightAngleAt: 'A',
    lengths: { AB: 6, AC: 8 }, unit: 'cm' };
  const value = await run(request({ kind: 'right-triangle' }), triangle); assert.equal(value.status, 200);
  assert.deepEqual(value.payload.candidate, { template: 'right-triangle', snapshot: { AB: 6, AC: 8, unit: 'cm' } });
  assert.equal(value.payload.evidence.map, null);
  for (const change of [{ rightAngleAt: 'B' }, { lengths: { AB: 0, AC: 8 } }, { unit: 'km' },
    { lengths: { AB: 6, AC: 8, BC: 10 } }]) {
    assert.equal((await run(request({ kind: 'right-triangle' }), { ...triangle, ...change })).status, 502);
  }
});

test('new recognition never calls supplier for invalid request, blank configuration or public-url-only image transport', async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return provider(answer())(); };
  assert.equal((await run(request({ prompt: 'ignored' }), answer(), { fetchImpl })).status, 400);
  assert.equal((await run(request(), answer(), { fetchImpl, settings: settings({ model: '' }) })).status, 503);
  const profile = { profileVersion: 'recognition-profile-v1', temperaturePolicy: 'fixed', temperature: 1,
    reasoningEffort: 'max', imageTransport: 'public-url' };
  const incompatible = await run(request(), answer(), { fetchImpl, settings: settings({ modelProfile: profile }) });
  assert.equal(incompatible.status, 422); assert.equal(incompatible.payload.code, 'unsupported_image_transport');
  assert.equal(calls, 0);
});

test('new recognition has independent timeout, cancellation and bounded safe error bodies even if upstream ignores abort', async () => {
  const timeout = await run(request(), answer(), { settings: settings({ learningReadBudgetMs: 15 }),
    fetchImpl: async () => new Promise(() => {}) });
  assert.equal(timeout.status, 504); assert.equal(timeout.payload.code, 'timeout');
  const controller = new AbortController();
  const pending = run(request(), answer(), { signal: controller.signal, fetchImpl: async () => new Promise(() => {}) });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const oversized = await run(request(), answer(), { fetchImpl: async () => new Response('private-upstream-secret'.repeat(4000)) });
  assert.equal(oversized.status, 502); assert.doesNotMatch(JSON.stringify(oversized), /private-upstream-secret/);
});
