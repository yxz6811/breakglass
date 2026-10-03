// 本地图形遵循 docs/BreakGlass-constitution.md 与 004-figures-and-tutor FR-007..010。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFigure, updateParameters, resetFigure, readAt,
  visiblePolylines, controlPoint, formula
} = require('../extension/src/geometry/figures');
const preset = require('../extension/assets/presets/demo-parabola.json');
const base = preset.definition;

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}

function changed(figure, updates) {
  const result = updateParameters(figure, updates);
  assert.equal(result.ok, true, result.message);
  return result.figure;
}

function withinWindow(figure, lines) {
  const { domain, range } = figure.definition;
  for (const line of lines) {
    assert.ok(line.length >= 2);
    for (const point of line) {
      assert.equal(Number.isFinite(point.x) && Number.isFinite(point.y), true);
      assert.ok(point.x >= domain.min - 1e-10 && point.x <= domain.max + 1e-10);
      assert.ok(point.y >= range.min - 1e-10 && point.y <= range.max + 1e-10);
    }
  }
}

test('the parabola uses the unchanged accepted definition and initial coefficients', () => {
  const figure = createFigure('parabola', base);
  assert.equal(figure.definition, base);
  assert.deepEqual(figure.parameters, { a: 1, h: 0, k: 1 });
  assert.deepEqual(controlPoint(figure), { x: 0, y: 1 });
  assert.equal(readAt(figure, 2).values[0], 5);
});

test('each local figure declares only its own labelled finite coefficients', () => {
  const expected = { line: ['m', 'b'], circle: ['h', 'k', 'r'], sine: ['a', 'h', 'k'] };
  for (const [kind, parameterNames] of Object.entries(expected)) {
    const figure = createFigure(kind, base);
    assert.deepEqual(Object.keys(figure.parameters), parameterNames);
    assert.deepEqual(Object.keys(figure.definition.parameters), parameterNames);
    assert.equal(figure.definition.equationId, 'local.' + kind);
    for (const item of Object.values(figure.definition.parameters)) {
      assert.equal(typeof item.label, 'string');
      for (const key of ['initial', 'min', 'max', 'step']) assert.equal(Number.isFinite(item[key]), true);
    }
    assert.deepEqual(figure.definition.domain, base.domain);
    assert.deepEqual(figure.definition.range, base.range);
    assert.equal(figure.definition.yAxis, base.yAxis);
  }
});

test('new figures preserve one pixel scale for both axes inside the accepted region', () => {
  for (const source of [base, { ...base, domain: { min: -8, max: 8 }, range: { min: -2, max: 2 }, yAxis: 'down' }]) {
    for (const kind of ['line', 'circle', 'sine']) {
      const { definition } = createFigure(kind, source);
      const r = definition.region;
      near(r.width / (definition.domain.max - definition.domain.min), r.height / (definition.range.max - definition.range.min));
      near(r.x + r.width / 2, source.region.x + source.region.width / 2);
      near(r.y + r.height / 2, source.region.y + source.region.height / 2);
      assert.ok(r.x >= source.region.x && r.y >= source.region.y);
      assert.ok(r.x + r.width <= source.region.x + source.region.width);
      assert.ok(r.y + r.height <= source.region.y + source.region.height);
    }
  }
});

test('local horizontal and vertical position ranges match their accepted descriptors', () => {
  const line = createFigure('line', base);
  const circle = createFigure('circle', base);
  const sine = createFigure('sine', base);
  for (const key of ['initial', 'min', 'max', 'step']) {
    assert.equal(line.definition.parameters.b[key], base.parameters.k[key]);
    for (const figure of [circle, sine]) {
      assert.equal(figure.definition.parameters.h[key], base.parameters.h[key]);
      assert.equal(figure.definition.parameters.k[key], base.parameters.k[key]);
    }
  }
  assert.ok(circle.definition.parameters.r.min > 0);
  assert.ok(sine.definition.parameters.a.min < 0 && sine.definition.parameters.a.max > 0);
});

