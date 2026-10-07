const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contracts = require('../extension/src/plugin/contracts');

const source = () => ({ kind: 'visual-session', id: 'pilot-triangle-3-4-5', version: '1',
  analysisVersion: '1', title: '自制三角形', materialMode: 'self-authored' });
const context = () => ({ source: source(), duration: 12 });
const candidate = () => ({ schemaVersion: '1', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'cm' }, area: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
  title: '勾股关系', explanation: '两直角边的平方和等于斜边的平方。', pitfallHint: '不能直接相加边长。' });
const point = () => ({ id: 'vision-point-1', start: 2, end: 4, area: candidate().area,
  title: '勾股关系', explanation: '两直角边的平方和等于斜边的平方。', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'cm' }, sourceLabel: 'AI视觉候选，人工核对', origin: 'vision' });
const record = () => ({ id: 'record-1', kind: 'question', source: source(), time: 3,
  title: '为什么不能把边长相加？', note: '想用面积理解。', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'vision', sourceLabel: 'AI视觉候选，人工核对',
  createdAt: '2026-10-06T00:00:00.000Z' });

test('source identities reject unknown fields, inherited data, credentials and wrong analysis versions', () => {
  assert.equal(contracts.validateSource(source()).ok, true);
  for (const value of [
    { ...source(), url: 'https://private.invalid/?token=secret' },
    { ...source(), analysisVersion: '2' }, { ...source(), id: 'https://video.invalid' },
    { ...source(), title: 'x'.repeat(121) }, { ...source(), title: 'cookie=session-secret' },
    Object.assign(Object.create({ cookie: 'secret' }), source()),
    JSON.parse('{"__proto__":{"polluted":true}}')
  ]) assert.equal(contracts.validateSource(value).ok, false);
  const copy = contracts.validateSource(source()).value;
  copy.title = 'changed';
  assert.equal(source().title, '自制三角形');
  assert.equal(Object.prototype.polluted, undefined);
});

test('pending-rights metadata cannot become usable points or saved records', () => {
  const pending = { ...source(), materialMode: 'permission-pending' };
  assert.equal(contracts.validateSource(pending).ok, true);
  assert.equal(contracts.validatePoints([point()], { source: pending, duration: 12 }).ok, false);
  assert.equal(contracts.validateRecord({ ...record(), source: pending }, { source: pending, duration: 12 }).ok, false);
});

test('007 local file identities require complete SHA-256 without granting analysis permission', () => {
  const file = { ...source(), kind: 'local-file', id: 'file-' + 'a'.repeat(64) };
  assert.equal(contracts.validateSource(file).ok, true);
  assert.equal(contracts.validateSource({ ...file, id: 'same-title' }).ok, false);
  assert.equal(contracts.validateSource({ ...file, id: 'file-' + 'a'.repeat(63) }).ok, false);
  assert.equal(contracts.validateRecord({ ...record(), source: { ...file, materialMode: 'permission-pending' } },
    { source: { ...file, materialMode: 'permission-pending' }, duration: 12 }).ok, false);
});

test('vision candidates and manual corrections have honest source-compatible origins', () => {
  for (const origin of ['vision', 'manual']) assert.equal(contracts.validatePoints([{ ...point(), origin }], context()).ok, true);
  assert.equal(contracts.validatePoints([{ ...point(), origin: 'author' }], context()).ok, false);
  const author = { ...source(), kind: 'creator-layer' };
  assert.equal(contracts.validatePoints([{ ...point(), origin: 'author' }], { source: author }).ok, true);
  assert.equal(contracts.validatePoints([point()], { source: author }).ok, false);
  const notes = { ...source(), kind: 'manual-notes' };
  assert.equal(contracts.validatePoints([{ ...point(), origin: 'manual', area: null }], { source: notes }).ok, true);
});

test('time and normalized region bounds reject non-finite and out-of-video data', () => {
  for (const value of [
    { ...point(), start: NaN }, { ...point(), end: Infinity }, { ...point(), start: -1 },
    { ...point(), start: 4, end: 4 }, { ...point(), end: 13 },
    { ...point(), area: { x: 0.9, y: 0, width: 0.2, height: 0.2 } },
    { ...point(), area: { x: 0, y: 0, width: 1, height: 0 } },
    { ...point(), area: { x: 0, y: NaN, width: 1, height: 1 } }
  ]) assert.equal(contracts.validatePoints([value], context()).ok, false);
  assert.equal(contracts.validatePoints([point()], { source: source(), duration: 601 }).ok, false);
  assert.equal(contracts.validatePoints([point()], { source: source(), duration: '12' }).ok, false);
});

test('batch validation is atomic and rejects duplicate, sparse and accessor arrays without executing getters', () => {
  assert.equal(contracts.validatePoints([point(), point()], context()).ok, false);
  assert.equal(contracts.validatePoints(new Array(2), context()).ok, false);
  assert.equal(contracts.validatePoints(Array.from({ length: 65 }, (_, i) => ({ ...point(), id: `p-${i}` })), context()).ok, false);
  let reads = 0;
  const values = [];
  Object.defineProperty(values, '0', { enumerable: true, get() { reads += 1; throw Error('must not execute'); } });
  assert.equal(contracts.validatePoints(values, context()).ok, false);
  const accessor = { ...candidate() };
  Object.defineProperty(accessor, 'snapshot', { enumerable: true, get() { reads += 1; throw Error('must not execute'); } });
  assert.equal(contracts.validateVisualResult(accessor).ok, false);
  assert.equal(reads, 0);
});

