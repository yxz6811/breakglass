(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function formatNumber(value) {
    const api = typeof require === 'function' ? require('./solve') : root.BreakGlass.geometryScene;
    return api.formatLength(value);
  }
  function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function make(document, tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((name) => node.setAttribute(name, attrs[name]));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function createTriangleView({ svg, document, onSetLength }) {
    let active = null;
    let drag = null;
    const listeners = [];
    function listen(node, type, handler) {
      node.addEventListener(type, handler);
      listeners.push(() => node.removeEventListener(type, handler));
    }
    function clear() { listeners.splice(0).forEach((remove) => remove()); clearNode(svg); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '确认条件后显示直角三角形'); active = null; drag = null; }
    function render(scene, result) {
      const focusedSide = document.activeElement?.getAttribute?.('data-side');
      clear();
      if (!scene || !result) return;
      svg.setAttribute('role', onSetLength ? 'group' : 'img');
      const maxLength = Math.max(scene.lengths.AB, scene.lengths.AC);
      const scale = 220;
      const width = result.normalizedVertices.B.x * scale;
      const height = result.normalizedVertices.C.y * scale;
      const A = { x: (420 - width) / 2, y: (300 + height) / 2 };
      const B = { x: A.x + width, y: A.y };
      const C = { x: A.x, y: A.y - height };
      active = { scene, result, A, B, C, maxLength, scale };
      svg.setAttribute('aria-label', `A 为直角，AB ${formatNumber(scene.lengths.AB)}，AC ${formatNumber(scene.lengths.AC)}，BC ${formatNumber(result.BC)}`);
      svg.appendChild(make(document, 'title', {}, '按确认条件等比绘制的直角三角形'));
      svg.appendChild(make(document, 'path', { class: 'triangle-line', d: `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z` }));
      const mark = Math.min(16, width / 3, height / 3);
      svg.appendChild(make(document, 'path', { class: 'triangle-angle', d: `M ${A.x + mark} ${A.y} v ${-mark} h ${-mark}` }));
      for (const [key, point] of [['A', A], ['B', B], ['C', C]]) {
        const fullLabel = scene.labels[key];
        const displayLabel = Array.from(fullLabel).length > 8 ? key : fullLabel;
        const textWidth = Array.from(displayLabel).reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 16 : 10), 0);
        const placement = key === 'A'
          ? { x: Math.min(196, Math.max(textWidth + 8, point.x - 10)), y: A.y + 24, 'text-anchor': 'end' }
          : key === 'B'
            ? { x: Math.max(224, Math.min(412 - textWidth, point.x + 10)), y: A.y + 24, 'text-anchor': 'start' }
            : { x: Math.min(412 - textWidth / 2, Math.max(8 + textWidth / 2, point.x)), y: Math.max(18, Math.min(point.y - 14, A.y - 42)), 'text-anchor': 'middle' };
        const label = make(document, 'text', { class: 'triangle-label', ...placement, 'aria-label': `${key}：${fullLabel}` }, displayLabel);
        label.appendChild(make(document, 'title', {}, `${key}：${fullLabel}`));
        svg.appendChild(label);
      }
      svg.appendChild(make(document, 'text', { class: 'triangle-side-label', x: (A.x + B.x) / 2, y: A.y - 12, 'text-anchor': 'middle' }, `AB ${formatNumber(scene.lengths.AB)}`));
      svg.appendChild(make(document, 'text', { class: 'triangle-side-label', x: A.x - 12, y: (A.y + C.y) / 2, 'text-anchor': 'end' }, `AC ${formatNumber(scene.lengths.AC)}`));
      svg.appendChild(make(document, 'text', { class: 'triangle-side-label', x: (B.x + C.x) / 2 + 12, y: (B.y + C.y) / 2 - 8 }, `BC ${formatNumber(result.BC)}`));
      if (!onSetLength) return;
      for (const [side, point] of [['AB', B], ['AC', C]]) {
        const group = make(document, 'g', { class: 'triangle-handle', 'data-side': side, tabindex: '0', role: 'button', 'aria-label': `调整 ${side}，当前 ${formatNumber(scene.lengths[side])}，箭头键改变 0.1；也可使用下方数值输入` });
        group.appendChild(make(document, 'circle', { class: 'triangle-hit', cx: point.x, cy: point.y, r: 22 }));
        group.appendChild(make(document, 'circle', { class: 'triangle-point', cx: point.x, cy: point.y, r: 7 }));
        listen(group, 'pointerdown', (event) => {
          if (event.button !== undefined && event.button !== 0) return;
          event.preventDefault();
          // Keep this transform fixed for this gesture; rendering may change the current scale.
          drag = { side, A: { ...A }, maxLength, scale, pointerId: event.pointerId };
          svg.setPointerCapture?.(event.pointerId);
        });
        listen(group, 'keydown', (event) => {
          const direction = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 0;
          if (!direction || !active) return;
          event.preventDefault();
          onSetLength(side, active.scene.lengths[side] + direction * 0.1);
        });
        svg.appendChild(group);
        if (focusedSide === side) group.focus?.();
      }
    }
    function move(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = svg.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      const matrix = svg.getScreenCTM?.();
      let x, y;
      if (matrix && typeof matrix.inverse === 'function') {
        const inverse = matrix.inverse();
        x = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e;
        y = inverse.b * event.clientX + inverse.d * event.clientY + inverse.f;
      } else {
        const screenScale = Math.min(rect.width / 420, rect.height / 300);
        const offsetX = (rect.width - 420 * screenScale) / 2;
        const offsetY = (rect.height - 300 * screenScale) / 2;
        x = (event.clientX - rect.left - offsetX) / screenScale;
        y = (event.clientY - rect.top - offsetY) / screenScale;
      }
      const value = (drag.side === 'AB' ? x - drag.A.x : drag.A.y - y) * drag.maxLength / drag.scale;
      if (!(value > 0 && Number.isFinite(value))) return;
      const gesture = drag;
      onSetLength(gesture.side, value);
      drag = gesture;
    }
    function release(event) {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      try { svg.releasePointerCapture?.(drag.pointerId); } catch (_) { /* Already released by the browser. */ }
      drag = null;
    }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
    function dispose() {
      clear();
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', release);
      svg.removeEventListener('pointercancel', release);
    }
    return { render, clear, dispose };
  }
  function renderFrameMarkers(svg, scene, document) {
    clearNode(svg);
    svg.hidden = !(scene && scene.vertices);
    if (svg.hidden) return;
    svg.setAttribute('viewBox', `0 0 ${scene.frameSize.width} ${scene.frameSize.height}`);
    const points = ['A', 'B', 'C'].map((key) => scene.vertices[key]);
    svg.appendChild(make(document, 'polyline', { points: points.concat(points[0]).map((point) => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: '#71ddff', 'stroke-width': '3' }));
    for (const key of ['A', 'B', 'C']) {
      const point = scene.vertices[key];
      svg.appendChild(make(document, 'circle', { class: 'frame-marker', cx: point.x, cy: point.y, r: 9 }));
      svg.appendChild(make(document, 'text', { class: 'frame-label', x: point.x + 12, y: point.y - 12 }, scene.labels[key]));
    }
  }
  const api = { createTriangleView, renderFrameMarkers, formatNumber };
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
