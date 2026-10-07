import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { deriveAnswer, verifyContent } from '../scripts/verify-010-content.mjs';
const require = createRequire(import.meta.url);
const records = require('../learning-site/records.js');
const original = JSON.parse(fs.readFileSync(new URL('../specs/010-evidence-guided-learning/quality/lessons.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(original);
const stage = (b, id) => b.lessons.flatMap((l) => [...l.stages, ...l.counterexamples]).find((s) => s.id === id);

test('two media fingerprints and every limited exercise independently check out', () => {
  const report = verifyContent(original);
  assert.equal(report.ok, true); assert.equal(report.stageCount, 15); assert.equal(report.counterexampleCount, 4);
  assert.equal(report.misconceptionCount, 7); assert.equal(report.teacherReview, 'pending-external');
  assert.equal(report.studentValidation, 'not-run');
});
test('video k=1 cannot be replaced by the hand-authored k=0 exploration', () => {
  const b = copy(); b.sources.find((s) => s.id === 'media-parabola-k1').snapshot.k = 0;
  assert.throws(() => verifyContent(b), /registered preset/);
});
test('edited media fingerprints and duplicate task identities are rejected', () => {
  const b = copy(); b.sources[0].sha256 = '0'.repeat(64);
  assert.throws(() => verifyContent(b), /fingerprint/);
  const c = copy(); c.lessons[0].stages[1].id = c.lessons[0].stages[0].id;
  assert.throws(() => verifyContent(c), /duplicate/);
});
test('sign, expanded representation and exact-expression errors are caught', () => {
  const b = copy(); stage(b, 'p-practice-plus3').expected.h = 3;
  assert.throws(() => verifyContent(b), /incorrect expected/);
  const c = copy(); stage(c, 'p-transfer-expanded-vertex').math.coefficients.c = 8;
  assert.throws(() => verifyContent(c), /representation/);
  const d = copy(); stage(d, 't-practice-10-12').expected.exactExpression = 'sqrt(25)';
  assert.throws(() => verifyContent(d), /exact expression/);
});
test('missing right angle, mixed units and nonuniform area scaling fail', () => {
  const b = copy(); stage(b, 't-practice-10-12').math.conditions.angleA = 60;
  assert.throws(() => verifyContent(b), /explicitly 90/);
  const c = copy(); stage(c, 't-transfer-uniform').math.changed.unit = 'm';
  assert.throws(() => verifyContent(c), /units/);
  const d = copy(); stage(d, 't-transfer-area').math.changed.AB = 10;
  assert.throws(() => verifyContent(d), /BC contradicts|uniform scale/);
});
test('completion, prediction and examples cannot masquerade as independent submissions', () => {
  for (const id of ['p-complete-negative-a', 'p-predict-right2', 't-example-3-4-5']) {
    const b = copy(); stage(b, id).evidence = 'eligible-actual-submission';
    assert.throws(() => verifyContent(b), /evidence category/);
  }
  const b = copy(); stage(b, 'p-practice-plus3').createdAt = '2026-10-07T00:00:00.000Z';
  assert.throws(() => verifyContent(b), /historical submission/);
});
test('correct answers cannot trigger a misconception diagnosis or same-question practice', () => {
  const b = copy(); b.lessons[0].misconceptionCandidates[0].answerTrigger.answer = { h: -3, k: -1 };
  assert.throws(() => verifyContent(b), /correct answer/);
  const c = copy(); const cause = c.lessons[0].misconceptionCandidates[0];
  cause.practiceStageId = cause.answerTrigger.stageId;
  assert.throws(() => verifyContent(c), /different exercise/);
});
test('three-place display is not the scalar answer tolerance or a new mathematical state', () => {
  const s = stage(original, 't-practice-10-12');
  const record = { template: 'right-triangle', snapshot: s.snapshot };
  assert.equal(records.judge(record, 15.620), false);
  assert.equal(records.judge(record, 15.620499), true);
  const b = copy(); stage(b, s.id).expected.value = 15.620;
  assert.throws(() => verifyContent(b), /incorrect expected/);
});
test('restricted-domain minimum and a 60-degree counterexample use actual conditions', () => {
  assert.deepEqual(deriveAnswer(stage(original, 'p-counter-domain')), { value: 1 });
  assert.deepEqual(deriveAnswer(stage(original, 't-counter-non-right')), { value: 'cannot-use-pythagoras' });
  const b = copy(); stage(b, 't-counter-non-right').math.referenceCalculation.squareLength = 25;
  assert.throws(() => verifyContent(b), /nonright reference/);
});
test('oversized tolerances, expression code and invented external acceptance are rejected', () => {
  const b = copy(); stage(b, 't-practice-10-12').judge.relTolerance = 0.01;
  assert.throws(() => verifyContent(b), /tolerance/);
  const c = copy(); stage(c, 't-practice-10-12').expected.exactExpression = 'process.exit()';
  assert.throws(() => verifyContent(c), /never evaluated/);
  const d = copy(); d.status.teacherReview = 'passed';
  assert.throws(() => verifyContent(d), /external evidence/);
});
test('valid video files still cannot be relabeled as another micro-lesson or pause point', () => {
  const b = copy(); stage(b, 't-example-3-4-5').sourceId = 'media-parabola-k1';
  assert.throws(() => verifyContent(b), /different lesson/);
  const c = copy(); const geometry = c.sources.find((s) => s.id === 'media-triangle-3-4-5');
  c.sources[0].path = geometry.path; c.sources[0].sha256 = geometry.sha256;
  assert.throws(() => verifyContent(c), /identity\/path\/time/);
  const d = copy(); d.sources[0].timeSeconds = 4;
  assert.throws(() => verifyContent(d), /identity\/path\/time/);
});
test('an expanded-form exercise cannot silently fall back to its answer snapshot', () => {
  const b = copy(); delete stage(b, 'p-transfer-expanded-vertex').math.coefficients;
  assert.throws(() => verifyContent(b), /requires original coefficients/);
});
test('tiny unequal length ratios remain non-similar even within an absolute epsilon', () => {
  const item = structuredClone(stage(original, 't-transfer-uniform'));
  item.math.original = { angleA: 90, AB: 1e6, AC: 1e6, BC: null, unit: 'cm' };
  item.math.changed = { angleA: 90, AB: 1e-4, AC: 1e-3, BC: null, unit: 'cm' };
  item.snapshot = { AB: 1e-4, AC: 1e-3, unit: 'cm' };
  assert.equal(deriveAnswer(item).similar, false);
});
