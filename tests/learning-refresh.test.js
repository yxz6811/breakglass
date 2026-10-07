const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const recordsAPI = require('../learning-site/records');
const annotationsAPI = require('../learning-site/annotations');
const flowEngine = require('../learning-site/learning-flow');
const flowStoreAPI = require('../learning-site/learning-flow-store');
const flowUI = require('../learning-site/learning-flow-ui');
const accountAPI = require('../learning-site/account-client');
const annotationEditorAPI = require('../learning-site/annotation-editor');
const evidenceAPI = require('../learning-site/learning-evidence');
const provenanceAPI = require('../learning-site/provenance');
const TIME = '2026-10-07T00:00:00.000Z';
const flush = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
const original = (id = 'refresh-original') => ({ id, kind: 'question',
  source: { kind: 'manual-notes', id: 'refresh-teacher-math', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  time: 0, title: '刷新隔离数学条件', note: '合成测试记录。', template: 'parabola', snapshot: { a: 2, h: -3, k: 1 },
  origin: 'manual', sourceLabel: '测试手工条件', createdAt: TIME });
const candidateRecord = () => ({ ...original('refresh-candidate'), title: '候选经学生确认的条件',
  source: { kind: 'local-file', id: 'file-' + 'a'.repeat(64), version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  origin: 'vision', sourceLabel: '学生确认候选' });
const candidateMetadata = (requestId = 'refresh-request') => ({ recordId: candidateRecord().id, requestId,
  sourceId: candidateRecord().source.id, videoVersion: '1', analysisVersion: '1', frameTime: 0,
  frameSize: { width: 1280, height: 720 }, template: 'parabola', originalSnapshot: { a: 1, h: -2, k: 0 },
  placementStatus: 'unknown', map: null, profileVersion: 'refresh-profile-1', promptVersion: 'refresh-prompt-1',
  calibrationVersion: 'refresh-calibration-1', confirmation: 'student', attribution: 'student-confirmed-candidate' });
const candidateProvenance = (requestId = 'refresh-request') => provenanceAPI.validate({ ...candidateMetadata(requestId),
  schemaVersion: provenanceAPI.SCHEMA, revision: 1, updatedAt: TIME }, candidateRecord());

// Real app/flow/store/account modules execute below. DOM, media, clocks and
// transport alone are doubles; these checks do not establish browser layout.
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function element(tag = 'div') {
  const handlers = new Map(); let text = '';
  const node = { tagName: tag.toUpperCase(), children: [], dataset: {}, parentElement: null,
    value: '', disabled: false, hidden: false, checked: false, files: [], open: false,
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { for (const child of nodes) { this.children.push(child); child.parentElement = this; }
      if (this.tagName === 'SELECT' && !this.value && this.children.length) this.value = this.children[0].value; },
    prepend(...nodes) { for (const child of nodes) child.parentElement = this; this.children.unshift(...nodes); },
    replaceChildren(...nodes) { text = ''; this.children.forEach(child => { child.parentElement = null; }); this.children = [];
      if (this.tagName === 'SELECT') this.value = ''; this.append(...nodes); },
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    click() { return this.emit('click'); },
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } },
    setAttribute(name, value) { this[name] = String(value); }, removeAttribute(name) { delete this[name]; },
    focus() {}, scrollIntoView() {}, reportValidity() { return true; },
    getBoundingClientRect() { return { width: 640, height: 360 }; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return descendants(this).slice(1).filter(child => {
      if (selector === 'input:checked') return child.tagName === 'INPUT' && child.checked;
      return child.tagName === selector.toUpperCase();
    }); },
    async emit(name, extra = {}) { const event = { target: this, currentTarget: this,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of [...(handlers.get(name) || [])]) await fn(event); return event; }
  };
  Object.defineProperty(node, 'textContent', { get: () => text + node.children.map(child => child.textContent).join(''),
    set: value => { node.replaceChildren(); text = String(value); } });
  Object.defineProperty(node, 'valueAsNumber', { get: () => node.value.trim() === '' ? NaN : Number(node.value) });
  return node;
}
function localFixture() {
  const values = new Map(); let serial = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const records = recordsAPI.createLocalStore(storage, { now: () => TIME, id: () => 'refresh-record-' + ++serial });
  const flow = flowStoreAPI.createLocalStore(storage, { getRecords: () => records.read(), now: () => TIME, id: () => 'refresh-event-' + ++serial });
  const annotations = annotationsAPI.createLocalStore(storage, { getRecords: () => records.read(), now: () => TIME });
  const provenance = provenanceAPI.createStore({ storage, recordsStore: records, now: () => TIME });
  records.save(original()); flow.savePurpose(original().id, 'practice');
  return { values, storage, records, flow, annotations, provenance };
}
function flowFixture({ scope = 'local', beforeHelp } = {}) {
  const local = localFixture(); const container = element(); const document = { createElement: element };
  let owner = scope + ':refresh:epoch-0'; let state; let ui;
  const synchronize = () => { state = { ...local.records.read(), scope, user: scope === 'account' ? { id: 'refresh-alice', username: 'refresh-alice' } : null,
    annotations: local.annotations.read().annotations, flow: local.flow.read().flow }; };
  synchronize();
  const accountClient = {
    createExercise: async options => local.flow.createExercise(options),
    async exerciseHelp(id, input) { const result = local.flow.help(id, input); await beforeHelp?.(id, input); return result; },
    submitExercise: async (id, answer) => local.flow.submit(id, answer),
    savePurpose: async (id, purpose, revision) => local.flow.savePurpose(id, purpose, { expectedRevision: revision }),
    saveReview: async (id, review, revision) => local.flow.saveReview(id, review, { expectedRevision: revision }),
    saveAnnotation: async (id, metadata, revision) => local.annotations.save(id, metadata, { expectedRevision: revision, expectedEpoch: local.records.read().epoch })
  };
  ui = flowUI.mount(container, { document, getState: () => state, getOwner: () => owner,
    localStore: local.flow, recordsStore: local.records, annotationStore: local.annotations, accountClient,
    onChanged: () => { synchronize(); ui.refresh(); } });
  const action = name => { const found = descendants(container).find(node => node.dataset.flowAction === name);
    assert.ok(found, 'Missing flow action: ' + name); return found; };
  const answer = key => descendants(container).find(node => node.dataset.flowAnswer === key);
  return { ...local, container, ui, action, answer, state: () => state,
    refresh() { synchronize(); ui.refresh(); }, setOwner(next) { owner = next; synchronize(); ui.refresh(); } };
}

