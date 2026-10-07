const test = require('node:test');
const assert = require('node:assert/strict');
const projection = require('../learning-site/learning-evidence');
const records = require('../learning-site/records');
const flow = require('../learning-site/learning-flow');
const TIME = '2026-10-07T00:00:00.000Z';
const LATER = '2026-10-07T00:00:01.000Z';
const NOW = '2026-11-07T00:00:00.000Z';
function record(id = 'record-p', template = 'parabola') {
  return records.validateRecord({ id, kind: 'question',
    source: { kind: 'manual-notes', id: 'teacher-checked', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
    time: 0, title: '已核对的原题', note: '原题与实际作答分别保留。', template,
    snapshot: template === 'parabola' ? { a: 2, h: -3, k: 1 } : { AB: 3, AC: 4, unit: 'cm' },
    origin: 'manual', sourceLabel: '学生手工条件', createdAt: TIME });
}
function legacy(r, { id = 'old-1', answer = records.expectedAnswer(r), hintUsed = false, createdAt = LATER } = {}) {
  const correct = records.judge(r, answer);
  return { id, recordId: r.id, answer: structuredClone(answer), hintUsed, correct,
    outcome: correct ? hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong', createdAt };
}
function fresh(r, { id = 'new-1', kind = r.template === 'parabola' ? 'parabola-vertex' : 'triangle-hypotenuse',
  stage = 'practice', help = null, answer, createdAt = LATER, generation = 0 } = {}) {
  const exercise = flow.createExercise(r, { id: `exercise-${id}`, kind, stage, index: 1, createdAt: TIME });
  let context = flow.createContext(exercise, { id: `context-${id}`, generation });
  if (help) context = flow.markHelp(context, help);
  const receipt = flow.submitExercise(r, exercise, context, { id, createdAt,
    answer: answer === undefined ? flow.exerciseView(exercise, r).answer : answer });
  return { exercise, context, receipt };
}
function dataFor(r, old = [], next = []) {
  return { records: [r], attempts: old, annotations: [], flow: { ...flow.emptyFlow(),
    purposes: [flow.createPurpose(r.id, 'practice', { updatedAt: TIME })],
    exercises: next.map((n) => n.exercise), contexts: next.map((n) => n.context), receipts: next.map((n) => n.receipt) } };
}

test('legacy and new receipts share one projection, while event IDs have separate namespaces', () => {
  const r = record(), next = fresh(r, { id: 'same-id', stage: 'delayed' });
  const data = dataFor(r, [legacy(r, { id: 'same-id' })], [next]);
  const before = structuredClone(data);
  const result = projection.project(data, { scope: 'account', owner: 'account-owner', epoch: 2, now: NOW });
  assert.deepEqual(result.events.map((e) => e.key), ['attempt:same-id', 'receipt:same-id']);
  assert.deepEqual(result.summary, { independentCorrect: 2, assistedCorrect: 0, wrong: 0, completion: 0, delayed: 1, wrongRecords: 0 });
  assert.equal(result.records[0].state, '最近一次独立正确');
  assert.equal(result.records[0].plan.days, 14);
  assert.equal(result.records[0].plan.evidenceCount, 2);
  assert.equal(result.queue.due.length, 1);
  assert.equal(result.queue.manual.length, 1);
  assert.equal(result.queue.foundation.length, 0);
  assert.equal(result.queue.interleaved.length, 1);
  assert.equal(result.invalidCount, 0);
  assert.equal(result.scope, 'account'); assert.equal(result.owner, 'account-owner'); assert.equal(result.epoch, 2);
  assert.deepEqual(data, before);
  assert.ok(result.events.every((e) => !Object.hasOwn(e, 'answer') && !Object.hasOwn(e, 'id')));
});

test('one actual history applies the existing 1/3/7/14/28-day policy across both sources', () => {
  const r = record();
  const wrong = dataFor(r, [legacy(r, { answer: { h: 99, k: 1 } })]);
  assert.equal(projection.project(wrong, { now: NOW }).records[0].plan.days, 1);
  const assisted = dataFor(r, [], [fresh(r, { help: { type: 'hint', level: 1 } })]);
  assert.equal(projection.project(assisted, { now: NOW }).records[0].plan.days, 3);
  assert.equal(projection.project(assisted, { now: NOW }).records[0].state, '使用提示完成');
  for (const [count, days] of [[1, 7], [2, 14], [3, 28], [4, 28]]) {
    const old = [legacy(r)];
    const next = Array.from({ length: count - 1 }, (_, index) => fresh(r, { id: `new-${index}`, createdAt: `2026-10-07T00:00:0${index + 2}.000Z` }));
    assert.equal(projection.project(dataFor(r, old, next), { now: NOW }).records[0].plan.days, days);
  }
});

test('completion retains real correctness and assistance, counts wrong records, and never drives mastery or scheduling', () => {
  const r = record();
  const next = [fresh(r, { id: 'step-right', kind: 'parabola-completion', stage: 'completion' }),
    fresh(r, { id: 'step-wrong', kind: 'parabola-completion', stage: 'completion', answer: 999, help: { type: 'answer' } })];
  const result = projection.project(dataFor(r, [], next), { now: NOW });
  assert.deepEqual(result.summary, { independentCorrect: 0, assistedCorrect: 0, wrong: 0, completion: 2, delayed: 0, wrongRecords: 1 });
  assert.deepEqual(result.events.map((e) => [e.stage, e.correct, e.hintUsed, e.outcome]),
    [['completion', true, false, 'correct_independent'], ['completion', false, true, 'wrong']]);
  assert.equal(result.records[0].state, '待验证'); assert.equal(result.records[0].hasWrong, true);
  assert.equal(result.records[0].plan.evidenceCount, 0); assert.equal(result.records[0].plan.reviewAt, null);
  assert.equal(result.queue.due.length, 0); assert.equal(result.queue.foundation.length, 1);
});

test('help is independently rechecked and old valid help generations survive current-epoch changes', () => {
  const r = record(); const n = fresh(r, { generation: 2, help: { type: 'hint', level: 3 } });
  const d = dataFor(r, [], [n]);
  const result = projection.project(d, { epoch: 9, now: NOW });
  assert.equal(result.summary.assistedCorrect, 1);
  assert.equal(result.records[0].plan.days, 3);
  const lower = flow.markHelp(n.context, { type: 'hint', level: 1 });
  assert.equal(lower.hintsShown, 3);
  const bad = structuredClone(d); bad.flow.contexts[0].hintsShown = 0;
  assert.equal(projection.project(bad, { now: NOW }).events.length, 0);
  const forged = structuredClone(d); forged.flow.receipts[0].hintUsed = false; forged.flow.receipts[0].outcome = 'correct_independent';
  assert.equal(projection.project(forged, { now: NOW }).events.length, 0);
  const answer = dataFor(r, [], [fresh(r, { help: { type: 'answer' } })]);
  const example = dataFor(r, [], [fresh(r, { help: { type: 'example' } })]);
  assert.equal(projection.project(answer).summary.assistedCorrect, 1);
  assert.equal(projection.project(example).summary.assistedCorrect, 1);
});

test('duplicate legacy IDs and duplicate receipt submission groups are all excluded rather than counted twice', () => {
  const r = record(), n = fresh(r), d = dataFor(r, [legacy(r)], [n]);
  const duplicateOld = structuredClone(d); duplicateOld.attempts.push(structuredClone(duplicateOld.attempts[0]));
  assert.deepEqual(projection.project(duplicateOld).events.map((e) => e.sourceType), ['receipt']);
  const duplicateNew = structuredClone(d); duplicateNew.flow.receipts.push({ ...duplicateNew.flow.receipts[0], id: 'second-receipt' });
  assert.deepEqual(projection.project(duplicateNew).events.map((e) => e.sourceType), ['attempt']);
  const duplicateId = structuredClone(d); const other = fresh(r, { id: 'second-exercise' });
  duplicateId.flow.exercises.push(other.exercise); duplicateId.flow.contexts.push(other.context);
  duplicateId.flow.receipts.push({ ...other.receipt, id: n.receipt.id });
  assert.deepEqual(projection.project(duplicateId).events.map((e) => e.sourceType), ['attempt']);
});

test('duplicate parent, exercise, context, purpose and review groups are quarantined without poisoning valid siblings', () => {
  const r = record(), n = fresh(r), d = dataFor(r, [legacy(r)], [n]);
  const duplicateParent = structuredClone(d); duplicateParent.records.push(structuredClone(r));
  assert.equal(projection.project(duplicateParent).events.length, 0);
  for (const key of ['exercises', 'contexts']) {
    const b = structuredClone(d); b.flow[key].push(structuredClone(b.flow[key][0]));
    assert.deepEqual(projection.project(b).events.map((e) => e.sourceType), ['attempt']);
  }
  const secondContext = structuredClone(d); secondContext.flow.contexts.push({ ...n.context, id: 'other-context' });
  assert.deepEqual(projection.project(secondContext).events.map((e) => e.sourceType), ['attempt']);
  const purposes = structuredClone(d); purposes.flow.purposes.push(structuredClone(purposes.flow.purposes[0]));
  assert.equal(projection.project(purposes).summary.independentCorrect, 2);
  assert.equal(projection.project(purposes).queue.manual.length, 0);
  const review = flow.validateReview({ recordId: r.id, reviewAt: '2026-12-01T00:00:00.000Z', skippedUntil: null, revision: 1, updatedAt: TIME });
  const reviews = structuredClone(d); reviews.flow.reviews = [review, structuredClone(review)];
  assert.equal(projection.project(reviews, { now: NOW }).records[0].plan.days, 14);
  assert.equal(projection.project(reviews, { now: NOW }).queue.due.length, 1);
});

test('invalid math, unknown records and kinds, and metadata-bearing imported attempts never become authoritative', () => {
  const r = record(), d = dataFor(r, [legacy(r)], [fresh(r)]);
  d.attempts.push({ ...legacy(r, { id: 'bad-math' }), correct: false, outcome: 'wrong' });
  d.attempts.push({ ...legacy(r, { id: 'unknown-parent' }), recordId: 'gone-record' });
  d.attempts.push({ ...legacy(r, { id: 'user-history' }), trust: 'unverified' });
  const unknown = fresh(r, { id: 'unknown-kind' }); unknown.exercise.kind = 'model-script';
  d.flow.exercises.push(unknown.exercise); d.flow.contexts.push(unknown.context); d.flow.receipts.push(unknown.receipt);
  const result = projection.project(d, { now: NOW });
  assert.equal(result.events.length, 2); assert.equal(result.summary.independentCorrect, 2);
  assert.ok(result.invalidCount >= 6);
  const before = structuredClone(d);
  d.unverifiedHistory = [{ ...legacy(r), trust: 'user-provided-unverified' }, fresh(r).receipt];
  const history = projection.project(d, { now: NOW });
  assert.equal(history.events.length, 2); assert.equal(history.records[0].plan.days, result.records[0].plan.days);
  assert.deepEqual(history.unverifiedHistory, d.unverifiedHistory);
  history.unverifiedHistory[0].correct = false;
  assert.equal(d.unverifiedHistory[0].correct, true);
  delete d.unverifiedHistory; assert.deepEqual(d, before);
});

test('wrong record counts deduplicate multiple full and completion wrong events, and activity order is deterministic', () => {
  const r = record(); const t = record('record-t', 'right-triangle');
  const pNew = fresh(r, { id: 'p-wrong', answer: { h: 99, k: 1 } });
  const tNew = fresh(t, { id: 't-completion-wrong', kind: 'triangle-completion', stage: 'completion', answer: 0 });
  const d = dataFor(r, [legacy(r, { answer: { h: 99, k: 1 } })], [pNew, tNew]);
  d.records.push(t); d.flow.purposes.push(flow.createPurpose(t.id, 'practice', { updatedAt: TIME }));
  const result = projection.project(d, { now: NOW });
  assert.equal(result.summary.wrong, 2); assert.equal(result.summary.completion, 1); assert.equal(result.summary.wrongRecords, 2);
  assert.equal(result.records.filter((row) => row.hasWrong).length, 2);
  assert.equal(result.records.find((row) => row.recordId === t.id).state, '待验证');
  assert.deepEqual(result.events.map((event) => event.key), ['attempt:old-1', 'receipt:p-wrong', 'receipt:t-completion-wrong']);
});

test('only explicit practice purpose enters queues, and valid overrides preserve the common schedule', () => {
  const r = record(), d = dataFor(r, [legacy(r)]);
  d.flow.purposes = [];
  assert.equal(projection.project(d).queue.manual.length, 0);
  d.flow.purposes = [flow.createPurpose(r.id, 'reflection', { updatedAt: TIME })];
  assert.equal(projection.project(d).queue.manual.length, 0);
  d.flow.purposes = [flow.createPurpose(r.id, 'practice', { updatedAt: TIME })];
  d.flow.reviews = [flow.validateReview({ recordId: r.id, reviewAt: '2026-10-08T00:00:00.000Z',
    skippedUntil: '2026-12-01T00:00:00.000Z', revision: 1, updatedAt: TIME })];
  const result = projection.project(d, { now: NOW });
  assert.equal(result.records[0].plan.skipped, true); assert.equal(result.queue.due.length, 0);
  assert.equal(result.queue.manual.length, 1); assert.equal(result.queue.interleaved.length, 0);
});

test('current scope/owner/epoch envelopes cannot relabel old batches and separate calls retain no state', () => {
  const r = record(), d = { ...dataFor(r, [legacy(r)]), scope: 'account', owner: 'account-A', epoch: 4 };
  assert.equal(projection.project(d, { scope: 'account', owner: 'account-A', epoch: 4 }).events.length, 1);
  for (const options of [{ scope: 'account', owner: 'account-B', epoch: 4 }, { scope: 'local', owner: 'account-A', epoch: 4 },
    { scope: 'account', owner: 'account-A', epoch: 5 }]) assert.throws(() => projection.project(d, options), /范围或版本/);
  const empty = projection.project({ records: [], attempts: [], flow: flow.emptyFlow() }, { scope: 'account', owner: 'account-B', epoch: 4 });
  assert.equal(empty.events.length, 0); assert.equal(empty.summary.independentCorrect, 0);
  const local = projection.project(dataFor(r, [legacy(r)]));
  assert.equal(local.scope, 'local'); assert.equal(local.owner, 'guest'); assert.equal(local.epoch, 0);
});

test('maximum-length source IDs remain schedulable without namespace collisions or mutation', () => {
  const r = record(), id = 'a'.repeat(128);
  const next = fresh(r, { id: 'bounded' }); next.receipt.id = id;
  const d = dataFor(r, [legacy(r, { id })], [next]);
  const result = projection.project(d, { now: NOW });
  assert.equal(result.records[0].plan.days, 14); assert.equal(result.records[0].plan.evidenceCount, 2);
  assert.deepEqual(result.events.map((e) => e.key), [`attempt:${id}`, `receipt:${id}`]);
});

test('accessor payloads are isolated without executing them and returned views do not alter input', () => {
  const r = record(), d = dataFor(r, [legacy(r)]); let calls = 0;
  const bad = { ...legacy(r, { id: 'bad-getter' }) };
  Object.defineProperty(bad, 'answer', { enumerable: true, get() { calls++; throw new Error('must not execute'); } });
  d.attempts.push(bad);
  const result = projection.project(d); assert.equal(calls, 0); assert.equal(result.events.length, 1); assert.equal(result.invalidCount, 1);
  result.queue.manual[0].record.snapshot.h = 999;
  result.events[0].correct = false;
  assert.equal(r.snapshot.h, -3); assert.equal(d.attempts[0].correct, true);
});
