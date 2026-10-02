(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.session = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const validate = BreakGlass.validate || (typeof require === 'function' ? require('../curve/validate') : null);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  class SessionController {
    constructor({ videoId, targetTime, frameSize, timeTolerance = 0.2, externalAttempt = 'off' } = {}) {
      this.videoId = videoId;
      this.targetTime = targetTime;
      this.frameSize = frameSize;
      this.timeTolerance = timeTolerance;
      // 非 off 也可以等待。能否进入交互仍由结果校验决定。
      this.externalAttempt = externalAttempt;
      this.status = 'paused-ready';
      this.pending = null;
      this.current = null;
      this.sequence = 0;
    }

    canWake({ paused, currentTime }) {
      return Boolean(paused && Number.isFinite(currentTime) &&
        Math.abs(currentTime - this.targetTime) <= this.timeTolerance);
    }

    beginWait({ paused, currentTime }) {
      if (!this.canWake({ paused, currentTime })) {
        return { ok: false, code: 'not_ready', message: '请先暂停在目标时间。' };
      }
      if (this.pending || this.current || this.status === 'waiting' || this.status === 'interactive') {
        return { ok: false, code: 'session_active', message: '当前已有交互会话。' };
      }
      const requestId = `request-${++this.sequence}`;
      this.pending = { requestId, videoId: this.videoId, time: currentTime };
      this.current = null;
      this.status = 'waiting';
      return { ok: true, requestId };
    }

    resolve(result) {
      if (!this.pending) return { ok: false, code: 'no_pending', message: '当前没有等待中的请求。' };
      if (!validate) return { ok: false, code: 'validator_unavailable', message: '结果校验器不可用。' };
      const expectedRequestId = this.pending.requestId;
      const check = validate.validateCurveResult(result, {
        videoId: this.videoId,
        targetTime: this.targetTime,
        timeTolerance: this.timeTolerance,
        frameSize: this.frameSize,
        requestId: expectedRequestId
      });
      if (!check.ok) {
        return { ok: false, code: check.code || 'request_mismatch', message: check.message || '结果不属于当前请求。' };
      }
      const accepted = copyResult(result);
      this.current = {
        result: accepted,
        initialParameters: Object.fromEntries(Object.entries(accepted.definition.parameters).map(([name, item]) => [name, item.initial])),
        currentParameters: Object.fromEntries(Object.entries(accepted.definition.parameters).map(([name, item]) => [name, item.initial]))
      };
      this.pending = null;
      this.status = 'interactive';
      return { ok: true, session: this.getState() };
    }

    /**
     * 结束一次等待并进入可恢复错误。不留下可绘制曲线。
     * @param {{ code?: string, message?: string }} [reason]
     * @returns {{ ok: boolean, code: string, message: string, session?: ReturnType<SessionController['getState']> }}
     */
    fail(reason = {}) {
      if (this.status !== 'waiting' || !this.pending) {
        return { ok: false, code: 'no_pending', message: '当前没有等待中的请求。' };
      }
      this.pending = null;
      this.current = null;
      this.status = 'recoverable-error';
      return {
        ok: true,
        code: reason.code || 'unavailable',
        message: reason.message || '当前无法进入交互。',
        session: this.getState()
      };
    }

    updateParameter(name, value) {
      if (this.status !== 'interactive' || !this.current) return { ok: false, code: 'not_interactive' };
      const definition = this.current.result.definition;
      if (name !== definition.dragParameter || !definition.parameters[name]) {
        return { ok: false, code: 'parameter_not_draggable' };
      }
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { ok: false, code: 'invalid_parameter_value', message: '参数必须是有限数值。' };
      }
      const item = definition.parameters[name];
      this.current.currentParameters[name] = clamp(value, item.min, item.max);
      return { ok: true, session: this.getState() };
    }

    reset() {
      if (this.status !== 'interactive' || !this.current) return { ok: false, code: 'not_interactive' };
      this.current.currentParameters = { ...this.current.initialParameters };
      return { ok: true, session: this.getState() };
    }

    cancel() {
      this.pending = null;
      this.current = null;
      this.status = 'paused-ready';
      return this.getState();
    }

    exit() {
      this.pending = null;
      this.current = null;
      this.status = 'paused-ready';
      return this.getState();
    }

    /**
     * 播放或离开目标时间时，由会话自己结束。仍暂停在容差内则保持当前会话。
     * @param {{ paused?: boolean, currentTime?: number }} [playback]
     * @returns {ReturnType<SessionController['getState']>}
     */
    onPlaybackChange({ paused, currentTime } = {}) {
      if (!paused || !Number.isFinite(currentTime) || Math.abs(currentTime - this.targetTime) > this.timeTolerance) this.exit();
      return this.getState();
    }

    getState() {
      return {
        status: this.status,
        requestId: this.pending?.requestId || this.current?.result.requestId || null,
        result: this.current?.result || null,
        currentParameters: this.current ? { ...this.current.currentParameters } : null,
        initialParameters: this.current ? { ...this.current.initialParameters } : null
      };
    }
  }

  return { SessionController, clamp };
});

/**
 * 收下调用方结果的副本。之后改原对象的 min / max 不能放宽这次会话。
 * @param {object} result
 * @returns {object}
 */
function copyResult(result) {
  const parameters = {};
  for (const [name, item] of Object.entries(result.definition.parameters)) {
    parameters[name] = { initial: item.initial, min: item.min, max: item.max, step: item.step };
  }
  return {
    requestId: result.requestId,
    videoId: result.videoId,
    time: result.time,
    frameSize: { width: result.frameSize.width, height: result.frameSize.height },
    source: result.source,
    fallback: result.fallback,
    definition: {
      equationId: result.definition.equationId,
      parameters,
      dragParameter: result.definition.dragParameter,
      domain: { min: result.definition.domain.min, max: result.definition.domain.max },
      range: { min: result.definition.range.min, max: result.definition.range.max },
      yAxis: result.definition.yAxis,
      region: {
        x: result.definition.region.x,
        y: result.definition.region.y,
        width: result.definition.region.width,
        height: result.definition.region.height
      }
    }
  };
}
