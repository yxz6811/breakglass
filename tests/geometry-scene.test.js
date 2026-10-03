const test = require('node:test');
const assert = require('node:assert/strict');
const { validateScene } = require('../extension/src/geometry-scene/validate');
const { solveTriangle, formatLength } = require('../extension/src/geometry-scene/solve');
const fixture = require('./fixtures/geometry/right-triangle.json');
const fresh = () => structuredClone(fixture);

test('3-4-5 and independent 6-4 values share one normalized drawing scale', () => {
  const scene = fresh();
  assert.equal(solveTriangle(scene).BC, 5);
  assert.deepEqual(solveTriangle(scene).normalizedVertices, {
    A: { x: 0, y: 0 }, B: { x: 0.75, y: 0 }, C: { x: 0, y: 1 }
  });
  scene.lengths.AB = 6;
  assert.ok(Math.abs(solveTriangle(scene).BC - 7.211102550927979) < 1e-14);
  assert.deepEqual(solveTriangle(scene).normalizedVertices.B, { x: 1, y: 0 });
  assert.ok(Math.abs(solveTriangle(scene).normalizedVertices.C.y - 0.6666666666666666) < 1e-15);
  scene.lengths.AC = 8;
  assert.equal(solveTriangle(scene).BC, 10);
});

test('JSON types, unknown keys and invalid derived geometry are rejected', () => {
  for (const value of [0, -1, '3', true, null, NaN, Infinity]) {
    const scene = fresh(); scene.lengths.AB = value;
    assert.equal(validateScene(scene).ok, false, String(value));
    assert.throws(() => solveTriangle(scene), TypeError);
  }
  for (const edit of [
    (scene) => { scene.BC = 5; },
    (scene) => { scene.lengths.BC = 5; },
    (scene) => { scene.labels.D = 'D'; },
    (scene) => { scene.frameSize.cssWidth = 640; },
    (scene) => { scene.sceneRevision = 0.5; },
    (scene) => { scene.frameSize.width = '1920'; },
    (scene) => { scene.vertices = undefined; },
    (scene) => { scene.kind = 'triangle'; },
    (scene) => { scene.schemaVersion = '2.0.0'; },
    (scene) => { scene.rightAngleAt = 'B'; },
    (scene) => { scene.unit = 'mm'; },
    (scene) => { scene.lengths = { AB: Number.MAX_VALUE, AC: Number.MAX_VALUE }; },
    (scene) => { scene.lengths = { AB: Number.MIN_VALUE, AC: Number.MAX_VALUE }; }
  ]) {
    const scene = fresh(); edit(scene); assert.equal(validateScene(scene).ok, false);
  }
  const accessor = fresh();
  Object.defineProperty(accessor, 'unit', { enumerable: true, get() { throw Error('should not execute'); } });
  assert.equal(validateScene(accessor).ok, false);
});

test('finite extreme lengths avoid unnecessary squaring overflow', () => {
  const scene = fresh(); scene.lengths = { AB: 1e200, AC: 1e200 };
  assert.ok(Number.isFinite(solveTriangle(scene).BC));
  scene.lengths = { AB: Number.MIN_VALUE, AC: Number.MIN_VALUE };
  assert.ok(solveTriangle(scene).BC > 0);
  assert.deepEqual(solveTriangle(scene).normalizedVertices.C, { x: 0, y: 1 });
});

test('labels are trimmed, distinct, limited in code points, and returned as isolated JSON', () => {
  const scene = fresh(); scene.labels.A = '  甲  ';
  const checked = validateScene(scene);
  assert.equal(checked.ok, true);
  assert.equal(checked.scene.labels.A, '甲');
  checked.scene.lengths.AB = 9;
  assert.equal(scene.lengths.AB, 3);
  scene.labels.C = ' 甲 ';
  assert.equal(validateScene(scene).ok, false);
  scene.labels.C = '😀'.repeat(16);
  assert.equal(validateScene(scene).ok, true);
  scene.labels.C += '😀';
  assert.equal(validateScene(scene).ok, false);
});

test('source pixels only locate the drawing, and vision needs a complete non-collinear triple', () => {
  const scene = fresh();
  scene.source = scene.originSource = 'vision'; scene.editedByUser = false;
  assert.equal(validateScene(scene).ok, false);
  scene.vertices = { A: { x: 10, y: 10 }, B: { x: 20, y: 15 }, C: { x: 10, y: 25 } };
  assert.equal(validateScene(scene).ok, true);
  assert.equal(solveTriangle(scene).BC, 5); // pixel lengths are intentionally not 3:4.
  for (const edit of [
    (candidate) => { delete candidate.vertices.B; },
    (candidate) => { candidate.vertices.B = { x: -1, y: 10 }; },
    (candidate) => { candidate.vertices.B.x = 1921; },
    (candidate) => { candidate.vertices.B = { x: 10, y: 10 }; },
    (candidate) => { candidate.vertices.C = { x: 30, y: 20 }; },
    (candidate) => { candidate.vertices.C.code = 'alert(1)'; }
  ]) {
    const candidate = structuredClone(scene); edit(candidate);
    assert.equal(validateScene(candidate).ok, false);
  }
  scene.source = 'manual'; scene.editedByUser = true; scene.vertices = null;
  assert.equal(validateScene(scene).ok, true);
  scene.editedByUser = false;
  assert.equal(validateScene(scene).ok, false);
});

test('expected identity is exact for every ownership field and known duration', () => {
  const scene = fresh();
  const expected = { requestId: scene.requestId, videoId: scene.videoId, frameTime: 6,
    frameSize: { width: 1920, height: 1080 }, sceneRevision: 0, duration: 9 };
  assert.equal(validateScene(scene, expected).ok, true);
  for (const [key, value] of Object.entries({ requestId: 'new', videoId: 'new', frameTime: 6.1,
    frameSize: { width: 640, height: 360 }, sceneRevision: 1, duration: 5 })) {
    assert.equal(validateScene(scene, { ...expected, [key]: value }).ok, false, key);
  }
});

test('shared display formatting uses three decimals and finite exponent strings at extremes', () => {
  assert.equal(formatLength(7.211102550927979), '7.211');
  assert.equal(formatLength(5), '5');
  assert.equal(formatLength(3.1), '3.1');
  assert.equal(formatLength(0), '0');
  assert.equal(formatLength(0.001), '0.001');
  assert.equal(formatLength(0.0001), '1.000e-4');
  assert.equal(formatLength(1e7), '1.000e+7');
  assert.equal(formatLength(Number.MAX_VALUE), '1.798e+308');
  assert.equal(formatLength(Number.MIN_VALUE), '4.941e-324');
  for (const value of [NaN, Infinity, -Infinity, '3', null, undefined]) assert.equal(formatLength(value), '—');
  for (const value of [7.211102550927979, Number.MAX_VALUE, Number.MIN_VALUE]) {
    assert.doesNotMatch(formatLength(value), /Infinity|NaN/);
  }
});
