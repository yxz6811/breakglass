(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginLoop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Completion schedules a fresh sample. There is no queue of stale frames.
  function createVisualLoop({ capture, read, onResult, onStatus = () => {}, intervalMs = 1500,
    schedule = setTimeout, unschedule = clearTimeout }) {
    if (![capture, read, onResult].every((fn) => typeof fn === 'function')) throw new TypeError('缺少视觉管线。');
    let epoch = 0;
    let running = false;
    let timer = null;
    let abort = null;
    let previous = null;
    function stop() {
      running = false;
      epoch += 1;
      if (timer !== null) unschedule(timer);
      timer = null;
      if (abort) abort.abort();
      abort = null;
      previous = null;
    }
    async function tick(owner) {
      if (!running || owner !== epoch) return;
      abort = new AbortController();
      const signal = abort.signal;
      try {
        const frame = await capture(signal);
        if (!running || owner !== epoch || signal.aborted) return;
        if (!frame) onStatus('当前画面不可用，稍后重新观察。');
        else if (previous && previous.signature === frame.signature) onStatus('画面未变化，已跳过重复上传。');
        else {
          onStatus(`正在识别第 ${frame.frameTime.toFixed(1)} 秒画面…`);
          const answer = await read(frame, signal);
          if (!running || owner !== epoch || signal.aborted) return;
          // Failed requests are not marked as successfully observed.
          if (!answer || answer.ok === false) throw new Error(answer?.message || '视觉识别失败。');
          previous = { signature: frame.signature };
          await onResult(answer, frame);
        }
      } catch (error) {
        if (running && owner === epoch && !signal.aborted) {
          // No automatic retries after a service or policy error.
          onStatus(error.message || '视觉服务失败，请重新开启。');
          stop();
          return;
        }
      }
      if (running && owner === epoch) {
        abort = null;
        timer = schedule(() => tick(owner), intervalMs);
      }
    }
    function start() { stop(); running = true; const owner = epoch; void tick(owner); }
    return { start, stop, isRunning: () => running };
  }
  return { createVisualLoop };
});
