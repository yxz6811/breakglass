/**
 * 几何自动阅读只发到本机 reader 的 /geometry/lesson。
 * 页面不携带模型指令或密钥。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryLessonRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BODY_LIMIT = 10 * 1024 * 1024;
  const DEADLINE_MS = 300000;

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function buildLessonUrl(value) {
    const url = new URL(typeof value === 'string' ? value.trim() : '');
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new TypeError('请填写本机阅读地址。');
    }
    url.pathname = '/geometry/lesson';
    url.search = '';
    url.hash = '';
    return url.href;
  }

  /**
   * @param {object} input
   * @param {{ ok: boolean, courseText: string }} course
   * @returns {object}
   */
  function requestBody(input, course) {
    const source = input || {};
    const frames = (Array.isArray(source.frames) ? source.frames : []).slice(0, 8).map((frame) => ({
      time: frame && typeof frame.time === 'number' ? frame.time : 0,
      image: frame && typeof frame.image === 'string' ? frame.image : ''
    }));
    return {
      schemaVersion: '1.0.0',
      readingId: source.readingId,
      videoId: source.videoId,
      duration: source.duration,
      frameSize: source.frameSize,
      courseText: course && course.ok ? course.courseText : '',
      frames
    };
  }

  /**
   * @param {object} options
   * @returns {{ promise: Promise<object>, cancel: () => void }}
   */
  function postLesson(options) {
    const settings = options || {};
    const clock = settings.clock || { schedule: (delay, handler) => setTimeout(handler, delay), clear: (id) => clearTimeout(id) };
    const fetchImpl = settings.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    const controller = new AbortController();
    let settled = false;
    let timer = null;
    /** @type {(value: { ok: true, payload: object } | { ok: false, code: string, message: string }) => void} */
    let finish = () => {};
    const promise = new Promise((resolve) => {
      finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clock.clear(timer);
        resolve(value);
      };
    });
    const handle = {
      promise,
      cancel() {
        controller.abort();
        finish({ ok: false, code: 'cancelled', message: '已取消阅读。已经存下的点还在。' });
      }
    };
    let url = '';
    let text = '';
    try {
      url = buildLessonUrl(settings.url);
      text = JSON.stringify(settings.body);
      if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) throw new TypeError('这次画面太大。');
      if (!fetchImpl) throw new TypeError('当前浏览器不能发送请求。');
    } catch (error) {
      finish({ ok: false, code: 'invalid_input', message: error instanceof TypeError ? error.message : '请求无效。' });
      return handle;
    }
    timer = clock.schedule(DEADLINE_MS, () => {
      controller.abort();
      finish({ ok: false, code: 'timeout', message: '这次没读完。这支片子留在画面上。' });
    });
    Promise.resolve().then(() => {
      if (settled) return null;
      return fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
        signal: controller.signal
      });
    }).then(async (response) => {
      if (!response || settled) return;
      if (!response.ok) {
        const code = response.status === 503 ? 'model_unconfigured' : response.status === 413 ? 'payload_too_large' : 'provider_error';
        const message = response.status === 503
          ? '本地阅读服务还没有配置模型。这支片子留在画面上。'
          : '外部阅读没有返回可用结果。这支片子留在画面上。';
        finish({ ok: false, code, message });
        return;
      }
      const payload = await response.json();
      if (settled) return;
      finish({ ok: true, payload });
    }).catch(() => {
      finish({ ok: false, code: 'network_error', message: '外部阅读没有返回可用结果。这支片子留在画面上。' });
    });
    return handle;
  }

  return { BODY_LIMIT, DEADLINE_MS, buildLessonUrl, requestBody, postLesson };
});
