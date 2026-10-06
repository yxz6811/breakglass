(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createRecordStore({ get, set, validate, id = () => crypto.randomUUID(), now = () => new Date().toISOString() }) {
    let queue = Promise.resolve();
    function serial(fn) { const job = queue.then(fn); queue = job.catch(() => {}); return job; }
    async function state() {
      const stored = await get();
      if (!stored) return { schemaVersion: 1, epoch: 0, records: [] };
      if (stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.epoch) || stored.epoch < 0 || !Array.isArray(stored.records)) {
        throw new Error('本机记录格式异常，请在记录页清除后重试。');
      }
      return stored;
    }
    const list = () => serial(async () => structuredClone(await state()));
    const clear = () => serial(async () => {
      // A corrupt old schema must not make the recovery action unusable.
      const old = await get();
      const validEpoch = Number.isSafeInteger(old?.epoch) && old.epoch >= 0 && old.epoch < Number.MAX_SAFE_INTEGER;
      const next = { schemaVersion: 1, epoch: validEpoch ? old.epoch + 1 : Date.now(), records: [] };
      await set(next);
      return next.epoch;
    });
    const save = (input, expected, context) => serial(async () => {
      const stored = await state();
      if (stored.epoch !== expected) throw new Error('记录已清除，本次会话不能写回旧记录。');
      if (stored.records.length >= 100) throw new Error('首版最多100条本机记录，请先整理。');
      const checked = validate({ ...input, id: id(), createdAt: now() }, context);
      if (!checked.ok) throw new Error(checked.message);
      const next = { ...stored, records: [...stored.records, checked.value] };
      await set(next);
      return checked.value;
    });
    return { list, clear, save };
  }
  return { createRecordStore };
});
