(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.wake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const validate = BreakGlass.validate || (typeof require === 'function' ? require('../curve/validate') : null);
  const DEFAULT_FALLBACK_AFTER_MS = 1500;

  function defaultClock() {
    return {
      now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
      schedule: (delayMs, handler) => setTimeout(handler, delayMs),
      clear: (handle) => clearTimeout(handle)
    };
  }

  // 一次唤醒的协调器：冻结请求上下文、驱动 1.5 秒看门狗、在回退前重校验、取消、丢弃迟到结果。
  // 它自己不做绘制、不读文件、不发请求；准备结果由调用方通过 resolvePreset 注入。
  function createWakeController(options = {}) {
    const session = options.session;
    if (!session) throw new Error('createWakeController 需要 session。');
    const clock = options.clock || defaultClock();
    const resolvePreset = typeof options.resolvePreset === 'function' ? options.resolvePreset : null;
    const attempt = options.attempt || null;
    const fallbackAfterMs = Number.isFinite(options.fallbackAfterMs) ? options.fallbackAfterMs : DEFAULT_FALLBACK_AFTER_MS;
    const onOutcome = typeof options.onOutcome === 'function' ? options.onOutcome : null;

    let timer = null;
    let inflight = null;
    let outcome = {
      status: session.status,
      requestId: null,
      result: null,
      fallback: null,
      reason: null,
      elapsedMs: null,
      decisionAt: null
    };

    function idle() { return { ...outcome }; }

    // 每次状态变化都通知调用方，页面据此渲染等待、回退、失败与退出。
    function publish(next) {
      outcome = next;
      if (onOutcome) onOutcome({ ...outcome });
      return { ...outcome };
    }
    function clearTimer() { if (timer !== null) { clock.clear(timer); timer = null; } }
    function abortAttempt() { if (attempt && typeof attempt.abort === 'function') attempt.abort(); }

    function freeze(currentTime) {
      const pending = session.pending;
      return {
        requestId: pending ? pending.requestId : null,
        videoId: session.videoId,
        time: Number.isFinite(currentTime) ? currentTime : (pending ? pending.time : null),
        frameSize: session.frameSize ? { width: session.frameSize.width, height: session.frameSize.height } : null
      };
    }

    // 回退与外部结果都必须经过同一个确定性校验器，并带上冻结上下文。
    function validateAgainst(candidate, ctx) {
      if (!candidate || !validate || !ctx) return null;
      const check = validate.validateCurveResult(candidate, {
        videoId: ctx.videoId,
        targetTime: ctx.time,
        timeTolerance: session.timeTolerance,
        frameSize: ctx.frameSize,
        requestId: ctx.requestId
      });
      return check.ok ? check.value : null;
    }

    function presetCandidate(ctx, fallback) {
      if (!resolvePreset) return null;
      const base = resolvePreset(ctx);
      if (!base) return null;
      return { ...base, requestId: ctx.requestId, fallback };
    }

    function fail(code, message) {
      clearTimer();
      inflight = null;
      if (typeof session.fail === 'function') session.fail(code, message);
      else session.cancel();
      return publish({
        status: 'recoverable-error',
        requestId: null,
        result: null,
        fallback: null,
        reason: code,
        elapsedMs: null,
        decisionAt: null
      });
    }

    function settle(result, fallback, startedAt) {
      const resolved = session.resolve(result);
      if (!resolved.ok) return fail(resolved.code || 'resolve_failed', resolved.message || '结果无法进入交互。');
      return publish({
        status: 'interactive',
        requestId: result.requestId,
        result,
        fallback,
        reason: fallback === 'timeout' ? 'timeout' : null,
        elapsedMs: clock.now() - startedAt,
        decisionAt: fallback === 'timeout' ? startedAt : null
      });
    }

    function discard() {
      return publish({ ...outcome, discarded: true });
    }

    // 看门狗到点：只用与当前帧匹配的预制结果回退，否则进入可恢复错误。
    function onTimeout() {
      timer = null;
      const ctx = inflight;
      if (!ctx) return idle();
      inflight = null;
      const startedAt = clock.now();
      const validated = validateAgainst(presetCandidate(ctx, 'timeout'), ctx);
      if (!validated) return fail('no_preset', '当前帧没有可用的准备结果，无法进入交互。');
      return settle(validated, 'timeout', startedAt);
    }

    function onExternal(payload) {
      const ctx = inflight;
      if (!ctx || !payload || !payload.ctx || payload.ctx.requestId !== ctx.requestId) return discard();
      clearTimer();
      inflight = null;
      const startedAt = clock.now();
      const validated = validateAgainst(payload.candidate, ctx);
      if (!validated) return fail('external_invalid', '外部结果不可用，未进入交互。');
      return settle(validated, null, startedAt);
    }

    function onExternalFailure() {
      if (!inflight) return idle();
      return fail('external_unavailable', '外部结果不可用，未进入交互。');
    }

    function begin(input = {}) {
      clearTimer();
      const started = session.beginWait({ paused: input.paused, currentTime: input.currentTime });
      if (!started.ok) {
        publish({ ...outcome, status: session.status, reason: started.code });
        return { ok: false, code: started.code, message: started.message, status: session.status };
      }
      const ctx = freeze(input.currentTime);

      // off：不发起外部尝试，匹配的预热结果立即进入交互（与 P0 主路径一致）。
      if (session.externalAttempt === 'off' || !attempt) {
        const startedAt = clock.now();
        const validated = validateAgainst(presetCandidate(ctx, null), ctx);
        if (!validated) {
          const failed = fail('no_preset', '当前帧没有可用的准备结果，无法进入交互。');
          return { ok: false, code: 'no_preset', message: '当前帧没有可用的准备结果，无法进入交互。', ...failed };
        }
        return { ok: true, ...settle(validated, null, startedAt) };
      }

      inflight = ctx;
      publish({
        status: 'waiting',
        requestId: ctx.requestId,
        result: null,
        fallback: null,
        reason: null,
        elapsedMs: null,
        decisionAt: null
      });
      timer = clock.schedule(fallbackAfterMs, onTimeout);
      if (typeof attempt.start === 'function') {
        Promise.resolve(attempt.start(ctx))
          .then((payload) => { if (payload) onExternal(payload); })
          .catch(() => { onExternalFailure(); });
      }
      return { ok: true, ...idle() };
    }

    function cancel() {
      clearTimer();
      abortAttempt();
      inflight = null;
      session.cancel();
      return publish({
        status: 'paused-ready',
        requestId: null,
        result: null,
        fallback: null,
        reason: 'cancelled',
        elapsedMs: null,
        decisionAt: null
      });
    }

    function dispose() {
      clearTimer();
      abortAttempt();
      inflight = null;
    }

    function onPlaybackChange(playback = {}) {
      const wasWaiting = inflight !== null || session.status === 'waiting';
      const state = session.onPlaybackChange(playback);
      if (wasWaiting && state.status === 'paused-ready') {
        clearTimer();
        abortAttempt();
        inflight = null;
        publish({
          status: 'paused-ready',
          requestId: null,
          result: null,
          fallback: null,
          reason: 'left_target',
          elapsedMs: null,
          decisionAt: null
        });
      }
      return state;
    }

    return {
      begin,
      cancel,
      dispose,
      onExternal,
      onExternalFailure,
      onTimeout,
      onPlaybackChange,
      getOutcome: () => ({ ...outcome }),
      isWaiting: () => inflight !== null,
      pendingTimers: () => (timer === null ? 0 : 1)
    };
  }

  return { createWakeController, DEFAULT_FALLBACK_AFTER_MS };
});