const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flow = require('../learning-site/learning-flow');
const records = require('../learning-site/records');
const math = require('../learning-site/math-learning');
const TIME = '2026-10-07T00:00:00.000Z';
const LATER = '2026-10-07T00:00:01.000Z';
const original = (template = 'parabola', id = `record-${template}`) => ({ id, kind: 'question',
  source: { kind: 'manual-notes', id: 'teacher-checked', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  time: 0, title: '已核对的数学', note: '这是合法原题。', template,
  snapshot: template === 'parabola' ? { a: 2, h: -3, k: 1 } : { AB: 3, AC: 4, unit: 'cm' },
  origin: 'manual', sourceLabel: '学生已校对', createdAt: TIME });
const exerciseFor = (record, kind, stage = 'practice', index = 1, id = `exercise-${kind}-${stage}-${index}`) =>
  flow.createExercise(record, { id, kind, stage, index, createdAt: TIME });
const contextFor = (exercise) => flow.createContext(exercise, { id: `context-${exercise.id}`, generation: 2 });
const receiptFor = (record, answer = records.expectedAnswer(record), { id = 'event-1', hintUsed = false, createdAt = TIME } = {}) => {
  const correct = records.judge(record, answer);
  return { id, recordId: record.id, answer, hintUsed, correct, outcome: correct ? hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong', createdAt };
};

test('purpose is stable sidecar data: titles and old question kinds cannot silently classify explanations', () => {
  const r = original(); const before = structuredClone(r);
  const purpose = flow.createPurpose(r.id, 'reflection', { updatedAt: TIME });
  assert.equal(flow.purposeOf(r.id, []), 'unclassified');
  assert.equal(flow.purposeOf(r.id, [purpose]), 'reflection');
  assert.equal(flow.buildQueue({ records: [r], attempts: [] }, { now: TIME, mode: 'manual' }).length, 0);
  assert.equal(flow.buildQueue({ records: [{ ...r, title: '独立作答：做这道题' }], flow: { ...flow.emptyFlow(), purposes: [purpose] } },
    { now: TIME, mode: 'manual' }).length, 0);
  assert.deepEqual(r, before);
  for (const input of [{ ...purpose, purpose: 'mastered' }, { ...purpose, revision: 0 }, { ...purpose, answer: 1 },
    { ...purpose, updatedAt: '2026-02-30T00:00:00.000Z' }, { ...purpose, recordId: 'https://private.example' }]) {
    assert.throws(() => flow.validatePurpose(input));
  }
  assert.throws(() => flow.purposeOf(r.id, [purpose, purpose]), /重复/);
});

test('worked examples are computed from actual signed parameters and units, never a fixed video preset', () => {
  const p = original(); const pBefore = structuredClone(p); const t = original('right-triangle');
  const lesson = flow.lessonFor(p);
  assert.equal(lesson.id, 'parabola-translation'); assert.equal(lesson.steps.length, 4);
  assert.match(lesson.steps[0].text, /k=1/); assert.match(lesson.steps[2].text, /\(-3,1\)/);
  assert.match(lesson.steps[3].text, /\(-1,1\)/);
  assert.match(flow.lessonFor(t).steps[2].text, /5\.000000cm/);
  const metres = { ...t, snapshot: { AB: 6, AC: 8, unit: 'm' } };
  assert.match(flow.lessonFor(metres).steps[2].text, /10\.000000m/);
  lesson.steps[0].text = 'changed'; assert.deepEqual(p, pBefore);
});

test('all twenty recipes have deterministic pure views and correct programme mathematics across both lessons', () => {
  for (const record of [original(), original('right-triangle')]) {
    const before = structuredClone(record); const lesson = flow.lessonFor(record);
    const cases = [[lesson.completionKind, 'completion'], ...lesson.practiceKinds.map((kind) => [kind, 'practice']),
      ...lesson.delayedKinds.map((kind) => [kind, 'delayed'])];
    for (const [kind, stage] of cases) for (let index = 1; index <= 20; index++) {
      const ex = exerciseFor(record, kind, stage, index); const view = flow.exerciseView(ex, record);
      assert.deepEqual(flow.exerciseView(ex, record), view);
      assert.equal(view.hints.length, 3); assert.equal(flow.judgeExercise(ex, record, view.answer).correct, true);
      assert.match(view.sourceLabel, /程序.*非原视频识别/);
      assert.doesNotMatch(JSON.stringify(view), /NaN|Infinity|undefined/);
      if (view.input.type === 'choice') {
        assert.equal(new Set(view.options.map((option) => option.label)).size, view.options.length);
        const wrong = view.options.find((option) => option.value !== view.answer).value;
        assert.equal(flow.judgeExercise(ex, record, wrong).correct, false);
      }
    }
    assert.deepEqual(record, before);
  }
});

test('independent representation questions distinguish formula signs, missing right angles, and one-side scaling', () => {
  const p = original(); const ex = exerciseFor(p, 'parabola-equation'); const view = flow.exerciseView(ex, p);
  assert.equal(view.input.type, 'choice'); assert.equal(flow.judgeExercise(ex, p, 'horizontal-sign').correct, false);
  const t = original('right-triangle');
  const withoutAngle = exerciseFor(t, 'triangle-applicability', 'practice', 1);
  const withAngle = exerciseFor(t, 'triangle-applicability', 'practice', 2);
  assert.equal(flow.exerciseView(withoutAngle, t).answer, 'not-guaranteed');
  assert.equal(flow.exerciseView(withAngle, t).answer, 'apply');
  assert.equal(flow.exerciseView(exerciseFor(t, 'triangle-scaling', 'practice', 1), t).answer, 'not-double');
  assert.equal(flow.exerciseView(exerciseFor(t, 'triangle-scaling', 'practice', 2), t).answer, 'double');
  const delayed = exerciseFor(p, 'parabola-vertex', 'delayed');
  const immediate = exerciseFor(p, 'parabola-vertex');
  assert.notDeepEqual(flow.exerciseView(delayed, p).answer, flow.exerciseView(immediate, p).answer);
  assert.notEqual(delayed.id, immediate.id);
});

test('help only accumulates for its exact exercise and generation; prediction and notes have no submission stage', () => {
  const r = original(); const ex = exerciseFor(r, 'parabola-vertex'); const initial = contextFor(ex);
  const hinted = flow.markHelp(initial, { type: 'hint', level: 3 });
  const lower = flow.markHelp(hinted, { type: 'hint', level: 1 });
  assert.equal(lower.hintsShown, 3); assert.equal(initial.hintsShown, 0);
  const viewed = flow.markHelp(lower, { type: 'answer' });
  assert.equal(flow.markHelp(viewed, { type: 'example' }).answerShown, true);
  assert.throws(() => flow.validateContext(hinted, { ...ex, id: 'another-exercise' }), /上下文/);
  assert.throws(() => flow.markHelp(hinted, { type: 'hint', level: 0 }));
  for (const stage of ['prediction', 'example', 'reflection', 'skipped']) {
    assert.throws(() => exerciseFor(r, 'parabola-vertex', stage));
  }
});

test('receipts rejudge answers and locked assistance, reject false independent claims and unrelated sources', () => {
  const r = original(); const ex = exerciseFor(r, 'parabola-vertex'); const context = contextFor(ex);
  const answer = flow.exerciseView(ex, r).answer;
  const independent = flow.submitExercise(r, ex, context, { id: 'submission-1', answer, createdAt: LATER });
  assert.equal(independent.outcome, 'correct_independent');
  assert.deepEqual(flow.validateReceipt(independent, r, ex, context), independent);
  const assisted = flow.markHelp(context, { type: 'example' });
  const receipt = flow.submitExercise(r, ex, assisted, { id: 'submission-2', answer, createdAt: LATER });
  assert.equal(receipt.outcome, 'correct_with_hint');
  for (const fake of [{ ...receipt, correct: false }, { ...receipt, hintUsed: false, outcome: 'correct_independent' },
    { ...receipt, answer: { h: answer.h + 1, k: answer.k } }, { ...receipt, recordId: 'unrelated' },
    { ...receipt, createdAt: '2026-10-06T00:00:00.000Z' }, { ...receipt, generation: 2 }]) {
    assert.throws(() => flow.validateReceipt(fake, r, ex, assisted));
  }
  assert.throws(() => flow.submitExercise(r, ex, context, { answer: { h: answer.h, k: NaN } }));
  assert.throws(() => flow.submitExercise(r, ex, context, { answer: { ...answer, extra: 1 } }));
  const choice = exerciseFor(r, 'parabola-equation');
  assert.throws(() => flow.judgeExercise(choice, r, 'not-a-current-choice'));
});

test('completion has its own receipt but does not increase complete independent evidence or review streaks', () => {
  const r = original(); const ex = exerciseFor(r, 'parabola-completion', 'completion'); const context = contextFor(ex);
  const receipt = flow.submitExercise(r, ex, context, { id: 'completion-event', answer: flow.exerciseView(ex, r).answer, createdAt: LATER });
  const data = { ...flow.emptyFlow(), purposes: [flow.createPurpose(r.id, 'practice', { updatedAt: TIME })], exercises: [ex], contexts: [context], receipts: [receipt] };
  const plan = flow.reviewPlan({ record: r, flow: data, now: LATER });
  assert.equal(plan.evidenceCount, 0); assert.equal(plan.days, null); assert.equal(plan.independentStreak, 0);
  assert.deepEqual(flow.causeCandidates(r, { ...receipt, correct: false, outcome: 'wrong', answer: 99 }, ex), []);
});

test('new exercise receipt drives the same product schedule without altering the original record or old attempt shape', () => {
  const r = original('right-triangle'); const before = structuredClone(r); const ex = exerciseFor(r, 'triangle-applicability');
  const context = contextFor(ex); const receipt = flow.submitExercise(r, ex, context, { id: 'new-event', answer: 'not-guaranteed', createdAt: LATER });
  const data = { ...flow.emptyFlow(), purposes: [flow.createPurpose(r.id, 'practice', { updatedAt: TIME })], exercises: [ex], contexts: [context], receipts: [receipt] };
  const plan = flow.reviewPlan({ record: r, flow: data, now: '2026-10-14T00:00:01.000Z' });
  assert.equal(plan.days, 7); assert.equal(plan.evidenceCount, 1); assert.equal(plan.due, true);
  assert.deepEqual(r, before); assert.equal('exerciseId' in receiptFor(r), false);
  const fake = { ...receipt, correct: false };
  assert.equal(flow.reviewPlan({ record: r, flow: { ...data, receipts: [fake] }, now: LATER }).evidenceCount, 0);
  assert.equal(flow.reviewPlan({ record: r, flow: { ...data, receipts: [receipt, { ...receipt, id: 'second-submission' }] }, now: LATER }).evidenceCount, 0);
});

test('finite cause candidates need a real mathematically wrong receipt and never choose a diagnosis automatically', () => {
  const r = original(); const correct = receiptFor(r); assert.deepEqual(flow.causeCandidates(r, correct), []);
  assert.deepEqual(flow.causeCandidates(r, { ...correct, correct: false, outcome: 'wrong' }), []);
  const wrong = receiptFor(r, { h: 3, k: 1 }); const candidates = flow.causeCandidates(r, wrong);
  assert.equal(candidates.length, 3); assert.ok(candidates.every((entry) => !('confirmed' in entry)));
  const chosen = flow.reviewExercise(r, { confirmedCause: 'coordinate-sign', id: 'cause-exercise', createdAt: TIME });
  assert.equal(chosen.kind, 'parabola-equation');
  assert.equal(flow.reviewExercise(r, { id: 'general-exercise', createdAt: TIME }).kind, 'parabola-vertex');
  assert.throws(() => flow.reviewExercise(r, { confirmedCause: 'one-side-scale' }), /已确认/);
  assert.throws(() => flow.reviewExercise(r, { confirmedCause: 'AI-diagnosis' }));
});

test('legacy APIs use the same-record judged history and stable event IDs for 1/3/7/14/28-day suggestions', () => {
  const r = original(); const other = { ...r, id: 'other-record' };
  const histories = [receiptFor(r, { h: 4, k: 1 }, { id: 'a' }), receiptFor(r, undefined, { id: 'a', hintUsed: true }),
    ...[1, 2, 3].map((count) => Array.from({ length: count }, (_, i) => receiptFor(r, undefined, { id: `event-${i}`, createdAt: new Date(Date.parse(TIME) + i * 1000).toISOString() })))];
  for (const [i, input] of histories.entries()) {
    const history = Array.isArray(input) ? input : [input]; const expectedDays = [1, 3, 7, 14, 28][i];
    const plan = math.historyPlan(r, history, [r, other]);
    assert.equal(plan.days, expectedDays);
    assert.equal(Date.parse(records.nextReview(history, r.id, [r])) - Date.parse(plan.lastAttemptAt), expectedDays * 86400000);
    assert.equal(records.nextReview(history, r.id), records.nextReview(history, r.id, [r]));
  }
  assert.equal(math.historyPlan(r, [receiptFor(other)], [r, other]).days, null);
  const fake = { ...receiptFor(r), answer: { h: 99, k: 1 } };
  assert.equal(records.nextReview([fake], r.id, [r]), null); assert.equal(math.historyPlan(r, [fake]).days, null);
  const simultaneous = [receiptFor(r, undefined, { id: 'a' }), receiptFor(r, { h: 99, k: 1 }, { id: 'z' })];
  assert.deepEqual(math.historyPlan(r, simultaneous), math.historyPlan(r, simultaneous.slice().reverse()));
  assert.equal(math.historyPlan(r, simultaneous).days, 1);
  assert.equal(records.learningState(r, simultaneous), '需要复练');
  assert.equal(records.learningState(r, [fake]), '待验证');
  assert.equal(math.historyPlan(r, [simultaneous[0], simultaneous[0]]).days, null);
});

test('queue excludes unclassified/reflection/pending/invalid math, respects edits and skip, and returns true emptiness', () => {
  const r = original(); const reflection = { ...r, id: 'reflection' }; const pending = { ...r, id: 'pending', source: { ...r.source, materialMode: 'permission-pending' } };
  const broken = { ...r, id: 'broken', snapshot: { a: 0, h: 1, k: 1 } }; const old = { ...r, id: 'unclassified' };
  const purposes = [r, reflection, pending, broken].map((item) => flow.createPurpose(item.id, item.id === 'reflection' ? 'reflection' : 'practice', { updatedAt: TIME }));
  const data = { records: [old, reflection, pending, broken, r], attempts: [receiptFor(r)], flow: { ...flow.emptyFlow(), purposes } };
  const now = '2026-10-15T00:00:00.000Z';
  assert.deepEqual(flow.buildQueue(data, { now, mode: 'due' }).map((item) => item.recordId), [r.id]);
  const skipped = { recordId: r.id, reviewAt: null, skippedUntil: '2026-10-20T00:00:00.000Z', revision: 1, updatedAt: TIME };
  const modified = { ...data, flow: { ...data.flow, reviews: [skipped] } };
  assert.deepEqual(flow.buildQueue(modified, { now, mode: 'due' }), []);
  assert.equal(flow.buildQueue(modified, { now, mode: 'manual' }).length, 1);
  const changed = { ...skipped, reviewAt: '2026-10-30T00:00:00.000Z', skippedUntil: null };
  const plan = flow.reviewPlan({ record: r, attempts: data.attempts, flow: { ...data.flow, reviews: [changed] }, now });
  assert.equal(plan.days, 7); assert.equal(plan.defaultReviewAt, '2026-10-14T00:00:00.000Z'); assert.equal(plan.due, false);
  assert.equal(plan.reviewAt, changed.reviewAt); assert.match(plan.reason, /学生修改/);
  assert.throws(() => flow.validateReview({ ...changed, reviewAt: 'tomorrow' }));
});

test('foundation and interleaved queues are explicit deterministic arrangements, without mastery or attempts', () => {
  const p = original(); const q = { ...p, id: 'parabola-second' }; const t = original('right-triangle');
  const base = { ...flow.emptyFlow(), purposes: [p, q, t].map((r) => flow.createPurpose(r.id, 'practice', { updatedAt: TIME })) };
  const data = { records: [q, p, t], attempts: [receiptFor(p, undefined, { id: 'p' }), receiptFor(t, undefined, { id: 't' })], flow: base };
  assert.deepEqual(flow.buildQueue(data, { now: TIME, mode: 'foundation' }).map((item) => item.recordId), [q.id]);
  const mixed = flow.buildQueue(data, { now: TIME, mode: 'interleaved' });
  assert.deepEqual(mixed.map((item) => item.record.template), ['parabola', 'right-triangle']);
  assert.doesNotMatch(JSON.stringify(mixed), /mastery|掌握率|percentage|掌握百分比/);
  assert.equal(data.attempts.length, 2); assert.deepEqual(base.receipts, []);
  assert.deepEqual(flow.buildQueue({ ...data, records: data.records.slice().reverse(), attempts: data.attempts.slice().reverse() }, { now: TIME, mode: 'interleaved' }), mixed);
});

test('strict pure validators reject extra keys, cross-lesson stages, reused IDs, getters and nonfinite values', () => {
  const r = original(); const ex = exerciseFor(r, 'parabola-vertex');
  for (const value of [{ ...ex, id: r.id }, { ...ex, recordId: 'orphan' }, { ...ex, stage: 'completion' },
    { ...ex, index: 0 }, { ...ex, index: 21 }, { ...ex, index: 1.5 }, { ...ex, lessonId: 'triangle-conditions' },
    { ...ex, kind: 'triangle-hypotenuse' }, { ...ex, rawFrame: 'private' }]) assert.throws(() => flow.validateExercise(value, r));
  let calls = 0; const hostile = { type: 'hint', level: 1 };
  Object.defineProperty(hostile, 'type', { get() { calls++; return 'hint'; }, enumerable: true });
  assert.throws(() => flow.markHelp(contextFor(ex), hostile)); assert.equal(calls, 0);
  const recordGetter = { ...r }; Object.defineProperty(recordGetter, 'title', { get() { calls++; return 'private'; }, enumerable: true });
  assert.throws(() => flow.lessonFor(recordGetter)); assert.equal(calls, 0);
  assert.throws(() => flow.lessonFor({ ...r, snapshot: { a: 1e-10, h: 0, k: 0 } }));
  assert.throws(() => flow.buildQueue({}, { now: 'not-UTC', mode: 'manual' }));
});

test('UMD browser module needs no DOM or network and matches CommonJS values', () => {
  const sandbox = { crypto: { randomUUID: () => 'browser-id' }, Date };
  vm.createContext(sandbox);
  for (const file of ['../extension/src/curve/evaluate', '../extension/src/geometry-scene/validate', '../extension/src/plugin/math-learning',
    '../extension/src/plugin/contracts', '../learning-site/records', '../learning-site/learning-flow']) {
    vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), sandbox);
  }
  sandbox.recordJSON = JSON.stringify(original()); sandbox.exerciseJSON = JSON.stringify(exerciseFor(original(), 'parabola-equation'));
  const browser = vm.runInContext('JSON.stringify(BreakGlass.learningFlow.exerciseView(JSON.parse(exerciseJSON), JSON.parse(recordJSON)))', sandbox);
  assert.deepEqual(JSON.parse(browser), flow.exerciseView(JSON.parse(sandbox.exerciseJSON), original()));
  assert.equal(vm.runInContext('BreakGlass.learningFlow.purposeOf("old", [])', sandbox), 'unclassified');
});
