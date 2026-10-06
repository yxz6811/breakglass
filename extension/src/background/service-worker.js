import '../curve/evaluate.js';
import '../geometry-scene/validate.js';
import '../plugin/contracts.js';
import '../plugin/registry.js';
import '../plugin/record-store.js';

const { pluginContracts: rules, pluginRegistry: registry, pluginRecords } = globalThis.BreakGlass;
const STATE = 'pluginLearningRecordsV1';
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
]);
const records = pluginRecords.createRecordStore({
  get: async () => (await chrome.storage.local.get(STATE))[STATE],
  set: (state) => chrome.storage.local.set({ [STATE]: state }),
  validate: rules.validateRecord
});
const inflight = new Map();
let operations = Promise.resolve();
function serial(fn) { const job = operations.then(fn); operations = job.catch(() => {}); return job; }
const keyFor = (tabId) => `visualSession:${tabId}`;
const ownPage = (sender) => sender.id === chrome.runtime.id
  && sender.url?.startsWith(chrome.runtime.getURL('plugin/'));

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('视觉服务没有响应内容。');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) throw new Error('视觉响应过大。');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

async function permittedSession(message, sender) {
  await ready;
  if (!sender.tab || !rules.resolvePolicy(sender.url).allowed || sender.frameId !== 0) throw new Error('该页面尚未获准处理。');
  const liveTab = await chrome.tabs.get(sender.tab.id);
  if (!rules.resolvePolicy(liveTab.url).allowed || !liveTab.active) throw new Error('仅处理当前观看的受控页面。');
  const stored = (await chrome.storage.session.get(keyFor(sender.tab.id)))[keyFor(sender.tab.id)];
  if (!stored || stored.token !== message.token || stored.documentId !== sender.documentId
    || Date.now() - stored.startedAt > 30 * 60 * 1000) throw new Error('视觉会话已失效，请重新开启。');
  return stored;
}
function abortTab(tabId) {
  for (const [key, abort] of inflight) if (key.startsWith(`${tabId}:`)) { abort.abort(); inflight.delete(key); }
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('无效消息。');
  await ready;
  if (message.type === 'plugin:list') {
    if (!ownPage(sender)) throw new Error('记录入口无效。');
    return { ok: true, ...(await records.list()) };
  }
  if (message.type === 'plugin:clear') {
    if (!ownPage(sender)) throw new Error('记录入口无效。');
    await serial(async () => {
      const sessions = await chrome.storage.session.get(null);
      for (const abort of inflight.values()) abort.abort();
      inflight.clear();
      await chrome.storage.session.clear();
      await records.clear();
      // A paused, unchanged frame may never make another request. Revoke its
      // content session directly so deletion also clears private observations.
      await Promise.allSettled(Object.entries(sessions).filter(([key, session]) =>
        /^visualSession:\d+$/.test(key) && typeof session?.token === 'string')
        .map(([key, session]) => chrome.tabs.sendMessage(Number(key.slice('visualSession:'.length)),
          { type: 'plugin:revoked', token: session.token }, { documentId: session.documentId })));
    });
    return { ok: true };
  }
  if (message.type === 'plugin:begin') return serial(async () => {
    if (!sender.tab || sender.frameId !== 0 || !rules.resolvePolicy(sender.url).allowed) throw new Error('来源处理授权待确认。');
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!tab.active || !rules.resolvePolicy(tab.url).allowed) throw new Error('请回到当前视频页面。');
    const lesson = registry.findLesson(message.lessonId);
    if (!lesson) throw new Error('未登记的测试素材。');
    abortTab(sender.tab.id);
    const state = await records.list();
    const session = { token: crypto.randomUUID(), source: registry.sourceFor(lesson), duration: lesson.duration,
      epoch: state.epoch, documentId: sender.documentId, startedAt: Date.now(), readCalls: 0, summaryCalls: 0 };
    await chrome.storage.session.set({ [keyFor(sender.tab.id)]: session });
    return { ok: true, token: session.token, source: session.source };
  });
  if (message.type === 'plugin:end') return serial(async () => {
    if (!sender.tab) throw new Error('无效会话。');
    const stored = (await chrome.storage.session.get(keyFor(sender.tab.id)))[keyFor(sender.tab.id)];
    if (stored?.token === message.token && stored.documentId === sender.documentId) {
      abortTab(sender.tab.id);
      await chrome.storage.session.remove(keyFor(sender.tab.id));
    }
    return { ok: true };
  });
  if (message.type === 'plugin:save') {
    const session = await permittedSession(message, sender);
    const r = message.record;
    const input = { kind: r?.kind, source: r?.source, time: r?.time, title: r?.title, note: r?.note,
      template: r?.template, snapshot: r?.snapshot, origin: r?.origin, sourceLabel: r?.sourceLabel };
    const saved = await records.save(input, session.epoch, { duration: session.duration, source: session.source });
    return { ok: true, storage: 'local', id: saved.id };
  }
  if (message.type !== 'plugin:read' && message.type !== 'plugin:summary') throw new Error('未知消息。');
  const summary = message.type === 'plugin:summary';
  const session = await serial(async () => {
    const state = await permittedSession(message, sender);
    const field = summary ? 'summaryCalls' : 'readCalls';
    if (state[field] >= (summary ? 8 : 32)) throw new Error('本次试验调用额度已到，请停止并整理结果。');
    state[field] += 1;
    await chrome.storage.session.set({ [keyFor(sender.tab.id)]: state });
    return state;
  });
  const jobKey = `${sender.tab.id}:${summary ? 'summary' : 'read'}`;
  if (inflight.has(jobKey)) throw new Error('上一轮仍在处理。');
  const abort = new AbortController();
  inflight.set(jobKey, abort);
  const requestId = crypto.randomUUID();
  const body = { schemaVersion: '1', requestId, sourceId: session.source.id,
    videoVersion: session.source.version, analysisVersion: session.source.analysisVersion, materialMode: session.source.materialMode };
  if (summary) body.observations = message.observations;
  else { body.frameTime = message.frameTime; body.image = message.image; }
  try {
    const response = await fetch(`http://127.0.0.1:8787/learning/${summary ? 'summarize' : 'read'}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]), credentials: 'omit', redirect: 'error'
    });
    const bytes = Number(response.headers.get('content-length'));
    if (bytes > 65536) throw new Error('视觉响应过大。');
    const answer = await boundedJson(response);
    if (!response.ok) throw new Error(answer.error || '本地视觉服务失败。');
    const current = await permittedSession(message, sender);
    if (abort.signal.aborted || current.token !== session.token || answer.requestId !== requestId
      || answer.sourceId !== session.source.id || answer.videoVersion !== session.source.version
      || answer.analysisVersion !== session.source.analysisVersion || (!summary && answer.frameTime !== body.frameTime)) {
      throw new Error('已丢弃过期或来源不符的结果。');
    }
    if (!summary && answer.status === 'candidate') {
      const checked = rules.validateVisualResult(answer.result);
      if (!checked.ok) throw new Error(checked.message);
      answer.result = checked.value;
    }
    return { ok: true, payload: answer };
  } finally { if (inflight.get(jobKey) === abort) inflight.delete(jobKey); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void handle(message, sender).then(respond, (error) => respond({ ok: false, message: error.message || '操作失败。' }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (!rules.resolvePolicy(tab.url).allowed) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('plugin/status.html') });
      return;
    }
    const files = ['src/geometry/content-rect.js', 'src/curve/evaluate.js', 'src/geometry-scene/validate.js',
      'src/geometry-scene/solve.js', 'src/geometry-scene/actions.js', 'src/plugin/contracts.js',
      'src/plugin/live-loop.js', 'src/plugin/frame-sampler.js', 'src/plugin/particle-renderer.js',
      'src/plugin/overlay.js', 'src/plugin/session.js'];
    const cssText = await (await fetch(chrome.runtime.getURL('src/plugin/overlay.css'))).text();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (config) => globalThis.BreakGlass.pluginSession.start(config),
      args: [{ cssText, lessons: registry.lessons }] });
  })().catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('plugin/status.html') }));
});
chrome.tabs.onRemoved.addListener((tabId) => { abortTab(tabId); void chrome.storage.session.remove(keyFor(tabId)); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) { abortTab(tabId); void chrome.storage.session.remove(keyFor(tabId)); }
});
