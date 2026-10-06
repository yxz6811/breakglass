import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLearningHandler } from '../breakglass-learning/src/server.mjs';
import { readLearning, checkLearningRead } from '../breakglass-reader/src/learning.mjs';
import { summarizeLearning, checkLearningSummary } from '../breakglass-reader/src/learning-summary.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export const FILE_LIMITS = Object.freeze({ maxBytes: 64 * 1024 * 1024, maxDuration: 600, maxWidth: 1920, maxHeight: 1080 });
const fixtures = [
  { file: 'extension/assets/video/geometry/triangle-3-4-5.mp4', title: '自制直角三角形课程', duration: 12 },
  { file: 'extension/assets/video/breakglass-demo-9s.mp4', title: '自制抛物线课程', duration: 9.383333 }
];
const extensions = ['src/ui/theme.css', 'src/geometry/content-rect.js', 'src/curve/evaluate.js',
  'src/geometry-scene/validate.js', 'src/geometry-scene/solve.js', 'src/geometry-scene/actions.js',
  'src/plugin/contracts.js', 'src/plugin/live-loop.js', 'src/plugin/frame-sampler.js', 'src/plugin/particle-renderer.js',
  'src/plugin/overlay.js', 'src/plugin/overlay.css'].map((file) => '/extension/' + file);
