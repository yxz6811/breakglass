import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAudioHandler, extractAudio, pcmToWav } from './learning-audio.mjs';

// Real native decoding of a generated tone, never a speech/model-quality claim.
const root = fileURLToPath(new URL('../', import.meta.url));
const executable = path.resolve(process.argv[2] || process.env.BREAKGLASS_FFMPEG_PATH || '');
if (!process.argv[2] && !process.env.BREAKGLASS_FFMPEG_PATH) throw new Error('Provide an installed FFmpeg executable absolute path.');
const output = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-audio-validation-')));
const relative = path.relative(root, output);
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Private evidence must stay outside repository.');
fs.mkdirSync(output, { recursive: true });
const original = path.join(root, 'extension/assets/video/geometry/triangle-3-4-5.mp4');
const toneVideo = path.join(output, 'self-authored-tone-fixture.mp4');
const toneWav = path.join(output, 'self-authored-tone-source.wav');
const tonePcm = Buffer.alloc(64000);
for (let sample = 0; sample < 32000; sample += 1) tonePcm.writeInt16LE(Math.round(3000 * Math.sin(sample * 440 * 2 * Math.PI / 16000)), sample * 2);
fs.writeFileSync(toneWav, pcmToWav(tonePcm));
const generated = spawnSync(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', original,
  '-i', toneWav, '-map', '0:v:0', '-map', '1:a:0',
  '-t', '2', '-c:v', 'copy', '-c:a', 'aac', '-map_metadata', '-1', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
{ shell: false, windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(generated.status, 0, 'Native fixture generation failed; no provider was called.');
fs.writeFileSync(toneVideo, generated.stdout);
const id = (file) => 'file-' + createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceId = id(toneVideo); const start = performance.now();
const decoded = await extractAudio({ filePath: toneVideo, sourceId, start: 0.25, end: 1.25,
  ffmpegPath: executable, signal: AbortSignal.timeout(30000) });
assert.equal(decoded.wav.readUInt32LE(24), 16000); assert.equal(decoded.wav.readUInt16LE(22), 1);
assert.equal(decoded.wav.readUInt16LE(34), 16); assert.ok(Math.abs(decoded.seconds - 1) < 0.01);
let peak = 0; for (let offset = 44; offset + 2 <= decoded.wav.length; offset += 2) peak = Math.max(peak, Math.abs(decoded.wav.readInt16LE(offset)));
assert.ok(peak > 100, 'Tone should have non-zero decoded samples.');
const decodeMs = performance.now() - start;
const sources = new Map([[sourceId, { filePath: toneVideo, duration: 2,
  source: { id: sourceId, version: '1', analysisVersion: '1', materialMode: 'self-authored' } }]]);
let providerCalls = 0;
const origin = 'http://localhost:4174';
const handler = createAudioHandler({ sources, allowedOrigins: [origin], settings: { baseUrl: 'https://test-asr.invalid/v1',
  model: 'explicit-transport-stub', apiKey: 'EXPLICIT_TEST_KEY', ffmpegPath: executable, maxCalls: 4 },
  fetchImpl: async (_url, init) => {
    providerCalls += 1; const file = init.body.get('file'); const wav = Buffer.from(await file.arrayBuffer());
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.ok(wav.length <= 1024 * 1024);
    return new Response(JSON.stringify({ text: '测试替身返回的候选文本；该音轨实际是合成音调。' }));
  } });
const server = http.createServer((req, res) => void handler(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const post = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/audio/${route}`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
};
const summary = { status: 'running', generatedSelfAuthoredTone: true, actualNativeFFmpeg: true,
  actualHTTP: true, model: 'explicit multipart transport stub', realASRVerified: false, realSpeechAccuracyVerified: false,
  publicDeploymentVerified: false, bilibiliPermissionVerified: false, learningEffectVerified: false,
  environment: { node: process.version, platform: os.platform() }, checks: {}, decodeMs, decodedAudioSeconds: decoded.seconds };
try {
  const session = await post('session', { sourceId }); assert.equal(session.status, 200);
  const transcribed = await post('transcribe', { token: session.value.token, start: 0.25, end: 1.25 });
  assert.equal(transcribed.status, 200); assert.equal(providerCalls, 1); summary.checks.realDecodeToBoundedMultipartStub = true;
  assert.equal((await post('session', { sourceId: 'unregistered' })).status, 403); summary.checks.permissionGate = true;
  await assert.rejects(extractAudio({ filePath: original, sourceId: id(original), start: 0, end: 1,
    ffmpegPath: executable, signal: AbortSignal.timeout(30000) }), (error) => error.code === 'audio_unavailable');
  summary.checks.silentVideoIsHonestFailure = true;
  fs.appendFileSync(toneVideo, Buffer.from([0]));
  const rejected = await post('transcribe', { token: session.value.token, start: 0.25, end: 1.25 });
  assert.equal(rejected.status, 403); assert.equal(providerCalls, 1); summary.checks.changedRegisteredFileNeverUploads = true;
  assert.equal(pcmToWav(Buffer.alloc(32000)).length, 32044); summary.status = 'passed';
} catch (error) { summary.status = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  handler.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