test('AI result is a limited candidate and rejects executable, unknown or automatic-verdict fields', () => {
  const result = contracts.validateVisualResult(candidate());
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.value, 'confirmed'), false);
  for (const value of [
    { ...candidate(), code: 'alert(1)' }, { ...candidate(), schemaVersion: '2' },
    { ...candidate(), template: 'execute-code' }, { ...candidate(), isWrong: true },
    { ...candidate(), status: 'confirmed' }, { ...candidate(), frame: 'data:image/jpeg;base64,secret' },
    { ...candidate(), pitfallHint: 'x'.repeat(401) }, { ...candidate(), explanation: 'x'.repeat(1501) }
  ]) assert.equal(contracts.validateVisualResult(value).ok, false);
  assert.equal(contracts.validateVisualResult({ ...candidate(), area: null, pitfallHint: '' }).ok, true);
});

test('both mathematical templates reuse finite-domain and right-triangle validation', () => {
  assert.equal(contracts.validateVisualResult({ ...candidate(), template: 'parabola', snapshot: { a: 1, h: 2, k: 0 } }).ok, true);
  for (const snapshot of [{ a: 0, h: 2, k: 0 }, { a: 1, h: Infinity, k: 0 },
    { a: 1, h: Number.MAX_VALUE, k: 0 }, { a: 1, h: 2, k: 0, code: 'run()' }]) {
    assert.equal(contracts.validateVisualResult({ ...candidate(), template: 'parabola', snapshot }).ok, false);
  }
  for (const snapshot of [{ AB: -3, AC: 4, unit: 'cm' }, { AB: 3, AC: 4, unit: 'mm' },
    { AB: Number.MAX_VALUE, AC: Number.MAX_VALUE, unit: 'cm' }, { AB: 3, AC: 4, unit: 'cm', BC: 99 }]) {
    assert.equal(contracts.validateVisualResult({ ...candidate(), snapshot }).ok, false);
  }
});

test('saved records contain only manual question/pitfall and strict source-bound snapshots', () => {
  for (const kind of ['question', 'pitfall']) assert.equal(contracts.validateRecord({ ...record(), kind }, context()).ok, true);
  for (const value of [
    { ...record(), kind: 'student-wrong' }, { ...record(), source: { ...source(), version: '2' } },
    { ...record(), time: 13 }, { ...record(), note: 'x'.repeat(1001) },
    { ...record(), note: 'https://private.invalid/?token=secret' },
    { ...record(), note: 'Cookie: session-secret' }, { ...record(), explanation: candidate().explanation },
    { ...record(), transcript: 'whole lesson' }, { ...record(), createdAt: '2026-02-30T00:00:00.000Z' }
  ]) assert.equal(contracts.validateRecord(value, context()).ok, false);
  const input = record();
  const checked = contracts.validateRecord(input, context());
  checked.value.snapshot.AB = 999; checked.value.source.version = 'changed';
  assert.equal(input.snapshot.AB, 3); assert.equal(input.source.version, '1');
});

test('throwing prototype traps fail closed instead of escaping the validator', () => {
  const untrusted = new Proxy({}, { getPrototypeOf() { throw Error('untrusted'); } });
  assert.equal(contracts.validateSource(untrusted).ok, false);
  assert.equal(contracts.validateVisualResult(untrusted).ok, false);
});

test('site policy allows only the exact controlled origin and path, leaving Bilibili off', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    assert.equal(contracts.resolvePolicy(`http://${host}:4173/learning-lab/lesson.html`).allowed, true);
  }
  for (const url of ['http://localhost:4173/other.html', 'http://localhost:4174/learning-lab/lesson.html',
    'https://localhost:4173/learning-lab/lesson.html', 'http://localhost:4173/learning-lab/lesson.html?lessonId=breakglass-plugin-pilot-v1',
    'http://user:password@localhost:4173/learning-lab/lesson.html', 'https://www.bilibili.com/video/BVfake',
    'https://localhost.attacker.invalid:4173/learning-lab/lesson.html', 'javascript:alert(1)']) {
    assert.equal(contracts.resolvePolicy(url).allowed, false, url);
  }
  assert.equal(contracts.resolvePolicy('https://www.bilibili.com/video/BVfake').code, 'permission_pending');
});

test('browser IIFE works with the actual evaluator/geometry imports and no CommonJS runtime', () => {
  const sandbox = vm.createContext({ URL });
  for (const file of ['curve/evaluate.js', 'geometry-scene/validate.js', 'plugin/contracts.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/src', file), 'utf8'), sandbox);
  }
  const input = { ...candidate(), template: 'parabola', snapshot: { a: 1, h: 2, k: 0 } };
  assert.equal(vm.runInContext(`BreakGlass.pluginContracts.validateVisualResult(${JSON.stringify(input)}).ok`, sandbox), true);
});
