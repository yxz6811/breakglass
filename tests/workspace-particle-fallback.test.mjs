import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const browserModules = ['extension/src/curve/evaluate.js', 'extension/src/geometry-scene/validate.js',
  'extension/src/geometry-scene/solve.js', 'extension/src/plugin/math-learning.js',
  'extension/src/plugin/contracts.js', 'extension/src/plugin/particle-renderer.js', 'learning-site/live-particles.js'];
const sources = browserModules.map(path => [path, fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]);
const parabola = { template: 'parabola', snapshot: { a: 2, h: -3, k: 1 }, confirmed: true, origin: 'manual' };

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, values = {}) {
      const event = { preventDefault() {}, ...values };
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    },
    listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); }
  };
}

function element(tag, namespaceURI = 'http://www.w3.org/1999/xhtml') {
  let text = '';
  const node = { ...eventTarget(), tagName: tag.toUpperCase(), namespaceURI, children: [], dataset: {}, attributes: {},
    value: '', disabled: false, parentElement: null, classList: { add() {} },
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } },
    replaceChildren(...children) {
      text = ''; this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children);
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    removeAttribute(name) { delete this.attributes[name]; },
    setPointerCapture() {}
  };
  // Only HTMLElement reflects .hidden to the attribute used by [hidden] CSS.
  // On SVGElement assigning .hidden merely creates an unrelated expando.
  if (namespaceURI === 'http://www.w3.org/1999/xhtml') Object.defineProperty(node, 'hidden', {
    get() { return this.hasAttribute('hidden'); },
    set(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  });
  Object.defineProperty(node, 'textContent', { get: () => text + node.children.map(child => child.textContent).join(''),
    set: value => { node.replaceChildren(); text = String(value); } });
  return node;
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function pathCommands(path) {
  const d = path.getAttribute('d');
  assert.equal(typeof d, 'string'); assert.ok(d.length > 0);
  const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const expression = new RegExp(`([ML])(${number}),(${number})`, 'g');
  const commands = [...d.matchAll(expression)].map(match => ({ command: match[1], x: Number(match[2]), y: Number(match[3]) }));
  assert.equal(d.replace(expression, '').trim(), '', 'The solid path contains only explicit finite move/line coordinates');
  assert.ok(commands.length > 0 && commands.every(command => Number.isFinite(command.x) && Number.isFinite(command.y)));
  return commands;
}

function separateSegments(path, count) {
  const commands = pathCommands(path);
  assert.equal(commands.length, count * 2);
  const segments = [];
  for (let index = 0; index < commands.length; index += 2) {
    assert.equal(commands[index].command, 'M', 'Each edge starts a new subpath, with no connection from the previous edge');
    assert.equal(commands[index + 1].command, 'L');
    segments.push([commands[index], commands[index + 1]].map(({ x, y }) => ({ x, y })));
  }
  return segments;
}

// WebGL calls are observed at the drawing boundary. The actual browser UMD
// modules create buffers, sample mathematics and decide when rendering occurs.
function webGL() {
  const state = { renderPasses: 0, draws: [], views: [], uploads: [], buffers: new Set(), programs: new Set(), bufferContents: new Map() };
  let boundBuffer;
  return { state, ARRAY_BUFFER: 1, STATIC_DRAW: 2, FLOAT: 3, LINES: 4, LINE_STRIP: 5, POINTS: 6,
    COLOR_BUFFER_BIT: 7, VERTEX_SHADER: 8, FRAGMENT_SHADER: 9, COMPILE_STATUS: 10, LINK_STATUS: 11,
    BLEND: 12, SRC_ALPHA: 13, ONE_MINUS_SRC_ALPHA: 14, NO_ERROR: 0,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, deleteShader() {},
    createProgram() { const program = {}; state.programs.add(program); return program; },
    attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    deleteProgram(program) { state.programs.delete(program); }, getAttribLocation: () => 0,
    getUniformLocation: (_program, name) => name,
    createBuffer() { const buffer = {}; state.buffers.add(buffer); return buffer; },
    deleteBuffer(buffer) { state.buffers.delete(buffer); state.bufferContents.delete(buffer); },
    bindBuffer(_target, buffer) { boundBuffer = buffer; },
    bufferData(_target, values) { const contents = Array.from(values); state.uploads.push(contents); state.bufferContents.set(boundBuffer, contents); },
    viewport() {}, clearColor() {}, clear() { state.renderPasses += 1; }, useProgram() {}, enableVertexAttribArray() {},
    vertexAttribPointer() {}, uniform4fv() {}, uniform1f() {},
    uniform2f(name, x, y) { if (name === 'uView') state.views.push({ yaw: x, pitch: y }); },
    enable() {}, blendFunc() {}, drawArrays(primitive, offset, count) {
      const positions = state.bufferContents.get(boundBuffer);
      assert.ok(positions, 'Each draw must use an uploaded coordinate buffer');
      state.draws.push({ primitive, offset, count, positions: positions.slice(offset * 3, (offset + count) * 3) });
    },
    getError: () => 0
  };
}

function fixture({ reducedMotion = false, gl = webGL() } = {}) {
  const scheduled = []; const mediaQueries = []; const created = [];
  const requestAnimationFrame = fn => { scheduled.push({ type: 'frame', fn }); return scheduled.length; };
  const setTimeout = (fn, delay) => { scheduled.push({ type: 'timeout', fn, delay }); return scheduled.length; };
  const setInterval = (fn, delay) => { scheduled.push({ type: 'interval', fn, delay }); return scheduled.length; };
  const matchMedia = query => { mediaQueries.push(query); return { matches: reducedMotion }; };
  const win = { ...eventTarget(), devicePixelRatio: 1, requestAnimationFrame, cancelAnimationFrame() {},
    setTimeout, clearTimeout() {}, setInterval, clearInterval() {}, matchMedia };
  const document = { ...eventTarget(), defaultView: win, hidden: false,
    createElement(tag) {
      const node = element(tag); node.ownerDocument = document; created.push(node);
      if (tag === 'canvas') {
        node.width = 640; node.height = 360;
        node.getContext = type => { assert.equal(type, 'webgl'); return gl; };
        node.getBoundingClientRect = () => ({ width: 640, height: 360 });
      }
      return node;
    },
    createElementNS(namespace, tag) {
      const node = element(tag, namespace); node.ownerDocument = document; created.push(node); return node;
    }
  };
  const container = element('div');
  const context = vm.createContext({ document, container, matchMedia, requestAnimationFrame, cancelAnimationFrame() {},
    setTimeout, clearTimeout() {}, setInterval, clearInterval() {} });
  for (const [filename, source] of sources) vm.runInContext(source, context, { filename });
  vm.runInContext('globalThis.panel = BreakGlass.liveParticles.mount(container, {document})', context);
  const canvas = descendants(container).find(node => node.tagName === 'CANVAS');
  const svg = descendants(container).find(node => node.tagName === 'SVG');
  const equation = () => container.children.find(node => node.tagName === 'P').textContent;
  const control = name => {
    const node = descendants(container).find(node => node.dataset.particleControl === name);
    assert.ok(node, `Missing particle control: ${name}`); return node;
  };
  const paths2D = () => svg.children.filter(node => node.tagName === 'PATH');
  const lineCoordinates = () => paths2D().flatMap(path => pathCommands(path).map(({ x, y }) => [x, y]));
  return { canvas, svg, equation, control, paths2D, lineCoordinates, gl, win, document, container, created, scheduled, mediaQueries,
    update(scene) { context.sceneJSON = JSON.stringify(scene); vm.runInContext('panel.update(JSON.parse(sceneJSON))', context); },
    state() { return JSON.parse(vm.runInContext('JSON.stringify(panel.getState())', context)); },
    destroy() { vm.runInContext('panel.destroy()', context); }
  };
}

function assertVisibleOutput(f, expected) {
  assert.equal(f.canvas.parentElement.hasAttribute('hidden'), false, 'The confirmed scene stage is visible');
  assert.equal(f.canvas.hasAttribute('hidden'), expected !== 'canvas', 'Canvas visibility follows its reflected hidden attribute');
  assert.equal(f.svg.hasAttribute('hidden'), expected !== 'svg', 'SVG visibility follows [hidden], not a .hidden expando');
}

test('live particle WebGL absence retains confirmed parameters, formula and an updating finite 2D view', () => {
  const f = fixture({ gl: null }); const input = structuredClone(parabola);
  try {
    f.update(input);
    assert.equal(f.state().view.mode, 'fallback');
    assert.equal(f.state().view.fallbackCode, 'webgl_unavailable');
    assert.deepEqual(f.state().snapshot, input.snapshot);
    assert.deepEqual(f.state().view.snapshot, input.snapshot);
    assert.equal(f.equation(), 'y=2(x−(-3))²+(1)');
    assertVisibleOutput(f, 'svg');
    assert.equal(f.canvas.parentElement.hidden, false);
    const before = f.lineCoordinates(); assert.ok(before.length > 0);
    assert.ok(before.flat().every(Number.isFinite));
    for (const name of ['yaw', 'pitch', 'space', 'reset']) assert.equal(f.control(name).disabled, true);
    const changed = { ...input, snapshot: { a: -2, h: 0, k: 1 }, origin: 'exploration' };
    f.update(changed);
    assert.deepEqual(f.state().snapshot, changed.snapshot);
    assert.deepEqual(f.state().view.snapshot, changed.snapshot);
    assert.equal(f.equation(), 'y=-2(x−(0))²+(1)');
    assert.notDeepEqual(f.lineCoordinates(), before, 'The fallback responds to changed mathematical parameters');
    assert.deepEqual(input, parabola, 'Drawing never mutates the confirmed input');
    assert.equal(f.scheduled.length, 0);
  } finally { f.destroy(); }
});

test('camera sliders, drag, keyboard and 2D reset change only view and preserve the same mathematics', () => {
  const f = fixture();
  try {
    f.update(parabola); const before = f.state(); const equation = f.equation(); const points = f.lineCoordinates();
    assert.equal(before.view.mode, 'webgl');
    f.control('yaw').value = '40'; f.control('pitch').value = '-20'; f.control('yaw').emit('input');
    assert.ok(Math.abs(f.state().view.view.yaw - 40 * Math.PI / 180) < 1e-12);
    f.canvas.emit('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
    f.canvas.emit('pointermove', { clientX: 120, clientY: 110 }); f.canvas.emit('pointerup');
    f.canvas.emit('keydown', { key: 'ArrowRight' });
    assert.notDeepEqual(f.state().view.view, before.view.view);
    f.control('2d').emit('click');
    assert.equal(f.state().planar, true); assertVisibleOutput(f, 'svg');
    assert.deepEqual(f.state().view.view, { yaw: 0, pitch: 0 });
    f.control('space').emit('click'); assert.equal(f.state().planar, false);
    f.control('reset').emit('click'); assert.deepEqual(f.state().view.view, before.view.view);
    assert.deepEqual(f.state().snapshot, before.snapshot);
    assert.deepEqual(f.state().view.snapshot, before.view.snapshot);
    assert.deepEqual(f.lineCoordinates(), points); assert.equal(f.equation(), equation);
    assert.ok(f.gl.state.views.length > 1, 'Camera changes reach the actual GPU uniform boundary');
  } finally { f.destroy(); }
  assert.equal(f.gl.state.buffers.size + f.gl.state.programs.size, 0);
  assert.ok(f.created.every(node => node.listenerCount() === 0));
  assert.equal(f.document.listenerCount() + f.win.listenerCount(), 0);
});

test('reduced-motion preference produces one initial render with no background animation loop', () => {
  const f = fixture({ reducedMotion: true });
  try {
    f.update(parabola);
    assert.deepEqual(f.mediaQueries, ['(prefers-reduced-motion: reduce)']);
    assert.equal(f.state().view.reducedMotion, true);
    assert.equal(f.gl.state.renderPasses, 1, 'A single rendering pass may contain several draw groups');
    assert.equal(f.scheduled.length, 0, 'Reduced motion never starts requestAnimationFrame, timeout or interval work');
    f.control('yaw').value = '10'; f.control('yaw').emit('input');
    assert.equal(f.gl.state.renderPasses, 2, 'Explicit camera input redraws once');
    const changed = { ...parabola, snapshot: { a: 1, h: 2, k: -3 } };
    f.update(changed);
    assert.equal(f.gl.state.renderPasses, 3, 'Explicit math changes redraw once');
    assert.deepEqual(f.state().snapshot, changed.snapshot);
    assert.equal(f.equation(), 'y=1(x−(2))²+(-3)');
    assert.equal(f.scheduled.length, 0);
  } finally { f.destroy(); }
});

test('reduced motion and unavailable WebGL can coexist while the same 2D triangle stays usable', () => {
  const f = fixture({ reducedMotion: true, gl: null });
  const triangle = { confirmed: true, template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' } };
  try {
    f.update(triangle);
    assert.equal(f.state().view.reducedMotion, true); assert.equal(f.state().view.mode, 'fallback');
    assert.deepEqual(f.state().snapshot, triangle.snapshot);
    assert.equal(f.equation(), 'A为直角，AB=3，AC=4 cm');
    assertVisibleOutput(f, 'svg'); assert.ok(f.lineCoordinates().length > 0);
    f.control('2d').emit('click');
    assertVisibleOutput(f, 'svg'); assert.deepEqual(f.state().snapshot, triangle.snapshot);
    assert.equal(f.scheduled.length, 0);
  } finally { f.destroy(); }
});

test('live WebGL context loss immediately reveals the preserved 2D mathematical view', () => {
  const f = fixture();
  try {
    f.update(parabola); const points = f.lineCoordinates(); const equation = f.equation();
    let prevented = false;
    f.canvas.emit('webglcontextlost', { preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.state().view.mode, 'fallback');
    assert.deepEqual(f.state().snapshot, parabola.snapshot);
    assert.equal(f.equation(), equation); assert.deepEqual(f.lineCoordinates(), points);
    assertVisibleOutput(f, 'svg');
    for (const name of ['yaw', 'pitch', 'space', 'reset']) assert.equal(f.control(name).disabled, true);
  } finally { f.destroy(); }
});

test('WebGL, explicit 2D and context loss expose exactly one output using DOM hidden attributes', () => {
  const f = fixture();
  try {
    // Keep SVG semantics faithful even when an implementation assigns .hidden.
    f.svg.hidden = true;
    assert.equal(f.svg.hasAttribute('hidden'), false, 'An SVG .hidden expando cannot activate [hidden] CSS');
    f.update(parabola);
    assertVisibleOutput(f, 'canvas');
    f.control('2d').emit('click');
    assertVisibleOutput(f, 'svg');
    f.control('space').emit('click');
    assertVisibleOutput(f, 'canvas');
    f.canvas.emit('webglcontextlost');
    assertVisibleOutput(f, 'svg');
    assert.equal(f.state().view.mode, 'fallback');
    assert.deepEqual(f.state().snapshot, parabola.snapshot);
  } finally { f.destroy(); }
});

test('parabola fallback is one continuous solid path with no circle sample cloud', () => {
  const f = fixture({ gl: null, reducedMotion: true });
  try {
    f.update(parabola);
    assert.equal(f.paths2D().length, 1);
    assert.equal(descendants(f.svg).filter(node => node.tagName === 'CIRCLE').length, 0);
    const path = f.paths2D()[0]; const commands = pathCommands(path);
    assert.equal(path.getAttribute('fill'), 'none');
    assert.ok(path.getAttribute('stroke'));
    assert.ok(Number(path.getAttribute('stroke-width')) > 0);
    assert.equal(commands[0].command, 'M');
    assert.ok(commands.slice(1).every(command => command.command === 'L'), 'The curve has no breaks between mathematical samples');
    assert.equal(commands.length, f.state().view.pointCount, 'Every sampled curve coordinate belongs to the solid path');
    assert.ok(commands.length >= 513);
    assert.ok(commands.slice(1).every((command, index) => command.x >= commands[index].x));
    assert.deepEqual(f.state().snapshot, parabola.snapshot);
    assert.equal(f.scheduled.length, 0);
  } finally { f.destroy(); }
});

test('cuboid and similar triangles use separate edge subpaths without cross-edge connections', () => {
  for (const scene of [{ template: 'cuboid', snapshot: { length: 4, width: 3, height: 2, unit: 'cm' }, edges: 12 },
    { template: 'similar-triangles', snapshot: { a: 3, b: 4, c: 5, scale: 2, unit: 'cm' }, edges: 6 }]) {
    const f = fixture({ gl: null, reducedMotion: true });
    try {
      f.update({ ...scene, confirmed: true });
      assert.equal(f.paths2D().length, 1);
      const segments = separateSegments(f.paths2D()[0], scene.edges);
      assert.equal(descendants(f.svg).filter(node => node.tagName === 'CIRCLE').length, 0);
      if (scene.template === 'similar-triangles') {
        for (const start of [0, 3]) for (let edge = 0; edge < 3; edge++) {
          assert.deepEqual(segments[start + edge][1], segments[start + (edge + 1) % 3][0], 'Each triangle closes only through its own three sides');
        }
        assert.notDeepEqual(segments[0][0], segments[3][0], 'The two triangles occupy distinct subpaths');
        const lengths = segments.map(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y));
        for (let edge = 0; edge < 3; edge++) assert.ok(Math.abs(lengths[edge + 3] / lengths[edge] - 2) < 1e-9);
      }
      const before = f.lineCoordinates();
      const changed = scene.template === 'cuboid' ? { ...scene.snapshot, length: 6 } : { ...scene.snapshot, scale: 0.5 };
      f.update({ template: scene.template, snapshot: changed, confirmed: true, origin: 'exploration' });
      separateSegments(f.paths2D()[0], scene.edges);
      assert.notDeepEqual(f.lineCoordinates(), before, 'Changed dimensions or side ratio reach the actual line coordinates');
      assert.deepEqual(f.state().snapshot, changed); assert.deepEqual(f.state().view.snapshot, changed);
      assert.equal(f.scheduled.length, 0);
    } finally { f.destroy(); }
  }
});

test('WebGL mathematical outlines use line primitives while POINTS are limited to explicit anchors', () => {
  const scenes = [{ ...parabola, anchors: 1, outline: 'strip' },
    { template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, anchors: 3, outline: 'strip', coordinates: 4 },
    { template: 'line', snapshot: { m: -2, b: 3 }, anchors: 1, outline: 'strip', coordinates: 513 },
    { template: 'circle', snapshot: { h: 1, k: 2, r: 3 }, anchors: 1, outline: 'strip', coordinates: 513 },
    { template: 'sine', snapshot: { A: 2, omega: 1, phi: 0, k: -1 }, anchors: 1, outline: 'strip', coordinates: 513 },
    { template: 'similar-triangles', snapshot: { a: 3, b: 4, c: 5, scale: 2, unit: 'cm' }, anchors: 6, outline: 'lines', coordinates: 12 },
    { template: 'cuboid', snapshot: { length: 4, width: 3, height: 2, unit: 'cm' }, anchors: 8, outline: 'lines', coordinates: 24 }];
  for (const scene of scenes) {
    const f = fixture({ reducedMotion: true });
    try {
      f.update({ ...scene, confirmed: true });
      assert.equal(f.state().view.mode, 'webgl');
      const count = scene.coordinates || f.state().view.pointCount;
      const primitive = scene.outline === 'lines' ? f.gl.LINES : f.gl.LINE_STRIP;
      const outline = f.gl.state.draws.find(draw => draw.primitive === primitive && draw.count === count);
      assert.ok(outline, `${scene.template} must render its mathematical outline with a line primitive`);
      assert.equal(outline.positions.length, count * 3); assert.ok(outline.positions.every(Number.isFinite));
      const anchors = f.gl.state.draws.filter(draw => draw.primitive === f.gl.POINTS);
      assert.equal(anchors.length, 1, 'POINTS may mark vertices or a center, never the sampled mathematical body');
      assert.equal(anchors[0].count, scene.anchors, `${scene.template} draws only its explicitly defined anchors`);
      assert.ok(anchors[0].count <= 8);
      assert.equal(f.gl.state.draws.some(draw => draw.primitive === f.gl.POINTS && draw.count === f.state().view.pointCount), false);
      assert.deepEqual(f.state().snapshot, scene.snapshot);
      assert.equal(f.gl.state.renderPasses, 1); assert.equal(f.scheduled.length, 0);
    } finally { f.destroy(); }
  }
});

test('parameter changes update both solid SVG and GPU line coordinates without starting a reduced-motion loop', () => {
  const f = fixture({ reducedMotion: true });
  try {
    f.update(parabola);
    const svgBefore = f.lineCoordinates();
    const gpuBefore = f.gl.state.draws.findLast(draw => draw.primitive === f.gl.LINE_STRIP && draw.count >= 513).positions;
    const changed = { ...parabola, snapshot: { a: -2, h: 0, k: 1 }, origin: 'exploration' };
    f.update(changed);
    const gpuAfter = f.gl.state.draws.findLast(draw => draw.primitive === f.gl.LINE_STRIP && draw.count >= 513).positions;
    assert.notDeepEqual(f.lineCoordinates(), svgBefore);
    assert.notDeepEqual(gpuAfter, gpuBefore);
    assert.deepEqual(f.state().snapshot, changed.snapshot); assert.deepEqual(f.state().view.snapshot, changed.snapshot);
    assert.equal(f.equation(), 'y=-2(x−(0))²+(1)');
    assert.equal(f.gl.state.renderPasses, 2, 'Explicit parameter changes redraw exactly once');
    assert.equal(f.scheduled.length, 0);
  } finally { f.destroy(); }
});
