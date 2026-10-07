/**
 * 把已接受的几何图形画回暂停帧。像素只决定摆放，长度来自条件。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryLessonView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SVG = 'http://www.w3.org/2000/svg';

  /**
   * @param {object} point
   * @param {object} given
   * @returns {Record<string, { x: number, y: number }>}
   */
  function triangleVertices(point, given) {
    const original = point.placement.vertices;
    const right = point.given.rightAngleAt;
    const next = {};
    next[right] = { ...original[right] };
    given.legs.forEach((leg) => {
      const initial = point.given.legs.find((item) => item.id === leg.id);
      const far = leg.from === right ? leg.to : leg.from;
      const scale = leg.length / initial.length;
      const origin = original[right];
      const target = original[far];
      next[far] = {
        x: origin.x + (target.x - origin.x) * scale,
        y: origin.y + (target.y - origin.y) * scale
      };
    });
    return next;
  }

  /**
   * @param {object} point
   * @param {object} given
   * @returns {{ start: { x: number, y: number }, end: { x: number, y: number } }}
   */
  function segmentEnds(point, given) {
    const start = point.placement.start;
    const end = point.placement.end;
    const scale = given.length / point.given.length;
    return {
      start: { ...start },
      end: {
        x: start.x + (end.x - start.x) * scale,
        y: start.y + (end.y - start.y) * scale
      }
    };
  }

  /**
   * @param {SVGSVGElement} svg
   * @param {object | null} point
   * @param {object | null} draft
   */
  function render(svg, point, draft) {
    if (!svg) return;
    const frame = point && point.frameSize;
    if (!point || !draft || !frame) {
      svg.setAttribute('aria-label', '');
      if ('dataset' in svg) svg.dataset.summary = '';
      return;
    }
    svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
    const summary = rootBreakGlassSummary(point, draft.given);
    svg.setAttribute('aria-label', summary);
    if ('dataset' in svg) svg.dataset.summary = summary;
    const document = svg.ownerDocument;
    if (!document || typeof document.createElementNS !== 'function') return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const shape = document.createElementNS(SVG, point.kind === 'circle' ? 'circle' : 'polyline');
    shape.setAttribute('fill', 'none');
    shape.setAttribute('stroke', '#7ddec9');
    shape.setAttribute('stroke-width', String(Math.max(frame.width, frame.height) * 0.008));
    if (point.kind === 'circle') {
      const base = Math.min(frame.width, frame.height) * 0.16;
      shape.setAttribute('cx', String(draft.given.center.x));
      shape.setAttribute('cy', String(draft.given.center.y));
      shape.setAttribute('r', String(base * (draft.given.radius / point.given.radius)));
    } else if (point.kind === 'segment') {
      const ends = segmentEnds(point, draft.given);
      shape.setAttribute('points', `${ends.start.x},${ends.start.y} ${ends.end.x},${ends.end.y}`);
    } else {
      const vertices = triangleVertices(point, draft.given);
      const right = draft.given.rightAngleAt;
      const names = [right].concat(draft.given.legs.map((leg) => (leg.from === right ? leg.to : leg.from)));
      const ordered = [vertices[names[1]], vertices[names[0]], vertices[names[2]], vertices[names[1]]];
      shape.setAttribute('points', ordered.map((item) => `${item.x},${item.y}`).join(' '));
    }
    svg.appendChild(shape);
  }

  /**
   * @param {object} point
   * @param {object} given
   * @returns {string}
   */
  function rootBreakGlassSummary(point, given) {
    const solve = typeof globalThis !== 'undefined' && globalThis.BreakGlass && globalThis.BreakGlass.geometryLessonSolve;
    if (solve) return solve.summary(point, given);
    return '';
  }

  return { render, triangleVertices, segmentEnds };
});