const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeometryHarness: harness, actionContext, deferred, flush } = require('./helpers/fake-geometry-page');
const { requestGeometry } = require('../extension/src/geometry-scene/request');
const READER = 'http://127.0.0.1:8787';

function candidate(request, lengths = { AB: 3, AC: 4 }) {
  const { requestId, videoId, frameTime, frameSize } = request.body;
  return { schemaVersion: '1.0.0', kind: 'right-triangle', requestId, videoId, frameTime, frameSize,
    sceneRevision: 0, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' },
    vertices: { A: { x: 100, y: 250 }, B: { x: 100, y: 100 }, C: { x: 300, y: 250 } },
    lengths, unit: 'unit', source: 'vision', originSource: 'vision', editedByUser: false };
}
function send(h, kind) {
  h.elements['reader-url'].value = READER;
  if (kind === 'read') h.elements['recognize-frame'].dispatch('click');
  else {
    h.elements['ask-mode'].value = 'model'; h.elements.question.value = '把 AB 改成 8';
    h.elements['ask-form'].dispatch('submit');
  }
  return h.requests.at(-1);
}
function succeed(request, value = 8) {
  if (request.kind === 'read') request.onSuccess({ status: 'candidate', scene: candidate(request, { AB: value, AC: 4 }) });
  else request.onSuccess({ status: 'actions', context: actionContext(request), actions: [{ type: 'set_length', side: 'AB', value, unit: 'unit' }] });
}
function controlsIdle(h) {
  assert.equal(h.elements['read-busy'].hidden, true);
  assert.equal(h.elements['read-cancel'].hidden, true);
  assert.equal(h.elements['ask-cancel'].hidden, true);
  assert.equal(h.elements['geometry-stage'].getAttribute('aria-busy'), 'false');
  assert.equal(h.elements['ask-form'].getAttribute('aria-busy'), 'false');
}
function visibleState(h) {
  return { scene: h.page.session.getState(), status: h.elements['page-status'].textContent,
    feedback: h.elements['ask-feedback'].textContent, history: h.elements['ask-log'].textContent };
}
function permissionHarness(extra = {}) {
  const permission = { enabled: true, generation: 0, active: true };
  const h = harness({ ...extra, pageOptions: { canRead: () => permission.enabled,
    getPermissionGeneration: () => permission.generation, isActive: () => permission.active, ...extra.pageOptions } });
  h.loadVideo(); h.confirmPreset();
  return { h, permission };
}

test('independent geometry pages retain explicit reader operations with default permission generation zero', () => {
  const h = harness();
  try {
    h.loadVideo(); const request = send(h, 'read'); succeed(request, 3);
    assert.equal(h.page.session.getState().phase, 'review');
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'confirmed');
    succeed(send(h, 'ask'), 6);
    assert.equal(h.page.getSnapshot().snapshot.AB, 6);
  } finally { h.page.dispose(); }
});

test('stopReader synchronously cancels once, preserves confirmed math and rejects old callbacks after a new operation', () => {
  for (const kind of ['read', 'ask']) {
    const { h, permission } = permissionHarness();
    try {
      const original = h.page.session.getState(), source = h.video.src;
      const old = send(h, kind); let cancellations = 0;
      old.cancel = () => { old.canceled = true; cancellations++; };
      permission.enabled = false; permission.generation++;
      h.page.stopReader('已关闭识别。'); h.page.stopReader('已关闭识别。');
      assert.equal(cancellations, 1); assert.equal(old.canceled, true);
      assert.deepEqual(h.page.session.getState(), original); controlsIdle(h);
      assert.equal(h.video.src, source); assert.deepEqual(h.revokedUrls, []);
      assert.equal(h.elements.question.value, kind === 'ask' ? '把 AB 改成 8' : '');
      permission.enabled = true; permission.generation++;
      const fresh = send(h, kind); assert.notEqual(fresh, old);
      const before = visibleState(h);
      succeed(old); old.onFailure({ code: 'network_error', message: '旧请求迟到失败' });
      assert.deepEqual(visibleState(h), before, 'Old callbacks cannot change math, feedback or the new busy operation');
      assert.equal(h.elements[kind === 'read' ? 'read-cancel' : 'ask-cancel'].hidden, false);
      succeed(fresh, 6);
      assert.equal(h.page.session.getState().scene.lengths.AB, 6);
      assert.equal(h.page.session.getState().phase, kind === 'read' ? 'review' : 'confirmed');
    } finally { h.page.dispose(); }
  }
});

