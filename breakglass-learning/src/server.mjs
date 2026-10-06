import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createAccountStore } from './store.mjs';
import * as checks from './validation.mjs';

const derive = promisify(scrypt);
const COOKIE = 'breakglass_local_session';
const MAX_BODY = 64 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const PAIRING_MS = 120 * 1000;
const PLUGIN_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const DEFAULT_ORIGINS = ['http://127.0.0.1:4173', 'http://localhost:4173'];
const publicUser = (user) => ({ id: user.id, username: user.username });
const tokenKey = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const equals = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const hashPassword = async (password, salt) => (await derive(password, Buffer.from(salt, 'hex'), 64,
  { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
function pathId(value) {
  let id;
  try { id = decodeURIComponent(value); } catch { fail(400, 'invalid_id', '标识编码无效。'); }
  if (!checks.safeId(id)) fail(400, 'invalid_id', '标识无效。');
  return id;
}

function cookieToken(request) {
  const values = String(request.headers.cookie || '').split(';').map((item) => item.trim())
    .filter((item) => item.startsWith(`${COOKIE}=`)).map((item) => item.slice(COOKIE.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    let finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true;
      request.off('data', data); request.off('end', end); request.off('error', errorEvent); request.off('aborted', aborted);
      if (error) reject(error); else resolve(value);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = Object.assign(new Error('请求超过本机学习服务上限。'), { status: 413, code: 'payload_too_large' });
        finish(error); request.resume(); return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      if (size === 0) { finish(null, {}); return; }
      if (String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
        finish(Object.assign(new Error('请求需要 application/json。'), { status: 415, code: 'unsupported_media_type' })); return;
      }
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(Object.assign(new Error('请求不是有效 JSON。'), { status: 400, code: 'invalid_json' })); }
    };
    const errorEvent = () => finish(Object.assign(new Error('请求已断开。'), { status: 400, code: 'invalid_request' }));
    const aborted = () => { errorEvent(); request.once('error', () => {}); };
    request.on('data', data); request.once('end', end); request.once('error', errorEvent); request.once('aborted', aborted);
  });
}

/** Creates only API handling, with no listener or deployment. Local single-process development use. */
export function createLearningHandler({ dataDir, allowedOrigins = DEFAULT_ORIGINS, now = Date.now, onPrivateScopeInvalidated,
  secureCookies = false, authorizeAccount, productionOrigin = null } = {}) {
  if (typeof secureCookies !== 'boolean') throw new TypeError('账户安全cookie开关必须为布尔值。');
  if (authorizeAccount !== undefined && typeof authorizeAccount !== 'function') throw new TypeError('账户发布审批检查必须为函数。');
  if (productionOrigin !== null) {
    let url;
    try { url = typeof productionOrigin === 'string' ? new URL(productionOrigin) : null; } catch { /* Reject below. */ }
    if (!url || url.protocol !== 'https:' || url.origin !== productionOrigin || url.port || url.username || url.password || url.search || url.hash
      || !url.hostname.includes('.') || !/^[a-z0-9.-]+$/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
      || /^\d+(?:\.\d+){3}$/.test(url.hostname) || !secureCookies || typeof authorizeAccount !== 'function'
      || !Array.isArray(allowedOrigins) || allowedOrigins.length !== 1 || allowedOrigins[0] !== productionOrigin) {
      throw new TypeError('生产账户入口须明确唯一HTTPS域名、Secure cookie及账户发布审批检查。');
    }
  } else if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0
    || !allowedOrigins.every((origin) => typeof origin === 'string'
      && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin))) {
    throw new TypeError('本机账户服务只接受明确的 loopback Origin。');
  }
  authorizeAccount ||= () => true;
  const origins = new Set(allowedOrigins);
  if (typeof now !== 'function') throw new TypeError('本机服务时钟必须为函数。');
  const store = createAccountStore({ dataDir, validate: checks.database });
  const sessions = new Map();
  const pairingCodes = new Map();
  const pluginTokens = new Map();
  const pairingRequests = new Map();
  const loginFailures = new Map();
  const requests = new Map();
  const privateScopeListeners = new Set();
  if (onPrivateScopeInvalidated !== undefined) {
    if (typeof onPrivateScopeInvalidated !== 'function') throw new TypeError('私有学习生命周期通知必须为函数。');
    privateScopeListeners.add(onPrivateScopeInvalidated);
  }
  const notifyPrivateScope = async (event) => {
    await Promise.all([...privateScopeListeners].map((listener) => listener({ ...event })));
  };
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64).toString('hex');

  function rate(ip, name = null) {
    const time = now();
    for (const [key, item] of requests) if (time - item.start >= 60000) requests.delete(key);
    for (const [key, item] of loginFailures) if (time - item.start >= 15 * 60000) loginFailures.delete(key);
    const current = requests.get(ip) || { start: time, count: 0 };
    if (current.count >= 20) fail(429, 'rate_limited', '登录请求过于频繁，请稍后重试。');
    current.count += 1; requests.set(ip, current);
    if (name && (loginFailures.get(`${ip}:${name}`)?.count || 0) >= 5) fail(429, 'rate_limited', '登录失败次数过多，请稍后重试。');
  }

  function ratePairing(ip) {
    const time = now();
    for (const [key, item] of pairingRequests) if (time - item.start >= 60000) pairingRequests.delete(key);
    const entry = pairingRequests.get(ip) || { start: time, count: 0 };
    if (entry.count >= 20) fail(429, 'rate_limited', '插件配对请求过于频繁，请稍后重试。');
    entry.count += 1; pairingRequests.set(ip, entry);
  }

  function sweepSessions() {
    const time = now();
    for (const [key, item] of sessions) if (item.expiresAt <= time) sessions.delete(key);
    for (const [key, item] of pairingCodes) {
      if (item.expiresAt <= time || !sessions.has(item.parentKey)) pairingCodes.delete(key);
    }
    for (const [key, item] of pluginTokens) {
      if (item.expiresAt <= time || !sessions.has(item.parentKey)) pluginTokens.delete(key);
    }
  }

  function revokePlugins(userId) {
    for (const [key, item] of pairingCodes) if (item.userId === userId) pairingCodes.delete(key);
    for (const [key, item] of pluginTokens) if (item.userId === userId) pluginTokens.delete(key);
  }

  function assertLive(active) {
    sweepSessions();
    if (active.pluginKey) {
      const paired = pluginTokens.get(active.pluginKey);
      const parent = paired && sessions.get(paired.parentKey);
      if (paired !== active.paired || !parent || parent.userId !== active.user.id) {
        fail(401, 'plugin_disconnected', '插件连接已失效，请在网站重新配对。');
      }
    } else if (sessions.get(active.key) !== active.session) {
      fail(401, 'unauthenticated', '本机账户会话已失效。');
    }
  }

  function sessionFor(request) {
    sweepSessions();
    const token = cookieToken(request);
    return token ? { key: tokenKey(token), session: sessions.get(tokenKey(token)) } : { key: null, session: null };
  }
  async function createSession(user, request) {
    const previous = sessionFor(request);
    if (previous.key) {
      sessions.delete(previous.key);
      if (previous.session) await notifyPrivateScope({ userId: previous.session.userId, sessionKey: previous.key, reason: 'session_replaced' });
    }
    while (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    const session = { userId: user.id, csrfToken: randomBytes(24).toString('base64url'), expiresAt: now() + SESSION_MS };
    sessions.set(tokenKey(token), session);
    return { body: { user: publicUser(user), csrfToken: session.csrfToken, epoch: user.epoch },
      cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_MS / 1000}${secureCookies ? '; Secure' : ''}` };
  }
  async function authenticated(request, mutation = false) {
    const active = sessionFor(request);
    if (!active.session) fail(401, 'unauthenticated', '请登录本机开发账户。');
    if (mutation && !equals(request.headers['x-breakglass-csrf'], active.session.csrfToken)) {
      fail(403, 'csrf_rejected', '写入校验失效，请刷新账户状态。');
    }
    const state = await store.read();
    const user = state.users.find((item) => item.id === active.session.userId);
    if (!user) fail(401, 'unauthenticated', '本机账户会话已失效。');
    return { ...active, user };
  }

  function clientOriginFor(request, claimed) {
    const value = claimed === undefined ? request.headers['x-breakglass-client-origin'] : claimed;
    if (typeof value !== 'string' || !PLUGIN_ORIGIN.test(value)
      || (request.headers.origin !== undefined && request.headers.origin !== value)) {
      fail(403, 'plugin_origin_rejected', '插件请求来源与连接身份不一致。');
    }
    return value;
  }

  async function authenticatedPlugin(request) {
    sweepSessions();
    const clientOrigin = clientOriginFor(request);
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(request.headers.authorization || ''));
    const pluginKey = match ? tokenKey(match[1]) : null;
    const paired = pluginKey && pluginTokens.get(pluginKey);
    const parent = paired && sessions.get(paired.parentKey);
    if (!paired || !parent || paired.clientOrigin !== clientOrigin || parent.userId !== paired.userId) {
      fail(401, 'plugin_disconnected', '插件连接已失效，请在网站重新配对。');
    }
    const state = await store.read();
    const user = state.users.find((item) => item.id === paired.userId);
    if (!user) fail(401, 'plugin_disconnected', '插件连接对应的账户已失效。');
    const active = { pluginKey, paired, user };
    assertLive(active);
    return active;
  }
  function checkEpoch(user, expected) {
    if (!checks.epoch(expected)) fail(400, 'invalid_epoch', '需要当前账户的数据版本。');
    if (user.epoch !== expected) fail(409, 'epoch_conflict', '账户数据已删除或更新，请刷新后重试。');
  }
  function changedEpoch(user) {
    if (user.epoch >= Number.MAX_SAFE_INTEGER - 1) fail(409, 'epoch_exhausted', '本机数据版本已达上限。');
    user.epoch += 1;
  }
  const mutate = async (active, expected, operation) => {
    const result = await store.transact((state) => {
      // A logout/revocation may happen while this transaction waits in the file queue.
      // Recheck the original capability before committing private learning data.
      assertLive(active);
      const user = state.users.find((item) => item.id === active.user.id);
      if (!user) fail(401, 'unauthenticated', '本机账户不存在。');
      checkEpoch(user, expected);
      return operation(user);
    }, { beforeCommit: () => assertLive(active) });
    if (result?.epoch !== undefined && result.epoch !== expected) {
      await notifyPrivateScope({ userId: active.user.id, epoch: result.epoch, reason: 'data_epoch' });
    }
    return result;
  };

  async function saveRecord(active, id, body) {
    if (!checks.exact(body, ['record', 'expectedEpoch'])) fail(400, 'invalid_request', '保存记录需要固定字段。');
    const record = checks.record(body.record);
    if (!record || record.id !== id) fail(400, 'invalid_record', '记录结构、来源或标识无效。');
    return mutate(active, body.expectedEpoch, (user) => {
      const existing = user.records.find((item) => item.id === id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) fail(409, 'record_conflict', '同一标识已有不同记录。');
      if (!existing) {
        if (user.records.length >= 500) fail(409, 'record_limit', '本机账户记录数量已达上限。');
        user.records.push(record);
      }
      return { record: existing || record, epoch: user.epoch };
    });
  }

  async function saveWatch(active, sourceId, body) {
    if (!checks.exact(body, ['source', 'time', 'duration', 'expectedEpoch'])) fail(400, 'invalid_request', '观看记录字段无效。');
    const item = checks.watch({ source: body.source, time: body.time, duration: body.duration, updatedAt: new Date(now()).toISOString() });
    if (!item || item.source.id !== sourceId) fail(400, 'invalid_watch', '观看记录来源或时间无效。');
    return mutate(active, body.expectedEpoch, (user) => {
      const index = user.watch.findIndex((entry) => entry.source.id === sourceId);
      if (index >= 0 && user.watch[index].source.kind !== item.source.kind) fail(409, 'source_conflict', '来源标识属于另一种材料。');
      if (index < 0 && user.watch.length >= 100) fail(409, 'watch_limit', '本机观看记录数量已达上限。');
      if (index >= 0) user.watch[index] = item; else user.watch.push(item);
      return { item, epoch: user.epoch };
    });
  }

  const handle = async function handle(request, response) {
    let url;
    try { url = new URL(request.url || '/', 'http://local-learning.invalid'); }
    catch { return false; }
    if (!url.pathname.startsWith('/api/')) return false;
    const pluginRoute = url.pathname.startsWith('/api/plugin/');
    const origin = request.headers.origin;
    const cors = typeof origin === 'string' && (origins.has(origin) || (pluginRoute && PLUGIN_ORIGIN.test(origin)))
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : { vary: 'Origin' };
    const send = (status, payload, extra = {}) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      response.end(JSON.stringify(payload));
    };
    try {
      const ip = request.socket.remoteAddress || '';
      if (!(ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.'))) {
        fail(403, 'loopback_only', '本机开发账户服务不对公网开放。');
      }
      const mutation = ['POST', 'PUT', 'DELETE'].includes(request.method);
      if (pluginRoute ? (origin !== undefined && (typeof origin !== 'string' || !PLUGIN_ORIGIN.test(origin)))
        : ((typeof origin === 'string' && !origins.has(origin)) || (mutation && !origins.has(origin)))) {
        fail(403, 'forbidden_origin', '账户请求来源未获准。');
      }
      if (request.method === 'OPTIONS') {
        if (pluginRoute ? !PLUGIN_ORIGIN.test(String(origin)) : !origins.has(origin)) fail(403, 'forbidden_origin', '账户请求来源未获准。');
        send(204, {}, { 'access-control-allow-methods': pluginRoute ? 'GET, POST, PUT, OPTIONS' : 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': pluginRoute ? 'content-type, authorization, x-breakglass-client-origin' : 'content-type, x-breakglass-csrf',
          'access-control-max-age': '600' });
        return true;
      }
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) fail(405, 'unsupported_method', '账户接口不接受此方法。');
      const credentialRoute = ['/api/account/register', '/api/account/login'].includes(url.pathname);
      const connecting = url.pathname === '/api/plugin/connect';
      const body = mutation ? await readJson(request, credentialRoute || connecting ? 2048 : MAX_BODY) : null;

      if (pluginRoute) {
        if (connecting && request.method === 'POST') {
          ratePairing(ip);
          if (!checks.exact(body, ['code', 'clientOrigin']) || typeof body.code !== 'string'
            || !/^[A-Za-z0-9_-]{22}$/.test(body.code)) fail(400, 'invalid_pairing_code', '配对请求需要有效代码和插件来源。');
          const clientOrigin = clientOriginFor(request, body.clientOrigin);
          if (request.headers['x-breakglass-client-origin'] !== undefined && request.headers['x-breakglass-client-origin'] !== clientOrigin) {
            fail(403, 'plugin_origin_rejected', '插件来源声明不一致。');
          }
          sweepSessions();
          const codeKey = tokenKey(body.code);
          const pairing = pairingCodes.get(codeKey);
          // Consume before any asynchronous work: concurrent retries cannot mint two tokens.
          pairingCodes.delete(codeKey);
          const parent = pairing && sessions.get(pairing.parentKey);
          if (!pairing || !parent || parent.userId !== pairing.userId) fail(401, 'pairing_expired', '配对码已过期或已使用，请在网站重新生成。');
          const state = await store.read();
          const user = state.users.find((item) => item.id === pairing.userId);
          sweepSessions();
          if (!user || sessions.get(pairing.parentKey) !== parent || pairing.expiresAt <= now()) {
            fail(401, 'pairing_expired', '配对码已过期或账户已退出，请重新生成。');
          }
          if (pluginTokens.size >= 1000 || [...pluginTokens.values()].filter((item) => item.userId === user.id).length >= 16) {
            fail(409, 'plugin_connection_limit', '插件连接数量已达上限，请先撤销已有连接。');
          }
          const token = randomBytes(32).toString('base64url');
          const expiresAt = parent.expiresAt;
          pluginTokens.set(tokenKey(token), { parentKey: pairing.parentKey, userId: user.id, clientOrigin, expiresAt });
          send(200, { token, user: publicUser(user), epoch: user.epoch, expiresAt });
          return true;
        }
        const active = await authenticatedPlugin(request);
        if (url.pathname === '/api/plugin/me' && request.method === 'GET') {
          send(200, { user: publicUser(active.user), epoch: active.user.epoch, expiresAt: active.paired.expiresAt }); return true;
        }
        if (url.pathname === '/api/plugin/disconnect' && request.method === 'POST') {
          if (!checks.exact(body, [])) fail(400, 'invalid_request', '断开请求不接受额外字段。');
          pluginTokens.delete(active.pluginKey); send(200, { ok: true }); return true;
        }
        if (url.pathname === '/api/plugin/records' && request.method === 'GET') {
          send(200, { records: active.user.records, epoch: active.user.epoch }); return true;
        }
        const pairedRecord = /^\/api\/plugin\/records\/([^/]+)$/.exec(url.pathname);
        if (pairedRecord && request.method === 'PUT') {
          send(200, await saveRecord(active, pathId(pairedRecord[1]), body)); return true;
        }
        if (url.pathname === '/api/plugin/watch' && request.method === 'GET') {
          send(200, { items: active.user.watch, epoch: active.user.epoch }); return true;
        }
        const pairedWatch = /^\/api\/plugin\/watch\/([^/]+)$/.exec(url.pathname);
        if (pairedWatch && request.method === 'PUT') {
          send(200, await saveWatch(active, pathId(pairedWatch[1]), body)); return true;
        }
        fail(404, 'plugin_scope_rejected', '插件连接只允许记录和观看位置同步。');
      }

      if (credentialRoute && request.method === 'POST') {
        if (!checks.exact(body, ['username', 'password'])) fail(400, 'invalid_credentials', '请填写用户名和密码。');
        const name = checks.username(body.username);
        if (!name || !checks.password(body.password)) fail(400, 'invalid_credentials', '用户名须为3至32个字母、数字或._-；密码须为8至128字符。');
        rate(ip, url.pathname.endsWith('/login') ? name : null);
        let user;
        if (url.pathname.endsWith('/register')) {
          const passwordSalt = randomBytes(16).toString('hex');
          const passwordHash = await hashPassword(body.password, passwordSalt);
          user = await store.transact((state) => {
            if (state.users.some((item) => item.username === name)) fail(409, 'username_unavailable', '这个本机用户名已被使用。');
            if (state.users.length >= 50) fail(409, 'account_limit', '本机开发账户数量已达上限。');
            const next = { id: randomUUID(), username: name, passwordSalt, passwordHash, epoch: 0, records: [], watch: [], attempts: [], annotations: [] };
            state.users.push(next); return next;
          });
        } else {
          const state = await store.read();
          user = state.users.find((item) => item.username === name);
          const calculated = await hashPassword(body.password, user?.passwordSalt || dummySalt);
          if (!equals(calculated, user?.passwordHash || dummyHash)) {
            const key = `${ip}:${name}`; const entry = loginFailures.get(key) || { start: now(), count: 0 };
            entry.count += 1; loginFailures.set(key, entry);
            fail(401, 'invalid_credentials', '用户名或密码不正确。');
          }
          loginFailures.delete(`${ip}:${name}`);
          if (await authorizeAccount(publicUser(user), 'login') !== true) {
            fail(403, 'release_not_approved', '当前账户的地区与受众发布条件尚未批准。');
          }
        }
        const created = await createSession(user, request);
        send(url.pathname.endsWith('/register') ? 201 : 200, created.body, { 'set-cookie': created.cookie });
        return true;
      }
      if (url.pathname === '/api/account/me' && request.method === 'GET') {
        const active = sessionFor(request);
        if (!active.session) { send(200, { user: null }); return true; }
        const state = await store.read();
        const user = state.users.find((item) => item.id === active.session.userId);
        send(200, user ? { user: publicUser(user), csrfToken: active.session.csrfToken, epoch: user.epoch } : { user: null });
        return true;
      }
      const active = await authenticated(request, mutation);
      if (url.pathname === '/api/account/plugin-pairing' && ['POST', 'DELETE'].includes(request.method)) {
        if (!checks.exact(body, [])) fail(400, 'invalid_request', '插件配对设置不接受额外字段。');
        assertLive(active);
        if (request.method === 'DELETE') {
          revokePlugins(active.user.id); send(200, { ok: true }); return true;
        }
        ratePairing(ip);
        for (const [key, item] of pairingCodes) if (item.parentKey === active.key) pairingCodes.delete(key);
        if (pairingCodes.size >= 1000) fail(409, 'pairing_limit', '待连接配对码数量已达上限，请稍后重试。');
        const code = randomBytes(16).toString('base64url');
        const expiresAt = Math.min(now() + PAIRING_MS, active.session.expiresAt);
        pairingCodes.set(tokenKey(code), { userId: active.user.id, parentKey: active.key, expiresAt });
        send(200, { code, expiresAt, user: publicUser(active.user) }); return true;
      }
      if (url.pathname === '/api/account/logout' && request.method === 'POST') {
        if (!checks.exact(body, [])) fail(400, 'invalid_request', '退出请求不接受额外字段。');
        sessions.delete(active.key);
        await notifyPrivateScope({ userId: active.user.id, sessionKey: active.key, reason: 'logout' });
        send(200, { ok: true }, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secureCookies ? '; Secure' : ''}` });
        return true;
      }
      if (url.pathname === '/api/learning/records' && request.method === 'GET') {
        send(200, { records: active.user.records, epoch: active.user.epoch }); return true;
      }
      if (url.pathname === '/api/annotations' && request.method === 'GET') {
        if (url.search) fail(400, 'invalid_request', '备注列表不接受额外查询参数。');
        assertLive(active);
        send(200, { annotations: active.user.annotations || [], epoch: active.user.epoch }); return true;
      }
      const annotationPath = /^\/api\/annotations\/([^/]+)$/.exec(url.pathname);
      if (annotationPath && ['GET', 'PUT'].includes(request.method)) {
        if (url.search) fail(400, 'invalid_request', '备注接口不接受额外查询参数。');
        const id = pathId(annotationPath[1]);
        if (request.method === 'GET') {
          assertLive(active);
          if (!active.user.records.some((item) => item.id === id)) fail(404, 'record_not_found', '当前账户没有这条原学习记录。');
          send(200, { annotation: (active.user.annotations || []).find((item) => item.recordId === id) || null, epoch: active.user.epoch }); return true;
        }
        if (!checks.exact(body, ['annotation', 'expectedRevision', 'expectedEpoch']) || !checks.epoch(body.expectedRevision)) {
          fail(400, 'invalid_request', '备注保存需要固定字段、修订号和当前数据版本。');
        }
        const metadata = checks.annotationMetadata(body.annotation);
        if (!metadata) fail(400, 'invalid_annotation', '备注只接受标题、短文本、疑问/易错类型和最多8个原因标签。');
        const result = await mutate(active, body.expectedEpoch, (user) => {
          if (!user.records.some((item) => item.id === id)) fail(404, 'record_not_found', '当前账户没有这条原学习记录。');
          user.annotations ||= [];
          const existing = user.annotations.find((item) => item.recordId === id);
          if (checks.sameAnnotationMetadata(existing, metadata)) return { annotation: existing, epoch: user.epoch };
          const revision = existing?.revision || 0;
          if (revision !== body.expectedRevision) fail(409, 'revision_conflict', '备注已在另一处更新；请保留输入并重新读取修订后再保存。');
          if (revision >= Number.MAX_SAFE_INTEGER - 1) fail(409, 'revision_exhausted', '备注修订次数已达上限。');
          const annotation = checks.annotation({ schemaVersion: '1', recordId: id, revision: revision + 1, ...metadata, updatedAt: new Date(now()).toISOString() });
          if (!annotation) fail(400, 'invalid_annotation', '备注生成无效。');
          user.annotations = [...user.annotations.filter((item) => item.recordId !== id), annotation];
          return { annotation, epoch: user.epoch };
        });
        send(200, result); return true;
      }
      const recordPath = /^\/api\/learning\/records\/([^/]+)$/.exec(url.pathname);
      if (recordPath && ['PUT', 'DELETE'].includes(request.method)) {
        const id = pathId(recordPath[1]);
        if (request.method === 'PUT') {
          send(200, await saveRecord(active, id, body)); return true;
        }
        if (!checks.exact(body, ['expectedEpoch'])) fail(400, 'invalid_request', '删除记录需要当前数据版本。');
        const result = await mutate(active, body.expectedEpoch, (user) => {
          if (!user.records.some((item) => item.id === id)) fail(404, 'record_not_found', '当前账户没有这条记录。');
          user.records = user.records.filter((item) => item.id !== id);
          user.attempts = user.attempts.filter((item) => item.recordId !== id);
          if (user.annotations) user.annotations = user.annotations.filter((item) => item.recordId !== id);
          changedEpoch(user); return { ok: true, epoch: user.epoch };
        });
        send(200, result); return true;
      }
      if (url.pathname === '/api/learning/records' && request.method === 'DELETE') {
        if (!checks.exact(body, ['expectedEpoch'])) fail(400, 'invalid_request', '清除记录需要当前数据版本。');
        const result = await mutate(active, body.expectedEpoch, (user) => {
          user.records = []; user.attempts = []; if (user.annotations) user.annotations = [];
          changedEpoch(user); return { ok: true, epoch: user.epoch };
        });
        send(200, result); return true;
      }
      if (url.pathname === '/api/learning/watch' && request.method === 'GET') {
        send(200, { items: active.user.watch, epoch: active.user.epoch }); return true;
      }
      const watchPath = /^\/api\/learning\/watch\/([^/]+)$/.exec(url.pathname);
      if (watchPath && request.method === 'PUT') {
        send(200, await saveWatch(active, pathId(watchPath[1]), body)); return true;
      }
      if (url.pathname === '/api/learning/attempts' && request.method === 'GET') {
        if ([...url.searchParams.keys()].some((key) => key !== 'recordId') || url.searchParams.getAll('recordId').length > 1) fail(400, 'invalid_request', '复练查询字段无效。');
        const id = url.searchParams.get('recordId');
        if (id !== null && !checks.safeId(id)) fail(400, 'invalid_id', '记录标识无效。');
        send(200, { attempts: id === null ? active.user.attempts : active.user.attempts.filter((item) => item.recordId === id), epoch: active.user.epoch }); return true;
      }
      if (url.pathname === '/api/learning/attempts' && request.method === 'POST') {
        if (!checks.exact(body, ['recordId', 'answer', 'hintUsed', 'expectedEpoch']) || !checks.safeId(body.recordId)
          || typeof body.hintUsed !== 'boolean') fail(400, 'invalid_attempt', '复练提交字段无效。');
        const result = await mutate(active, body.expectedEpoch, (user) => {
          const original = user.records.find((item) => item.id === body.recordId);
          if (!original) fail(404, 'record_not_found', '当前账户没有对应练习记录。');
          const verdict = checks.judge(original.template, original.snapshot, body.answer);
          if (!verdict) fail(400, 'invalid_answer', '答案须符合对应练习的数值或顶点 h、k 格式。');
          if (user.attempts.length >= 2000) fail(409, 'attempt_limit', '本机复练次数已达上限。');
          const attempt = { id: randomUUID(), recordId: original.id, answer: body.answer,
            hintUsed: body.hintUsed, correct: verdict.correct,
            outcome: verdict.correct ? body.hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong', createdAt: new Date(now()).toISOString() };
          user.attempts.push(attempt); return { attempt, expectedAnswer: verdict.expectedAnswer, epoch: user.epoch };
        });
        send(200, result); return true;
      }
      if (url.pathname === '/api/learning/export' && request.method === 'GET') {
        send(200, { schemaVersion: '1', user: publicUser(active.user), epoch: active.user.epoch,
          records: active.user.records, watch: active.user.watch, attempts: active.user.attempts }); return true;
      }
      if (url.pathname === '/api/account/data' && request.method === 'DELETE') {
        if (!checks.exact(body, ['expectedEpoch'])) fail(400, 'invalid_request', '删除账户学习数据需要当前版本。');
        const result = await mutate(active, body.expectedEpoch, (user) => {
          user.records = []; user.watch = []; user.attempts = []; if (user.annotations) user.annotations = [];
          changedEpoch(user); return { ok: true, epoch: user.epoch };
        });
        send(200, result); return true;
      }
      fail(404, 'not_found', '没有这个账户接口。');
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 503;
      send(status, { code: error.code || 'local_storage_unavailable', error: error.status ? error.message : '本机账户服务暂不可用，已有数据未被覆盖。' });
      return true;
    }
  };
  // These capabilities are available only to the same-process analysis gateway.
  // Session hashes never enter API payloads or persistent cache keys.
  handle.privateScope = async (request) => {
    const active = sessionFor(request);
    if (!active.session) return null;
    const state = await store.read();
    if (sessions.get(active.key) !== active.session || active.session.expiresAt <= now()) return null;
    const user = state.users.find((item) => item.id === active.session.userId);
    return user ? { id: user.id, epoch: user.epoch, sessionKey: active.key } : null;
  };
  handle.isPrivateScopeCurrent = async (request, snapshot) => {
    const current = await handle.privateScope(request);
    return snapshot === null ? current === null : Boolean(current && snapshot && current.id === snapshot.id
      && current.epoch === snapshot.epoch && current.sessionKey === snapshot.sessionKey);
  };
  // Recheck immediately before synchronous private-cache commit. Expiry and
  // capacity eviction do not require a lifecycle callback to invalidate it.
  handle.isPrivateScopeLive = (snapshot) => {
    if (!snapshot || typeof snapshot.id !== 'string' || typeof snapshot.sessionKey !== 'string' || !checks.epoch(snapshot.epoch)) return false;
    const session = sessions.get(snapshot.sessionKey); const time = now();
    return Boolean(session && session.userId === snapshot.id && Number.isFinite(time) && session.expiresAt > time
      && store.peekEpoch(snapshot.id) === snapshot.epoch);
  };
  handle.onPrivateScopeInvalidated = (listener) => {
    if (typeof listener !== 'function') throw new TypeError('私有学习生命周期通知必须为函数。');
    privateScopeListeners.add(listener); return () => privateScopeListeners.delete(listener);
  };
  return handle;
}