test('coefficient updates return an immutable new figure and record actually used clamped values', () => {
  const figure = createFigure('line', base);
  const original = structuredClone(figure);
  const result = updateParameters(figure, { m: -100, b: 100 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.figure.parameters, { m: -4, b: 2 });
  assert.deepEqual(result.changes.m, { before: 1, after: -4, requested: -100, clamped: true });
  assert.deepEqual(result.changes.b, { before: 1, after: 2, requested: 100, clamped: true });
  assert.deepEqual(figure, original);
  assert.notEqual(result.figure, figure);
});

test('a multi-coefficient request is atomic when any key or value is invalid', () => {
  const figure = createFigure('circle', base);
  const original = structuredClone(figure);
  for (const updates of [
    { h: 1, a: 2 }, { h: 1, r: NaN }, { h: 1, k: Infinity },
    { h: 1, r: -Infinity }, { h: 1, r: '2' }, null, [1, 2], Object.create({ h: 1 })
  ]) {
    const result = updateParameters(figure, updates);
    assert.equal(result.ok, false);
    assert.equal(result.figure, figure);
    assert.deepEqual(result.changes, {});
    assert.equal(typeof result.message, 'string');
    assert.deepEqual(figure, original);
  }
});

test('changing coefficients retains exact values between slider steps', () => {
  const figure = changed(createFigure('line', base), { m: 1.2345, b: -0.3456 });
  assert.deepEqual(figure.parameters, { m: 1.2345, b: -0.3456 });
  near(readAt(figure, 0.5).values[0], 0.27165);
});

test('reset restores each kind from its own descriptors', () => {
  const updates = { parabola: { a: 1.2, h: 2, k: -1 }, line: { m: -1, b: -1 }, circle: { h: 1, k: -1, r: 2 }, sine: { a: -2, h: 1, k: 2 } };
  for (const kind of Object.keys(updates)) {
    const initial = createFigure(kind, base);
    const modified = changed(initial, updates[kind]);
    const reset = resetFigure(modified);
    assert.deepEqual(reset.parameters, initial.parameters);
    assert.deepEqual(modified.parameters, updates[kind]);
  }
});

test('parabola, line and sine readouts use their actual finite coefficients', () => {
  const parabola = changed(createFigure('parabola', base), { a: 0.5, h: 1, k: -1 });
  assert.deepEqual(readAt(parabola, 3), { ok: true, x: 3, values: [1], visible: [false] });
  const line = changed(createFigure('line', base), { m: -2, b: 1 });
  assert.deepEqual(readAt(line, 0.5), { ok: true, x: 0.5, values: [0], visible: [true] });
  const sine = changed(createFigure('sine', base), { a: -2, h: 0.25, k: 2 });
  near(readAt(sine, Math.PI / 2 + 0.25).values[0], 0);
  assert.equal(readAt(sine, Math.PI / 2 + 0.25).visible[0], true);
  const flat = changed(sine, { a: 0 });
  assert.deepEqual(readAt(flat, 0), { ok: true, x: 0, values: [2], visible: [true] });
});

test('circle readouts preserve both intersections, collapse tangency and report no solution outside', () => {
  const figure = changed(createFigure('circle', base), { h: 0.5, k: 1, r: 2 });
  assert.deepEqual(readAt(figure, 0.5), { ok: true, x: 0.5, values: [3, -1], visible: [true, false] });
  const offset = readAt(figure, 1.5);
  near(offset.values[0], 1 + Math.sqrt(3));
  near(offset.values[1], 1 - Math.sqrt(3));
  assert.deepEqual(readAt(figure, 2.5), { ok: true, x: 2.5, values: [1], visible: [true] });
  assert.deepEqual(readAt(figure, 3), { ok: true, x: 3, values: [], visible: [] });
});

test('non-finite input and corrupted coefficients are rejected before reading or drawing', () => {
  const figure = createFigure('sine', base);
  for (const x of [NaN, Infinity, -Infinity, '2']) assert.equal(readAt(figure, x).ok, false);
  const invalid = { ...figure, parameters: { ...figure.parameters, h: Infinity } };
  assert.equal(readAt(invalid, 1).ok, false);
  assert.equal(updateParameters(invalid, { a: 1 }).ok, false);
  assert.throws(() => visiblePolylines(invalid), TypeError);
  assert.throws(() => createFigure('triangle', base), /未知图形/);
  assert.throws(() => createFigure('line', { ...base, range: { min: 0, max: Infinity } }), TypeError);
  assert.throws(() => createFigure('parabola', { ...base, parameters: { ...base.parameters, a: { initial: 0, min: -1, max: 1, step: 0.1 } } }), /不得包含 0/);
});

test('a finite but overflowing update is rejected without partial application', () => {
  const wide = { ...base, domain: { min: 0, max: 1e308 } };
  const line = createFigure('line', wide);
  const result = updateParameters(line, { m: 4, b: -1 });
  assert.equal(result.ok, false);
  assert.equal(result.figure, line);
  assert.deepEqual(line.parameters, { m: 1, b: 1 });
});

test('line segments enter and leave exactly at rectangle intersections', () => {
  const figure = changed(createFigure('line', base), { m: 4, b: 1 });
  const lines = visiblePolylines(figure, 2);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0][0], { x: -0.25, y: 0 });
  assert.deepEqual(lines[0].at(-1), { x: 1.75, y: 8 });
  assert.equal(lines[0].filter((point) => point.y === 0).length, 1);
  assert.equal(lines[0].filter((point) => point.y === 8).length, 1);
  withinWindow(figure, lines);
});

test('parabola arms remain separate across an invisible vertex with exact mathematical crossings', () => {
  const figure = changed(createFigure('parabola', base), { a: 1, h: 0, k: -2 });
  const lines = visiblePolylines(figure, 2);
  assert.equal(lines.length, 2);
  near(lines[0].at(-1).x, -Math.sqrt(2));
  near(lines[1][0].x, Math.sqrt(2));
  near(lines[0].at(-1).y, 0);
  near(lines[1][0].y, 0);
  assert.ok(lines[0].every((point) => point.x <= -Math.sqrt(2) + 1e-9));
  assert.ok(lines[1].every((point) => point.x >= Math.sqrt(2) - 1e-9));
  withinWindow(figure, lines);
});

