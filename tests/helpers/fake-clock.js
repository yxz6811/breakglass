// 测试用假时钟：让 1.5 秒看门狗和迟到结果可以被确定性地驱动，不用真实等待。
function createFakeClock(start = 0) {
  let current = start;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => current,
    schedule(delayMs, handler) {
      const id = ++sequence;
      timers.set(id, { at: current + Math.max(0, delayMs), handler });
      return id;
    },
    clear(handle) { timers.delete(handle); },
    advance(ms) {
      current += ms;
      let ran = 0;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= current)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        for (const [id, timer] of due) {
          timers.delete(id);
          timer.handler();
          ran += 1;
        }
      }
      return ran;
    },
    pending: () => timers.size
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { createFakeClock, flush };