test('a changed permission generation rejects late success and failure even while canRead is true', () => {
  for (const kind of ['read', 'ask']) for (const result of ['success', 'failure']) {
    const { h, permission } = permissionHarness();
    try {
      const original = h.page.session.getState(), request = send(h, kind);
      permission.generation += 2; // A revoke/re-enable cycle need not leave canRead false.
      if (result === 'success') succeed(request);
      else request.onFailure({ code: 'network_error', message: '失效请求错误' });
      assert.equal(request.canceled, true); assert.deepEqual(h.page.session.getState(), original); controlsIdle(h);
      assert.equal(h.elements['read-retry'].hidden, true); assert.equal(h.elements['ask-retry'].hidden, true);
      assert.doesNotMatch(h.elements['page-status'].textContent + h.elements['ask-feedback'].textContent, /失效请求错误/);
    } finally { h.page.dispose(); }
  }
});

test('callbacks recheck current permission and active panel instead of trusting the send-time Boolean', () => {
  for (const kind of ['read', 'ask']) for (const gate of ['enabled', 'active']) {
    const { h, permission } = permissionHarness();
    try {
      const original = h.page.session.getState(), request = send(h, kind);
      permission[gate] = false; succeed(request);
      assert.equal(request.canceled, true); assert.deepEqual(h.page.session.getState(), original); controlsIdle(h);
    } finally { h.page.dispose(); }
  }
});

test('withdrawn vision candidates cannot be confirmed, including edited corrections, while manual work remains usable', () => {
  const { h, permission } = permissionHarness();
  try {
    succeed(send(h, 'read'), 3); assert.equal(h.page.session.getState().phase, 'review');
    h.elements['candidate-ab'].value = '6'; h.elements['candidate-ab'].dispatch('input');
    permission.enabled = false; permission.generation++;
    h.page.stopReader();
    assert.equal(h.page.session.getState().phase, 'empty'); assert.equal(h.page.getSnapshot(), null);
    assert.equal(h.elements['review-panel'].hidden, true); assert.equal(h.elements['frame-markers'].hidden, true);
    assert.equal(h.elements['frame-preview'].hidden, true);
    permission.enabled = true; permission.generation++;
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'empty', 'Re-enabling cannot resurrect the old candidate');
    permission.enabled = false; h.confirmPreset();
    assert.equal(h.page.getSnapshot().snapshot.AB, 3, 'Explicit local conditions do not depend on reader permission');
  } finally { h.page.dispose(); }
});

test('candidate confirmation itself rejects a newer permission generation before any explicit stop hook', () => {
  const { h, permission } = permissionHarness();
  try {
    succeed(send(h, 'read'), 3);
    permission.generation++;
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'empty'); assert.equal(h.page.getSnapshot(), null);
    assert.match(h.elements['page-status'].textContent, /许可|来源/);
  } finally { h.page.dispose(); }
});

test('already confirmed vision mathematics supports local editing and restoring after reader shutdown', () => {
  const { h, permission } = permissionHarness();
  try {
    succeed(send(h, 'read'), 3);
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    const original = h.page.session.getState(); const calls = h.requests.length;
    permission.enabled = false; permission.generation++; h.page.stopReader();
    assert.deepEqual(h.page.session.getState(), original);
    h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
    assert.equal(h.page.getSnapshot().snapshot.AB, 6);
    h.elements['restore-original'].dispatch('click'); assert.equal(h.page.getSnapshot().snapshot.AB, 3);
    send(h, 'read'); send(h, 'ask'); assert.equal(h.requests.length, calls);
    h.elements['ask-mode'].value = 'local'; h.elements.question.value = '把 AB 改成 6'; h.elements['ask-form'].dispatch('submit');
    assert.equal(h.page.getSnapshot().snapshot.AB, 6); assert.equal(h.requests.length, calls);
  } finally { h.page.dispose(); }
});

