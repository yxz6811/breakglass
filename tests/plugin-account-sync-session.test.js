const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { lessons } = require('../extension/src/plugin/registry');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign(extra, { addEventListener: (type, callback) => { const callbacks = listeners.get(type) || new Set(); callbacks.add(callback); listeners.set(type, callbacks); },
    removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
    dispatch: (type) => { for (const callback of listeners.get(type) || []) callback(); } });
}
function harness() {
  let clock = 1000; let loopRunning = false; let visualOptions; let overlayOptions; let revokeListener; let watchNumber = 0; let watchInvalid = false;
  const messages = []; const statuses = [];
  const video = eventTarget({ currentSrc: 'http://localhost:4173' + lessons[0].path,
    duration: lessons[0].duration, currentTime: 3, paused: true, isConnected: true });
  const document = eventTarget({ hidden: false, querySelector: () => video }); const window = eventTarget();
  const overlay = { updateStatus: (text) => statuses.push(text), updatePoints: () => {}, updateSummary: () => {}, setRecognitionState: () => {}, destroy: () => {} };
  const BreakGlass = { pluginLoop: { createVisualLoop: (options) => {
    visualOptions = options; return { start: () => { loopRunning = true; }, stop: () => { loopRunning = false; }, isRunning: () => loopRunning };
  } }, pluginOverlay: { createLearningOverlay: (options) => { overlayOptions = options; return overlay; } } };
  const chrome = { runtime: { id: 'a'.repeat(32), sendMessage: async (message) => {
    messages.push(structuredClone(message));
    if (message.type === 'plugin:watch-begin') return { ok: true, enabled: true, token: 'watch-' + (++watchNumber) };
    if (message.type === 'plugin:begin') return { ok: true, token: 'visual-1' };
    if (message.type === 'plugin:watch' && watchInvalid) return { ok: false, message: '配对已变化，请重新播放。' };
    return { ok: true };
  }, onMessage: { addListener: (callback) => { revokeListener = callback; }, removeListener: () => {} } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/src/plugin/session.js'), 'utf8'),
    { BreakGlass, document, window, chrome, location: { origin: 'http://localhost:4173', pathname: '/learning-lab/lesson.html' },
      Date: { now: () => clock }, queueMicrotask });
  BreakGlass.pluginSession.start({ cssText: '', lessons });
  return { video, document, messages, statuses, clock: (value) => { clock = value; }, options: () => overlayOptions,
    failVisual: () => { loopRunning = false; visualOptions.onStatus('模型未配置。'); },
    invalidateWatch: () => { watchInvalid = true; },
    revoke: (token) => revokeListener({ type: 'plugin:revoked', token }, { id: chrome.runtime.id }, () => {}) };
}
test('explicit playback starts minimal watch tracking without AI and a missing model leaves it active', async () => {
  const h = harness(); assert.equal(h.messages.length, 0);
  h.video.paused = false; h.video.dispatch('play'); await tick();
  assert.equal(h.messages.some((m) => m.type === 'plugin:begin'), false);
  assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 1);
  await h.options().onToggleRecognition(); h.failVisual(); await tick();
  assert.equal(h.messages.some((m) => m.type === 'plugin:end' && m.token === 'visual-1'), true);
  h.video.currentTime = 4; h.video.dispatch('pause'); await tick();
  assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 2);
  assert.equal(h.messages.at(-1).token, 'watch-1');
  assert.equal(h.messages.some((m) => m.image || m.audio || m.password), false);
});
test('time updates are throttled, hidden or revoked watch does not resume until fresh playback', async () => {
  const h = harness(); h.video.paused = false; h.video.dispatch('play'); await tick();
  h.clock(1100); h.video.dispatch('timeupdate'); await tick(); assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 1);
  h.clock(16001); h.video.currentTime = 4; h.video.dispatch('timeupdate'); await tick(); assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 2);
  h.document.hidden = true; h.document.dispatch('visibilitychange'); await tick();
  assert.equal(h.messages.some((m) => m.type === 'plugin:watch-end' && m.token === 'watch-1'), true);
  h.document.hidden = false; h.clock(40000); h.video.dispatch('timeupdate'); await tick(); assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 2);
  h.video.dispatch('play'); await tick(); assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 3);
  h.revoke('watch-2'); await tick(); h.clock(60000); h.video.dispatch('timeupdate'); await tick();
  assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 3);
});
test('pairing change stops old time updates and requires a new playback-bound watch session', async () => {
  const h = harness(); h.video.paused = false; h.video.dispatch('play'); await tick();
  h.invalidateWatch(); h.clock(20000); h.video.dispatch('timeupdate'); await tick();
  assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 2);
  assert.equal(h.messages.some((m) => m.type === 'plugin:watch-end' && m.token === 'watch-1'), true);
  h.clock(40000); h.video.dispatch('timeupdate'); await tick(); assert.equal(h.messages.filter((m) => m.type === 'plugin:watch').length, 2);
  h.video.dispatch('play'); await tick(); assert.equal(h.messages.some((m) => m.type === 'plugin:watch-begin' && h.messages.filter((p) => p.type === 'plugin:watch-begin').length === 2), true);
});
