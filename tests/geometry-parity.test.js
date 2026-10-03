const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGeometryHarness: harness, deferred, flush, actionContext } = require('./helpers/fake-geometry-page');
const { clips } = require('../extension/src/page/geometry');

const STORAGE_KEY = 'breakglass.geometryReader';
const READER = 'http://127.0.0.1:8787';
function question(h, text, mode = 'local') {
  h.elements['ask-mode'].value = mode;
  h.elements.question.value = text;
  h.elements['ask-form'].dispatch('submit');
}
function pendingAsk(h, text = '把 AB 改成 8') {
  h.elements['reader-url'].value = READER;
  question(h, text, 'model');
  return h.requests.at(-1);
}
function answer(request, value = 8) {
  request.onSuccess({ status: 'actions', context: actionContext(request), actions: [{ type: 'set_length', side: 'AB', value, unit: 'unit' }] });
}
function candidate(request, lengths = { AB: 3, AC: 4 }) {
  const { requestId, videoId, frameTime, frameSize, sceneRevision } = request.body;
  return { schemaVersion: '1.0.0', kind: 'right-triangle', requestId, videoId, frameTime, frameSize, sceneRevision,
    rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, lengths, unit: 'unit',
    vertices: { A: { x: 100, y: 250 }, B: { x: 100, y: 100 }, C: { x: 300, y: 250 } },
    source: 'vision', originSource: 'vision', editedByUser: false };
}
function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]); }
function chooseClip(h, id) {
  h.elements['geometry-video-select'].value = id;
  h.elements['geometry-video-select'].dispatch('change');
}
function loadClip(h, id) {
  chooseClip(h, id);
  h.elements['geometry-video-load'].dispatch('click');
  h.video.duration = 14; h.video.readyState = 2;
  h.video.dispatch('loadedmetadata'); h.video.dispatch('canplay');
}

test('the three teaching clips point to bundled MP4 files with distinct known triangle conditions', () => {
  assert.deepEqual(clips.map(({ id, AB, AC, BC, unit, target }) => ({ id, AB, AC, BC, unit, target })), [
    { id: '3-4-5', AB: 3, AC: 4, BC: 5, unit: 'cm', target: 4 },
    { id: '5-12-13', AB: 5, AC: 12, BC: 13, unit: 'cm', target: 4 },
    { id: '8-15-17', AB: 8, AC: 15, BC: 17, unit: 'cm', target: 4 }
  ]);
  for (const clip of clips) {
    const asset = path.resolve(__dirname, '../extension/demo', clip.path);
    assert.ok(asset.startsWith(path.resolve(__dirname, '../extension/assets/video/geometry') + path.sep));
    const bytes = fs.readFileSync(asset);
    assert.ok(bytes.length > 32, `${clip.id}: nonempty media asset`);
    assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', `${clip.id}: ISO base media file header`);
    assert.ok(bytes.readUInt32BE(0) >= 16, `${clip.id}: complete file-type box`);
  }
});

test('choosing a teaching clip only changes its description until explicit loading', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h), before = h.page.session.getState();
    const source = h.video.src, loads = h.mediaCalls.load, captures = h.captures.length;
    chooseClip(h, '8-15-17');
    assert.match(h.elements['geometry-video-summary'].textContent, /AB = 8.*AC = 15/);
    assert.equal(h.video.src, source);
    assert.deepEqual(h.page.session.getState(), before);
    assert.equal(request.canceled, false);
    assert.equal(h.mediaCalls.load, loads);
    assert.equal(h.mediaCalls.play, 0);
    assert.equal(h.captures.length, captures);
    assert.equal(h.requests.length, 1);
  } finally { h.page.dispose(); }
});

test('loading a teaching clip retires old requests and metadata only pauses at the question frame', () => {
  for (const kind of ['read', 'ask']) {
    const h = harness();
    try {
      h.loadVideo(); h.confirmPreset();
      let old;
      if (kind === 'read') {
        h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click');
        old = h.requests.at(-1);
      } else old = pendingAsk(h);
      const source = h.video.src, captures = h.captures.length, loads = h.mediaCalls.load;
      chooseClip(h, '5-12-13'); h.elements['geometry-video-load'].dispatch('click');
      assert.notEqual(h.video.src, source);
      assert.equal(h.video.src, '../assets/video/geometry/triangle-5-12-13.mp4');
      assert.equal(h.mediaCalls.load, loads + 1);
      assert.equal(old.canceled, true);
      assert.equal(h.page.session.getState().phase, 'empty');
      assert.equal(h.page.session.getState().original, null);
      assert.equal(h.elements['ask-log'].children.length, 0);
      assert.equal(h.elements['frame-preview'].hidden, true);
      h.video.duration = 14; h.video.dispatch('loadedmetadata');
      h.video.dispatch('seeked');
      assert.equal(h.video.currentTime, 4);
      assert.equal(h.video.paused, true);
      assert.equal(h.elements['geometry-target'].value, '4');
      assert.equal(h.captures.length, captures, 'loading/metadata does not capture the frame');
      assert.equal(h.requests.length, 1, 'loading/metadata does not call recognition');
      assert.equal(h.mediaCalls.play, 0, 'loading/metadata does not start playback');
      if (kind === 'read') old.onSuccess({ status: 'candidate', scene: candidate(old) });
      else answer(old);
      assert.equal(h.page.session.getState().phase, 'empty', 'late work from the old video cannot create a scene');
    } finally { h.page.dispose(); }
  }
});

