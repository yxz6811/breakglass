const test = require('node:test');
const assert = require('node:assert/strict');
const annotations = require('../learning-site/annotations');
const records = require('../learning-site/records');
const { createUI } = require('../learning-site/annotation-editor');
const { createClient } = require('../learning-site/account-client');
const record = { id: 'record-1', kind: 'question', source: { kind: 'manual-notes', id: 'manual-example', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  time: 1, title: '原题', note: '我的疑问', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'manual', sourceLabel: '学生手工条件', createdAt: '2026-10-06T00:00:00.000Z' };
const metadata = (title = '新的备注') => ({ title, note: '要先判断斜边。', kind: 'pitfall', tags: ['斜边'] });
const value = (revision = 1, content = metadata()) => ({ schemaVersion: '1', recordId: record.id, revision, ...content, updatedAt: '2026-10-07T00:00:00.000Z' });
function fixture() {
  const data = new Map(); const storage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const store = records.createLocalStore(storage); store.save(record);
  const sidecar = annotations.createLocalStore(storage, { getRecords: () => store.read(), now: () => '2026-10-07T00:00:00.000Z' });
  return { data, storage, store, sidecar };
}
test('local sidecar edits display metadata while retaining immutable mathematical record and actual attempt evidence', () => {
  const { store, sidecar } = fixture(); store.attempt(record.id, 7, false);
  assert.deepEqual(sidecar.get(record.id), { annotation: null, epoch: 0 });
  const edited = sidecar.save(record.id, metadata(), { expectedRevision: 0, expectedEpoch: 0 });
  const displayed = annotations.displayRecord(record, edited.annotation);
  assert.equal(displayed.title, '新的备注'); assert.deepEqual(displayed.tags, ['斜边']);
  assert.deepEqual(displayed.snapshot, record.snapshot); assert.deepEqual(store.read().records, [record]);
  assert.equal(store.read().attempts[0].outcome, 'wrong'); assert.equal(store.read().records[0].kind, 'question');
  assert.deepEqual(sidecar.save(record.id, metadata(), { expectedRevision: 0, expectedEpoch: 0 }), edited);
  assert.throws(() => sidecar.save(record.id, metadata('另一页的编辑'), { expectedRevision: 0, expectedEpoch: 0 }), (error) => error.code === 'revision_conflict');
  assert.equal(sidecar.get(record.id).annotation.revision, 1);
});
test('local clear epochs and record deletion reject old edits and remove metadata from current exportable state', () => {
  const { store, sidecar, data } = fixture(); sidecar.save(record.id, metadata(), { expectedRevision: 0, expectedEpoch: 0 });
  store.remove(record.id); assert.deepEqual(sidecar.read().annotations, []);
  assert.throws(() => sidecar.save(record.id, metadata(), { expectedRevision: 1, expectedEpoch: 0 }), (error) => error.code === 'record_not_found');
  sidecar.remove(record.id); assert.deepEqual(JSON.parse(data.get(annotations.KEY)).annotations, []);
  store.save(record); sidecar.save(record.id, metadata(), { expectedRevision: 0, expectedEpoch: 0 });
  store.clear(); assert.deepEqual(sidecar.read(), { schemaVersion: '1', epoch: 1, annotations: [] });
  store.save(record); assert.throws(() => sidecar.save(record.id, metadata('迟到'), { expectedRevision: 1, expectedEpoch: 0 }), (error) => error.code === 'epoch_conflict');
  sidecar.clear(); assert.deepEqual(JSON.parse(data.get(annotations.KEY)).annotations, []);
});
test('sidecar fails closed on malicious shapes and bounded text; valid empty notes and HTML remain literal text', () => {
  for (const input of [{ ...metadata(), tags: ['x', ' x '] }, { ...metadata(), tags: Array(9).fill('x') },
    { ...metadata(), tags: ['x'.repeat(25)] }, { ...metadata(), title: '\u202e隐藏' }, { ...metadata(), note: 'api_key=private' },
    { ...metadata(), source: record.source }, { ...metadata(), answer: 5 }, { ...metadata(), note: 'blob:private' }]) {
    assert.throws(() => annotations.validateMetadata(input));
  }
  const accessor = { ...metadata() }; Object.defineProperty(accessor, 'title', { enumerable: true, get() { throw new Error('must_not_read'); } });
  assert.throws(() => annotations.validateMetadata(accessor), /无效/);
  const sparse = Array(2); assert.throws(() => annotations.validateMetadata({ ...metadata(), tags: sparse }), /无效/);
  assert.deepEqual(annotations.validateMetadata({ ...metadata('<img src=x onerror=alert(1)>'), note: '' }).note, '');
  const { data, sidecar } = fixture(); data.set(annotations.KEY, '{bad'); assert.throws(() => sidecar.read(), /格式异常/);
  assert.equal(data.get(annotations.KEY), '{bad'); sidecar.clear(); assert.deepEqual(sidecar.read().annotations, []);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function element(tag) {
  let text = ''; const handlers = new Map();
  const result = { tagName: tag.toUpperCase(), children: [], value: '', disabled: false, hidden: false,
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { text = ''; this.children = nodes; },
    addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); },
    setAttribute() {}, focus() {}, emit(name) { return handlers.get(name)?.({ preventDefault() {} }); } };
  Object.defineProperty(result, 'textContent', { get: () => text + result.children.map((node) => node.textContent).join(''), set: (value) => { text = String(value); result.children = []; } });
  Object.defineProperty(result, 'innerHTML', { set() { throw new Error('unsafe HTML injection'); } });
  return result;
}
function uiFixture(options = {}) {
  const container = element('div'); const doc = { createElement: element }; let current = true; let saved = 0; let reads = 0;
  const ui = createUI({ document: doc, container, load: async () => { reads += 1; return options.load?.(reads) || { annotation: null, epoch: 0 }; },
    save: options.save || (async () => ({ annotation: value(), epoch: 0 })), isCurrent: () => current,
    onSaved: () => { saved += 1; } });
  const form = container.children[0]; const labels = form.children.filter((node) => node.tagName === 'LABEL');
  const inputs = labels.map((label) => label.children[1]); const actions = form.children.at(-1).children;
  return { ui, container, form, title: inputs[0], note: inputs[1], kind: inputs[2], tags: inputs[3], submit: actions[0], reread: actions[1],
    saved: () => saved, setCurrent: (next) => { current = next; } };
}
test('annotation conflict preserves student input, requires an explicit reread, and renders hostile text without HTML', async () => {
  let calls = 0; const received = [];
  const f = uiFixture({ load: (read) => ({ annotation: read > 1 ? value(2, metadata('<img src=x onerror=alert(1)>')) : null, epoch: 0 }),
    save: async (...args) => { received.push(args); calls += 1;
      if (calls === 1) throw Object.assign(new Error('另一页已更新'), { code: 'revision_conflict' });
      return { annotation: value(3, args[2]), epoch: 0 }; } });
  await f.ui.open(record, 'local'); f.title.value = '我未提交的新输入'; f.note.value = '我要保留这个说明'; f.tags.value = '符号，单位';
  await f.form.emit('submit'); assert.equal(f.title.value, '我未提交的新输入'); assert.equal(f.submit.disabled, true);
  assert.match(f.container.textContent, /输入已保留/); await f.reread.emit('click'); await flush();
  assert.equal(f.title.value, '我未提交的新输入'); assert.equal(f.submit.disabled, false); assert.match(f.container.textContent, /<img src=x onerror=alert\(1\)>/);
  await f.form.emit('submit'); assert.equal(received[1][3], 2); assert.equal(received[1][4], 0);
  assert.deepEqual(received[1][2].tags, ['符号', '单位']); assert.equal(f.saved(), 1); f.ui.destroy();
});
test('closing or changing accounts discards late annotation reads and saves without exposing private values', async () => {
  const reading = deferred(); const f = uiFixture({ load: () => reading.promise });
  const opening = f.ui.open(record, 'account'); f.ui.close(); reading.resolve({ annotation: value(1, metadata('上一账户私密内容')), epoch: 0 });
  await opening; assert.equal(f.container.hidden, true); assert.doesNotMatch(f.container.textContent, /上一账户/);
  const saving = deferred(); const g = uiFixture({ save: () => saving.promise }); await g.ui.open(record, 'account');
  const pending = g.form.emit('submit'); g.setCurrent(false); g.ui.close(); saving.resolve({ annotation: value(), epoch: 0 }); await pending;
  assert.equal(g.saved(), 0); assert.equal(g.container.hidden, true); assert.equal(g.title.value, '');
});

const response = (value, status = 200) => ({ status, ok: status < 400, json: async () => value });
test('annotation client writes use current CSRF and epoch and preserve conflicts without automatic replay', async () => {
  const calls = []; const client = createClient({ fetch: async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/account/me') return response({ user: { id: 'alice', username: 'alice' }, csrfToken: 'csrf-private', epoch: 4 });
    if (options.method === 'PUT') return response({ code: 'revision_conflict', error: '重新读取' }, 409);
    return response({ annotation: value(2), epoch: 4 });
  } });
  await client.refresh(); await client.annotation('record-1');
  await assert.rejects(client.saveAnnotation('record-1', metadata(), 2), (error) => error.code === 'revision_conflict');
  const request = calls.find((item) => item.options.method === 'PUT');
  assert.deepEqual(JSON.parse(request.options.body), { annotation: metadata(), expectedRevision: 2, expectedEpoch: 4 });
  assert.equal(request.options.headers['X-BreakGlass-CSRF'], 'csrf-private'); assert.equal(request.options.credentials, 'same-origin');
  assert.equal(calls.filter((item) => item.options.method === 'PUT').length, 1); assert.equal(client.snapshot().epoch, 4);
});
test('annotation list and writes ignore late responses after account generation changes', async () => {
  let active = 'alice'; const old = deferred(); let signal;
  const client = createClient({ fetch: async (path, options) => {
    if (path === '/api/account/me') return response({ user: { id: active, username: active }, csrfToken: 'csrf', epoch: 0 });
    if (path === '/api/account/login') { active = 'bob'; return response({}); }
    signal = options.signal; return old.promise;
  } });
  await client.refresh(); const loading = client.annotations(); const rejected = assert.rejects(loading, (error) => error.code === 'stale_session');
  await client.login({ username: 'bob', password: 'not-persisted' }); assert.equal(signal.aborted, true);
  old.resolve(response({ annotations: [value(1, metadata('alice private'))], epoch: 0 })); await rejected;
  assert.equal(client.snapshot().user.id, 'bob');
});
