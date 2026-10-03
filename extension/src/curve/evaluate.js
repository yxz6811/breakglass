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
    for (const name of Object.keys(source)) {
      if (!names.includes(name)) throw new TypeError(`未知参数 ${name}。`);
    }
    const values = {};
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(source, name) || !Number.isFinite(source[name])) {
        throw new TypeError(`参数 ${name} 必须是有限数值。`);
      }
      values[name] = source[name];
    }
    if (definition.equationId === 'fixture.parabola' && values.a === 0) {
      throw new TypeError('抛物线参数 a 不得为 0。');
    }
    return values;
  }

  /**
   * 校验整段可调参数与绘图域，而非只验证 initial 的几个采样点。
   * 抛物线的 |x-h| 极值在区间端点，顶点 y=k 已经过有限值校验；检查各
   * 系数与 x 端点即可覆盖所有可调组合，且使用和绘图相同的浮点运算。
   * @param {object} definition 已通过字段与范围校验的定义
   */
  function assertFiniteDomain(definition) {
    coefficients(definition);
    if (definition.equationId !== 'fixture.parabola') throw new Error('未登记曲线的范围校验器。');
    const { a, h, k } = definition.parameters;
    if (a.min <= 0 && a.max >= 0) throw new TypeError('抛物线参数 a 的范围不得包含 0。');
    for (const aValue of [a.min, a.max]) {
      for (const hValue of [h.min, h.max]) {
        for (const kValue of [k.min, k.max]) {
          for (const x of [definition.domain.min, definition.domain.max]) {
            evaluateWithParameters(definition, { a: aValue, h: hValue, k: kValue }, x);
          }
        }
      }
    }
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

  return { evaluators, requiredParameters, evaluateCurve, evaluateWithParameters, assertFiniteDomain };
});
