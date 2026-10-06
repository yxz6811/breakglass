const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const particles = require('../extension/src/plugin/particle-renderer');

function eventTarget() {
  const events = new Map();
  return { events,
    addEventListener(name, handler) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(handler); },
    removeEventListener(name, handler) { if (events.has(name)) events.get(name).delete(handler); },
    emit(name, value = {}) { for (const handler of events.get(name) || []) handler(value); },
    listenerCount() { return [...events.values()].reduce((sum, set) => sum + set.size, 0); }
  };
}
function fakeGL({ compile = true, link = true } = {}) {
  let nextId = 0;
  const state = { draws: [], uploads: [], shaders: [], buffers: new Set(), programs: new Set(), deletedBuffers: 0, deletedPrograms: 0 };
  const gl = { state, ARRAY_BUFFER: 1, STATIC_DRAW: 2, FLOAT: 3, LINES: 4, LINE_STRIP: 5,
    POINTS: 6, COLOR_BUFFER_BIT: 7, VERTEX_SHADER: 8, FRAGMENT_SHADER: 9,
    COMPILE_STATUS: 10, LINK_STATUS: 11, BLEND: 12, SRC_ALPHA: 13, ONE_MINUS_SRC_ALPHA: 14, NO_ERROR: 0,
    createShader() { return { id: ++nextId }; }, shaderSource(shader, source) { state.shaders.push(source); },
    compileShader() {}, getShaderParameter() { return compile; }, deleteShader() {},
    createProgram() { const program = { id: ++nextId }; state.programs.add(program); return program; },
    attachShader() {}, linkProgram() {}, getProgramParameter() { return link; },
    deleteProgram(program) { assert.equal(state.programs.delete(program), true); state.deletedPrograms += 1; },
    getAttribLocation() { return 0; }, getUniformLocation(program, name) { return name; },
    createBuffer() { const buffer = { id: ++nextId }; state.buffers.add(buffer); return buffer; },
    deleteBuffer(buffer) { assert.equal(state.buffers.delete(buffer), true); state.deletedBuffers += 1; },
    bindBuffer() {}, bufferData(target, positions) { assert.ok(positions instanceof Float32Array); assert.ok([...positions].every(Number.isFinite)); state.uploads.push([...positions]); },
    viewport() {}, clearColor() {}, clear() {}, useProgram() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, uniform4fv() {}, uniform1f() {}, uniform2f() {}, enable() {}, blendFunc() {},
    drawArrays(primitive, offset, count) { state.draws.push({ primitive, offset, count }); }, getError() { return 0; }
  };
  return gl;
}
function fixture(gl = fakeGL()) {
  const win = Object.assign(eventTarget(), { devicePixelRatio: 8 });
  const doc = Object.assign(eventTarget(), { hidden: false, defaultView: win });
  const canvas = Object.assign(eventTarget(), { ownerDocument: doc, width: 300, height: 150,
    getContext(type) { assert.equal(type, 'webgl'); return gl; },
    getBoundingClientRect() { return { width: 1200, height: 500 }; } });
  return { canvas, doc, win, gl };
}
const parabola = { a: 1, h: 2, k: -3 };
const triangle = { AB: 3, AC: 4, unit: 'cm' };

