(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.learningEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const recordsAPI = () => typeof require === 'function' ? require('./records') : root.BreakGlass.webRecords;
  const mathAPI = () => typeof require === 'function' ? require('./math-learning') : root.BreakGlass.mathLearning;
  const flowAPI = () => typeof require === 'function' ? require('./learning-flow') : root.BreakGlass.learningFlow;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const RECORD_FIELDS = ['id', 'kind', 'source', 'time', 'title', 'note', 'template', 'snapshot', 'origin', 'sourceLabel', 'createdAt'];
  const ATTEMPT_FIELDS = ['id', 'recordId', 'answer', 'hintUsed', 'correct', 'outcome', 'createdAt'];
  const FLOW_FIELDS = ['schemaVersion', 'purposes', 'exercises', 'contexts', 'receipts', 'reviews'];
  function plain(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  }
  function exact(value, keys) {
    if (!plain(value)) return false;
    const actual = Reflect.ownKeys(value);
    return actual.length === keys.length && actual.every((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.includes(key) && d.enumerable && own(d, 'value');
    });
  }
  // Read only data properties. Invalid getters are never executed, including
  // during duplicate counting, and an invalid sibling cannot hide a duplicate.
  function field(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d && own(d, 'value') ? d.value : undefined;
  }
  function pure(value, seen = new Set(), depth = 0) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (depth > 32 || typeof value !== 'object' || seen.has(value)
      || (!Array.isArray(value) && !plain(value))) return false;
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    let valid = true;
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !d.enumerable || !own(d, 'value')
        || (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key))
        || !pure(d.value, seen, depth + 1)) { valid = false; break; }
    }
    if (Array.isArray(value) && keys.length !== value.length + 1) valid = false;
    seen.delete(value);
    return valid;
  }
  function iso(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  }
  function project(data = {}, { scope = 'local', owner = 'guest', epoch = 0, now = new Date().toISOString() } = {}) {
    if (!['local', 'account'].includes(scope) || typeof owner !== 'string' || !owner || owner.length > 1024
      || !Number.isSafeInteger(epoch) || epoch < 0 || !iso(now) || !plain(data)) {
      throw new TypeError('学习证据需要明确的当前范围、身份、数据版本和UTC时间。');
    }
    // These envelopes are supplied by the current store/HTTP batch, never by
    // an individual receipt. A stale batch must not be relabelled as a new owner.
    for (const [key, expected] of Object.entries({ scope, owner, epoch })) {
      if (own(data, key) && field(data, key) !== expected) {
        throw new TypeError('学习证据范围或版本已改变，请重新读取当前数据。');
      }
    }
    const records = recordsAPI(), math = mathAPI(), flow = flowAPI();
    let invalidCount = 0;
    function list(container, key, limit) {
      const value = field(container, key);
      if (value === undefined && !own(container, key)) return [];
      if (!Array.isArray(value) || value.length > limit) {
        invalidCount += Array.isArray(value) ? value.length : 1;
        return [];
      }
      return value;
    }
    function uniqueRows(rows, keys, validate) {
      const counts = keys.map((key) => {
        const count = new Map();
        for (const row of rows) {
          const id = field(row, key);
          if (typeof id === 'string') count.set(id, (count.get(id) || 0) + 1);
        }
        return count;
      });
      const result = [];
      for (const row of rows) {
        try {
          if (!pure(row) || keys.some((key, i) => counts[i].get(field(row, key)) !== 1)) throw new TypeError('重复或非纯数据。');
          result.push(validate(row));
        } catch (_) { invalidCount += 1; }
      }
      return result;
    }
    const parents = uniqueRows(list(data, 'records', 500), ['id'], (row) => {
      if (!exact(row, RECORD_FIELDS)) throw new TypeError('原题字段无效。');
      return records.validateRecord(row);
    });
    const parentMap = new Map(parents.map((record) => [record.id, record]));
    const attempts = uniqueRows(list(data, 'attempts', 2000), ['id'], (row) => {
      const record = parentMap.get(row.recordId);
      if (!exact(row, ATTEMPT_FIELDS) || !record || !math.validReceipt(record, row)) throw new TypeError('旧作答凭据无效。');
      return clone(row);
    });
    let rawFlow = field(data, 'flow');
    if (rawFlow === undefined && !own(data, 'flow')) rawFlow = flow.emptyFlow();
    if (!exact(rawFlow, FLOW_FIELDS) || rawFlow.schemaVersion !== flow.SCHEMA_VERSION) {
      invalidCount += 1;
      rawFlow = flow.emptyFlow();
    }
    const cleanFlow = flow.emptyFlow();
    for (const [key, validator] of [['purposes', flow.validatePurpose], ['reviews', flow.validateReview]]) {
      cleanFlow[key] = uniqueRows(list(rawFlow, key, 500), ['recordId'], (row) => {
        const checked = validator(row);
        if (!parentMap.has(checked.recordId)) throw new TypeError('原题不存在。');
        return checked;
      });
    }
    cleanFlow.exercises = uniqueRows(list(rawFlow, 'exercises', 2000), ['id'], (row) => {
      const record = parentMap.get(row.recordId);
      if (!record) throw new TypeError('新题原题不存在。');
      return flow.validateExercise(row, record);
    });
    const exerciseMap = new Map(cleanFlow.exercises.map((exercise) => [exercise.id, exercise]));
    cleanFlow.contexts = uniqueRows(list(rawFlow, 'contexts', 2000), ['id', 'exerciseId'], (row) => {
      const exercise = exerciseMap.get(row.exerciseId);
      if (!exercise) throw new TypeError('帮助原题不存在。');
      return flow.validateContext(row, exercise);
    });
    const contextMap = new Map(cleanFlow.contexts.map((context) => [context.exerciseId, context]));
    cleanFlow.receipts = uniqueRows(list(rawFlow, 'receipts', 2000), ['id', 'exerciseId'], (row) => {
      const exercise = exerciseMap.get(row.exerciseId), context = contextMap.get(row.exerciseId);
      const record = parentMap.get(row.recordId);
      if (!exercise || !context || !record) throw new TypeError('作答关联不存在或不唯一。');
      return flow.validateReceipt(row, record, exercise, context);
    });
    const events = [
      ...attempts.map((a) => ({ key: `attempt:${a.id}`, sourceType: 'attempt', recordId: a.recordId,
        exerciseId: null, stage: 'legacy', createdAt: a.createdAt, correct: a.correct, hintUsed: a.hintUsed, outcome: a.outcome })),
      ...cleanFlow.receipts.map((r) => ({ key: `receipt:${r.id}`, sourceType: 'receipt', recordId: r.recordId,
        exerciseId: r.exerciseId, stage: exerciseMap.get(r.exerciseId).stage,
        createdAt: r.createdAt, correct: r.correct, hintUsed: r.hintUsed, outcome: r.outcome }))
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
    const wrong = new Set(events.filter((event) => !event.correct).map((event) => event.recordId));
    const full = events.filter((event) => event.stage !== 'completion');
    const summary = { independentCorrect: full.filter((event) => event.outcome === 'correct_independent').length,
      assistedCorrect: full.filter((event) => event.outcome === 'correct_with_hint').length,
      wrong: full.filter((event) => event.outcome === 'wrong').length,
      completion: events.length - full.length, delayed: full.filter((event) => event.stage === 'delayed').length,
      wrongRecords: wrong.size };
    // reviewSuggestion accepts IDs of at most 128 characters. Short private
    // aliases are indexed by full namespaced event key, so even maximum-length
    // original IDs and same-named legacy/new submissions remain distinct. The
    // cloned scheduling inputs stay in their original attempt/receipt slots.
    const aliases = new Map(events.map((event, index) => [event.key, `evidence-${String(index).padStart(6, '0')}`]));
    const scheduleFlow = { ...cleanFlow,
      receipts: cleanFlow.receipts.map((r) => ({ ...r, id: aliases.get(`receipt:${r.id}`) })) };
    const scheduleData = { records: parents,
      attempts: attempts.map((a) => ({ ...a, id: aliases.get(`attempt:${a.id}`) })), flow: scheduleFlow };
    const projectedRecords = parents.map((record) => {
      const plan = flow.reviewPlan({ record, records: parents, attempts: scheduleData.attempts, flow: scheduleFlow, now });
      const state = !plan.latestOutcome ? '待验证' : plan.latestOutcome === 'wrong' ? '需要复练'
        : plan.latestOutcome === 'correct_with_hint' ? '使用提示完成' : '最近一次独立正确';
      return { recordId: record.id, state, hasWrong: wrong.has(record.id), plan };
    });
    const queue = Object.fromEntries(flow.MODES.map((mode) => [mode, flow.buildQueue(scheduleData, { now, mode })]));
    let unverifiedHistory = [];
    if (own(data, 'unverifiedHistory')) {
      const history = field(data, 'unverifiedHistory');
      if (Array.isArray(history) && pure(history)) unverifiedHistory = clone(history);
      else invalidCount += 1;
    }
    return clone({ scope, owner, epoch, events, records: projectedRecords, summary, queue, invalidCount, unverifiedHistory });
  }
  return { project };
});
