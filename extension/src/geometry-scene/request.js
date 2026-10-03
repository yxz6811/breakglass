(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BODY_LIMIT = 4 * 1024 * 1024;
  const DEADLINES = { read: 30000, ask: 10000 };
  function buildUrl(value, kind) {
    if (!Object.hasOwn(DEADLINES, kind)) throw new TypeError('不支持的几何请求。');
    const url = new URL(typeof value === 'string' ? value.trim() : '');
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new TypeError('请填写本机 reader 地址，例如 http://127.0.0.1:8787。');
    }
    url.pathname = '/geometry/' + kind;
    url.search = '';
    url.hash = '';
    return url.href;
  }
  function sameContext(actual, expected) {
    return Boolean(actual && expected && actual.requestId === expected.requestId && actual.videoId === expected.videoId &&
      actual.frameTime === expected.frameTime && actual.sceneRevision === expected.sceneRevision &&
      actual.frameSize && expected.frameSize && actual.frameSize.width === expected.frameSize.width && actual.frameSize.height === expected.frameSize.height);
  }
  function fields(value, required, optional = []) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) => required.includes(key) || optional.includes(key)));
  }
  function acceptResponse(kind, body, payload) {
    if (!payload || payload.schemaVersion !== '1.0.0') return false;
    if (kind === 'read') {
      if (!fields(payload, ['schemaVersion', 'requestId', 'videoId', 'frameTime', 'status', 'scene'], ['code', 'reason'])) return false;
      if (payload.requestId !== body.requestId || payload.videoId !== body.videoId || payload.frameTime !== body.frameTime) return false;
      if (payload.status === 'candidate') return sameContext(payload.scene, { ...body, sceneRevision: 0 });
      return ['unsupported', 'needs_review'].includes(payload.status) && payload.scene === null;
    }
    if (!fields(payload, ['schemaVersion', 'actionRequestId', 'context', 'status', 'actions'], ['code', 'reason']) ||
        !fields(payload.context, ['requestId', 'videoId', 'frameTime', 'frameSize', 'sceneRevision']) ||
        !fields(payload.context.frameSize, ['width', 'height'])) return false;
    return payload.actionRequestId === body.actionRequestId && sameContext(payload.context, body.scene) &&
      ['actions', 'unsupported', 'needs_clarification'].includes(payload.status) && Array.isArray(payload.actions) &&
      (payload.status === 'actions' ? payload.actions.length >= 1 && payload.actions.length <= 2 : payload.actions.length === 0);
  }
  /** One cancellable request, with a separate budget from the legacy curve wake controller. */
  function requestGeometry(options) {
    const settings = options || {};
    const onSuccess = typeof settings.onSuccess === 'function' ? settings.onSuccess : () => {};
    const onFailure = typeof settings.onFailure === 'function' ? settings.onFailure : () => {};
    const clock = settings.clock || { schedule: (delay, handler) => setTimeout(handler, delay), clear: (handle) => clearTimeout(handle) };
    const fetchImpl = settings.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    const controller = new AbortController();
    let settled = false;
    let timer = null;
    function finish(error, payload) {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clear(timer);
      if (error) { controller.abort(); onFailure(error); }
      else onSuccess(payload);
    }
    const handle = { cancel() {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clear(timer);
      controller.abort();
    } };
    let url;
    let text;
    try {
      url = buildUrl(settings.url, settings.kind);
      text = JSON.stringify(settings.body);
      if (typeof text !== 'string') throw new TypeError('请提供有效的几何请求。');
      if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) throw new TypeError('请求超过 4 MiB，请缩小当前帧。');
      if (!fetchImpl) throw new TypeError('当前浏览器不能发送请求。');
    } catch (error) {
      finish({ code: 'invalid_input', message: error.message || '请求无效。' });
      return handle;
    }
    const timeout = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0 && settings.timeoutMs <= 300000
      ? settings.timeoutMs : DEADLINES[settings.kind];
    timer = clock.schedule(timeout, () => finish({ code: 'timeout', message: '本次请求已超时，视频和已确认的条件仍保留，可以重试。' }));
    Promise.resolve().then(() => {
      if (settled) return null;
      return fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal: controller.signal });
    }).then(async (response) => {
      if (!response || settled) return;
      if (!response.ok) {
        const code = response.status === 503 ? 'model_unconfigured' : response.status === 413 ? 'payload_too_large' : 'provider_error';
        const message = response.status === 503 ? '本地服务尚未配置模型，可以先用手动条件探索。' : response.status === 413 ? '请求超过服务上限，请缩小当前帧。' : '本地服务未完成请求，可以重试或使用手动条件。';
        finish({ code, message });
        return;
      }
      const payload = await response.json();
      if (settled) return;
      if (!acceptResponse(settings.kind, settings.body, payload)) {
        finish({ code: 'stale_response', message: '结果与本次题目或当前帧不匹配，已拒绝。' });
        return;
      }
      finish(null, payload);
    }).catch(() => finish({ code: 'network_error', message: '无法连接本地 reader，视频和已确认的条件仍保留。' }));
    return handle;
  }
  return { buildUrl, sameContext, acceptResponse, requestGeometry, BODY_LIMIT, DEADLINES };
});