test('each loaded sample requires confirmation and restores its own conditions before returning to four seconds', async () => {
  for (const sample of [
    { id: '3-4-5', AB: 3, AC: 4, BC: '5' },
    { id: '5-12-13', AB: 5, AC: 12, BC: '13' },
    { id: '8-15-17', AB: 8, AC: 15, BC: '17' }
  ]) {
    const h = harness();
    try {
      loadClip(h, sample.id);
      assert.equal(h.video.currentTime, 4);
      assert.equal(h.elements['preset-button'].disabled, false);
      assert.equal(h.captures.length, 0);
      assert.equal(h.requests.length, 0);
      h.elements['preset-button'].dispatch('click');
      const review = h.page.session.getState();
      assert.equal(review.phase, 'review');
      assert.deepEqual(review.scene.lengths, { AB: sample.AB, AC: sample.AC });
      assert.equal(review.scene.unit, 'cm');
      assert.equal(h.elements['candidate-unit'].value, 'cm');
      assert.equal(review.scene.source, 'preset');
      assert.equal(review.scene.frameTime, 4);
      assert.equal(review.original, null);
      assert.equal(review.result, null);
      assert.equal(h.elements['right-angle-check'].checked, false);
      assert.equal(h.elements['experiment-panel'].hidden, true);
      assert.equal(h.elements['experiment-ab-range'].disabled, true);
      assert.equal(h.elements['ask-submit'].disabled, true);
      h.elements['experiment-ab'].value = '100'; h.elements['ab-form'].dispatch('submit');
      assert.deepEqual(h.page.session.getState(), review, 'an unconfirmed sample cannot be edited');
      h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
      assert.equal(h.elements['bc-value'].textContent, sample.BC);
      assert.deepEqual(h.page.session.getState().original.lengths, { AB: sample.AB, AC: sample.AC });
      assert.equal(h.page.session.getState().scene.unit, 'cm');
      assert.equal(h.page.session.getState().original.unit, 'cm');
      assert.equal(h.elements['result-unit'].textContent, 'cm');
      const confirmed = h.page.session.getState();
      h.elements['ask-example-change'].dispatch('click');
      assert.equal(h.elements.question.value, `把 AB 改成 ${sample.AB * 2}，AC 不变，BC 是多少？`);
      assert.deepEqual(h.page.session.getState(), confirmed, 'a sample-aware question remains a draft until submission');
      assert.equal(h.elements['ask-log'].children.length, 0);
      h.elements['experiment-ab'].value = String(sample.AB + 1); h.elements['ab-form'].dispatch('submit');
      assert.equal(h.page.session.getState().scene.lengths.AC, sample.AC);
      h.elements['geometry-restore'].dispatch('click');
      assert.deepEqual(h.page.session.getState().scene.lengths, { AB: sample.AB, AC: sample.AC });
      assert.equal(h.elements['bc-value'].textContent, sample.BC);
      assert.equal(h.page.session.getState().scene.unit, 'cm');
      assert.equal(h.page.session.getState().original.unit, 'cm');
      assert.equal(h.elements['result-unit'].textContent, 'cm');
      assert.match(h.elements['return-note'].textContent, /4 秒/);
      h.video.currentTime = 9; h.elements['return-video'].dispatch('click'); await flush();
      assert.equal(h.video.currentTime, 4);
      assert.equal(h.video.paused, false);
      assert.equal(h.page.session.getState().phase, 'empty');
      assert.equal(h.mediaCalls.play, 1);
      assert.equal(h.requests.length, 0, 'sample conditions are explicit presets, never claimed recognition');
    } finally { h.page.dispose(); }
  }
});

test('sample presets cannot pause playback or expose conditions outside the question interval', () => {
  const h = harness();
  try {
    loadClip(h, '5-12-13');
    for (const [time, paused] of [[1.999, true], [8, true], [12, true], [4, false]]) {
      h.video.currentTime = time; h.video.paused = paused; h.video.dispatch('timeupdate');
      const captures = h.captures.length, pauses = h.mediaCalls.pause;
      assert.equal(h.elements['preset-button'].disabled, true, `${time}, paused=${paused}`);
      h.elements['preset-button'].dispatch('click');
      assert.equal(h.page.session.getState().phase, 'empty');
      assert.equal(h.captures.length, captures);
      assert.equal(h.mediaCalls.pause, pauses, 'a disabled preset cannot pause the video');
      assert.equal(h.video.paused, paused);
      assert.equal(h.requests.length, 0);
    }
    for (const time of [2, 7.999]) {
      h.video.currentTime = time; h.video.paused = true; h.video.dispatch('timeupdate');
      assert.equal(h.elements['preset-button'].disabled, false, `${time}: clear paused question interval`);
    }
  } finally { h.page.dispose(); }
});

test('a rejected MIME keeps the loaded sample while a local video returns to the generic preset', () => {
  const h = harness();
  try {
    loadClip(h, '5-12-13'); h.confirmPreset();
    const before = h.page.session.getState(), source = h.video.src;
    h.elements['local-video'].files = [{ name: 'wrong.mp4', type: 'application/pdf' }];
    h.elements['local-video'].dispatch('change');
    assert.equal(h.video.src, source);
    assert.deepEqual(h.page.session.getState(), before);
    assert.match(h.elements['preset-button'].textContent, /5–12–13/);
    chooseClip(h, '8-15-17');
    h.elements['preset-button'].dispatch('click');
    assert.deepEqual(h.page.session.getState().scene.lengths, { AB: 5, AC: 12 }, 'a dropdown choice does not relabel the loaded video');
    h.loadVideo({ name: 'my-problem.webm', type: 'video/webm' });
    assert.notEqual(h.video.src, source);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.page.session.getState().original, null);
    assert.equal(h.elements['preset-button'].textContent, '使用 3–4–5 预设');
    h.elements['preset-button'].dispatch('click');
    assert.deepEqual(h.page.session.getState().scene.lengths, { AB: 3, AC: 4 });
    assert.equal(h.page.session.getState().scene.unit, 'unit');
    assert.equal(h.elements['candidate-unit'].value, 'unit');
    assert.equal(h.page.session.getState().phase, 'review');
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().original.unit, 'unit');
    assert.equal(h.elements['result-unit'].textContent, '单位长度');
    assert.equal(h.requests.length, 0);
  } finally { h.page.dispose(); }
});

test('a failed sample retires its scene and cannot capture or load conditions until reloaded', () => {
  const h = harness();
  try {
    loadClip(h, '5-12-13'); h.confirmPreset();
    const pending = pendingAsk(h), captures = h.captures.length;
    // Some decoders retain the dimensions and readyState of the last good frame.
    h.video.dispatch('error');
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.page.session.getState().original, null);
    assert.equal(pending.canceled, true);
    assert.equal(h.elements['preset-button'].disabled, true);
    assert.equal(h.elements['capture-frame'].disabled, true);
    assert.equal(h.elements['recognize-frame'].disabled, true);
    assert.match(h.elements['page-status'].textContent, /无法加载.*重新加载/);
    h.elements['preset-button'].dispatch('click');
    assert.equal(h.page.capture(), null);
    assert.equal(h.captures.length, captures);
    answer(pending);
    assert.equal(h.page.session.getState().phase, 'empty');
    loadClip(h, '5-12-13');
    assert.equal(h.elements['preset-button'].disabled, false);
    h.confirmPreset();
    assert.equal(h.page.session.getState().scene.unit, 'cm');
    assert.equal(h.page.session.getState().result.BC, 13);
  } finally { h.page.dispose(); }
});

