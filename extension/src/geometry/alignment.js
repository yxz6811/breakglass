(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.alignment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const evaluate = BreakGlass.evaluate || (typeof require === 'function' ? require('../curve/evaluate') : null);
  const DEFAULT_TOLERANCE = 0.02;

  // 三层坐标：数学坐标 → 源帧像素 → 页面 CSS 像素（相对内容矩形左上角）。
  function mathPointToSource(definition, parameters, mathX) {
    if (!evaluate) throw new Error('alignment 需要 evaluate 模块。');
    const y = evaluate.evaluateWithParameters(definition, parameters, mathX);
    const xRatio = (mathX - definition.domain.min) / (definition.domain.max - definition.domain.min);
    const yRatio = definition.yAxis === 'up'
      ? (definition.range.max - y) / (definition.range.max - definition.range.min)
      : (y - definition.range.min) / (definition.range.max - definition.range.min);
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

  function withinTolerance(ratio, tolerance = DEFAULT_TOLERANCE) {
    return Number.isFinite(ratio) && ratio <= tolerance;
  }

  function sampleXs(definition, samples) {
    const count = Math.max(2, Math.floor(samples));
    const list = [];
    for (let index = 0; index < count; index += 1) {
      list.push(definition.domain.min + (definition.domain.max - definition.domain.min) * index / (count - 1));
    }
    return list;
  }

  /**
   * 在 domain 上等距采样，逐点比较期望页面点与实测页面点。
   * @param {{ definition, parameters, scale, contentRect, samples?, readActual? }} input
   */
  function sampleAlignment({ definition, parameters, scale, contentRect, samples = 9, readActual } = {}) {
    const points = [];
    let maxRatio = 0;
    for (const mathX of sampleXs(definition, samples)) {
      const expected = mathPointToPage(definition, parameters, mathX, scale);
      const actual = typeof readActual === 'function' ? readActual(mathX) : expected;
      const ratio = actual ? deviationRatio(expected, actual, contentRect) : null;
      if (ratio !== null) maxRatio = Math.max(maxRatio, ratio);
      points.push({ mathX, expected, actual: actual || null, ratio });
    }
    return {
      maxRatio,
      tolerance: DEFAULT_TOLERANCE,
      withinTolerance: withinTolerance(maxRatio),
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