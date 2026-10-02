/**
 * 唤醒协调器。每次唤醒重新读配置，冻结请求上下文，并在 1500ms 看门狗到点时决定是否回退。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.wake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const validate = BreakGlass.validate || (typeof require === 'function' ? require('../curve/validate') : null);
  const attemptApi = BreakGlass.attempt || (typeof require === 'function' ? require('../attempt/simulator') : null);

  const PRESET_UNAVAILABLE = '当前帧没有可用的准备结果，无法进入交互。';
  const EXTERNAL_UNAVAILABLE = '外部结果不可用，未进入交互。';
  const MOCK_DISABLED = '本地预制未启用，无法进入交互。';

  /**
   * @param {object} options
   * @param {object} options.session 现有 SessionController
   * @param {object} options.config enableLocalMock、fallbackAfterMs、prewarmed、externalAttempt
   * @param {object | null} options.preset 已装入的预制结果；没有匹配预制时为 null
   * @param {() => number} [options.now]
   * @param {(fn: Function, ms: number) => unknown} options.schedule
   * @param {(timerId: unknown) => void} options.clearTimer
   * @param {(state: object) => void} [options.onChange]
   * @param {{ start: Function, abort: Function }} [options.attempt] 测试注入的外部尝试
   * @returns {{ start: Function, cancel: Function, exit: Function, onPlaybackChange: Function, dispose: Function }}
   */
  function createWake({ session, config, preset, now, schedule, clearTimer, onChange, attempt } = {}) {
    let generation = 0;
    let timerId = null;
    let activeAttempt = null;
    let notice = { code: null, message: null };

    /**
     * 替身使用 (delayMs, handler)，页面注入的是 (fn, ms)。
     */
    const clock = {
      now: typeof now === 'function' ? now : () => 0,
      /**
       * @param {number} delayMs
       * @param {Function} handler
       * @returns {unknown}
       */
      schedule(delayMs, handler) {
        return schedule(handler, delayMs);
      },
      /**
       * @param {unknown} id
       */
      clear(id) {
        clearTimer(id);
      }
    };

    /**
     * 每个判定点都重新读配置，不沿用上一次唤醒时的开关。
     * @returns {{ enableLocalMock: unknown, fallbackAfterMs: unknown, prewarmed: unknown, externalAttempt: unknown }}
     */
    function readConfig() {
      const source = config || {};
      return {
        enableLocalMock: source.enableLocalMock,
        fallbackAfterMs: source.fallbackAfterMs,
        prewarmed: source.prewarmed,
        externalAttempt: source.externalAttempt
      };
    }

    /**
     * @param {string | null} code
     * @param {string | null} message
     */
    function remember(code, message) {
      notice = { code: code || null, message: message || null };
    }

    function forget() {
      notice = { code: null, message: null };
    }

    /**
     * 作废当前请求，并清掉看门狗和替身定时器。
     */
    function disarm() {
      generation += 1;
      if (timerId != null) {
        clearTimer(timerId);
        timerId = null;
      }
      if (activeAttempt && typeof activeAttempt.abort === 'function') activeAttempt.abort();
    }

    /**
     * @param {string} requestId
     * @param {number} token
     * @returns {boolean}
     */
    function stillWaiting(requestId, token) {
      if (token !== generation) return false;
      const state = session.getState();
      return state.status === 'waiting' && state.requestId === requestId;
    }

    function publish() {
      if (typeof onChange !== 'function') return;
      const state = session.getState();
      const failed = state.status === 'recoverable-error';
      onChange({
        status: state.status,
        requestId: state.requestId,
        result: state.result,
        currentParameters: state.currentParameters,
        initialParameters: state.initialParameters,
        code: failed ? notice.code : null,
        message: failed ? notice.message : null
      });
    }

    /**
     * @param {object} ctx
     * @returns {object}
     */
    function expected(ctx) {
      return {
        videoId: ctx.videoId,
        targetTime: session.targetTime,
        timeTolerance: session.timeTolerance,
        frameSize: ctx.frameSize,
        requestId: ctx.requestId
      };
    }

    /**
     * 装订本次请求编号。视频、时间和画幅保留预制原值，交给校验器复核。
     * @param {object} source
     * @param {string} requestId
     * @param {null | 'timeout'} fallback
     * @returns {object}
     */
    function bindPreset(source, requestId, fallback) {
      return {
        requestId,
        videoId: source.videoId,
        time: source.time,
        frameSize: source.frameSize
          ? { width: source.frameSize.width, height: source.frameSize.height }
          : source.frameSize,
        source: 'preset',
        fallback,
        definition: source.definition
      };
    }

    /**
     * @param {object} candidate
     * @param {object} ctx
     * @returns {{ ok: boolean, code?: string, message?: string }}
     */
    function checkCandidate(candidate, ctx) {
      if (!validate || typeof validate.validateCurveResult !== 'function') {
        return { ok: false, code: 'validator_unavailable', message: '结果校验器不可用。' };
      }
      return validate.validateCurveResult(candidate, expected(ctx));
    }

    /**
     * @param {object} live
     * @returns {boolean}
     */
    function presetReady(live) {
      return live.enableLocalMock === true &&
        live.prewarmed === true &&
        live.fallbackAfterMs === 1500 &&
        Boolean(preset) &&
        typeof preset === 'object';
    }

    /**
     * @param {object} live
     * @returns {{ code: string, message: string }}
     */
    function unavailableReason(live) {
      if (live.enableLocalMock !== true) return { code: 'preset_disabled', message: MOCK_DISABLED };
      return { code: 'preset_unavailable', message: PRESET_UNAVAILABLE };
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {string} code
     * @param {string} message
     */
    function deny(ctx, token, code, message) {
      if (!stillWaiting(ctx.requestId, token)) return;
      remember(code, message);
      session.fail({ code, message });
      disarm();
      publish();
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {null | 'timeout'} fallback
     * @returns {boolean}
     */
    function acceptPreset(ctx, token, fallback) {
      if (!stillWaiting(ctx.requestId, token)) return false;
      const live = readConfig();
      if (!presetReady(live)) {
        const reason = unavailableReason(live);
        deny(ctx, token, reason.code, reason.message);
        return false;
      }
      const candidate = bindPreset(preset, ctx.requestId, fallback);
      const check = checkCandidate(candidate, ctx);
      if (!check.ok) {
        deny(ctx, token, check.code || 'preset_unavailable', PRESET_UNAVAILABLE);
        return false;
      }
      const resolved = session.resolve(candidate);
      if (!resolved.ok) {
        deny(ctx, token, resolved.code || 'preset_unavailable', resolved.message || PRESET_UNAVAILABLE);
        return false;
      }
      forget();
      if (fallback === 'timeout') disarm();
      publish();
      return true;
    }

    /**
     * 只有 hang 和 late 可以在 1500ms 回退到预制。invalid 到点也不得画成成功。
     * @param {object} ctx
     * @param {number} token
     */
    function onTimeout(ctx, token) {
      if (!stillWaiting(ctx.requestId, token)) return;
      const live = readConfig();
      if (live.externalAttempt !== 'hang' && live.externalAttempt !== 'late') {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      acceptPreset(ctx, token, 'timeout');
    }

    /**
     * 迟到或已取消的结果直接丢掉，不改当前会话。
     * @param {object | null | undefined} payload
     * @param {object} ctx
     * @param {number} token
     */
    function onExternal(payload, ctx, token) {
      if (!stillWaiting(ctx.requestId, token)) return;
      const candidate = payload && payload.candidate;
      const check = checkCandidate(candidate, ctx);
      if (!check.ok || candidate.source !== 'preset') {
        deny(ctx, token, (check && check.code) || 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      const resolved = session.resolve(candidate);
      if (!resolved.ok) {
        deny(ctx, token, resolved.code || 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      forget();
      disarm();
      publish();
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {object} live
     */
    function listen(ctx, token, live) {
      const created = attempt || (attemptApi && attemptApi.createAttempt({
        mode: live.externalAttempt,
        clock,
        lateAfterMs: 1500,
        preset
      }));
      if (!created || typeof created.start !== 'function') {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      activeAttempt = created;
      let pendingResult;
      try {
        pendingResult = created.start(ctx);
      } catch {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      Promise.resolve(pendingResult).then((payload) => {
        onExternal(payload, ctx, token);
      }, () => {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
      });
    }

    /**
     * @param {{ paused?: boolean, currentTime?: number, frameSize?: { width: number, height: number } }} [input]
     * @returns {{ ok: boolean, code?: string, message?: string, requestId?: string }}
     */
    function start(input = {}) {
      const begun = session.beginWait({ paused: input.paused, currentTime: input.currentTime });
      if (!begun.ok) {
        publish();
        return begun;
      }
      const ctx = {
        requestId: begun.requestId,
        videoId: session.videoId,
        time: input.currentTime,
        frameSize: {
          width: input.frameSize && input.frameSize.width,
          height: input.frameSize && input.frameSize.height
        }
      };
      const token = generation;
      const live = readConfig();
      if (live.externalAttempt === 'off') {
        acceptPreset(ctx, token, null);
        return { ok: session.getState().status === 'interactive', requestId: ctx.requestId };
      }
      timerId = schedule(() => {
        timerId = null;
        onTimeout(ctx, token);
      }, live.fallbackAfterMs);
      listen(ctx, token, live);
      if (session.getState().status === 'waiting') publish();
      return { ok: true, requestId: ctx.requestId };
    }

    function cancel() {
      forget();
      disarm();
      session.cancel();
      publish();
      return session.getState();
    }

    function exit() {
      forget();
      disarm();
      session.exit();
      publish();
      return session.getState();
    }

    /**
     * @param {{ paused?: boolean, currentTime?: number }} [playback]
     * @returns {ReturnType<typeof session.getState>}
     */
    function onPlaybackChange(playback) {
      const statusBefore = session.status;
      session.onPlaybackChange(playback || {});
      if (statusBefore !== 'paused-ready' && session.status === 'paused-ready') {
        forget();
        disarm();
      }
      publish();
      return session.getState();
    }

    function dispose() {
      forget();
      disarm();
      if (session.status === 'waiting' || session.status === 'interactive' || session.status === 'recoverable-error') {
        session.exit();
      }
      publish();
    }

    return { start, cancel, exit, onPlaybackChange, dispose };
  }

  const DEFAULT_FALLBACK_AFTER_MS = 1500;

  /**
   * 页面使用的时钟。测试会换成假时钟。
   * @returns {{ now: Function, schedule: Function, clear: Function }}
   */
  function defaultClock() {
    return {
      now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
      /**
       * @param {number} delayMs
       * @param {Function} handler
       * @returns {unknown}
       */
      schedule(delayMs, handler) {
        return setTimeout(handler, delayMs);
      },
      /**
       * @param {unknown} handle
       */
      clear(handle) {
        clearTimeout(handle);
      }
    };
  }

  /**
   * 演示页用的唤醒协调器。begin / isWaiting / onOutcome 给页面渲染等待、回退和失败。
   * @param {object} [options]
   * @param {object} options.session
   * @param {{ now: Function, schedule: Function, clear: Function }} [options.clock]
   * @param {{ start?: Function, abort?: Function }} [options.attempt]
   * @param {number} [options.fallbackAfterMs]
   * @param {(outcome: object) => void} [options.onOutcome]
   * @param {(ctx: object) => object | null} [options.resolvePreset]
   * @returns {object}
   */
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

    /**
     * @returns {object}
     */
    function idle() {
      return { ...outcome };
    }

    /**
     * @param {object} next
     * @returns {object}
     */
    function publish(next) {
      outcome = next;
      if (onOutcome) onOutcome({ ...outcome });
      return { ...outcome };
    }

    function clearTimer() {
      if (timer !== null) {
        clock.clear(timer);
        timer = null;
      }
    }

    function abortAttempt() {
      if (attempt && typeof attempt.abort === 'function') attempt.abort();
    }

    /**
     * @param {number} currentTime
     * @returns {{ requestId: string | null, videoId: string, time: number | null, frameSize: { width: number, height: number } | null }}
     */
    function freeze(currentTime) {
      const pending = session.pending;
      return {
        requestId: pending ? pending.requestId : null,
        videoId: session.videoId,
        time: Number.isFinite(currentTime) ? currentTime : (pending ? pending.time : null),
        frameSize: session.frameSize ? { width: session.frameSize.width, height: session.frameSize.height } : null
      };
    }

    /**
     * @param {object | null | undefined} candidate
     * @param {object | null | undefined} ctx
     * @returns {object | null}
     */
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

    /**
     * @param {object} ctx
     * @param {null | 'timeout'} fallback
     * @returns {object | null}
     */
    function presetCandidate(ctx, fallback) {
      if (!resolvePreset) return null;
      const base = resolvePreset(ctx);
      if (!base) return null;
      return { ...base, requestId: ctx.requestId, fallback };
    }

    /**
     * @param {string} code
     * @param {string} message
     * @returns {object}
     */
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

    /**
     * @param {object} result
     * @param {null | 'timeout'} fallback
     * @param {number} startedAt
     * @returns {object}
     */
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

    /**
     * 已经离开这次等待的结果只丢弃。
     * @returns {object}
     */
    function discard() {
      return publish({ ...outcome, discarded: true });
    }

    /**
     * 看门狗到点后，只用和当前帧匹配的预制结果回退。
     * @returns {object}
     */
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

    /**
     * @param {object} payload
     * @returns {object}
     */
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

    /**
     * @returns {object}
     */
    function onExternalFailure() {
      if (!inflight) return idle();
      return fail('external_unavailable', '外部结果不可用，未进入交互。');
    }

    /**
     * @param {{ paused?: boolean, currentTime?: number }} [input]
     * @returns {object}
     */
    function begin(input = {}) {
      clearTimer();
      const started = session.beginWait({ paused: input.paused, currentTime: input.currentTime });
      if (!started.ok) {
        publish({ ...outcome, status: session.status, reason: started.code });
        return { ok: false, code: started.code, message: started.message, status: session.status };
      }
      const ctx = freeze(input.currentTime);

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
        Promise.resolve(attempt.start(ctx)).then((payload) => {
          if (payload) onExternal(payload);
        }, () => {
          onExternalFailure();
        });
      }
      return { ok: true, ...idle() };
    }

    /**
     * @returns {object}
     */
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

    /**
     * @param {{ paused?: boolean, currentTime?: number }} [playback]
     * @returns {ReturnType<typeof session.getState>}
     */
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

  return { createWake, createWakeController, DEFAULT_FALLBACK_AFTER_MS };
});