test('invalid seconds cannot seek, discard a confirmed scene or cancel its model request', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h), before = h.page.session.getState();
    for (const value of ['', '-1', 'Infinity', 'NaN', '21']) {
      h.elements['geometry-target'].value = value;
      h.elements['geometry-seek'].dispatch('click');
      assert.equal(h.video.currentTime, 6, value);
      assert.deepEqual(h.page.session.getState(), before, value);
      assert.equal(request.canceled, false, value);
      assert.ok(h.elements['geometry-seek-error'].textContent, value);
    }
  } finally { h.page.dispose(); }
});

test('valid explicit seek pauses at the chosen second and rejects the previous scene request', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h);
    h.elements['geometry-target'].value = '8';
    h.elements['geometry-jump'].dispatch('click');
    assert.equal(h.video.currentTime, 8);
    assert.equal(h.video.paused, true);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(request.canceled, true);
    answer(request);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.requests.length, 1, 'seeking must never upload a frame');
  } finally { h.page.dispose(); }
});

test('a pending play operation cannot be duplicated and retires the old scene before late model actions', async () => {
  const playing = deferred(), h = harness({ playImpl: () => playing.promise });
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h);
    h.elements['geometry-play'].dispatch('click');
    h.elements['geometry-play'].dispatch('click');
    assert.equal(h.mediaCalls.play, 1);
    assert.equal(h.elements['geometry-play'].disabled, true);
    assert.equal(h.elements['capture-frame'].disabled, true);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(request.canceled, true);
    answer(request);
    assert.equal(h.page.session.getState().phase, 'empty');
    playing.reject(new Error('media denied'));
    await flush();
    assert.match(h.elements['page-status'].textContent, /播放/);
    assert.equal(h.elements['geometry-play'].disabled, false);
  } finally { h.page.dispose(); }
});

test('saving a new frame cancels old model actions and removes the old confirmed snapshot', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h), count = h.captures.length;
    h.elements['geometry-capture'].dispatch('click');
    assert.equal(h.captures.length, count + 1);
    assert.equal(request.canceled, true);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.page.session.getState().original, null);
    answer(request);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.requests.length, 1, 'saving alone does not recognize');
  } finally { h.page.dispose(); }
});

test('a failed re-read of the confirmed frame preserves the experiment until a new candidate is reviewed', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
    const before = h.page.session.getState(), source = h.video.src;
    h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click');
    const failed = h.requests.at(-1);
    assert.deepEqual(h.page.session.getState(), before, 'uploading the same paused frame preserves confirmed conditions');
    failed.onFailure({ code: 'network_error', message: '识别服务不可用' });
    assert.deepEqual(h.page.session.getState(), before);
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    assert.equal(h.video.src, source);
    assert.equal(h.video.currentTime, 6);
    h.elements['read-retry'].dispatch('click');
    const retry = h.requests.at(-1);
    retry.onSuccess({ status: 'unsupported', reason: 'missing_conditions' });
    assert.deepEqual(h.page.session.getState(), before, 'a response without complete conditions is also a failure');
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    h.elements['read-retry'].dispatch('click');
    h.requests.at(-1).onSuccess({ status: 'candidate', scene: candidate(h.requests.at(-1), { AB: 6, AC: 8 }) });
    const review = h.page.session.getState();
    assert.equal(review.phase, 'review');
    assert.equal(review.original, null);
    assert.equal(review.result, null);
    assert.deepEqual(review.scene.lengths, { AB: 6, AC: 8 });
    assert.equal(h.elements['right-angle-check'].checked, false);
    assert.equal(h.elements['experiment-panel'].hidden, true);
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'confirmed');
    assert.equal(h.elements['bc-value'].textContent, '10');
  } finally { h.page.dispose(); }
});

test('selecting a non-video MIME preserves the existing media, scene and pending work', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const request = pendingAsk(h), before = h.page.session.getState();
    const source = h.video.src, name = h.elements['video-name'].textContent, loads = h.mediaCalls.load;
    h.elements['local-video'].files = [{ name: 'looks-like-video.mp4', type: 'text/plain' }];
    h.elements['local-video'].dispatch('change');
    assert.equal(h.video.src, source);
    assert.equal(h.elements['video-name'].textContent, name);
    assert.equal(h.mediaCalls.load, loads);
    assert.equal(h.revokedUrls.length, 0);
    assert.deepEqual(h.page.session.getState(), before);
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(request.canceled, false);
    assert.equal(h.requests.length, 1);
    assert.match(h.elements['page-status'].textContent, /请选择视频文件/);
  } finally { h.page.dispose(); }
});

test('native play and seeking events cancel both frame reading and scene actions', () => {
  for (const event of ['play', 'seeking']) {
    for (const kind of ['read', 'ask']) {
      const h = harness();
      try {
        h.loadVideo(); h.confirmPreset();
        let request;
        if (kind === 'read') {
          h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click');
          request = h.requests.at(-1);
        } else request = pendingAsk(h);
        if (event === 'play') h.video.paused = false;
        else h.video.seeking = true;
        h.video.dispatch(event);
        assert.equal(request.canceled, true, `${event}: ${kind}`);
        assert.equal(h.page.session.getState().phase, 'empty', `${event}: ${kind}`);
        assert.equal(h.page.session.getState().original, null);
        if (kind === 'read') request.onSuccess({ status: 'candidate', scene: candidate(request) });
        else answer(request);
        assert.equal(h.page.session.getState().phase, 'empty', 'late valid responses cannot restore retired conditions');
        assert.equal(h.requests.length, 1, 'native media events never initiate an upload or question');
      } finally { h.page.dispose(); }
    }
  }
});

