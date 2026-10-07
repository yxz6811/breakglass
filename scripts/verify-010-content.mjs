// Offline audit fixtures only: no UI, network, account writes or generated code execution.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const records = require('../learning-site/records.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const contentPath = 'specs/010-evidence-guided-learning/quality/lessons.json';
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
function check(condition, message) { if (!condition) throw new Error(message); }
function near(a, b, abs = 1e-9, rel = 0) {
  return finite(a) && finite(b) && Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
}
function sameFields(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function parabola(s) {
  check(sameFields(s, ['a', 'h', 'k']) && records.validSnapshot('parabola', s), 'invalid parabola conditions');
  return s;
}
function triangle(s, right = true) {
  check(s && finite(s.AB) && s.AB > 0 && finite(s.AC) && s.AC > 0
    && finite(s.angleA) && s.angleA > 0 && s.angleA < 180, 'invalid triangle conditions');
  if (right) check(s.angleA === 90, 'right angle must be explicitly 90 degrees');
  const bc = Math.sqrt(s.AB ** 2 + s.AC ** 2 - 2 * s.AB * s.AC * Math.cos(s.angleA * Math.PI / 180));
  check(finite(bc) && bc > 0, 'triangle result is not finite and positive');
  if (s.BC !== null && s.BC !== undefined) check(near(s.BC, bc, 1e-9, 1e-6), 'provided BC contradicts conditions');
  return right ? Math.hypot(s.AB, s.AC) : bc;
}
function similarPair(math) {
  const a = math.original, b = math.changed;
  triangle(a); const bc = triangle(b);
  check(a.unit === b.unit && ['cm', 'm', 'unit'].includes(a.unit), 'mixed or invalid units');
  const r1 = b.AB / a.AB, r2 = b.AC / a.AC;
  check(finite(r1) && r1 > 0 && finite(r2) && r2 > 0, 'invalid positive side ratios');
  const similar = near(r1, r2, 0, 1e-9);
  return { similar, AB: b.AB, AC: b.AC, BC: bc, scale: similar ? r1 : null };
}
function expressionNumber(text) {
  check(typeof text === 'string' && text.length <= 80, 'invalid exact expression');
  const sqrt = /^sqrt\((\d+(?:\.\d+)?)\)$/.exec(text);
  const square = /^(-?\d+(?:\.\d+)?)\^2$/.exec(text);
  const numeric = /^-?\d+(?:\.\d+)?$/.test(text);
  const result = sqrt ? Math.sqrt(Number(sqrt[1])) : square ? Number(square[1]) ** 2 : numeric ? Number(text) : NaN;
  check(finite(result), 'unsupported exact expression; never evaluated as code');
  return result;
}
export function deriveAnswer(item) {
  const m = item.math;
  check(m && typeof m === 'object', 'missing mathematical conditions');
  switch (item.exerciseKind) {
    case 'vertex': {
      const s = parabola(item.snapshot);
      check(['vertex', 'expanded'].includes(m.representation), 'unknown vertex representation');
      if (m.representation === 'expanded') check(sameFields(m.coefficients, ['a', 'b', 'c']), 'expanded representation requires original coefficients');
      if (m.coefficients) {
        check(m.representation === 'expanded', 'coefficients require expanded representation');
        const { a, b, c } = m.coefficients;
        check([a, b, c].every(finite) && a !== 0, 'invalid expanded coefficients');
        const h = -b / (2 * a), k = c - b * b / (4 * a);
        check(near(a, s.a) && near(h, s.h) && near(k, s.k), 'expanded representation differs from snapshot');
        return { h, k };
      }
      if (m.translation) {
        const o = parabola(m.original), d = m.translation;
        check(finite(d.x) && finite(d.y) && near(s.a, o.a)
          && near(s.h, o.h + d.x) && near(s.k, o.k + d.y), 'incorrect translation conditions');
      }
      if (m.changedParameter) {
        const o = parabola(m.original);
        check(['a', 'h', 'k'].includes(m.changedParameter), 'unknown changed parameter');
        for (const p of ['a', 'h', 'k']) if (p !== m.changedParameter) check(s[p] === o[p], 'fixed parameter changed');
      }
      return { h: s.h, k: s.k };
    }
    case 'coefficient-conversion': {
      const { a, h, k } = parabola(item.snapshot);
      return { a, b: -2 * a * h, c: a * h * h + k };
    }
    case 'numeric': {
      if (m.quantity === 'hypotenuse') {
        const s = item.snapshot;
        check(records.validSnapshot('right-triangle', s), 'invalid triangle snapshot');
        check(m.conditions.AB === s.AB && m.conditions.AC === s.AC, 'snapshot differs from angle conditions');
        check(['cm', 'm', 'unit'].includes(s.unit), 'invalid unit');
        const value = triangle(m.conditions);
        if (m.scaffoldSquareSum !== undefined) check(near(m.scaffoldSquareSum, value ** 2), 'incorrect scaffold square sum');
        if (m.changedParameter) {
          triangle(m.original);
          check(['AB', 'AC'].includes(m.changedParameter), 'unknown changed side');
          const other = m.changedParameter === 'AB' ? 'AC' : 'AB';
          check(m.conditions[other] === m.original[other], 'fixed side changed');
        }
        return { value };
      }
      if (m.quantity === 'area-ratio') {
        const pair = similarPair(m);
        check(pair.similar && near(pair.scale, m.scale, 0, 1e-9), 'area ratio requires verified uniform scale');
        check(item.snapshot.AB === m.changed.AB && item.snapshot.AC === m.changed.AC
          && item.snapshot.unit === m.changed.unit, 'area snapshot differs from changed triangle');
        return { value: (m.changed.AB * m.changed.AC / 2) / (m.original.AB * m.original.AC / 2) };
      }
      if (m.quantity === 'restricted-minimum') {
        const s = parabola(item.snapshot), d = m.domain;
        check(d && finite(d.min) && finite(d.max) && d.min <= d.max, 'invalid restricted domain');
        const xs = [d.min, d.max];
        if (s.h >= d.min && s.h <= d.max) xs.push(s.h);
        return { value: Math.min(...xs.map((x) => s.a * (x - s.h) ** 2 + s.k)) };
      }
      throw new Error('unknown numeric quantity');
    }
    case 'condition-choice': {
      triangle(m.conditions, false);
      check(m.rightAngleRequired === 90 && Array.isArray(m.options)
        && m.options.length === 2 && m.options.includes('can-use-pythagoras')
        && m.options.includes('cannot-use-pythagoras'), 'unfrozen condition options');
      if (m.referenceCalculation) {
        const r = m.referenceCalculation, bc = triangle(m.conditions, false);
        check(r.method === 'cosine-rule' && r.angleUnit === 'degree', 'invalid reference calculation');
        check(near(r.squareLength, bc ** 2) && near(expressionNumber(r.exactExpression), bc), 'incorrect nonright reference');
      }
      return { value: m.conditions.angleA === 90 ? 'can-use-pythagoras' : 'cannot-use-pythagoras' };
    }
    case 'similarity-comparison': {
      const result = similarPair(m);
      check(item.snapshot.AB === result.AB && item.snapshot.AC === result.AC
        && item.snapshot.unit === m.changed.unit, 'similarity snapshot differs from conditions');
      return result;
    }
    default: throw new Error('unknown exercise kind');
  }
}
function matches(actual, expected, judge) {
  if (!actual || !sameFields(actual, Object.keys(expected))) return false;
  return Object.entries(expected).every(([key, value]) => typeof value === 'number'
    ? near(actual[key], value, judge.absTolerance, judge.relTolerance) : actual[key] === value);
}
function normalizedCandidate(item, answer) {
  return item.exerciseKind === 'numeric' || item.exerciseKind === 'condition-choice' ? { value: answer } : answer;
}
export function verifyContent(bundle, { repositoryRoot = root } = {}) {
  check(bundle?.schemaVersion === 1 && bundle.contentVersion === '010.1.0', 'unknown content version');
  check(bundle.baselineCommit === 'e6aceb3e486bcf08ade7b0cd1939c6535a19f190', 'unknown source baseline');
  check(bundle.status?.teacherReview === 'pending-external' && bundle.status?.studentValidation === 'not-run', 'external evidence cannot be asserted by fixtures');
  check(['pending-script', 'passed-offline-check'].includes(bundle.status.mathematicalCheck), 'unknown mathematical check status');
  check(Array.isArray(bundle.sources) && bundle.sources.length === 4, 'expected four explicit sources');
  check(Array.isArray(bundle.lessons) && bundle.lessons.length === 2, 'expected two micro-lessons');
  const sourceMap = new Map(), ids = new Set(), answers = [];
  function claim(id) { check(typeof id === 'string' && /^[a-z0-9-]{1,128}$/.test(id) && !ids.has(id), 'invalid or duplicate identity'); ids.add(id); }
  const mediaBindings = {
    'media-parabola-k1': { path: 'extension/assets/video/breakglass-demo-9s.mp4', time: 6 },
    'media-triangle-3-4-5': { path: 'extension/assets/video/geometry/triangle-3-4-5.mp4', time: 4 }
  };
  for (const s of bundle.sources) {
    claim(s.id); sourceMap.set(s.id, s);
    check(['self-authored-media', 'manual-authored'].includes(s.kind), 'unknown source kind');
    if (s.kind === 'self-authored-media') {
      const binding = mediaBindings[s.id];
      check(binding && s.path === binding.path && s.timeSeconds === binding.time
        && /^[a-f0-9]{64}$/.test(s.sha256), 'media identity/path/time binding differs');
      check(createHash('sha256').update(fs.readFileSync(path.join(repositoryRoot, s.path))).digest('hex') === s.sha256, 'media fingerprint changed');
    } else check(s.path === null && s.sha256 === null && s.timeSeconds === null, 'manual source must not impersonate media');
    check(Array.isArray(s.rightsEvidence) && s.rightsEvidence.length > 0, 'missing source evidence');
    for (const p of s.rightsEvidence) {
      check(typeof p === 'string' && !p.includes('..') && !path.isAbsolute(p) && !p.includes('\\'), 'invalid evidence path');
      check(fs.existsSync(path.join(repositoryRoot, p)), 'missing repository evidence');
    }
  }
  const preset = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'extension/assets/presets/demo-parabola.json'), 'utf8'));
  const mediaParabola = sourceMap.get('media-parabola-k1');
  check(sameFields(mediaParabola?.snapshot, ['a', 'h', 'k']), 'invalid media parabola snapshot');
  for (const p of ['a', 'h', 'k']) check(mediaParabola?.snapshot[p] === preset.definition.parameters[p].initial, 'video condition differs from registered preset');
  const mediaTriangle = sourceMap.get('media-triangle-3-4-5');
  check(mediaTriangle && JSON.stringify(mediaTriangle.snapshot) === JSON.stringify({ angleA: 90, AB: 3, AC: 4, BC: 5, unit: 'cm' }), 'geometry media condition differs from registered fixture');
  for (const lesson of bundle.lessons) {
    claim(lesson.id);
    check(['parabola', 'right-triangle'].includes(lesson.template) && sourceMap.has(lesson.sourceId), 'invalid lesson source/template');
    const origin = sourceMap.get(lesson.sourceId);
    check(JSON.stringify(lesson.sourceSnapshot) === JSON.stringify(origin.snapshot), 'lesson original differs from media source');
    if (lesson.template === 'parabola') {
      parabola(lesson.sourceSnapshot);
      check(lesson.manualBaseline && sourceMap.get(lesson.manualBaseline.sourceId)?.kind === 'manual-authored', 'missing explicit manual exploration');
      check(JSON.stringify(lesson.manualBaseline.snapshot) === JSON.stringify(sourceMap.get(lesson.manualBaseline.sourceId).snapshot), 'manual exploration source mismatch');
    } else triangle(lesson.sourceSnapshot);
    const stageMap = new Map(lesson.stages.map((s) => [s.id, s]));
    for (const type of ['prediction', 'example', 'completion', 'practice', 'delayed-transfer']) check(lesson.stages.some((s) => s.stage === type), 'missing required teaching stage');
    check(lesson.counterexamples.length >= 2 && lesson.teacherChecklist.length >= 4 && lesson.failureFeedback.length >= 4, 'missing review content');
    for (const item of [...lesson.stages, ...lesson.counterexamples]) {
      try {
        claim(item.id);
        check(sourceMap.has(item.sourceId), 'unknown exercise source');
        check(typeof item.prompt === 'string' && item.prompt.length > 10, 'missing concrete prompt');
        check(item.judge?.kind === item.exerciseKind, 'judge kind differs from exercise');
        const choice = item.exerciseKind === 'condition-choice';
        check(item.judge.absTolerance === (choice ? 0 : 1e-9)
          && item.judge.relTolerance === (['numeric', 'similarity-comparison'].includes(item.exerciseKind)
            && item.math.quantity !== 'restricted-minimum' ? 1e-6 : 0), 'tolerance differs from frozen audit rule');
        const answer = deriveAnswer(item);
        const expected = item.exerciseKind === 'numeric' ? { value: item.expected.value } : item.expected;
        check(matches(answer, expected, { absTolerance: 1e-9, relTolerance: 1e-12 }), 'incorrect expected answer');
        if (item.exerciseKind === 'numeric') {
          check(near(expressionNumber(item.expected.exactExpression), answer.value, 1e-9, 1e-12), 'exact expression differs from answer');
          check(Number.isSafeInteger(item.expected.displayDecimals) && item.expected.displayDecimals >= 0 && item.expected.displayDecimals <= 8, 'invalid display precision');
        }
        if (item.math.equation) {
          const match = /^y=(-?\d+(?:\.\d+)?)\(x([+-])\d+(?:\.\d+)?\)\^2([+-]\d+(?:\.\d+)?)$/.exec(item.math.equation);
          check(match, 'unsupported equation audit notation');
          const hText = /\(x([+-]\d+(?:\.\d+)?)\)/.exec(item.math.equation)[1];
          check(near(Number(match[1]), item.snapshot.a) && near(-Number(hText), item.snapshot.h)
            && near(Number(match[3]), item.snapshot.k), 'equation text differs from parameters');
        }
        const intendedEvidence = !item.stage || ['prediction', 'example'].includes(item.stage) ? 'not-attempt'
          : item.stage === 'completion' ? 'completion-assisted' : 'eligible-actual-submission';
        check(item.evidence === intendedEvidence, 'learning evidence category is incorrect');
        if (item.stage === 'delayed-transfer') check(item.delayDays === 7, 'delayed suggestion not frozen');
        for (const forbidden of ['attemptId', 'receipt', 'correct', 'createdAt', 'hintUsed']) check(!Object.hasOwn(item, forbidden), 'fixture must not assert historical submission');
        if (sourceMap.get(item.sourceId).kind === 'self-authored-media') {
          check(item.sourceId === lesson.sourceId, 'exercise media source belongs to a different lesson');
          if (item.snapshot) {
            const keys = lesson.template === 'parabola' ? ['a', 'h', 'k'] : ['AB', 'AC', 'unit'];
            const actualSource = sourceMap.get(item.sourceId);
            check(keys.every((key) => item.snapshot[key] === actualSource.snapshot[key]), 'changed exercise cannot impersonate original media');
          }
        }
        if (item.math.claimedAnswer !== undefined) check(!matches(normalizedCandidate(item, item.math.claimedAnswer), answer, item.judge), 'counterexample claim is actually correct');
        answers.push({ id: item.id, kind: item.exerciseKind, derivedAnswer: answer, evidence: item.evidence });
      } catch (error) { throw new Error(`${item.id}: ${error.message}`, { cause: error }); }
    }
    for (const cause of lesson.misconceptionCandidates) {
      claim(cause.id);
      const trigger = stageMap.get(cause.answerTrigger?.stageId), next = stageMap.get(cause.practiceStageId);
      check(trigger && next && trigger.id !== next.id, 'misconception must link to a different exercise');
      check(['practice', 'delayed-transfer'].includes(next.stage), 'misconception followup is not actual practice');
      check(typeof cause.confirmationPrompt === 'string' && /确认|修改|待确认/.test(cause.confirmationPrompt), 'cause requires student confirmation');
      check(!matches(normalizedCandidate(trigger, cause.answerTrigger.answer), deriveAnswer(trigger), trigger.judge), 'correct answer cannot trigger an error cause');
    }
  }
  return { ok: true, contentVersion: bundle.contentVersion, baselineCommit: bundle.baselineCommit,
    sourceCount: bundle.sources.length, lessonCount: bundle.lessons.length,
    stageCount: bundle.lessons.reduce((n, l) => n + l.stages.length, 0),
    counterexampleCount: bundle.lessons.reduce((n, l) => n + l.counterexamples.length, 0),
    misconceptionCount: bundle.lessons.reduce((n, l) => n + l.misconceptionCandidates.length, 0), answers,
    teacherReview: bundle.status.teacherReview, studentValidation: bundle.status.studentValidation };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = verifyContent(JSON.parse(fs.readFileSync(path.join(root, contentPath), 'utf8')));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