test('parabola samples preserve the defined domain, vertex and finite two-dimensional mathematics', () => {
  const scene = particles.sampleScene('parabola', parabola);
  assert.deepEqual(scene.domain, { min: -10, max: 10 });
  assert.deepEqual(scene.points[0], { x: -10, y: 141, z: 0 });
  assert.deepEqual(scene.points.at(-1), { x: 10, y: 61, z: 0 });
  assert.deepEqual(scene.vertices, [{ x: 2, y: -3, z: 0 }]);
  assert.ok(scene.points.some((point) => point.x === 2 && point.y === -3));
  assert.ok(scene.points.length <= particles.MAX_POINTS);
  for (const group of ['points', 'outline', 'axes', 'vertices', 'rightAngle']) {
    assert.ok(scene[group].every((point) => point.z === 0 && Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  const changed = particles.sampleScene('parabola', { a: -2, h: 0, k: 1 });
  assert.deepEqual(changed.points.find((point) => point.x === 0), { x: 0, y: 1, z: 0 });
  assert.deepEqual(changed.points[0], { x: -10, y: -199, z: 0 });
  assert.deepEqual(parabola, { a: 1, h: 2, k: -3 });
});

test('triangle sampling keeps the 3-4-5 relation, shared scale, vertices and right-angle marker', () => {
  const scene = particles.sampleScene('right-triangle', triangle);
  assert.equal(scene.derived.BC, 5);
  assert.deepEqual(scene.vertices, [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }]);
  assert.deepEqual(scene.derived.normalizedVertices, { A: { x: 0, y: 0 }, B: { x: 0.75, y: 0 }, C: { x: 0, y: 1 } });
  assert.equal(scene.points.length, 384);
  assert.equal(scene.outline.length, 4);
  assert.equal(scene.rightAngle.length, 3);
  assert.ok(scene.rightAngle[1].x > 0 && scene.rightAngle[1].x === scene.rightAngle[1].y);
  for (const point of scene.points) {
    assert.equal(point.z, 0);
    assert.ok(point.x >= 0 && point.y >= 0);
    assert.ok(point.x === 0 || point.y === 0 || Math.abs(point.x / 3 + point.y / 4 - 1) < 1e-12);
  }
  assert.equal(particles.sampleScene('right-triangle', { AB: 6, AC: 8, unit: 'm' }).derived.BC, 10);
});

test('unknown templates, invalid units, extra fields and non-finite/overflow mathematics fail before rendering', () => {
  for (const [template, snapshot] of [
    ['solid', triangle], ['right-triangle', { ...triangle, AB: -1 }],
    ['right-triangle', { ...triangle, unit: 'px' }], ['right-triangle', { ...triangle, AC: Infinity }],
    ['right-triangle', { AB: Number.MAX_VALUE, AC: Number.MAX_VALUE, unit: 'cm' }],
    ['parabola', { ...parabola, a: 0 }], ['parabola', { ...parabola, k: NaN }],
    ['parabola', { ...parabola, h: Number.MAX_VALUE }], ['parabola', { ...parabola, code: 'run()' }]
  ]) assert.throws(() => particles.sampleScene(template, snapshot), TypeError);
  const hostile = { a: 1, h: 0 };
  Object.defineProperty(hostile, 'k', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => particles.sampleScene('parabola', hostile), TypeError);
});

test('WebGL uses bounded canvas/DPR and fixed local shaders while update and camera preserve math state', () => {
  const f = fixture();
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'right-triangle', snapshot: triangle, reducedMotion: true });
  assert.equal(renderer.getState().mode, 'webgl');
  assert.equal(renderer.getState().width, 1600);
  assert.equal(renderer.getState().height, 667);
  assert.equal(renderer.getState().dpr, 4 / 3);
  assert.ok(Math.abs(renderer.getState().width / renderer.getState().height - 1200 / 500) < 0.002);
  assert.equal(renderer.getState().reducedMotion, true);
  assert.ok(f.gl.state.draws.some((draw) => draw.primitive === f.gl.POINTS && draw.count === 384));
  assert.equal(f.gl.state.shaders.length, 2);
  assert.ok(f.gl.state.shaders.every((source) => !source.includes('run()')));
  const initialBuffers = f.gl.state.buffers.size;
  renderer.setView({ yaw: 0.7, pitch: -0.4 });
  assert.deepEqual(renderer.getState().snapshot, triangle);
  assert.deepEqual(renderer.getState().view, { yaw: 0.7, pitch: -0.4 });
  renderer.update({ AB: 6, AC: 8, unit: 'cm' });
  assert.equal(f.gl.state.buffers.size, initialBuffers);
  assert.deepEqual(renderer.getState().snapshot, { AB: 6, AC: 8, unit: 'cm' });
  renderer.resetView();
  assert.deepEqual(renderer.getState().view, { yaw: 0, pitch: 0 });
  assert.throws(() => renderer.update({ AB: NaN, AC: 8, unit: 'cm' }), TypeError);
  assert.deepEqual(renderer.getState().snapshot, { AB: 6, AC: 8, unit: 'cm' });
  assert.throws(() => renderer.setView({ yaw: Infinity, pitch: 0 }), TypeError);
  const copy = renderer.getState(); copy.snapshot.AB = 99; copy.view.yaw = 99;
  assert.equal(renderer.getState().snapshot.AB, 6);
  assert.equal(renderer.getState().view.yaw, 0);
  renderer.destroy();
});

test('legal extreme lengths normalize before Float32 upload without changing mathematical values', () => {
  const f = fixture();
  const lengths = { AB: 1e300, AC: 1e300, unit: 'm' };
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'right-triangle', snapshot: lengths });
  assert.equal(renderer.getState().mode, 'webgl');
  assert.deepEqual(renderer.getState().snapshot, lengths);
  assert.ok(f.gl.state.uploads.flat().every(Number.isFinite));
  assert.ok(Math.max(...f.gl.state.uploads.flat().map(Math.abs)) <= 1);
  renderer.destroy();
});