test('recognition disables duplicate recognition while media controls can cancel the pending read', async () => {
  for (const action of ['geometry-play', 'geometry-jump', 'geometry-capture']) {
    const h = harness();
    try {
      h.loadVideo(); h.confirmPreset();
      h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click');
      const request = h.requests.at(-1);
      assert.equal(h.elements['recognize-frame'].disabled, true, action);
      assert.equal(h.elements['read-busy'].hidden, false);
      for (const name of ['geometry-play', 'geometry-jump', 'geometry-seek', 'geometry-capture', 'capture-frame']) {
        assert.equal(h.elements[name].disabled, false, `${action}: ${name} stays operable`);
      }
      h.elements['recognize-frame'].dispatch('click');
      assert.equal(h.requests.length, 1, 'even a synthetic duplicate event cannot upload twice');
      h.elements['geometry-target'].value = '8';
      h.elements[action].dispatch('click');
      await flush();
      assert.equal(request.canceled, true, action);
      assert.equal(h.elements['read-busy'].hidden, true);
      assert.equal(h.page.session.getState().phase, 'empty', action);
      request.onSuccess({ status: 'candidate', scene: candidate(request) });
      assert.equal(h.page.session.getState().phase, 'empty', 'the canceled candidate cannot open review');
      assert.equal(h.requests.length, 1, 'media operations do not automatically read the new frame');
    } finally { h.page.dispose(); }
  }
});

test('fullscreen failure leaves the experiment usable, and fullscreen Escape does not exit it', async () => {
  const h = harness({ fullscreenImpl: () => Promise.reject(new Error('not allowed')) });
  try {
    h.confirmPreset();
    const before = h.page.session.getState();
    h.elements['geometry-fullscreen'].dispatch('click'); await flush();
    assert.deepEqual(h.page.session.getState(), before);
    assert.match(h.elements['page-status'].textContent, /全屏/);
    assert.equal(h.elements['geometry-fullscreen'].disabled, false);
    h.document.fullscreenElement = h.document.documentElement;
    h.document.dispatch('keydown', { key: 'Escape', target: h.elements['triangle-board'] });
    assert.deepEqual(h.page.session.getState(), before);
  } finally { h.page.dispose(); }
});

test('Escape in the question clears its draft, while Alt+B ignores editable fields', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const before = h.page.session.getState(), count = h.captures.length;
    h.elements.question.value = '尚未送出的草稿';
    h.document.dispatch('keydown', { key: 'Escape', target: h.elements.question });
    assert.equal(h.elements.question.value, '');
    assert.deepEqual(h.page.session.getState(), before);
    for (const name of ['question', 'reader-url', 'experiment-ab', 'candidate-ab', 'geometry-target']) {
      h.document.dispatch('keydown', { key: 'b', altKey: true, target: h.elements[name] });
    }
    assert.equal(h.captures.length, count);
    assert.equal(h.requests.length, 0);
    h.document.dispatch('keydown', { key: 'b', altKey: true, target: h.elements['triangle-board'] });
    assert.equal(h.captures.length, count + 1);
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.requests.length, 0, 'Alt+B captures locally; it does not authorize an upload');
  } finally { h.page.dispose(); }
});

test('reader memory validates the host and credentials and stores only the local origin', () => {
  const h = harness({ storageValues: { [STORAGE_KEY]: 'http://localhost:8787/geometry/read?discard=1#fragment' } });
  try {
    assert.equal(h.elements['reader-url'].value, 'http://localhost:8787');
    h.elements['reader-url'].value = 'http://127.0.0.1:8787/some/path?secret=query#fragment';
    h.elements['reader-url'].dispatch('change');
    assert.equal(h.storageValues.get(STORAGE_KEY), READER);
    assert.equal(h.requests.length, 0);
    h.elements['reader-url'].value = 'http://localhost:8788/geometry/read?discard=1#fragment';
    h.elements['reader-url'].dispatch('blur');
    assert.equal(h.storageValues.get(STORAGE_KEY), 'http://localhost:8788', 'blur remembers only the same validated local origin');
    assert.equal(h.requests.length, 0);
    h.elements['reader-forget'].dispatch('click');
    assert.equal(h.storageValues.has(STORAGE_KEY), false);
    assert.equal(h.elements['reader-url'].value, '');
    assert.equal(h.requests.length, 0);
  } finally { h.page.dispose(); }
  for (const url of ['https://example.com', 'http://user:secret@localhost:8787', 'http://127.0.0.1.example.com']) {
    const rejected = harness({ storageValues: { [STORAGE_KEY]: url } });
    try {
      assert.equal(rejected.elements['reader-url'].value, '', url);
      rejected.confirmPreset();
      assert.equal(rejected.elements['bc-value'].textContent, '5');
      rejected.elements['reader-url'].value = url;
      rejected.elements['reader-url'].dispatch('change');
      assert.equal(rejected.storageValues.has(STORAGE_KEY), false, url);
      assert.equal(rejected.requests.length, 0, url);
    } finally { rejected.page.dispose(); }
  }
});

test('unavailable session storage never blocks manual work or initiates a request', () => {
  const h = harness({ storageThrows: true });
  try {
    h.confirmPreset();
    h.elements['reader-url'].value = READER; h.elements['reader-url'].dispatch('change');
    h.elements['reader-forget'].dispatch('click');
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.page.session.getState().phase, 'confirmed');
    assert.equal(h.requests.length, 0);
    assert.match(h.elements['reader-memory-note'].textContent, /记住|存储|保存|浏览器|清除/);
  } finally { h.page.dispose(); }
});

test('slider, number form and local question share one side update and extend the visible range', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const other = h.page.session.getState().scene.lengths.AC;
    h.elements['experiment-ab-range'].value = '6'; h.elements['experiment-ab-range'].dispatch('input');
    assert.equal(h.page.session.getState().scene.lengths.AC, other);
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    assert.equal(Number(h.elements['experiment-ab'].value), 6);
    assert.equal(h.elements['experiment-ab-range-value'].textContent, '6 单位长度');
    h.elements['experiment-ac'].value = '8'; h.elements['ac-form'].dispatch('submit');
    assert.equal(h.elements['bc-value'].textContent, '10');
    assert.equal(Number(h.elements['experiment-ac-range'].value), 8);
    assert.equal(h.page.session.getState().scene.lengths.AB, 6);
    question(h, '把 AB 改成 20，AC 不变，BC 是多少？');
    assert.equal(h.elements['bc-value'].textContent, '21.541');
    assert.equal(h.page.session.getState().scene.lengths.AC, 8);
    const range = h.elements['experiment-ab-range'];
    assert.equal(Number(range.value), 20);
    assert.ok(Number(range.min) > 0 && Number(range.min) <= 20);
    assert.ok(Number.isFinite(Number(range.max)) && Number(range.max) >= 20);
    assert.equal(range.step, 'any');
    h.elements['geometry-restore'].dispatch('click');
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(Number(range.value), 3);
  } finally { h.page.dispose(); }
});

