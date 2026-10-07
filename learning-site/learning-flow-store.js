(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.learningFlowStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const KEY = 'breakglass.website.learning-flow.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const engine = () => typeof require === 'function' ? require('./learning-flow') : root.BreakGlass.learningFlow;
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const emptyFlow = () => ({ schemaVersion: '1', purposes: [], exercises: [], contexts: [], receipts: [], reviews: [] });
  function fail(message, code = 'invalid_flow') { throw Object.assign(new Error(message), { code }); }
  function validateFlow(input, records) {
    const f = engine();
    if (!exact(input, ['schemaVersion','purposes','exercises','contexts','receipts','reviews']) || input.schemaVersion !== '1') fail('学习流程结构不合法。');
    for (const key of ['purposes','exercises','contexts','receipts','reviews']) {
      if (!Array.isArray(input[key]) || input[key].length > (['purposes','reviews'].includes(key) ? 500 : 2000)) fail('学习流程数量超限。', 'flow_limit');
    }
    const getRecord = id => records.find(r => r.id === id);
    const unique = (values, key) => { if (new Set(values.map(v => v[key])).size !== values.length) fail('学习流程标识重复。'); };
    const result = emptyFlow();
    result.purposes = input.purposes.map(v => { const c = f.validatePurpose(v); if (!getRecord(c.recordId)) fail('用途的原题不存在。'); return c; });
    result.reviews = input.reviews.map(v => { const c = f.validateReview(v); if (!getRecord(c.recordId)) fail('复习的原题不存在。'); return c; });
    result.exercises = input.exercises.map(v => { const r = getRecord(v.recordId); if (!r) fail('新题的原题不存在。'); return f.validateExercise(v, r); });
    result.contexts = input.contexts.map(v => { const ex = result.exercises.find(e => e.id === v.exerciseId); if (!ex) fail('帮助上下文的新题不存在。'); return f.validateContext(v, ex); });
    result.receipts = input.receipts.map(v => {
      const ex = result.exercises.find(e => e.id === v.exerciseId), ctx = result.contexts.find(c => c.exerciseId === v.exerciseId);
      if (!ex || !ctx || ex.recordId !== v.recordId) fail('作答的新题或帮助上下文不存在。');
      return f.validateReceipt(v, getRecord(ex.recordId), ex, ctx);
    });
    for (const k of ['purposes','reviews']) unique(result[k], 'recordId');
    for (const k of ['exercises','contexts','receipts']) unique(result[k], 'id');
    unique(result.contexts, 'exerciseId'); unique(result.receipts, 'exerciseId');
    if (result.exercises.some(e => !result.contexts.some(c => c.exerciseId === e.id))) fail('新题缺少帮助上下文。');
    return clone(result);
  }
  function pruneFlow(input, records) {
    const ids = new Set(records.map(r => r.id)), next = clone(input || emptyFlow());
    next.purposes = next.purposes.filter(v => ids.has(v.recordId)); next.reviews = next.reviews.filter(v => ids.has(v.recordId));
    next.exercises = next.exercises.filter(v => ids.has(v.recordId)); const exercises = new Set(next.exercises.map(e => e.id));
    next.contexts = next.contexts.filter(v => exercises.has(v.exerciseId)); next.receipts = next.receipts.filter(v => ids.has(v.recordId) && exercises.has(v.exerciseId));
    return validateFlow(next, records);
  }
  function createLocalStore(storage, { getRecords, id = () => root.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
    if (!storage || typeof getRecords !== 'function') throw new TypeError('学习流程需要当前本机原记录。');
    function write(state, expectedEpoch, expectedRaw) {
      const text = JSON.stringify(state);
      if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) fail('本机学习流程超过2MiB。', 'flow_limit');
      if (getRecords().epoch !== expectedEpoch) fail('本机数据已改变，旧操作已忽略。', 'epoch_conflict');
      if (expectedRaw !== undefined && storage.getItem(KEY) !== expectedRaw) fail('学习流程已在其他位置更新；输入保留，请刷新后重试。', 'revision_conflict');
      storage.setItem(KEY, text);
    }
    function readObserved() {
      const current = getRecords(), raw = storage.getItem(KEY);
      const empty = { epoch: current.epoch, flow: emptyFlow() };
      if (!raw) return { state: empty, raw };
      if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024) fail('本机学习流程超过2MiB。', 'local_storage_unavailable');
      let value; try { value = JSON.parse(raw); } catch { fail('本机学习流程无法读取，请先备份再清除。', 'local_storage_unavailable'); }
      if (!exact(value, ['epoch','flow']) || !Number.isSafeInteger(value.epoch) || value.epoch < 0) fail('本机学习流程版本无效。');
      if (value.epoch !== current.epoch) { write(empty, current.epoch, raw); return { state: empty, raw: JSON.stringify(empty) }; }
      const state = { epoch: current.epoch, flow: pruneFlow(value.flow, current.records) };
      // Deleted parents must disappear from the stored sidecar, so saving the
      // same record ID later cannot bring its old help or evidence back.
      if (JSON.stringify(state.flow) !== JSON.stringify(value.flow)) { write(state, current.epoch, raw); return { state, raw: JSON.stringify(state) }; }
      return { state, raw };
    }
    function read() { return readObserved().state; }
    function mutate(expectedEpoch, operation) {
      const current = getRecords(); if (current.epoch !== expectedEpoch) fail('本机数据已清除，旧学习操作已忽略。', 'epoch_conflict');
      const observed = readObserved(), state = observed.state, result = operation(state.flow, current.records);
      state.flow = validateFlow(state.flow, current.records);
      if (JSON.stringify(getRecords().records) !== JSON.stringify(current.records)) fail('原题已在其他位置更新，旧学习操作未写入。', 'revision_conflict');
      write(state, expectedEpoch, observed.raw); return { ...clone(result), epoch: state.epoch };
    }
    function original(records, recordId) { const r = records.find(v => v.id === recordId); if (!r) fail('原题已不存在。', 'record_not_found'); return r; }
    function revision(existing, expected) { if (!Number.isSafeInteger(expected) || expected < 0 || (existing?.revision || 0) !== expected) fail('学习设置已改变；请保留输入，重新读取后保存。', 'revision_conflict'); }
    return { read,
      remove(recordId, expectedEpoch = getRecords().epoch) {
        engine().purposeOf(recordId, []);
        return mutate(expectedEpoch, (flow, records) => {
          Object.assign(flow, pruneFlow(flow, records.filter(r => r.id !== recordId)));
          return { ok: true };
        });
      },
      savePurpose(recordId, purpose, { expectedRevision = 0, expectedEpoch = getRecords().epoch } = {}) {
        return mutate(expectedEpoch, (flow, records) => { original(records, recordId); const old = flow.purposes.find(v => v.recordId === recordId); revision(old, expectedRevision);
          const value = engine().createPurpose(recordId, purpose, { revision: expectedRevision + 1, updatedAt: now() });
          flow.purposes = [...flow.purposes.filter(v => v.recordId !== recordId), value]; return { purpose: value }; });
      },
      createExercise(options, expectedEpoch = getRecords().epoch) {
        return mutate(expectedEpoch, (flow, records) => { const record = original(records, options.recordId);
          if (engine().purposeOf(record.id, flow.purposes) !== 'practice') fail('请先明确把原记录设为可作答练习。', 'purpose_required');
          const exercise = engine().createExercise(record, { ...options, id: id(), createdAt: now() });
          const context = engine().createContext(exercise, { id: id(), generation: expectedEpoch });
          flow.exercises.push(exercise); flow.contexts.push(context); return { exercise, context }; });
      },
      help(exerciseId, input, expectedEpoch = getRecords().epoch) {
        return mutate(expectedEpoch, flow => { if (flow.receipts.some(r => r.exerciseId === exerciseId)) fail('此题已提交，请创建新题。', 'exercise_closed');
          const index = flow.contexts.findIndex(c => c.exerciseId === exerciseId); if (index < 0) fail('新题不存在。', 'exercise_not_found');
          flow.contexts[index] = engine().markHelp(flow.contexts[index], input); return { context: flow.contexts[index] }; });
      },
      submit(exerciseId, answer, expectedEpoch = getRecords().epoch) {
        return mutate(expectedEpoch, (flow, records) => { if (flow.receipts.some(r => r.exerciseId === exerciseId)) fail('每道新题只接受一次作答。', 'exercise_closed');
          const ex = flow.exercises.find(e => e.id === exerciseId), ctx = flow.contexts.find(c => c.exerciseId === exerciseId);
          if (!ex || !ctx) fail('新题不存在。', 'exercise_not_found');
          const receipt = engine().submitExercise(original(records, ex.recordId), ex, ctx, { id: id(), answer, createdAt: now() });
          flow.receipts.push(receipt); return { receipt }; });
      },
      saveReview(recordId, input, { expectedRevision = 0, expectedEpoch = getRecords().epoch } = {}) {
        return mutate(expectedEpoch, (flow, records) => { original(records, recordId); revision(flow.reviews.find(v => v.recordId === recordId), expectedRevision);
          const review = engine().validateReview({ recordId, ...input, revision: expectedRevision + 1, updatedAt: now() });
          flow.reviews = [...flow.reviews.filter(v => v.recordId !== recordId), review]; return { review }; });
      },
      clear() { const state = { epoch: getRecords().epoch, flow: emptyFlow() }; write(state, state.epoch); }
    };
  }
  function parseWebsitePackage(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2*1024*1024) fail('网站迁移包最多2MiB。');
    let value; try { value=JSON.parse(text); } catch { fail('网站迁移包不是JSON。'); }
    const recordsAPI=typeof require==='function'?require('./records'):root.BreakGlass.webRecords;
    const annotations=typeof require==='function'?require('./annotations'):root.BreakGlass.webAnnotations;
    const math=typeof require==='function'?require('./math-learning'):root.BreakGlass.mathLearning;
    if (!exact(value,['schemaVersion','kind','origin','createdAt','records','attempts','annotations','watch','flow'])
      ||value.schemaVersion!=='1'||value.kind!=='breakglass-website-visitor'
      ||!/^http:\/\/(?:localhost|127\.0\.0\.1):(?:4174|8765)$/.test(value.origin)
      ||typeof value.createdAt!=='string'||new Date(value.createdAt).toISOString()!==value.createdAt) fail('网站迁移包来源/版本不合法。');
    for(const key of ['records','attempts','annotations','watch']) if(!Array.isArray(value[key])||value[key].length>(key==='attempts'?500:100))fail('网站迁移包条数超限。');
    value.records=value.records.map(recordsAPI.validateRecord);
    if(new Set(value.records.map(r=>r.id)).size!==value.records.length)fail('网站迁移包原题ID重复。');
    for(const a of value.attempts){const r=value.records.find(r=>r.id===a.recordId);if(!r||!math.validReceipt(r,a))fail('迁移历史作答未通过数学重判。');}
    value.annotations=value.annotations.map(annotations.validateAnnotation);
    if(value.annotations.some(a=>!value.records.some(r=>r.id===a.recordId))||new Set(value.annotations.map(a=>a.recordId)).size!==value.annotations.length)fail('迁移备注没有原题或重复。');
    value.watch=value.watch.map(recordsAPI.validateWatch);
    if(new Set(value.watch.map(w=>recordsAPI.identity(w.source))).size!==value.watch.length)fail('迁移观看来源重复。');
    value.flow=validateFlow(value.flow,value.records);return clone(value);
  }
  return { KEY, emptyFlow, validateFlow, pruneFlow, createLocalStore, parseWebsitePackage };
});
