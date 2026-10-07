(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.webRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'breakglass.website.learning.v1';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const safeIdentity = (value, max) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && !/^(?:https?|data|blob|file|chrome-extension):/i.test(value);
  const iso = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const contracts = () => typeof require === 'function' ? require('../extension/src/plugin/contracts') : globalThis.BreakGlass.pluginContracts;
  const math = () => typeof require === 'function' ? require('./math-learning') : globalThis.BreakGlass.mathLearning;
  function validateSource(value, allowPending = false) {
    const checked = contracts().validateSource(value);
    if (!checked.ok || !safeIdentity(checked.value.id, 128)
      || (!allowPending && checked.value.materialMode === 'permission-pending')
      || (checked.value.kind === 'local-file' && !/^file-[a-f0-9]{64}$/.test(checked.value.id))
      || (checked.value.kind === 'manual-notes' && checked.value.id.startsWith('manual-file-')
        && !/^manual-file-[a-f0-9]{64}$/.test(checked.value.id))) throw new TypeError('来源身份或处理状态无效。');
    return checked.value;
  }
  function identity(source) { return `${source.kind}:${source.id}:${source.version}:${source.analysisVersion}`; }
  function fileId(source) {
    if (!source) return null;
    if (source.kind === 'local-file' && /^file-[a-f0-9]{64}$/.test(source.id)) return source.id;
    if (source.kind === 'manual-notes' && /^manual-file-[a-f0-9]{64}$/.test(source.id)) return source.id.slice(7);
    return null;
  }
  function validSnapshot(template, value) {
    return contracts().validateSnapshot(template, value).ok;
  }
  function validateRecord(value) {
    const fields = ['id', 'kind', 'source', 'time', 'title', 'note', 'template', 'snapshot', 'origin', 'sourceLabel', 'createdAt'];
    if (!value || !fields.every((key) => Object.prototype.hasOwnProperty.call(value, key))
      || Object.keys(value).some((key) => !fields.includes(key))) throw new TypeError('记录只能包含规定的学习字段。');
    if (!safeIdentity(value.id, 128)) throw new TypeError('学习记录的标识无效。');
    validateSource(value.source);
    if (value.source.kind === 'manual-notes' && value.origin !== 'manual') throw new TypeError('手工条件不能冒充视觉识别。');
    const checked = contracts().validateRecord(value, { source: value.source, duration: 600 });
    if (!checked.ok) throw new TypeError(checked.message);
    return checked.value;
  }
  function expectedAnswer(record) {
    if (!validSnapshot(record.template, record.snapshot)) throw new TypeError('数学条件无效。');
    if (math()?.isExtended(record.template)) return math().expectedAnswer(record.template, record.snapshot);
    return record.template === 'right-triangle' ? Math.hypot(record.snapshot.AB, record.snapshot.AC)
      : { h: record.snapshot.h, k: record.snapshot.k };
  }
  function judge(record, answer) {
    if (math()?.isExtended(record.template)) return math().judge(record.template, record.snapshot, answer)?.correct === true;
    const expected = expectedAnswer(record);
    if (record.template === 'right-triangle') return finite(answer)
      && Math.abs(answer - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6);
    return Boolean(answer && typeof answer === 'object' && !Array.isArray(answer)
      && Object.keys(answer).length === 2 && finite(answer.h) && finite(answer.k)
      && Math.abs(answer.h - expected.h) <= 1e-9 && Math.abs(answer.k - expected.k) <= 1e-9);
  }
  function normalizeAnswer(record, answer) {
    if (record.template === 'right-triangle' || math()?.isExtended(record.template)) {
      if (!finite(answer)) throw new TypeError('答案必须是有限数值。');
      return answer;
    }
    if (!answer || Object.keys(answer).length !== 2 || !finite(answer.h) || !finite(answer.k)) throw new TypeError('顶点答案只接受有限的h和k。');
    return { h: answer.h, k: answer.k };
  }
  function validateWatch(input) {
    const required = ['source', 'time', 'duration'];
    if (!input || required.some((key) => !Object.prototype.hasOwnProperty.call(input, key))
      || Object.keys(input).some((key) => !required.includes(key) && key !== 'updatedAt')
      || !finite(input.time) || !finite(input.duration) || input.duration <= 0 || input.duration > 600
      || input.time < 0 || input.time > input.duration) throw new TypeError('观看位置结构或范围无效。');
    const source = validateSource(input.source, true);
    if (input.updatedAt !== undefined && !iso(input.updatedAt)) throw new TypeError('观看时间戳无效。');
    return { source, time: input.time, duration: input.duration, ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }) };
  }
  function createLocalStore(storage, { now = () => new Date().toISOString(), id = () => globalThis.crypto.randomUUID() } = {}) {
    function read() {
      const raw = storage.getItem(KEY);
      if (!raw) return { schemaVersion: 1, epoch: 0, records: [], attempts: [], watch: [] };
      let value;
      try { value = JSON.parse(raw); } catch (_) { throw new Error('本机记录格式异常；请先备份浏览器原数据或明确清除后重试。'); }
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.epoch) || value.epoch < 0
        || Object.keys(value).length !== 5 || !['records', 'attempts', 'watch'].every((key) => Array.isArray(value[key]))) throw new Error('本机记录格式异常；请清除后重试。');
      value.records = value.records.map(validateRecord);
      value.watch = value.watch.map(validateWatch);
      if (value.records.length > 100 || value.attempts.length > 500 || value.watch.length > 100) throw new Error('本机数据超过当前额度。');
      if (new Set(value.records.map((item) => item.id)).size !== value.records.length
        || new Set(value.attempts.map((item) => item.id)).size !== value.attempts.length
        || new Set(value.watch.map((item) => identity(item.source))).size !== value.watch.length) throw new Error('本机数据存在重复身份，请整理后重试。');
      for (const attempt of value.attempts) {
        const record = value.records.find((item) => item.id === attempt.recordId);
        if (!record || Object.keys(attempt).length !== 7 || !safeIdentity(attempt.id, 128)
          || typeof attempt.hintUsed !== 'boolean' || attempt.correct !== judge(record, attempt.answer)
          || attempt.outcome !== (attempt.correct ? attempt.hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong') || !iso(attempt.createdAt)) {
          throw new Error('本机作答证据无效，请导出并整理数据。');
        }
      }
      return clone(value);
    }
    function write(value, owner) {
      const current = read();
      if (current.epoch !== owner) throw new Error('本机记录已清除，旧操作不再写回。');
      storage.setItem(KEY, JSON.stringify(value));
    }
    function save(input, owner = read().epoch) {
      const value = read();
      const record = validateRecord({ ...input, id: input.id || id(), createdAt: input.createdAt || now() });
      const index = value.records.findIndex((item) => item.id === record.id);
      if (index < 0 && value.records.length >= 100) throw new Error('本机最多100条记录，请先整理。');
      if (index < 0) value.records.push(record);
      else if (JSON.stringify(value.records[index]) !== JSON.stringify(record)) throw new Error('同ID记录内容冲突，不覆盖已有数学条件。');
      write(value, owner); return clone(record);
    }
    function remove(recordId, owner = read().epoch) {
      const value = read();
      value.records = value.records.filter((item) => item.id !== recordId);
      value.attempts = value.attempts.filter((item) => item.recordId !== recordId);
      write(value, owner);
    }
    function merge(records, owner = read().epoch) {
      const value = read();
      let added = 0; let skipped = 0;
      const merged = new Map(value.records.map((record) => [record.id, record]));
      records.map(validateRecord).forEach((record) => {
        if (merged.has(record.id)) {
          if (JSON.stringify(merged.get(record.id)) !== JSON.stringify(record)) throw new Error(`记录 ${record.id} 与本机同ID内容冲突，未导入。`);
          skipped += 1;
        } else { merged.set(record.id, record); added += 1; }
      });
      if (merged.size > 100) throw new Error('合并后超过100条本机记录，请先整理。');
      value.records = Array.from(merged.values()); write(value, owner); return { added, skipped };
    }
    function clear() {
      let oldEpoch = 0;
      try { oldEpoch = read().epoch; } catch (_) { /* Explicit clear also repairs corrupted local state. */ }
      const next = { schemaVersion: 1, epoch: oldEpoch + 1, records: [], attempts: [], watch: [] };
      storage.setItem(KEY, JSON.stringify(next)); return next.epoch;
    }
    function attempt(recordId, answer, hintUsed, owner = read().epoch) {
      const value = read();
      const record = value.records.find((item) => item.id === recordId);
      if (!record) throw new Error('该记录已不存在。');
      if (typeof hintUsed !== 'boolean') throw new TypeError('提示使用状态必须明确。');
      answer = normalizeAnswer(record, answer);
      if (value.attempts.length >= 500) throw new Error('本机复练记录已达500条，请导出并整理。');
      const correct = judge(record, answer);
      const receipt = { id: id(), recordId, answer: clone(answer), hintUsed: hintUsed === true,
        correct, outcome: correct ? hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong', createdAt: now() };
      value.attempts.push(receipt); write(value, owner); return clone(receipt);
    }
    function saveWatch(input, owner = read().epoch) {
      const checked = validateWatch(input);
      const value = read();
      const record = { ...checked, updatedAt: now() };
      value.watch = [...value.watch.filter((item) => identity(item.source) !== identity(input.source)), record].slice(-100);
      write(value, owner); return clone(record);
    }
    return { read, save, merge, remove, clear, attempt, saveWatch };
  }
  function parsePluginPackage(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 256 * 1024) throw new TypeError('插件记录包不能超过256KiB。');
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new TypeError('不是有效JSON记录包。'); }
    const fields = ['schemaVersion', 'origin', 'aiGeneratedContentPresent', 'records'];
    if (!value || fields.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
      || Object.keys(value).some((key) => !fields.includes(key)) || value.schemaVersion !== '1'
      || value.origin !== 'breakglass-plugin' || typeof value.aiGeneratedContentPresent !== 'boolean'
      || !Array.isArray(value.records) || value.records.length > 100) throw new TypeError('插件记录包结构或条数无效。');
    const ids = new Set();
    return value.records.map((record) => {
      const checked = contracts().validateRecord(record, { source: record.source, duration: 600 });
      if (!checked.ok) throw new TypeError(checked.message);
      if (ids.has(record.id)) throw new TypeError('记录包存在重复ID，请先整理。');
      if (record.origin === 'vision' && !value.aiGeneratedContentPresent) throw new TypeError('AI来源标识与记录不一致。');
      ids.add(record.id); return validateRecord(checked.value);
    });
  }
  function filterRecords(records, attempts, { kind = 'all', source = 'all' } = {}) {
    const wrong = new Set(attempts.filter((item) => item.outcome === 'wrong' && item.correct === false).map((item) => item.recordId));
    return records.filter((record) => (source === 'all' || identity(record.source) === source)
      && (kind === 'all' || (kind === 'wrong' ? wrong.has(record.id) : record.kind === kind)));
  }
  function nextReview(attempts, recordId, sourceRecords) {
    if (!Array.isArray(attempts)) throw new TypeError('复习历史必须是列表。');
    const record = Array.isArray(sourceRecords) ? sourceRecords.find((item) => item.id === recordId)
      : sourceRecords && sourceRecords.id === recordId ? sourceRecords : null;
    if (sourceRecords !== undefined && !record) return null;
    // The legacy two-argument API consumes history already validated by its
    // owning store. New callers may supply records to rejudge mathematical facts.
    const plan = record ? math().historyPlan(validateRecord(record), attempts)
      : math().reviewSuggestion(attempts.filter((item) => item?.recordId === recordId));
    return plan.days === null ? null : new Date(Date.parse(plan.lastAttemptAt) + plan.days * 86400000).toISOString();
  }
  function learningState(record, attempts) {
    const plan = math().historyPlan(record, attempts);
    if (!plan.latestOutcome) return '待验证';
    if (plan.latestOutcome === 'wrong') return '需要复练';
    return plan.latestOutcome === 'correct_with_hint' ? '使用提示完成' : '最近一次独立正确';
  }
  return { KEY, identity, fileId, validSnapshot, validateRecord, validateSource, validateWatch, expectedAnswer, judge, createLocalStore, filterRecords, nextReview, parsePluginPackage, learningState };
});