const brand = ['/site/assets/breakglass-brand/logo-aperture-fracture.svg', '/site/assets/breakglass-brand/wordmark-aperture.svg'];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
function json(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request, limit) {
  const parts = []; let size = 0;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      request.off('data', data); request.off('end', end);
      request.off('aborted', aborted); request.off('error', failed);
    };
    const failed = (error) => { cleanup(); reject(error); };
    const aborted = () => failed(Object.assign(new Error('请求已取消。'), { status: 409 }));
    const end = () => { cleanup(); resolve(); };
    const data = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        cleanup(); request.resume();
        reject(Object.assign(new Error('请求超过本次上限。'), { status: 413 }));
      } else parts.push(chunk);
    };
    request.on('data', data); request.once('end', end);
    request.once('aborted', aborted); request.once('error', failed);
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw Object.assign(new Error('请求JSON无效。'), { status: 400 }); }
}
export function registeredSources() {
  return new Map(fixtures.map((fixture) => {
    const sha = createHash('sha256').update(fs.readFileSync(path.join(root, fixture.file))).digest('hex');
    const id = 'file-' + sha;
    return [id, { source: { kind: 'local-file', id, version: '1', analysisVersion: '1', materialMode: 'self-authored', title: fixture.title }, duration: fixture.duration }];
  }));
}
export function createLearningSiteServer({ settings = loadSettings({}), dataDir, fetchImpl = fetch,
  allowedOrigins = ['http://localhost:4174', 'http://127.0.0.1:4174'] } = {}) {
  const sources = registeredSources();
  const sessions = new Map();
  const slots = { read: false, summarize: false };
  const account = createLearningHandler({ dataDir, allowedOrigins });
  const configured = Boolean(settings.baseUrl && settings.apiKey && settings.model);
  const knownStatic = new Set([...extensions, ...brand, ...fixtures.map((item) => '/' + item.file)]);
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 20000 }, async (request, response) => {
    let uri;
    try { uri = new URL(request.url, 'http://localhost'); } catch { response.writeHead(400); response.end(); return; }
    // Loopback only, including Host checks to reject DNS rebinding.
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(String(request.headers.host))) {
      json(response, 403, { error: '仅本机开发访问。' }); return;
    }
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('cross-origin-opener-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (uri.pathname.startsWith('/api/vision/')) {
      try {
        if (uri.pathname === '/api/vision/config' && request.method === 'GET') {
          json(response, 200, { supplierConfigured: configured, mode: 'local-development', configuration: 'server-environment', audioEnabled: false, fullVideoUploadEnabled: false }); return;
        }
        if (uri.pathname === '/api/vision/policy' && request.method === 'GET') {
          const registered = sources.get(uri.searchParams.get('sourceId'));
          json(response, 200, { allowed: Boolean(registered), ...(registered ? { source: registered.source } : {}),
            reason: registered ? '匹配登记的自制教学素材；仅画面处理，私有使用。' : '未登记AI处理许可；文件可本地预览，并可输入你自己的通用数学条件。',
            supplierConfigured: configured, limits: FILE_LIMITS }); return;
        }
        if (request.method !== 'POST') { json(response, 405, { error: '只接受POST。' }); return; }
        if (!allowedOrigins.includes(request.headers.origin)) { json(response, 403, { error: '来源不在本机站点范围。' }); return; }
        if (String(request.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') { json(response, 415, { error: '只接受JSON。' }); return; }
        for (const [id, session] of sessions) if (Date.now() - session.startedAt > 30 * 60 * 1000) {
          session.controllers.forEach((controller) => controller.abort()); sessions.delete(id);
        }
        if (uri.pathname === '/api/vision/session') {
          const input = await body(request, 1024); const registered = sources.get(input?.sourceId);
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !registered) {
            json(response, 403, { code: 'permission_pending', error: '该素材没有已登记的AI处理许可。' }); return;
          }
          if (sessions.size >= 16) { json(response, 429, { error: '本机分析会话已达上限，请先停止其他会话。' }); return; }
          const token = randomUUID();
          sessions.set(token, { sourceId: registered.source.id, origin: request.headers.origin,
            startedAt: Date.now(), read: 0, summarize: 0, controllers: new Set() });
          json(response, 200, { token }); return;
        }
        if (uri.pathname === '/api/vision/session/end') {
          const input = await body(request, 1024); const session = sessions.get(input?.token);
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) {
            json(response, 400, { error: '会话字段无效。' }); return;
          }
          if (session && session.origin === request.headers.origin) {
            session.controllers.forEach((controller) => controller.abort()); sessions.delete(input.token);
          }
          json(response, 200, { ok: true }); return;
        }
        const route = uri.pathname === '/api/vision/read' ? 'read' : uri.pathname === '/api/vision/summarize' ? 'summarize' : null;
        if (!route) { json(response, 404, { error: '没有此接口。' }); return; }
        const token = request.headers['x-breakglass-visual-session']; const session = sessions.get(token);
        if (!session || session.origin !== request.headers.origin) { json(response, 403, { error: '分析会话已失效。' }); return; }
        if (slots[route] || session.controllers.size >= 2) { json(response, 429, { error: '上一轮仍在分析。' }); return; }
        if (session[route] >= (route === 'read' ? 32 : 8)) { json(response, 429, { error: '本次调用额度已用完。' }); return; }
        slots[route] = true; const controller = new AbortController(); session.controllers.add(controller);
        const disconnect = () => { if (!response.writableEnded) controller.abort(); };
        request.once('aborted', disconnect); response.once('close', disconnect);
        try {
          const input = await body(request, route === 'read' ? 4 * 1024 * 1024 : 65536);
          const registered = sources.get(input?.sourceId);
          const times = route === 'read' ? [input?.frameTime] : Array.isArray(input?.observations) ? input.observations.map((item) => item?.frameTime) : null;
          if (!registered || registered.source.id !== session.sourceId || input.videoVersion !== '1'
            || input.analysisVersion !== '1' || input.materialMode !== 'self-authored' || !Array.isArray(times)
            || !times.every((time) => Number.isFinite(time) && time >= 0 && time <= registered.duration)) {
            json(response, 403, { code: 'permission_pending', error: '素材身份、范围或许可不符。' }); return;
          }
          const validation = route === 'read' ? checkLearningRead(input) : checkLearningSummary(input);
          if (!validation.ok) { json(response, 400, { error: '画面或观察请求结构无效。' }); return; }
          controller.signal.throwIfAborted();
          if (sessions.get(token) !== session) { json(response, 403, { error: '旧分析会话已失效。' }); return; }
          session[route] += 1;
          const result = await (route === 'read' ? readLearning : summarizeLearning)(input, { settings, fetchImpl, signal: controller.signal });
          if (!controller.signal.aborted && sessions.get(token) === session) json(response, result.status, result.payload);
        } finally {
          slots[route] = false; session.controllers.delete(controller);
          request.off('aborted', disconnect); response.off('close', disconnect);
        }
      } catch (error) {
        if (!response.destroyed) json(response, error.status || (error.name === 'AbortError' ? 409 : 500),
          { error: error.status ? error.message : '本次分析已取消或服务失败。' });
      }
      return;
    }
    if (uri.pathname.startsWith('/api/')) { await account(request, response); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (uri.pathname === '/') { response.writeHead(302, { location: '/learning-site/index.html' }); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(uri.pathname); } catch { response.writeHead(400); response.end(); return; }
    const allowed = !pathname.includes('\\') && path.posix.normalize(pathname) === pathname
      && (knownStatic.has(pathname) || /^\/learning-site\/[A-Za-z0-9-]+\.(?:html|css|js)$/.test(pathname));
    const file = path.resolve(root, '.' + pathname);
    if (!allowed || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    const size = fs.statSync(file).size; const match = request.headers.range && /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
    const start = match ? Number(match[1]) : 0; const end = match && match[2] ? Number(match[2]) : size - 1;
    if (request.headers.range && (!match || start > end || end >= size)) { response.writeHead(416); response.end(); return; }
    const headers = { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-length': end - start + 1, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    if (match) headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size;
    response.writeHead(match ? 206 : 200, headers);
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(file, { start, end }).pipe(response);
  });
  server.on('close', () => {
    for (const session of sessions.values()) session.controllers.forEach((controller) => controller.abort());
    sessions.clear();
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createLearningSiteServer({ settings: loadSettings(process.env), dataDir: process.env.BREAKGLASS_LEARNING_DATA_DIR }).listen(4174, '127.0.0.1',
    () => console.log('本机学习中心：http://localhost:4174/learning-site/index.html；模型配置可留空，原视频不上传。'));
}
