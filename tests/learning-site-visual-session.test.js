const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

// Execute the actual browser session and loop. HTTP replies are transport stubs;
// DOM presentation, decoder pixels and real AI remain separate browser checks.
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function target(extra = {}) {
  const listeners = new Map();
  return { ...extra,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const FILE_ID = 'file-' + 'a'.repeat(64);
function createFixture(options = {}) {
  const calls = [], states = [], pointUpdates = [], summaries = [], tasks = new Map();
  let nextTimer = 0, captured = 0, tokenSerial = 0, now = 1000;
  const mount = { kind: 'video-content-container' };
  const video = target({ currentSrc: 'blob:controlled-file', src: 'blob:controlled-file', isConnected: true,
    parentElement: { parentElement: mount },
    currentTime: 0, duration: 9.383333, videoWidth: 640, videoHeight: 360 });
  const document = target({ hidden: false }); const window = target();
  const overlay = { destroyed: false,
    updatePoints(values) { pointUpdates.push(JSON.parse(JSON.stringify(values))); },
    updateSummary(value) { summaries.push(value); }, setRecognitionState(value) { states.push(value); },
    updateStatus() {}, destroy() { this.destroyed = true; } };
  let overlayOptions;
  const sandbox = { AbortController, AbortSignal, TextDecoder, queueMicrotask, crypto: { randomUUID },
    Date: class extends Date { static now() { return now; } }, video, document, window,
    setTimeout(fn) { const id = ++nextTimer; tasks.set(id, fn); return id; },
    clearTimeout(id) { tasks.delete(id); },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); const entry = { url, init, body }; calls.push(entry);
      if (options.fetch) { const result = options.fetch(entry); if (result !== undefined) return result; }
      if (url === '/api/vision/session') return new Response(JSON.stringify({ token: `test-session-${++tokenSerial}` }));
      if (url === '/api/vision/session/end') return new Response(JSON.stringify({ ok: true }));
      const identity = { schemaVersion: '1', requestId: body.requestId, sourceId: body.sourceId,
        videoVersion: body.videoVersion, analysisVersion: body.analysisVersion };
      if (url === '/api/vision/recognition') return new Response(JSON.stringify({ ...identity, schemaVersion:'011.1', kind:body.kind, frameTime:body.frameTime, frameSize:body.frameSize, jpegSize:{width:640,height:402}, status:'unsupported', candidate:null, evidence:{formulaBasis:'none',mathStatus:'insufficient',placementStatus:'unknown',map:null,calibrationBasis:'none',profileVersion:'recognition-profile-v1',promptVersion:'recognition-prompt-v1',calibrationVersion:'recognition-calibration-v1'},limitations:['unsupported_object','independent_board_only'] }));
      if (url === '/api/vision/read') return new Response(JSON.stringify({ ...identity, frameTime: body.frameTime,
        status: 'unsupported', result: null, code: 'unsupported_frame' }));
      if (url === '/api/vision/summarize') return new Response(JSON.stringify({ ...identity, status: 'summary',
        summary: '仅画面观察，未包含音频。', keyPoints: [], pitfalls: [],
        observedTimes: [...new Set(body.observations.map((item) => item.frameTime))].sort((a, b) => a - b) }));
      throw new Error(`unexpected request ${url}`);
    } };
  vm.createContext(sandbox);
  for (const name of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js', 'plugin/live-loop.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', name), 'utf8'), sandbox, { filename: name });
  }
  if (options.recognition) vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/src/plugin/recognition-contracts.js'),'utf8'),sandbox);
  sandbox.atob = atob; sandbox.btoa = btoa;
  sandbox.BreakGlass.frameSampling = { capture() { captured += 1;
    return options.frames ? { frameTime: captured / 10, image: options.image || 'transport-frame-placeholder', signature: `picture-${captured}` } : null; } };
  sandbox.BreakGlass.pluginOverlay = { createLearningOverlay(value) { overlayOptions = value; return overlay; } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../learning-site/visual-session.js'), 'utf8'), sandbox, { filename: 'visual-session.js' });
  const materialMode = options.pending ? 'permission-pending' : 'self-authored';
  sandbox.manualOnly = Boolean(options.manualOnly); sandbox.deferOverlay = Boolean(options.deferOverlay);
  sandbox.materialMode = materialMode; sandbox.fileId = FILE_ID;
  const session = vm.runInContext(`BreakGlass.webVisual.createSession({video, cssText:'local-style', manualOnly, deferOverlay,
    source:{kind:'local-file',id:fileId,version:'1',analysisVersion:'1',materialMode,title:'自制课程'}})`, sandbox);
  return { session, video, document, window, calls, states, pointUpdates, summaries, tasks, overlay, mount, sandbox,
    overlayOptions: () => overlayOptions, captures: () => captured, setTime(value) { now = value; },
    async advance() { const first = tasks.entries().next().value; if (!first) return false;
      tasks.delete(first[0]); first[1](); await flush(); return true; } };
}

test('stop/destroy abort an unfinished session start and a provider ignoring abort cannot restart the loop', async () => {
  for (const action of ['stop', 'destroy']) {
    const begin = deferred();
    const fixture = createFixture({ fetch: (entry) => entry.url === '/api/vision/session' ? begin.promise : undefined });
    const pending = fixture.session.start();
    assert.equal(fixture.calls.length, 1);
    const signal = fixture.calls[0].init.signal;
    assert.equal(signal.aborted, false);
    fixture.session[action]();
    assert.equal(signal.aborted, true, `unfinished start must be aborted by ${action}`);
    begin.resolve(new Response(JSON.stringify({ token: 'late-session-token' })));
    assert.equal(await pending, false); await flush();
    assert.equal(fixture.captures(), 0); assert.equal(fixture.tasks.size, 0);
    assert.ok(fixture.pointUpdates.every((values) => values.length === 0));
    assert.equal(fixture.states.includes(true), false);
    const cleanup = fixture.calls.find((entry) => entry.url === '/api/vision/session/end');
    assert.deepEqual(cleanup.body, { token: 'late-session-token' });
    assert.equal(cleanup.init.keepalive, true);
    if (action === 'destroy') assert.equal(fixture.video.count() + fixture.document.count() + fixture.window.count(), 0);
    fixture.session.destroy();
  }
});

test('normal start and stop close the issued token, clear observations and prevent hidden-page captures', async () => {
  const fixture = createFixture();
  assert.equal(fixture.overlayOptions().mount, fixture.mount);
  assert.equal(await fixture.session.start(), true); await flush();
  assert.equal(fixture.states.at(-1), true);
  assert.equal(fixture.captures(), 1); assert.equal(fixture.tasks.size, 1);
  fixture.document.hidden = true; fixture.document.emit('visibilitychange');
  assert.equal(fixture.states.at(-1), false); assert.equal(fixture.tasks.size, 0);
  assert.equal(await fixture.advance(), false);
  const end = fixture.calls.find((entry) => entry.url === '/api/vision/session/end');
  assert.deepEqual(end.body, { token: 'test-session-1' }); assert.equal(end.init.keepalive, true);
  assert.deepEqual(fixture.pointUpdates.at(-1), []); assert.equal(fixture.summaries.at(-1), null);
  fixture.document.hidden = false;
  assert.equal(await fixture.session.start(), true); await flush();
  fixture.video.emit('seeking');
  assert.equal(fixture.states.at(-1), false); assert.equal(fixture.tasks.size, 0);
  fixture.session.destroy(); fixture.session.destroy();
  assert.equal(fixture.video.count() + fixture.document.count() + fixture.window.count(), 0);
  await assert.rejects(fixture.session.start(), /已关闭/);
});

test('permission-pending and explicit manual mode create only manual-notes with no acquisition or HTTP', async () => {
  for (const options of [{ pending: true }, { manualOnly: true }]) {
    const fixture = createFixture(options);
    assert.equal(await fixture.session.start(), false); await flush();
    assert.equal(fixture.calls.length, 0); assert.equal(fixture.captures(), 0);
    const overlay = fixture.overlayOptions();
    assert.equal(overlay.source.kind, 'manual-notes');
    assert.equal(overlay.source.id, 'manual-' + FILE_ID);
    assert.equal(overlay.source.materialMode, 'self-authored');
    assert.equal(overlay.onToggleRecognition, undefined);
    fixture.session.stop(); fixture.session.destroy();
    assert.equal(fixture.calls.length, 0);
  }
});

test('prepared context reuses the confirmed mathematical overlay without new acquisition and is cleared on stop', () => {
  const fixture = createFixture(); fixture.sandbox.session = fixture.session;
  vm.runInContext(`session.showPreparedContext({schemaVersion:'1',status:'context',sourceId:fileId,videoVersion:'1',analysisVersion:'1',
    contextSourceId:'subtitle-id',coverage:{inputTypes:['frames']},summary:'仅画面',keyPoints:[],pitfalls:[],observedTimes:[2],
    objects:[{frameTime:2,result:{schemaVersion:'1',template:'right-triangle',snapshot:{AB:3,AC:4,unit:'cm'},area:null,
      title:'三角形候选',explanation:'核对直角条件。',pitfallHint:''}}]})`, fixture.sandbox);
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.captures(), 0);
  const point = fixture.pointUpdates.at(-1)[0]; assert.equal(point.origin, 'vision'); assert.equal(point.start, 2);
  assert.equal(point.sourceLabel, 'AI片段候选（稀疏画面）'); assert.deepEqual(point.snapshot, { AB: 3, AC: 4, unit: 'cm' });
  assert.equal(fixture.summaries.at(-1).summary, '仅画面'); fixture.session.stop(); assert.deepEqual(fixture.pointUpdates.at(-1), []);
  assert.equal(fixture.summaries.at(-1), null); fixture.session.destroy();
});

