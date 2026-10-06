(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.webAccount = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class AccountError extends Error {
    constructor(message, code, status = 0) { super(message); this.name = 'AccountError'; this.code = code; this.status = status; }
  }
  function createClient({ fetch: send = globalThis.fetch, onChange = () => {}, requestTimeoutMs = 10000 } = {}) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 25000) throw new TypeError('账户请求超时必须在25秒以内。');
    let generation = 0;
    let user = null;
    let csrfToken = '';
    let epoch = 0;
    let authBusy = false;
    const requests = new Set();
    function snapshot() { return { user: user && { ...user }, epoch, generation }; }
    function advanceGeneration() {
      generation += 1;
      requests.forEach((controller) => controller.abort());
      requests.clear();
    }
    function invalidate() {
      advanceGeneration(); user = null; csrfToken = ''; epoch = 0;
      onChange(snapshot());
    }
    async function request(path, { method = 'GET', body, authenticated = true, token = csrfToken, owner = generation } = {}) {
      if (authenticated && !user) throw new AccountError('请先登录当前账户。', 'not_logged_in');
      const controller = new AbortController();
      requests.add(controller);
      let timedOut = false; let timer;
      try {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && token) headers['X-BreakGlass-CSRF'] = token;
        const operation = (async () => {
          const response = await send(path, { method, headers, credentials: 'same-origin', signal: controller.signal,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          return { response, value: await response.json() };
        })();
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true; controller.abort();
            reject(new AccountError('账户服务请求超时，结果尚未确认；请稍后重试。', 'request_timeout'));
          }, requestTimeoutMs);
        });
        const { response, value } = await Promise.race([operation, timeout]);
        if (owner !== generation || controller.signal.aborted) throw new AccountError('账户已改变，忽略旧请求结果。', 'stale_session');
        if (!response.ok) {
          if (response.status === 401 && authenticated) invalidate();
          throw new AccountError(value.message || value.error || '服务操作失败。', value.code || 'request_failed', response.status);
        }
        return value;
      } catch (error) {
        if (owner !== generation) throw new AccountError('账户已改变，忽略旧请求结果。', 'stale_session');
        if (timedOut) throw new AccountError('账户服务请求超时，结果尚未确认；请稍后重试。', 'request_timeout');
        if (error.name === 'AbortError') throw new AccountError('账户请求已取消，结果尚未确认。', 'request_aborted');
        throw error;
      } finally { clearTimeout(timer); requests.delete(controller); }
    }
    async function refresh() {
      const owner = generation;
      const value = await request('/api/account/me', { authenticated: false, owner });
      if (owner !== generation) throw new AccountError('账户已改变，忽略旧请求结果。', 'stale_session');
      const nextUser = value.user ? { id: value.user.id, username: value.user.username } : null;
      if ((user && user.id) !== (nextUser && nextUser.id)
        || (user && nextUser && user.id === nextUser.id && epoch !== value.epoch)) advanceGeneration();
      user = nextUser;
      csrfToken = typeof value.csrfToken === 'string' ? value.csrfToken : '';
      epoch = Number.isSafeInteger(value.epoch) ? value.epoch : 0;
      onChange(snapshot());
      return snapshot();
    }
    async function authenticate(mode, credentials) {
      if (authBusy) throw new AccountError('账户操作正在进行，请稍候。', 'busy');
      authBusy = true; invalidate();
      try {
        await request(`/api/account/${mode}`, { method: 'POST', body: credentials, authenticated: false });
        return await refresh();
      } finally { authBusy = false; }
    }
    async function logout() {
      if (authBusy) throw new AccountError('账户操作正在进行，请稍候。', 'busy');
      authBusy = true;
      const token = csrfToken;
      invalidate();
      try {
        await request('/api/account/logout', { method: 'POST', body: {}, authenticated: false, token });
        return await refresh();
      } finally { authBusy = false; }
    }
    async function write(path, method, payload = {}) {
      if (method === 'DELETE' && user) {
        advanceGeneration(); onChange(snapshot());
      }
      const owner = generation;
      const value = await request(path, { method, body: { ...payload, expectedEpoch: epoch }, owner });
      if (owner === generation && Number.isSafeInteger(value.epoch)) epoch = value.epoch;
      return value;
    }
    return {
      snapshot, refresh, invalidate,
      register: (credentials) => authenticate('register', credentials),
      login: (credentials) => authenticate('login', credentials), logout,
      createPluginPairing: () => request('/api/account/plugin-pairing', { method: 'POST', body: {} }),
      revokePluginPairings: () => request('/api/account/plugin-pairing', { method: 'DELETE', body: {} }),
      records: () => request('/api/learning/records'),
      annotations: () => request('/api/annotations'),
      annotation: (recordId) => request(`/api/annotations/${encodeURIComponent(recordId)}`),
      saveAnnotation: (recordId, annotation, expectedRevision) => write(`/api/annotations/${encodeURIComponent(recordId)}`, 'PUT', { annotation, expectedRevision }),
      saveRecord: (record) => write(`/api/learning/records/${encodeURIComponent(record.id)}`, 'PUT', { record }),
      deleteRecord: (id) => write(`/api/learning/records/${encodeURIComponent(id)}`, 'DELETE'),
      clearRecords: () => write('/api/learning/records', 'DELETE'),
      watch: () => request('/api/learning/watch'),
      saveWatch: (value) => write(`/api/learning/watch/${encodeURIComponent(value.source.id)}`, 'PUT', value),
      attempts: () => request('/api/learning/attempts'),
      submitAttempt: (recordId, answer, hintUsed) => write('/api/learning/attempts', 'POST', { recordId, answer, hintUsed }),
      exportData: () => request('/api/learning/export'),
      deleteAccountData: () => write('/api/account/data', 'DELETE')
    };
  }
  return { createClient, AccountError };
});
