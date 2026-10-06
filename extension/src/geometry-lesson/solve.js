/**
 * 几何阅读破壁后的确定性调节。一次只改一项，斜边只由两条直角边计算。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryLessonSolve = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  /**
   * @param {object} point
   * @returns {object}
   */
  function copyGiven(point) {
    return JSON.parse(JSON.stringify(point.given));
  }

  /**
   * @param {object} point
   * @param {object} given 当前工作条件，不改点上的原始 given
   * @returns {object}
   */
  function derivedFor(point, given) {
    if (point.kind !== 'right-triangle') return {};
    const far = given.legs.map((leg) => (leg.from === given.rightAngleAt ? leg.to : leg.from));
    return {
      hypotenuse: {
        id: far[0] + far[1],
        from: far[0],
        to: far[1],
        length: Math.hypot(given.legs[0].length, given.legs[1].length)
      }
    };
  }

  /**
   * @param {number} value
   * @returns {string}
   */
  function formatLength(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const magnitude = Math.abs(value);
    if (magnitude >= 1e7 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(3);
    return String(Number(value.toFixed(3)));
  }

  /**
   * @param {object} point
   * @param {object} given
   * @param {{ type: string, id?: string, value?: number }} action
   * @returns {{ ok: true, given: object, derived: object } | { ok: false, reason: string }}
   */
  function adjust(point, given, action) {
    if (!point || !given || !action) return { ok: false, reason: 'unknown' };
    if (action.type === 'set_leg') {
      if (point.kind !== 'right-triangle' || !Array.isArray(given.legs)) return { ok: false, reason: 'unsupported' };
      if (!positive(action.value)) return { ok: false, reason: 'not_finite' };
      const legs = given.legs.map((leg) => ({ ...leg }));
      const target = legs.find((leg) => leg.id === action.id);
      if (!target) return { ok: false, reason: 'incomplete' };
      target.length = action.value;
      const next = { rightAngleAt: given.rightAngleAt, legs };
      return { ok: true, given: next, derived: derivedFor(point, next) };
    }
    if (action.type === 'set_radius') {
      if (point.kind !== 'circle') return { ok: false, reason: 'unsupported' };
      if (!positive(action.value)) return { ok: false, reason: 'not_finite' };
      const next = { center: { ...given.center }, radius: action.value };
      return { ok: true, given: next, derived: {} };
    }
    if (action.type === 'set_length') {
      if (point.kind !== 'segment') return { ok: false, reason: 'unsupported' };
      if (!positive(action.value)) return { ok: false, reason: 'not_finite' };
      const next = { start: { ...given.start }, end: { ...given.end }, length: action.value };
      return { ok: true, given: next, derived: {} };
    }
    return { ok: false, reason: 'unsupported' };
  }

  /**
   * @param {object} point
   * @param {object} given
   * @returns {string}
   */
  function summary(point, given) {
    const derived = derivedFor(point, given);
    if (point.kind === 'right-triangle') {
      return `直角边 ${formatLength(given.legs[0].length)} 与 ${formatLength(given.legs[1].length)}，斜边 ${formatLength(derived.hypotenuse.length)}`;
    }
    if (point.kind === 'circle') return `半径 ${formatLength(given.radius)}`;
    return `长度 ${formatLength(given.length)}`;
  }

  return { copyGiven, derivedFor, adjust, formatLength, summary };
});