test('restarting while begin is pending aborts the old owner, and its late token does not end the new session', async () => {
  const first = deferred(); let begins = 0;
  const fixture = createFixture({ fetch: (entry) => {
    if (entry.url === '/api/vision/session' && ++begins === 1) return first.promise;
    return undefined;
  } });
  const oldStart = fixture.session.start(); const oldSignal = fixture.calls[0].init.signal;
  assert.equal(await fixture.session.start(), true); await flush();
  assert.equal(oldSignal.aborted, true); assert.equal(fixture.states.at(-1), true);
  first.resolve(new Response(JSON.stringify({ token: 'obsolete-token' })));
  assert.equal(await oldStart, false); await flush();
  assert.equal(fixture.states.at(-1), true); assert.equal(fixture.tasks.size, 1);
  const ended = fixture.calls.filter((entry) => entry.url.endsWith('/end')).map((entry) => entry.body.token);
  assert.deepEqual(ended, ['obsolete-token']);
  fixture.session.stop();
  assert.deepEqual(fixture.calls.filter((entry) => entry.url.endsWith('/end')).map((entry) => entry.body.token),
    ['obsolete-token', 'test-session-1']);
  fixture.session.destroy();
});

test('read replies arriving after stop cannot populate points or trigger summary', async () => {
  const reading = deferred();
  const fixture = createFixture({ frames: true,
    fetch: (entry) => entry.url === '/api/vision/read' ? reading.promise : undefined });
  assert.equal(await fixture.session.start(), true); await flush();
  const read = fixture.calls.find((entry) => entry.url === '/api/vision/read');
  assert.equal(read.init.headers['x-breakglass-visual-session'], 'test-session-1');
  fixture.session.stop(); assert.equal(read.init.signal.aborted, true);
  reading.resolve(new Response(JSON.stringify({ ...read.body, image: undefined, status: 'candidate',
    result: { schemaVersion: '1', template: 'parabola', snapshot: { a: 1, h: 0, k: 0 }, area: null,
      title: '迟到候选', explanation: '不应显示。', pitfallHint: '' } })));
  await flush();
  assert.ok(fixture.pointUpdates.every((values) => values.length === 0));
  assert.equal(fixture.calls.some((entry) => entry.url === '/api/vision/summarize'), false);
  assert.equal(fixture.states.at(-1), false); assert.equal(fixture.tasks.size, 0);
  fixture.session.destroy();
});

