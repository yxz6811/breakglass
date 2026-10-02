(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.attempt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 故事 2 的确定性替身：用来演练「等待外部结果」的四种情况。
  // 它不联网、不带地址或密钥，也不是半成品识别：只按 externalAttempt 返回可预期的候选。
  const ATTEMPT_MODES = ['off', 'hang', 'invalid', 'late'];
  const DEFAULT_LATE_AFTER_MS = 2200;

  function frozenContext(ctx) {
    return {
      requestId: ctx.requestId,
      videoId: ctx.videoId,
      time: ctx.time,
      frameSize: { width: ctx.frameSize.width, height: ctx.frameSize.height }
    };
  }

  // 非法候选：故意越出 frameSize 的 region，并标成本功能没有生产者的 vision。
  function buildInvalidCandidate(ctx) {
    const frozen = frozenContext(ctx);
    return {
      requestId: frozen.requestId,
      videoId: frozen.videoId,
      time: frozen.time,
      frameSize: frozen.frameSize,
      source: 'vision',
      fallback: null,
      definition: {
        equationId: 'fixture.parabola',
        parameters: { h: { initial: 0, min: -2, max: 2, step: 0.1 } },
        dragParameter: 'h',
        domain: { min: -4, max: 4 },
        range: { min: -4, max: 4 },
        yAxis: 'up',
        region: { x: frozen.frameSize.width - 10, y: 0, width: 100, height: 100 }
      }
    };
  }

  // 迟到候选：结构合法，但编号已经过期，唯一被拒绝的原因就是「迟到」。
  function buildLateCandidate(ctx) {
    const frozen = frozenContext(ctx);
    return {
      requestId: frozen.requestId + '-late',
      videoId: frozen.videoId,
      time: frozen.time,
      frameSize: frozen.frameSize,
      source: 'preset',
      fallback: null,
      definition: {
        equationId: 'fixture.parabola',
        parameters: { h: { initial: 0, min: -2, max: 2, step: 0.1 } },
        dragParameter: 'h',
        domain: { min: -4, max: 4 },
        range: { min: -4, max: 4 },
        yAxis: 'up',
        region: { x: 0, y: 0, width: 100, height: 100 }
      }
    };
  }

  function defaultClock() {
    return {
      now: () => Date.now(),
      schedule: (delayMs, handler) => setTimeout(handler, delayMs),
      clear: (handle) => clearTimeout(handle)
    };
  }

  function createAttempt(options = {}) {
    const mode = options.mode === undefined ? 'off' : options.mode;
    if (ATTEMPT_MODES.indexOf(mode) < 0) throw new Error('未知 externalAttempt: ' + mode);
    const clock = options.clock || defaultClock();
    const lateAfterMs = Number.isFinite(options.lateAfterMs) ? options.lateAfterMs : DEFAULT_LATE_AFTER_MS;
    let handle = null;
    let aborted = false;

    function abort() {
      aborted = true;
      if (handle !== null) { clock.clear(handle); handle = null; }
    }

    function start(ctx) {
      if (aborted || mode === 'off') return Promise.resolve(null);
      // hang：外部尝试永远不返回。没有定时器，也没有结果。
      if (mode === 'hang') return new Promise(() => {});
      const candidate = mode === 'invalid' ? buildInvalidCandidate(ctx) : buildLateCandidate(ctx);
      const delay = mode === 'invalid' ? 0 : lateAfterMs;
      return new Promise((resolve) => {
        handle = clock.schedule(delay, () => {
          handle = null;
          if (aborted) return;
          resolve({ ctx: frozenContext(ctx), candidate });
        });
      });
    }

    return {
      mode,
      start,
      abort,
      isAborted: () => aborted,
      pendingTimers: () => (handle === null ? 0 : 1)
    };
  }

  return {
    ATTEMPT_MODES,
    DEFAULT_LATE_AFTER_MS,
    createAttempt,
    buildInvalidCandidate,
    buildLateCandidate
  };
});