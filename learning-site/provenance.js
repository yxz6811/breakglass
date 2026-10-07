(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.webProvenance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const KEY = 'breakglass.website.provenance.v1';
  const SCHEMA = '011.1'; const MAX_BYTES = 512 * 1024; const MAX_ITEMS = 500;
  const FIELDS = ['recordId','requestId','sourceId','videoVersion','analysisVersion','frameTime','frameSize','template',
    'originalSnapshot','placementStatus','map','profileVersion','promptVersion','calibrationVersion','confirmation','attribution'];
  const clone = v => JSON.parse(JSON.stringify(v));
  const records = () => typeof require === 'function' ? require('./records.js') : root.BreakGlass.webRecords;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const safeId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
  const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype
    && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.getOwnPropertyDescriptor(v,k)?.enumerable
      && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(v,k),'value'));
  const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  function fail(message, code = 'invalid_provenance') { throw Object.assign(new TypeError(message), { code }); }
  function validateMetadata(value, original) {
    const record = records().validateRecord(original);
    if (!exact(value,FIELDS) || ![value.recordId,value.requestId,value.sourceId,value.videoVersion,value.analysisVersion,
      value.profileVersion,value.promptVersion,value.calibrationVersion].every(safeId)
      || value.recordId !== record.id || value.template !== record.template
      || !['parabola','right-triangle'].includes(value.template)
      || value.confirmation !== 'student' || value.attribution !== 'student-confirmed-candidate') fail('来源记录必须是明确学生确认的有限字段。');
    const sourceId = record.source.id.startsWith('manual-file-') ? record.source.id.slice(7) : record.source.id;
    if (!/^file-[a-f0-9]{64}$/.test(value.sourceId) || sourceId !== value.sourceId
      || value.videoVersion !== record.source.version || value.analysisVersion !== record.source.analysisVersion
      || !finite(value.frameTime) || value.frameTime < 0 || value.frameTime > 600 || Math.abs(value.frameTime-record.time)>1e-6)
      fail('来源、版本或原帧时间与学习记录不一致。');
    const size = value.frameSize;
    if (!exact(size,['width','height']) || ![size.width,size.height].every(n => Number.isInteger(n) && n>0 && n<=8192)
      || size.width*size.height>20000000 || !records().validSnapshot(value.template,value.originalSnapshot)) fail('原帧尺寸或原候选数学无效。');
    if (!['unknown','student-calibrated'].includes(value.placementStatus)) fail('不能把来源记录标成模型自动像素验收。');
    if (value.placementStatus === 'unknown') { if (value.map !== null) fail('未知位置不保存猜测坐标。'); }
    else {
      const map = value.map;
      if (!exact(map,['ox','oy','sx','sy']) || !Object.values(map).every(finite) || map.ox<0 || map.ox>size.width
        || map.oy<0 || map.oy>size.height || map.sx<=0 || map.sy<=0 || map.sx>8192 || map.sy>8192) fail('人工标定必须为有限原点及正的独立比例。');
    }
    return clone(value);
  }
  function metadataOf(value) { const out={}; FIELDS.forEach(k => { out[k]=value[k]; }); return out; }
  function validate(value, original) {
    if (!exact(value,[...FIELDS,'schemaVersion','revision','updatedAt']) || value.schemaVersion!==SCHEMA
      || !Number.isSafeInteger(value.revision) || value.revision<1 || !iso(value.updatedAt)) fail('来源版本、修订或时间无效。');
    return { ...validateMetadata(metadataOf(value),original), schemaVersion:SCHEMA, revision:value.revision, updatedAt:value.updatedAt };
  }
  const sameMetadata = (a,b) => JSON.stringify(metadataOf(a))===JSON.stringify(metadataOf(b));
  function createStore({ storage, recordsStore, now = () => new Date().toISOString() }) {
    function read() {
      const parent = recordsStore.read(); const raw = storage.getItem(KEY);
      const empty = () => ({schemaVersion:SCHEMA,epoch:parent.epoch,items:[]});
      if (!raw) return empty();
      if (new TextEncoder().encode(raw).byteLength>MAX_BYTES) fail('本机来源记录容量超限。','provenance_limit');
      let state; try { state=JSON.parse(raw); } catch (_) { fail('本机来源数据无效，原学习记录未被改写。'); }
      if (!exact(state,['schemaVersion','epoch','items']) || state.schemaVersion!==SCHEMA
        || !Number.isSafeInteger(state.epoch) || state.epoch<0 || !Array.isArray(state.items) || state.items.length>MAX_ITEMS) fail('本机来源数据结构无效。');
      if (state.epoch!==parent.epoch) { storage.removeItem(KEY); return empty(); }
      const seen=new Set(); const items=[];
      for (const v of state.items) {
        const record=parent.records.find(r => r.id===v.recordId); if (!record) continue;
        if (seen.has(v.recordId)) fail('来源数据存在重复父记录。'); seen.add(v.recordId); items.push(validate(v,record));
      }
      const next = {schemaVersion:SCHEMA,epoch:parent.epoch,items};
      if (items.length !== state.items.length && recordsStore.read().epoch === parent.epoch) storage.setItem(KEY,JSON.stringify(next));
      return next;
    }
    function save(input, expectedEpoch, expectedRevision=0) {
      const parent=recordsStore.read(); if (parent.epoch!==expectedEpoch) fail('本机数据已清除，旧来源不能写回。','epoch_conflict');
      const record=parent.records.find(r=>r.id===input?.recordId); if (!record) fail('来源的父学习记录不存在。','record_not_found');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision<0) fail('来源修订参数无效。','revision_conflict');
      const metadata=validateMetadata(input,record); const state=read(); const prior=state.items.find(v=>v.recordId===record.id);
      if (prior && sameMetadata(prior,metadata)) return clone(prior);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision<0 || (prior?.revision||0)!==expectedRevision) fail('来源已更新，请保留输入并重读。','revision_conflict');
      if ((prior?.revision||0)>=Number.MAX_SAFE_INTEGER-1) fail('来源修订次数超限。');
      const item=validate({...metadata,schemaVersion:SCHEMA,revision:(prior?.revision||0)+1,updatedAt:now()},record);
      state.items=state.items.filter(v=>v.recordId!==record.id); state.items.push(item);
      const raw=JSON.stringify(state); if (state.items.length>MAX_ITEMS || new TextEncoder().encode(raw).byteLength>MAX_BYTES) fail('本机来源记录容量超限。','provenance_limit');
      const latest = recordsStore.read();
      if (latest.epoch!==expectedEpoch) fail('旧来源写入已失效。','epoch_conflict');
      const latestRecord = latest.records.find(v => v.id === record.id);
      if (!latestRecord) fail('来源的父学习记录已删除。','record_not_found');
      validateMetadata(metadata, latestRecord); storage.setItem(KEY,raw); return clone(item);
    }
    return { read,save,clear() { storage.removeItem(KEY); } };
  }
  return { KEY,SCHEMA,MAX_BYTES,MAX_ITEMS,FIELDS,validateMetadata,validate,metadataOf,sameMetadata,createStore };
});
