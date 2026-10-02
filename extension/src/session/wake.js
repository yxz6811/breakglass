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

  return { createWake };
});