test('same-owner flow refresh preserves purpose/date drafts and rejects overwriting changed revisions', async () => {
  const f = flowFixture();
  try {
    f.action('purpose').value = 'reflection'; await f.action('purpose').emit('change');
    f.action('review-date').value = '2026-12-10'; await f.action('review-date').emit('input');
    f.flow.savePurpose(original().id, 'unclassified', { expectedRevision: 1 });
    f.flow.saveReview(original().id, { reviewAt: '2026-11-11T00:00:00.000Z', skippedUntil: null });
    f.refresh();
    assert.equal(f.action('purpose').value, 'reflection');
    assert.equal(f.action('review-date').value, '2026-12-10');
    await f.action('save-purpose').emit('click');
    assert.equal(f.flow.read().flow.purposes[0].purpose, 'unclassified', 'An old draft cannot silently overwrite the other tab');
    assert.equal(f.action('purpose').value, 'reflection');
    await f.action('review-save').emit('click');
    assert.equal(f.flow.read().flow.reviews[0].reviewAt, '2026-11-11T00:00:00.000Z');
    assert.equal(f.action('review-date').value, '2026-12-10');
    assert.match(f.action('status').textContent, /改变|冲突|版本|修订/);
    assert.deepEqual(f.flow.read().flow.receipts, []);
  } finally { f.ui.destroy(); }
});

test('same-owner external help and receipt merge without replacing typed answers, and lock a submitted exercise', async () => {
  const f = flowFixture();
  try {
    await f.action('practice-1').emit('click');
    const ex = f.flow.read().flow.exercises[0];
    f.answer('h').value = '-17'; f.answer('k').value = '23';
    f.flow.help(ex.id, { type: 'hint', level: 2 }); f.refresh();
    assert.equal(f.answer('h').value, '-17'); assert.equal(f.answer('k').value, '23');
    await f.action('hint').emit('click');
    assert.equal(f.flow.read().flow.contexts[0].hintsShown, 3, 'The next level must use the refreshed help context');
    const receipt = f.flow.submit(ex.id, flowEngine.exerciseView(ex, original()).answer).receipt; f.refresh();
    assert.equal(receipt.outcome, 'correct_with_hint');
    assert.equal(f.action('submit').disabled, true);
    assert.equal(f.answer('h').value, '-17'); assert.equal(f.answer('k').value, '23');
    assert.match(f.container.textContent, /借助帮助|辅助|使用帮助/);
    assert.equal(f.flow.read().flow.receipts.length, 1);
  } finally { f.ui.destroy(); }
});

test('cause drafts survive same-owner annotation refresh and retain their original revision on conflict', async () => {
  const f = flowFixture();
  try {
    await f.action('practice-1').emit('click'); f.answer('h').value = '99'; f.answer('k').value = '1';
    await f.action('submit').emit('click');
    f.action('cause').value = 'coordinate-sign'; await f.action('cause').emit('change');
    f.annotations.save(original().id, { title: original().title, note: '另一页已保存', kind: 'question', tags: ['确认:vertical-offset'] }, { expectedRevision: 0, expectedEpoch: 0 });
    f.refresh();
    assert.equal(f.action('cause').value, 'coordinate-sign');
    await f.action('confirm-cause').emit('click');
    assert.deepEqual(f.annotations.read().annotations[0].tags, ['确认:vertical-offset']);
    assert.equal(f.action('cause').value, 'coordinate-sign');
    assert.match(f.action('status').textContent, /改变|冲突|版本|修订/);
  } finally { f.ui.destroy(); }
});