test('visibility hiding cancels read and ask, blocks new model work and does not restart on restoration', () => {
  for (const kind of ['read', 'ask']) {
    const { h } = permissionHarness();
    try {
      const original = h.page.session.getState(), old = send(h, kind), captures = h.captures.length;
      h.document.hidden = true; h.document.visibilityState = 'hidden'; h.document.dispatch('visibilitychange');
      assert.equal(old.canceled, true); controlsIdle(h);
      send(h, 'read'); send(h, 'ask');
      assert.equal(h.requests.length, 1); assert.equal(h.captures.length, captures);
      assert.deepEqual(h.page.session.getState(), original);
      h.document.hidden = false; h.document.visibilityState = 'visible'; h.document.dispatch('visibilitychange');
      assert.equal(h.requests.length, 1, 'Restoring visibility does not automatically upload or retry');
      const fresh = send(h, kind), before = visibleState(h);
      succeed(old); old.onFailure({ code: 'network_error', message: '隐藏前迟到错误' });
      assert.deepEqual(visibleState(h), before);
      succeed(fresh, 6); assert.equal(h.page.session.getState().scene.lengths.AB, 6);
    } finally { h.page.dispose(); }
  }
});

test('hidden-state return checks do not rely solely on receiving a visibility event', () => {
  for (const kind of ['read', 'ask']) {
    const { h } = permissionHarness();
    try {
      const before = h.page.session.getState(), request = send(h, kind);
      h.document.visibilityState = 'hidden'; succeed(request);
      assert.equal(request.canceled, true); assert.deepEqual(h.page.session.getState(), before);
      send(h, kind); assert.equal(h.requests.length, 1);
    } finally { h.page.dispose(); }
  }
});

test('deactivating and reactivating a panel never revives its previous request or vision candidate', () => {
  const { h } = permissionHarness();
  try {
    const old = send(h, 'read'); h.page.setActive(false); h.page.setActive(true);
    const before = visibleState(h); succeed(old); assert.deepEqual(visibleState(h), before);
    succeed(send(h, 'read'), 3); assert.equal(h.page.session.getState().phase, 'review');
    h.page.setActive(false); h.page.setActive(true);
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'empty');
  } finally { h.page.dispose(); }
});

test('source identity, media generation and account owner/epoch changes retire pending work even at the same video time', () => {
  for (const change of [{ generation: 2 }, { owner: 'account-b' }, { epoch: 2 }, { scope: 'account' },
    { source: { kind: 'manual-notes' } }, { source: { id: 'source-b' } },
    { source: { version: '2' } }, { source: { analysisVersion: '2' } }]) {
    const { h } = permissionHarness();
    try {
      const media = { generation: 1, owner: 'local', epoch: 1, scope: 'local',
        source: { kind: 'self-authored', id: 'source-a', version: '1', analysisVersion: '1' } };
      h.page.onMediaChange(media); h.confirmPreset();
      const request = send(h, 'ask');
      h.page.onMediaChange({ ...media, ...change, source: { ...media.source, ...change.source } });
      assert.equal(request.canceled, true); const before = visibleState(h);
      succeed(request); request.onFailure({ code: 'network_error', message: '旧账号/来源错误' });
      assert.deepEqual(visibleState(h), before); assert.equal(h.page.getSnapshot(), null);
      assert.equal(h.video.currentTime, 6); assert.equal(h.video.paused, true);
    } finally { h.page.dispose(); }
  }
});

test('request identity is a value snapshot even if borrowed media is mutated before its notification', () => {
  for (const kind of ['read', 'ask']) {
    const { h } = permissionHarness();
    try {
      const media = { generation: 1, owner: 'account-a', epoch: 1,
        source: { id: 'source-a', version: '1', analysisVersion: '1' } };
      h.page.onMediaChange(media); h.confirmPreset(); const original = h.page.session.getState();
      const request = send(h, kind); media.epoch = 2; media.source.version = '2';
      succeed(request); assert.equal(request.canceled, true); assert.deepEqual(h.page.session.getState(), original);
    } finally { h.page.dispose(); }
  }
});

