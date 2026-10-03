const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../extension/demo/geometry.html'), 'utf8');

const { createGeometryHarness: harness, actionContext, flush } = require('./helpers/fake-geometry-page');

test('page confirms explicit preset, computes single-side changes and restores original', () => {
  const h = harness();
  try {
    h.elements['preset-button'].dispatch('click');
    assert.equal(h.elements['experiment-panel'].hidden, true);
    assert.match(h.elements['source-label'].textContent, /预设演示.*待校对/);
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.elements['bc-value'].textContent, '5');
    h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    assert.equal(h.page.session.getState().scene.lengths.AC, 4);
    const revision = h.page.session.getState().scene.sceneRevision;
    h.elements['restore-original'].dispatch('click');
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.page.session.getState().scene.sceneRevision, revision + 1);
  } finally { h.page.dispose(); }
});

test('field validation keeps invalid input and requires explicit condition confirmation', () => {
  const h = harness();
  try {
    h.elements['manual-button'].dispatch('click');
    h.elements['candidate-ab'].value = '-3'; h.elements['candidate-ac'].value = '4'; h.elements['review-form'].dispatch('submit');
    assert.equal(h.elements['candidate-ab'].value, '-3');
    assert.match(h.elements['candidate-ab-error'].textContent, /正的有限/);
    assert.equal(h.elements['review-error'].focused, true);
    assert.equal(h.elements['experiment-panel'].hidden, true);
    h.elements['candidate-ab'].value = '3'; h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    h.elements['experiment-ac'].value = '0'; h.elements['ac-form'].dispatch('submit');
    assert.equal(h.elements['experiment-ac'].value, '0');
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.ok(h.elements['ac-error'].textContent);
  } finally { h.page.dispose(); }
});

test('local Chinese question uses the same model and model mode never silently uses local commands', () => {
  const h = harness();
  try {
    h.confirmPreset();
    h.elements['question'].value = '把 AB 改成 6，AC 不变，BC 是多少？'; h.elements['ask-form'].dispatch('submit');
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    assert.match(h.elements['ask-feedback'].textContent, /本地受限指令/);
    h.elements['ask-mode'].value = 'model'; h.elements['question'].value = '把 AB 改成 8'; h.elements['ask-form'].dispatch('submit');
    assert.equal(h.requests.length, 0);
    assert.match(h.elements['ask-feedback'].textContent, /未调用模型/);
    assert.equal(h.page.session.getState().scene.lengths.AB, 6);
  } finally { h.page.dispose(); }
});

test('quiz supports wrong, retry, correct and skip; returning video does not require passing', async () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const question = '把 AB 改成 6，AC 不变，BC 是多少？';
    h.elements['question'].value = question; h.elements['ask-form'].dispatch('submit');
    assert.match(h.elements['ask-feedback'].textContent, /7\.211/);
    h.elements['quiz-answer'].value = 'all'; h.elements['quiz-check'].dispatch('click'); assert.match(h.elements['quiz-feedback'].textContent, /不正确/);
    h.elements['quiz-retry'].dispatch('click'); h.elements['quiz-answer'].value = 'fixed'; h.elements['quiz-check'].dispatch('click'); assert.match(h.elements['quiz-feedback'].textContent, /本次回答正确/);
    h.elements['quiz-skip'].dispatch('click'); assert.match(h.elements['quiz-feedback'].textContent, /未验证/);
    h.video.currentTime = 9; h.elements['return-video'].dispatch('click'); await flush();
    assert.equal(h.video.currentTime, 6); assert.equal(h.video.paused, false); assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.elements['triangle-board'].getAttribute('aria-label'), '确认条件后显示直角三角形');
    assert.equal(h.elements['triangle-board'].children.length, 0);
    assert.equal(h.elements['ask-feedback'].textContent, '');
    assert.equal(h.elements['explanation'].textContent, '');
    assert.equal(h.elements['question'].value, question);
    h.confirmPreset();
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.elements['ask-feedback'].textContent, '');
    assert.doesNotMatch(h.elements['explanation'].textContent, /7\.211/);
    assert.equal(h.elements['question'].value, question);
  } finally { h.page.dispose(); }
});

