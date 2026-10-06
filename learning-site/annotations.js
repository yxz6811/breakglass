(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.webAnnotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'breakglass.website.annotations.v1';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const epoch = (value) => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
  const safeId = (value) => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && !/^(?:https?|data|blob|file|chrome-extension):/i.test(value);
  const iso = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
    const actual = Reflect.ownKeys(value);
    return actual.length === keys.length && keys.every((key) => own(value, key)) && actual.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.includes(key) && property.enumerable && own(property, 'value');
    });
  }
  function text(value, limit, { empty = false, multiline = false } = {}) {
    return typeof value === 'string' && value.length <= limit && (empty || Boolean(value.trim()))
      && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)
      && !/[\u202a-\u202e\u2066-\u2069]/.test(value)
      && !/(?:https?:\/\/|data:|blob:|file:\/\/|chrome-extension:\/\/|(?:document\.)?cookie\s*=|(?:authorization|cookie|api[_-]?key)\s*[:=])/i.test(value);
  }
  class AnnotationError extends Error {
    constructor(message, code) { super(message); this.name = 'AnnotationError'; this.code = code; }
  }
  function fail(message, code = 'invalid_annotation') { throw new AnnotationError(message, code); }
  function validateMetadata(value) {
    if (!exact(value, ['title', 'note', 'kind', 'tags']) || !text(value.title, 120)
      || !text(value.note, 1000, { empty: true, multiline: true }) || !['question', 'pitfall'].includes(value.kind)
      || !Array.isArray(value.tags) || Object.getPrototypeOf(value.tags) !== Array.prototype || value.tags.length > 8
      || Reflect.ownKeys(value.tags).length !== value.tags.length + 1
      || !Array.from({ length: value.tags.length }, (_, index) => Object.getOwnPropertyDescriptor(value.tags, String(index)))
        .every((property) => property && property.enumerable && own(property, 'value') && text(property.value, 24))
      || new Set(value.tags.map((tag) => tag.trim())).size !== value.tags.length) {
      fail('标题、备注、记录类型或原因标签无效；仅接受不含媒体地址和凭据的短文本。');
    }
    return { title: value.title, note: value.note, kind: value.kind, tags: value.tags.map((tag) => tag.trim()) };
  }
  function validateAnnotation(value) {
    if (!exact(value, ['schemaVersion', 'recordId', 'revision', 'title', 'note', 'kind', 'tags', 'updatedAt'])
      || value.schemaVersion !== '1' || !safeId(value.recordId) || !epoch(value.revision) || value.revision === 0 || !iso(value.updatedAt)) {
      fail('备注修订结构、版本或时间无效。');
    }
    const metadata = validateMetadata({ title: value.title, note: value.note, kind: value.kind, tags: value.tags });
    return { schemaVersion: '1', recordId: value.recordId, revision: value.revision, ...metadata, updatedAt: value.updatedAt };
  }
  function sameMetadata(left, right) {
    return Boolean(left && right && left.title === right.title && left.note === right.note && left.kind === right.kind
      && JSON.stringify(left.tags) === JSON.stringify(right.tags));
  }
  function displayRecord(record, annotation) {
    if (!annotation) return { ...clone(record), tags: [] };
    const checked = validateAnnotation(annotation);
    if (checked.recordId !== record.id) fail('备注不属于这条学习记录。');
    return { ...clone(record), title: checked.title, note: checked.note, kind: checked.kind, tags: checked.tags };
  }
  function createLocalStore(storage, { getRecords, now = () => new Date().toISOString() } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof getRecords !== 'function') {
      throw new TypeError('备注存储需要浏览器存储和当前原记录读取方法。');
    }
    function context() {
      const value = getRecords();
      if (!value || !epoch(value.epoch) || !Array.isArray(value.records)) fail('当前本机学习记录不可读取。', 'local_storage_unavailable');
      return value;
    }
    function read() {
      const current = context();
      const empty = { schemaVersion: '1', epoch: current.epoch, annotations: [] };
      const raw = storage.getItem(KEY);
      if (!raw) return empty;
      if (new TextEncoder().encode(raw).length > 512 * 1024) fail('本机备注数据超过512KiB上限。', 'local_storage_unavailable');
      let value;
      try { value = JSON.parse(raw); } catch (_) { fail('本机备注格式异常；请备份或明确清除后重试。', 'local_storage_unavailable'); }
      if (!exact(value, ['schemaVersion', 'epoch', 'annotations']) || value.schemaVersion !== '1'
        || !epoch(value.epoch) || !Array.isArray(value.annotations) || value.annotations.length > 100) {
        fail('本机备注结构异常；原数学记录未被更改。', 'local_storage_unavailable');
      }
      // A cleared record store owns a new epoch; old metadata never reappears.
      if (value.epoch !== current.epoch) return empty;
      const ids = new Set();
      value.annotations = value.annotations.map(validateAnnotation).filter((item) => current.records.some((record) => record.id === item.recordId));
      for (const annotation of value.annotations) {
        if (ids.has(annotation.recordId)) fail('同一记录存在重复备注。', 'local_storage_unavailable');
        ids.add(annotation.recordId);
      }
      return clone(value);
    }
    function write(value, expectedEpoch) {
      if (context().epoch !== expectedEpoch) fail('本机学习数据已清除；旧备注操作已忽略。', 'epoch_conflict');
      storage.setItem(KEY, JSON.stringify(value));
    }
    function get(recordId) {
      const value = read();
      if (!context().records.some((record) => record.id === recordId)) fail('原学习记录已不存在。', 'record_not_found');
      return { annotation: value.annotations.find((item) => item.recordId === recordId) || null, epoch: value.epoch };
    }
    function save(recordId, input, { expectedRevision, expectedEpoch } = {}) {
      if (!safeId(recordId) || !epoch(expectedRevision) || !epoch(expectedEpoch)) fail('需要当前记录标识、备注修订和数据版本。');
      const metadata = validateMetadata(input);
      const current = context();
      if (current.epoch !== expectedEpoch) fail('本机学习数据已清除；旧备注操作已忽略。', 'epoch_conflict');
      if (!current.records.some((record) => record.id === recordId)) fail('原学习记录已不存在。', 'record_not_found');
      const value = read();
      const existing = value.annotations.find((item) => item.recordId === recordId);
      if (sameMetadata(existing, metadata)) return { annotation: clone(existing), epoch: value.epoch };
      const revision = existing?.revision || 0;
      if (revision !== expectedRevision) fail('备注已在另一处更新；保留输入，请重新读取修订后再保存。', 'revision_conflict');
      if (revision >= Number.MAX_SAFE_INTEGER - 1) fail('备注修订次数已达上限。', 'revision_exhausted');
      const annotation = validateAnnotation({ schemaVersion: '1', recordId, revision: revision + 1, ...metadata, updatedAt: now() });
      value.annotations = [...value.annotations.filter((item) => item.recordId !== recordId), annotation];
      if (value.annotations.length > 100) fail('本机备注最多100条。', 'annotation_limit');
      write(value, expectedEpoch); return { annotation: clone(annotation), epoch: value.epoch };
    }
    function remove(recordId) {
      const value = read(); value.annotations = value.annotations.filter((item) => item.recordId !== recordId); write(value, value.epoch);
    }
    function clear() {
      const current = context(); const value = { schemaVersion: '1', epoch: current.epoch, annotations: [] };
      write(value, current.epoch); return current.epoch;
    }
    return { read, get, save, remove, clear };
  }
  return { KEY, validateMetadata, validateAnnotation, sameMetadata, displayRecord, createLocalStore, AnnotationError };
});
