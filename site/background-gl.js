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
var MAX_RIPPLES = 4;
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
  // 背景是慢动效，按 30fps 出图就够：省掉一半 GPU 负载，也不会因为掉帧而卡顿。
  // 不再用 preserveDrawingBuffer（每帧多一次整屏拷贝，是最贵的一项）。
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  var context = renderer.getContext();
  if (!context) return null;
  renderer.setClearAlpha(0);

  // 没有硬件加速时（SwiftShader / llvmpipe 等软件光栅化），片元成本高得多：
  // 直接把内部渲染分辨率降到 0.5，用 CSS 拉伸，保证不卡。
  var rendererName = '';
  try {
    var debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    rendererName = String(debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
  } catch (error) {
    rendererName = '';
  }
  var softwareRendering = /swiftshader|software|llvmpipe|basic render/i.test(rendererName);
  var qualityScale = softwareRendering ? 0.5 : 1;

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
  // rAF 在 60Hz 上约每 16.7ms 回调一次；阈值留 4ms 余量，才能稳定地每两帧渲染一次（≈30fps），
  // 否则会因为量化误差退化成每三帧一次（≈20fps）。
  var FRAME_INTERVAL_MS = 1000 / 30;
  var FRAME_SLACK_MS = 4;
  var frames = 0;
  var startedAt = performance.now();
  var lastRenderAt = -1;
  var width = 0;
  var height = 0;
  var dpr = 1;
  var startTime = performance.now();
  var frameId = 0;
  var active = [];

  function resize() {
    // 上限 1.5：高分屏下把片元数降到一半左右；软件渲染再乘 0.5。
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * qualityScale;
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
    var stamp = performance.now();
    // 限帧：不到 1/30 秒就直接跳过这一帧，不提交绘制。
    if (lastRenderAt >= 0 && stamp - lastRenderAt < FRAME_INTERVAL_MS - FRAME_SLACK_MS) {
      frameId = window.requestAnimationFrame(frame);
      return;
    }
    lastRenderAt = stamp;
    frames += 1;
    var now = (stamp - startTime) / 1000;
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
    info: function () {
      var elapsed = (performance.now() - startedAt) / 1000;
      return { glyphs: RAMP.length, ripples: active.length, size: [width, height], dpr: dpr, frames: frames, fps: elapsed > 0 ? Math.round(frames / elapsed) : 0, software: softwareRendering, gpu: rendererName.slice(0, 60) };
    },
  };
}