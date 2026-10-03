// Test-only HTTP substitute. It returns authored fixture data, never calls a model.
// Browser evidence from this process proves transport/UI behavior, not recognition.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const preset = JSON.parse(fs.readFileSync(path.join(root, 'extension/assets/presets/demo-parabola.json'), 'utf8'));
const entries = [];
const evidence = path.join(__dirname, 'browser-http-requests.json');
function record(entry) { entries.push(entry); fs.writeFileSync(evidence, JSON.stringify(entries, null, 2) + '\n'); }
(async () => {
  const { decodeJpegDataUrl, jpegSize } = await import(pathToFileURL(path.join(root, 'breakglass-reader/src/jpeg.mjs')));
  const server = http.createServer(async (request, response) => {
    const cors = { 'access-control-allow-origin': 'http://127.0.0.1:8765',
      'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return; }
    if (request.url !== '/read' || request.method !== 'POST') { response.writeHead(404, cors); response.end(); return; }
    let body;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { response.writeHead(400, cors); response.end(); return; }
    const frames = body.frames || [];
    record({ atUtc: new Date().toISOString(), testSubstitute: true, readingId: body.readingId,
      videoId: body.videoId, duration: body.duration, frameSize: body.frameSize,
      frameCount: frames.length, courseCodePoints: Array.from(body.courseText || '').length,
      frames: frames.map((frame) => {
        const bytes = decodeJpegDataUrl(frame.image);
        return { time: frame.time, jpegBytes: bytes?.length || 0, jpegSize: bytes ? jpegSize(bytes) : null };
      }) });
    const single = frames.length === 1;
    const point = single ? { id: 'http-test-point', time: frames[0].time,
      lessonLine: 'HTTP 测试替身：验证当前帧流程，不代表模型识别。',
      curve: { requestId: body.readingId + ':http-test-point', videoId: body.videoId,
        time: frames[0].time, frameSize: body.frameSize, source: 'preset', fallback: null,
        definition: structuredClone(preset.definition) } } : null;
    const send = () => {
      if (response.destroyed) return;
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify({ readingId: body.readingId, videoId: body.videoId, duration: body.duration,
        origin: 'external', points: point ? [point] : [], dropped: [] }));
    };
    if (single && frames[0].time === 8) setTimeout(send, 10000);
    else send();
  });
  server.listen(8823, '127.0.0.1', () => console.log('TEST SUBSTITUTE listening on loopback 8823; no model calls'));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
})();