test('deleted exercise dependencies and changed owner/epoch clear stale answers and review drafts', async () => {
  const f = flowFixture();
  try {
    await f.action('practice-1').emit('click'); f.answer('h').value = '777'; f.answer('k').value = '888';
    f.action('review-date').value = '2026-12-10'; await f.action('review-date').emit('input');
    f.flow.clear(); f.refresh();
    assert.equal(f.answer('h'), undefined, 'A vanished exercise cannot retain editable answers');
    f.records.remove(original().id); f.refresh();
    assert.equal(f.action('review-date').value, '');
    f.records.save(original()); f.flow.savePurpose(original().id, 'practice'); f.refresh();
    await f.action('practice-1').emit('click'); f.answer('h').value = '777';
    f.records.clear(); f.records.save(original());
    f.setOwner('local:refresh:epoch-1');
    assert.equal(f.answer('h'), undefined);
    assert.equal(f.action('review-date').value, '');
    assert.deepEqual(f.flow.read().flow.receipts, []);
  } finally { f.ui.destroy(); }
});

test('local flow writes reject an intervening valid raw update instead of losing the other tab revision', () => {
  for (const timing of ['after-observation', 'before-write-check']) {
    const f = localFixture(); const read = f.storage.getItem;
    const newer = JSON.parse(read(flowStoreAPI.KEY));
    newer.flow.purposes[0] = flowEngine.createPurpose(original().id, 'unclassified', { revision: 2, updatedAt: TIME });
    const newerRaw = JSON.stringify(newer); let flowReads = 0;
    f.storage.getItem = key => {
      if (key === flowStoreAPI.KEY) {
        flowReads++;
        if (flowReads === 1 && timing === 'after-observation') {
          const observed = read(key); f.values.set(key, newerRaw); return observed;
        }
        if (flowReads === 2 && timing === 'before-write-check') f.values.set(key, newerRaw);
      }
      return read(key);
    };
    assert.throws(() => f.flow.savePurpose(original().id, 'reflection', { expectedRevision: 1, expectedEpoch: 0 }),
      error => error.code === 'revision_conflict', timing + ' must reject the old mutation');
    assert.equal(read(flowStoreAPI.KEY), newerRaw, 'The external revision must remain intact');
    assert.equal(f.flow.read().flow.purposes[0].purpose, 'unclassified');
    assert.deepEqual(f.flow.read().flow.receipts, []);
  }
});

test('local flow writes reject a same-epoch parent deletion during the operation without reviving orphan settings', () => {
  const f = localFixture(); const epoch = f.records.read().epoch;
  const observedRaw = f.storage.getItem(flowStoreAPI.KEY); let deleted = false;
  const racing = flowStoreAPI.createLocalStore(f.storage, { getRecords: () => f.records.read(), now: () => {
    f.records.remove(original().id, epoch); deleted = true; return TIME;
  } });
  assert.throws(() => racing.savePurpose(original().id, 'reflection', { expectedRevision: 1, expectedEpoch: epoch }),
    error => error.code === 'revision_conflict');
  assert.equal(deleted, true, 'Deletion must happen inside the mutation rather than before its initial read');
  assert.equal(f.records.read().epoch, epoch, 'Deleting one parent does not require an epoch change');
  assert.deepEqual(f.records.read().records, []);
  assert.equal(f.storage.getItem(flowStoreAPI.KEY), observedRaw, 'The losing operation cannot rewrite the unchanged sidecar');
  assert.deepEqual(f.flow.read().flow, flowEngine.emptyFlow(), 'The next confirmed read prunes the deleted parent');
  f.records.save(original());
  assert.deepEqual(f.flow.read().flow, flowEngine.emptyFlow(), 'Reusing the old record ID cannot revive its settings');
});

