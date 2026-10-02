/**
 * 当次阅读请求。地址由调用方传入，不写进配置，也不访问固定主机。
 * 失败只通知调用方，不进入会话失败。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.lessonAsk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEADLINE_MS = 300000;
  const COURSE_LIMIT = 8000;

  /**
   * 按码点计长度。
   * @param {string} value
   * @returns {number}
   */
  function codePointLength(value) {
    return Array.from(value).length;
  }

  /**
   * 课程说明可空。超长时不保留正文。
   * @param {unknown} text
   * @returns {{ ok: boolean, courseText: string, empty: boolean, message: string }}
   */
  function prepareCourse(text) {
    const value = typeof text === 'string' ? text : '';
    const length = codePointLength(value);
    if (length > COURSE_LIMIT) {
      return {
        ok: false,
        courseText: '',
        empty: false,
        message: '请把课程说明缩短到 8000 字以内。'
      };
    }
    return {
      ok: true,
      courseText: value,
      empty: length === 0,
      message: length === 0 ? '这次没有课程文本。' : ''
    };
  }

  /**
   * 请求体只有阅读编号、视频编号、时长、课程说明和最多 8 张画面。
   * @param {object} input
   * @returns {{ readingId: string, videoId: string, duration: number, courseText: string, frames: { time: number, image: string }[] }}
   */
  function requestBody(input) {
    const source = input || {};
    const course = prepareCourse(source.courseText);
    const raw = Array.isArray(source.frames) ? source.frames : [];
    const frames = raw.slice(0, 8).map((frame) => ({
      time: frame && typeof frame.time === 'number' ? frame.time : 0,
      image: frame && typeof frame.image === 'string' ? frame.image : ''
    }));
    return {
      readingId: source.readingId,
      videoId: source.videoId,
      duration: source.duration,
      courseText: course.ok ? course.courseText : '',
      frames
    };
  }

  /**
   * 响应必须对得上这一次请求，来源标记为 external。
   * @param {object} request
   * @param {object} payload
   * @returns {object | null}
   */
  function acceptResponse(request, payload) {
    if (!request || !payload) return null;
    if (payload.readingId !== request.readingId) return null;
    if (payload.videoId !== request.videoId) return null;
    if (payload.origin !== 'external') return null;
    return payload;
  }

  /**
   * 发起一次阅读。空白地址和夹具视频编号不会发出请求。
   * 取消只停下未完成的请求，不把这次当作失败。
   * @param {{ url?: string, body?: object, fetchImpl?: Function, clock?: { schedule: Function, clear: Function }, onSuccess?: Function, onFailure?: Function }} options
   * @returns {{ cancel: Function }}
   */
  function startLessonAsk(options) {
    const settings = options || {};
    const url = typeof settings.url === 'string' ? settings.url.trim() : '';
    const onFailure = typeof settings.onFailure === 'function' ? settings.onFailure : function () {};
    const onSuccess = typeof settings.onSuccess === 'function' ? settings.onSuccess : function () {};
    const clock = settings.clock;
    const fetchImpl = settings.fetchImpl;
    const body = settings.body || {};
    if (!url) {
      onFailure('empty');
      return { cancel() {} };
    }
    if (body.videoId === 'fixture-parabola') {
      onFailure('unavailable');
      return { cancel() {} };
    }
    let settled = false;
    let timer = null;
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    /**
     * @param {string} code
     */
    function fail(code) {
      if (settled) return;
      settled = true;
      if (timer !== null && clock && typeof clock.clear === 'function') clock.clear(timer);
      if (abort) abort.abort();
      onFailure(code);
    }
    if (clock && typeof clock.schedule === 'function') {
      timer = clock.schedule(DEADLINE_MS, () => fail('timeout'));
    }
    if (typeof fetchImpl !== 'function') {
      fail('unavailable');
      return { cancel() {} };
    }
    fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort ? abort.signal : undefined
    }).then((response) => {
      if (settled) return null;
      if (!response || !response.ok || typeof response.json !== 'function') {
        fail('unavailable');
        return null;
      }
      return response.json();
    }).then((payload) => {
      if (payload == null || settled) return;
      if (!acceptResponse(body, payload)) {
        fail('unavailable');
        return;
      }
      settled = true;
      if (timer !== null && clock && typeof clock.clear === 'function') clock.clear(timer);
      onSuccess(payload);
    }).catch(() => fail('unavailable'));
    return {
      cancel() {
        if (settled) return;
        settled = true;
        if (timer !== null && clock && typeof clock.clear === 'function') clock.clear(timer);
        if (abort) abort.abort();
      }
    };
  }

  return {
    DEADLINE_MS,
    COURSE_LIMIT,
    prepareCourse,
    requestBody,
    acceptResponse,
    startLessonAsk
  };
});
