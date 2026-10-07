const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const rules = require('../extension/src/plugin/recognition-contracts.js');
const IMAGE = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname,
  '../breakglass-reader/tests/helpers/fixtures/demo-6451-640x402.jpg')).toString('base64');
const body = (changes = {}) => ({ schemaVersion: '011.1', requestId: 'recognition-1', sourceId: 'file-' + 'a'.repeat(64),
  videoVersion: '1', analysisVersion: '1', materialMode: 'self-authored', kind: 'parabola', frameTime: 6.451,
  frameSize: { width: 3024, height: 1898 }, image: IMAGE, ...changes });
const response = (changes = {}) => {
  const { image, materialMode, ...request } = body();
  return { ...request, jpegSize: { width: 640, height: 402 }, status: 'candidate',
    candidate: { template: 'parabola', snapshot: { a: 1.1, h: 0.5, k: -1.275 } },
    evidence: { formulaBasis: 'visible-equation', mathStatus: 'consistent', placementStatus: 'unknown', map: null,
      calibrationBasis: 'none', profileVersion: 'recognition-profile-v1', promptVersion: 'recognition-prompt-v1',
      calibrationVersion: 'recognition-calibration-v1' },
    limitations: ['placement_unknown', 'student_confirmation_required'], ...changes };
};

test('011 requests validate a real JPEG, independently preserve source dimensions and copy metadata', () => {
  const value = body(); const checked = rules.validateRecognitionRequest(value, { duration: 9.383333, frameSize: value.frameSize });
  assert.equal(checked.ok, true); assert.deepEqual(checked.jpegSize, { width: 640, height: 402 });
  checked.value.frameSize.width = 1; assert.equal(value.frameSize.width, 3024);
  assert.equal(rules.validateRecognitionRequest(value, { frameSize: { width: 3025, height: 1898 } }).ok, false);
  assert.equal(rules.validateRecognitionRequest(value, { duration: 6 }).ok, false);
});

test('011 request rejects URLs, unknown fields, other versions, unpermitted sources and altered frame proportions', () => {
  for (const update of [{ schemaVersion: '1' }, { kind: 'circle' }, { frameTime: NaN }, { frameTime: -1 },
    { frameSize: { width: 3024, height: 1080 } }, { frameSize: { width: 0, height: 0 } },
    { materialMode: 'permission-pending' }, { analysisVersion: '2' }, { sourceId: 'bilibili-video' },
    { image: 'https://example.invalid/frame.jpg' }, { image: IMAGE + '=' }, { prompt: 'secret' },
    { frames: [] }, { roi: { x: 0 } }, { image: IMAGE.replace('image/jpeg', 'image/png') }]) {
    assert.equal(rules.validateRecognitionRequest(body(update)).ok, false, JSON.stringify(Object.keys(update)));
  }
  const bytes = Buffer.from(IMAGE.split(',')[1], 'base64');
  const marker = bytes.indexOf(Buffer.from([0xff, 0xc0])); assert.ok(marker > 0);
  bytes.writeUInt16BE(641, marker + 7);
  assert.equal(rules.validateRecognitionRequest(body({ image: 'data:image/jpeg;base64,' + bytes.toString('base64') })).ok, false);
});

test('011 strict validators never invoke accessors or accept prototype traps or symbol keys', () => {
  const value = body(); let called = false;
  Object.defineProperty(value, 'requestId', { enumerable: true, get() { called = true; throw new Error('getter'); } });
  assert.equal(rules.validateRecognitionRequest(value).ok, false); assert.equal(called, false);
  assert.equal(rules.validateRecognitionRequest({ ...body(), [Symbol('hidden')]: 'x' }).ok, false);
  assert.equal(rules.validateRecognitionRequest(new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } })).ok, false);
});

test('011 candidate response binds every request identity and checks finite mathematics independently', () => {
  const checked = rules.validateRecognitionResponse(response(), body()); assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.candidate.snapshot, { a: 1.1, h: 0.5, k: -1.275 });
  for (const update of [{ requestId: 'late' }, { sourceId: 'file-' + 'b'.repeat(64) }, { videoVersion: '2' },
    { frameTime: 6 }, { kind: 'right-triangle' }, { frameSize: { width: 3024, height: 1900 } },
    { jpegSize: { width: 320, height: 201 } },
    { candidate: { template: 'parabola', snapshot: { a: 0, h: 0, k: 0 } } },
    { candidate: { template: 'parabola', snapshot: { a: 1, h: Infinity, k: 0 } } },
    { candidate: { template: 'parabola', snapshot: { a: '1', h: 0, k: 0 } } },
    { candidate: { template: 'parabola', snapshot: { a: 1, h: 0, k: 0, script: 'x' } } }]) {
    assert.equal(rules.validateRecognitionResponse(response(update), body()).ok, false);
  }
});

test('011 uncertainty and calibration cannot be promoted by self-reported anchors or confidence', () => {
  const current = response();
  for (const update of [{ map: { ox: 1, oy: 1, sx: 1, sy: 1 } }, { confidence: 1 }, { anchors: [] },
    { placementStatus: 'checked' }, { calibrationBasis: 'authored-reference' }]) {
    assert.equal(rules.validateRecognitionResponse(response({ evidence: { ...current.evidence, ...update } })).ok, false);
  }
  const calibrated = { ...current.evidence, placementStatus: 'checked', calibrationBasis: 'authored-reference',
    map: { ox: 100, oy: 200, sx: 10, sy: 25 } };
  assert.equal(rules.validateRecognitionResponse(response({ evidence: calibrated })).ok, true);
  assert.equal(rules.validateMap({ ox: 0, oy: 0, sx: 1, sy: 0 }), false);
  assert.equal(rules.validateMap({ ox: 0, oy: 0, sx: NaN, sy: 1 }), false);
});

test('011 negative results contain no candidate or guessed mathematical basis', () => {
  const value = response();
  const empty = response({ status: 'insufficient', candidate: null, evidence: { ...value.evidence,
    formulaBasis: 'none', mathStatus: 'insufficient' }, limitations: ['no_numeric_basis'] });
  assert.equal(rules.validateRecognitionResponse(empty).ok, true);
  assert.equal(rules.validateRecognitionResponse({ ...empty, candidate: value.candidate }).ok, false);
  assert.equal(rules.validateRecognitionResponse({ ...empty, evidence: value.evidence }).ok, false);
  assert.equal(rules.validateRecognitionResponse(response({ limitations: ['placement_unknown', 'placement_unknown'] })).ok, false);
  assert.equal(rules.validateRecognitionResponse(response({ limitations: ['model said something'] })).ok, false);
  const accessor = []; Object.defineProperty(accessor, 0, { enumerable: true, get() { throw new Error('never'); } });
  assert.equal(rules.validateRecognitionResponse(response({ limitations: accessor })).ok, false);
});

test('011 browser and Node validators agree on actual JPEG size and candidate snapshot without a Buffer dependency', () => {
  const sandbox = { atob, btoa }; vm.createContext(sandbox);
  for (const name of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js', 'plugin/recognition-contracts.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', name), 'utf8'), sandbox);
  }
  sandbox.input = JSON.stringify(body()); sandbox.output = JSON.stringify(response());
  assert.equal(vm.runInContext('BreakGlass.recognitionContracts.validateRecognitionRequest(JSON.parse(input)).ok', sandbox), true);
  assert.equal(vm.runInContext('BreakGlass.recognitionContracts.validateRecognitionResponse(JSON.parse(output), JSON.parse(input)).ok', sandbox), true);
});
