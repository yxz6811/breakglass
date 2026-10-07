/**
 * Explicit single-frame reading through the existing /read service.
 * It does not start lesson sampling or change the wake controller's 1500ms budget.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.currentFrame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const DEADLINE_MS = 30000;
  const BODY_LIMIT = 4 * 1024 * 1024;
  const COURSE_LIMIT = 8000;
  const JPEG_PREFIX = 'data:image/jpeg;base64,';
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const MESSAGES = {
    invalid_input: '当前帧或本机阅读地址无效，请检查后重试。',
    payload_too_large: '当前帧请求超过 4 MiB，请缩小画面后重试。',
    model_unconfigured: '本地 reader 尚未配置视觉模型，未识别当前帧。',
    timeout: '当前帧识别已超过 30 秒，旧结果将被丢弃，可以重试。',
    no_curve: '当前帧没有返回可用的抛物线，请换一帧后重试。',
    stale_response: '识别结果不属于本次视频或当前帧，已拒绝。',
    invalid_response: '阅读结果没有通过当前帧校验，未进入交互。',
    provider_error: '本地 reader 未完成当前帧识别，可以重试。',
    network_error: '无法连接本地 reader，当前视频仍保留，请检查地址后重试。'
  };

  function invalid(code = 'invalid_input') {
    const error = new TypeError(MESSAGES[code]);
    error.code = code;
    return error;
  }
  function fields(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return required.every((key) => Object.hasOwn(value, key)) &&
      Reflect.ownKeys(value).every((key) => required.includes(key) || optional.includes(key));
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function filled(value) { return typeof value === 'string' && value.trim().length > 0; }
  // Copy data across browser realms without invoking an inherited toJSON method.
  function clone(value) {
    if (Array.isArray(value)) return Array.from(value, clone);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    }
    return value;
  }

  /**
   * 本机调试只接受回环上的 /read。
   * yangxizhe.com 演示页只接受同源的 /breakglass/read，不改写成根路径。
   * @param {string} raw
   * @returns {string}
   */
  function buildUrl(raw) {
    if (typeof raw !== 'string') throw invalid();
    const value = raw.trim();
    // Empty credentials, queries and fragments must not be silently normalized away.
    if (!value || /[\u0000-\u0020\u007f?#]/.test(value)) throw invalid();
    const authority = value.match(/^https?:\/\/([^/]+)/i);
    if (!authority || authority[1].includes('@')) throw invalid();
    let url;
    try { url = new URL(value); } catch { throw invalid(); }
    if (url.username || url.password || url.search || url.hash) throw invalid();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (local) {
      if (!['http:', 'https:'].includes(url.protocol) || !['/', '/read'].includes(url.pathname)) throw invalid();
      url.pathname = '/read';
      return url.href;
    }
    const hosted = url.protocol === 'https:' &&
      (url.hostname === 'yangxizhe.com' || url.hostname === 'www.yangxizhe.com') &&
      (url.pathname === '/breakglass/read' || url.pathname === '/BreakGlass/read');
    if (!hosted) throw invalid();
    return url.href;
  }

  function jpeg(value) {
    if (typeof value !== 'string' || !value.startsWith(JPEG_PREFIX)) return false;
    const payload = value.slice(JPEG_PREFIX.length);
    if (payload.length < 8 || payload.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || !payload.startsWith('/9j/')) return false;
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const last = payload[payload.length - padding - 1];
    if (padding === 2 && BASE64.indexOf(last) % 16 !== 0) return false;
    if (padding === 1 && BASE64.indexOf(last) % 4 !== 0) return false;
    return payload.length / 4 * 3 - padding <= BODY_LIMIT;
  }

  function requestBody(input) {
    if (!fields(input, ['readingId', 'videoId', 'duration', 'frameSize', 'courseText', 'frames']) ||
        !filled(input.readingId) || !filled(input.videoId) || input.videoId === 'fixture-parabola' ||
        !finite(input.duration) || input.duration <= 0 ||
        !fields(input.frameSize, ['width', 'height']) ||
        !Number.isSafeInteger(input.frameSize.width) || input.frameSize.width <= 0 ||
        !Number.isSafeInteger(input.frameSize.height) || input.frameSize.height <= 0 ||
        typeof input.courseText !== 'string' || Array.from(input.courseText).length > COURSE_LIMIT ||
        !Array.isArray(input.frames) || input.frames.length !== 1) throw invalid();
    const frame = input.frames[0];
    if (!fields(frame, ['time', 'image']) || !finite(frame.time) ||
        frame.time < 0 || frame.time > input.duration) throw invalid();
    if (typeof frame.image === 'string' && frame.image.length > BODY_LIMIT) throw invalid('payload_too_large');
    if (!jpeg(frame.image)) throw invalid();
    const body = clone(input);
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > BODY_LIMIT) throw invalid('payload_too_large');
    return body;
  }

  function envelopeMatches(body, payload) {
    return fields(payload, ['readingId', 'videoId', 'duration', 'origin', 'points'], ['dropped']) &&
      payload.readingId === body.readingId && payload.videoId === body.videoId &&
      payload.duration === body.duration && payload.origin === 'external' &&
      Array.isArray(payload.points) && (!Object.hasOwn(payload, 'dropped') ||
        (Array.isArray(payload.dropped) && payload.dropped.every((item) =>
          fields(item, ['reason']) && filled(item.reason))));
  }
  function curveShape(curve) {
    if (!fields(curve, ['requestId', 'videoId', 'time', 'frameSize', 'source', 'fallback', 'definition'], ['confidence']) ||
        !fields(curve.frameSize, ['width', 'height']) ||
        !fields(curve.definition, ['equationId', 'parameters', 'dragParameter', 'domain', 'range', 'yAxis', 'region'])) return false;
    const definition = curve.definition;
    return definition.equationId === 'fixture.parabola' &&
      fields(definition.parameters, ['a', 'h', 'k']) &&
      Object.values(definition.parameters).every((parameter) => fields(parameter, ['initial', 'min', 'max', 'step'])) &&
      fields(definition.domain, ['min', 'max']) && fields(definition.range, ['min', 'max']) &&
      fields(definition.region, ['x', 'y', 'width', 'height']);
  }
  function validator() {
    const live = root.BreakGlass && root.BreakGlass.lesson && root.BreakGlass.lesson.validateLessonReading;
    if (typeof live === 'function') return live;
    if (typeof require === 'function') {
      try { return require('../lesson/reading').validateLessonReading; } catch { return null; }
    }
    return null;
  }

  function acceptResponse(body, payload) {
    try {
      const request = requestBody(body);
      if (!envelopeMatches(request, payload) || payload.points.length !== 1) return null;
      const point = payload.points[0];
      const time = request.frames[0].time;
      if (!fields(point, ['id', 'time', 'lessonLine', 'curve']) || !filled(point.id) ||
          point.time !== time || !curveShape(point.curve)) return null;
      const curve = point.curve;
      if (curve.requestId !== request.readingId + ':' + point.id ||
          curve.videoId !== request.videoId || curve.time !== time ||
          curve.frameSize.width !== request.frameSize.width || curve.frameSize.height !== request.frameSize.height ||
          curve.source !== 'preset' || curve.fallback !== null) return null;
      const validate = validator();
      if (!validate) return null;
      const verdict = validate(payload, request.frameSize, {
        readingId: request.readingId, videoId: request.videoId, duration: request.duration,
        frameSize: request.frameSize, sampleTimes: [time]
      });
      return verdict.ok && verdict.points.length === 1 ? clone(verdict.points[0]) : null;
    } catch { return null; }
  }

  function startRead(options) {
    const settings = options || {};
    const onSuccess = typeof settings.onSuccess === 'function' ? settings.onSuccess : () => {};
    const onFailure = typeof settings.onFailure === 'function' ? settings.onFailure : () => {};
    const clock = settings.clock && typeof settings.clock.schedule === 'function' && typeof settings.clock.clear === 'function'
      ? settings.clock : { schedule: (delay, handler) => setTimeout(handler, delay), clear: (handle) => clearTimeout(handle) };
    const fetchImpl = typeof settings.fetchImpl === 'function' ? settings.fetchImpl
      : (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    const abort = new AbortController();
    let settled = false;
    let timer = null;
    function fail(code) {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clear(timer);
      abort.abort();
      onFailure({ code, message: MESSAGES[code] });
    }
    const handle = { cancel() {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clear(timer);
      abort.abort();
    } };
    let body;
    let url;
    try {
      url = buildUrl(settings.url);
      body = requestBody(settings.body);
      if (!fetchImpl) throw invalid();
    } catch (error) {
      fail(error && error.code === 'payload_too_large' ? 'payload_too_large' : 'invalid_input');
      return handle;
    }
    timer = clock.schedule(DEADLINE_MS, () => fail('timeout'));
    Promise.resolve().then(() => {
      if (settled) return null;
      return fetchImpl(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: abort.signal
      });
    }).then(async (response) => {
      if (settled) return;
      if (!response) { fail('network_error'); return; }
      if (response.ok !== true) {
        fail(response.status === 503 ? 'model_unconfigured' : response.status === 413 ? 'payload_too_large' : 'provider_error');
        return;
      }
      if (typeof response.json !== 'function') { fail('invalid_response'); return; }
      let payload;
      try { payload = await response.json(); } catch { fail('invalid_response'); return; }
      if (settled) return;
      if (!envelopeMatches(body, payload)) { fail('stale_response'); return; }
      if (payload.points.length === 0) { fail('no_curve'); return; }
      const point = acceptResponse(body, payload);
      if (!point) { fail('invalid_response'); return; }
      settled = true;
      if (timer !== null) clock.clear(timer);
      onSuccess(point);
    }).catch(() => fail('network_error'));
    return handle;
  }

  return { DEADLINE_MS, BODY_LIMIT, COURSE_LIMIT, buildUrl, requestBody, acceptResponse, startRead };
});
