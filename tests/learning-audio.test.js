const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const origin = 'http://localhost:4174';
const filePath = path.resolve(__dirname, '../extension/assets/video/geometry/triangle-3-4-5.mp4');
const sourceId = 'file-' + createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const settings = { baseUrl: 'https://asr.invalid/v1', apiKey: 'TEST_ONLY_NOT_A_SECRET', model: 'test-only', ffmpegPath: path.resolve('ffmpeg-test-only.exe'), maxCalls: 4 };
const registered = () => new Map([[sourceId, { filePath, duration: 12, source: { id: sourceId, version: '1', analysisVersion: '1', materialMode: 'self-authored' } }]]);
async function make(t, options = {}) {
  const api = await import('../scripts/learning-audio.mjs');
  const calls = []; const extracts = [];
  const handler = api.createAudioHandler({ sources: registered(), settings, allowedOrigins: [origin],
    extractImpl: async (input) => { extracts.push(input); return { wav: api.pcmToWav(Buffer.alloc(32000)), seconds: 1 }; },
    fetchImpl: async (url, input) => { calls.push({ url, input }); return new Response(JSON.stringify({ text: '两条直角边的平方和。' })); }, ...options });
  const server = http.createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const request = async (route, body, headers = {}) => {
    const reply = await fetch(`http://127.0.0.1:${server.address().port}/api/audio/${route}`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: reply.status, value: await reply.json() };
  };
  const session = () => request('session', { sourceId });
  return { api, calls, extracts, handler, request, session };
}
test('音轨配置留空、非法URL/预算拒绝且不提取或请求供应商', async (t) => {
  const a = await make(t, { settings: {} }); const reply = await a.session();
  assert.equal(reply.status, 503); assert.equal(reply.value.code, 'audio_not_configured');
  assert.equal(a.calls.length, 0); assert.equal(a.extracts.length, 0);
  assert.throws(() => a.api.loadAudioSettings({ BREAKGLASS_ASR_BASE_URL: 'http://public.invalid/v1' }));
  assert.throws(() => a.api.loadAudioSettings({ BREAKGLASS_ASR_BASE_URL: 'https://user:password@example.invalid' }));
  assert.throws(() => a.api.loadAudioSettings({ BREAKGLASS_ASR_HOURLY_CALLS: '99' }));
  assert.throws(() => a.api.loadAudioSettings({ BREAKGLASS_FFMPEG_PATH: 'relative.exe' }));
});
test('已登记短音轨实际HTTP调用multipart替身，候选/时间范围不冒充全课', async (t) => {
  const a = await make(t); const { token } = (await a.session()).value;
  const result = await a.request('transcribe', { token, start: 0, end: 1 });
  assert.equal(result.status, 200); assert.equal(result.value.status, 'transcript');
  assert.equal(result.value.coverage.actualAudioSeconds, 1); assert.match(result.value.sourceLabel, /候选/);
  assert.equal(a.calls.length, 1); const call = a.calls[0];
  assert.equal(call.url, 'https://asr.invalid/v1/audio/transcriptions');
  assert.equal(call.input.body.get('model'), 'test-only'); assert.equal(call.input.body.get('response_format'), 'json');
  const wav = Buffer.from(await call.input.body.get('file').arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.length, 32044);
  assert.equal(call.input.redirect, 'error'); assert.equal(a.extracts[0].filePath, filePath);
});
test('不能声明外部来源、客户端音频/URL、越界时间或跨Origin能力', async (t) => {
  const a = await make(t);
  assert.equal((await a.request('session', { sourceId: 'unknown' })).status, 403);
  assert.equal((await a.request('session', { sourceId, url: 'https://example.invalid/video' })).status, 400);
  assert.equal((await a.request('session', { sourceId }, { origin: 'https://foreign.invalid' })).status, 403);
  const { token } = (await a.session()).value;
  assert.equal((await a.request('transcribe', { token, start: 0, end: 1, audio: 'payload' })).status, 400);
  assert.equal((await a.request('transcribe', { token, start: -1, end: 1 })).status, 400);
  assert.equal((await a.request('transcribe', { token, start: 0, end: 13 })).status, 400);
  assert.equal((await a.request('transcribe', { token, start: 0, end: 1 }, { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal(a.extracts.length, 0); assert.equal(a.calls.length, 0);
});
test('两次调用和全局小时额度停止，没有自动重试', async (t) => {
  let now = 0; const a = await make(t, { settings: { ...settings, maxCalls: 2 }, now: () => now });
  const { token } = (await a.session()).value;
  for (let i = 0; i < 2; i++) assert.equal((await a.request('transcribe', { token, start: 0, end: 1 })).status, 200);
  assert.equal((await a.request('transcribe', { token, start: 0, end: 1 })).status, 429);
  const newToken = (await a.session()).value.token;
  assert.equal((await a.request('transcribe', { token: newToken, start: 0, end: 1 })).status, 429);
  assert.equal(a.calls.length, 2);
  now = 3600001; const fresh = (await a.session()).value.token;
  assert.equal((await a.request('transcribe', { token: fresh, start: 0, end: 1 })).status, 200);
});
test('无音轨不请求模型，供应商空文本/超长/非法结构不当成功', async (t) => {
  const a = await make(t, { extractImpl: async () => { throw Object.assign(new Error('没有音轨。'), { status: 422, code: 'audio_unavailable' }); } });
  assert.equal((await a.request('transcribe', { token: (await a.session()).value.token, start: 0, end: 1 })).status, 422);
  assert.equal(a.calls.length, 0);
  for (const text of ['', 'x'.repeat(6001), '\u0000bad']) {
    const b = await make(t, { fetchImpl: async () => new Response(JSON.stringify({ text })) });
    const reply = await b.request('transcribe', { token: (await b.session()).value.token, start: 0, end: 1 });
    assert.notEqual(reply.status, 200);
  }
});
test('停止/撤权中止处理，不接受迟到模型文字', async (t) => {
  let resolve; let called; const started = new Promise((r) => { called = r; }); let signal;
  const a = await make(t, { fetchImpl: async (_url, input) => { signal = input.signal; called(); return new Promise((r) => { resolve = r; }); } });
  const { token } = (await a.session()).value;
  const pending = a.request('transcribe', { token, start: 0, end: 1 });
  await started; assert.equal((await a.request('session/end', { token })).status, 200);
  assert.equal(signal.aborted, true); resolve(new Response(JSON.stringify({ text: '迟到文本' })));
  const reply = await pending; assert.notEqual(reply.status, 200); assert.equal(reply.value.text, undefined);
});
test('账户epoch变化或素材撤权拒绝迟到响应，来源只允许注册路径', async (t) => {
  let current = true; let resolve; let called; const started = new Promise((r) => { called = r; });
  const a = await make(t, { account: { privateScope: async () => ({ id: 'member', epoch: 0, sessionKey: 'private-only' }), isPrivateScopeCurrent: async () => current },
    fetchImpl: async () => { called(); return new Promise((r) => { resolve = r; }); } });
  const pending = a.request('transcribe', { token: (await a.session()).value.token, start: 0, end: 1 });
  await started; current = false; resolve(new Response(JSON.stringify({ text: '旧账户文字' })));
  assert.equal((await pending).status, 403);
});
test('固定FFmpeg参数、输出上限、取消杀进程及视频指纹复核', async () => {
  const api = await import('../scripts/learning-audio.mjs');
  let args; let options; let killed = false;
  const spawnImpl = (_executable, list, value) => {
    args = list; options = value; const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => { killed = true; };
    queueMicrotask(() => { child.stdout.write(api.pcmToWav(Buffer.alloc(32000))); child.emit('close', 0); }); return child;
  };
  const result = await api.extractAudio({ filePath, sourceId, start: 0, end: 1, ffmpegPath: settings.ffmpegPath, signal: new AbortController().signal, spawnImpl });
  assert.equal(result.seconds, 1); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  assert.equal(args[args.indexOf('-i') + 1], filePath); assert.equal(args[args.indexOf('-map') + 1], '0:a:0');
  await assert.rejects(api.extractAudio({ filePath, sourceId: 'file-' + '0'.repeat(64), start: 0, end: 1, ffmpegPath: settings.ffmpegPath,
    signal: new AbortController().signal, spawnImpl }), /指纹/);
  const controller = new AbortController(); let spawned;
  const started = new Promise((r) => { spawned = r; });
  const pending = api.extractAudio({ filePath, sourceId, start: 0, end: 1, ffmpegPath: settings.ffmpegPath, signal: controller.signal,
    spawnImpl: () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => { killed = true; }; spawned(); return child; } });
  await started; controller.abort(); await assert.rejects(pending, /停止/); assert.equal(killed, true);
});
