/**
 * 外部尝试的确定性替身。只模拟 off、hang、invalid、late，不访问网络。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.attempt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * 复制一份普通数据，避免调用方事后改动这次候选。
   * @param {unknown} value
   * @returns {unknown}
   */
  function copyValue(value) {
    if (Array.isArray(value)) return value.map(copyValue);
    if (value && typeof value === 'object') {
      const copy = {};
      for (const name of Object.keys(value)) copy[name] = copyValue(value[name]);
      return copy;
    }
    return value;
  }

  /**
   * 只盖上这次请求的 requestId。videoId、time、frameSize 和 region 保持预制原样，
   * 避免用冻结上下文把对不上的结果洗成当前帧。
   * 没有预制时返回 null。
   * @param {object | null | undefined} source
   * @param {object} ctx
   * @returns {object | null}
   */
  function bindPreset(source, ctx) {
    if (!source || typeof source !== 'object') return null;
    const candidate = copyValue(source);
    candidate.requestId = ctx.requestId;
    candidate.source = 'preset';
    candidate.fallback = null;
    return candidate;
  }

  /**
   * 非法候选。有预制就拿掉 definition；页面没传入预制时，用一份不能通过校验的 vision 结果。
   * @param {object | null | undefined} source
   * @param {object} ctx
   * @returns {object}
   */
  function invalidCandidate(source, ctx) {
    const candidate = bindPreset(source, ctx);
    if (candidate) {
      delete candidate.definition;
      return candidate;
    }
    return {
      requestId: ctx.requestId,
      videoId: ctx.videoId,
      time: ctx.time,
      frameSize: ctx.frameSize ? { width: ctx.frameSize.width, height: ctx.frameSize.height } : null,
      source: 'vision',
      fallback: null
    };
  }

  /**
   * @param {{ mode?: string, clock?: { schedule: Function, clear: Function }, lateAfterMs?: number, preset?: object }} options
   * @returns {{ start: Function, abort: Function }}
   */
  function createAttempt({ mode, clock, lateAfterMs = 1500, preset } = {}) {
    const handles = new Set();
    let stopped = false;

    /**
     * 清掉尚未触发的计时句柄。
     */
    function clearHandles() {
      if (!clock || typeof clock.clear !== 'function') {
        handles.clear();
        return;
      }
      for (const id of handles) clock.clear(id);
      handles.clear();
    }

    /**
     * @param {object} ctx
     * @returns {Promise<{ ctx: object, candidate: object } | never>}
     */
    function start(ctx) {
      if (stopped || mode === 'hang') return new Promise(() => {});
      if (mode === 'off') return Promise.resolve({ ctx, candidate: bindPreset(preset, ctx) });
      if (mode === 'invalid') {
        return new Promise((resolve) => {
          const id = clock.schedule(0, () => {
            handles.delete(id);
            if (stopped) return;
            resolve({ ctx, candidate: invalidCandidate(preset, ctx) });
          });
          handles.add(id);
        });
      }
      if (mode === 'late') {
        return new Promise((resolve) => {
          const id = clock.schedule(lateAfterMs, () => {
            handles.delete(id);
            if (stopped) return;
            const candidate = bindPreset(preset, ctx);
            if (!candidate) {
              resolve({ ctx, candidate: null });
              return;
            }
            resolve({ ctx, candidate });
          });
          handles.add(id);
        });
      }
      return new Promise(() => {});
    }

    /**
     * 放弃当前尝试。已排队的回调不再兑现。
     */
    function abort() {
      stopped = true;
      clearHandles();
    }

    return { start, abort };
  }

  return { createAttempt };
});
