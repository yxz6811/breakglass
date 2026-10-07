import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const recordsAPI = require('../learning-site/records.js');
const flowEngine = require('../learning-site/learning-flow.js');
const flowStoreAPI = require('../learning-site/learning-flow-store.js');
const flowUI = require('../learning-site/learning-flow-ui.js');
const TIME = '2026-10-07T00:00:00.000Z';

const record = (id = 'boundary-record', source = {}) => ({ id, kind: 'question',
  source: { kind: 'manual-notes', id: 'boundary-source', version: '1', analysisVersion: '1',
    materialMode: 'self-authored', ...source },
  time: 0, title: '已核对的数学条件', note: '隔离回归数据。', template: 'parabola',
  snapshot: { a: 2, h: -3, k: 1 }, origin: 'manual', sourceLabel: '学生手工条件', createdAt: TIME });

function localFixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  let serial = 0;
  const records = recordsAPI.createLocalStore(storage, { now: () => TIME, id: () => `boundary-record-${++serial}` });
  const flow = flowStoreAPI.createLocalStore(storage, { getRecords: () => records.read(),
    now: () => TIME, id: () => `boundary-event-${++serial}` });
  return { values, storage, records, flow };
}

function completeExercise(fixture, original) {
  fixture.records.save(original);
  fixture.flow.savePurpose(original.id, 'practice');
  const { exercise } = fixture.flow.createExercise({ recordId: original.id,
    kind: 'parabola-equation', stage: 'practice', index: 1 });
  fixture.flow.help(exercise.id, { type: 'hint', level: 1 });
  fixture.flow.submit(exercise.id, flowEngine.exerciseView(exercise, original).answer);
  fixture.flow.saveReview(original.id, { reviewAt: null, skippedUntil: '2026-10-10T00:00:00.000Z' });
  return exercise;
}

function packageFor(fixture) {
  const state = fixture.records.read();
  return { schemaVersion: '1', kind: 'breakglass-website-visitor', origin: 'http://localhost:8765',
    createdAt: TIME, records: state.records, attempts: state.attempts, annotations: [],
    watch: state.watch, flow: fixture.flow.read().flow };
}

// This event double models native select selection, details disclosure, and
// cancellation of a summary click. Mathematics and state transitions use the
// production modules; actual browser layout remains a separate visual check.
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function element(tag = 'div') {
  const handlers = new Map();
  let text = '';
  const node = { tagName: tag.toUpperCase(), children: [], dataset: {}, parentElement: null,
    value: '', disabled: false, hidden: false, open: false, classList: { add() {} },
    append(...nodes) {
      for (const child of nodes) { this.children.push(child); child.parentElement = this; }
      if (this.tagName === 'SELECT' && !this.value && this.children.length) this.value = this.children[0].value;
    },
    prepend(...nodes) { for (const child of nodes) child.parentElement = this; this.children.unshift(...nodes); },
    replaceChildren(...nodes) {
      text = ''; this.children.forEach(child => { child.parentElement = null; }); this.children = [];
      if (this.tagName === 'SELECT') this.value = '';
      this.append(...nodes);
    },
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    listenerCount() { return [...handlers.values()].reduce((total, values) => total + values.size, 0); },
    clickCount: 0, removeCount: 0,
    click() { this.clickCount += 1; return this.emit('click'); },
    remove() {
      this.removeCount += 1;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    },
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      return descendants(this).slice(1).filter(child => child.tagName === selector.toUpperCase());
    },
    async emit(name) {
      const event = { target: this, currentTarget: this, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; } };
      for (const fn of [...(handlers.get(name) || [])]) await fn(event);
      return event;
    },
    ownText: () => text
  };
  Object.defineProperty(node, 'textContent', { get: () => text + node.children.map(child => child.textContent).join(''),
    set: value => { node.replaceChildren(); text = String(value); } });
  Object.defineProperty(node, 'valueAsNumber', { get: () => node.value.trim() === '' ? NaN : Number(node.value) });
  return node;
}

