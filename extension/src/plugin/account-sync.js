(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginAccountSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ENDPOINT = 'http://127.0.0.1:4174/api/plugin';
  const MAX_QUEUE = 100;
  function createSync({ getQueue, setQueue, getSession, setSession, fetch: fetcher,
    clientOrigin, validateRecord, now = Date.now, timeoutMs = 10000 }) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(clientOrigin)) throw new Error('插件身份无效。');
    let chain = Promise.resolve();
    let running = null;
    const active = new Set();
    let network = Promise.resolve();
    let generation = 0;
    let message = '';
    let pendingWatch = null;
    let lastWatchAck = null;
    let hydrated = false;
    const confirmed = new Set();
    const serial = (fn) => { const job = chain.then(fn); chain = job.catch(() => {}); return job; };
    const empty = () => ({ schemaVersion: 1, accountId: null, epoch: null, records: [], retryRequired: false });
    const clone = (value) => structuredClone(value);
    const sessionValid = (value) => value && typeof value.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.token)
      && typeof value.user?.id === 'string' && typeof value.user?.username === 'string'
      && Number.isSafeInteger(value.epoch) && value.epoch >= 0 && Number.isFinite(value.expiresAt)
      && value.expiresAt > now() && typeof value.enabled === 'boolean';
    async function queue() {
      const value = await getQueue();
      if (!value) { hydrated = true; return empty(); }
      if (value.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length > MAX_QUEUE
        || !value.records.every((record) => validateRecord(record, { source: record.source, duration: 600 }).ok)) {
        throw new Error('同步队列格式异常，请断开配对以清理。');
      }
      const restored = !hydrated && value.records.length > 0; hydrated = true;
      const checked = { ...clone(value), retryRequired: restored || value.retryRequired === true };
      if (restored && value.retryRequired !== true) await setQueue(checked);
      return checked;
    }
    function cancel() { generation += 1; for (const controller of active) controller.abort(); active.clear(); pendingWatch = null; lastWatchAck = null; confirmed.clear(); }
    async function invalidate(reason) {
      cancel(); await setSession(null); await setQueue(empty()); message = reason;
    }
    async function session() {
      const value = await getSession();
      if (!value) return null;
      if (!sessionValid(value)) { await invalidate('配对已过期；旧同步队列已清除，请重新配对。'); return null; }
      return clone(value);
    }
    function request(path, method, body, paired) {
      const owner = generation;
      const job = network.then(() => {
        if (owner !== generation) { const error = new Error('配对操作已取消。'); error.name = 'AbortError'; throw error; }
        return performRequest(path, method, body, paired);
      });
      network = job.catch(() => {});
      return job;
    }
    async function performRequest(path, method, body, paired) {
      const controller = new AbortController();
      active.add(controller);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = { 'X-BreakGlass-Client-Origin': clientOrigin };
        if (paired) headers.Authorization = 'Bearer ' + paired.token;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetcher(ENDPOINT + path, { method, headers, credentials: 'omit', redirect: 'error',
          signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const reader = response.body?.getReader();
        if (!reader) throw new Error('账号服务没有响应内容。');
        let bytes = 0; let text = ''; const decoder = new TextDecoder();
        try {
          for (;;) { const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error('账号响应过大。');
            text += decoder.decode(chunk.value, { stream: true }); }
          text += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); }
        let data; try { data = JSON.parse(text); } catch (_) { throw new Error('账号响应格式异常。'); }
        if (!response.ok) { const error = new Error(data.error || '账号请求失败。'); error.status = response.status;
          error.code = data.code; throw error; }
        return data;
      } finally { clearTimeout(timer); active.delete(controller); }
    }
    async function checkedMe(paired) {
      const reply = await request('/me', 'GET', undefined, paired);
      if (reply.user?.id !== paired.user.id || reply.epoch !== paired.epoch) {
        const error = new Error('账号或删除代次已变化，旧队列不能迁移。'); error.status = 409; throw error;
      }
      return reply;
    }
    async function failed(error, owner) {
      if (owner !== generation) return;
      if ([401, 403, 409].includes(error.status)) {
        await serial(() => invalidate('配对、账号或数据代次已失效；旧队列已清除，不会自动写回。'));
      } else {
        await serial(async () => {
          if (owner !== generation) return;
          const stored = await queue(); stored.retryRequired = stored.records.length > 0; await setQueue(stored);
          pendingWatch = null;
          message = error.name === 'AbortError' ? '同步超时；记录保留在本机队列，可显式重试。'
            : '同步失败；记录保留在本机队列，可显式重试。';
        });
      }
    }
    async function drain(force = false, allowedIds = null) {
      const owner = generation;
      for (;;) {
        const input = await serial(async () => {
          const paired = await session(); if (!paired || (!paired.enabled && !force) || owner !== generation) return null;
          const stored = await queue();
          if (stored.records.length && (stored.accountId !== paired.user.id || stored.epoch !== paired.epoch)) {
            await invalidate('旧队列身份已失效，已清除；请重新审核需要导入的本机记录。'); return null;
          }
          if (stored.retryRequired && !force) return null;
          const record = allowedIds ? stored.records.find((item) => allowedIds.has(item.id)) : stored.records[0];
          if (allowedIds && !record) return null;
          return record ? { paired, record } : pendingWatch ? { paired, watch: clone(pendingWatch) } : null;
        });
        if (!input) return;
        try {
          const reply = input.record
            ? await request('/records/' + encodeURIComponent(input.record.id), 'PUT',
              { record: input.record, expectedEpoch: input.paired.epoch }, input.paired)
            : await request('/watch/' + encodeURIComponent(input.watch.source.id), 'PUT',
              { ...input.watch, expectedEpoch: input.paired.epoch }, input.paired);
          if (reply.epoch !== input.paired.epoch) { const error = new Error('数据代次变化。'); error.status = 409; throw error; }
          await serial(async () => {
            if (owner !== generation) return;
            const current = await session(); if (!current || current.token !== input.paired.token) return;
            if (input.record) { const stored = await queue();
              stored.records = stored.records.filter((item) => item.id !== input.record.id);
              if (!stored.records.length) stored.retryRequired = false; await setQueue(stored);
              confirmed.add(input.record.id); if (confirmed.size > MAX_QUEUE) confirmed.delete(confirmed.values().next().value); }
            else { lastWatchAck = clone(input.watch);
              if (pendingWatch && JSON.stringify(pendingWatch) === JSON.stringify(input.watch)) pendingWatch = null; }
            message = '已由当前账号服务确认同步。';
          });
        } catch (error) { await failed(error, owner); return; }
      }
    }
    async function flush(force = false, allowedIds = null) {
      if (running) { await running; if (!force) return; }
      const job = drain(force, allowedIds); running = job;
      try { await job; } finally { if (running === job) running = null; }
    }
    async function snapshot() {
      return serial(async () => {
        const paired = await session(); const stored = await queue();
        return { paired: !!paired, user: paired ? clone(paired.user) : null, enabled: !!paired?.enabled,
          epoch: paired?.epoch ?? null, expiresAt: paired?.expiresAt ?? null,
          queued: stored.records.length, retryRequired: stored.retryRequired, syncing: !!running, revision: generation, message };
      });
    }
    async function connect(code, enabled = false) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(code) || typeof enabled !== 'boolean') throw new Error('请输入网站生成的一次性配对码。');
      return serial(async () => {
        cancel(); await setSession(null); await setQueue(empty());
        message = '旧配对与旧队列已清除，正在连接所选网站账号。'; const owner = generation;
        const reply = await request('/connect', 'POST', { code, clientOrigin });
        const paired = { token: reply.token, user: reply.user, epoch: reply.epoch, expiresAt: reply.expiresAt, enabled };
        if (owner !== generation || !sessionValid(paired)) throw new Error('配对响应无效或已取消。');
        await setQueue(empty()); await setSession(paired);
        message = enabled ? '配对成功；今后主动保存的新记录将同步到该账号。' : '配对成功；自动同步尚未开启。';
        return { user: clone(paired.user), enabled };
      });
    }
    async function disconnect() {
      cancel();
      const paired = await getSession();
      await serial(async () => { await setSession(null); await setQueue(empty()); message = '已断开并清除待同步队列；本机及账号已保存记录保留。'; });
      if (sessionValid(paired)) await request('/disconnect', 'POST', {}, paired).catch(() => {});
      return snapshot();
    }
    async function enable(value) {
      if (typeof value !== 'boolean') throw new Error('同步选项无效。');
      const owner = generation;
      if (!value) cancel();
      try {
        await serial(async () => {
          const paired = await session(); if (!paired) throw new Error('请先配对当前网站账号。');
          if (value) await checkedMe(paired);
          paired.enabled = value; await setSession(paired);
          message = value ? '未来新记录自动同步已开启；旧记录仍需另外勾选导入。' : '已在本机暂停自动同步；待同步记录可显式重试。';
        });
      } catch (error) { if (value) await failed(error, owner); throw error; }
      return snapshot();
    }
    async function enqueueMany(inputs, explicitImport = false, expected = null) {
      const ids = []; const owner = generation; let accepted = false; let importPair = null;
      await serial(async () => {
        const paired = await session();
        if (!paired && explicitImport) throw new Error('请先配对当前网站账号。');
        if (!paired || (!paired.enabled && !explicitImport)) return;
        if (explicitImport) importPair = paired;
        if (expected && (expected.revision !== generation || expected.user?.id !== paired.user.id || expected.epoch !== paired.epoch)) return;
        accepted = true;
        const stored = await queue();
        if (stored.records.length && (stored.accountId !== paired.user.id || stored.epoch !== paired.epoch)) {
          await invalidate('旧队列已清除，请重新审核本机记录。'); throw new Error('同步队列身份已变化。');
        }
        const additions = [];
        for (const input of inputs) {
          const checked = validateRecord(input, { source: input?.source, duration: 600 });
          if (!checked.ok) throw new Error(checked.message);
          const existing = [...stored.records, ...additions].find((r) => r.id === checked.value.id);
          if (existing && JSON.stringify(validateRecord(existing, { source: existing.source, duration: 600 }).value) !== JSON.stringify(checked.value)) throw new Error('同一记录ID内容冲突，请重新审核。');
          if (!existing) additions.push(checked.value);
          ids.push(checked.value.id);
        }
        if (stored.records.length + additions.length > MAX_QUEUE) throw new Error('待同步最多100条，请先重试或整理。');
        await setQueue({ schemaVersion: 1, accountId: paired.user.id, epoch: paired.epoch, records: [...stored.records, ...additions], retryRequired: stored.retryRequired });
      });
      if (importPair) {
        try { await checkedMe(importPair); } catch (error) { await failed(error, owner); throw error; }
      }
      await flush(explicitImport, explicitImport ? new Set(ids) : null); const state = await snapshot();
      return { syncStatus: owner !== generation ? 'cancelled' : !state.paired ? 'not-paired' : !state.enabled && !explicitImport ? 'disabled'
        : !accepted ? 'cancelled' : ids.length && ids.every((id) => confirmed.has(id)) ? 'confirmed' : 'queued', user: state.user };
    }
    async function retry() {
      const owner = generation;
      try {
        const paired = await serial(session); if (!paired) throw new Error('配对已失效。');
        await checkedMe(paired);
      } catch (error) { await failed(error, owner); throw error; }
      await flush(true); return snapshot();
    }
    async function accountRecords() {
      const owner = generation;
      try {
        const paired = await serial(session); if (!paired) throw new Error('请先配对。');
        await checkedMe(paired); const reply = await request('/records', 'GET', undefined, paired);
        if (owner !== generation) throw new Error('账号记录已过期。');
        if (reply.epoch !== paired.epoch) { const error = new Error('账号记录代次已变化。'); error.status = 409; throw error; }
        if (!Array.isArray(reply.records) || reply.records.length > 500
          || !reply.records.every((record) => validateRecord(record, { source: record.source, duration: 600 }).ok)) throw new Error('账号记录结构不符。');
        return { records: reply.records, user: clone(paired.user) };
      } catch (error) { await failed(error, owner); throw error; }
    }
    async function watch(value, expected) {
      const owner = generation; let accepted = false;
      await serial(async () => {
        const paired = await session();
        if (!paired?.enabled || !expected?.enabled || expected.revision !== generation
          || expected.user?.id !== paired.user.id || expected.epoch !== paired.epoch) return;
        const stored = await queue(); if (stored.retryRequired) return;
        pendingWatch = clone(value); accepted = true;
      });
      await flush(); const state = await snapshot();
      return { ...state, watchAccepted: accepted && owner === generation,
        watchConfirmed: accepted && owner === generation && JSON.stringify(lastWatchAck) === JSON.stringify(value) };
    }
    async function clearPending() {
      cancel(); await serial(async () => { await setQueue(empty()); message = '本机记录与待同步队列已清除；账号记录不受影响。'; });
    }
    return { snapshot, connect, disconnect, enable, enqueue: (record, expected) => enqueueMany([record], false, expected),
      importRecords: (records) => enqueueMany(records, true), retry, accountRecords, watch, clearPending };
  }
  return { createSync, ENDPOINT, MAX_QUEUE };
});
