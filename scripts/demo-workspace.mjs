import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRequest } from '../breakglass-reader/src/read.mjs';
import { checkGeometryRead, geometryRules } from '../breakglass-reader/src/geometry-scene.mjs';
import { checkGeometryAsk } from '../breakglass-reader/src/geometry-actions.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KiB = 1024; const MiB = KiB * KiB;
export const WORKSPACE_LIMITS = Object.freeze({ connections: 64, headers: 32, headerBytes: 8 * KiB,
  uploadMs: 10000, keepAliveMs: 5000, staticBytes: 64 * MiB, staticSlots: 16, apiSlots: 16, readerSlots: 4,
  probeMs: 5000, probeBytes: 4 * KiB, apiMs: 10000, visionMs: 30000, audioMs: 30000,
  apiResponseBytes: 8 * MiB, audioResponseBytes: 64 * KiB, readerResponseBytes: 2 * MiB });
const DEFAULT_ORIGINS = ['http://localhost:8765', 'http://127.0.0.1:8765'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };
// Explicit files only: no repository-wide or directory-based static server.
export const WORKSPACE_STATIC_FILES = Object.freeze([
  'extension/demo/index.html', 'extension/demo/demo.css', 'extension/demo/geometry.html',
  'extension/demo/geometry.css', 'extension/demo/workspace.js', 'extension/demo/workspace.css',
  ...['ui/theme.css', 'ui/dock.css', 'ui/magnify.js', 'ui/liquid-glass.js',
    'curve/validate.js', 'curve/evaluate.js', 'curve/current-frame.js',
    'geometry/content-rect.js', 'geometry/alignment.js', 'geometry/figures.js',
    'session/session.js', 'session/wake.js', 'attempt/simulator.js', 'telemetry/latency.js',
    'preset/load.js', 'preset/place-in-frame.js', 'lesson/reading.js', 'lesson/ask.js',
    'tutor/numbers.js', 'tutor/figures.js', 'tutor/parse.js', 'tutor/ask.js',
    'page/main.js', 'page/geometry.js', 'page/mount-context.js',
    'geometry-scene/validate.js', 'geometry-scene/solve.js', 'geometry-scene/actions.js',
    'geometry-scene/frame.js', 'geometry-scene/request.js', 'geometry-scene/view.js', 'geometry-session/session.js',
    'plugin/contracts.js', 'plugin/recognition-contracts.js', 'plugin/frame-sampler.js', 'plugin/live-loop.js', 'plugin/math-learning.js',
    'plugin/overlay.js', 'plugin/overlay.css', 'plugin/particle-renderer.js', 'plugin/video-context.js',
    'plugin/session.js', 'plugin/registry.js', 'plugin/record-store.js', 'plugin/account-sync.js']
    .map((file) => 'extension/src/' + file),
  'extension/assets/config.json', 'extension/assets/presets/demo-parabola.json',
  'extension/assets/vision/fixture-parabola.json', 'extension/assets/video/breakglass-demo-9s.mp4',
  'extension/assets/video/geometry/triangle-3-4-5.mp4', 'extension/assets/video/geometry/triangle-3-4-5.zh.vtt',
  'extension/assets/video/geometry/triangle-5-12-13.mp4', 'extension/assets/video/geometry/triangle-8-15-17.mp4',
  ...['index.html', 'site.css', 'learning-layer.css', 'account-client.js', 'records.js', 'pedagogy.js',
    'annotations.js', 'annotation-editor.js', 'math-workbench.js', 'math-learning.js', 'import.js',
    'visual-session.js', 'pairing.js', 'context.js', 'analysis-cache.js', 'progressive.js', 'audio.js', 'app.js',
    'learning-flow.js', 'learning-flow-store.js', 'learning-flow-ui.js', 'live-particles.js',
    'learning-evidence.js', 'provenance.js', 'recognition-workbench.js']
    .map((file) => 'learning-site/' + file),
  'site/assets/breakglass-brand/logo-aperture-fracture.svg', 'site/assets/breakglass-brand/wordmark-aperture.svg'
]);
const STATIC = new Set(WORKSPACE_STATIC_FILES.map((file) => '/' + file));
const safeId = (value) => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !/^(?:https?|data|blob|file|chrome-extension):/i.test(value);
const failure = (status, code) => Object.assign(new Error(code), { status, code });
const route = (methods, bytes = 64 * KiB, ms = WORKSPACE_LIMITS.apiMs, query = null) =>
  ({ methods: methods.split(' '), bytes, ms, query, kind: 'api', port: 4174, responseBytes: WORKSPACE_LIMITS.apiResponseBytes });
