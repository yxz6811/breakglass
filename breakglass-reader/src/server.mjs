import http from 'node:http';
import { readLesson } from './read.mjs';
import { readGeometry } from './geometry-scene.mjs';
import { askGeometry } from './geometry-actions.mjs';
import { readLearning, learningError, LEARNING_BODY_LIMIT } from './learning.mjs';
import { summarizeLearning, LEARNING_SUMMARY_BODY_LIMIT } from './learning-summary.mjs';

/**
 * 8 张 640 宽的 JPEG 加 8000 字课程正文，远小于这个上限。
 */
const BODY_LIMIT = 10 * 1024 * 1024;

/**
 * 读完请求体，超过上限就停。
 *
 * @param {http.IncomingMessage} request
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number }>}
 */
function readBody(request, limit = BODY_LIMIT) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAbort);
      resolve(result);
    };
    const onData = (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        finish({ ok: false, status: 413 });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    const onError = () => finish({ ok: false, status: 400 });
    const onAbort = () => {
      finish({ ok: false, status: 400 });
      // aborted 后流还会报 ECONNRESET，已经结束读取也要接住这次错误。
      request.once('error', () => {});
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAbort);
    if (request.destroyed) onError();
  });
}

/**
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {object} payload
 * @param {Record<string, string>} headers
 */
function sendJson(response, status, payload, headers) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

/**
 * 既有/read与独立几何端点，均沿用来源白名单与不带密钥的/health。
 *
 * @param {object} options
 * @param {ReturnType<typeof import('./settings.mjs').loadSettings>} options.settings
 * @param {{ validateLessonReading: Function }} options.pageRules
 * @param {typeof fetch} [options.fetchImpl] 调模型用的 fetch
 * @param {(entry: object) => void} [options.log]
 * @returns {http.Server}
 */
export function createReaderServer({ settings, pageRules, fetchImpl = fetch, log = () => {} }) {
  // New learning routes each have one slot; summary cannot block frame recognition.
  const learningSlots = { '/learning/read': false, '/learning/summarize': false };
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://reader.local');
    const origin = request.headers.origin;
    const allowed = typeof origin === 'string' && settings.allowOrigin(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };

    if (url.pathname === '/health' && request.method === 'GET') {
      const modelConfigured = Boolean(settings.baseUrl && settings.apiKey && settings.model);
      sendJson(response, 200, { ok: true, modelConfigured }, cors);
      return;
    }
    const geometry = url.pathname === '/geometry/read' || url.pathname === '/geometry/ask';
    const learning = Object.hasOwn(learningSlots, url.pathname);
    const structured = geometry || learning;
    if (url.pathname !== '/read' && !structured) {
      sendJson(response, 404, { error: '没有这个地址。' }, cors);
      return;
    }
    if (typeof origin === 'string' && !allowed) {
      sendJson(response, 403, { ...(structured ? { code: 'forbidden_origin' } : {}), error: '这个页面来源不在允许名单里。' }, cors);
      return;
    }
    if (request.method === 'OPTIONS') {
      const headers = {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600'
      };
      if (request.headers['access-control-request-private-network'] === 'true') {
        headers['access-control-allow-private-network'] = 'true';
      }
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ...(structured ? { code: 'unsupported_method' } : {}), error: '只接受 POST。' }, { ...cors, allow: 'POST, OPTIONS' });
      return;
    }
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (structured ? contentType.split(';')[0].trim() !== 'application/json' : !contentType.startsWith('application/json')) {
      sendJson(response, 415, { ...(structured ? { code: 'unsupported_media_type' } : {}), error: '请求要用 application/json。' }, cors);
      return;
    }

    if (learning && learningSlots[url.pathname]) {
      const busy = learningError(429, 'busy');
      sendJson(response, busy.status, busy.payload, cors);
      request.resume();
      return;
    }
    if (learning) learningSlots[url.pathname] = true;

    const cancelled = new AbortController();
    const onDisconnect = () => cancelled.abort(new DOMException('阅读请求已断开。', 'AbortError'));
    const onClose = () => {
      // IncomingMessage 的正常 close 也会在请求体读完时触发；响应提前关闭才是客户端取消。
      if (!response.writableEnded) onDisconnect();
    };
    request.once('aborted', onDisconnect);
    response.once('close', onClose);
    try {
      const bodyLimit = url.pathname === '/learning/summarize' ? LEARNING_SUMMARY_BODY_LIMIT
        : learning ? LEARNING_BODY_LIMIT : geometry ? 4 * 1024 * 1024 : BODY_LIMIT;
      const body = await readBody(request, bodyLimit);
      if (cancelled.signal.aborted) return;
      if (!body.ok) {
        sendJson(response, body.status, { ...(structured ? { code: body.status === 413 ? 'payload_too_large' : 'invalid_request' } : {}),
          error: body.status === 413 ? '请求太大。' : '请求没有读完。' }, cors);
        if (body.status === 413) {
          // 几何端点先完成413传输，再关闭连接；不能把拒绝表现成网络重置。
          if (structured) {
            request.resume();
            response.once('finish', () => request.destroy());
          } else request.destroy();
        }
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(body.text);
      } catch {
        sendJson(response, 400, { ...(structured ? { code: 'invalid_json' } : {}), error: '请求不是 JSON。' }, cors);
        return;
      }
      const handler = url.pathname === '/geometry/read' ? readGeometry
        : url.pathname === '/geometry/ask' ? askGeometry
        : url.pathname === '/learning/read' ? readLearning
        : url.pathname === '/learning/summarize' ? summarizeLearning : readLesson;
      const result = await handler(parsed, { settings, pageRules, fetchImpl, log, signal: cancelled.signal });
      if (cancelled.signal.aborted) return;
      sendJson(response, result.status, result.payload, cors);
    } catch {
      if (cancelled.signal.aborted) {
        log({ event: 'cancelled' });
        return;
      }
      log({ event: 'crashed' });
      sendJson(response, 500, { ...(structured ? { code: 'internal_error' } : {}), error: '阅读服务出错了。' }, cors);
    } finally {
      request.off('aborted', onDisconnect);
      response.off('close', onClose);
      if (learning) learningSlots[url.pathname] = false;
    }
  });
}
