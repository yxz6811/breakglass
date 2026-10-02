/*
 * ASCII 涟漪背景 · three.js / WebGL 版。
 * 用 shader 在片元里算「单元 → 强度 → 字形」，字形来自运行时生成的图集纹理；
 * 指针涟漪与环境场都在 GPU 上算，CPU 每帧只更新几个 uniform。
 * three.js 本地内置在 ./vendor（MIT），不引 CDN，保持零第三方请求。
 */
import * as THREE from './vendor/three.module.min.js';

var RAMP = ' .`-:;+=*x#%@';
var CELL_W = 16;
var CELL_H = 20;
var MAX_RIPPLES = 6;
var RIPPLE_SPEED = 320;
var RIPPLE_WIDTH = 92;

var VERTEX = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');

var FRAGMENT = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform vec2 uResolution;',
  'uniform vec2 uCell;',
  'uniform float uTime;',
  'uniform float uGlyphCount;',
  'uniform sampler2D uAtlas;',
  'uniform float uRippleCount;',
  'uniform vec4 uRipples[' + MAX_RIPPLES + '];',
  '',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  '',
  'void main() {',
  '  vec2 frag = vUv * uResolution;',
  '  vec2 cellId = floor(frag / uCell);',
  '  vec2 local = fract(frag / uCell);',
  '  float field = floor(uTime * 4.0) / 4.0;',
  '  float value = 0.12 + hash(cellId) * 0.12;',
  '  value += (sin((cellId.x + field * 4.0) * 0.19) * 0.5 + cos((cellId.y - field * 3.0) * 0.23) * 0.5) * 0.08 + 0.08;',
  '  for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
  '    if (float(i) >= uRippleCount) break;',
  '    vec4 ripple = uRipples[i];',
  '    vec2 center = vec2(ripple.x, uResolution.y - ripple.y);',
  '    float age = uTime - ripple.z;',
  '    float offset = distance(frag, center) - age * ' + RIPPLE_SPEED + '.0;',
  '    value += exp(-(offset * offset) / (2.0 * ' + RIPPLE_WIDTH + '.0 * ' + RIPPLE_WIDTH + '.0)) * ripple.w * exp(-age * 0.9);',
  '  }',
  '  value = clamp(value, 0.0, 1.0);',
  '  float glyph = floor(value * (uGlyphCount - 0.001));',
  '  vec2 atlasUv = vec2((glyph + local.x) / uGlyphCount, 1.0 - local.y);',
  '  float mask = texture2D(uAtlas, atlasUv).a;',
  '  vec3 color = mix(vec3(0.40, 0.52, 0.62), vec3(0.85, 0.95, 1.0), value);',
  '  gl_FragColor = vec4(color, mask * (0.30 + value * 0.55));',
  '}',
].join('\n');

function buildAtlas() {
  var size = 32;
  var canvas = document.createElement('canvas');
  canvas.width = size * RAMP.length;
  canvas.height = size;
  var context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = Math.round(size * 0.8) + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  for (var i = 0; i < RAMP.length; i += 1) {
    context.fillText(RAMP.charAt(i), i * size + size * 0.5, size * 0.5 + 1);
  }
  var texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createAsciiRippleGL(options) {
  var settings = options || {};
  var canvas = settings.canvas;
  if (!canvas) return null;
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!renderer.getContext()) return null;
  renderer.setClearAlpha(0);

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var ripples = [];
  for (var i = 0; i < MAX_RIPPLES; i += 1) ripples.push(new THREE.Vector4(0, 0, -999, 0));

  var uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCell: { value: new THREE.Vector2(CELL_W, CELL_H) },
    uTime: { value: 0 },
    uGlyphCount: { value: RAMP.length },
    uAtlas: { value: buildAtlas() },
    uRippleCount: { value: 0 },
    uRipples: { value: ripples },
  };
  var material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var width = 0;
  var height = 0;
  var dpr = 1;
  var startTime = performance.now();
  var frameId = 0;
  var active = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    uniforms.uResolution.value.set(width * dpr, height * dpr);
    uniforms.uCell.value.set(CELL_W * dpr, CELL_H * dpr);
  }

  function pushRipple(clientX, clientY, strength) {
    var rect = canvas.getBoundingClientRect();
    active.push({ x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr, start: (performance.now() - startTime) / 1000, strength: strength });
    if (active.length > MAX_RIPPLES) active.shift();
  }

  function frame() {
    var now = (performance.now() - startTime) / 1000;
    uniforms.uTime.value = now;
    var used = 0;
    for (var i = 0; i < MAX_RIPPLES; i += 1) {
      if (i < active.length) {
        var ripple = active[i];
        ripples[i].set(ripple.x, ripple.y, ripple.start, ripple.strength);
        used += 1;
      } else {
        ripples[i].set(0, 0, -999, 0);
      }
    }
    uniforms.uRippleCount.value = used;
    renderer.render(scene, camera);
    if (!reduceMotion) frameId = window.requestAnimationFrame(frame);
  }

  var lastMove = 0;
  function onPointerMove(event) {
    var stamp = performance.now();
    if (stamp - lastMove < 70) return;
    lastMove = stamp;
    pushRipple(event.clientX, event.clientY, 0.55);
  }
  function onPointerDown(event) { pushRipple(event.clientX, event.clientY, 1); }
  var resizeTimer = 0;
  function onResize() {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 160);
  }
  function onVisibility() {
    if (document.hidden) { window.cancelAnimationFrame(frameId); frameId = 0; }
    else if (!frameId && !reduceMotion) frameId = window.requestAnimationFrame(frame);
  }

  resize();
  renderer.render(scene, camera);
  if (!reduceMotion) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    window.setTimeout(function () { pushRipple(width * 0.32, height * 0.42, 0.9); }, 500);
    frameId = window.requestAnimationFrame(frame);
  }
  canvas.dataset.renderer = 'webgl';
  return {
    renderer: renderer,
    dispose: function () { window.cancelAnimationFrame(frameId); renderer.dispose(); },
    rippleAt: pushRipple,
    info: function () { return { glyphs: RAMP.length, ripples: active.length, size: [width, height], dpr: dpr }; },
  };
}