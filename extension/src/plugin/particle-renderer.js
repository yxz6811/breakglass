(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.particles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const MAX_POINTS = 2048;
  const MAX_CANVAS_SIZE = 1600;
  const MAX_DPR = 2;
  const DOMAIN = { min: -10, max: 10 };
  // Only these local shaders execute. Mathematical/model text never becomes GLSL.
  const VERTEX_SHADER = `attribute vec3 aPosition;
    uniform vec2 uScale;
    uniform vec2 uView;
    uniform float uSize;
    void main() {
      float x = aPosition.x * cos(uView.x) - aPosition.z * sin(uView.x);
      float z = aPosition.x * sin(uView.x) + aPosition.z * cos(uView.x);
      float y = aPosition.y * cos(uView.y) - z * sin(uView.y);
      gl_Position = vec4(x * uScale.x, y * uScale.y, 0.0, 1.0);
      gl_PointSize = uSize;
    }`;
  const FRAGMENT_SHADER = `precision mediump float;
    uniform vec4 uColor;
    uniform float uParticle;
    void main() {
      if (uParticle > 0.5 && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
      gl_FragColor = uColor;
    }`;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const point = (x, y, z = 0) => ({ x, y, z });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function dependencies() {
    if (typeof require === 'function') return { contracts: require('./contracts'),
      curve: require('../curve/evaluate'), geometry: require('../geometry-scene/solve'), math: require('./math-learning') };
    const bg = root.BreakGlass || {};
    return { contracts: bg.pluginContracts, curve: bg.evaluate, geometry: bg.geometryScene, math: bg.mathLearning };
  }
  function triangleScene(snapshot) {
    return { schemaVersion: '1.0.0', kind: 'right-triangle', requestId: 'particle-scene',
      videoId: 'particle-view', frameTime: 0, frameSize: { width: 1, height: 1 },
      sceneRevision: 0, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' },
      vertices: null, lengths: { AB: snapshot.AB, AC: snapshot.AC }, unit: snapshot.unit,
      source: 'preset', originSource: 'preset', editedByUser: false };
  }

  /** Deterministic math; only the defined cuboid has nonzero z, never video reconstruction. */
  function sampleScene(template, snapshot) {
    const deps = dependencies();
    if (!deps.contracts || typeof deps.contracts.validateSnapshot !== 'function') {
      throw new TypeError('数学校验器未加载。');
    }
    const checked = deps.contracts.validateSnapshot(template, snapshot);
    if (!checked.ok) throw new TypeError(checked.message);
    const value = checked.value;
    let points = [], outline, vertices, rightAngle = [], derived = {}, outlineMode = 'strip';
    let domain = template === 'parabola' ? { ...DOMAIN } : null;
    function sampleEdge(from, to, count = 128) {
      for (let index = 0; index < count; index += 1) {
        const t = index / count;
        points.push(point(from.x * (1 - t) + to.x * t, from.y * (1 - t) + to.y * t,
          from.z * (1 - t) + to.z * t));
      }
    }
    if (template === 'parabola') {
      if (!deps.curve || typeof deps.curve.evaluateWithParameters !== 'function') throw new TypeError('曲线求值器未加载。');
      const definition = { equationId: 'fixture.parabola' };
      for (let index = 0; index <= 512; index += 1) {
        const x = DOMAIN.min + (DOMAIN.max - DOMAIN.min) * index / 512;
        points.push(point(x, deps.curve.evaluateWithParameters(definition, value, x)));
      }
      vertices = value.h >= DOMAIN.min && value.h <= DOMAIN.max ? [point(value.h, value.k)] : [];
      if (vertices.length && !points.some((item) => item.x === value.h)) {
        points.push(point(value.h, value.k));
        points.sort((left, right) => left.x - right.x);
      }
      outline = points.map((item) => ({ ...item }));
    } else if (deps.math && deps.math.isExtended(template)) {
      if (['line', 'circle', 'sine'].includes(template)) {
        if (template === 'line') { domain = { ...DOMAIN }; derived = { intercept: value.b, slope: value.m }; }
        if (template === 'sine') { const period = 2 * Math.PI / value.omega; domain = { min: -period, max: period }; derived = { period, amplitude: value.A, midline: value.k }; }
        if (template === 'circle') derived = { area: Math.PI * value.r ** 2, center: { x: value.h, y: value.k }, radius: value.r };
        for (let index = 0; index <= 512; index += 1) {
          if (template === 'circle') { const angle = index / 512 * Math.PI * 2;
            points.push(point(value.h + value.r * Math.cos(angle), value.k + value.r * Math.sin(angle))); }
          else { const x = domain.min + (domain.max - domain.min) * index / 512;
            points.push(point(x, template === 'line' ? value.m * x + value.b : value.A * Math.sin(value.omega * x + value.phi) + value.k)); }
        }
        outline = points.map((item) => ({ ...item }));
        vertices = template === 'circle' ? [point(value.h, value.k)] : template === 'line' ? [point(0, value.b)] : [point(0, value.A * Math.sin(value.phi) + value.k)];
      } else if (template === 'similar-triangles') {
        const x = (value.a ** 2 + value.c ** 2 - value.b ** 2) / (2 * value.a);
        const y = Math.sqrt(Math.max(0, value.c ** 2 - x ** 2));
        const original = [point(0, 0), point(value.a, 0), point(x, y)];
        const shift = Math.max(value.a, x) + Math.max(value.a, value.c) * 0.25 - Math.min(0, x * value.scale);
        const scaled = original.map((p) => point(p.x * value.scale + shift, p.y * value.scale));
        vertices = [...original, ...scaled]; outline = []; outlineMode = 'lines';
        for (const triangle of [original, scaled]) for (let edge = 0; edge < 3; edge += 1) {
          const from = triangle[edge], to = triangle[(edge + 1) % 3]; outline.push({ ...from }, { ...to }); sampleEdge(from, to);
        }
        derived = { sideRatio: value.scale, areaRatio: value.scale ** 2,
          originalVertices: original.map((p) => ({ ...p })), scaledVertices: scaled.map((p) => ({ ...p })) };
      } else {
        const l = value.length, w = value.width, h = value.height;
        vertices = [point(0, 0, 0), point(l, 0, 0), point(l, 0, w), point(0, 0, w),
          point(0, h, 0), point(l, h, 0), point(l, h, w), point(0, h, w)];
        const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        outline = []; outlineMode = 'lines';
        for (const [from, to] of edges) { outline.push({ ...vertices[from] }, { ...vertices[to] }); sampleEdge(vertices[from], vertices[to], 96); }
        derived = { volume: l * w * h, surfaceArea: 2 * (l * w + l * h + w * h), edges: edges.map((edge) => [...edge]),
          spatialDefinition: 'x=length,y=height,z=width; mathematical cuboid, not video reconstruction' };
      }
    } else {
      if (!deps.geometry || typeof deps.geometry.solveTriangle !== 'function') throw new TypeError('几何求解器未加载。');
      const solved = deps.geometry.solveTriangle(triangleScene(value));
      derived = { BC: solved.BC, normalizedVertices: solved.normalizedVertices };
      vertices = [point(0, 0), point(value.AB, 0), point(0, value.AC)];
      outline = [...vertices.map((item) => ({ ...item })), point(0, 0)];
      for (let side = 0; side < 3; side += 1) sampleEdge(vertices[side], vertices[(side + 1) % 3]);
      const mark = Math.min(value.AB, value.AC) * 0.12;
      rightAngle = [point(mark, 0), point(mark, mark), point(0, mark)];
    }
    if (points.length > MAX_POINTS || points.some((item) => !finite(item.x) || !finite(item.y) || !finite(item.z))) {
      throw new TypeError('数学采样超出有限资源范围。');
    }
    const xs = points.map((item) => item.x), ys = points.map((item) => item.y), zs = points.map((item) => item.z);
    const bounds = { minX: Math.min(0, ...xs), maxX: Math.max(0, ...xs),
      minY: Math.min(0, ...ys), maxY: Math.max(0, ...ys), minZ: Math.min(0, ...zs), maxZ: Math.max(0, ...zs) };
    const axes = [point(bounds.minX, 0), point(bounds.maxX, 0), point(0, bounds.minY), point(0, bounds.maxY)];
    if (template === 'cuboid') axes.push(point(0, 0, bounds.minZ), point(0, 0, bounds.maxZ));
    return { template, snapshot: { ...value }, points, outline, outlineMode, axes, vertices, rightAngle, bounds, domain, derived };
  }

  // A common scale preserves angles/relative lengths and avoids Float32 overflow.
  function displayPositions(items, bounds) {
    const scale = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY),
      Math.abs(bounds.minZ || 0), Math.abs(bounds.maxZ || 0)) || 1;
    const minX = bounds.minX / scale, maxX = bounds.maxX / scale;
    const minY = bounds.minY / scale, maxY = bounds.maxY / scale;
    const minZ = (bounds.minZ || 0) / scale, maxZ = (bounds.maxZ || 0) / scale;
    const centerX = minX / 2 + maxX / 2, centerY = minY / 2 + maxY / 2, centerZ = minZ / 2 + maxZ / 2;
    // A bounding sphere keeps a cuboid inside the view through arbitrary rotation.
    const radius = (bounds.maxZ > bounds.minZ ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
      : Math.max(maxX - minX, maxY - minY)) / 2 || 1;
    const positions = new Float32Array(items.length * 3);
    items.forEach((item, index) => {
      positions[index * 3] = (item.x / scale - centerX) / radius * 0.72;
      positions[index * 3 + 1] = (item.y / scale - centerY) / radius * 0.72;
      positions[index * 3 + 2] = (item.z / scale - centerZ) / radius * 0.72;
    });
    return positions;
  }

  function createRenderer({ canvas, template, snapshot, reducedMotion = false, onFallback } = {}) {
    let scene = sampleScene(template, snapshot);
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('需要独立的粒子画布。');
    const doc = canvas.ownerDocument || root.document;
    const win = doc && doc.defaultView || root;
    let mode = 'webgl', destroyed = false, fallbackCode = null;
    const defaultView = template === 'cuboid' ? { yaw: -0.55, pitch: 0.35 } : { yaw: 0, pitch: 0 };
    let view = { ...defaultView }, gl = null, program = null, observer = null;
    let locations = null, dpr = 1, dirty = true;
    const buffers = [], shaders = [], groups = [];
    const listeners = [];
    const listen = (target, event, handler) => {
      if (target && typeof target.addEventListener === 'function') {
        target.addEventListener(event, handler);
        listeners.push(() => target.removeEventListener(event, handler));
      }
    };
    const safe = (action) => { try { action(); } catch (_) { /* Context may already be lost. */ } };
    function releaseGL() {
      if (!gl) return;
      for (const buffer of buffers.splice(0)) safe(() => gl.deleteBuffer(buffer));
      for (const shader of shaders.splice(0)) safe(() => gl.deleteShader(shader));
      if (program) safe(() => gl.deleteProgram(program));
      program = null;
      groups.length = 0;
    }
    function fallback(code) {
      if (destroyed || mode === 'fallback') return;
      mode = 'fallback'; fallbackCode = code;
      releaseGL();
      if (observer) { observer.disconnect(); observer = null; }
      if (typeof onFallback === 'function') safe(() => onFallback({ code, message: '粒子视图不可用，保留二维 SVG 数学主图。' }));
    }
    function makeShader(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('shader');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader');
      return shader;
    }
    function upload() {
      const samples = [scene.axes, scene.outline, scene.rightAngle, scene.points, scene.vertices];
      groups.length = 0;
      samples.forEach((items, index) => {
        if (!buffers[index]) {
          buffers[index] = gl.createBuffer();
          if (!buffers[index]) throw new Error('buffer');
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index]);
        gl.bufferData(gl.ARRAY_BUFFER, displayPositions(items, scene.bounds), gl.STATIC_DRAW);
        groups.push({ buffer: buffers[index], count: items.length });
      });
    }
    function resize() {
      const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : {};
      const cssWidth = finite(rect.width) && rect.width > 0 ? rect.width : canvas.clientWidth || 640;
      const cssHeight = finite(rect.height) && rect.height > 0 ? rect.height : canvas.clientHeight || 360;
      dpr = clamp(finite(win.devicePixelRatio) ? win.devicePixelRatio : 1, 1, MAX_DPR);
      // Reduce both dimensions together; independent caps would distort lengths
      // when CSS stretches the backing canvas back to its original aspect ratio.
      dpr = Math.min(dpr, MAX_CANVAS_SIZE / cssWidth, MAX_CANVAS_SIZE / cssHeight);
      const width = clamp(Math.round(cssWidth * dpr), 1, MAX_CANVAS_SIZE);
      const height = clamp(Math.round(cssHeight * dpr), 1, MAX_CANVAS_SIZE);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    function drawGroup(index, primitive, color, size, particle) {
      const group = groups[index];
      if (!group || !group.count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(locations.color, color);
      gl.uniform1f(locations.size, clamp(size * dpr, 1, 8));
      gl.uniform1f(locations.particle, particle);
      gl.drawArrays(primitive, 0, group.count);
    }
    function draw() {
      if (destroyed || mode !== 'webgl') return false;
      dirty = true;
      if (doc && doc.hidden) return false;
      try {
        resize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.025, 0.045, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program); gl.enableVertexAttribArray(locations.position);
        const aspect = canvas.width / canvas.height;
        gl.uniform2f(locations.scale, aspect >= 1 ? 1 / aspect : 1, aspect >= 1 ? 1 : aspect);
        gl.uniform2f(locations.view, view.yaw, view.pitch);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        drawGroup(0, gl.LINES, [0.5, 0.64, 0.77, 0.8], 1, 0);
        drawGroup(1, scene.outlineMode === 'lines' ? gl.LINES : gl.LINE_STRIP, [0.4, 0.85, 1, 0.8], 1, 0);
        drawGroup(2, gl.LINE_STRIP, [1, 0.8, 0.3, 1], 1, 0);
        drawGroup(3, gl.POINTS, [0.3, 0.8, 1, 0.16], 7, 1);
        drawGroup(3, gl.POINTS, [0.65, 0.93, 1, 0.94], 3, 1);
        drawGroup(4, gl.POINTS, [1, 0.8, 0.3, 1], 5, 1);
        if (typeof gl.getError === 'function' && gl.getError() !== gl.NO_ERROR) throw new Error('draw');
        dirty = false; return true;
      } catch (_) { fallback('render_failed'); return false; }
    }
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error('unavailable');
      program = gl.createProgram();
      if (!program) throw new Error('program');
      gl.attachShader(program, makeShader(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
      locations = { position: gl.getAttribLocation(program, 'aPosition'),
        scale: gl.getUniformLocation(program, 'uScale'), view: gl.getUniformLocation(program, 'uView'),
        size: gl.getUniformLocation(program, 'uSize'), color: gl.getUniformLocation(program, 'uColor'),
        particle: gl.getUniformLocation(program, 'uParticle') };
      if (locations.position < 0 || Object.keys(locations).some((key) => key !== 'position' && locations[key] === null)) throw new Error('locations');
      for (const shader of shaders.splice(0)) gl.deleteShader(shader);
      upload(); draw();
    } catch (_) { fallback(gl ? 'initialization_failed' : 'webgl_unavailable'); }
    listen(canvas, 'webglcontextlost', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      fallback('context_lost');
    });
    listen(doc, 'visibilitychange', () => { if (!(doc && doc.hidden) && dirty) draw(); });
    listen(win, 'resize', draw);
    if (mode === 'webgl' && typeof win.ResizeObserver === 'function') {
      try { observer = new win.ResizeObserver(() => draw()); observer.observe(canvas); }
      catch (_) { fallback('lifecycle_failed'); }
    }
    return {
      update(nextSnapshot) {
        if (destroyed) return false;
        const next = sampleScene(template, nextSnapshot);
        scene = next; dirty = true;
        if (mode === 'webgl') { try { upload(); } catch (_) { fallback('render_failed'); } }
        return draw();
      },
      setView(next) {
        if (destroyed) return false;
        if (!next || !finite(next.yaw) || !finite(next.pitch)
          || Object.keys(next).some((key) => !['yaw', 'pitch'].includes(key))) throw new TypeError('视角需要有限的 yaw/pitch 弧度。');
        view = { yaw: clamp(next.yaw, -Math.PI, Math.PI), pitch: clamp(next.pitch, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08) };
        return draw();
      },
      resetView() { if (destroyed) return false; view = { ...defaultView }; return draw(); },
      getState() { return { mode, pointCount: scene.points.length, snapshot: { ...scene.snapshot },
        template, destroyed, reducedMotion: Boolean(reducedMotion), view: { ...view },
        fallbackCode, width: canvas.width, height: canvas.height, dpr, suspended: Boolean(doc && doc.hidden) }; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (observer) { observer.disconnect(); observer = null; }
        for (const remove of listeners.splice(0)) safe(remove);
        releaseGL(); gl = null;
      }
    };
  }
  return { sampleScene, createRenderer, MAX_POINTS, MAX_CANVAS_SIZE, MAX_DPR };
});