test('ranges wait for confirmation and extreme valid lengths keep finite bounds with atomic rejection', () => {
  const unconfirmed = harness();
  try {
    for (const side of ['ab', 'ac']) assert.equal(unconfirmed.elements[`experiment-${side}-range`].disabled, true);
    unconfirmed.elements['preset-button'].dispatch('click');
    const review = unconfirmed.page.session.getState();
    for (const side of ['ab', 'ac']) {
      const range = unconfirmed.elements[`experiment-${side}-range`];
      assert.equal(range.disabled, true);
      range.value = '6'; range.dispatch('input');
      assert.deepEqual(unconfirmed.page.session.getState(), review, 'a synthetic input cannot bypass candidate confirmation');
      assert.equal(unconfirmed.elements[`experiment-${side}-range-value`].textContent, '—');
    }
  } finally { unconfirmed.page.dispose(); }
  for (const sample of [
    { AB: Number.MIN_VALUE, AC: Number.MIN_VALUE, result: Number.MIN_VALUE, side: 'AB', invalid: ['0', '-1', 'Infinity', 'NaN'] },
    { AB: Number.MAX_VALUE, AC: 3, result: Number.MAX_VALUE, side: 'AC', invalid: ['0', '-1', 'Infinity', 'NaN', String(Number.MIN_VALUE), String(Number.MAX_VALUE)] }
  ]) {
    const h = harness();
    try {
      h.elements['manual-button'].dispatch('click');
      h.elements['candidate-ab'].value = String(sample.AB); h.elements['candidate-ac'].value = String(sample.AC);
      h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
      const before = h.page.session.getState(), bc = h.elements['bc-value'].textContent;
      assert.equal(before.phase, 'confirmed');
      assert.equal(before.result.BC, sample.result);
      for (const [side, value] of [['ab', sample.AB], ['ac', sample.AC]]) {
        const range = h.elements[`experiment-${side}-range`];
        assert.equal(range.disabled, false);
        assert.ok(Number.isFinite(Number(range.min)) && Number(range.min) > 0);
        assert.ok(Number.isFinite(Number(range.max)) && Number(range.max) > 0);
        assert.ok(Number(range.min) <= value && Number(range.max) >= value);
        assert.equal(Number(range.value), value);
      }
      const field = h.elements[`experiment-${sample.side.toLowerCase()}`];
      for (const input of sample.invalid) {
        field.value = input; h.elements[`${sample.side.toLowerCase()}-form`].dispatch('submit');
        assert.deepEqual(h.page.session.getState(), before, `${sample.side}=${input}`);
        assert.equal(h.elements['bc-value'].textContent, bc);
        assert.ok(h.elements[`${sample.side.toLowerCase()}-error`].textContent);
      }
      const range = h.elements[`experiment-${sample.side.toLowerCase()}-range`];
      range.value = '0'; range.dispatch('input');
      assert.deepEqual(h.page.session.getState(), before, 'an invalid slider event is also rejected atomically');
      assert.equal(h.elements['bc-value'].textContent, bc);
    } finally { h.page.dispose(); }
  }
});

test('restoring or applying a valid local action clears rejected length errors and invalid attributes', () => {
  const h = harness();
  try {
    h.confirmPreset();
    h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
    const before = h.page.session.getState();
    for (const side of ['ab', 'ac']) {
      h.elements[`experiment-${side}`].value = '-1'; h.elements[`${side}-form`].dispatch('submit');
      assert.ok(h.elements[`${side}-error`].textContent);
      assert.equal(h.elements[`experiment-${side}`].getAttribute('aria-invalid'), 'true');
    }
    assert.deepEqual(h.page.session.getState(), before, 'bad drafts do not change confirmed conditions');
    h.elements['geometry-restore'].dispatch('click');
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.elements['experiment-ab'].value, '3');
    assert.equal(h.elements['experiment-ac'].value, '4');
    for (const side of ['ab', 'ac']) {
      assert.equal(h.elements[`${side}-error`].textContent, '');
      assert.equal(h.elements[`experiment-${side}`].getAttribute('aria-invalid'), null);
    }
    h.elements['experiment-ac'].value = '0'; h.elements['ac-form'].dispatch('submit');
    assert.equal(h.elements['experiment-ac'].getAttribute('aria-invalid'), 'true');
    question(h, '把 AB 改成 6，AC 不变，BC 是多少？');
    assert.equal(h.elements['bc-value'].textContent, '7.211');
    assert.equal(h.page.session.getState().scene.lengths.AC, 4);
    for (const side of ['ab', 'ac']) {
      assert.equal(h.elements[`${side}-error`].textContent, '');
      assert.equal(h.elements[`experiment-${side}`].getAttribute('aria-invalid'), null);
    }
    assert.equal(h.elements['experiment-ac'].value, '4', 'successful actions synchronize the formerly invalid draft');
  } finally { h.page.dispose(); }
});

test('question examples fill editable drafts without changing the scene or submitting anything', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const before = h.page.session.getState();
    for (const name of ['ask-example-change', 'ask-example-query', 'ask-example-explain', 'ask-example-restore']) {
      h.elements.question.value = '';
      h.elements[name].dispatch('click');
      assert.ok(h.elements.question.value.trim(), name);
      assert.equal(h.document.activeElement, h.elements.question, name);
      assert.deepEqual(h.page.session.getState(), before, name);
      assert.equal(h.requests.length, 0, name);
      assert.equal(h.elements['ask-log'].children.length, 0, name);
    }
  } finally { h.page.dispose(); }
});