test('a late summary from the previous owner cannot overwrite a restarted session', async () => {
  const summarizing = deferred(); let firstRead = true;
  const fixture = createFixture({ frames: true, fetch: (entry) => {
    if (entry.url === '/api/vision/summarize') return summarizing.promise;
    if (entry.url === '/api/vision/read' && firstRead) {
      firstRead = false; const body = entry.body;
      return new Response(JSON.stringify({ schemaVersion: '1', requestId: body.requestId, sourceId: body.sourceId,
        videoVersion: '1', analysisVersion: '1', frameTime: body.frameTime, status: 'candidate',
        result: { schemaVersion: '1', template: 'parabola', snapshot: { a: 1, h: 0, k: 0 }, area: null,
          title: '抛物线', explanation: '条件待确认。', pitfallHint: '' } }));
    }
    return undefined;
  } });
  assert.equal(await fixture.session.start(), true); await flush();
  assert.equal(fixture.pointUpdates.at(-1)[0].origin, 'vision');
  assert.equal(fixture.overlayOptions().source.kind, 'local-file');
  const old = fixture.calls.find((entry) => entry.url === '/api/vision/summarize');
  assert.ok(old); fixture.session.stop(); assert.equal(old.init.signal.aborted, true);
  assert.equal(await fixture.session.start(), true); await flush();
  summarizing.resolve(new Response(JSON.stringify({ schemaVersion: '1', requestId: old.body.requestId,
    sourceId: old.body.sourceId, videoVersion: '1', analysisVersion: '1', status: 'summary',
    summary: '旧会话总结不可展示。', keyPoints: [], pitfalls: [],
    observedTimes: old.body.observations.map((item) => item.frameTime) })));
  await flush();
  assert.ok(fixture.summaries.every((value) => value === null));
  assert.equal(fixture.states.at(-1), true); assert.equal(fixture.tasks.size, 1);
  fixture.session.destroy();
});