test('same-owner dependency removal retires pending help and releases busy so another exercise can start', async () => {
  for (const removed of ['flow', 'parent']) {
    let enter; let release; let helpCalls = 0;
    const entered = new Promise(resolve => { enter = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const f = flowFixture({ scope: 'account', beforeHelp: async () => { if (++helpCalls === 1) { enter(); await wait; } } });
    try {
      await f.action('practice-1').emit('click'); const previous = f.flow.read().flow.exercises[0];
      const pending = f.action('hint').emit('click'); await entered;
      if (removed === 'flow') f.flow.clear(); else f.records.remove(original().id);
      f.refresh();
      if (removed === 'parent') f.records.save(original());
      f.flow.savePurpose(original().id, 'practice'); f.refresh();
      await f.action('practice-1').emit('click');
      const next = f.flow.read().flow.exercises.at(-1);
      assert.ok(next, 'Busy must be released after ' + removed + ' removal');
      assert.notEqual(next.id, previous.id);
      assert.ok(f.answer('h'), 'The replacement exercise should actually open');
      f.answer('h').value = '-71';
      release(); await pending;
      assert.equal(f.answer('h').value, '-71');
      assert.equal(f.flow.read().flow.contexts.find(context => context.exerciseId === next.id).hintsShown, 0,
        'A late old help acknowledgement cannot provide help to the replacement exercise');
      assert.equal(f.action('submit').disabled, false);
      assert.deepEqual(f.flow.read().flow.receipts, []);
    } finally { release(); f.ui.destroy(); }
  }
});

function appFixture({ standalone = false } = {}) {
  const local = localFixture(); const elements = new Map(); const intervals = new Map();
  const window = element('window'); const document = element('document'); document.hidden = false; document.visibilityState = 'visible';
  document.createElement = element; document.createElementNS = (_ns, tag) => element(tag);
  document.getElementById = id => { if (!elements.has(id)) { const node = element(['record-scope', 'record-kind', 'record-source'].includes(id) ? 'select' : 'div'); node.id = id; elements.set(id, node); } return elements.get(id); };
  document.querySelectorAll = () => []; document.body = element('body'); document.defaultView = window;
  const get = document.getElementById;
  get('record-scope').value = 'local'; get('record-kind').value = 'all'; get('record-source').value = 'all';
  const video = get('learning-video'); video.paused = true; video.pause = () => { video.paused = true; };
  video.currentTime = 0; video.duration = 12;
  let user = null, epoch = 0; let flowRefreshes = 0; let prepareHook = null;
  const calls = []; const scopes = []; const delayed = new Map(); const rejected = new Map(); const visualSessions = []; const downloads = []; const recognitionMounts = [];
  let serviceRecords = [original()], serviceProvenance = [];
  class FixtureURL extends URL { static createObjectURL(blob) { downloads.push(blob); return 'blob:refresh-export-' + downloads.length; } static revokeObjectURL() {} }
  const mediaSource = { kind: 'local-file', id: 'file-' + 'a'.repeat(64), version: '1', analysisVersion: '1', materialMode: 'self-authored' };
  const reply = value => ({ status: 200, ok: true, json: async () => copy(value) });
  const fetch = async (route, options = {}) => {
    calls.push({ route, options });
    if (rejected.has(route)) { const error = rejected.get(route); rejected.delete(route); throw error; }
    if (route === '/test-authorized-sample.mp4') return { ok: true, blob: async () => new Blob(['synthetic-media-transport'], { type: 'video/mp4' }) };
    if (route.endsWith('.css')) return { ok: true, text: async () => '.synthetic-overlay{}' };
    if (route.startsWith('/api/vision/policy?')) return reply({ allowed: true, supplierConfigured: true, source: mediaSource, reason: '独立测试授权替身' });
    if (route === '/api/deployment') return reply({ mode: 'local-development', registrationEnabled: true });
    if (route === '/api/account/me') return reply({ user, epoch, csrfToken: 'synthetic-csrf' });
    const value = route === '/api/learning/records' ? { records: serviceRecords.map(record => ({ ...record, title: (user?.username || 'guest') + ' 的服务记录' })), epoch }
      : route === '/api/learning/watch' ? { items: [], epoch }
        : route === '/api/learning/attempts' ? { attempts: [], epoch }
          : route === '/api/annotations' ? { annotations: [], epoch }
            : route === '/api/learning/flow' ? { flow: flowEngine.emptyFlow(), epoch }
              : route === '/api/learning/provenance' ? { provenance: copy(serviceProvenance), epoch } : null;
    if (!value) throw new Error('Unexpected synthetic route ' + route);
    if (delayed.has(route)) { const pending = delayed.get(route); delayed.delete(route); pending.value = value; return pending.promise; }
    return reply(value);
  };
  const noUI = () => ({ update() {}, stop() {}, destroy() {}, clearGuestCache: async () => {} });
  const bg = { webRecords: recordsAPI, webAnnotations: annotationsAPI, webProvenance: provenanceAPI, learningFlow: flowEngine, learningFlowStore: flowStoreAPI,
    webAccount: { createClient: options => accountAPI.createClient({ ...options, fetch }) },
    webAnnotationEditor: annotationEditorAPI, webPairing: { createUI: noUI }, webContext: { createUI: noUI },
    progressive: { createUI: noUI }, webAudio: { createUI: noUI },
    webImport: { createImporter: ({ onReset, onChange }) => { let generation = 0;
      return { epoch: () => generation, reset() { generation++; onReset(); }, async choose(file) {
        generation++; const selected = { name: file.name, duration: 12, width: 1280, height: 720, source: copy(mediaSource) };
        onChange({ state: 'ready', message: '测试媒体解码/指纹替身', selected }); return selected;
      } }; } },
    webVisual: { createSession() { const session = { prepareCalls: 0, startCalls: 0, destroyCalls: 0, destroyed: false,
      async prepare() { this.prepareCalls++; if (this.destroyed) throw new Error('识别层已销毁'); await prepareHook?.(); return true; },
      async start() { this.startCalls++; if (this.destroyed) throw new Error('识别层已销毁'); },
      destroy() { this.destroyCalls++; this.destroyed = true; }, stop() {} };
      visualSessions.push(session); return session; } },
    mathLearning: require('../learning-site/math-learning'), pedagogy: require('../learning-site/pedagogy'),
    geometryScene: { formatLength: value => Number(value).toFixed(6) },
    particles: { sampleScene: require('../extension/src/plugin/particle-renderer').sampleScene,
      createRenderer: () => ({ update() {}, destroy() {}, setView() {}, resetView() {}, getState: () => ({ mode: 'webgl' }) }) },
    mathWorkbench: { mount: () => ({ refresh() {}, reset() {}, destroy() {}, open() {} }) },
    recognitionWorkbench: { mount(host, options) { const controller = { stopCalls: 0, refreshCalls: 0, destroyCalls: 0,
      stop() { this.stopCalls++; }, refresh() { this.refreshCalls++; }, destroy() { this.destroyCalls++; } };
      recognitionMounts.push({ host, options, controller }); return controller; } },
    learningFlowUI: { mount: (container, options) => { const ui = flowUI.mount(container, { ...options, getState: () => copy(options.getState()) });
      return { ...ui, refresh() { flowRefreshes++; ui.refresh(); } }; } }
  };
  const evidencePath = path.resolve(__dirname, '../learning-site/learning-evidence.js');
  // The app runs in a VM and the helper modules in this Node realm. Serialize
  // the fixture seam so strict plain-data validators see one realm, as they do
  // in the browser; the production projection itself still executes unchanged.
  if (fs.existsSync(evidencePath)) bg.learningEvidence = { project: (data, options) => evidenceAPI.project(copy(data), copy(options)) };
  const globals = { BreakGlass: bg, localStorage: local.storage, fetch, console,
    setInterval(fn, delay) { const token = {}; intervals.set(token, { fn, delay }); return token; }, clearInterval: token => intervals.delete(token),
    setTimeout, clearTimeout, AbortController, URL: FixtureURL, Blob, File, crypto: globalThis.crypto, TextEncoder, matchMedia: () => ({ matches: false }), confirm: () => true };
  if (standalone) Object.assign(globals, { document, addEventListener: (...args) => window.addEventListener(...args),
    removeEventListener: (...args) => window.removeEventListener(...args) });
  const context = vm.createContext(globals);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../learning-site/app.js'), 'utf8'), context, { filename: 'app.js' });
  const app = standalone ? bg.learningApp.page : bg.learningApp.mount(document.body, { document, window, storage: local.storage, video,
    onScopeChange: target => scopes.push(copy(target)) });
  return { ...local, app, get, document, window, intervals, calls, scopes, visualSessions, downloads, recognitionMounts, flowRefreshes: () => flowRefreshes,
    beforePrepare(hook) { prepareHook = hook; },
    accountProvenance(items, records = [candidateRecord()]) { serviceProvenance = copy(items); serviceRecords = copy(records); },
    failNext(route, error = new Error('合成来源读取失败')) { rejected.set(route, error); },
    async ready() { await flush(); await flush(); },
    async account(name = 'alice', nextEpoch = epoch) { user = { id: name, username: name }; epoch = nextEpoch; await app.context.client.refresh(); await flush(); await flush(); },
    async storageEvent(key) { await window.emit('storage', { key, storageArea: local.storage }); await flush(); },
    hold(route) { let resolve; const pending = { promise: new Promise(done => { resolve = done; }) }; delayed.set(route, pending);
      return { release: () => resolve(reply(pending.value)), pending }; }
  };
}

test('mounted app exposes the actual local/account save target and reports scope changes independently of login', async () => {
  const f = appFixture();
  try {
    await f.ready(); const local = f.app.context.getSaveTarget();
    assert.equal(local.scope, 'local'); assert.equal(local.canSave, true); assert.match(local.label, /本机|访客/);
    await f.account('alice', 3); const account = f.app.context.getSaveTarget();
    assert.equal(account.scope, 'account'); assert.equal(account.epoch, 3); assert.equal(account.canSave, true); assert.match(account.label, /alice/);
    f.get('record-scope').value = 'local'; await f.get('record-scope').emit('change');
    assert.equal(f.app.context.getSaveTarget().scope, 'local');
    assert.equal(f.app.context.client.snapshot().user.id, 'alice', 'Changing save scope must not log the user out');
    assert.ok(f.scopes.some(target => target.scope === 'account' && target.epoch === 3));
    assert.equal(f.scopes.at(-1).scope, 'local');
  } finally { f.app.destroy(); }
});

test('mounted app refreshes all three visitor storage keys without discarding a same-owner explanation draft', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.app.openSnapshot(original(), 'local');
    f.get('self-explanation').value = '我的未保存解释';
    const edit = descendants(f.get('record-list')).find(node => node.tagName === 'BUTTON' && node.textContent === '编辑备注 / 易错原因');
    assert.ok(edit); await edit.emit('click'); await flush();
    const note = f.get('annotation-workbench').querySelector('textarea'); assert.ok(note);
    note.value = '未保存的备注草稿';
    for (const key of [recordsAPI.KEY, annotationsAPI.KEY, flowStoreAPI.KEY]) {
      const before = f.flowRefreshes(); await f.storageEvent(key);
      assert.ok(f.flowRefreshes() > before, 'Missing safe visitor refresh for ' + key);
      assert.equal(f.get('self-explanation').value, '我的未保存解释');
      assert.equal(note.value, '未保存的备注草稿');
      assert.equal(f.get('annotation-workbench').hidden, false);
      assert.equal(f.get('scene-panel').hidden, false, 'Unrelated data changes cannot close the current scene');
    }
    const calls = f.calls.length; await f.storageEvent('unrelated.preference');
    assert.equal(f.calls.length, calls, 'An unrelated storage event must not start service synchronization');
    f.records.remove(original().id); await f.storageEvent(recordsAPI.KEY);
    assert.equal(f.get('scene-panel').hidden, true);
    assert.equal(f.get('self-explanation').value, '', 'Deleting the draft parent retires its private text');
    assert.equal(note.value, ''); assert.equal(f.get('annotation-workbench').hidden, true);
  } finally { f.app.destroy(); }
});

