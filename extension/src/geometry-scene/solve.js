(function (root, factory) {
  const api = factory(root.BreakGlass && root.BreakGlass.geometryScene);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryScene = Object.assign(root.BreakGlass.geometryScene || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (existing) {
  const validation = typeof require === 'function' ? require('./validate') : existing;

  /**
   * A unitless drawing with one shared scale; never infer lengths from source pixels.
   * @param {object} scene
   * @returns {{BC: number, normalizedVertices: {A: object, B: object, C: object}}}
   */
  function solveTriangle(scene) {
    const checked = validation.validateScene(scene);
    if (!checked.ok) throw new TypeError(checked.message);
    const { AB, AC } = checked.scene.lengths;
    const span = Math.max(AB, AC);
    return {
      BC: Math.hypot(AB, AC),
      normalizedVertices: { A: { x: 0, y: 0 }, B: { x: AB / span, y: 0 }, C: { x: 0, y: AC / span } }
    };
  }

  /** Shared display rounding; formatted values never replace calculation state. */
  function formatLength(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const magnitude = Math.abs(value);
    if (magnitude >= 1e7 || (magnitude > 0 && magnitude < 0.001)) {
      // Keep the formatted exponent as text: reparsing a rounded MAX_VALUE can overflow.
      return value.toExponential(3);
    }
    return String(Number(value.toFixed(3)));
  }

  return { solveTriangle, formatLength };
});
