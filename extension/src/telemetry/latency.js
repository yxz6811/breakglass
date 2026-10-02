/**
 * 内存计时。只保存状态、毫秒数和缓存状态，不落盘、不上传。
 * 打开扩展、视频首帧、网络等待和 P1 初始化不记入这里。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.latency = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EXCLUDED = new Set(['extension-open', 'video-first-frame', 'network-wait', 'p1-init']);

  /**
   * 最近秩百分位。空列表没有结果。
   * @param {number[]} sorted 升序毫秒数
   * @param {number} ratio 0 到 1
   * @returns {number | null}
   */
  function percentile(sorted, ratio) {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
    return sorted[index];
  }

  /**
   * @param {unknown} value
   * @returns {'hot' | 'cold' | null}
   */
  function cacheState(value) {
    if (value === 'hot' || value === 'cold') return value;
    return null;
  }

  /**
   * @param {{ clock?: { now: () => number }, limit?: number, cache?: 'hot' | 'cold' }} [options]
   * @returns {{ mark: Function, measure: Function, record: Function, summary: Function, snapshot: Function, reset: Function, has: Function }}
   */
  function createLatencyLog(options = {}) {
    const clock = options.clock || { now: () => Date.now() };
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 200;
    const defaultCache = cacheState(options.cache) || 'hot';
    /** @type {Map<string, { status: string, ms: number, cache: 'hot' | 'cold' }[]>} */
    const records = new Map();
    /** @type {Map<string, number>} */
    const marks = new Map();

    /**
     * @param {unknown} name
     * @returns {boolean}
     */
    function allowed(name) {
      return typeof name === 'string' && name.length > 0 && !EXCLUDED.has(name);
    }

    /**
     * @param {string} name
     * @param {number} ms
     * @param {'hot' | 'cold'} [cache]
     * @returns {number | null}
     */
    function record(name, ms, cache) {
      if (!allowed(name) || !Number.isFinite(ms) || ms < 0) return null;
      const sample = {
        status: name,
        ms,
        cache: cacheState(cache) || defaultCache
      };
      const list = records.get(name) || [];
      list.push(sample);
      while (list.length > limit) list.shift();
      records.set(name, list);
      return ms;
    }

    /**
     * 记下某个状态的时刻。打开扩展、视频首帧、网络等待和 P1 初始化会被拒绝。
     * @param {string} name
     * @returns {number | null}
     */
    function mark(name) {
      if (!allowed(name) || typeof clock.now !== 'function') return null;
      const at = clock.now();
      if (!Number.isFinite(at)) return null;
      marks.set(name, at);
      return at;
    }

    /**
     * 用两次 mark 的差写入一条记录。
     * @param {string} from
     * @param {string} to
     * @param {'hot' | 'cold'} [cache]
     * @returns {number | null}
     */
    function measure(from, to, cache) {
      if (!marks.has(from) || !marks.has(to)) return null;
      return record(`${from}->${to}`, marks.get(to) - marks.get(from), cache);
    }

    /**
     * 每个状态给出次数、P50、P95、最大值，以及这些样本的缓存状态。
     * @returns {Record<string, { count: number, p50: number, p95: number, max: number, cache: 'hot' | 'cold' | 'mixed' }>}
     */
    function summary() {
      const result = {};
      for (const [name, list] of records) {
        const sorted = list.map((sample) => sample.ms).sort((left, right) => left - right);
        const caches = new Set(list.map((sample) => sample.cache));
        result[name] = {
          count: sorted.length,
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
          max: sorted[sorted.length - 1],
          cache: caches.size === 1 ? [...caches][0] : 'mixed'
        };
      }
      return result;
    }

    /**
     * 返回内存中的样本副本。每条只有状态、毫秒数和缓存状态。
     * @returns {Record<string, { status: string, ms: number, cache: 'hot' | 'cold' }[]>}
     */
    function snapshot() {
      const result = {};
      for (const [name, list] of records) {
        result[name] = list.map((sample) => ({ status: sample.status, ms: sample.ms, cache: sample.cache }));
      }
      return result;
    }

    function reset() {
      records.clear();
      marks.clear();
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    function has(name) {
      return records.has(name);
    }

    return { record, mark, measure, summary, snapshot, reset, has };
  }

  return { createLatencyLog, percentile };
});