test('a permission change during capture/render prevents the frame from being sent', () => {
  let h, armed = false; const permission = { enabled: true, generation: 0 };
  h = harness({ pageOptions: { canRead: () => permission.enabled, getPermissionGeneration: () => permission.generation,
    onScene(scene) { if (armed && scene?.confirmed) { armed = false; permission.enabled = false; permission.generation++; h.page.stopReader(); } } } });
  try {
    h.loadVideo(); h.confirmPreset(); const original = h.page.session.getState(); armed = true;
    send(h, 'read'); assert.equal(h.requests.length, 0);
    assert.deepEqual(h.page.session.getState(), original); controlsIdle(h);
  } finally { h.page.dispose(); }
});

test('stop during synchronous request construction cancels the returned handle and permits a fresh request', () => {
  let h; const requests = [];
  h = harness({ requestGeometry(settings) {
    const request = { ...settings, canceled: false, cancel() { this.canceled = true; } }; requests.push(request);
    if (requests.length === 1) h.page.stopReader();
    return request;
  } });
  try {
    h.loadVideo(); h.elements['reader-url'].value = READER;
    h.elements['recognize-frame'].dispatch('click'); assert.equal(requests[0].canceled, true); controlsIdle(h);
    h.elements['recognize-frame'].dispatch('click'); assert.equal(requests.length, 2);
    const before = visibleState(h); succeed(requests[0]); assert.deepEqual(visibleState(h), before);
    succeed(requests[1], 3); assert.equal(h.page.session.getState().phase, 'review');
  } finally { h.page.dispose(); }
});

test('geometry stopReader reaches the real request AbortSignal and discards an abort-ignoring fetch response', async () => {
  for (const kind of ['read', 'ask']) {
    const fetchResult = deferred(); let signal, settings;
    const { h } = permissionHarness({ requestGeometry(input) {
      settings = input;
      return requestGeometry({ ...input, fetchImpl(_url, init) { signal = init.signal; return fetchResult.promise; } });
    } });
    try {
      const original = h.page.session.getState(); send(h, kind); await flush();
      assert.equal(signal.aborted, false); h.page.stopReader(); assert.equal(signal.aborted, true);
      const scene = kind === 'read' ? candidate(settings) : null;
      const payload = kind === 'read' ? { schemaVersion: '1.0.0', requestId: scene.requestId, videoId: scene.videoId,
        frameTime: scene.frameTime, status: 'candidate', scene }
        : { schemaVersion: '1.0.0', actionRequestId: settings.body.actionRequestId, context: actionContext(settings),
          status: 'actions', actions: [{ type: 'set_length', side: 'AB', value: 8, unit: 'unit' }] };
      const before = visibleState(h); fetchResult.resolve({ ok: true, json: async () => payload }); await flush();
      assert.deepEqual(h.page.session.getState(), original); assert.deepEqual(visibleState(h), before); controlsIdle(h);
    } finally { h.page.dispose(); }
  }
});

test('destroy removes visibility and lifecycle listeners and ignores late callbacks permanently', () => {
  const { h } = permissionHarness();
  const request = send(h, 'ask'), source = h.video.src;
  assert.equal(h.document.listenerCount('visibilitychange'), 1);
  h.page.destroy(); const before = visibleState(h);
  assert.equal(request.canceled, true); assert.equal(h.document.listenerCount('visibilitychange'), 0);
  assert.equal(h.document.listenerCount('keydown'), 0); assert.equal(h.document.listenerCount('fullscreenchange'), 0);
  assert.equal(h.window.listenerCount('pagehide'), 0); assert.equal(h.window.listenerCount('pageshow'), 0);
  assert.equal(h.video.listenerCount('timeupdate'), 0); assert.equal(h.elements['recognize-frame'].listenerCount('click'), 0);
  succeed(request); request.onFailure({ code: 'network_error', message: '销毁后迟到错误' });
  h.document.hidden = true; h.document.dispatch('visibilitychange'); h.page.stopReader(); h.page.destroy();
  assert.deepEqual(visibleState(h), before); assert.deepEqual(h.revokedUrls, [source]);
});
