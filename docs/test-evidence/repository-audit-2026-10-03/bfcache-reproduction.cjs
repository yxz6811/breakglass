// Diagnostic reproduction only. Not part of the repository's passing test count.
// Execute from the repository root: node docs/test-evidence/repository-audit-2026-10-03/bfcache-reproduction.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { createGeometryHarness } = require(path.join(root, 'tests/helpers/fake-geometry-page'));
const startedAt = new Date().toISOString();
const harness = createGeometryHarness();
harness.loadVideo();
harness.confirmPreset();
const before = {
  phase: harness.page.session.getState().phase,
  abSubmitListeners: harness.elements['ab-form'].listenerCount('submit'),
  presetClickListeners: harness.elements['preset-button'].listenerCount('click'),
  videoSrc: harness.video.src,
  revokedUrls: [...harness.revokedUrls],
};
assert.equal(before.phase, 'confirmed', 'the setup must have a confirmed scene');
assert.equal(before.abSubmitListeners, 1);
assert.equal(before.presetClickListeners, 1);

// These persisted events model entry into and return from the browser BFCache.
// They do not prove that a particular real browser cached the page.
harness.window.dispatch('pagehide', { persisted: true });
harness.window.dispatch('pageshow', { persisted: true });
harness.elements['preset-button'].dispatch('click');
const actual = {
  phaseAfterReturnAndPresetClick: harness.page.session.getState().phase,
  abSubmitListeners: harness.elements['ab-form'].listenerCount('submit'),
  presetClickListeners: harness.elements['preset-button'].listenerCount('click'),
  videoSrc: harness.video.src,
  revokedUrls: [...harness.revokedUrls],
};
const expected = {
  controllerUsableAfterPersistedReturn: true,
  phaseAfterPresetClick: 'review',
  abSubmitListeners: 1,
  presetClickListeners: 1,
  cachedLocalVideoUrlRetained: true,
};
const reproduced = actual.phaseAfterReturnAndPresetClick === 'empty'
  && actual.abSubmitListeners === 0 && actual.presetClickListeners === 0
  && actual.revokedUrls.includes(before.videoSrc);
assert.equal(reproduced, true, 'exit 0 means the documented defect was reproduced, not that BFCache behavior passed');
console.log(JSON.stringify({
  kind: 'diagnostic-defect-reproduction',
  startedAt, finishedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  runtime: { node: process.version, platform: os.platform(), release: os.release() },
  events: [{ type: 'pagehide', persisted: true }, { type: 'pageshow', persisted: true }, { type: 'click', target: 'preset-button' }],
  before, expected, actual, reproduced,
  conclusion: 'The cached controller is permanently disposed and cannot handle the preset click after return.',
  limitations: [
    'Uses the existing fake DOM, media and URL boundary; no browser or actual navigation was driven.',
    'Real-browser BFCache eligibility, event delivery and restored rendering remain unverified.',
    'This diagnostic is separate from the existing 621 passing tests; no product or test source was changed.',
  ],
}, null, 2));