test('canceled or stale model actions cannot replace a manually modified scene', () => {
  const h = harness();
  try {
    h.confirmPreset(); h.elements['reader-url'].value = 'http://127.0.0.1:8787'; h.elements['ask-mode'].value = 'model'; h.elements['question'].value = '把 AB 改成 8'; h.elements['ask-form'].dispatch('submit');
    const request = h.requests[0]; assert.equal(h.elements['ask-cancel'].hidden, false);
    h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
    request.onSuccess({ status: 'actions', context: actionContext(request), actions: [{ type: 'set_length', side: 'AB', value: 8, unit: 'unit' }] });
    assert.equal(request.canceled, true); assert.equal(h.page.session.getState().scene.lengths.AB, 6);
    assert.equal(h.elements['bc-value'].textContent, '7.211');
  } finally { h.page.dispose(); }
});

test('actual frame candidate point correction retains vision origin and confirmed snapshot', () => {
  const h = harness();
  try {
    h.loadVideo(); assert.equal(h.requests.length, 0, 'merely pausing/loading must not send a frame');
    h.elements['reader-url'].value = 'http://127.0.0.1:8787'; h.elements['recognize-frame'].dispatch('click');
    const request = h.requests[0];
    const candidate = { schemaVersion: '1.0.0', kind: 'right-triangle', requestId: request.body.requestId, videoId: request.body.videoId, frameTime: 6, frameSize: { width: 640, height: 360 }, sceneRevision: 0, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, vertices: { A: { x: 100, y: 250 }, B: { x: 100, y: 100 }, C: { x: 300, y: 250 } }, lengths: { AB: 3, AC: 4 }, unit: 'unit', source: 'vision', originSource: 'vision', editedByUser: false };
    request.onSuccess({ status: 'candidate', scene: candidate });
    assert.equal(h.elements['frame-markers'].hidden, false); assert.equal(h.elements['position-panel'].hidden, false);
    h.elements['candidate-b-y'].value = ''; h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'review'); assert.equal(h.elements['candidate-b-y'].value, ''); assert.match(h.elements['position-error'].textContent, /空白不能当作 0/);
    h.elements['candidate-b-y'].value = '90'; h.elements['candidate-b-y'].dispatch('input');
    assert.match(h.elements['frame-markers'].children[0].getAttribute('points'), /100,90/);
    h.elements['candidate-b-y'].value = '90'; h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    const state = h.page.session.getState(); assert.equal(state.scene.source, 'manual'); assert.equal(state.scene.originSource, 'vision'); assert.equal(state.original.vertices.B.y, 90);
    assert.match(h.elements['source-label'].textContent, /真实识别候选.*已校对/);
  } finally { h.page.dispose(); }
});

test('editing an input cancels pending model actions before submitting a change', () => {
  const h = harness();
  try {
    h.confirmPreset(); h.elements['reader-url'].value = 'http://127.0.0.1:8787'; h.elements['ask-mode'].value = 'model'; h.elements['question'].value = '把 AB 改成 8'; h.elements['ask-form'].dispatch('submit');
    const request = h.requests[0]; h.elements['experiment-ab'].value = '6'; h.elements['experiment-ab'].dispatch('input');
    request.onSuccess({ status: 'actions', context: actionContext(request), actions: [{ type: 'set_length', side: 'AB', value: 8, unit: 'unit' }] });
    assert.equal(request.canceled, true); assert.equal(h.page.session.getState().scene.lengths.AB, 3); assert.equal(h.elements['experiment-ab'].value, '6');
    assert.match(h.elements['ask-feedback'].textContent, /条件尚未改变/);
  } finally { h.page.dispose(); }
});

test('a current read response for an invalid frame cleans up pending controls', () => {
  const h = harness();
  try {
    h.loadVideo(); h.elements['reader-url'].value = 'http://127.0.0.1:8787'; h.elements['recognize-frame'].dispatch('click');
    const request = h.requests[0]; h.video.currentTime = 8; request.onSuccess({ status: 'candidate', scene: null });
    assert.equal(request.canceled, true); assert.equal(h.elements['read-cancel'].hidden, true); assert.equal(h.elements['recognize-frame'].disabled, false);
    assert.match(h.elements['page-status'].textContent, /旧识别结果已拒绝/);
  } finally { h.page.dispose(); }
});

test('dragging uses uniform SVG scale including centered letterboxing', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const svg = h.elements['triangle-board']; svg.rect = { left: 0, top: 0, width: 840, height: 300 };
    const handle = svg.children.find((child) => child.getAttribute('aria-label')?.startsWith('调整 AB'));
    handle.dispatch('pointerdown', { pointerId: 1, button: 0 });
    // 3/4 model: A=(127.5,260), B=(292.5,260). A centered 420px viewBox starts at x=210.
    svg.dispatch('pointermove', { pointerId: 1, clientX: 502.5, clientY: 260 });
    assert.equal(h.page.session.getState().scene.lengths.AB, 3);
    svg.dispatch('pointerup', { pointerId: 1 });
  } finally { h.page.dispose(); }
});

