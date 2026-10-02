(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.evaluate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const requiredParameters = {
    'fixture.parabola': ['a', 'h', 'k']
  };
  const evaluators = {
    'fixture.parabola': ({ a, h, k }, x) => a * (x - h) * (x - h) + k
  };

  /**
   * 取出这条曲线必需的有限系数。缺任何一个都不能算出可绘制的 y。
   * @param {object} definition
   * @param {Record<string, number> | undefined} supplied
   * @returns {Record<string, number>}
   */
  function coefficients(definition, supplied) {
    const names = definition && requiredParameters[definition.equationId];
    if (!names || !Object.prototype.hasOwnProperty.call(evaluators, definition.equationId)) {
      throw new Error(`未知 equationId: ${definition && definition.equationId}`);
    }
    const source = supplied || Object.fromEntries(
      Object.entries(definition.parameters || {}).map(([name, value]) => [name, value && typeof value === 'object' ? value.initial : value])
    );
    const values = {};
    for (const name of names) {
      if (!Number.isFinite(source[name])) throw new TypeError(`参数 ${name} 必须是有限数值。`);
      values[name] = source[name];
    }
    return values;
  }

  /**
   * @param {object} definition
   * @param {number} x
   * @returns {number}
   */
  function evaluateCurve(definition, x) {
    if (!Number.isFinite(x)) throw new TypeError('x 必须是有限数值。');
    const y = evaluators[definition.equationId](coefficients(definition), x);
    if (!Number.isFinite(y)) throw new TypeError('求值结果必须是有限数值。');
    return y;
  }

  /**
   * @param {object} definition
   * @param {Record<string, number>} parameters
   * @param {number} x
   * @returns {number}
   */
  function evaluateWithParameters(definition, parameters, x) {
    if (!Number.isFinite(x)) throw new TypeError('x 必须是有限数值。');
    const y = evaluators[definition.equationId](coefficients(definition, parameters), x);
    if (!Number.isFinite(y)) throw new TypeError('求值结果必须是有限数值。');
    return y;
  }

  return { evaluators, requiredParameters, evaluateCurve, evaluateWithParameters };
});