test('question history uses text, labels result provenance, caps at forty entries and clears on a new scene', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const literal = '<img src=x onerror="run()"> 这个问题不应执行';
    question(h, literal);
    const log = h.elements['ask-log'];
    assert.ok(log.textContent.includes(literal));
    assert.equal(descendants(log).some((item) => ['IMG', 'SCRIPT'].includes(item.tagName)), false);
    question(h, 'BC是多少？');
    assert.match(log.children.at(-1).textContent, /本地/);
    assert.match(log.children.at(-1).textContent, /修订\s*1/);
    for (let i = 0; i < 24; i++) question(h, 'BC是多少？');
    assert.equal(log.children.length, 40);
    const before = h.page.session.getState();
    h.elements['ask-log-clear'].dispatch('click');
    assert.equal(log.children.length, 0);
    assert.deepEqual(h.page.session.getState(), before);
    question(h, 'BC是多少？'); assert.equal(log.children.length, 2);
    h.elements['preset-button'].dispatch('click');
    assert.equal(log.children.length, 0);
    assert.equal(log.hidden, true);
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    question(h, 'BC是多少？');
    h.elements['exit-scene'].dispatch('click');
    assert.equal(log.children.length, 0);
  } finally { h.page.dispose(); }
});

test('clearing question history cancels a pending turn without applying its late reply', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const before = h.page.session.getState(), request = pendingAsk(h);
    assert.ok(h.elements['ask-log'].children.length);
    assert.equal(h.elements['ask-log-clear'].disabled, false);
    h.elements['ask-log-clear'].dispatch('click');
    assert.equal(request.canceled, true);
    assert.equal(h.elements['ask-log'].children.length, 0);
    assert.equal(h.elements['ask-log'].hidden, true);
    assert.equal(h.elements['ask-cancel'].hidden, true);
    assert.equal(h.elements['ask-submit'].disabled, false);
    assert.match(h.elements['ask-feedback'].textContent, /清空.*取消/);
    assert.deepEqual(h.page.session.getState(), before);
    answer(request);
    assert.deepEqual(h.page.session.getState(), before);
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.elements['ask-log'].children.length, 0, 'late answers cannot re-create cleared history');
    assert.equal(h.requests.length, 1);
  } finally { h.page.dispose(); }
});

test('failed and canceled model turns stay explicit, and retry uses the same question without stale actions', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const text = '把 AB 改成 8', first = pendingAsk(h, text);
    first.onFailure({ code: 'network_error', message: 'reader 不可用' });
    assert.match(h.elements['ask-log'].textContent, /reader 不可用/);
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.elements['ask-retry'].disabled, false, 'a visible retry must be operable in the browser');
    h.elements.question.value = '尚未提交的另一句';
    h.elements['ask-retry'].dispatch('click');
    const retry = h.requests.at(-1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.elements['ask-retry'].disabled, true, 'a retry in flight cannot be submitted twice');
    assert.notEqual(retry, first); assert.equal(retry.body.text, text);
    assert.equal(h.elements.question.value, '尚未提交的另一句', 'retry does not overwrite the separate draft');
    h.elements['ask-cancel'].dispatch('click');
    assert.equal(retry.canceled, true);
    assert.match(h.elements['ask-log'].textContent, /取消/);
    answer(retry);
    assert.equal(h.elements['bc-value'].textContent, '5');
    assert.equal(h.elements['ask-retry'].disabled, false, 'an explicitly canceled question can be retried');
    h.elements['ask-retry'].dispatch('click');
    assert.equal(h.requests.at(-1).body.text, text);
    answer(h.requests.at(-1));
    assert.equal(h.elements['bc-value'].textContent, '8.944');
    assert.match(h.elements['ask-log'].children.at(-1).textContent, /模型提议|reader/);
    assert.match(h.elements['ask-log'].children.at(-1).textContent, /修订\s*2/);
  } finally { h.page.dispose(); }
});

test('editing a draft withdraws the old retry without submitting or overwriting the new question', () => {
  const h = harness();
  try {
    h.confirmPreset();
    const first = pendingAsk(h);
    first.onFailure({ code: 'network_error', message: 'reader 不可用' });
    assert.equal(h.elements['ask-retry'].hidden, false);
    assert.equal(h.elements['ask-retry'].disabled, false);
    h.elements.question.value = '请解释当前变化';
    h.elements.question.dispatch('input');
    assert.equal(h.elements['ask-retry'].hidden, true);
    h.elements['ask-retry'].dispatch('click');
    assert.equal(h.requests.length, 1);
    assert.equal(h.elements.question.value, '请解释当前变化');
    assert.equal(h.elements['bc-value'].textContent, '5');
  } finally { h.page.dispose(); }
});

test('recognition retry requires the current paused frame and never substitutes a preset', () => {
  const h = harness();
  try {
    h.loadVideo(); h.elements['reader-url'].value = READER;
    h.elements['recognize-frame'].dispatch('click');
    const first = h.requests[0], source = h.video.src;
    first.onFailure({ code: 'network_error', message: '识别服务不可用' });
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.video.src, source);
    assert.equal(h.elements['read-retry'].disabled, false);
    h.elements['geometry-retry'].dispatch('click');
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].body.frameTime, 6);
    assert.notEqual(h.requests[1].body.requestId, first.body.requestId);
    h.requests[1].onFailure({ code: 'timeout', message: '识别超时' });
    h.video.paused = false; h.video.dispatch('play');
    h.elements['read-retry'].dispatch('click');
    assert.equal(h.requests.length, 2, 'a stale retry cannot pause and upload a different frame');
    assert.equal(h.page.session.getState().phase, 'empty');
    assert.equal(h.video.src, source);
  } finally { h.page.dispose(); }
});