test('visitor storage is not account synchronization; active 10-second/focus refresh uses the account service', async () => {
  const f = appFixture();
  try {
    await f.ready(); await f.account('alice'); f.app.openSnapshot(original(), 'account');
    f.get('self-explanation').value = '账户草稿';
    const before = f.flowRefreshes(); const services = f.calls.length;
    for (const key of [recordsAPI.KEY, annotationsAPI.KEY, flowStoreAPI.KEY]) await f.storageEvent(key);
    assert.equal(f.flowRefreshes(), before); assert.equal(f.calls.length, services);
    assert.equal(f.get('self-explanation').value, '账户草稿');
    const timer = [...f.intervals.values()].find(value => value.delay === 10000); assert.ok(timer);
    timer.fn(); await flush(); await flush();
    assert.ok(f.calls.length > services); assert.equal(f.get('self-explanation').value, '账户草稿');
    f.document.hidden = true; const hiddenCalls = f.calls.length; timer.fn(); await f.window.emit('focus'); await flush();
    assert.equal(f.calls.length, hiddenCalls, 'Hidden pages do not promise active refresh');
    f.document.hidden = false; await f.window.emit('focus'); await flush(); await flush();
    assert.ok(f.calls.length > hiddenCalls, 'Restoring focus should refresh the service owner');
    assert.equal(f.get('self-explanation').value, '账户草稿');
  } finally { f.app.destroy(); }
});

