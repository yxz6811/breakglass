/*
 * ASCII 涟漪背景 · three.js / WebGL 版。
 *
 * 背景主体是实时演算的函数曲线：正弦、阻尼波、抛物线、干涉波、波包、同心环。
 * 曲线用高斯发光画（不是硬边），参数随 uTime 缓慢漂移；两条曲线之间做 3 秒平滑交叉变形，
 * 每个板块从不同曲线起步，所以「每页不一样」但过渡是连续的。
 *
 * 其余：字符网格 + 流动渐变（方向随机）+ 跟随鼠标的光晕与涟漪。
 *
 * 关键约定：曲线与底纹只决定「选哪个字」，渐变与光晕只决定「颜色与明暗」。
 * 两者分离后整屏字符不会随波跳变 —— 混在一起时观感就是闪烁。
 *
 * 性能：限帧 30fps、DPR 上限 1.5、软件光栅化再降一档、不用 preserveDrawingBuffer。
 * three.js 本地内置在 ./vendor（MIT），不引 CDN。
 */
import * as THREE from './vendor/three.module.min.js';

var RAMP = ' .`-:;+=*x#%@';
// 格子越小字符越密；片元成本与格子大小无关，所以加密几乎不额外花性能。
var CELL_W = 12;
var CELL_H = 15;
var MAX_RIPPLES = 4;
var RIPPLE_SPEED = 320;
var RIPPLE_WIDTH = 92;
var FRAME_INTERVAL_MS = 1000 / 30;
var FRAME_SLACK_MS = 4;
var CURVE_COUNT = 6;
var MAX_TRAIL = 12;
var TRAIL_INTERVAL_MS = 35;
var TRAIL_LIFE = 0.7;
var LIFT_MAX = 0.17;
var LIFT_SIGMA = 0.1;
var LIFT_BUMP = 0.07;
var SPRING_K = 90;
var SPRING_C = 7;

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
  'uniform float uCurveA;',
  'uniform float uCurveB;',
  'uniform float uCurveMix;',
  'uniform float uAspect;',
  'uniform vec2 uPointerPlot;',
  'uniform float uPointerFade;',
  'uniform vec4 uTrail[' + MAX_TRAIL + '];',
  'uniform float uLift;',
  'uniform float uLiftX;',
  '',
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  '',
  // 六类曲线。全部写成 y = f(x) 的形式，距离可以用竖直距离近似，成本很低。
  'float curveY(float x, float mode, float t) {',
  '  if (mode < 0.5) {',
  '    float k = 6.0 + 1.6 * sin(t * 0.21);',
  '    float a = 0.16 + 0.05 * sin(t * 0.17);',
  '    return a * sin(k * x + t * 0.8);',
  '  } else if (mode < 1.5) {',
  '    return 0.22 * exp(-2.2 * abs(x)) * sin(9.0 * x - t * 1.1);',
  '  } else if (mode < 2.5) {',
  '    float h = 0.22 * sin(t * 0.19);',
  '    float a = 1.5 + 1.1 * sin(t * 0.13);',
  '    float k = -0.16 + 0.05 * sin(t * 0.11);',
  '    return a * (x - h) * (x - h) + k;',
  '  } else if (mode < 3.5) {',
  '    float k2 = 8.4 + 1.2 * sin(t * 0.17);',
  '    return 0.16 * sin(5.0 * x + t * 0.6) + 0.10 * sin(k2 * x - t * 0.9);',
  '  } else if (mode < 4.5) {',
  '    float c = 0.5 * sin(t * 0.23);',
  '    float s = 0.22 + 0.06 * sin(t * 0.19);',
  '    float dx = x - c;',
  '    return 0.34 * exp(-(dx * dx) / (2.0 * s * s)) * sin(26.0 * dx - t * 2.2);',
  '  }',
  '  return 0.0;',
  '}',
  '',
  // 曲线到单元中心的距离 -> 柔和发光。用高斯而不是硬边，线才细腻、过渡才丝滑。
  'float curveDist(vec2 p, float mode, float t) {',
  '  float dist = 0.0;',
  '  if (mode > 4.5) {',
  '    float r = length(p);',
  '    return sin(r * 6.0 - t * 0.8) / 6.0;',
  '  }',
  '  float y = curveY(p.x, mode, t);',
  '  float eps = 0.01;',
  '  float dy = (curveY(p.x + eps, mode, t) - curveY(p.x - eps, mode, t)) / (2.0 * eps);',
  '  return (p.y - y) * inversesqrt(1.0 + dy * dy);',
  '}',
  '',
  'void main() {',
  '  vec2 frag = vUv * uResolution;',
  '  vec2 cellId = floor(frag / uCell);',
  '  vec2 local = fract(frag / uCell);',
  // 曲线在「单元中心」求值：同一个字符格内所有片元选同一个字，不会糊。
  '  vec2 cellUv = (cellId + 0.5) * uCell / uResolution;',
  '  vec2 plotP = (cellUv - 0.5) * vec2(uAspect, 1.0);',
  '  vec2 plotWide = plotP * 1.35;',
  // 鼠标靠近曲线时，曲线在鼠标那一小段抬高；uLift 由 CPU 侧的弹簧驱动，离开后弹性回落。
  '  float liftBump = exp(-pow((plotP.x - uLiftX) / ' + LIFT_BUMP + ', 2.0));',
  '  vec2 liftedWide = plotWide - vec2(0.0, uLift * liftBump);',
  '  float distA = curveDist(liftedWide, uCurveA, uTime);',
  '  float distB = curveDist(liftedWide, uCurveB, uTime);',
  '  float sigma = 0.017 + 0.004 * sin(uTime * 0.3);',
  '  float glowA = exp(-(distA * distA) / (2.0 * sigma * sigma));',
  '  float glowB = exp(-(distB * distB) / (2.0 * sigma * sigma));',
  '  float sweep = 0.30 * (hash(cellId * 0.37) - 0.5) + 0.22 * sin(plotP.x * 1.7);',
  '  float amt = clamp((uCurveMix - sweep) / 0.62, 0.0, 1.0);',
  '  amt = amt * amt * (3.0 - 2.0 * amt);',
  '  float curve = mix(glowA, glowB, amt);',
  '  curve *= 0.88 + 0.12 * sin(uTime * 0.45 + plotP.x * 1.9);',
  // 鼠标尾迹：沿最近走过的若干个点晕开，越旧越淡，形成拖尾；不再用固定圆。
  '  float trailGlow = 0.0;',
  '  for (int i = 0; i < ' + MAX_TRAIL + '; i++) {',
  '    vec4 trailPoint = uTrail[i];',
  '    if (trailPoint.w <= 0.002) continue;',
  '    vec2 trailDelta = plotP - trailPoint.xy;',
  '    trailGlow += exp(-dot(trailDelta, trailDelta) / (2.0 * 0.024 * 0.024)) * trailPoint.w;',
  '  }',
  '  trailGlow = min(trailGlow, 1.0) * uPointerFade;',
  '  curve = clamp(curve + trailGlow * 0.85, 0.0, 1.4);',
  '  float curveSigned = distA * (1.0 - amt) + distB * amt;',
  '  curveSigned += uLift * liftBump * 1.35;',
  '  float cellShift = clamp(curveSigned * 1.6, -0.6, 0.6) * 0.42;',
  '  float value = 0.16 + hash(cellId) * 0.08;',
  '  value += (sin((cellId.x + uTime * 0.32) * 0.16) * 0.5 + cos((cellId.y - uTime * 0.26) * 0.19) * 0.5) * 0.06 + 0.06;',
  '  value = clamp(value * (1.0 - curve * 0.72) + curve * 0.90, 0.0, 1.0);',
  '  vec2 flowAxisDir = normalize(uFlowDir + vec2(0.0001));',
  '  vec2 flowOrigin = mix(vec2(0.5), uPointer, 0.45);',
  '  float axis = dot(vUv - flowOrigin, flowAxisDir);',
  '  float flowWave = 0.5 + 0.5 * sin(axis * 2.6 - uFlowPhase);',
  '  vec2 pointerDelta = vUv - uPointer;',
  '  float halo = exp(-dot(pointerDelta, pointerDelta) / (2.0 * 0.26 * 0.26));',
  '  float tone = clamp(value + flowWave * 0.24 + halo * 0.20 + curve * 0.16, 0.0, 1.0);',
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
  '  float localY = clamp(local.y + cellShift * 0.5, 0.0, 1.0);',
  '  vec2 atlasUv = vec2((glyph + local.x) / uGlyphCount, 1.0 - localY);',
  '  float mask = texture2D(uAtlas, atlasUv).a;',
  '  vec3 base = mix(vec3(0.50, 0.60, 0.72), vec3(0.99, 1.0, 1.0), tone);',
  '  vec3 flowTint = mix(vec3(0.74, 0.92, 1.0), vec3(0.88, 0.80, 1.0), 0.5 + 0.5 * sin(uFlowPhase * 0.12 + axis * 1.4));',
  '  flowTint = mix(flowTint, vec3(0.72, 0.98, 1.0), halo * 0.85);',
  '  vec3 color = base * mix(vec3(1.0), flowTint, 0.32);',
  // 函数曲线的颜色：左蓝右紫，曲线越强越白 —— 形成紫白蓝的渐变。
  '  float hueMix = clamp(0.5 + plotP.x * 0.85, 0.0, 1.0);',
  // 端点更饱和：左蓝(0.32,0.50,1.0) 右紫(0.86,0.55,1.0)，只在最尖处掺白。
  '  vec3 curveTint = mix(vec3(0.32, 0.50, 1.0), vec3(0.86, 0.55, 1.0), hueMix);',
  '  curveTint = mix(curveTint, vec3(1.0, 0.99, 1.0), smoothstep(0.9, 1.0, curve) * 0.55);',
  '  color = mix(color, curveTint * 1.28, clamp(curve * 1.15, 0.0, 1.0));',
  // 尾迹走冷白，和曲线的蓝紫区分开。
  '  color = mix(color, vec3(0.82, 0.97, 1.0) * 1.3, clamp(trailGlow * 1.1, 0.0, 1.0));',
  '  gl_FragColor = vec4(color, mask * (0.40 + tone * 0.58));',
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
  var seed = Number(settings.motif) || 0;
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
  // 尾迹点：x,y 为绘图坐标，z 为记录时刻（秒），w 为强度（越旧越淡）。
  var trailSlots = [];
  for (var t = 0; t < MAX_TRAIL; t += 1) trailSlots.push(new THREE.Vector4(0, 0, -999, 0));
  var trailPoints = [];
  var trailLastAt = -999;

  // 每个板块从不同曲线起步：封面从抛物线开始，其余按页号轮换。
  var startCurve = seed === 0 ? 2 : seed % CURVE_COUNT;
  var curveA = startCurve;
  var curveB = (startCurve + 1) % CURVE_COUNT;

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
    uCurveA: { value: curveA },
    uCurveB: { value: curveB },
    uCurveMix: { value: 0 },
    uAspect: { value: 1 },
    uPointerPlot: { value: new THREE.Vector2(0, 0) },
    uPointerFade: { value: 0 },
    uTrail: { value: trailSlots },
    uLift: { value: 0 },
    uLiftX: { value: 0 },
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
  var pointerPlotTarget = new THREE.Vector2(0, 0);
  function pointerToPlot(uv) {
    pointerPlotTarget.set((uv.x - 0.5) * uniforms.uAspect.value, uv.y - 0.5);
  }
  // 与 shader 里 curveY 保持一致的 JS 版本，用来判断鼠标离曲线多远。
  function curveYAt(x, mode, t) {
    if (mode < 0.5) {
      var k = 6 + 1.6 * Math.sin(t * 0.21);
      var a = 0.16 + 0.05 * Math.sin(t * 0.17);
      return a * Math.sin(k * x + t * 0.8);
    }
    if (mode < 1.5) return 0.22 * Math.exp(-2.2 * Math.abs(x)) * Math.sin(9 * x - t * 1.1);
    if (mode < 2.5) {
      var h = 0.22 * Math.sin(t * 0.19);
      var pa = 1.5 + 1.1 * Math.sin(t * 0.13);
      var pk = -0.16 + 0.05 * Math.sin(t * 0.11);
      return pa * (x - h) * (x - h) + pk;
    }
    if (mode < 3.5) return 0.16 * Math.sin(5 * x + t * 0.6) + 0.1 * Math.sin((8.4 + 1.2 * Math.sin(t * 0.17)) * x - t * 0.9);
    if (mode < 4.5) {
      var c = 0.5 * Math.sin(t * 0.23);
      var s = 0.22 + 0.06 * Math.sin(t * 0.19);
      var dx = x - c;
      return 0.34 * Math.exp(-(dx * dx) / (2 * s * s)) * Math.sin(26 * dx - t * 2.2);
    }
    return 0;
  }
  var lift = 0;
  var liftVelocity = 0;
  var liftX = 0;
  var pointerFade = 0;
  var pointerMovedAt = 0;
  var lastTrailAt = -999;
  function trackPointer(event) {
    pointerTarget.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight);
    pointerToPlot(pointerTarget);
    pointerMovedAt = performance.now();
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

  // 曲线调度：一条曲线停留 5-9 秒，然后用 3 秒 smoothstep 交叉变形到下一条。
  var curveStart = 0;
  var curveHold = 6;
  var curveFade = 3;
  function pickCurve(seconds) {
    curveA = curveB;
    var next = curveA;
    while (next === curveA) next = Math.floor(Math.random() * CURVE_COUNT);
    curveB = next;
    uniforms.uCurveA.value = curveA;
    uniforms.uCurveB.value = curveB;
    curveStart = seconds;
    curveHold = 5 + Math.random() * 4;
    curveFade = 3;
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
    if (curveStart === 0) curveStart = now - curveHold;
    if (now - curveStart > curveHold + curveFade) pickCurve(now);
    var fade = Math.min(1, Math.max(0, (now - curveStart - curveHold) / curveFade));
    uniforms.uCurveMix.value = fade * fade * (3 - 2 * fade);
    pointerSmooth.lerp(pointerTarget, 0.09);
    uniforms.uPointer.value.copy(pointerSmooth);
    pointerToPlot(pointerSmooth);
    uniforms.uPointerPlot.value.lerp(pointerPlotTarget, 0.2);
    // 鼠标停止约 2.5 秒后本地曲线淡出，动起来立刻回来。
    // 采样：按固定间隔记录指针位置，最多保留 MAX_TRAIL 个点。
    var plotNow = (stamp - startTime) / 1000;
    if (pointerMovedAt > 0 && stamp - lastTrailAt > TRAIL_INTERVAL_MS) {
      lastTrailAt = stamp;
      var last = trailPoints.length ? trailPoints[trailPoints.length - 1] : null;
      var currentPlot = uniforms.uPointerPlot.value;
      if (!last || (last.x - currentPlot.x) * (last.x - currentPlot.x) + (last.y - currentPlot.y) * (last.y - currentPlot.y) > 0.000004) {
        trailPoints.push({ x: currentPlot.x, y: currentPlot.y, at: plotNow });
        if (trailPoints.length > MAX_TRAIL) trailPoints.shift();
      }
    }
    for (var slot = 0; slot < MAX_TRAIL; slot += 1) {
      var pointIndex = trailPoints.length - 1 - slot;
      if (pointIndex < 0) { trailSlots[slot].set(0, 0, -999, 0); continue; }
      var point = trailPoints[pointIndex];
      var age = plotNow - point.at;
      var weight = age >= TRAIL_LIFE ? 0 : (1 - age / TRAIL_LIFE);
      trailSlots[slot].set(point.x, point.y, point.at, weight * weight);
    }
    uniforms.uTrail.value = trailSlots;
    // 抬升：鼠标离当前主曲线越近，目标抬升越高；离开后由欠阻尼弹簧弹性落回。
    var dominant = uniforms.uCurveMix.value > 0.5 ? curveB : curveA;
    var curveY = curveYAt(uniforms.uPointerPlot.value.x / 1.35, dominant, now);
    var gap = (uniforms.uPointerPlot.value.y / 1.35) - curveY;
    var proximity = Math.exp(-(gap * gap) / (2 * LIFT_SIGMA * LIFT_SIGMA));
    var liftTarget = proximity * LIFT_MAX * pointerFade;
    var dt = FRAME_INTERVAL_MS / 1000;
    liftVelocity += (-SPRING_K * (lift - liftTarget) - SPRING_C * liftVelocity) * dt;
    lift += liftVelocity * dt;
    uniforms.uLift.value = lift;
    liftX += (uniforms.uPointerPlot.value.x - liftX) * 0.15;
    uniforms.uLiftX.value = liftX;
    var moving = performance.now() - pointerMovedAt < 2500;
    pointerFade += ((moving ? 1 : 0) - pointerFade) * (moving ? 0.12 : 0.045);
    uniforms.uPointerFade.value = pointerFade;
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
    forceCurve: function (index) { curveA = index; curveB = (index + 1) % CURVE_COUNT; uniforms.uCurveA.value = curveA; uniforms.uCurveB.value = curveB; uniforms.uCurveMix.value = 0; curveStart = (performance.now() - startTime) / 1000; },
    info: function () {
      var elapsed = (performance.now() - startedAt) / 1000;
      return {
        curveA: curveA,
        curveB: curveB,
        curveMix: Number(uniforms.uCurveMix.value.toFixed(2)),
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
        pointerFade: Number(pointerFade.toFixed(2)),
        trailPoints: trailPoints.length,
        lift: Number(lift.toFixed(4)),
        liftVelocity: Number(liftVelocity.toFixed(4)),
      };
    },
  };
}