test('client recognition stops at its 32-call limit and a 30-minute session expires before another capture', async () => {
  const fixture = createFixture({ frames: true });
  assert.equal(await fixture.session.start(), true); await flush();
  for (let index = 0; index < 32; index += 1) assert.equal(await fixture.advance(), true);
  assert.equal(fixture.calls.filter((entry) => entry.url === '/api/vision/read').length, 32);
  assert.equal(fixture.states.at(-1), false); assert.equal(fixture.tasks.size, 0);
  fixture.session.destroy();
  const timed = createFixture({ frames: true });
  assert.equal(await timed.session.start(), true); await flush();
  const captures = timed.captures(); timed.setTime(1000 + 30 * 60 * 1000);
  assert.equal(await timed.advance(), true);
  assert.equal(timed.captures(), captures); assert.equal(timed.states.at(-1), false);
  assert.equal(timed.tasks.size, 0); timed.session.destroy();
});

const jpeg = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname,'../breakglass-reader/tests/helpers/fixtures/demo-6451-640x402.jpg')).toString('base64');
function oneFrame(fixture) { fixture.sandbox.session = fixture.session; return vm.runInContext("session.recognize({kind:'parabola',frameSize:{width:3024,height:1898}})",fixture.sandbox); }
test('prepare is shared and does not acquire; single frame and continuous reading consume the same counter', async () => {
  const f = createFixture({recognition:true,image:jpeg,frames:true});
  assert.deepEqual(await Promise.all([f.session.prepare(),f.session.prepare()]),[true,true]);
  assert.equal(f.calls.filter(v=>v.url==='/api/vision/session').length,1);
  assert.equal(f.calls[0].body.capability,'recognition-v1'); assert.equal(f.captures(),0);
  assert.equal((await oneFrame(f)).status,'unsupported'); assert.equal(f.session.snapshot().readCalls,1);
  await f.session.start(); await flush();
  assert.equal(f.calls.filter(v=>v.url==='/api/vision/session').length,1); assert.equal(f.session.snapshot().readCalls,2);
  f.session.destroy();
});
test('different recognition kinds cannot reset 32 reads and malformed JPEG never consumes a request', async () => {
  const f = createFixture({recognition:true,image:jpeg,frames:true}); await f.session.prepare();
  for(let i=0;i<32;i++) await oneFrame(f);
  await assert.rejects(oneFrame(f),/额度/); assert.equal(f.calls.filter(v=>v.url==='/api/vision/recognition').length,32);
  f.session.destroy();
  const invalid = createFixture({recognition:true,frames:true}); await invalid.session.prepare();
  await assert.rejects(oneFrame(invalid),/契约/); assert.equal(invalid.session.snapshot().readCalls,0); invalid.session.destroy();
});
test('single frame in flight aborts promptly even when transport ignores abort, with no queued second read', async () => {
  const delayed = deferred(), f = createFixture({recognition:true,image:jpeg,frames:true,fetch: e=>e.url==='/api/vision/recognition'?delayed.promise:undefined});
  await f.session.prepare(); const pending = oneFrame(f); const rejected = assert.rejects(pending,/取消|过期/); await flush();
  await assert.rejects(oneFrame(f),/正在处理/); f.session.stop(); await rejected;
  const call=f.calls.find(v=>v.url==='/api/vision/recognition'); assert.equal(call.init.signal.aborted,true);
  delayed.resolve(new Response('{}')); await flush(); assert.equal(f.session.snapshot().running,false); f.session.destroy();
});

test('a prepare-only session leaves no old floating overlay and concurrent continuous start reuses its pending grant', async () => {
 const begin=deferred();const f=createFixture({recognition:true,deferOverlay:true,fetch:e=>e.url==='/api/vision/session'?begin.promise:undefined});
 assert.equal(f.overlayOptions(),undefined);const prepared=f.session.prepare(),started=f.session.start();
 assert.equal(f.calls.filter(v=>v.url==='/api/vision/session').length,1);assert.equal(f.overlayOptions(),undefined);
 begin.resolve(new Response(JSON.stringify({token:'shared-grant'})));assert.equal(await prepared,true);assert.equal(await started,true);
 assert.ok(f.overlayOptions());f.session.destroy();
});
