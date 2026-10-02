/*
 * ASCII 涟漪背景 · three.js / WebGL 版。
 *
 * 能力：
 *  - 字符网格：片元里算「单元 -> 强度 -> 字形」，字形取自运行时生成的图集纹理；
 *  - 内容图案：按板块选一组 SDF 图案（视频画面 / 抛物线破框 / 前后对比 / 曲线与滑块 / 工具栏）；
 *  - 流动渐变：方向随机切换的正弦渐变，颜色缓慢冷暖流动；
 *  - 跟随鼠标：渐变中心朝指针偏移，指针周围叠一圈冷青光辉；
 *  - 限帧 30fps、DPR 上限 1.5、软件光栅化再降一档；不用 preserveDrawingBuffer。
 *
 * 关键约定：图案与底纹只决定「选哪个字」，渐变与光晕只决定「颜色与明暗」。
 * 两者分离后，整屏字符不会随波跳变 —— 早先混在一起时观感就是闪烁。
 *
 * three.js 本地内置在 ./vendor（MIT），不引 CDN。
 */
import * as THREE from './vendor/three.module.min.js';

var RAMP = ' .`-:;+=*x#%@';
var CELL_W = 16;
var CELL_H = 20;
var MAX_RIPPLES = 4;
var RIPPLE_SPEED = 320;
var RIPPLE_WIDTH = 92;
var FRAME_INTERVAL_MS = 1000 / 30;
var FRAME_SLACK_MS = 4;

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
  'uniform vec2 uFlowDir;',
  'uniform float uFlowPhase;',
  'uniform vec2 uPointer;',
  'uniform float uMotif;',
  'uniform float uAspect;',
  '',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float sdBox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r; }',
  'float sdCircle(vec2 p, float r) { return length(p) - r; }',
  'float sdSegment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }',
  'float sdParabola(vec2 p, float a, vec2 v) { vec2 q = p - v; return abs(q.y - a * q.x * q.x) * inversesqrt(1.0 + 4.0 * a * a * q.x * q.x); }',
  'float ink(float d, float w) { return 1.0 - smoothstep(w * 0.35, w, d); }',
  '',
  'float motifInk(vec2 p, float id) {',
  '  float w = 0.015;',
  '  float acc = 0.0;',
  '  if (id < 0.5) {',
  '    return 0.0;',
  '  } else if (id < 1.5) {',
  '    acc = max(acc, ink(abs(sdBox(p, vec2(0.30, 0.19), 0.02)), w));',
  '    acc = max(acc, ink(abs(p.y - 0.235), w) * step(abs(p.x), 0.30));',
  '    acc = max(acc, ink(abs(p.y + 0.235), w) * step(abs(p.x), 0.30));',
  '    vec2 t1 = vec2(-0.055, -0.075);',
  '    vec2 t2 = vec2(-0.055, 0.075);',
  '    vec2 t3 = vec2(0.075, 0.0);',
  '    acc = max(acc, ink(sdSegment(p, t1, t2), w * 1.1));',
  '    acc = max(acc, ink(sdSegment(p, t2, t3), w * 1.1));',
  '    acc = max(acc, ink(sdSegment(p, t3, t1), w * 1.1));',
  '  } else if (id < 2.5) {',
  '    acc = max(acc, ink(abs(sdBox(p, vec2(0.30, 0.13), 0.02)), w));',
  '    acc = max(acc, ink(sdParabola(p, 2.4, vec2(0.0, -0.16)), w * 1.25));',
  '    acc = max(acc, ink(sdCircle(p - vec2(0.0, -0.16), 0.018), w));',
  '  } else if (id < 3.5) {',
  '    acc = max(acc, ink(abs(p.y + 0.02), w) * step(length(p - vec2(-0.26, -0.02)), 0.15));',
  '    acc = max(acc, ink(sdParabola(p, 3.2, vec2(0.26, -0.14)), w * 1.2));',
  '    acc = max(acc, ink(abs(p.x - 0.06), w * 0.7));',
  '    acc = max(acc, ink(sdCircle(p - vec2(0.26, -0.14), 0.016), w));',
  '  } else if (id < 4.5) {',
  '    acc = max(acc, ink(sdParabola(p, 2.6, vec2(0.0, -0.10)), w * 1.2));',
  '    acc = max(acc, ink(sdCircle(p - vec2(0.0, -0.10), 0.018), w));',
  '    for (int i = 0; i < 3; i++) {',
  '      float y = -0.30 - float(i) * 0.052;',
  '      acc = max(acc, ink(abs(p.y - y), w * 0.55) * step(abs(p.x), 0.20));',
  '      acc = max(acc, ink(sdCircle(p - vec2(-0.12 + float(i) * 0.11, y), 0.013), w));',
  '    }',
  '  } else {',
  '    for (int i = 0; i < 8; i++) {',
  '      float x = -0.32 + float(i) * 0.085;',
  '      acc = max(acc, ink(sdCircle(p - vec2(x, 0.30), 0.015), w));',
  '    }',
  '    acc = max(acc, ink(abs(sdBox(p - vec2(0.26, -0.02), vec2(0.16, 0.16), 0.02)), w * 0.9));',
  '    for (int i = 0; i < 3; i++) {',
  '      float y = 0.05 - float(i) * 0.062;',
  '      acc = max(acc, ink(abs(p.y - y), w * 0.5) * step(abs(p.x - 0.26), 0.13));',
  '      acc = max(acc, ink(sdCircle(p - vec2(0.21 + float(i) * 0.05, y), 0.012), w));',
  '    }',
  '  }',
  '  return acc;',
  '}',
  '',
  'void main() {',
  '  vec2 frag = vUv * uResolution;',
  '  vec2 cellId = floor(frag / uCell);',
  '  vec2 local = fract(frag / uCell);',
  '  vec2 cellUv = (cellId + 0.5) * uCell / uResolution;',
  '  vec2 motifP = (cellUv - 0.5) * vec2(uAspect, 1.0);',
  '  float pattern = motifInk(motifP, uMotif);',
  '  float value = 0.20 + hash(cellId) * 0.10;',
  '  value += (sin((cellId.x + uTime * 0.32) * 0.16) * 0.5 + cos((cellId.y - uTime * 0.26) * 0.19) * 0.5) * 0.07 + 0.07;',
  '  vec2 flowAxisDir = normalize(uFlowDir + vec2(0.0001));',
  '  vec2 flowOrigin = mix(vec2(0.5), uPointer, 0.45);',
  '  float axis = dot(vUv - flowOrigin, flowAxisDir);',
  '  float flowWave = 0.5 + 0.5 * sin(axis * 2.6 - uFlowPhase);',
  '  vec2 pointerDelta = vUv - uPointer;',
  '  float halo = exp(-dot(pointerDelta, pointerDelta) / (2.0 * 0.26 * 0.26));',
  '  value = clamp(value * (1.0 - pattern * 0.85) + pattern * 0.90, 0.0, 1.0);',
  '  float tone = clamp(value + flowWave * 0.26 + halo * 0.22 + pattern * 0.12, 0.0, 1.0);',
  '  for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
  '    if (float(i) >= uRippleCount) break;',
  '    vec4 ripple = uRipples[i];',
  '    vec2 center = vec2(ripple.x, uResolution.y - ripple.y);',
  '    float age = uTime - ripple.z;',
  '    float offset = distance(frag, center) - age * ' + RIPPLE_SPEED + '.0;',
  '    tone += exp(-(offset * offset) / (2.0 * ' + RIPPLE_WIDTH + '.0 * ' + RIPPLE_WIDTH + '.0)) * ripple.w * exp(-age * 0.9) * 0.6;',
  '  }',
  '  tone = clamp(tone, 0.0, 1.0);',
  '  float glyph = floor(value * (uGlyphCount - 0.001));',
  '  vec2 atlasUv = vec2((glyph + local.x) / uGlyphCount, 1.0 - local.y);',
  '  float mask = texture2D(uAtlas, atlasUv).a;',
  '  vec3 base = mix(vec3(0.42, 0.52, 0.64), vec3(0.95, 0.99, 1.0), tone);',
  '  vec3 flowTint = mix(vec3(0.74, 0.92, 1.0), vec3(0.88, 0.80, 1.0), 0.5 + 0.5 * sin(uFlowPhase * 0.12 + axis * 1.4));',
  '  flowTint = mix(flowTint, vec3(0.72, 0.98, 1.0), halo * 0.85);',
  '  vec3 color = base * mix(vec3(1.0), flowTint, 0.32);',
  '  gl_FragColor = vec4(color, mask * (0.34 + tone * 0.56));',
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
  var motif = Number(settings.motif) || 0;
  if (!canvas) return null;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, preserveDrawingBuffer: false });
  var context = renderer.getContext();
  if (!context) return null;
  renderer.setClearAlpha(0);

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
    uFlowDir: { value: new THREE.Vector2(1, 0) },
    uFlowPhase: { value: 0 },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    uMotif: { value: motif },
    uAspect: { value: 1 },
  };
  var material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: uniforms, transparent: true, depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var width = 0;
  var height = 0;
  var dpr = 1;
  var startTime = performance.now();
  var frameId = 0;
  var frames = 0;
  var startedAt = performance.now();
  var lastRenderAt = -1;
  var active = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * qualityScale;
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    uniforms.uResolution.value.set(width * dpr, height * dpr);
    uniforms.uCell.value.set(CELL_W * dpr, CELL_H * dpr);
    uniforms.uAspect.value = height > 0 ? width / height : 1;
  }

  function pushRipple(clientX, clientY, strength) {
    var rect = canvas.getBoundingClientRect();
    active.push({ x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr, start: (performance.now() - startTime) / 1000, strength: strength });
    if (active.length > MAX_RIPPLES) active.shift();
  }

  var pointerTarget = new THREE.Vector2(0.5, 0.5);
  var pointerSmooth = new THREE.Vector2(0.5, 0.5);
  function trackPointer(event) {
    pointerTarget.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight);
  }

  var currentAngle = 0;
  var flowAngleFrom = 0;
  var flowAngleTo = 0;
  var flowSwitchAt = 0;
  var flowSpan = 8;
  function pickFlowAngle(seconds) {
    flowAngleFrom = flowAngleTo;
    flowAngleTo = Math.random() * Math.PI * 2;
    var delta = flowAngleTo - flowAngleFrom;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    flowAngleTo = flowAngleFrom + delta;
    flowSwitchAt = seconds;
    flowSpan = 6 + Math.random() * 6;
  }

  function frame() {
    var stamp = performance.now();
    if (lastRenderAt >= 0 && stamp - lastRenderAt < FRAME_INTERVAL_MS - FRAME_SLACK_MS) {
      frameId = window.requestAnimationFrame(frame);
      return;
    }
    lastRenderAt = stamp;
    frames += 1;
    var now = (stamp - startTime) / 1000;
    uniforms.uTime.value = now;
    if (flowSwitchAt === 0) pickFlowAngle(0);
    if (now - flowSwitchAt > flowSpan) pickFlowAngle(now);
    var progress = Math.min(1, Math.max(0, (now - flowSwitchAt) / flowSpan));
    var eased = progress * progress * (3 - 2 * progress);
    currentAngle = flowAngleFrom + (flowAngleTo - flowAngleFrom) * eased;
    uniforms.uFlowDir.value.set(Math.cos(currentAngle), Math.sin(currentAngle));
    uniforms.uFlowPhase.value += (FRAME_INTERVAL_MS / 1000) * 0.35;
    pointerSmooth.lerp(pointerTarget, 0.09);
    uniforms.uPointer.value.copy(pointerSmooth);
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
    frameId = window.requestAnimationFrame(frame);
  }

  var lastMove = 0;
  function onPointerMove(event) {
    trackPointer(event);
    var stamp = performance.now();
    if (stamp - lastMove < 70) return;
    lastMove = stamp;
    pushRipple(event.clientX, event.clientY, 0.55);
  }
  function onPointerDown(event) {
    trackPointer(event);
    pushRipple(event.clientX, event.clientY, 1);
  }
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
      return {
        motif: motif,
        glyphs: RAMP.length,
        ripples: active.length,
        size: [width, height],
        dpr: dpr,
        frames: frames,
        fps: elapsed > 0 ? Math.round(frames / elapsed) : 0,
        software: softwareRendering,
        gpu: rendererName.slice(0, 60),
        flowAngle: Math.round((currentAngle * 180) / Math.PI),
        flowPhase: Number(uniforms.uFlowPhase.value.toFixed(2)),
        pointer: [Number(pointerSmooth.x.toFixed(2)), Number(pointerSmooth.y.toFixed(2))],
      };
    },
  };
}