const API = new Map([
  ['/api/deployment', route('GET')], ['/api/account/register', route('POST', 2 * KiB)],
  ['/api/account/login', route('POST', 2 * KiB)], ['/api/account/me', route('GET')],
  ['/api/account/logout', route('POST')], ['/api/account/plugin-pairing', route('POST DELETE')],
  ['/api/account/data', route('DELETE')], ['/api/learning/records', route('GET DELETE')],
  ['/api/learning/watch', route('GET')], ['/api/learning/attempts', route('GET POST', 64 * KiB, WORKSPACE_LIMITS.apiMs, 'recordId')],
  ['/api/learning/export', route('GET')], ['/api/annotations', route('GET')],
  ['/api/learning/flow', route('GET')], ['/api/learning/flow/exercises', route('POST')],
  ['/api/learning/provenance', route('GET')],
  ['/api/vision/config', route('GET')], ['/api/vision/policy', route('GET', 0, WORKSPACE_LIMITS.apiMs, 'sourceId')],
  ...['session', 'session/end', 'cache/clear', 'cache/clear-guest'].map((name) => ['/api/vision/' + name, route('POST', KiB)]),
  ['/api/vision/progressive/session', route('POST', 2 * KiB)],
  ...['read', 'context', 'progressive/context'].map((name) => ['/api/vision/' + name, route('POST', 4 * MiB, WORKSPACE_LIMITS.visionMs)]),
  ['/api/vision/recognition', { ...route('POST', 4 * MiB, WORKSPACE_LIMITS.visionMs), responseBytes: 64 * KiB }],
  ['/api/vision/summarize', route('POST', 64 * KiB, WORKSPACE_LIMITS.visionMs)],
  ['/api/audio/config', route('GET')],
  ...['session', 'session/end', 'transcribe'].map((name) => ['/api/audio/' + name,
    { ...route('POST', KiB, WORKSPACE_LIMITS.audioMs), responseBytes: WORKSPACE_LIMITS.audioResponseBytes }])
]);
const DYNAMIC = [
  [/^\/api\/learning\/provenance\/([^/]+)$/, route('PUT')],
  [/^\/api\/learning\/records\/([^/]+)$/, route('PUT DELETE')],
  [/^\/api\/learning\/watch\/([^/]+)$/, route('PUT')], [/^\/api\/annotations\/([^/]+)$/, route('GET PUT')],
  [/^\/api\/learning\/flow\/purposes\/([^/]+)$/, route('PUT')],
  [/^\/api\/learning\/flow\/reviews\/([^/]+)$/, route('PUT')],
  [/^\/api\/learning\/flow\/exercises\/([^/]+)\/help$/, route('POST')],
  [/^\/api\/learning\/flow\/exercises\/([^/]+)\/attempts$/, route('POST')]
];
export const READER_ROUTES = Object.freeze({
  '/read': Object.freeze({ bytes: 10 * MiB, ms: 300000 }),
  '/geometry/read': Object.freeze({ bytes: 4 * MiB, ms: 30000 }),
  '/geometry/ask': Object.freeze({ bytes: 4 * MiB, ms: 10000 })
});
function apiRoute(url) {
  let value = API.get(url.pathname);
  if (!value) for (const [pattern, candidate] of DYNAMIC) {
    const match = pattern.exec(url.pathname);
    if (match && safeId(decodeURIComponent(match[1]))) { value = candidate; break; }
  }
  if (!value) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length && (keys.length !== 1 || keys[0] !== value.query || !safeId(url.searchParams.get(keys[0]))))
    throw failure(400, 'invalid_query');
  return value;
}
function securityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function json(response, status, code) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
  response.end(JSON.stringify({ code, error: code === 'service_not_connected' ? '本机服务未连接；当前页面仍可本地预览。' : '本次请求未完成。' }));
}
function parseUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')
    || /[\\\u0000-\u0020\u007f#]/.test(raw)) throw failure(404, 'invalid_path');
  const pathname = raw.split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw failure(404, 'invalid_path'); }
  if (decoded.includes('\\') || decoded.includes('%') || /[\u0000-\u0020\u007f]/.test(decoded)
    || decoded.split('/').some((part) => part === '.' || part === '..') || /%2f/i.test(pathname))
    throw failure(404, 'invalid_path');
  return new URL(raw, 'http://workspace.local');
}
function readBody(request, limit, signal) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let settled = false;
    const finish = (error, bytes) => {
      if (settled) return; settled = true;
      clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', failed);
      signal.removeEventListener('abort', abort);
      if (error) { request.resume(); reject(error); } else resolve(bytes);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > limit) finish(failure(413, 'payload_too_large')); else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks));
    const failed = () => finish(failure(400, 'invalid_request'));
    const abort = () => finish(failure(409, 'request_cancelled'));
    const timer = setTimeout(() => finish(failure(408, 'upload_timeout')), WORKSPACE_LIMITS.uploadMs);
    request.on('data', data); request.once('end', end); request.once('error', failed);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const advertised = request.headers['content-length'];
    if (advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > limit))
      finish(failure(413, 'payload_too_large'));
  });
}
function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure(400, 'invalid_json'); }
}
function allowedFields(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((name) => names.includes(name));
}
function readerBody(pathname, value, rules) {
  if (pathname === '/read') {
    if (!allowedFields(value, ['readingId', 'videoId', 'duration', 'frameSize', 'courseText', 'frames'])
      || (value.frameSize != null && !allowedFields(value.frameSize, ['width', 'height']))
      || !Array.isArray(value.frames) || !value.frames.every((frame) => allowedFields(frame, ['time', 'image']))
      || !checkRequest(value).ok) throw failure(400, 'invalid_request');
  } else if (!(pathname === '/geometry/read' ? checkGeometryRead(value) : checkGeometryAsk(value, rules)).ok)
    throw failure(400, 'invalid_request');
}
function safeCookies(values) {
  return (Array.isArray(values) ? values : values ? [values] : []).filter((value) => {
    const attributes = value.split(';').map((part) => part.trim());
    const name = attributes[0].split('=')[0];
    const paths = attributes.filter((part) => /^path=/i.test(part));
    const expected = name === 'breakglass_local_session' ? '/api' : name === 'breakglass_analysis_guest' ? '/api/vision' : null;
    return expected && paths.length === 1 && paths[0].slice(5) === expected
      && !attributes.some((part) => /^domain=/i.test(part))
      && attributes.some((part) => /^httponly$/i.test(part))
      && attributes.filter((part) => /^samesite=/i.test(part)).length === 1
      && attributes.some((part) => /^samesite=strict$/i.test(part));
  });
}
function exchange(httpRequest, options, bytes, { ms, limit, signal }) {
  return new Promise((resolve, reject) => {
    let outgoing; let incoming; let done = false;
    const finish = (error, value) => {
      if (done) return; done = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { outgoing?.destroy(); incoming?.destroy(); reject(error); } else resolve(value);
    };
    const abort = () => finish(failure(409, 'request_cancelled'));
    const timer = setTimeout(() => finish(failure(504, 'upstream_timeout')), ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      outgoing = httpRequest(options, (response) => {
        incoming = response;
        let size = 0; const chunks = [];
        const contentLength = response.headers['content-length'];
        if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) {
          finish(failure(502, 'upstream_response_too_large')); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] || '')) {
          finish(failure(502, 'invalid_upstream_response')); return;
        }
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) finish(failure(502, 'upstream_response_too_large')); else chunks.push(chunk);
        });
        response.once('error', () => finish(failure(502, 'upstream_disconnected')));
        response.once('aborted', () => finish(failure(502, 'upstream_disconnected')));
        response.once('end', () => {
          const body = Buffer.concat(chunks);
          try { parseJson(body); } catch { finish(failure(502, 'invalid_upstream_response')); return; }
          finish(null, { status: response.statusCode, headers: response.headers, body });
        });
      });
      outgoing.once('error', () => finish(failure(503, 'service_not_connected')));
      outgoing.end(bytes);
    } catch { finish(failure(503, 'service_not_connected')); }
  });
}
function rangeFor(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start; let end;
  if (!match[1]) {
    const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

/** Local development front door only. It never creates account/reader services.
 * httpRequest and publicOrigin are factory-only test hooks; the CLI has no target or origin overrides.
 * publicOrigin may be a function for an ephemeral test listener; it must remain exact HTTP loopback.
 */
export function createDemoWorkspaceServer({ httpRequest = http.request, publicOrigin = null, env = process.env } = {}) {
  if (env.NODE_ENV === 'production' || env.BREAKGLASS_RELEASE_MANIFEST || env.BREAKGLASS_PUBLIC_ORIGIN)
    throw failure(403, 'development_only');
  const rules = geometryRules({ extensionDir: path.join(ROOT, 'extension') });
  const active = { static: 0, api: 0, reader: 0 };
  function origins() {
    if (publicOrigin === null) return DEFAULT_ORIGINS;
    const value = typeof publicOrigin === 'function' ? publicOrigin() : publicOrigin;
    if (!/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9]\d{0,4}$/.test(value || '')
      || Number(new URL(value).port) > 65535) throw failure(403, 'invalid_host');
    return [value];
  }
  if (publicOrigin !== null && typeof publicOrigin !== 'function') origins();
  const server = http.createServer({ maxHeaderSize: WORKSPACE_LIMITS.headerBytes, connectionsCheckingInterval: 1000 }, async (request, response) => {
    securityHeaders(response);
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    request.once('aborted', disconnect); response.once('close', disconnect);
    let kind; let acquired = false;
    try {
      const allowed = origins();
      if (!allowed.some((origin) => new URL(origin).host === request.headers.host)
        || request.rawHeaders.length / 2 > WORKSPACE_LIMITS.headers) throw failure(403, 'invalid_host');
      const origin = request.headers.origin;
      if ((origin !== undefined && (!allowed.includes(origin) || origin !== 'http://' + request.headers.host))
        || (!['GET', 'HEAD'].includes(request.method) && !allowed.includes(origin))) throw failure(403, 'invalid_origin');
      const url = parseUrl(request.url);
      const api = apiRoute(url);
      const reader = Object.hasOwn(READER_ROUTES, url.pathname)
        ? { ...READER_ROUTES[url.pathname], methods: ['POST'], kind: 'reader', port: 8787, responseBytes: WORKSPACE_LIMITS.readerResponseBytes } : null;
      const target = api || reader;
      kind = target?.kind || 'static';
      if (target && !target.methods.includes(request.method)) {
        response.setHeader('allow', target.methods.join(', ')); throw failure(405, 'unsupported_method');
      }
      if (!target && (!['GET', 'HEAD'].includes(request.method) || (url.pathname !== '/' && !STATIC.has(url.pathname)) || url.search))
        throw failure(url.pathname.startsWith('/api/') || !STATIC.has(url.pathname) ? 404 : 405, 'unknown_route');
      if (reader && url.search) throw failure(400, 'invalid_query');
      if (active[kind] >= WORKSPACE_LIMITS[kind + 'Slots']) throw failure(429, 'too_many_requests');
      active[kind]++; acquired = true;
      if (!target) {
        if (url.pathname === '/') { response.writeHead(302, { location: '/extension/demo/index.html' }); response.end(); return; }
        const filename = path.join(ROOT, url.pathname.slice(1));
        let resolved; let stat;
        try { resolved = await fs.promises.realpath(filename); stat = await fs.promises.stat(resolved); }
        catch { throw failure(404, 'unknown_route'); }
        const relative = path.relative(ROOT, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !STATIC.has('/' + relative.split(path.sep).join('/'))
          || !stat.isFile() || stat.size > WORKSPACE_LIMITS.staticBytes)
          throw failure(404, 'unknown_route');
        const selected = rangeFor(request.headers.range, stat.size);
        if (!selected) { response.setHeader('content-range', `bytes */${stat.size}`); throw failure(416, 'invalid_range'); }
        response.writeHead(selected.partial ? 206 : 200, { 'content-type': MIME[path.extname(filename)],
          'accept-ranges': 'bytes', 'content-length': stat.size ? selected.end - selected.start + 1 : 0,
          ...(selected.partial ? { 'content-range': `bytes ${selected.start}-${selected.end}/${stat.size}` } : {}) });
        if (request.method === 'HEAD' || !stat.size) { response.end(); return; }
        await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(resolved, { start: selected.start, end: selected.end });
          const close = () => { stream.destroy(); resolve(); };
          response.once('close', close); response.once('finish', close);
          stream.once('error', reject); stream.pipe(response);
        });
        return;
      }
      const writes = !['GET', 'HEAD'].includes(request.method);
      if (writes && String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json')
        throw failure(415, 'unsupported_media_type');
      const bytes = await readBody(request, writes ? target.bytes : 0, controller.signal);
      if (writes) {
        const input = parseJson(bytes.length ? bytes : Buffer.from('{}'));
        if (reader) readerBody(url.pathname, input, rules);
      }
      if (api) {
        let deployment;
        try { deployment = await exchange(httpRequest, { hostname: '127.0.0.1', port: 4174, path: '/api/deployment',
          method: 'GET', headers: { accept: 'application/json' } }, null,
        { ms: WORKSPACE_LIMITS.probeMs, limit: WORKSPACE_LIMITS.probeBytes, signal: controller.signal }); }
        catch (error) { if (controller.signal.aborted) throw error; throw failure(503, 'service_not_connected'); }
        if (deployment.status !== 200) throw failure(503, 'service_not_connected');
        if (parseJson(deployment.body).mode !== 'local-development') throw failure(403, 'development_only');
      }
      const headers = { accept: 'application/json' };
      for (const name of ['origin', 'content-type', ...(api ? ['cookie', 'x-breakglass-csrf', 'x-breakglass-visual-session'] : [])])
        if (typeof request.headers[name] === 'string') headers[name] = request.headers[name];
      if (writes) headers['content-length'] = bytes.length;
      const result = await exchange(httpRequest, { hostname: '127.0.0.1', port: target.port,
        path: url.pathname + url.search, method: request.method, headers }, bytes.length ? bytes : null,
      { ms: target.ms, limit: target.responseBytes, signal: controller.signal });
      if (api) {
        const cookies = safeCookies(result.headers['set-cookie']);
        if (cookies.length) response.setHeader('set-cookie', cookies);
      }
      response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store', 'content-length': result.body.length });
      response.end(result.body);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, error.code || 'workspace_failed');
      else response.destroy();
    } finally {
      if (acquired) active[kind]--;
      request.off('aborted', disconnect); response.off('close', disconnect);
    }
  });
  server.maxConnections = WORKSPACE_LIMITS.connections;
  server.maxHeadersCount = WORKSPACE_LIMITS.headers + 1;
  server.headersTimeout = WORKSPACE_LIMITS.uploadMs;
  server.requestTimeout = WORKSPACE_LIMITS.uploadMs;
  server.keepAliveTimeout = WORKSPACE_LIMITS.keepAliveMs;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { process.stderr.write('前门不接受上游或来源参数。\n'); process.exitCode = 2; }
  else {
    try {
      const server = createDemoWorkspaceServer();
      server.once('error', () => { process.stderr.write('8765前门未能启动；现有服务未被更改。\n'); process.exitCode = 2; });
      server.listen(8765, '127.0.0.1', () => process.stdout.write('Demo workspace: http://localhost:8765/extension/demo/index.html\nReuses learning gateway 127.0.0.1:4174 and reader 127.0.0.1:8787; no service is started automatically.\n'));
    } catch { process.stderr.write('前门仅支持本机开发模式。\n'); process.exitCode = 2; }
  }
}