function visibleText(node) {
  if (node.hidden) return '';
  const children = node.tagName === 'DETAILS' && !node.open
    ? node.children.filter(child => child.tagName === 'SUMMARY') : node.children;
  return node.ownText() + children.map(visibleText).join('');
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function uiFixture({ scope = 'account', onChanged, failHelp = false, beforeCreate, beforeHelp } = {}) {
  const local = localFixture(); const original = record();
  local.records.save(original); local.flow.savePurpose(original.id, 'practice');
  const container = element();
  let owner = 'account-alice:epoch-0'; let state;
  let ui; let lastReceipt; let helpCalls = 0; let submitCalls = 0;
  const createdNodes = [];
  const synchronize = () => {
    state = { ...local.records.read(), scope, annotations: [], flow: local.flow.read().flow };
  };
  synchronize();
  const accountClient = {
    async createExercise(options) { await beforeCreate?.(options); return local.flow.createExercise(options); },
    async exerciseHelp(id, input) {
      helpCalls += 1;
      if (failHelp) throw Object.assign(new Error('帮助保存服务暂不可用'), { status: 503, code: 'service_unavailable' });
      await beforeHelp?.(id, input);
      return local.flow.help(id, input);
    },
    async submitExercise(id, answer) { submitCalls += 1; const result = local.flow.submit(id, answer); lastReceipt = result.receipt; return result; },
    async saveReview(id, input, revision) { return local.flow.saveReview(id, input, { expectedRevision: revision }); }
  };
  const document = { createElement(tag) { const node = element(tag); createdNodes.push(node); return node; } };
  ui = flowUI.mount(container, { document, getState: () => state,
    getOwner: () => owner, localStore: local.flow, recordsStore: local.records, accountClient,
    annotationStore: { read: () => ({ annotations: [] }) },
    onChanged: onChanged || (() => { synchronize(); ui?.refresh(); }) });
  const action = name => {
    const control = descendants(container).find(node => node.dataset.flowAction === name);
    assert.ok(control, `Missing learning-flow action: ${name}`); return control;
  };
  const study = () => {
    let node = action('submit');
    while (node && node.tagName !== 'SECTION') node = node.parentElement;
    assert.ok(node, 'Submit must belong to the current exercise section'); return node;
  };
  const openExample = async () => {
    const details = descendants(container).find(node => node.tagName === 'DETAILS');
    assert.ok(details, 'Worked example must have a disclosure');
    const summary = details.children.find(node => node.tagName === 'SUMMARY');
    const clicked = await summary.emit('click');
    if (!clicked.defaultPrevented) { details.open = !details.open; await details.emit('toggle'); }
    await flush(); await flush();
    return details;
  };
  return { local, original, container, createdNodes, ui, action, study, openExample,
    receipt: () => lastReceipt, helpCalls: () => helpCalls, submitCalls: () => submitCalls,
    addRecord(original) {
      local.records.save(original); local.flow.savePurpose(original.id, 'practice'); synchronize(); ui.refresh();
    },
    switchAccount() {
      owner = 'account-bob:epoch-0';
      // Accounts may legitimately contain imported records with the same ID.
      state = { scope: 'account', epoch: 0, records: [record()], attempts: [], annotations: [], flow: flowEngine.emptyFlow() };
      ui.refresh();
    } };
}

async function calendarRoundTrip() {
  const fixture = uiFixture({ scope: 'local' });
  try {
    fixture.action('review-date').value = '2026-10-10';
    await fixture.action('review-save').emit('click');
    const firstInput = fixture.action('review-date').value;
    const firstStored = fixture.local.flow.read().flow.reviews[0].reviewAt;
    await fixture.action('review-save').emit('click');
    return { offset: new Date(TIME).getTimezoneOffset(), firstInput, firstStored,
      secondInput: fixture.action('review-date').value,
      secondStored: fixture.local.flow.read().flow.reviews[0].reviewAt };
  } finally { fixture.ui.destroy(); }
}

if (process.env.BREAKGLASS_LOCAL_BOUNDARIES_CALENDAR_CHILD === '1') {
  process.stdout.write(JSON.stringify(await calendarRoundTrip()));
} else {
  test('local record deletion persistently removes its flow and same-ID reimport cannot revive evidence', () => {
    const fixture = localFixture(); const deleted = record('deleted-record'); const survivor = record('surviving-record');
    completeExercise(fixture, deleted); completeExercise(fixture, survivor);
    const epoch = fixture.records.read().epoch;
    fixture.records.remove(deleted.id);
    assert.deepEqual(fixture.flow.remove(deleted.id, epoch), { ok: true, epoch });
    const stored = JSON.parse(fixture.storage.getItem(flowStoreAPI.KEY)).flow;
    const observed = fixture.flow.read().flow;
    for (const [label, value] of [['current', observed], ['persisted', stored]]) {
      assert.equal(value.purposes.some(p => p.recordId === deleted.id), false, `${label}: deleted purpose remains`);
      assert.equal(value.reviews.some(r => r.recordId === deleted.id), false, `${label}: deleted review remains`);
      assert.equal(value.exercises.some(e => e.recordId === deleted.id), false, `${label}: deleted exercise remains`);
      assert.equal(value.receipts.some(r => r.recordId === deleted.id), false, `${label}: deleted receipt remains`);
      assert.equal(value.contexts.length, 1, `${label}: only the surviving exercise context remains`);
      assert.equal(value.receipts[0].recordId, survivor.id);
    }
    fixture.records.save(deleted);
    const reloaded = flowStoreAPI.createLocalStore(fixture.storage, { getRecords: () => fixture.records.read() }).read().flow;
    assert.equal(flowEngine.purposeOf(deleted.id, reloaded.purposes), 'unclassified');
    assert.equal(reloaded.receipts.length, 1);
    assert.equal(reloaded.receipts[0].recordId, survivor.id);
  });

  test('local flow read persistently prunes deleted parent dependencies without an explicit remove call', () => {
    const fixture = localFixture(); const deleted = record('deleted-on-read'); const survivor = record('kept-on-read');
    completeExercise(fixture, deleted); completeExercise(fixture, survivor);
    fixture.records.remove(deleted.id);
    const read = fixture.flow.read();
    assert.deepEqual(JSON.parse(fixture.storage.getItem(flowStoreAPI.KEY)), read);
    assert.deepEqual(read.flow.receipts.map(receipt => receipt.recordId), [survivor.id]);
    assert.equal(read.flow.contexts.length, 1);
    fixture.records.save(deleted);
    assert.equal(flowEngine.purposeOf(deleted.id, fixture.flow.read().flow.purposes), 'unclassified');
    assert.deepEqual(fixture.flow.read().flow.receipts.map(receipt => receipt.recordId), [survivor.id]);
  });

  test('local flow read replaces an obsolete epoch and stale removal cannot alter the replacement', () => {
    const fixture = localFixture(); const original = record('cleared-record');
    completeExercise(fixture, original);
    fixture.records.clear();
    const cleared = fixture.flow.read();
    assert.deepEqual(cleared, { epoch: 1, flow: flowEngine.emptyFlow() });
    const stored = fixture.storage.getItem(flowStoreAPI.KEY);
    assert.deepEqual(JSON.parse(stored), cleared, 'The old epoch must be removed from persistence too');
    fixture.records.save(original);
    assert.deepEqual(fixture.flow.read(), cleared);
    assert.throws(() => fixture.flow.remove(original.id, 0), error => error.code === 'epoch_conflict');
    assert.equal(fixture.storage.getItem(flowStoreAPI.KEY), stored);
  });

  test('local flow cleanup rechecks the parent epoch immediately before persisting', () => {
    const fixture = localFixture(); const original = record('read-race-record');
    completeExercise(fixture, original); fixture.records.remove(original.id);
    const before = fixture.storage.getItem(flowStoreAPI.KEY);
    let reads = 0;
    const flow = flowStoreAPI.createLocalStore(fixture.storage, { getRecords: () => {
      if (++reads === 2) fixture.records.clear();
      return fixture.records.read();
    } });
    assert.throws(() => flow.read(), error => error.code === 'epoch_conflict');
    assert.equal(fixture.storage.getItem(flowStoreAPI.KEY), before, 'A stale cleanup cannot write its older epoch');
    assert.deepEqual(flow.read(), { epoch: 1, flow: flowEngine.emptyFlow() });
    assert.deepEqual(JSON.parse(fixture.storage.getItem(flowStoreAPI.KEY)), flow.read());
  });

  test('local exercises require explicitly saved practice purpose before creating any new state', () => {
    const fixture = localFixture(); const original = record('purpose-gated-record');
    fixture.records.save(original);
    const options = { recordId: original.id, kind: 'parabola-equation', stage: 'practice', index: 1 };
    assert.throws(() => fixture.flow.createExercise(options), error => error.code === 'purpose_required');
    assert.equal(fixture.storage.getItem(flowStoreAPI.KEY), null);
    fixture.flow.savePurpose(original.id, 'reflection');
    const reflection = fixture.storage.getItem(flowStoreAPI.KEY);
    assert.throws(() => fixture.flow.createExercise(options), error => error.code === 'purpose_required');
    assert.equal(fixture.storage.getItem(flowStoreAPI.KEY), reflection);
    fixture.flow.savePurpose(original.id, 'practice', { expectedRevision: 1 });
    const created = fixture.flow.createExercise(options);
    assert.equal(created.exercise.recordId, original.id);
    assert.equal(fixture.flow.read().flow.exercises.length, 1);
    assert.deepEqual(fixture.flow.read().flow.receipts, []);
  });

  test('website migration accepts distinct complete watch identities and rejects an exact identity duplicate', () => {
    const fixture = localFixture();
    for (const [id, source] of [['source-v1', {}], ['source-v2', { version: '2' }],
      ['source-v3', { version: '3' }]]) {
      const original = record(id, source);
      fixture.records.save(original);
      fixture.records.saveWatch({ source: original.source, time: 1, duration: 10 });
    }
    const packageData = packageFor(fixture);
    assert.equal(packageData.watch.length, 3);
    const accepted = flowStoreAPI.parseWebsitePackage(JSON.stringify(packageData));
    assert.deepEqual(accepted.watch.map(w => recordsAPI.identity(w.source)),
      packageData.watch.map(w => recordsAPI.identity(w.source)));
    const duplicate = structuredClone(packageData);
    duplicate.watch.push({ ...duplicate.watch[0], time: 2 });
    assert.throws(() => flowStoreAPI.parseWebsitePackage(JSON.stringify(duplicate)), /重复/);
  });

  test('UTC+8 review calendar round trip preserves the selected day and repeated saves do not drift', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, TZ: 'Asia/Shanghai', BREAKGLASS_LOCAL_BOUNDARIES_CALENDAR_CHILD: '1' }
    });
    const actual = JSON.parse(output);
    assert.equal(actual.offset, -480, 'Only this child process must use UTC+8');
    assert.equal(actual.firstInput, '2026-10-10', JSON.stringify(actual));
    assert.equal(actual.secondInput, '2026-10-10', JSON.stringify(actual));
    assert.equal(actual.secondStored, actual.firstStored, 'Saving the displayed date again must preserve the instant');
    assert.equal(actual.firstStored, '2026-10-09T16:00:00.000Z', 'Local midnight must retain the correct UTC instant');
  });

  test('account switch while onChanged reload waits cannot reopen the previous account exercise', async () => {
    const loading = deferred(); const entered = deferred();
    const fixture = uiFixture({ onChanged: () => { entered.resolve(); return loading.promise; } });
    try {
      const creating = fixture.action('practice-0').emit('click');
      await entered.promise;
      fixture.switchAccount();
      assert.equal(fixture.study().hidden, true);
      loading.resolve(); await creating;
      assert.equal(fixture.study().hidden, true, 'A completed Alice reload must not open her exercise in Bob account');
    } finally { loading.resolve(); fixture.ui.destroy(); }
  });

  test('help persistence 503 cannot disclose a worked example then count the answer as independent', async () => {
    const fixture = uiFixture({ failHelp: true });
    try {
      await fixture.action('practice-0').emit('click');
      const details = await fixture.openExample();
      assert.equal(fixture.helpCalls(), 1, 'Opening the example must request its assistance receipt');
      assert.match(fixture.action('status').textContent, /未确认|不可用/);
      const exampleSteps = flowEngine.lessonFor(fixture.original).steps;
      const exposed = exampleSteps.some(step => visibleText(details).includes(step.text));
      const choice = descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice');
      assert.ok(choice); choice.value = 'match';
      await fixture.action('submit').emit('click');
      assert.equal(exposed, false, `Unrecorded example was visible; actual submission outcome: ${fixture.receipt()?.outcome}`);
      if (fixture.receipt()) assert.equal(fixture.receipt().outcome, 'correct_independent', 'A hidden, failed example did not provide help');
    } finally { fixture.ui.destroy(); }
  });

  test('a successfully saved full example is visible and the actual answer remains assisted', async () => {
    const fixture = uiFixture();
    try {
      await fixture.action('practice-0').emit('click');
      const details = await fixture.openExample();
      assert.equal(details.open, true);
      const exercise = fixture.local.flow.read().flow.exercises[0];
      const context = fixture.local.flow.read().flow.contexts.find(c => c.exerciseId === exercise.id);
      assert.equal(context.exampleShown, true);
      for (const step of flowEngine.lessonFor(fixture.original).steps) assert.ok(visibleText(details).includes(step.text));
      const choice = descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice');
      choice.value = flowEngine.exerciseView(exercise, fixture.original).answer;
      await fixture.action('submit').emit('click');
      assert.equal(fixture.receipt().outcome, 'correct_with_hint');
      assert.equal(fixture.receipt().hintUsed, true);
    } finally { fixture.ui.destroy(); }
  });

  test('a new exercise clears the old example and creates its own independent help context', async () => {
    const fixture = uiFixture();
    try {
      await fixture.action('practice-0').emit('click');
      const details = await fixture.openExample();
      const first = fixture.local.flow.read().flow.exercises[0];
      descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice').value = 'match';
      await fixture.action('submit').emit('click');
      assert.equal(fixture.receipt().outcome, 'correct_with_hint');
      await fixture.action('practice-0').emit('click');
      const state = fixture.local.flow.read().flow; const next = state.exercises.at(-1);
      assert.notEqual(next.id, first.id);
      assert.equal(details.open, false);
      for (const step of flowEngine.lessonFor(fixture.original).steps) assert.equal(details.textContent.includes(step.text), false);
      assert.equal(state.contexts.find(c => c.exerciseId === first.id).exampleShown, true, 'Old assistance evidence is retained');
      assert.equal(state.contexts.find(c => c.exerciseId === next.id).exampleShown, false, 'The next exercise has a separate context');
      descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice').value = 'match';
      await fixture.action('submit').emit('click');
      assert.equal(fixture.receipt().exerciseId, next.id);
      assert.equal(fixture.receipt().outcome, 'correct_independent');
    } finally { fixture.ui.destroy(); }
  });

  test('pending help keeps native disclosure empty and busy actions cannot bypass the assistance write', async () => {
    const waiting = deferred(); const entered = deferred();
    const fixture = uiFixture({ beforeHelp: () => { entered.resolve(); return waiting.promise; } });
    try {
      await fixture.action('practice-0').emit('click');
      const details = await fixture.openExample(); await entered.promise;
      const steps = flowEngine.lessonFor(fixture.original).steps;
      assert.equal(details.open, false);
      assert.ok(steps.every(step => !details.textContent.includes(step.text)), 'Pending help has no answer-bearing DOM body');
      assert.equal(fixture.local.flow.read().flow.contexts[0].exampleShown, false);
      await fixture.openExample();
      assert.equal(fixture.helpCalls(), 1, 'A second busy click cannot create another assistance request');
      details.open = true; await details.emit('toggle');
      assert.equal(details.open, false, 'Native accessibility expansion cannot reveal pending content');
      assert.ok(steps.every(step => !visibleText(details).includes(step.text)));
      descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice').value = 'match';
      await fixture.action('submit').emit('click');
      assert.equal(fixture.submitCalls(), 0, 'Submission waits for the pending help operation');
      waiting.resolve(); await flush(); await flush();
      assert.equal(details.open, true);
      assert.equal(fixture.local.flow.read().flow.contexts[0].exampleShown, true);
      await fixture.action('submit').emit('click');
      assert.equal(fixture.receipt().outcome, 'correct_with_hint');
    } finally { waiting.resolve(); await flush(); fixture.ui.destroy(); }
  });

  test('changing learning records under the same owner discards a delayed create result', async () => {
    const waiting = deferred(); const entered = deferred(); let calls = 0;
    const fixture = uiFixture({ beforeCreate: () => {
      if (++calls === 1) { entered.resolve(); return waiting.promise; }
    } });
    try {
      const nextRecord = record('second-learning-record'); fixture.addRecord(nextRecord);
      const creating = fixture.action('practice-0').emit('click'); await entered.promise;
      fixture.action('record').value = nextRecord.id; await fixture.action('record').emit('change');
      assert.equal(fixture.study().hidden, true);
      waiting.resolve(); await creating;
      assert.equal(fixture.action('record').value, nextRecord.id);
      assert.equal(fixture.study().hidden, true, 'The previous record request cannot reopen a discarded exercise');
      await fixture.action('practice-0').emit('click');
      assert.equal(fixture.study().hidden, false);
      const exercises = fixture.local.flow.read().flow.exercises;
      assert.deepEqual(exercises.map(ex => ex.recordId), [fixture.original.id, nextRecord.id]);
    } finally { waiting.resolve(); fixture.ui.destroy(); }
  });

  test('selectRecord opens newly saved mathematics without old exercise help and ignores unknown IDs', async () => {
    const fixture = uiFixture();
    try {
      await fixture.action('practice-0').emit('click');
      await fixture.openExample();
      const oldExercise = fixture.local.flow.read().flow.exercises[0];
      const oldPrompt = flowEngine.exerciseView(oldExercise, fixture.original).prompt;
      assert.equal(fixture.local.flow.read().flow.contexts[0].exampleShown, true);
      const nextRecord = { ...record('newly-saved-mathematics'), title: '新保存的另一组条件',
        snapshot: { a: -1, h: 7, k: -2 } };
      fixture.addRecord(nextRecord);
      assert.equal(fixture.ui.selectRecord(nextRecord.id), true);
      assert.equal(fixture.action('record').value, nextRecord.id);
      assert.equal(fixture.study().hidden, true, 'Selecting a saved original closes the previous exercise');
      assert.equal(visibleText(fixture.container).includes(oldPrompt), false);
      const example = descendants(fixture.container).find(node => node.tagName === 'DETAILS');
      assert.equal(example.open, false);
      assert.ok(flowEngine.lessonFor(fixture.original).steps.every(step => !visibleText(example).includes(step.text)));
      await fixture.action('practice-0').emit('click');
      const state = fixture.local.flow.read().flow; const next = state.exercises.at(-1);
      assert.equal(next.recordId, nextRecord.id);
      assert.ok(visibleText(fixture.study()).includes('开口参数a=-1，顶点为(8,-3)'), 'The new exercise uses the newly saved parameters');
      assert.equal(visibleText(fixture.study()).includes(oldPrompt), false);
      assert.equal(state.contexts.find(context => context.exerciseId === oldExercise.id).exampleShown, true);
      assert.equal(state.contexts.find(context => context.exerciseId === next.id).exampleShown, false);
      const beforeUnknown = visibleText(fixture.container);
      assert.equal(fixture.ui.selectRecord('no-such-record'), false);
      assert.equal(fixture.action('record').value, nextRecord.id);
      assert.equal(fixture.study().hidden, false);
      assert.equal(visibleText(fixture.container), beforeUnknown, 'An unknown record leaves the current exercise intact');
    } finally { fixture.ui.destroy(); }
  });

  test('actual receipt immediately updates review reason and date while retaining the current exercise result', async () => {
    for (const scenario of [{ answer: 'match', days: 7, reason: '最近一次独立正确', result: '无帮助实际正确' },
      { answer: 'horizontal-sign', days: 1, reason: '最近一次答错', result: '实际答错' },
      { answer: 'match', help: true, days: 3, reason: '最近一次借助提示', result: '借助帮助完成' }]) {
      const fixture = uiFixture();
      try {
        let scheduleBox = fixture.action('review-date');
        while (scheduleBox.tagName !== 'SECTION') scheduleBox = scheduleBox.parentElement;
        const schedule = scheduleBox.children.find(node => node.tagName === 'P');
        assert.match(schedule.textContent, /尚无作答安排/);
        await fixture.action('practice-0').emit('click');
        const exercise = fixture.local.flow.read().flow.exercises[0];
        const prompt = flowEngine.exerciseView(exercise, fixture.original).prompt;
        if (scenario.help) await fixture.openExample();
        descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice').value = scenario.answer;
        await fixture.action('submit').emit('click');
        const receipt = fixture.receipt();
        assert.equal(receipt.exerciseId, exercise.id);
        const expectedDate = new Date(Date.parse(receipt.createdAt) + scenario.days * 86400000).toLocaleDateString();
        assert.ok(schedule.textContent.includes(scenario.reason), `Review reason must follow the actual ${receipt.outcome} receipt`);
        assert.ok(schedule.textContent.includes(`建议日期：${expectedDate}`));
        assert.equal(schedule.textContent.includes('尚无作答安排'), false);
        assert.equal(fixture.study().hidden, false);
        assert.equal(fixture.action('submit').disabled, true);
        assert.ok(visibleText(fixture.study()).includes(prompt));
        assert.ok(visibleText(fixture.study()).includes(scenario.result));
        const feedback = visibleText(fixture.study()); fixture.ui.refresh();
        assert.equal(visibleText(fixture.study()), feedback, 'Refreshing a new schedule does not discard the current result');
      } finally { fixture.ui.destroy(); }
    }
  });

  test('refresh, queue and cause replacement retire listeners and destroy releases every remaining control', async () => {
    const fixture = uiFixture();
    const assertRetiredListeners = () => {
      const active = new Set(descendants(fixture.container));
      for (const node of fixture.createdNodes) if (!active.has(node)) {
        assert.equal(node.listenerCount(), 0, `Detached ${node.tagName} ${node.dataset.flowAction || ''} retains a handler`);
      }
    };
    try {
      fixture.action('queue-mode').value = 'manual'; await fixture.action('queue-mode').emit('change');
      const initialListeners = descendants(fixture.container).reduce((count, node) => count + node.listenerCount(), 0);
      for (let iteration = 0; iteration < 5; iteration++) {
        fixture.ui.refresh(); assertRetiredListeners();
        assert.equal(descendants(fixture.container).reduce((count, node) => count + node.listenerCount(), 0), initialListeners);
        await fixture.action('queue-mode').emit('change'); assertRetiredListeners();
      }
      for (let iteration = 0; iteration < 3; iteration++) {
        await fixture.action('practice-0').emit('click');
        descendants(fixture.container).find(node => node.dataset.flowAnswer === 'choice').value = 'horizontal-sign';
        await fixture.action('submit').emit('click');
        assert.equal(fixture.receipt().outcome, 'wrong');
        const oldCause = fixture.action('confirm-cause'); assert.equal(oldCause.listenerCount(), 1);
        await fixture.action('practice-0').emit('click');
        assert.equal(oldCause.listenerCount(), 0, 'Opening another exercise releases the old cause action');
        assertRetiredListeners();
      }
    } finally { fixture.ui.destroy(); }
    assert.equal(fixture.container.children.length, 0);
    assert.ok(fixture.createdNodes.every(node => node.listenerCount() === 0));
  });

  test('destroy cancels pending visitor-download timers and revokes each temporary URL once', async t => {
    const pending = new Set(); const urls = []; const revoked = [];
    const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { value: { origin: 'http://localhost:8765' }, configurable: true });
    t.after(() => { if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else delete globalThis.location; });
    t.mock.method(globalThis, 'setTimeout', (_fn, delay) => { assert.equal(delay, 1000); const token = {}; pending.add(token); return token; });
    t.mock.method(globalThis, 'clearTimeout', token => { pending.delete(token); });
    t.mock.method(URL, 'createObjectURL', blob => { assert.ok(blob.size > 0); const url = `blob:boundary-download-${urls.length + 1}`; urls.push(url); return url; });
    t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); });
    const fixture = uiFixture({ scope: 'local' });
    try {
      await fixture.action('migration-export').emit('click');
      await fixture.action('migration-export').emit('click');
      const links = fixture.createdNodes.filter(node => node.tagName === 'A');
      assert.equal(links.length, 2); assert.ok(links.every(link => link.clickCount === 1));
      assert.equal(pending.size, 2); assert.deepEqual(revoked, []);
      fixture.ui.destroy();
      assert.equal(pending.size, 0, 'Downloads must not retain delayed callbacks after unmount');
      assert.deepEqual(revoked, urls); assert.ok(links.every(link => link.removeCount === 1));
      assert.equal(fixture.container.children.length, 0);
      assert.ok(fixture.createdNodes.every(node => node.listenerCount() === 0));
      fixture.ui.destroy(); assert.deepEqual(revoked, urls, 'Repeated destroy does not revoke the same URL twice');
    } finally { fixture.ui.destroy(); }
  });
}