test('sine exits and re-enters as four independent arcs without an edge connecting them', () => {
  const definition = { ...base, domain: { min: -2 * Math.PI, max: 2 * Math.PI }, range: { min: 0.5, max: 0.75 } };
  const figure = changed(createFigure('sine', definition), { a: 1, h: 0, k: 0 });
  const lines = visiblePolylines(figure, 2);
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.ok(Math.abs(line[0].y - 0.5) < 1e-9 || Math.abs(line[0].y - 0.75) < 1e-9);
    assert.ok(Math.abs(line.at(-1).y - 0.5) < 1e-9 || Math.abs(line.at(-1).y - 0.75) < 1e-9);
    for (const point of line) near(point.y, Math.sin(point.x));
  }
  withinWindow(figure, lines);
});

test('circle uses angle sampling and remains round, with closed finite points', () => {
  const figure = createFigure('circle', base);
  const lines = visiblePolylines(figure);
  assert.equal(lines.length, 1);
  const line = lines[0];
  near(line[0].x, line.at(-1).x);
  near(line[0].y, line.at(-1).y);
  for (const point of line) near(Math.hypot(point.x - figure.parameters.h, point.y - figure.parameters.k), figure.parameters.r);
  withinWindow(figure, lines);
});

test('circle clipping retains separate left and right arcs across out-of-window top and bottom', () => {
  const definition = { ...base, range: { min: -1, max: 1 } };
  const figure = changed(createFigure('circle', definition), { h: 0, k: 0, r: 2 });
  const lines = visiblePolylines(figure, 33);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.every((point) => Math.abs(point.x) >= Math.sqrt(3) - 1e-9)));
  for (const line of lines) {
    near(Math.abs(line[0].y), 1);
    near(Math.abs(line.at(-1).y), 1);
    for (const point of line) near(Math.hypot(point.x, point.y), 2, 1e-8);
  }
  withinWindow(figure, lines);
});

test('wholly invisible shapes produce no fake edge', () => {
  const outside = [
    changed(createFigure('parabola', { ...base, range: { min: 20, max: 30 } }), { a: 1, h: 0, k: -2 }),
    changed(createFigure('line', base), { m: 0, b: -1 }),
    changed(createFigure('circle', base), { h: 0, k: -2, r: 0.5 }),
    changed(createFigure('sine', base), { a: 0, k: -1 })
  ];
  for (const figure of outside) assert.deepEqual(visiblePolylines(figure), [], figure.kind);
});

test('visible clipping is bounded even when a caller requests an excessive sample count', () => {
  const figure = createFigure('line', base);
  const lines = visiblePolylines(figure, Number.MAX_VALUE);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length <= 4099);
  withinWindow(figure, lines);
});

test('a huge finite sine translation returns promptly with finite clipped coordinates', () => {
  const { spawnSync } = require('node:child_process');
  const definition = {
    ...base,
    domain: { min: -4, max: 4 },
    parameters: { ...base.parameters, h: { initial: 1e100, min: 1e100, max: 1e100, step: 1 } }
  };
  // 独立进程的超时能真正中止同步死循环；测试主进程的 timeout 无法中断它。
  const program = `
    const { createFigure, visiblePolylines } = require(${JSON.stringify(require.resolve('../extension/src/geometry/figures'))});
    const figure = createFigure('sine', ${JSON.stringify(definition)});
    process.stdout.write(JSON.stringify(visiblePolylines(figure, 33)));
  `;
  const result = spawnSync(process.execPath, ['-e', program], { timeout: 3000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const lines = JSON.parse(result.stdout);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 33);
  assert.equal(lines[0][0].x, -4);
  assert.equal(lines[0].at(-1).x, 4);
  const figure = createFigure('sine', definition);
  withinWindow(figure, lines);
  for (const point of lines[0]) near(point.y, readAt(figure, point.x).values[0]);
});

test('control points follow each actual figure and formulas contain its actual numbers', () => {
  const values = {
    line: { updates: { m: -2, b: 1.5 }, point: { x: 0, y: 1.5 } },
    circle: { updates: { h: 1, k: 2, r: 0.5 }, point: { x: 1.5, y: 2 } },
    sine: { updates: { a: -2, h: 1, k: 2 }, point: { x: 1, y: 2 } }
  };
  for (const [kind, item] of Object.entries(values)) {
    const figure = changed(createFigure(kind, base), item.updates);
    assert.deepEqual(controlPoint(figure), item.point);
    const text = formula(figure);
    assert.equal(typeof text, 'string');
    assert.equal(/[<>]/.test(text), false);
    for (const value of Object.values(item.updates)) assert.ok(text.includes(String(value)), text);
  }
});
