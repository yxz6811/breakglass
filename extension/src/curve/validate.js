(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.validate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const DEFAULT_TIME_TOLERANCE = 0.2;
  const ALLOWED_SOURCES = new Set(['preset', 'vision']);
  const ALLOWED_FALLBACKS = new Set([null, 'timeout']);
  const DEFAULT_EQUATION_IDS = new Set(['fixture.parabola']);

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function positiveFinite(value) {
    return finite(value) && value > 0;
  }

  function fail(code, message) {
    return { ok: false, code, message };
  }

  /**
   * 识别样例必须标明打包证据，且不得把置信度写成百分比。
   * 预制结果不要求这两项；一旦带上 evidence 就拒绝。
   * @param {object} result
   * @returns {{ ok: false, code: string, message: string } | null}
   */
  function checkVisionFields(result) {
    if (result.source === 'preset') {
      if (result.evidence !== undefined) return fail('invalid_evidence', '预制结果不能携带 evidence。');
      return null;
    }
    if (result.evidence !== 'packaged-sample') {
      return fail('invalid_evidence', '识别样例必须标明 packaged-sample。');
    }
    if (result.fallback !== null) return fail('invalid_fallback', '识别样例的 fallback 必须是 null。');
    if (!Object.prototype.hasOwnProperty.call(result, 'confidence') || result.confidence === undefined) {
      return null;
    }
    const confidence = result.confidence;
    if (!finite(confidence) || confidence < 0.5 || confidence > 1) {
      return fail('invalid_confidence', 'confidence 必须是 0.5 到 1 的有限数。');
    }
    return null;
  }

  function validateCurveResult(result, context = {}) {
    if (!result || typeof result !== 'object') return fail('invalid_shape', '结果必须是对象。');

    const allowVision = context.allowVision === true;
    if (typeof result.requestId !== 'string' || result.requestId.length === 0) {
      return fail('invalid_request_id', 'requestId 缺失。');
    }
    if (typeof result.videoId !== 'string' || result.videoId.length === 0) {
      return fail('invalid_video_id', 'videoId 缺失。');
    }
    if (!finite(result.time)) return fail('invalid_time', 'time 必须是有限秒数。');
    if (!ALLOWED_SOURCES.has(result.source) || (result.source === 'vision' && !allowVision)) {
      return fail('invalid_source', '当前功能只接受预先准备的 preset 结果。');
    }
    if (!ALLOWED_FALLBACKS.has(result.fallback)) return fail('invalid_fallback', 'fallback 值不受支持。');
    const visionFields = checkVisionFields(result);
    if (visionFields) return visionFields;

    const frameSize = result.frameSize;
    if (!frameSize || !positiveFinite(frameSize.width) || !positiveFinite(frameSize.height)) {
      return fail('invalid_frame_size', 'frameSize 必须是正数尺寸。');
    }

    const definition = result.definition;
    if (!definition || typeof definition !== 'object') return fail('invalid_definition', 'definition 缺失。');
    const equationIds = context.equationIds || DEFAULT_EQUATION_IDS;
    if (!(equationIds instanceof Set ? equationIds : new Set(equationIds)).has(definition.equationId)) {
      return fail('unknown_equation', '未知 equationId。');
    }
    if (!definition.parameters || typeof definition.parameters !== 'object') {
      return fail('invalid_parameters', 'parameters 缺失。');
    }

    const parameterNames = Object.keys(definition.parameters);
    if (parameterNames.length === 0) return fail('invalid_parameters', '至少需要一个参数。');
    const required = requiredParameterNames(root, definition.equationId);
    if (!required) return fail('incomplete_parameters', '该曲线没有登记必需参数。');
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(definition.parameters, name)) {
        return fail('incomplete_parameters', `参数 ${name} 缺失。`);
      }
    }
    for (const name of parameterNames) {
      const parameter = definition.parameters[name];
      if (!parameter || !finite(parameter.initial) || !finite(parameter.min) ||
          !finite(parameter.max) || !finite(parameter.step) || parameter.step <= 0 ||
          parameter.min > parameter.initial || parameter.initial > parameter.max) {
        return fail('invalid_parameter_range', `参数 ${name} 的范围无效。`);
      }
    }
    if (typeof definition.dragParameter !== 'string' || !Object.prototype.hasOwnProperty.call(definition.parameters, definition.dragParameter)) {
      return fail('invalid_drag_parameter', 'dragParameter 必须对应一个参数。');
    }

    for (const key of ['domain', 'range']) {
      const bounds = definition[key];
      if (!bounds || !finite(bounds.min) || !finite(bounds.max) || bounds.min >= bounds.max) {
        return fail('invalid_bounds', `${key} 范围无效。`);
      }
    }
    if (definition.yAxis !== 'up' && definition.yAxis !== 'down') {
      return fail('invalid_axis', 'yAxis 必须为 up 或 down。');
    }

    const region = definition.region;
    if (!region || !positiveFinite(region.width) || !positiveFinite(region.height) ||
        !finite(region.x) || !finite(region.y) || region.x < 0 || region.y < 0 ||
        region.x + region.width > frameSize.width || region.y + region.height > frameSize.height) {
      return fail('invalid_region', 'region 必须完全位于 frameSize 内。');
    }

    if (context.videoId !== undefined && result.videoId !== context.videoId) {
      return fail('video_mismatch', '结果不属于当前视频。');
    }
    if (context.targetTime !== undefined) {
      const tolerance = Number.isFinite(context.timeTolerance) ? context.timeTolerance : DEFAULT_TIME_TOLERANCE;
      // 0.2 在二进制里不能精确表示，边界值要留出可忽略的误差。
      if (Math.abs(result.time - context.targetTime) > tolerance + 1e-9) {
        return fail('time_mismatch', '结果不属于当前目标时间。');
      }
    }
    if (context.frameSize && (frameSize.width !== context.frameSize.width || frameSize.height !== context.frameSize.height)) {
      return fail('frame_mismatch', '结果尺寸不属于当前视频。');
    }
    if (context.requestId !== undefined && result.requestId !== context.requestId) {
      return fail('request_mismatch', '结果不属于当前请求。');
    }

    return { ok: true, value: result };
  }

  return { validateCurveResult, finite, DEFAULT_TIME_TOLERANCE };
});

/**
 * 求值器登记的必需系数。页面里 evaluate.js 后加载，所以要在校验时再取。
 * @param {typeof globalThis} root
 * @param {string} equationId
 * @returns {string[] | null}
 */
function requiredParameterNames(root, equationId) {
  const live = root.BreakGlass && root.BreakGlass.evaluate && root.BreakGlass.evaluate.requiredParameters;
  if (live && Object.prototype.hasOwnProperty.call(live, equationId)) return live[equationId];
  if (typeof require === 'function') {
    const evaluate = require('./evaluate');
    if (evaluate.requiredParameters && Object.prototype.hasOwnProperty.call(evaluate.requiredParameters, equationId)) {
      return evaluate.requiredParameters[equationId];
    }
  }
  return null;
}