test('account generation/epoch changes discard delayed old reads and clear the previous owner draft', async () => {
  const f = appFixture();
  try {
    await f.ready(); await f.account('alice'); f.app.openSnapshot(original(), 'account');
    f.get('self-explanation').value = 'alice私密草稿';
    const held = f.hold('/api/learning/records');
    [...f.intervals.values()].find(value => value.delay === 10000).fn(); await flush();
    await f.account('bob', 1); held.release(); await flush(); await flush();
    assert.equal(f.app.context.client.snapshot().user.id, 'bob');
    assert.equal(f.app.context.getSaveTarget().epoch, 1);
    assert.equal(f.get('self-explanation').value, '');
    assert.equal(f.get('scene-panel').hidden, true);
    assert.doesNotMatch(f.get('center-status').textContent, /alice/);
    assert.match(f.get('record-list').textContent, /bob 的服务记录/);
    assert.doesNotMatch(f.get('record-list').textContent, /alice 的服务记录/);
    f.app.openSnapshot(original(), 'account'); f.get('self-explanation').value = 'bob旧epoch草稿';
    await f.account('bob', 2);
    assert.equal(f.get('self-explanation').value, '');
    assert.equal(f.get('scene-panel').hidden, true);
    assert.equal(f.app.context.getSaveTarget().epoch, 2);
  } finally { f.app.destroy(); }
});

test('prepareRecognitionSession creates/reuses a prepared session without starting a loop, and stop invalidates pending reuse', async () => {
  const f = appFixture(); let release;
  try {
    await f.ready();
    assert.equal(f.app.context.getVisualSession(), null);
    await assert.rejects(f.app.context.prepareRecognitionSession(), /素材|许可|范围/);
    await f.app.loadSample('/test-authorized-sample.mp4', 'synthetic-lesson.mp4'); await flush();
    const first = f.app.context.prepareRecognitionSession();
    const parallel = f.app.context.prepareRecognitionSession();
    const [session, reused] = await Promise.all([first, parallel]);
    assert.equal(session, reused); assert.equal(f.visualSessions.length, 1);
    assert.equal(session.prepareCalls, 1); assert.equal(session.startCalls, 0);
    assert.equal(f.app.context.getVisualSession(), session);
    assert.equal(await f.app.context.prepareRecognitionSession(), session);
    assert.equal(f.visualSessions.length, 1); assert.equal(session.startCalls, 0);
    let entered; const began = new Promise(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    f.beforePrepare(() => { entered(); return waiting; });
    const pending = f.app.context.prepareRecognitionSession();
    const rejected = assert.rejects(pending, /未确认|范围|准备/);
    await began; f.app.stop(); assert.equal(f.app.context.getVisualSession(), null);
    release(); await rejected;
    assert.equal(session.startCalls, 0); assert.ok(session.destroyCalls >= 1);
    assert.equal(f.app.context.getVisualSession(), null);
  } finally { release?.(); f.app.destroy(); }
});

test('a session internally destroyed by its overlay is retired after prepare/start failure so a new one can be prepared', async () => {
  for (const operation of ['prepare', 'start']) {
    const f = appFixture();
    try {
      await f.ready();
      await f.app.loadSample('/test-authorized-sample.mp4', 'synthetic-lesson.mp4'); await flush();
      const stale = await f.app.context.prepareRecognitionSession();
      stale.destroy(); // Simulate an overlay exit that does not call the app's stop function.
      assert.equal(f.app.context.getVisualSession(), stale, 'The app initially still holds the externally destroyed instance');
      if (operation === 'prepare') await assert.rejects(f.app.context.prepareRecognitionSession(), /已销毁/);
      else { await f.get('start-analysis').emit('click'); await flush(); await flush(); }
      assert.equal(f.app.context.getVisualSession(), null, operation + ' failure must retire the dead reference');
      const replacement = await f.app.context.prepareRecognitionSession();
      assert.notEqual(replacement, stale);
      assert.equal(f.visualSessions.length, 2);
      assert.equal(f.app.context.getVisualSession(), replacement);
      assert.equal(replacement.prepareCalls, 1); assert.equal(replacement.startCalls, 0);
      assert.equal(stale.startCalls, operation === 'start' ? 1 : 0);
    } finally { f.app.destroy(); }
  }
});

test('mounted app reads and exports independently stored student-candidate provenance without replacing corrected mathematics', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.records.save(candidateRecord());
    const item = f.provenance.save(candidateMetadata(), f.records.read().epoch);
    const refreshes = f.flowRefreshes(); await f.storageEvent(provenanceAPI.KEY);
    assert.ok(f.flowRefreshes() > refreshes, 'The fourth visitor storage key must refresh the mounted app');
    const data = f.app.context.getState();
    assert.deepEqual(copy(data.provenance), [item]); assert.equal(data.provenanceError, '');
    assert.deepEqual(data.records.find(record => record.id === candidateRecord().id).snapshot, candidateRecord().snapshot);
    assert.notDeepEqual(item.originalSnapshot, candidateRecord().snapshot, 'Original candidate and corrected record remain distinct');
    await f.get('export-records').emit('click'); await flush();
    assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].type, 'application/json');
    const exported = JSON.parse(await f.downloads[0].text());
    assert.deepEqual(exported.provenance, [item]);
    assert.deepEqual(exported.records.find(record => record.id === candidateRecord().id), candidateRecord());
    assert.ok(exported.records.every(record => !Object.hasOwn(record, 'provenance')), 'Metadata is a separate export collection');
    assert.match(f.get('data-status').textContent, /学生确认|候选/);
  } finally { f.app.destroy(); }
});

