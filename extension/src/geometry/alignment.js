(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.alignment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const evaluate = BreakGlass.evaluate || (typeof require === 'function' ? require('../curve/evaluate') : null);
  const DEFAULT_TOLERANCE = 0.02;

  /**
   * 把比例收进声明的坐标窗口。超出 range 的 y 贴在区域边上，不画出 region。
   * @param {number} value
   * @returns {number}
   */
  function unitInterval(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  // 三层坐标：数学坐标 → 源帧像素 → 页面 CSS 像素（相对内容矩形左上角）。
  function mathPointToSource(definition, parameters, mathX) {
    if (!evaluate) throw new Error('alignment 需要 evaluate 模块。');
    const y = evaluate.evaluateWithParameters(definition, parameters, mathX);
    const xRatio = unitInterval((mathX - definition.domain.min) / (definition.domain.max - definition.domain.min));
    const rawY = definition.yAxis === 'up'
      ? (definition.range.max - y) / (definition.range.max - definition.range.min)
      : (y - definition.range.min) / (definition.range.max - definition.range.min);
    const yRatio = unitInterval(rawY);
    return {
      x: definition.region.x + xRatio * definition.region.width,
      y: definition.region.y + yRatio * definition.region.height
    };
  }

  function sourcePointToPage(point, scale) {
    return { x: point.x * scale, y: point.y * scale };
  }

  function pagePointToSource(point, scale) {
    return { x: point.x / scale, y: point.y / scale };
  }

  function mathPointToPage(definition, parameters, mathX, scale) {
    return sourcePointToPage(mathPointToSource(definition, parameters, mathX), scale);
  }

  function distance(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  /**
   * 偏差比例：两点距离 ÷ 内容区域较短边。黑边不参与比较。
   * @returns {number | null}
   */
  function deviationRatio(expected, actual, contentRect) {
    if (!expected || !actual || !contentRect) return null;
    const shorter = Math.min(contentRect.width, contentRect.height);
    if (!(shorter > 0)) return null;
    return distance(expected, actual) / shorter;
  }

  /**
   * 偏差比例不超过阈值即通过。比较时留出 1e-9，避免较短边乘 2% 的浮点余量被判出界。
   * 负数没有「更近」的含义，不算通过。
   * @param {unknown} ratio
   * @param {number} [tolerance]
   * @returns {boolean}
   */
  function withinTolerance(ratio, tolerance = DEFAULT_TOLERANCE) {
    const limit = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_TOLERANCE;
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= limit + 1e-9;
  }

  /**
   * domain 上等距取点，并补上还没落在采样格上的顶点横坐标。
   * @param {object} definition
   * @param {number} samples
   * @param {Record<string, number> | undefined} parameters
   * @returns {number[]}
   */
  function sampleXs(definition, samples, parameters) {
    const count = Math.max(2, Math.floor(Number.isFinite(samples) ? samples : 9));
    const span = definition.domain.max - definition.domain.min;
    const list = [];
    for (let index = 0; index < count; index += 1) {
      list.push(definition.domain.min + span * index / (count - 1));
    }
    const vertex = parameters && Number.isFinite(parameters.h) ? parameters.h : null;
    if (vertex !== null && vertex > definition.domain.min && vertex < definition.domain.max) {
      const present = list.some((value) => Math.abs(value - vertex) <= 1e-9);
      if (!present) list.push(vertex);
    }
    list.sort((left, right) => left - right);
    return list;
  }

  /**
   * 在 domain 上等距采样，逐点比较期望页面点与实测页面点。
   * @param {{ definition, parameters, scale, contentRect, samples?, readActual? }} input
   */
  function sampleAlignment({ definition, parameters, scale, contentRect, samples = 9, readActual } = {}) {
    const points = [];
    let maxRatio = 0;
    let measured = 0;
    for (const mathX of sampleXs(definition, samples, parameters)) {
      const expected = mathPointToPage(definition, parameters, mathX, scale);
      const actual = typeof readActual === 'function' ? readActual(mathX) : expected;
      const ratio = actual ? deviationRatio(expected, actual, contentRect) : null;
      if (ratio !== null && Number.isFinite(ratio)) {
        measured += 1;
        maxRatio = Math.max(maxRatio, ratio);
      }
      points.push({ mathX, expected, actual: actual || null, ratio });
    }
    const complete = points.length > 0 && measured === points.length;
    return {
      maxRatio,
      tolerance: DEFAULT_TOLERANCE,
      withinTolerance: complete && withinTolerance(maxRatio),
      points
    };
  }

  return {
    DEFAULT_TOLERANCE,
    mathPointToSource,
    mathPointToPage,
    sourcePointToPage,
    pagePointToSource,
    deviationRatio,
    withinTolerance,
    sampleAlignment
  };
});