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
   * 用冻结上下文盖住预制结果的定位字段。
   * @param {object} preset
   * @param {object} ctx
   * @returns {object}
   */
  function bindPreset(preset, ctx) {
    const candidate = copyValue(preset);
    candidate.requestId = ctx.requestId;
    candidate.videoId = ctx.videoId;
    candidate.time = ctx.time;
    candidate.frameSize = { width: ctx.frameSize.width, height: ctx.frameSize.height };
    candidate.source = 'preset';
    candidate.fallback = null;
    return candidate;
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
        const candidate = bindPreset(preset, ctx);
        delete candidate.definition;
        return Promise.resolve({ ctx, candidate });
      }
      if (mode === 'late') {
        return new Promise((resolve) => {
          const id = clock.schedule(lateAfterMs, () => {
            handles.delete(id);
            if (stopped) return;
            resolve({ ctx, candidate: bindPreset(preset, ctx) });
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