test('mounted app single-record deletion persists provenance pruning and same-ID reimport cannot revive the deleted source link', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.records.save(candidateRecord()); f.provenance.save(candidateMetadata(), f.records.read().epoch);
    await f.storageEvent(provenanceAPI.KEY);
    const card = f.get('record-list').children.find(node => node.textContent.includes(candidateRecord().title));
    const remove = descendants(card).find(node => node.tagName === 'BUTTON' && node.textContent === '删除这条记录');
    assert.ok(remove); await remove.emit('click'); await flush();
    assert.equal(f.records.read().records.some(record => record.id === candidateRecord().id), false);
    assert.deepEqual(JSON.parse(f.storage.getItem(provenanceAPI.KEY)).items, [], 'Pruning must reach persisted storage');
    assert.deepEqual(copy(f.app.context.getState().provenance), []);
    f.records.save(candidateRecord()); await f.storageEvent(recordsAPI.KEY);
    assert.deepEqual(copy(f.app.context.getState().provenance), []);
    assert.deepEqual(f.provenance.read().items, []);
  } finally { f.app.destroy(); }
});

test('mounted app explicit visitor clear removes the provenance key and a later reimport has no old metadata', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.records.save(candidateRecord()); f.provenance.save(candidateMetadata(), f.records.read().epoch);
    assert.ok(f.storage.getItem(provenanceAPI.KEY));
    await f.get('clear-local').emit('click'); await flush();
    assert.equal(f.storage.getItem(provenanceAPI.KEY), null);
    assert.deepEqual(f.records.read().records, []);
    f.records.save(candidateRecord()); await f.storageEvent(recordsAPI.KEY);
    assert.deepEqual(copy(f.app.context.getState().provenance), []);
  } finally { f.app.destroy(); }
});

test('account provenance late replies cannot cross either the owner or the epoch of the core learning read', async () => {
  for (const changed of ['owner', 'epoch']) {
    const f = appFixture();
    try {
      await f.ready(); f.accountProvenance([candidateProvenance('refresh-old-source')]); await f.account('alice', 1);
      assert.equal(f.app.context.getState().provenance[0].requestId, 'refresh-old-source');
      const held = f.hold('/api/learning/provenance');
      [...f.intervals.values()].find(value => value.delay === 10000).fn(); await flush();
      f.accountProvenance([candidateProvenance('refresh-current-source')]);
      await f.account(changed === 'owner' ? 'bob' : 'alice', 2);
      held.release(); await flush(); await flush();
      assert.equal(f.app.context.getSaveTarget().epoch, 2);
      assert.equal(f.app.context.client.snapshot().user.id, changed === 'owner' ? 'bob' : 'alice');
      assert.deepEqual(copy(f.app.context.getState().provenance), [candidateProvenance('refresh-current-source')]);
      assert.equal(f.app.context.getState().provenanceError, '');
    } finally { f.app.destroy(); }
  }
});

