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
    const evaluatedY = evaluate.evaluateWithParameters(definition, parameters, mathX);
    // 越界曲线先贴边，避免有限但相距极大的 y 与 range 端点相减溢出后贴错边。
    const y = Math.max(definition.range.min, Math.min(definition.range.max, evaluatedY));
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

  // 已经过裁剪的任意数学点。圆有上下两支，不能再次按 x 求一个 y。
  function mathCoordinatesToPage(definition, point, scale) {
    const xRatio = (point.x - definition.domain.min) / (definition.domain.max - definition.domain.min);
    const yRatio = definition.yAxis === 'up'
      ? (definition.range.max - point.y) / (definition.range.max - definition.range.min)
      : (point.y - definition.range.min) / (definition.range.max - definition.range.min);
    return sourcePointToPage({
      x: definition.region.x + xRatio * definition.region.width,
      y: definition.region.y + yRatio * definition.region.height
    }, scale);
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
      list.push(definition.domain.min + span * (index / (count - 1)));
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

  /**
   * 抛物线与一条水平界 y = bound 的交点，只保留开区间 (x0, x1) 里的横坐标。
   * @param {Record<string, number>} parameters
   * @param {number} bound
   * @param {number} x0
   * @param {number} x1
   * @returns {number[]}
   */
  function crossingsBetween(parameters, bound, x0, x1) {
    const a = parameters.a;
    const h = parameters.h;
    const k = parameters.k;
    if (!Number.isFinite(a) || a === 0) return [];
    const ratio = (bound - k) / a;
    if (!(ratio >= 0)) return [];
    const root = Math.sqrt(ratio);
    const low = Math.min(x0, x1);
    const high = Math.max(x0, x1);
    return [h - root, h + root]
      .filter((x) => x > low + 1e-8 && x < high - 1e-8)
      .sort((left, right) => left - right);
  }

  /**
   * 窗口里实际能看见的弧。y 超出 range 的采样不贴到边上连线：
   * 臂在边界处断开，窗口外整段落空。
   * @param {object} definition
   * @param {Record<string, number>} parameters
   * @param {number} [samples]
   * @returns {{ x: number, y: number }[][]}
   */
  function visibleCurvePolylines(definition, parameters, samples = 81) {
    const xs = sampleXs(definition, samples, parameters);
    const min = definition.range.min;
    const max = definition.range.max;
    const yAt = (x) => evaluate.evaluateWithParameters(definition, parameters, x);
    const inside = (y) => y >= min && y <= max;
    const polylines = [];
    let current = null;

    /**
     * @param {number} x
     * @param {number} y
     */
    function pushPoint(x, y) {
      if (!current) {
        current = [];
        polylines.push(current);
      }
      const last = current[current.length - 1];
      if (last && Math.abs(last.x - x) <= 1e-8 && Math.abs(last.y - y) <= 1e-8) return;
      current.push({ x, y });
    }

    function endLine() {
      current = null;
    }

    for (let index = 0; index < xs.length - 1; index += 1) {
      const x0 = xs[index];
      const x1 = xs[index + 1];
      const y0 = yAt(x0);
      const y1 = yAt(x1);
      const in0 = inside(y0);
      const in1 = inside(y1);
      if (in0 && in1) {
        pushPoint(x0, y0);
        pushPoint(x1, y1);
        continue;
      }
      if (in0 && !in1) {
        pushPoint(x0, y0);
        const bound = y1 > max ? max : min;
        const [cross] = crossingsBetween(parameters, bound, x0, x1);
        if (Number.isFinite(cross)) pushPoint(cross, bound);
        endLine();
        continue;
      }
      if (!in0 && in1) {
        endLine();
        const bound = y0 > max ? max : min;
        const hits = crossingsBetween(parameters, bound, x0, x1);
        const cross = hits[hits.length - 1];
        if (Number.isFinite(cross)) pushPoint(cross, bound);
        pushPoint(x1, y1);
        continue;
      }
      const hits = [min, max].flatMap((bound) => (
        (y0 - bound) * (y1 - bound) < 0
          ? crossingsBetween(parameters, bound, x0, x1).map((x) => ({ x, y: bound }))
          : []
      )).sort((left, right) => left.x - right.x);
      if (hits.length >= 2) {
        endLine();
        hits.forEach((point) => pushPoint(point.x, point.y));
        endLine();
      }
    }

    return polylines.filter((line) => line.length >= 2);
  }

  return {
    DEFAULT_TOLERANCE,
    mathPointToSource,
    mathPointToPage,
    mathCoordinatesToPage,
    sourcePointToPage,
    pagePointToSource,
    deviationRatio,
    withinTolerance,
    sampleAlignment,
    visibleCurvePolylines
  };
});
