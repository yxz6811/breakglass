(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.latency = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 内存计时日志：只用于本地验证与手工记录，不落盘、不上传、不包含画面内容。
  function percentile(sorted, ratio) {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
    return sorted[index];
  }

  function createLatencyLog(options = {}) {
    const clock = options.clock || { now: () => Date.now() };
    const limit = Number.isFinite(options.limit) ? options.limit : 200;
    const records = new Map();
    const marks = new Map();

    function record(name, ms) {
      if (!Number.isFinite(ms) || ms < 0) return null;
      const list = records.get(name) || [];
      list.push(ms);
      while (list.length > limit) list.shift();
      records.set(name, list);
      return ms;
    }

    function mark(name) {
      marks.set(name, clock.now());
      return marks.get(name);
    }

    function measure(from, to) {
      if (!marks.has(from) || !marks.has(to)) return null;
      return record(from + '->' + to, marks.get(to) - marks.get(from));
    }

    function summary() {
      const result = {};
      for (const [name, list] of records) {
        const sorted = [...list].sort((a, b) => a - b);
        result[name] = {
          count: sorted.length,
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
          max: sorted[sorted.length - 1]
        };
      }
      return result;
    }

    function snapshot() {
      const result = {};
      for (const [name, list] of records) result[name] = [...list];
      return result;
    }

    function reset() { records.clear(); marks.clear(); }

    return { record, mark, measure, summary, snapshot, reset, has: (name) => records.has(name) };
  }

  return { createLatencyLog, percentile };
});