test('WebGL absence, compile failure and context loss report one fallback and never replace the mathematical template', () => {
  for (const gl of [null, fakeGL({ compile: false }), fakeGL({ link: false })]) {
    const f = fixture(gl), failures = [];
    const renderer = particles.createRenderer({ canvas: f.canvas, template: 'parabola', snapshot: parabola, onFallback: (value) => failures.push(value) });
    assert.equal(renderer.getState().mode, 'fallback');
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /SVG/);
    renderer.update({ a: 2, h: 0, k: 1 });
    assert.deepEqual(renderer.getState().snapshot, { a: 2, h: 0, k: 1 });
    assert.equal(failures.length, 1);
    if (gl) assert.equal(gl.state.programs.size, 0);
    renderer.destroy();
  }
  const f = fixture(), failures = [];
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'right-triangle', snapshot: triangle, onFallback: (value) => failures.push(value) });
  let prevented = false;
  f.canvas.emit('webglcontextlost', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(renderer.getState().fallbackCode, 'context_lost');
  assert.equal(f.gl.state.buffers.size, 0);
  const draws = f.gl.state.draws.length;
  renderer.setView({ yaw: 0.3, pitch: 0.2 });
  f.canvas.emit('webglcontextlost', { preventDefault() {} });
  assert.equal(f.gl.state.draws.length, draws);
  assert.equal(failures.length, 1);
  renderer.destroy();
});

test('hidden pages defer drawing, visibility resumes once, and destroy releases resources/listeners and blocks new draws', () => {
  const f = fixture();
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'parabola', snapshot: parabola });
  const count = f.gl.state.draws.length;
  f.doc.hidden = true;
  renderer.update({ a: 2, h: 0, k: 0 });
  renderer.setView({ yaw: 0.1, pitch: 0.1 });
  f.win.emit('resize');
  assert.equal(f.gl.state.draws.length, count);
  f.doc.hidden = false; f.doc.emit('visibilitychange');
  assert.ok(f.gl.state.draws.length > count);
  const resumed = f.gl.state.draws.length;
  f.doc.emit('visibilitychange');
  assert.equal(f.gl.state.draws.length, resumed);
  renderer.destroy(); renderer.destroy();
  assert.equal(renderer.getState().destroyed, true);
  assert.equal(f.gl.state.buffers.size, 0);
  assert.equal(f.gl.state.programs.size, 0);
  assert.equal(f.canvas.listenerCount() + f.doc.listenerCount() + f.win.listenerCount(), 0);
  assert.equal(renderer.update({ a: 3, h: 0, k: 0 }), false);
  assert.equal(renderer.setView({ yaw: 0, pitch: 0 }), false);
  assert.equal(renderer.resetView(), false);
  f.win.emit('resize'); f.doc.emit('visibilitychange');
  assert.equal(f.gl.state.draws.length, resumed);
});

test('rendering and resize-observer exceptions release GPU resources and cannot escape into video controls', () => {
  const f = fixture(), failures = [];
  const renderer = particles.createRenderer({ canvas: f.canvas, template: 'right-triangle', snapshot: triangle, onFallback: (value) => failures.push(value) });
  f.gl.uniform2f = () => { throw new Error('driver unavailable'); };
  assert.equal(renderer.setView({ yaw: 0.2, pitch: 0.1 }), false);
  assert.equal(renderer.getState().fallbackCode, 'render_failed');
  assert.equal(failures.length, 1);
  assert.equal(f.gl.state.buffers.size + f.gl.state.programs.size, 0);
  renderer.destroy();
  const broken = fixture();
  broken.win.ResizeObserver = class { constructor() { throw new Error('observer unavailable'); } };
  const fallback = particles.createRenderer({ canvas: broken.canvas, template: 'right-triangle', snapshot: triangle,
    onFallback() { throw new Error('consumer callback'); } });
  assert.equal(fallback.getState().fallbackCode, 'lifecycle_failed');
  assert.equal(broken.gl.state.buffers.size + broken.gl.state.programs.size, 0);
  fallback.destroy();
});

test('browser IIFE works with the existing validators/solvers and no require or animation runtime', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const name of ['curve/evaluate.js', 'geometry-scene/validate.js', 'geometry-scene/solve.js', 'plugin/contracts.js', 'plugin/particle-renderer.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../extension/src', name), 'utf8');
    vm.runInContext(source, sandbox, { filename: name });
  }
  const result = vm.runInContext('BreakGlass.particles.sampleScene("right-triangle", {AB:3, AC:4, unit:"cm"})', sandbox);
  assert.equal(result.derived.BC, 5);
  assert.ok(result.points.every((point) => point.z === 0));
  assert.equal(typeof sandbox.BreakGlass.particles.createRenderer, 'function');
});

// Integration: SVG remains the authoritative main view. createRenderer samples only
// its confirmed snapshot; update(snapshot) follows that state, setView({yaw,pitch})
// uses absolute radians, resetView() restores front view, onFallback({code,message})
// requests retained SVG, and destroy() is required when the learning panel closes.
