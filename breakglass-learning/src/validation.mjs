import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rules = require('../../extension/src/plugin/contracts.js');
const annotations = require('../../learning-site/annotations.js');
const mathLearning = require('../../learning-site/math-learning.js');
const flowStore = require('../../learning-site/learning-flow-store.js');
export const provenanceRules = require('../../learning-site/provenance.js');
export function provenanceList(value, records) {
  try {
    if (!Array.isArray(value) || value.length > 500 || new Set(value.map(v => v.recordId)).size !== value.length) return null;
    return value.map(v => provenanceRules.validate(v, records.find(r => r.id === v.recordId)));
  } catch { return null; }
}

export const emptyFlow = flowStore.emptyFlow;
export const pruneFlow = flowStore.pruneFlow;
export function learningFlow(value, records) { try { return flowStore.validateFlow(value, records); } catch { return null; } }

export function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export const finite = (value) => typeof value === 'number' && Number.isFinite(value);
export const safeId = (value) => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  && !/^(?:https?|data|blob|file|chrome-extension):/i.test(value);
export const epoch = (value) => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const iso = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function username(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const canonical = value.normalize('NFKC').toLowerCase();
  return /^[\p{L}\p{N}._-]{3,32}$/u.test(canonical) ? canonical : null;
}
export function password(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128
    && Buffer.byteLength(value) <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function record(value) {
  if (!value || !safeId(value.id) || !safeId(value.source?.id)) return null;
  const checked = rules.validateRecord(value, { source: value.source, duration: 600 });
  return checked.ok ? checked.value : null;
}

export function annotationMetadata(value) {
  try { return annotations.validateMetadata(value); } catch { return null; }
}
export function annotation(value) {
  try { return annotations.validateAnnotation(value); } catch { return null; }
}
export const sameAnnotationMetadata = annotations.sameMetadata;

export function watch(value) {
  if (!exact(value, ['source', 'time', 'duration', 'updatedAt']) || !finite(value.time) || value.time < 0
    || !finite(value.duration) || value.duration <= 0 || value.duration > 600 || value.time > value.duration || !iso(value.updatedAt)) return null;
  const checked = rules.validateSource(value.source);
  // Watching metadata is the student's own progress, not permission to analyze media.
  // Record/vision gates remain independent and still reject pending material.
  if (!checked.ok || !safeId(checked.value.id)) return null;
  return { source: checked.value, time: value.time, duration: value.duration, updatedAt: value.updatedAt };
}

export function judge(template, snapshot, answer) {
  if (mathLearning.isExtended(template)) return mathLearning.judge(template, snapshot, answer);
  if (template === 'right-triangle') {
    if (!finite(answer)) return null;
    const expectedAnswer = Math.hypot(snapshot.AB, snapshot.AC);
    return { expectedAnswer, correct: Math.abs(answer - expectedAnswer) <= Math.max(1e-9, Math.abs(expectedAnswer) * 1e-6) };
  }
  if (template === 'parabola') {
    if (!exact(answer, ['h', 'k']) || !finite(answer.h) || !finite(answer.k)) return null;
    const expectedAnswer = { h: snapshot.h, k: snapshot.k };
    return { expectedAnswer, correct: Math.abs(answer.h - snapshot.h) <= 1e-9 && Math.abs(answer.k - snapshot.k) <= 1e-9 };
  }
  return null;
}

export function attempt(value, records) {
  if (!exact(value, ['id', 'recordId', 'answer', 'hintUsed', 'correct', 'outcome', 'createdAt'])
    || !safeId(value.id) || !safeId(value.recordId) || typeof value.hintUsed !== 'boolean'
    || typeof value.correct !== 'boolean' || !iso(value.createdAt)) return false;
  const original = records.find((item) => item.id === value.recordId);
  if (!original) return false;
  const verdict = judge(original.template, original.snapshot, value.answer);
  return verdict && verdict.correct === value.correct && value.outcome === (value.correct
    ? value.hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong');
}

function unique(values, key) { return new Set(values.map(key)).size === values.length; }
export function database(value) {
  if (!exact(value, ['schemaVersion', 'users']) || value.schemaVersion !== 1 || !Array.isArray(value.users)
    || value.users.length > 50 || !unique(value.users, (item) => item.id) || !unique(value.users, (item) => item.username)) return false;
  return value.users.every((user) => exact(user, ['id', 'username', 'passwordSalt', 'passwordHash', 'epoch', 'records', 'watch', 'attempts',
      ...(Object.hasOwn(user, 'annotations') ? ['annotations'] : []), ...(Object.hasOwn(user, 'flow') ? ['flow'] : []),
      ...(Object.hasOwn(user, 'provenance') ? ['provenance'] : [])])
    && safeId(user.id) && username(user.username) === user.username && epoch(user.epoch)
    && /^[a-f0-9]{32}$/.test(user.passwordSalt) && /^[a-f0-9]{128}$/.test(user.passwordHash)
    && Array.isArray(user.records) && user.records.length <= 500 && unique(user.records, (item) => item.id) && user.records.every(record)
    && Array.isArray(user.watch) && user.watch.length <= 100 && unique(user.watch, (item) => item.source.id) && user.watch.every(watch)
    && Array.isArray(user.attempts) && user.attempts.length <= 2000 && unique(user.attempts, (item) => item.id)
    && user.attempts.every((item) => attempt(item, user.records))
    && (!Object.hasOwn(user, 'annotations') || (Array.isArray(user.annotations) && user.annotations.length <= 500
      && unique(user.annotations, (item) => item.recordId) && user.annotations.every((item) => annotation(item)
        && user.records.some((original) => original.id === item.recordId))))
    && (!Object.hasOwn(user, 'flow') || Boolean(learningFlow(user.flow, user.records)))
    && (!Object.hasOwn(user, 'provenance') || Boolean(provenanceList(user.provenance, user.records))));
}
