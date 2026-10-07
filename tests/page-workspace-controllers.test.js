// Actual mounted controllers; DOM/media/network alone are deterministic doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page');
const { createGeometryHarness } = require('./helpers/fake-geometry-page');

function medium(sample = 'parabola', generation = 1) {
  const source = { id: 'file-workspace-fixture', version: '1' };
  return { generation, owner: 'local:guest:0', source, selection: { source, name: 'fixture.mp4' }, sample };
}
async function openCurve(h) {
  h.page.onMediaChange(medium()); h.video.src = 'blob:workspace-fixture'; h.ready();
  h.elements['wake-button'].dispatch('click'); await flush();
  assert.ok(h.overlay());
}

test('borrowed curve invalidates published scenes on exit, playback, seeking, hiding and render failure; reset republishes original', async () => {
  for (const action of ['exit', 'play', 'seek', 'hide', 'render-failure']) {
    const scenes = []; const h = await createHarness({ pageOptions: { onScene: value => scenes.push(value), canRead: () => false } });
    try {
      await openCurve(h);
      h.elements['parameter-h'].value = '2'; h.elements['parameter-h'].dispatch('input');
      assert.equal(scenes.at(-1).snapshot.h, 2);
      h.elements['reset-button'].dispatch('click');
      assert.equal(scenes.at(-1).snapshot.h, 0, 'Reset preserves a fresh confirmed scene after state callbacks');
      if (action === 'exit') h.elements['exit-button'].dispatch('click');
      if (action === 'play') { h.video.paused = false; h.video.dispatch('play'); }
      if (action === 'seek') { h.video.seeking = true; h.video.dispatch('seeking'); }
      if (action === 'hide') { h.page.setActive(false); h.page.setActive(true); }
      if (action === 'render-failure') { h.video.rect = { left: 0, top: 0, width: 0, height: 0 }; h.win.dispatch('resize'); }
      assert.equal(scenes.at(-1), null, action + ' clears downstream real-time rendering and save state');
      assert.equal(h.overlay(), null, action + ' removes the source overlay');
      if (action !== 'render-failure') {
        h.video.paused = true; h.video.seeking = false; h.video.currentTime = 6; h.video.dispatch('pause');
        h.elements['wake-button'].dispatch('click'); await flush();
        assert.equal(scenes.at(-1)?.confirmed, true, 'Only a fresh explicit wake republishes a scene');
      }
    } finally { h.page.destroy(); h.restore(); }
  }
});

test('borrowed curve fixes same-origin reader without reading or mutating legacy address memory or pre-reading metadata', async () => {
  const storageCalls = []; const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(name => [name, (...args) => { storageCalls.push([name, ...args]); return 'http://127.0.0.1:8787/read'; }]));
  let permitted = false;
  const endpoint = 'http://localhost:8765/read';
  const h = await createHarness({ storage, pageOptions: { fixedReaderEndpoint: endpoint, canRead: () => permitted } });
  const postCalls = []; const baseFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { if (init?.method === 'POST') { postCalls.push(String(url)); return Promise.resolve({ ok: false, status: 503 }); } return baseFetch(url, init); };
  try {
    assert.equal(h.elements['lesson-endpoint'].value, endpoint);
    assert.equal(h.elements['lesson-endpoint'].readOnly, true);
    h.page.onMediaChange(medium(null)); h.video.src = 'blob:workspace-fixture'; h.ready();
    h.elements['lesson-endpoint'].value = 'http://127.0.0.1:8787/read';
    h.elements['lesson-endpoint'].dispatch('input'); h.elements['lesson-endpoint'].dispatch('change');
    h.advance(300); await flush(); assert.deepEqual(postCalls, []);
    h.elements['wake-button'].dispatch('click'); await flush(); assert.deepEqual(postCalls, [], 'No permission means no request');
    permitted = true; h.video.dispatch('loadedmetadata'); await flush();
    assert.deepEqual(postCalls, [], 'Metadata and fixed address never start old pre-reading in a mounted workspace');
    h.elements['wake-button'].dispatch('click'); await flush(); await flush();
    assert.deepEqual(postCalls, [endpoint], 'An explicit permitted frame request ignores an altered readonly field');
    assert.deepEqual(storageCalls, []);
  } finally { h.page.destroy(); h.restore(); }
});

test('borrowed geometry locks same-origin read/ask and disables address memory/forget while retaining consent', () => {
  let permitted = false;
  const h = createGeometryHarness({ borrowedVideo: true, storageValues: { 'breakglass.geometryReader': 'http://127.0.0.1:8787' }, pageOptions: { fixedReaderEndpoint: 'http://localhost:8765', canRead: () => permitted } });
  try {
    assert.equal(h.elements['reader-url'].value, 'http://localhost:8765');
    assert.equal(h.elements['reader-url'].readOnly, true);
    assert.equal(h.elements['reader-forget'].hidden, true); assert.equal(h.elements['reader-forget'].disabled, true);
    h.page.onMediaChange(medium(null));
    h.elements['reader-url'].value = 'http://127.0.0.1:8787';
    for (const event of ['input', 'change', 'blur']) h.elements['reader-url'].dispatch(event);
    h.elements['reader-forget'].dispatch('click');
    h.elements['recognize-frame'].dispatch('click'); assert.equal(h.requests.length, 0);
    permitted = true; h.elements['recognize-frame'].dispatch('click');
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, 'http://localhost:8765');
    assert.equal(require('../extension/src/geometry-scene/request').buildUrl(h.requests[0].url, 'read'), 'http://localhost:8765/geometry/read');
    h.page.exit(); h.confirmPreset(); h.elements['ask-mode'].value = 'model'; h.elements['question'].value = '把 AB 改成 8'; h.elements['ask-form'].dispatch('submit');
    assert.equal(h.requests.at(-1).kind, 'ask'); assert.equal(h.requests.at(-1).url, 'http://localhost:8765');
    assert.deepEqual(h.storageCalls, [], 'The unified workspace neither restores, stores nor deletes independent-page memory');
    assert.equal(h.storageValues.get('breakglass.geometryReader'), 'http://127.0.0.1:8787');
  } finally { h.page.dispose(); }
});

test('independent geometry retains legacy session address restoration, editing and explicit forget', () => {
  const h = createGeometryHarness({ storageValues: { 'breakglass.geometryReader': 'http://127.0.0.1:8787' } });
  try {
    assert.equal(h.elements['reader-url'].value, 'http://127.0.0.1:8787');
    assert.equal(Boolean(h.elements['reader-url'].readOnly), false); assert.equal(h.elements['reader-forget'].hidden, false);
    h.elements['reader-url'].value = 'http://localhost:8787'; h.elements['reader-url'].dispatch('change');
    assert.equal(h.storageValues.get('breakglass.geometryReader'), 'http://localhost:8787');
    h.elements['reader-forget'].dispatch('click'); assert.equal(h.storageValues.has('breakglass.geometryReader'), false);
  } finally { h.page.dispose(); }
});
