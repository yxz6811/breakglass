const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const math = require('../learning-site/math-learning');
const particles = require('../extension/src/plugin/particle-renderer');
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≠ ${b}`);
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
function eventTarget() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
    count() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); } };
}
function glFixture() {
  const state = { buffers: new Set(), programs: new Set(), uploads: [], draws: [], shaders: [] };
  const gl = { state, ARRAY_BUFFER: 1, STATIC_DRAW: 2, FLOAT: 3, LINES: 4, LINE_STRIP: 5, POINTS: 6,
    COLOR_BUFFER_BIT: 7, VERTEX_SHADER: 8, FRAGMENT_SHADER: 9, COMPILE_STATUS: 10, LINK_STATUS: 11,
    BLEND: 12, SRC_ALPHA: 13, ONE_MINUS_SRC_ALPHA: 14, NO_ERROR: 0,
    createShader: () => ({}), shaderSource: (shader, text) => state.shaders.push(text), compileShader() {},
    getShaderParameter: () => true, deleteShader() {},
    createProgram() { const p = {}; state.programs.add(p); return p; }, attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    deleteProgram: (p) => state.programs.delete(p), getAttribLocation: () => 0, getUniformLocation: (p, name) => name,
    createBuffer() { const b = {}; state.buffers.add(b); return b; }, deleteBuffer: (b) => state.buffers.delete(b), bindBuffer() {},
    bufferData: (target, values) => state.uploads.push([...values]), viewport() {}, clearColor() {}, clear() {}, useProgram() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, uniform4fv() {}, uniform1f() {}, uniform2f() {}, enable() {}, blendFunc() {},
    drawArrays: (primitive, offset, count) => state.draws.push({ primitive, count }), getError: () => 0 };
  const win = { ...eventTarget(), devicePixelRatio: 4 }; const doc = { ...eventTarget(), defaultView: win, hidden: false };
  const canvas = { ...eventTarget(), ownerDocument: doc, width: 640, height: 360, getContext: () => gl,
    getBoundingClientRect: () => ({ width: 800, height: 450 }) };
  return { gl, canvas, doc, win };
}

test('new plane particle points satisfy the same line, circle and sine equations and stay at z=0', () => {
  for (const template of ['line', 'circle', 'sine']) {
    const s = math.templateInfo(template).defaults; const scene = particles.sampleScene(template, s);
    assert.deepEqual(scene.snapshot, s); assert.ok(scene.points.length <= particles.MAX_POINTS);
    for (const p of scene.points) {
      assert.equal(p.z, 0);
      if (template === 'line') near(p.y, s.m * p.x + s.b);
      if (template === 'circle') near((p.x - s.h) ** 2 + (p.y - s.k) ** 2, s.r ** 2);
      if (template === 'sine') near(p.y, s.A * Math.sin(s.omega * p.x + s.phi) + s.k);
    }
    if (template === 'circle') near(scene.derived.area, math.expectedAnswer(template, s));
    if (template === 'sine') { near(scene.derived.period, math.expectedAnswer(template, s)); near(scene.points[0].y, scene.points[256].y); }
    for (const group of ['outline', 'axes', 'vertices', 'rightAngle']) assert.ok(scene[group].every((p) => p.z === 0));
  }
});

test('similar triangle particle geometry preserves all three sides and actual squared area ratio', () => {
  for (const snapshot of [math.templateInfo('similar-triangles').defaults, { a: 2, b: 3, c: 4, scale: 0.5, unit: 'm' }]) {
    const scene = particles.sampleScene('similar-triangles', snapshot);
    const a = scene.derived.originalVertices, b = scene.derived.scaledVertices;
    for (const [from, to, length] of [[0, 1, snapshot.a], [1, 2, snapshot.b], [2, 0, snapshot.c]]) {
      near(distance(a[from], a[to]), length); near(distance(b[from], b[to]), length * snapshot.scale);
    }
    const area = (v) => Math.abs((v[1].x - v[0].x) * (v[2].y - v[0].y) - (v[2].x - v[0].x) * (v[1].y - v[0].y)) / 2;
    near(area(b) / area(a), math.expectedAnswer('similar-triangles', snapshot));
    assert.equal(scene.outlineMode, 'lines'); assert.equal(scene.outline.length, 12);
    assert.ok(scene.points.every((p) => p.z === 0)); assert.ok(scene.points.length <= particles.MAX_POINTS);
  }
});

test('cuboid uses eight real 3D mathematical corners and twelve axis edges with given lengths', () => {
  const s = { length: 4, width: 3, height: 2, unit: 'cm' }; const scene = particles.sampleScene('cuboid', s);
  assert.equal(scene.vertices.length, 8); assert.equal(new Set(scene.vertices.map((p) => `${p.x}:${p.y}:${p.z}`)).size, 8);
  assert.equal(scene.derived.edges.length, 12); assert.equal(scene.outline.length, 24); assert.equal(scene.outlineMode, 'lines');
  const lengths = scene.derived.edges.map(([a, b]) => distance(scene.vertices[a], scene.vertices[b])).sort((a, b) => a - b);
  assert.deepEqual(lengths, [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.equal(scene.derived.volume, math.expectedAnswer('cuboid', s)); assert.equal(scene.points.length, 1152);
  for (const p of scene.points) {
    assert.ok([p.x, p.y, p.z].every(Number.isFinite));
    const fixed = [Math.min(Math.abs(p.x), Math.abs(p.x - s.length)), Math.min(Math.abs(p.y), Math.abs(p.y - s.height)),
      Math.min(Math.abs(p.z), Math.abs(p.z - s.width))].filter((value) => value < 1e-9).length;
    assert.ok(fixed >= 2, 'each sample lies on an actual cuboid edge');
  }
  assert.ok(scene.points.some((p) => p.z > 0)); assert.deepEqual(scene.bounds, { minX: 0, maxX: 4, minY: 0, maxY: 2, minZ: 0, maxZ: 3 });
});

test('five templates reuse fixed GPU budgets and shaders; camera cannot mutate math and lifecycle releases resources', () => {
  for (const template of math.TEMPLATE_IDS) {
    const f = glFixture(), snapshot = math.templateInfo(template).defaults;
    const renderer = particles.createRenderer({ canvas: f.canvas, template, snapshot, reducedMotion: true });
    const view = renderer.getState().view; assert.equal(renderer.getState().mode, 'webgl'); assert.equal(renderer.getState().reducedMotion, true);
    assert.equal(f.gl.state.buffers.size, 5); assert.equal(f.gl.state.programs.size, 1);
    assert.ok(f.gl.state.uploads.flat().every(Number.isFinite)); assert.ok(renderer.getState().width <= particles.MAX_CANVAS_SIZE);
    const before = renderer.getState().snapshot; renderer.setView({ yaw: 1, pitch: -0.4 }); assert.deepEqual(renderer.getState().snapshot, before);
    renderer.resetView(); assert.deepEqual(renderer.getState().view, view);
    for (let index = 1; index <= 20; index += 1) renderer.update(math.variantSnapshot(template, snapshot, index));
    assert.equal(f.gl.state.buffers.size, 5); assert.deepEqual(renderer.getState().snapshot, math.variantSnapshot(template, snapshot, 20));
    if (template === 'cuboid') { assert.ok(f.gl.state.uploads.some((values) => values.some((v, i) => i % 3 === 2 && v !== 0)));
      assert.ok(f.gl.state.draws.some((draw) => draw.primitive === f.gl.LINES && draw.count === 24));
      assert.match(f.gl.state.shaders[0], /aPosition\.z \* sin/); }
    const draws = f.gl.state.draws.length; f.doc.hidden = true; renderer.setView({ yaw: 0.1, pitch: 0.1 }); assert.equal(f.gl.state.draws.length, draws);
    renderer.destroy(); assert.equal(f.gl.state.buffers.size + f.gl.state.programs.size, 0); assert.equal(f.canvas.count() + f.doc.count() + f.win.count(), 0);
    assert.equal(renderer.update(snapshot), false);
  }
});

test('new cuboid context loss preserves mathematics and browser IIFE samples without executable input', () => {
  const f = glFixture(), snapshot = math.templateInfo('cuboid').defaults, messages = [];
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'cuboid', snapshot, onFallback: (message) => messages.push(message) });
  f.canvas.emit('webglcontextlost', { preventDefault() {} }); assert.equal(renderer.getState().mode, 'fallback'); assert.equal(messages.length, 1);
  assert.deepEqual(renderer.getState().snapshot, snapshot); assert.equal(f.gl.state.buffers.size + f.gl.state.programs.size, 0); renderer.destroy();
  const sandbox = {}; vm.createContext(sandbox);
  for (const file of ['../extension/src/curve/evaluate', '../extension/src/geometry-scene/validate', '../extension/src/geometry-scene/solve',
    '../extension/src/plugin/math-learning', '../extension/src/plugin/contracts', '../extension/src/plugin/particle-renderer']) {
    vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), sandbox);
  }
  const result = vm.runInContext('BreakGlass.particles.sampleScene("cuboid",{length:4,width:3,height:2,unit:"cm"})', sandbox);
  assert.equal(result.derived.volume, 24); assert.ok(result.points.some((p) => p.z > 0));
  for (const [template, bad] of [['cuboid', { ...snapshot, width: 0 }], ['circle', { h: 0, k: 0, r: Infinity }],
    ['similar-triangles', { a: 1, b: 2, c: 3, scale: 2, unit: 'cm' }]]) assert.throws(() => particles.sampleScene(template, bad));
});