test('optional account provenance failure preserves confirmed core records and marks the source read as unconfirmed', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.accountProvenance([candidateProvenance()]); await f.account('alice', 1);
    f.failNext('/api/learning/provenance'); await f.app.context.client.refresh(); await flush(); await flush();
    const data = f.app.context.getState();
    assert.equal(data.records.length, 1); assert.equal(data.records[0].id, candidateRecord().id);
    assert.deepEqual(copy(data.provenance), [candidateProvenance()], 'Previously confirmed metadata stays with the same owner');
    assert.ok(data.provenanceError);
    assert.match(f.get('record-list').textContent, /alice 的服务记录/);
    assert.match(f.get('record-list').textContent, /来源记录读取未确认/);
    assert.match(f.get('center-status').textContent, /来源记录读取未确认/);
  } finally { f.app.destroy(); }
});

test('malformed visitor provenance preserves core learning but cannot produce a silently incomplete export', async () => {
  const f = appFixture();
  try {
    await f.ready(); f.storage.setItem(provenanceAPI.KEY, '{broken-source-metadata');
    await f.storageEvent(provenanceAPI.KEY);
    const data = f.app.context.getState();
    assert.equal(data.records.length, 1); assert.equal(data.records[0].id, original().id);
    assert.ok(data.provenanceError); assert.match(f.get('record-list').textContent, /来源记录读取未确认/);
    await f.get('export-records').emit('click'); await flush();
    assert.equal(f.downloads.length, 0);
    assert.match(f.get('data-status').textContent, /来源记录导出未确认/);
    assert.equal(f.storage.getItem(provenanceAPI.KEY), '{broken-source-metadata', 'An unsuccessful read cannot overwrite malformed source data');
  } finally { f.app.destroy(); }
});

test('standalone boot mounts one recognition workbench and wires view/media/scope/stop/pagehide lifecycle', async () => {
  const normal = appFixture();
  try { await normal.ready(); assert.equal(normal.recognitionMounts.length, 0, 'Ordinary mount leaves recognition ownership to its caller'); }
  finally { normal.app.destroy(); }
  const f = appFixture({ standalone: true });
  try {
    await f.ready(); assert.equal(f.recognitionMounts.length, 1);
    const { host, options, controller } = f.recognitionMounts[0];
    assert.equal(host, f.get('recognition-workbench')); assert.equal(options.learning, f.app);
    assert.equal(options.video, f.get('learning-video')); assert.equal(options.isActive(), false);
    const overviewGeneration = options.getPermissionGeneration(); const overviewRefresh = controller.refreshCalls;
    f.app.switchView('import');
    assert.equal(options.isActive(), true); assert.equal(options.getPermissionGeneration(), overviewGeneration);
    assert.ok(controller.refreshCalls > overviewRefresh, 'Entering import refreshes the existing workbench');
    await f.app.loadSample('/test-authorized-sample.mp4', 'synthetic-lesson.mp4'); await flush();
    assert.equal(f.app.snapshot().source.id, candidateRecord().source.id);
    assert.ok(options.getPermissionGeneration() > overviewGeneration, 'Media changes retire permission-bound recognition');
    const held = f.hold('/api/learning/provenance'); const mediaGeneration = options.getPermissionGeneration();
    await f.account('alice', 1);
    assert.ok(options.getPermissionGeneration() > mediaGeneration, 'A new owner/scope retires the previous recognition generation');
    assert.equal(f.app.context.getSaveTarget().canSave, false);
    const pendingGeneration = options.getPermissionGeneration(); const pendingStops = controller.stopCalls;
    const pendingRefreshes = controller.refreshCalls;
    held.release(); await flush(); await flush();
    assert.equal(f.app.context.getSaveTarget().canSave, true);
    assert.equal(options.getPermissionGeneration(), pendingGeneration, 'Availability alone does not replace scope identity');
    assert.equal(controller.stopCalls, pendingStops); assert.ok(controller.refreshCalls > pendingRefreshes);
    f.get('record-scope').value = 'local'; await f.get('record-scope').emit('change');
    assert.ok(options.getPermissionGeneration() > pendingGeneration, 'Explicit scope switching invalidates recognition');
    const scopeGeneration = options.getPermissionGeneration(); f.app.switchView('records');
    assert.equal(options.isActive(), false); assert.ok(options.getPermissionGeneration() > scopeGeneration);
    f.app.switchView('import'); assert.equal(options.isActive(), true);
    const buttonStops = controller.stopCalls; await f.get('stop-analysis').emit('click');
    assert.equal(controller.stopCalls, buttonStops + 1);
    const explicitStops = controller.stopCalls; f.app.stop(); assert.equal(controller.stopCalls, explicitStops + 1);
    assert.equal(f.recognitionMounts.length, 1, 'Lifecycle notifications do not mount another workbench');
    await f.window.emit('pagehide');
    assert.equal(controller.destroyCalls, 1); assert.equal(options.isActive(), false); assert.equal(f.intervals.size, 0);
    const finalStops = controller.stopCalls; await f.get('stop-analysis').emit('click'); await f.window.emit('pagehide'); f.app.destroy();
    assert.equal(controller.stopCalls, finalStops, 'Teardown removes the standalone stop listener');
    assert.equal(controller.destroyCalls, 1, 'Explicit destroy and repeated pagehide are idempotent');
  } finally { f.app.destroy(); }
});
