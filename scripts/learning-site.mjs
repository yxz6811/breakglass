import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createLearningHandler } from '../breakglass-learning/src/server.mjs';
import { readLearning, checkLearningRead, LEARNING_METADATA_FIELDS, exactLearningFields } from '../breakglass-reader/src/learning.mjs';
import { summarizeLearning, checkLearningSummary } from '../breakglass-reader/src/learning-summary.mjs';
import { readLearningContext, checkLearningContext, LEARNING_CONTEXT_PROMPT } from '../breakglass-reader/src/learning-context.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
import { createAnalysisCache, contextCacheIdentity } from './analysis-cache.mjs';
import { createAudioHandler, loadAudioSettings } from './learning-audio.mjs';
import { validateSupplierRuntime } from './learning-release.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const textContext = createRequire(import.meta.url)('../extension/src/plugin/video-context.js');
const progressiveRules = createRequire(import.meta.url)('../learning-site/analysis-cache.js');
const GUEST_COOKIE = 'breakglass_analysis_guest';
export const FILE_LIMITS = Object.freeze({ maxBytes: 64 * 1024 * 1024, maxDuration: 600, maxWidth: 1920, maxHeight: 1080 });
const fixtures = [
  { file: 'extension/assets/video/geometry/triangle-3-4-5.mp4', title: '自制直角三角形课程', duration: 12,
    subtitle: 'extension/assets/video/geometry/triangle-3-4-5.zh.vtt' },
  { file: 'extension/assets/video/breakglass-demo-9s.mp4', title: '自制抛物线课程', duration: 9.383333 }
];
const extensions = ['src/ui/theme.css', 'src/geometry/content-rect.js', 'src/curve/evaluate.js',
  'src/geometry-scene/validate.js', 'src/geometry-scene/solve.js', 'src/geometry-scene/actions.js',
  'src/plugin/contracts.js', 'src/plugin/live-loop.js', 'src/plugin/frame-sampler.js', 'src/plugin/particle-renderer.js',
  'src/plugin/overlay.js', 'src/plugin/overlay.css', 'src/plugin/video-context.js', 'src/plugin/math-learning.js'].map((file) => '/extension/' + file);
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
    let context = null;
    if (fixture.subtitle) {
      const text = fs.readFileSync(path.join(root, fixture.subtitle), 'utf8');
      const parsed = textContext.parseTextCues(text, { format: 'vtt' });
      if (!parsed.ok) throw new Error('登记的自制字幕无效。');
      context = { id: 'subtitle-' + createHash('sha256').update(text).digest('hex'), title: '项目作者编写的中文字幕（非音轨识别）', cues: parsed.cues };
    }
    return [id, { source: { kind: 'local-file', id, version: '1', analysisVersion: '1', materialMode: 'self-authored', title: fixture.title }, duration: fixture.duration, context, filePath: path.join(root, fixture.file) }];
  }));
}
export function createLearningSiteServer({ settings = loadSettings({}), audioSettings = loadAudioSettings({}), audioExtractImpl, dataDir, fetchImpl = fetch,
  allowedOrigins = ['http://localhost:4174', 'http://127.0.0.1:4174',
    'http://localhost:8765', 'http://127.0.0.1:8765'], releasePolicy = null } = {}) {
  if (releasePolicy && (releasePolicy.mode !== 'production-pilot' || releasePolicy.secureCookies !== true
    || !['checkRequest', 'authorizeAccount', 'authorizeScope'].every((key) => typeof releasePolicy[key] === 'function')
    || allowedOrigins.length !== 1 || allowedOrigins[0] !== releasePolicy.publicOrigin)) {
    throw new TypeError('生产入口须提供完整已检查发布配置和唯一HTTPS来源。');
  }
  if (releasePolicy) validateSupplierRuntime(settings, audioSettings);
  const sources = registeredSources();
  const sessions = new Map();
  const slots = { read: false, summarize: false };
  const supplierFetch = releasePolicy ? (url, options = {}) => fetchImpl(url, { ...options, redirect: 'error' }) : fetchImpl;
  const account = createLearningHandler({ dataDir, allowedOrigins, secureCookies: Boolean(releasePolicy),
    ...(releasePolicy ? { authorizeAccount: releasePolicy.authorizeAccount, productionOrigin: releasePolicy.publicOrigin } : {}) });
  const audio = createAudioHandler({ sources, settings: audioSettings, allowedOrigins, account,
    authorizeScope: releasePolicy?.authorizeScope,
    ...(audioExtractImpl ? { extractImpl: audioExtractImpl } : {}), fetchImpl: supplierFetch });
  const cache = createAnalysisCache({ dataDir });
  const guests = new Set();
  const configured = Boolean(settings.baseUrl && settings.apiKey && settings.model);
  const providerVersion = 'provider-' + createHash('sha256').update(JSON.stringify({ baseUrl: settings.baseUrl,
    model: settings.model, jsonMode: settings.jsonMode, configured, prompt: LEARNING_CONTEXT_PROMPT, algorithm: 'progressive-context-v1' })).digest('hex');
  function guestId(request, response, create = false) {
    const values = String(request.headers.cookie || '').split(';').map((item) => item.trim())
      .filter((item) => item.startsWith(GUEST_COOKIE + '='));
    const found = values.length === 1 ? values[0].slice(GUEST_COOKIE.length + 1) : null;
    if (found && /^[0-9a-f-]{36}$/.test(found) && guests.has(found)) return found;
    if (!create) return null;
    const id = randomUUID(); while (guests.size >= 1000) guests.delete(guests.values().next().value); guests.add(id);
    response.setHeader('set-cookie', `${GUEST_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/api/vision${releasePolicy ? '; Secure' : ''}`); return id;
  }
  async function privateOwner(request, response, createGuest = false) {
    const active = await account.privateScope(request);
    if (active) return { active, scope: { kind: 'account', id: active.id, epoch: active.epoch } };
    const id = guestId(request, response, createGuest);
    return id ? { active: null, scope: { kind: 'guest', id, epoch: 0 } } : null;
  }
  async function ownerCurrent(request, owner) {
    return owner && await account.isPrivateScopeCurrent(request, owner.active)
      && (!releasePolicy || await releasePolicy.authorizeScope(owner.scope))
      && (owner.scope.kind === 'account' || guestId(request, null) === owner.scope.id);
  }
  const sameOwner = (left, right) => left && right && left.kind === right.kind && left.id === right.id;
  const detachAccount = account.onPrivateScopeInvalidated(async (event) => {
    for (const [id, session] of sessions) if (session.owner?.scope.kind === 'account'
      && session.owner.scope.id === event.userId && (!event.sessionKey || session.owner.active.sessionKey === event.sessionKey)) {
      session.controllers.forEach((controller) => controller.abort()); sessions.delete(id);
    }
    if (event.epoch !== undefined) await cache.clear({ kind: 'account', id: event.userId });
  });
  const knownStatic = new Set([...extensions, ...brand, ...fixtures.map((item) => '/' + item.file)]);
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 20000 }, async (request, response) => {
    let uri;
    try { uri = new URL(request.url, 'http://localhost'); } catch { response.writeHead(400); response.end(); return; }
    // Loopback only, including Host checks to reject DNS rebinding.
    if (releasePolicy ? !releasePolicy.checkRequest(request)
      : !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(String(request.headers.host))) {
      json(response, 403, { error: releasePolicy ? 'HTTPS入口与发布配置不符。' : '仅本机开发访问。' }); return;
    }
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('cross-origin-opener-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (releasePolicy) response.setHeader('strict-transport-security', 'max-age=31536000');
    if (uri.pathname === '/api/deployment' && request.method === 'GET') {
      json(response, 200, { mode: releasePolicy ? 'production-pilot' : 'local-development',
        registrationEnabled: !releasePolicy, publicDeploymentVerified: false, pluginConnectionMode: 'local-only',
        explanation: releasePolicy ? '已配置的单实例试点；账户须获运营发布审批。实际托管与地区验收记录另行提供。' : '本机开发验证；未部署为公网跨设备服务。' }); return;
    }
    if (releasePolicy && uri.pathname.startsWith('/api/')) {
      if (uri.pathname === '/api/account/register' || uri.pathname.startsWith('/api/plugin/') || uri.pathname === '/api/account/plugin-pairing') {
        json(response, 403, { code: 'release_not_approved', error: '试点只允许已审批账户；公网插件连接须另冻结具体地址和权限。' }); return;
      }
      if (!['/api/account/login', '/api/account/me'].includes(uri.pathname)) {
        try {
          const scope = await account.privateScope(request);
          if (!scope || !(await releasePolicy.authorizeScope(scope))) { json(response, 403, { code: 'release_not_approved', error: '请使用具备当前地区和受众审批的账户登录。' }); return; }
        } catch { json(response, 503, { code: 'release_unavailable', error: '发布审批状态暂时无法验证。' }); return; }
      }
    }
    if (uri.pathname.startsWith('/api/audio/')) { await audio(request, response); return; }
    if (uri.pathname.startsWith('/api/vision/')) {
      try {
        if (uri.pathname === '/api/vision/config' && request.method === 'GET') {
          json(response, 200, { supplierConfigured: configured, mode: releasePolicy ? 'production-pilot' : 'local-development', configuration: 'server-environment', audioEnabled: audio.config().configured, fullVideoUploadEnabled: false,
            progressiveLimits: progressiveRules.LIMITS, providerVersion }); return;
        }
        if (uri.pathname === '/api/vision/policy' && request.method === 'GET') {
          const registered = sources.get(uri.searchParams.get('sourceId'));
          json(response, 200, { allowed: Boolean(registered), ...(registered ? { source: registered.source,
            context: registered.context ? { id: registered.context.id, title: registered.context.title } : null } : {}),
            reason: registered ? '匹配登记的自制教学素材；仅画面处理，私有使用。' : '未登记AI处理许可；文件可本地预览，并可输入你自己的通用数学条件。',
            supplierConfigured: configured, limits: FILE_LIMITS, progressiveLimits: progressiveRules.LIMITS, providerVersion }); return;
        }
        if (request.method !== 'POST') { json(response, 405, { error: '只接受POST。' }); return; }
        if (!allowedOrigins.includes(request.headers.origin)) { json(response, 403, { error: '来源不在本机站点范围。' }); return; }
        if (String(request.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') { json(response, 415, { error: '只接受JSON。' }); return; }
        for (const [id, session] of sessions) if (Date.now() - session.startedAt > 30 * 60 * 1000) {
          session.controllers.forEach((controller) => controller.abort()); sessions.delete(id);
        }
        if (uri.pathname === '/api/vision/cache/clear' || uri.pathname === '/api/vision/cache/clear-guest') {
          const input = await body(request, 1024);
          if (!exactLearningFields(input, [])) { json(response, 400, { error: '清除缓存只接受空对象。' }); return; }
          const guestOnly = uri.pathname === '/api/vision/cache/clear-guest';
          const privateGuest = guestOnly ? guestId(request, response) : null;
          const owner = guestOnly ? (privateGuest ? { scope: { kind: 'guest', id: privateGuest, epoch: 0 } } : null)
            : await privateOwner(request, response);
          if (privateGuest) guests.delete(privateGuest);
          if (owner) {
            for (const [id, session] of sessions) if (sameOwner(session.owner?.scope, owner.scope)) {
              session.controllers.forEach((controller) => controller.abort()); sessions.delete(id);
            }
            await cache.clear(owner.scope);
          }
          json(response, 200, { ok: true }); return;
        }
        if (releasePolicy && !configured && uri.pathname !== '/api/vision/session/end') {
          json(response, 503, { code: 'supplier_not_configured', error: '视觉模型尚未配置；没有创建分析任务或上传画面。' }); return;
        }
        if (uri.pathname === '/api/vision/progressive/session') {
          const input = await body(request, 2048); const registered = sources.get(input?.sourceId);
          if (!exactLearningFields(input, ['sourceId', 'contextSourceId', 'currentTime', 'maxFrames']) || !registered
            || (input.contextSourceId !== null && input.contextSourceId !== registered.context?.id) || input.maxFrames !== 4) {
            json(response, 403, { code: 'permission_pending', error: '来源、登记字幕或冻结采样范围不符。' }); return;
          }
          let plan;
          try { plan = progressiveRules.plan(registered.duration, input.currentTime, input.maxFrames); }
          catch { json(response, 400, { error: '渐进处理时间范围无效。' }); return; }
          if (sessions.size >= 16) { json(response, 429, { error: '本机分析会话已达上限。' }); return; }
          const owner = await privateOwner(request, response, true); const token = randomUUID();
          sessions.set(token, { kind: 'progressive', sourceId: registered.source.id, contextSourceId: input.contextSourceId,
            origin: request.headers.origin, owner, plan, startedAt: Date.now(), context: 0, controllers: new Set() });
          json(response, 200, { token, plan, limits: progressiveRules.LIMITS, cacheScope: owner.scope.kind, providerVersion }); return;
        }
        if (uri.pathname === '/api/vision/session') {
          const input = await body(request, 1024); const registered = sources.get(input?.sourceId);
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !registered) {
            json(response, 403, { code: 'permission_pending', error: '该素材没有已登记的AI处理许可。' }); return;
          }
          if (sessions.size >= 16) { json(response, 429, { error: '本机分析会话已达上限，请先停止其他会话。' }); return; }
          const token = randomUUID();
          const owner = releasePolicy ? await privateOwner(request, response) : null;
          sessions.set(token, { kind: 'classic', sourceId: registered.source.id, origin: request.headers.origin, owner,
            startedAt: Date.now(), read: 0, summarize: 0, context: 0, controllers: new Set() });
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
        const progressive = uri.pathname === '/api/vision/progressive/context';
        const route = uri.pathname === '/api/vision/read' ? 'read' : uri.pathname === '/api/vision/summarize' ? 'summarize'
          : uri.pathname === '/api/vision/context' || progressive ? 'context' : null;
        if (!route) { json(response, 404, { error: '没有此接口。' }); return; }
        const token = request.headers['x-breakglass-visual-session']; const session = sessions.get(token);
        if (!session || session.origin !== request.headers.origin) { json(response, 403, { error: '分析会话已失效。' }); return; }
        if ((session.kind === 'progressive') !== progressive || (session.owner && !await ownerCurrent(request, session.owner))) {
          session.controllers.forEach((controller) => controller.abort()); sessions.delete(token);
          json(response, 403, { code: 'stale_analysis', error: '任务入口或账户状态已改变。' }); return;
        }
        const slot = route === 'context' ? 'read' : route;
        if (slots[slot] || session.controllers.size >= 2) { json(response, 429, { error: '上一轮仍在分析。' }); return; }
        if (!progressive && session[route] >= (route === 'read' ? 32 : route === 'context' ? 4 : 8)) { json(response, 429, { error: '本次调用额度已用完。' }); return; }
        slots[slot] = true; const controller = new AbortController(); session.controllers.add(controller);
        const taskDeadline = progressive ? setTimeout(() => {
          controller.abort(); if (sessions.get(token) === session) sessions.delete(token);
        }, Math.max(1, session.startedAt + progressiveRules.LIMITS.taskMs - Date.now())) : null;
        const disconnect = () => { if (!response.writableEnded) controller.abort(); };
        request.once('aborted', disconnect); response.once('close', disconnect);
        try {
          let input = await body(request, route === 'summarize' ? 65536 : 4 * 1024 * 1024);
          const registered = sources.get(input?.sourceId);
          if (progressive) {
            const window = session.plan.find((item) => item.id === input?.windowId);
            if (!exactLearningFields(input, [...LEARNING_METADATA_FIELDS, 'frames', 'contextSourceId', 'windowId'])
              || !window || input.contextSourceId !== session.contextSourceId || !Array.isArray(input.frames)
              || input.frames.length !== window.times.length || input.frames.some((frame, index) =>
                !Number.isFinite(frame?.frameTime) || Math.abs(frame.frameTime - window.times[index]) > 0.05
                || frame.frameTime < window.start || frame.frameTime >= window.end)) {
              json(response, 400, { error: '片段与任务冻结的采样身份不匹配。' }); return;
            }
            const { windowId, ...metadata } = input; input = metadata;
          }
          const times = route === 'read' ? [input?.frameTime] : route === 'context'
            ? Array.isArray(input?.frames) ? input.frames.map((item) => item?.frameTime) : null
            : Array.isArray(input?.observations) ? input.observations.map((item) => item?.frameTime) : null;
          if (!registered || registered.source.id !== session.sourceId || input.videoVersion !== '1'
            || input.analysisVersion !== '1' || input.materialMode !== 'self-authored' || !Array.isArray(times)
            || !times.every((time) => Number.isFinite(time) && time >= 0 && time <= registered.duration)) {
            json(response, 403, { code: 'permission_pending', error: '素材身份、范围或许可不符。' }); return;
          }
          if (route === 'context') {
            if (!exactLearningFields(input, [...LEARNING_METADATA_FIELDS, 'frames', 'contextSourceId'])
              || (input.contextSourceId !== null && input.contextSourceId !== registered.context?.id)) {
              json(response, 400, { error: '只能使用此素材登记的字幕标识，不能提交任意字幕文本。' }); return;
            }
            const window = input.contextSourceId === null ? { ok: true, cues: [] }
              : textContext.selectCueWindow(registered.context.cues, times[0], times.at(-1));
            if (!window.ok) { json(response, 400, { error: '字幕时间窗无效。' }); return; }
            input = { ...input, cues: window.cues };
          }
          const validation = route === 'read' ? checkLearningRead(input) : route === 'context' ? checkLearningContext(input) : checkLearningSummary(input);
          if (!validation.ok) { json(response, 400, { error: '画面或观察请求结构无效。' }); return; }
          controller.signal.throwIfAborted();
          if (sessions.get(token) !== session) { json(response, 403, { error: '旧分析会话已失效。' }); return; }
          if (session.owner && !await ownerCurrent(request, session.owner)) { json(response, 403, { error: '分析账户或发布审批已失效。' }); return; }
          let cacheIdentity;
          if (progressive) {
            cacheIdentity = contextCacheIdentity(input, providerVersion);
            const cached = await cache.get(session.owner.scope, cacheIdentity);
            if (controller.signal.aborted || sessions.get(token) !== session || !sources.has(input.sourceId)
              || !await ownerCurrent(request, session.owner)) { json(response, 409, { error: '旧账户或素材结果已丢弃。' }); return; }
            if (cached) {
              json(response, 200, { ...cached.value, requestId: input.requestId, cache: { hit: true, stored: true,
                createdAt: cached.createdAt, origin: 'AI片段候选', label: '来自前次AI分析', originalRequestId: cached.value.requestId } }); return;
            }
            if (session.context >= progressiveRules.LIMITS.windows) { json(response, 429, { code: 'budget_exhausted', error: '本任务20次模型调用已用完；未分析片段仍保留缺口。' }); return; }
          }
          session[route] += 1;
          const result = await (route === 'read' ? readLearning : route === 'context' ? readLearningContext : summarizeLearning)(input, { settings, fetchImpl: supplierFetch, signal: controller.signal });
          if (!controller.signal.aborted && sessions.get(token) === session) {
            if (session.owner && !await ownerCurrent(request, session.owner)) { json(response, 409, { error: '账户或发布审批已改变，旧结果已丢弃。' }); return; }
            if (progressive) {
              if (!sources.has(input.sourceId) || !await ownerCurrent(request, session.owner)) { json(response, 409, { error: '账户或素材状态已改变。' }); return; }
              let stored = false;
              if (result.status === 200) stored = await cache.put(session.owner.scope, cacheIdentity, result.payload,
                () => !controller.signal.aborted && sessions.get(token) === session && sources.has(input.sourceId)
                  && (session.owner.scope.kind === 'account' ? account.isPrivateScopeLive(session.owner.active)
                    : guestId(request, null) === session.owner.scope.id)
                  && (!releasePolicy || releasePolicy.authorizeScope(session.owner.scope)));
              if (!controller.signal.aborted && sessions.get(token) === session && await ownerCurrent(request, session.owner)) json(response, result.status,
                { ...result.payload, ...(result.status === 200 ? { cache: { hit: false, stored, createdAt: Date.now(), origin: 'AI片段候选', label: '本次AI分析' } } : {}) });
              else if (!response.destroyed) json(response, 409, { error: '账户、素材或发布审批已改变，旧结果已丢弃。' });
            } else json(response, result.status, result.payload);
          }
        } finally {
          if (taskDeadline) clearTimeout(taskDeadline);
          slots[slot] = false; session.controllers.delete(controller);
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
    guests.clear(); detachAccount(); audio.close();
  });
  // Development operator hook, not an HTTP grant/revoke API. Revocation immediately stops new/old work.
  server.revokeLearningSource = async (sourceId) => {
    sources.delete(sourceId);
    audio.revokeSource(sourceId);
    for (const [id, session] of sessions) if (session.sourceId === sourceId) {
      session.controllers.forEach((controller) => controller.abort()); sessions.delete(id);
    }
    await cache.revokeSource(sourceId);
  };
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createLearningSiteServer({ settings: loadSettings(process.env), audioSettings: loadAudioSettings(process.env), dataDir: process.env.BREAKGLASS_LEARNING_DATA_DIR }).listen(4174, '127.0.0.1',
    () => console.log('本机学习中心：http://localhost:4174/learning-site/index.html；模型配置可留空，原视频不上传。'));
}
