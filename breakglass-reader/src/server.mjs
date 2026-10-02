import http from 'node:http';
import { readLesson } from './read.mjs';

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
function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    request.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        done = true;
        resolve({ ok: false, status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
    request.on('error', () => {
      if (done) return;
      done = true;
      resolve({ ok: false, status: 400 });
    });
  });
}

/**
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {object} payload
 * @param {Record<string, string>} headers
 */
function sendJson(response, status, payload, headers) {
  response.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

/**
 * 建一个阅读服务。只有 POST /read、它的预检、和不带密钥的 GET /health。
 *
 * @param {object} options
 * @param {ReturnType<typeof import('./settings.mjs').loadSettings>} options.settings
 * @param {{ validateLessonReading: Function }} options.pageRules
 * @param {typeof fetch} [options.fetchImpl] 调模型用的 fetch
 * @param {(entry: object) => void} [options.log]
 * @returns {http.Server}
 */
export function createReaderServer({ settings, pageRules, fetchImpl = fetch, log = () => {} }) {
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
    if (url.pathname !== '/read') {
      sendJson(response, 404, { error: '没有这个地址。' }, cors);
      return;
    }
    if (typeof origin === 'string' && !allowed) {
      sendJson(response, 403, { error: '这个页面来源不在允许名单里。' }, cors);
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
      sendJson(response, 405, { error: '只接受 POST。' }, { ...cors, allow: 'POST, OPTIONS' });
      return;
    }
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { error: '请求要用 application/json。' }, cors);
      return;
    }

    const body = await readBody(request);
    if (!body.ok) {
      sendJson(response, body.status, { error: body.status === 413 ? '请求太大。' : '请求没有读完。' }, cors);
      if (body.status === 413) request.destroy();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      sendJson(response, 400, { error: '请求不是 JSON。' }, cors);
      return;
    }
    try {
      const result = await readLesson(parsed, { settings, pageRules, fetchImpl, log });
      sendJson(response, result.status, result.payload, cors);
    } catch {
      log({ event: 'crashed' });
      sendJson(response, 500, { error: '阅读服务出错了。' }, cors);
    }
  });
}