test('persisted navigation retains the confirmed local scene and repeated returns keep controls usable once', () => {
  const h = harness();
  try {
    h.loadVideo(); h.confirmPreset();
    const source = h.video.src;
    const listenerSnapshot = () => [
      h.elements['ab-form'].listenerCount('submit'), h.elements['review-form'].listenerCount('submit'),
      h.elements['preset-button'].listenerCount('click'), h.elements['geometry-restore'].listenerCount('click'),
      h.video.listenerCount('timeupdate')
    ];
    const listeners = listenerSnapshot();
    assert.ok(listeners.every((count) => count === 1), 'setup has one business handler per control');
    for (let round = 0; round < 3; round++) {
      h.elements['experiment-ab'].value = String(6 + round); h.elements['ab-form'].dispatch('submit');
      const before = h.page.session.getState(), captures = h.captures.length, loads = h.mediaCalls.load;
      const lengthDraft = `123.${round}`, questionDraft = `尚未提交的问题 ${round}`;
      h.elements['experiment-ab'].value = lengthDraft; h.elements['experiment-ab'].dispatch('input');
      h.elements.question.value = questionDraft; h.elements.question.dispatch('input');
      h.window.dispatch('pagehide', { persisted: true });
      assert.deepEqual(h.page.session.getState(), before, 'caching retains confirmed conditions and original snapshot');
      assert.equal(h.video.src, source);
      assert.deepEqual(h.revokedUrls, [], 'the cached page still owns its local video URL');
      h.window.dispatch('pageshow', { persisted: true });
      assert.deepEqual(h.page.session.getState(), before, 'restoring does not change the revision or conditions');
      assert.deepEqual(listenerSnapshot(), listeners, 'a return neither removes nor duplicates business handlers');
      assert.equal(h.requests.length, 0, 'restoring does not call a reader');
      assert.equal(h.captures.length, captures, 'restoring does not capture a new frame');
      assert.equal(h.mediaCalls.load, loads, 'restoring does not reload the video');
      assert.equal(h.mediaCalls.play, 0, 'restoring does not automatically play');
      assert.equal(h.elements['experiment-panel'].hidden, false);
      assert.equal(h.elements['geometry-restore'].disabled, false);
      assert.equal(h.elements['experiment-ab'].value, lengthDraft, 'restoring retains an unsubmitted length draft');
      assert.equal(h.elements.question.value, questionDraft, 'restoring retains an unsubmitted question draft');
      h.elements['experiment-ac'].value = '8'; h.elements['ac-form'].dispatch('submit');
      const changed = h.page.session.getState();
      assert.deepEqual(changed.scene.lengths, { AB: 6 + round, AC: 8 });
      assert.equal(changed.scene.sceneRevision, before.scene.sceneRevision + 1, 'one submit applies exactly one revision');
      h.elements['geometry-restore'].dispatch('click');
      assert.deepEqual(h.page.session.getState().scene.lengths, { AB: 3, AC: 4 });
      assert.equal(h.elements['bc-value'].textContent, '5');
    }
    h.elements['preset-button'].dispatch('click');
    assert.equal(h.page.session.getState().phase, 'review', 'preset remains usable after repeated cache returns');
    h.elements['right-angle-check'].checked = true; h.elements['review-form'].dispatch('submit');
    assert.equal(h.page.session.getState().phase, 'confirmed');
    assert.deepEqual(h.revokedUrls, []);
  } finally { h.page.dispose(); }
});

test('persisted navigation preserves a candidate and its unsubmitted correction fields', () => {
  const h = harness();
  try {
    h.loadVideo(); h.elements['preset-button'].dispatch('click');
    const before = h.page.session.getState(), source = h.video.src, captures = h.captures.length;
    assert.equal(before.phase, 'review');
    h.elements['candidate-ab'].value = '6'; h.elements['label-b'].value = '端点B';
    h.elements['right-angle-check'].checked = true;
    h.window.dispatch('pagehide', { persisted: true });
    assert.deepEqual(h.page.session.getState(), before);
    h.window.dispatch('pageshow', { persisted: true });
    assert.deepEqual(h.page.session.getState(), before);
    assert.equal(h.elements['candidate-ab'].value, '6');
    assert.equal(h.elements['label-b'].value, '端点B');
    assert.equal(h.elements['right-angle-check'].checked, true);
    assert.equal(h.elements['review-panel'].hidden, false);
    assert.equal(h.elements['experiment-ab-range'].disabled, true, 'return does not implicitly confirm the candidate');
    assert.equal(h.video.src, source); assert.deepEqual(h.revokedUrls, []);
    assert.equal(h.requests.length, 0); assert.equal(h.captures.length, captures);
    h.elements['review-form'].dispatch('submit');
    const confirmed = h.page.session.getState();
    assert.equal(confirmed.phase, 'confirmed');
    assert.deepEqual(confirmed.original.lengths, { AB: 6, AC: 4 });
    assert.equal(confirmed.scene.labels.B, '端点B');
    assert.equal(confirmed.result.BC, Math.hypot(6, 4));
  } finally { h.page.dispose(); }
});

test('persisted departure cancels pending reading and asking without applying late results or restarting them', () => {
  for (const kind of ['read', 'ask']) {
    const h = harness();
    try {
      h.loadVideo(); h.confirmPreset();
      h.elements['experiment-ab'].value = '6'; h.elements['ab-form'].dispatch('submit');
      const before = h.page.session.getState(), source = h.video.src;
      let pending;
      if (kind === 'read') {
        h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click');
        pending = h.requests.at(-1);
      } else pending = pendingAsk(h);
      assert.equal(pending.canceled, false);
      const questionDraft = h.elements.question.value;
      h.window.dispatch('pagehide', { persisted: true });
      assert.equal(pending.canceled, true, `${kind}: cached departure cancels work`);
      assert.deepEqual(h.page.session.getState(), before, `${kind}: cancellation preserves the confirmed scene`);
      const lateSuccess = () => kind === 'read'
        ? pending.onSuccess({ status: 'candidate', scene: candidate(pending, { AB: 9, AC: 12 }) }) : answer(pending, 9);
      lateSuccess();
      assert.deepEqual(h.page.session.getState(), before, `${kind}: late success cannot change a suspended scene`);
      h.window.dispatch('pageshow', { persisted: true });
      const feedback = h.elements['ask-feedback'].textContent, status = h.elements['page-status'].textContent;
      const history = h.elements['ask-log'].textContent;
      lateSuccess(); pending.onFailure({ code: 'network_error', message: '迟到的服务错误' });
      assert.deepEqual(h.page.session.getState(), before, `${kind}: late callbacks cannot change the restored scene`);
      assert.equal(h.elements['ask-feedback'].textContent, feedback);
      assert.equal(h.elements['page-status'].textContent, status);
      assert.equal(h.elements['ask-log'].textContent, history);
      assert.equal(h.requests.length, 1, `${kind}: return does not retry a canceled request`);
      assert.equal(h.elements['read-busy'].hidden, true);
      assert.equal(h.elements['read-cancel'].hidden, true);
      assert.equal(h.elements['ask-cancel'].hidden, true);
      assert.equal(h.elements['recognize-frame'].disabled, false);
      assert.equal(h.elements['ask-submit'].disabled, false);
      assert.equal(h.elements.question.value, questionDraft, 'canceling for cache navigation retains the question draft');
      assert.equal(h.video.src, source); assert.deepEqual(h.revokedUrls, []);
      question(h, '把 AB 改成 8');
      assert.equal(h.page.session.getState().scene.lengths.AB, 8, `${kind}: local actions still work after return`);
      assert.equal(h.requests.length, 1);
    } finally { h.page.dispose(); }
  }
});

