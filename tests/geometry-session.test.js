const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeometrySession } = require('../extension/src/geometry-session/session');
const fixture = require('./fixtures/geometry/right-triangle.json');
function confirmed() {
  const session = createGeometrySession();
  assert.equal(session.setCandidate(structuredClone(fixture)).ok, true);
  assert.equal(session.confirm().ok, true);
  return session;
}
const setAB = (value) => [{ type: 'set_length', side: 'AB', value, unit: 'unit' }];

test('candidates stay in review, and the confirmed snapshot is isolated from all callers', () => {
  const session = createGeometrySession();
  const candidate = structuredClone(fixture);
  session.setCandidate(candidate);
  candidate.lengths.AB = 100;
  assert.equal(session.getState().phase, 'review');
  assert.equal(session.getState().result, null);
  assert.equal(session.execute(setAB(6), session.getContext()).ok, false);
  session.confirm();
  const first = session.getState();
  assert.equal(first.phase, 'confirmed');
  assert.equal(first.scene.sceneRevision, 1);
  assert.equal(first.result.BC, 5);
  first.original.lengths.AB = 99; first.scene.lengths.AB = 88;
  assert.equal(session.getState().original.lengths.AB, 3);
  assert.equal(session.getState().scene.lengths.AB, 3);
});

test('correction preserves original acquisition and confirms the corrected values, not raw model output', () => {
  const session = createGeometrySession();
  const vision = structuredClone(fixture);
  Object.assign(vision, { source: 'vision', originSource: 'vision', editedByUser: false,
    vertices: { A: { x: 10, y: 10 }, B: { x: 20, y: 10 }, C: { x: 10, y: 20 } } });
  session.setCandidate(vision);
  const corrected = structuredClone(vision); corrected.lengths.AB = 6;
  assert.equal(session.confirm(corrected).ok, false);
  Object.assign(corrected, { source: 'manual', editedByUser: true });
  assert.equal(session.confirm(corrected).ok, true);
  assert.equal(session.getState().original.lengths.AB, 6);
  assert.equal(session.getState().original.originSource, 'vision');
  assert.equal(session.confirm().ok, false);
});

test('vision confirmation compares field values, not object key insertion order', () => {
  const session = createGeometrySession();
  const vision = structuredClone(fixture);
  Object.assign(vision, {
    source: 'vision', originSource: 'vision', editedByUser: false,
    lengths: { AC: 4, AB: 3 }, labels: { C: 'C', B: 'B', A: 'A' },
    vertices: { A: { x: 10, y: 10 }, B: { x: 20, y: 10 }, C: { x: 10, y: 20 } }
  });
  assert.equal(session.setCandidate(vision).ok, true);
  const unchanged = structuredClone(vision);
  unchanged.lengths = { AB: 3, AC: 4 };
  unchanged.labels = { A: 'A', B: 'B', C: 'C' };
  unchanged.vertices = { C: { y: 20, x: 10 }, A: { y: 10, x: 10 }, B: { y: 10, x: 20 } };
  const accepted = session.confirm(unchanged);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.scene.source, 'vision');
  assert.equal(accepted.state.scene.editedByUser, false);
  assert.equal(accepted.state.scene.sceneRevision, 1);
  assert.equal(accepted.state.result.BC, 5);
});

test('one side changes, old responses are refused, and restore keeps increasing revision', () => {
  const session = confirmed();
  const oldContext = session.getContext();
  const changed = session.execute([...setAB(6), { type: 'explain_change' }], oldContext);
  assert.equal(changed.ok, true);
  assert.equal(changed.state.scene.lengths.AC, 4);
  assert.equal(changed.state.scene.sceneRevision, 2);
  assert.ok(Math.abs(changed.state.result.BC - 7.211102550927979) < 1e-14);
  assert.match(changed.explanation, /AB 从 3 变为 6/);
  assert.match(changed.explanation, /AC 保持不变/);
  assert.match(changed.explanation, /BC 从 5 变为 7\.211 单位长度/);
  assert.doesNotMatch(changed.explanation, /7\.211102/);
  const before = session.getState();
  assert.equal(session.execute(setAB(9), oldContext).ok, false);
  assert.deepEqual(session.getState(), before);
  const explanation = session.execute([{ type: 'explain_change' }], session.getContext());
  assert.equal(explanation.state.scene.sceneRevision, 2);
  assert.match(explanation.explanation, /AB 从 3 变为 6/);
  assert.equal(session.execute(setAB(6), session.getContext()).state.scene.sceneRevision, 2);
  const restored = session.execute([{ type: 'restore_original' }], session.getContext());
  assert.equal(restored.state.scene.sceneRevision, 3);
  assert.equal(restored.state.scene.lengths.AB, 3);
  assert.equal(restored.state.result.BC, 5);
  assert.equal(restored.state.original.sceneRevision, 1);
  assert.equal(session.execute([{ type: 'restore_original' }], session.getContext()).state.scene.sceneRevision, 4);
});

test('every ownership mismatch and invalid batch is atomic', () => {
  const session = confirmed();
  const initial = session.getState();
  for (const [key, value] of Object.entries({ requestId: 'other', videoId: 'other', frameTime: 6.01,
    frameSize: { width: 640, height: 360 }, sceneRevision: 0 })) {
    assert.equal(session.execute(setAB(6), { ...session.getContext(), [key]: value }).ok, false, key);
    assert.deepEqual(session.getState(), initial);
  }
  for (const actions of [
    [...setAB(6), { type: 'set_length', side: 'AC', value: 8, unit: 'unit' }],
    [...setAB(6), { type: 'restore_original' }],
    [...setAB(6), { type: 'explain_change', answer: 999 }],
    [{ type: 'set_length', side: 'AB', value: -1, unit: 'unit' }]
  ]) {
    assert.equal(session.execute(actions, session.getContext()).ok, false);
    assert.deepEqual(session.getState(), initial);
  }
  assert.equal(session.execute(setAB(6), { ...session.getContext(), actionRequestId: 'ask' }).ok, false);
});

test('invalidating or replacing retires identities and disposal cannot be reopened', () => {
  const session = confirmed(); const oldContext = session.getContext();
  session.invalidate();
  assert.equal(session.getState().phase, 'empty');
  assert.equal(session.getState().original, null);
  assert.equal(session.execute(setAB(6), oldContext).ok, false);
  assert.equal(session.setCandidate(structuredClone(fixture)).ok, false);
  const newScene = structuredClone(fixture); newScene.requestId = 'geometry-manual-2';
  assert.equal(session.setCandidate(newScene).ok, true);
  session.confirm();
  assert.equal(session.execute(setAB(6), oldContext).ok, false);
  session.dispose();
  newScene.requestId = 'geometry-manual-3';
  assert.equal(session.setCandidate(newScene).ok, false);
});

test('successful numeric formatting never turns a finite value into displayed Infinity', () => {
  const session = createGeometrySession();
  const candidate = structuredClone(fixture);
  candidate.lengths = { AB: Number.MAX_VALUE, AC: 1 };
  assert.equal(session.setCandidate(candidate).ok, true);
  session.confirm();
  const explained = session.execute([{ type: 'explain_change' }], session.getContext());
  assert.equal(explained.ok, true);
  assert.doesNotMatch(explained.explanation, /Infinity|NaN/);
});
