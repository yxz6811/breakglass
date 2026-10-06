const test = require('node:test');
const assert = require('node:assert/strict');
const records = require('../learning-site/records');
const math = require('../learning-site/math-learning');
const { mount } = require('../learning-site/math-workbench');

// The actual workbench and math/store execute; this DOM is a deterministic event double.
// Actual website/browser visual checks are separate integration evidence.
function element(tag = 'div') {
  const handlers = new Map(); let text = '', html = '';
  const el = { tagName: tag.toUpperCase(), className: '', dataset: {}, children: [], parentElement: null, value: '', disabled: false, hidden: false,
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    async emit(name) { for (const fn of [...(handlers.get(name) || [])]) await fn({ preventDefault() {} }); },
    append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
    replaceChildren(...nodes) { text = ''; html = ''; this.children.forEach((n) => { n.parentElement = null; }); this.children = []; this.append(...nodes); },
    setAttribute(name, value) { this[name] = value; }, countListeners() { return [...handlers.values()].reduce((n, set) => n + set.size, 0); }
  };
  Object.defineProperty(el, 'textContent', { get: () => text + el.children.map((n) => n.textContent).join(''), set: (v) => { el.replaceChildren(); text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { el.replaceChildren(); html = String(v); } });
  Object.defineProperty(el, 'valueAsNumber', { get: () => el.value.trim() === '' ? NaN : Number(el.value) });
  return el;
}
function all(el) { return [el, ...el.children.flatMap(all)]; }
function harness(options = {}) {
  const values = new Map(); let counter = 0; let owner = 'guest-epoch-0';
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const store = records.createLocalStore({ getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    { id: uuid, now: () => new Date(Date.UTC(2026, 9, 7, 0, 0, counter)).toISOString() });
  const container = element(); let saves = 0, submissions = 0;
  const document = element('document'); document.hidden = false; document.defaultView = element('window'); document.defaultView.devicePixelRatio = 1;
  document.createElement = (tag) => { const el = element(tag); el.ownerDocument = document;
    if (tag === 'canvas') { el.width = 640; el.height = 360; el.getContext = () => options.gl || null; el.getBoundingClientRect = () => ({ width: 640, height: 360 }); }
    return el; };
  const ui = mount(container, { document, id: uuid, now: () => '2026-10-07T00:00:00.000Z',
    getState: () => store.read(), getOwner: () => owner,
    saveRecord: async (record) => { saves += 1; return options.save ? options.save(record) : store.save(record); },
    submitAttempt: async (record, answer, hint) => { submissions += 1; return store.attempt(record.id, answer, hint); } });
  const action = (name) => all(container).find((n) => n.dataset.mathAction === name);
  const answer = (key = 'number') => all(container).find((n) => n.dataset.mathAnswer === key);
  const parameter = (key) => all(container).find((n) => n.dataset.mathParameter === key);
  return { ui, container, document, store, action, answer, parameter, setOwner: (v) => { owner = v; },
    saveCount: () => saves, submitCount: () => submissions, submit: () => all(container).find((n) => n.tagName === 'FORM').emit('submit') };
}

test('manual choice creates actual mathematics, saves conditions and submits actual wrong/independent answers', async () => {
  const f = harness(); assert.equal(f.saveCount(), 0); assert.equal(f.submitCount(), 0);
  assert.match(f.container.textContent, /待验证/); f.action('template').value = 'circle'; await f.action('new').emit('click');
  assert.equal(f.action('submit').disabled, true); assert.match(all(f.container).find((n) => n.className === 'math-svg').innerHTML, /<svg/);
  await f.action('save').emit('click'); assert.equal(f.store.read().records[0].template, 'circle'); assert.equal(f.action('submit').disabled, false);
  f.answer().value = '3'; await f.submit(); assert.equal(f.store.read().attempts[0].outcome, 'wrong');
  f.answer().value = String(9 * Math.PI); await f.submit(); assert.equal(f.store.read().attempts[1].outcome, 'correct_independent');
  assert.match(f.container.textContent, /最近一次独立正确/); assert.equal(f.store.read().records.length, 1); f.ui.destroy();
});

test('diagnostic old/new templates are optional, distinct from ordinary practice and no action implies mastery', async () => {
  const f = harness(); await f.action('diagnostic-coordinate-vertex').emit('click');
  assert.equal(f.store.read().records.length, 0); await f.action('save').emit('click');
  f.answer('h').value = '-2'; f.answer('k').value = '3'; await f.submit();
  assert.equal(f.store.read().attempts[0].outcome, 'correct_independent');
  assert.match(f.store.read().records[0].source.id, /^diagnostic-coordinate-vertex-/);
  const node = math.learningGraph(f.store.read()).find((n) => n.id === 'coordinate-vertex');
  assert.equal(node.diagnosticCount, 1); assert.equal(node.practiceCount, 0);
  const before = f.store.read().attempts.length;
  await f.action('diagnostic-sine-period').emit('click'); await f.action('predict-decrease').emit('click');
  await f.action('skip').emit('click'); assert.equal(f.store.read().attempts.length, before); f.ui.destroy();
});

test('hint/answer usage cannot count as independent, fading can be overridden, and two saved histories extend review', async () => {
  const f = harness(); await f.action('new').emit('click'); await f.action('save').emit('click');
  f.answer().value = '1'; await f.action('hint').emit('click'); await f.submit();
  assert.equal(f.store.read().attempts[0].outcome, 'correct_with_hint');
  const record = f.store.read().records[0]; f.ui.open(record); f.answer().value = '1'; await f.submit();
  f.ui.open(record); f.answer().value = '1'; await f.submit(); f.ui.open(record);
  assert.equal(f.action('hint').dataset.suggested, '1'); assert.equal(f.action('more-hints').hidden, false);
  await f.action('more-hints').emit('click'); assert.equal(f.action('hint').dataset.suggested, '3');
  await f.action('answer').emit('click'); f.answer().value = '1'; await f.submit();
  assert.equal(f.store.read().attempts.at(-1).outcome, 'correct_with_hint'); f.ui.destroy();
});

test('parameter exploration and variants create independent records, reject invalid shapes and preserve original math', async () => {
  const f = harness(); f.action('template').value = 'similar-triangles'; await f.action('new').emit('click'); await f.action('save').emit('click');
  const original = f.store.read().records[0]; f.parameter('c').value = '9'; await f.parameter('c').emit('input'); await f.action('apply').emit('click');
  assert.match(f.action('status').textContent, /三角不等式/); assert.equal(f.action('submit').disabled, true); assert.deepEqual(f.store.read().records[0], original);
  await f.action('restore').emit('click'); f.parameter('scale').value = '3'; await f.parameter('scale').emit('input'); await f.action('apply').emit('click');
  await f.action('save').emit('click'); assert.equal(f.store.read().records.length, 2); assert.equal(f.store.read().records[1].snapshot.scale, 3);
  assert.deepEqual(f.store.read().records[0], original); await f.action('variant').emit('click'); assert.equal(f.action('submit').disabled, true);
  await f.action('save').emit('click'); assert.equal(f.store.read().records.length, 3); assert.match(f.store.read().records[2].sourceLabel, /非AI/); f.ui.destroy();
});

test('account changes discard delayed success and removed dynamic controls release event handlers', async () => {
  let release; const wait = new Promise((resolve) => { release = resolve; }); const f = harness({ save: () => wait });
  await f.action('new').emit('click'); const oldParameter = f.parameter('b'); const saving = f.action('save').emit('click');
  f.setOwner('account-new-epoch-1'); f.ui.refresh(); release(); await saving;
  assert.equal(f.action('submit').disabled, true); assert.match(f.action('status').textContent, /选择一个手工模板/);
  await f.action('new').emit('click'); assert.equal(oldParameter.countListeners(), 0);
  const oldGraph = f.action('diagnostic-circle-area'); f.ui.refresh(); assert.equal(oldGraph.countListeners(), 0);
  const current = all(f.container); f.ui.destroy(); assert.ok(current.every((n) => n.countListeners() === 0));
});

test('optional particle failure retains actual SVG/practice and new scene/account exit destroys the old renderer', async () => {
  const f = harness(); f.action('template').value = 'cuboid'; await f.action('new').emit('click');
  assert.equal(all(f.container).filter((n) => n.tagName === 'CANVAS').length, 0);
  const svg = all(f.container).find((n) => n.className === 'math-svg').innerHTML;
  await f.action('particles').emit('click'); const canvas = all(f.container).find((n) => n.tagName === 'CANVAS');
  assert.equal(canvas.hidden, true); assert.match(f.container.textContent, /粒子视图不可用/);
  assert.equal(all(f.container).find((n) => n.className === 'math-svg').innerHTML, svg);
  assert.equal(f.action('camera-yaw').disabled, true); assert.ok(canvas.countListeners() > 0);
  await f.action('save').emit('click'); f.answer().value = '24'; await f.submit(); assert.equal(f.store.read().attempts.at(-1).correct, true);
  await f.action('new').emit('click'); assert.equal(canvas.countListeners(), 0);
  await f.action('particles').emit('click'); const second = all(f.container).find((n) => n.tagName === 'CANVAS');
  f.setOwner('different-account'); f.ui.refresh(); assert.equal(second.countListeners(), 0);
  assert.equal(f.document.countListeners() + f.document.defaultView.countListeners(), 0); f.ui.destroy();
});