test('cached departure retires browser promises without restarting playback or overriding a newer operation', async () => {
  for (const action of ['play', 'fullscreen', 'return']) {
    for (const rejected of [false, true]) {
      const first = deferred(), second = deferred(); let calls = 0;
      const option = action === 'fullscreen' ? 'fullscreenImpl' : 'playImpl';
      const h = harness({ [option]: () => ++calls === 1 ? first.promise : second.promise });
      try {
        h.loadVideo(); h.confirmPreset();
        const control = action === 'return' ? 'return-video' : `geometry-${action}`;
        h.elements[control].dispatch('click'); await flush();
        assert.equal(calls, 1);
        h.window.dispatch('pagehide', { persisted: true }); h.window.dispatch('pageshow', { persisted: true });
        assert.equal(calls, 1, `${action}: cache return does not restart the browser operation`);
        assert.equal(h.video.paused, true);
        const busyControl = action === 'fullscreen' ? 'geometry-fullscreen' : 'geometry-play';
        assert.equal(h.elements[busyControl].disabled, false, `${action}: canceled operation releases its busy state`);
        if (action !== 'return') {
          h.elements[control].dispatch('click'); await flush();
          assert.equal(calls, 2, 'a fresh explicit operation can start after restoring');
          assert.equal(h.elements[busyControl].disabled, true);
        }
        const status = h.elements['page-status'].textContent;
        if (rejected) first.reject(new Error('cached operation rejected late')); else first.resolve();
        await flush();
        assert.equal(h.elements['page-status'].textContent, status, `${action}: rejected=${rejected} cannot rewrite restored feedback`);
        if (action !== 'return') {
          assert.equal(h.elements[busyControl].disabled, true, 'the stale promise cannot release a newer pending operation');
          second.resolve(); await flush();
          assert.equal(h.elements[busyControl].disabled, false);
        }
        assert.equal(h.requests.length, 0);
        assert.deepEqual(h.revokedUrls, []);
      } finally { h.page.dispose(); }
    }
  }
});

test('final nonpersisted departure releases the cached controller and ignores late browser promises', async () => {
  for (const action of ['read', 'ask', 'play', 'fullscreen']) {
    const pendingPromise = deferred();
    const options = action === 'play' ? { playImpl: () => pendingPromise.promise }
      : action === 'fullscreen' ? { fullscreenImpl: () => pendingPromise.promise } : {};
    const h = harness(options);
    try {
      h.loadVideo(); h.confirmPreset();
      h.window.dispatch('pagehide', { persisted: true }); h.window.dispatch('pageshow', { persisted: true });
      const source = h.video.src;
      let request;
      if (action === 'read') {
        h.elements['reader-url'].value = READER; h.elements['recognize-frame'].dispatch('click'); request = h.requests.at(-1);
      } else if (action === 'ask') request = pendingAsk(h);
      else { h.elements[`geometry-${action}`].dispatch('click'); await flush(); }
      if (action === 'read' || action === 'ask') assert.ok(request, `${action}: restored controls can start a fresh request`);
      h.window.dispatch('pagehide', { persisted: false });
      assert.equal(h.page.session.getState().phase, 'empty');
      assert.deepEqual(h.revokedUrls, [source], `${action}: final departure releases the local URL exactly once`);
      assert.equal(h.elements['preset-button'].listenerCount('click'), 0);
      assert.equal(h.elements['ab-form'].listenerCount('submit'), 0);
      assert.equal(h.video.listenerCount('timeupdate'), 0);
      assert.equal(h.window.listenerCount('pagehide'), 0);
      assert.equal(h.window.listenerCount('pageshow'), 0);
      if (request) assert.equal(request.canceled, true);
      const status = h.elements['page-status'].textContent, feedback = h.elements['ask-feedback'].textContent;
      if (action === 'read') request.onSuccess({ status: 'candidate', scene: candidate(request) });
      else if (action === 'ask') answer(request);
      else if (action === 'play') pendingPromise.resolve();
      else pendingPromise.reject(new Error('late browser denial'));
      await flush();
      h.window.dispatch('pageshow', { persisted: true }); h.elements['preset-button'].dispatch('click');
      assert.equal(h.page.session.getState().phase, 'empty', `${action}: final disposal is permanent`);
      assert.equal(h.elements['page-status'].textContent, status);
      assert.equal(h.elements['ask-feedback'].textContent, feedback);
      h.page.dispose(); assert.deepEqual(h.revokedUrls, [source], 'explicit disposal remains idempotent');
    } finally { h.page.dispose(); }
  }
});

test('late play and fullscreen promises cannot update page state after disposal', async () => {
  for (const [action, option] of [['geometry-play', 'playImpl'], ['geometry-fullscreen', 'fullscreenImpl']]) {
    for (const rejected of [false, true]) {
      const pending = deferred(), h = harness({ [option]: () => pending.promise });
      h.loadVideo(); h.confirmPreset(); h.elements[action].dispatch('click');
      await flush();
      assert.equal(h.mediaCalls[action === 'geometry-play' ? 'play' : 'fullscreen'], 1);
      h.page.dispose();
      const status = h.elements['page-status'].textContent;
      if (rejected) pending.reject(new Error('late browser denial')); else pending.resolve();
      await flush();
      assert.equal(h.elements['page-status'].textContent, status, `${action}: rejected=${rejected}`);
      assert.equal(h.page.session.getState().phase, 'empty');
    }
  }
});
