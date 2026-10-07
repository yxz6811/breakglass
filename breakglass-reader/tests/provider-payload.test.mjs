import test from 'node:test';
import assert from 'node:assert/strict';
import { readProviderPayload, withProviderAbort, PROVIDER_RESPONSE_LIMIT } from '../src/provider-payload.mjs';
import { askModel } from '../src/model.mjs';
import { askGeometryModel } from '../src/geometry-model.mjs';
import { settings, FRAME_DATA_URL, JPEG_SIZE } from './helpers/fixtures.mjs';

const freshSignal = () => new AbortController().signal;
function responseStream(bytes, { closed = true, onCancel = () => {} } = {}) {
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); if (closed) controller.close(); },
    cancel() { onCancel(); }
  }));
}
function invoke(kind, fetchImpl, signal) {
  return kind === 'curve' ? askModel({ settings: settings(), dataUrl: FRAME_DATA_URL, image: JPEG_SIZE,
    time: 1, courseText: '', signal, fetchImpl }) : askGeometryModel({ settings: settings(),
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: FRAME_DATA_URL } }] }], signal, fetchImpl });
}
test('real readable bytes allow exact 64KiB and reject larger data before JSON parsing', async () => {
  const wrapperBytes = Buffer.byteLength(JSON.stringify({ pad: '' }));
  const value = { pad: 'x'.repeat(PROVIDER_RESPONSE_LIMIT - wrapperBytes) };
  const bytes = Buffer.from(JSON.stringify(value));
  assert.equal(bytes.length, PROVIDER_RESPONSE_LIMIT);
  assert.deepEqual(await readProviderPayload(responseStream(bytes), freshSignal()), value);
  let cancelled = 0;
  const huge = responseStream(Buffer.alloc(PROVIDER_RESPONSE_LIMIT + 1, 0xff), { closed: false, onCancel: () => cancelled++ });
  await assert.rejects(readProviderPayload(huge, freshSignal()), { code: 'response_limit' });
  assert.equal(cancelled, 1);
});
test('size is cumulative UTF-8 bytes, json-only substitutes have the same cap, and errors do not expose payload', async () => {
  let cancelled = 0;
  const chunks = new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.alloc(40000, 0x20)); controller.enqueue(Buffer.alloc(30000, 0x20)); },
    cancel() { cancelled++; }
  }));
  await assert.rejects(readProviderPayload(chunks, freshSignal()), { code: 'response_limit' });
  assert.equal(cancelled, 1);
  await assert.rejects(readProviderPayload({ json: async () => ({ text: '数'.repeat(22000) }) }, freshSignal()), { code: 'response_limit' });
  const secret = 'PRIVATE_SUPPLIER_CONTENT';
  await assert.rejects(readProviderPayload(responseStream(Buffer.from(secret)), freshSignal()), (error) => {
    assert.equal(error.code, 'model_bad_json'); assert.doesNotMatch(error.message, /PRIVATE_SUPPLIER/); return true;
  });
  await assert.rejects(readProviderPayload(responseStream(Buffer.from([0x22, 0xff, 0x22])), freshSignal()), { code: 'model_bad_json' });
});
test('both model entries reject oversized real streams with one call, cancelling the stream', async () => {
  for (const kind of ['curve', 'geometry']) {
    let calls = 0; let cancelled = 0;
    const fetchImpl = async () => {
      calls++;
      return responseStream(Buffer.alloc(PROVIDER_RESPONSE_LIMIT + 1, 0x20), { closed: false, onCancel: () => cancelled++ });
    };
    const pending = invoke(kind, fetchImpl, freshSignal());
    if (kind === 'curve') assert.deepEqual(await pending, { ok: false, reason: 'model_response_limit', transport: true });
    else await assert.rejects(pending, { code: 'response_limit' });
    assert.equal(calls, 1); assert.equal(cancelled, 1);
  }
});
test('abort race handles ignored fetch cancellation and discards late replies without parsing', { timeout: 2000 }, async () => {
  for (const kind of ['curve', 'geometry']) {
    const abort = new AbortController(); let finish; let calls = 0; let parsed = 0; let cancelled = 0;
    const late = new Promise((resolve) => { finish = resolve; });
    const pending = invoke(kind, async () => { calls++; return late; }, abort.signal);
    await new Promise((resolve) => setImmediate(resolve));
    const checked = kind === 'geometry' ? assert.rejects(pending, { name: 'AbortError' }) : pending;
    abort.abort(new DOMException('Local cancellation', 'AbortError'));
    if (kind === 'curve') assert.deepEqual(await checked, { ok: false, reason: 'model_timeout', transport: true });
    else await checked;
    finish({ ok: true, body: { cancel: async () => { cancelled++; } }, json: async () => { parsed++; return {}; } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(parsed, 0); assert.equal(cancelled, 1);
  }
});
test('abort cancels a pending read even if the substitute stream ignores cancel', { timeout: 2000 }, async () => {
  const abort = new AbortController(); let cancelled = 0; let reading;
  const started = new Promise((resolve) => { reading = resolve; });
  const response = { body: { getReader: () => ({
    read: () => { reading(); return new Promise(() => {}); },
    cancel: () => { cancelled++; return new Promise(() => {}); }, releaseLock: () => {}
  }) } };
  const pending = readProviderPayload(response, abort.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started; abort.abort(); await rejected;
  assert.equal(cancelled, 1);
});
test('pre-abort does not run work and in-budget real streams retain old parser strictness', async () => {
  const abort = new AbortController(); abort.abort(); let ran = 0;
  await assert.rejects(withProviderAbort(abort.signal, () => { ran++; }), { name: 'AbortError' });
  assert.equal(ran, 0);
  const content = '```json\n{"hasParabola":false}\n```';
  const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content } }] }));
  assert.deepEqual(await invoke('curve', async () => responseStream(bytes), freshSignal()), { ok: true, answer: { hasParabola: false } });
  await assert.rejects(invoke('geometry', async () => responseStream(bytes), freshSignal()), { code: 'model_shape' });
});
test('HTTP failures cancel unused bodies; network and stream errors are finite safe types', async () => {
  for (const kind of ['curve', 'geometry']) {
    let cancelled = 0; let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: false, status: 400,
      body: { cancel: () => { cancelled++; return Promise.resolve(); } } }; };
    const pending = invoke(kind, fetchImpl, freshSignal());
    if (kind === 'curve') assert.equal((await pending).reason, 'model_http_400');
    else await assert.rejects(pending, { code: 'model_http' });
    assert.equal(calls, 1); assert.equal(cancelled, 1);
  }
  await assert.rejects(invoke('geometry', async () => { throw new Error('PRIVATE_SUPPLIER_DETAILS'); }, freshSignal()),
    (error) => error.code === 'model_unreachable' && !error.message.includes('PRIVATE'));
  await assert.rejects(readProviderPayload({ body: { getReader: () => ({
    read: async () => { throw new Error('PRIVATE_STREAM_DETAILS'); }, cancel: async () => {}, releaseLock: () => {}
  }) } }, freshSignal()), (error) => error.code === 'model_unreadable' && !error.message.includes('PRIVATE'));
});
