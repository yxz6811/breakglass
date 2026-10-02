/* 背景入口：优先 three.js / WebGL，失败时由 site.js 的 canvas 2D 版本兜底。 */
import { createAsciiRippleGL } from './background-gl.js';

var canvas = document.querySelector('[data-ascii-ripple]');
if (canvas) {
  try {
    window.breakglassRippleGL = createAsciiRippleGL({ canvas: canvas, motif: Number(canvas.dataset.motif) || 0 });
  } catch (error) {
    window.breakglassRippleGL = null;
    canvas.dataset.renderer = '';
  }
}