test('HTML keeps local script order, visible labels and standalone narrow-screen layout', () => {
  const order = [...html.matchAll(/<script defer src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order.map((item) => path.basename(item)), ['validate.js', 'solve.js', 'actions.js', 'session.js', 'frame.js', 'request.js', 'magnify.js', 'liquid-glass.js', 'view.js', 'geometry.js']);
  assert.equal(/<script[^>]*>(?!\s*<\/script>)/.test(html), false);
  assert.match(html, /for="candidate-b-y"/);
  const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(stylesheets, ['../src/ui/theme.css', '../src/ui/dock.css', './geometry.css']);
  assert.match(html, /class="workspace-nav" aria-label="工作台切换"/);
  assert.match(html, /href="\.\/geometry\.html" aria-current="page"/);
  const css = fs.readFileSync(path.join(__dirname, '../extension/demo/geometry.css'), 'utf8');
  const shared = fs.readFileSync(path.join(__dirname, '../extension/src/ui/theme.css'), 'utf8');
  assert.match(shared, /min-height:\s*44px/); assert.match(shared, /prefers-reduced-motion/); assert.match(css, /max-width:\s*720px/);
});

test('SVG keyboard adjustment preserves focus on the same side after every render', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const svg = h.elements['triangle-board'];
    const handle = svg.children.find((child) => child.getAttribute('data-side') === 'AB');
    handle.focus(); handle.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(svg.getAttribute('role'), 'group');
    assert.notEqual(h.document.activeElement, handle);
    assert.equal(h.document.activeElement.getAttribute('data-side'), 'AB');
    h.document.activeElement.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(Math.abs(h.page.session.getState().scene.lengths.AB - 3.2) < 1e-12);
    assert.equal(h.document.activeElement.getAttribute('data-side'), 'AB');
  } finally { h.page.dispose(); }
});

test('long vertex labels use compact symbols plus a complete wrapping mapping', () => {
  const h = harness();
  try {
    h.elements['preset-button'].dispatch('click');
    const longLabel = '这是用于校对的完整十六字顶点名称';
    assert.equal(Array.from(longLabel).length, 16);
    h.elements['label-b'].value = longLabel;
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    const svg = h.elements['triangle-board'];
    const labels = svg.children.filter((child) => child.getAttribute('class') === 'triangle-label');
    const label = labels.find((child) => child.getAttribute('aria-label') === `B：${longLabel}`);
    // SVG textContent also includes <title>; the visible text node remains compact.
    assert.equal(label.childNodes[0].nodeType, 3);
    assert.equal(label.childNodes[0].textContent, 'B'); assert.equal(label.children[0].textContent, `B：${longLabel}`);
    assert.equal(h.elements['label-map'].hidden, false);
    assert.ok(h.elements['label-map'].children.some((child) => child.textContent === longLabel));
    const AB = svg.children.find((child) => child.getAttribute('class') === 'triangle-side-label' && child.textContent.startsWith('AB '));
    assert.ok(Number(AB.getAttribute('y')) < Number(label.getAttribute('y')) - 20);
  } finally { h.page.dispose(); }
});

test('very short AB keeps vertex labels apart and edge readings on another baseline', () => {
  const h = harness();
  try {
    h.confirmPreset(); h.elements['experiment-ab'].value = '0.001'; h.elements['ab-form'].dispatch('submit');
    const svg = h.elements['triangle-board'];
    const labels = svg.children.filter((child) => child.getAttribute('class') === 'triangle-label');
    const A = labels.find((child) => child.getAttribute('aria-label') === 'A：A');
    const B = labels.find((child) => child.getAttribute('aria-label') === 'B：B');
    assert.ok(Number(B.getAttribute('x')) - Number(A.getAttribute('x')) >= 28);
    assert.equal(A.getAttribute('text-anchor'), 'end'); assert.equal(B.getAttribute('text-anchor'), 'start');
    const AB = svg.children.find((child) => child.getAttribute('class') === 'triangle-side-label' && child.textContent.startsWith('AB '));
    assert.ok(Number(A.getAttribute('y')) - Number(AB.getAttribute('y')) >= 30);
    assert.equal(h.elements['label-map'].hidden, true);
  } finally { h.page.dispose(); }
});
