import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectRelease, releaseArguments, supplierRuntimeFingerprint, validateSupplierRuntime } from '../scripts/learning-release.mjs';
import { startProduction } from '../scripts/learning-production.mjs';

// These temporary files are explicit test doubles, never real approval evidence.
const NOW = Date.parse('2026-10-07T00:00:00.000Z');
const EXPIRY = new Date(NOW + 3600000).toISOString();
const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const SECRET = randomBytes(32).toString('base64url');
const FINGERPRINT = supplierRuntimeFingerprint({}, {});
const FIXTURE_TEXT = 'TEST FIXTURE ONLY: not a license, privacy assessment, guardian consent or legal approval.';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const check = (report, code) => report.checks.some((item) => item.status === 'blocked' && item.code === code);
async function fixture(run, { minors = false } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-release-test-'));
  const filename = path.join(folder, 'release.json'); await fs.mkdir(path.join(folder, 'approvals'));
  const audience = minors ? ['adults', 'minors'] : ['adults'];
  const evidence = [];
  for (const kind of ['rights', 'privacy', 'regional-release', 'supplier-data-flow', ...(minors ? ['minor-guardian'] : [])]) {
    const file = `approvals/${kind}.txt`; await fs.writeFile(path.join(folder, file), FIXTURE_TEXT);
    evidence.push({ id: `fixture-${kind}`, kind, file, sha256: hash(FIXTURE_TEXT), countries: ['CN', 'US'], audience, expiresAt: EXPIRY });
  }
  const adultId = randomUUID(); const minorId = randomUUID();
  const manifest = { schemaVersion: '1', mode: 'production-pilot', runtimeFingerprint: FINGERPRINT, publicOrigin: 'https://learning.example.com', dataDir: path.join(folder, 'data'),
    operator: { name: 'Explicit test operator', contact: 'test-operator@example.com' }, countries: ['CN', 'US'], audience, expiresAt: EXPIRY, evidence,
    accounts: [{ id: adultId, country: 'CN', ageBand: 'adult', guardianEvidenceId: null },
      ...(minors ? [{ id: minorId, country: 'US', ageBand: 'minor', guardianEvidenceId: 'fixture-minor-guardian' }] : [])] };
  const write = async () => fs.writeFile(filename, JSON.stringify(manifest));
  const inspect = () => inspectRelease(filename, { edgeSecret: SECRET, now: () => NOW, expectedFingerprint: FINGERPRINT });
  await write();
  try { await run({ folder, filename, manifest, adultId, minorId, write, inspect }); }
  finally { const absolute = path.resolve(folder); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('breakglass-release-test-')); await fs.rm(absolute, { recursive: true, force: true }); }
}
function request(headers = {}, address = '127.0.0.1') {
  return { socket: { remoteAddress: address }, headers: { host: 'learning.example.com', 'x-forwarded-proto': 'https',
    'x-breakglass-edge-secret': SECRET, ...headers } };
}

test('empty release settings and repository example remain blocked and disclose no private config', async () => {
  const empty = await inspectRelease(undefined, { now: () => NOW });
  assert.equal(empty.policy, null); assert.equal(empty.report.ready, false); assert.equal(check(empty.report, 'manifest_required'), true);
  const example = await inspectRelease(path.join(REPOSITORY, 'specs/009-learning-completion/release.example.json'), { edgeSecret: SECRET, now: () => NOW });
  assert.equal(example.report.ready, false); assert.equal(check(example.report, 'repository_storage_rejected'), true);
  assert.throws(() => releaseArguments(['--secret', SECRET]), /仅支持/);
  assert.equal(releaseArguments([], { BREAKGLASS_RELEASE_MANIFEST: '/explicit/operator/path.json' }), '/explicit/operator/path.json');
});
test('bounded scoped evidence files permit technical readiness without claiming actual deployment or valid legal approvals', async () => {
  await fixture(async ({ inspect, filename, adultId }) => {
    const result = await inspect(); assert.equal(result.report.ready, true); assert.ok(result.policy);
    assert.equal(result.report.approvedAccounts, 1); assert.equal(result.report.actualCloudDeploymentVerified, false);
    assert.equal(result.policy.authorizeAccount({ id: adultId }), true); assert.equal(result.policy.authorizeScope({ id: adultId, epoch: 0, sessionKey: 'private-memory-only' }), true);
    assert.equal(result.policy.authorizeScope(null), false); assert.equal(result.policy.authorizeAccount({ id: randomUUID() }), false);
    assert.equal(result.policy.secureCookies, true); assert.equal(Object.isFrozen(result.policy), true);
    const text = JSON.stringify(result.report);
    for (const privateValue of [SECRET, FIXTURE_TEXT, adultId, filename, 'test-operator@example.com']) assert.equal(text.includes(privateValue), false);
    assert.match(text, /法律充分性仍须外部验收/);
  });
});
test('supplier routing and enablement fingerprint must match approval; credentials rotate without hashing secrets', async () => {
  const vision = { baseUrl: 'https://vision.example.com/v1', model: 'vision-model', apiKey: 'private-old-key', jsonMode: true };
  const audio = { baseUrl: 'https://asr.example.com/v1', model: 'asr-model', apiKey: 'private-audio-key', ffmpegPath: '/operator/tool/ffmpeg' };
  const fingerprint = supplierRuntimeFingerprint(vision, audio);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(supplierRuntimeFingerprint({ ...vision, apiKey: 'private-new-key' }, { ...audio, apiKey: 'rotated-asr', ffmpegPath: '/different/fixed/tool' }), fingerprint);
  for (const changed of [{ ...vision, baseUrl: 'https://other.example.com/v1' }, { ...vision, model: 'different-model' },
    { ...vision, jsonMode: false }, { ...vision, apiKey: '' }]) assert.notEqual(supplierRuntimeFingerprint(changed, audio), fingerprint);
  assert.notEqual(supplierRuntimeFingerprint(vision, { ...audio, model: 'new-asr-model' }), fingerprint);
  assert.notEqual(supplierRuntimeFingerprint(vision, { ...audio, apiKey: '' }), fingerprint);
  await fixture(async ({ filename, manifest, write, inspect }) => {
    const empty = await inspect(); assert.equal(empty.report.ready, true); assert.equal(empty.report.runtimeMatches, true);
    const noExpected = await inspectRelease(filename, { edgeSecret: SECRET, now: () => NOW });
    assert.equal(check(noExpected.report, 'supplier_runtime_approval_mismatch'), true);
    const changed = await inspectRelease(filename, { edgeSecret: SECRET, now: () => NOW, expectedFingerprint: fingerprint });
    assert.equal(changed.report.ready, false); assert.equal(changed.report.runtimeMatches, false);
    manifest.runtimeFingerprint = fingerprint; await write();
    const approved = await inspectRelease(filename, { edgeSecret: SECRET, now: () => NOW, expectedFingerprint: fingerprint });
    assert.equal(approved.report.ready, true); assert.equal(approved.report.runtimeMatches, true);
    const output = JSON.stringify(approved.report);
    for (const privateValue of [fingerprint, vision.baseUrl, vision.model, vision.apiKey, audio.baseUrl, audio.model, audio.apiKey]) assert.equal(output.includes(privateValue), false);
    const runner = await startProduction({ manifestPath: filename, env: { BREAKGLASS_EDGE_SECRET: SECRET }, now: () => NOW,
      createServer: () => { throw new Error('changed runtime must not construct server'); } });
    assert.equal(runner.server, null); assert.equal(check(runner.report, 'supplier_runtime_approval_mismatch'), true);
  });
});
test('production supplier routing requires HTTPS or explicit loopback HTTP even when the provider is disabled', async () => {
  for (const baseUrl of ['', '   ', 'https://vision.example.com/v1', 'https://vision.example.com:8443/v1',
    'http://localhost:8080/v1', 'http://127.0.0.1/v1', 'http://[::1]:8080/v1']) {
    assert.equal(validateSupplierRuntime({ baseUrl }, {}), true);
    assert.match(supplierRuntimeFingerprint({}, { baseUrl }), /^[a-f0-9]{64}$/);
  }
  const invalid = ['http://vision.example.com/v1', 'ftp://vision.example.com/v1', 'file:///private/key', 'not a URL',
    'https:vision.example.com', 'https://u:private-password@vision.example.com/v1', 'https://@vision.example.com/v1',
    'https://vision.example.com/v1?key=private-query-key', 'https://vision.example.com/v1?', 'https://vision.example.com/v1#private-fragment',
    'https://vision.example.com/v1#', 'https://vision.example.com/with space', 'https://vision.example.com\n.evil/v1',
    'https://vision.example.com\\evil/v1', 'http://localhost.evil/v1', 'http://127.1/v1', 'http://2130706433/v1',
    'http://0x7f000001/v1', 'http://[::ffff:127.0.0.1]/v1', 'http://127.0.0.1:65536/v1', null, 1];
  for (const baseUrl of invalid) for (const isAudio of [false, true]) {
    const settings = isAudio ? {} : { baseUrl }; const audioSettings = isAudio ? { baseUrl } : {};
    assert.throws(() => validateSupplierRuntime(settings, audioSettings), (error) => error.code === 'supplier_runtime_config_invalid'
      && error.message === 'supplier_runtime_config_invalid');
    assert.throws(() => supplierRuntimeFingerprint(settings, audioSettings), /supplier_runtime_config_invalid/);
  }
  let constructions = 0;
  for (const env of [{ READER_BASE_URL: invalid[0] }, { BREAKGLASS_ASR_BASE_URL: invalid[5] }]) {
    const result = await startProduction({ env, now: () => NOW, createServer: () => { constructions += 1; throw new Error('unsafe URL must never construct'); } });
    assert.equal(result.server, null); assert.equal(result.report.ready, false); assert.equal(result.report.code, 'supplier_runtime_config_invalid');
    assert.equal(result.report.actualCloudDeploymentVerified, false);
    assert.doesNotMatch(JSON.stringify(result.report), /vision\.example|private-password/);
  }
  assert.equal(constructions, 0);
});
test('strict manifest origin, schema, countries, audience, expiry and edge secret reject broad or unchecked release configuration', async () => {
  await fixture(async ({ manifest, write, inspect, filename }) => {
    const origin = manifest.publicOrigin;
    for (const bad of ['http://learning.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://learning.example.com:443',
      'https://learning.example.com:8443', 'https://learning.example.com/', 'https://learning.example.com/path', 'https://u:p@learning.example.com',
      'https://learning.example.com?approved=1', 'https://learning.example.com#approved', 'https://learning.example.invalid']) {
      manifest.publicOrigin = bad; await write(); assert.equal(check((await inspect()).report, 'public_https_origin_required'), true);
    }
    manifest.publicOrigin = origin; manifest.approved = true; await write(); assert.equal(check((await inspect()).report, 'manifest_schema_invalid'), true);
    delete manifest.approved; const originalCountries = manifest.countries;
    manifest.countries = ['CN', 'CN']; await write(); assert.equal(check((await inspect()).report, 'region_audience_invalid'), true);
    for (const country of ['ZZ', 'EU', 'XX']) { manifest.countries = [country]; await write(); assert.equal(check((await inspect()).report, 'region_audience_invalid'), true); }
    manifest.countries = originalCountries; manifest.audience = ['all-ages']; await write(); assert.equal(check((await inspect()).report, 'region_audience_invalid'), true);
    manifest.audience = ['adults']; manifest.expiresAt = new Date(NOW - 1).toISOString(); await write();
    assert.equal(check((await inspect()).report, 'release_expired_or_missing'), true);
    manifest.expiresAt = EXPIRY; await write();
    for (const secret of [undefined, 'short', 'a'.repeat(43), 'x'.repeat(400), SECRET + '\n']) {
      const result = await inspectRelease(filename, { edgeSecret: secret, now: () => NOW }); assert.equal(check(result.report, 'strong_edge_secret_required'), true);
    }
  });
});
test('evidence path traversal, symlinks, over-budget files and bad hashes fail closed without printing evidence', async () => {
  await fixture(async ({ folder, filename, manifest, write, inspect }) => {
    const original = manifest.evidence[0].file;
    for (const file of ['../outside.txt', 'approvals/../rights.txt', '/outside.txt', 'C:\\outside.txt', 'approvals\\..\\outside.txt']) {
      manifest.evidence[0].file = file; await write(); assert.equal(check((await inspect()).report, 'evidence_path_rejected'), true);
    }
    manifest.evidence[0].file = original; manifest.evidence[0].sha256 = '0'.repeat(64); await write();
    assert.equal(check((await inspect()).report, 'evidence_hash_mismatch'), true);
    manifest.evidence[0].sha256 = hash(FIXTURE_TEXT); await fs.writeFile(path.join(folder, original), 'x'.repeat(128 * 1024 + 1)); await write();
    assert.equal(check((await inspect()).report, 'evidence_file_invalid'), true);
    await fs.writeFile(path.join(folder, original), FIXTURE_TEXT);
    const alias = path.join(folder, 'linked'); await fs.symlink(path.join(folder, 'approvals'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    manifest.evidence[0].file = 'linked/rights.txt'; await write(); assert.equal(check((await inspect()).report, 'evidence_symlink_rejected'), true);
    manifest.evidence[0].file = original; manifest.dataDir = path.join(REPOSITORY, 'private-data'); await write();
    assert.equal(check((await inspect()).report, 'repository_storage_rejected'), true);
    manifest.dataDir = 'relative-data'; await write(); assert.equal(check((await inspect()).report, 'external_absolute_path_required'), true);
    const oversized = path.join(folder, 'oversized.json'); await fs.writeFile(oversized, 'x'.repeat(128 * 1024 + 1));
    assert.equal(check((await inspectRelease(oversized, { edgeSecret: SECRET, now: () => NOW })).report, 'manifest_file_invalid'), true);
    assert.equal((await inspectRelease(filename, { edgeSecret: SECRET, now: () => NOW })).report.ready, false);
  });
});
test('minor and regional approvals require matching file-backed guardian references and reject duplicate, missing or mismatched account scopes', async () => {
  await fixture(async ({ manifest, write, inspect, minorId }) => {
    let result = await inspect(); assert.equal(result.report.ready, true); assert.equal(result.policy.authorizeAccount({ id: minorId }), true);
    manifest.accounts[1].guardianEvidenceId = null; await write(); assert.equal(check((await inspect()).report, 'approved_account_scope_required'), true);
    manifest.accounts[1].guardianEvidenceId = 'fixture-rights'; await write(); assert.equal(check((await inspect()).report, 'approved_account_scope_required'), true);
    manifest.accounts[1].guardianEvidenceId = 'fixture-minor-guardian'; manifest.accounts[1].country = 'DE'; await write();
    assert.equal(check((await inspect()).report, 'approved_account_scope_required'), true);
    manifest.accounts[1].country = 'US'; manifest.evidence[0].countries = ['CN']; await write();
    assert.equal(check((await inspect()).report, 'approval_scope_incomplete'), true);
    manifest.evidence[0].countries = ['CN', 'US']; manifest.accounts.push({ ...manifest.accounts[0] }); await write();
    assert.equal(check((await inspect()).report, 'approved_account_scope_required'), true);
    manifest.accounts.pop(); manifest.evidence = [{ id: 'malformed', kind: 'minor-guardian', countries: 42 }]; await write();
    result = await inspect(); assert.equal(result.report.ready, false); assert.equal(result.policy, null);
  }, { minors: true });
});
test('evidence expiry bounds runtime readiness and expired individual evidence cannot be overridden by a future manifest expiry', async () => {
  await fixture(async ({ filename, manifest, write, adultId }) => {
    const earlier = NOW + 60000; manifest.evidence[0].expiresAt = new Date(earlier).toISOString(); await write();
    let time = NOW; const result = await inspectRelease(filename, { edgeSecret: SECRET, now: () => time, expectedFingerprint: FINGERPRINT });
    assert.equal(result.report.ready, true); assert.equal(result.report.expiresAt, manifest.evidence[0].expiresAt);
    time = earlier; assert.equal(result.policy.authorizeAccount({ id: adultId }), false);
    const expired = await inspectRelease(filename, { edgeSecret: SECRET, now: () => time, expectedFingerprint: FINGERPRINT });
    assert.equal(expired.report.ready, false); assert.equal(check(expired.report, 'evidence_schema_or_expiry_invalid'), true);
  });
});
test('edge checks require loopback, exact Host, secret and HTTPS proxy evidence; approval changes and expiry revoke scope', async () => {
  await fixture(async ({ filename, folder, manifest, adultId, write }) => {
    let time = NOW; const { policy } = await inspectRelease(filename, { edgeSecret: SECRET, now: () => time, expectedFingerprint: FINGERPRINT });
    assert.equal(policy.checkRequest(request()), true); assert.equal(policy.checkRequest(request({}, '::1')), true);
    assert.equal(policy.checkRequest(request({}, '::ffff:127.0.0.1')), true);
    for (const headers of [{ host: 'other.example.com' }, { host: 'learning.example.com:443' }, { host: ['learning.example.com'] },
      { 'x-forwarded-proto': 'http' }, { 'x-forwarded-proto': 'https,http' }, { 'x-breakglass-edge-secret': 'wrong' }, { 'x-breakglass-edge-secret': undefined }]) {
      assert.equal(policy.checkRequest(request(headers)), false);
    }
    for (const address of ['203.0.113.1', '::ffff:203.0.113.1', '::ffff:127.999.999.999', { evil: true }]) assert.equal(policy.checkRequest(request({}, address)), false);
    assert.equal(policy.checkRequest(null), false);
    await fs.writeFile(path.join(folder, manifest.evidence[0].file), 'TEST FIXTURE REVOKED'); assert.equal(policy.authorizeScope({ id: adultId }), false);
    await fs.writeFile(path.join(folder, manifest.evidence[0].file), FIXTURE_TEXT); assert.equal(policy.authorizeScope({ id: adultId }), true);
    manifest.operator.name = 'Changed approval manifest'; await write(); assert.equal(policy.authorizeAccount({ id: adultId }), false);
    time = NOW + 3600000; assert.equal(policy.checkRequest(request()), false); assert.equal(policy.authorizeScope({ id: adultId }), false);
  });
});
test('production runner never listens on incomplete config; ready runner binds only loopback and forwards frozen policy', async () => {
  let calls = 0;
  const blocked = await startProduction({ env: {}, now: () => NOW, createServer: () => { calls += 1; throw new Error('must not start'); } });
  assert.equal(blocked.server, null); assert.equal(blocked.report.ready, false); assert.equal(calls, 0);
  await fixture(async ({ filename, manifest, adultId }) => {
    let configuration; let bind;
    class FakeServer extends EventEmitter { listen(port, host) { bind = { port, host }; this.listening = true;
      queueMicrotask(() => this.emit('listening')); return this; } }
    const result = await startProduction({ manifestPath: filename, env: { BREAKGLASS_EDGE_SECRET: SECRET, BREAKGLASS_PRODUCTION_PORT: '4175' }, now: () => NOW,
      createServer: (options) => { configuration = options; return new FakeServer(); } });
    assert.equal(result.report.ready, true); assert.equal(result.report.actualCloudDeploymentVerified, false);
    assert.deepEqual(bind, { port: 4175, host: '127.0.0.1' }); assert.deepEqual(configuration.allowedOrigins, [manifest.publicOrigin]);
    assert.equal(configuration.dataDir, manifest.dataDir); assert.equal(configuration.releasePolicy.authorizeAccount({ id: adultId }), true);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
    const invalidPort = await startProduction({ manifestPath: filename, env: { BREAKGLASS_EDGE_SECRET: SECRET, BREAKGLASS_PRODUCTION_PORT: '0' }, now: () => NOW,
      createServer: () => { throw new Error('invalid port must not construct'); } });
    assert.equal(check(invalidPort.report, 'production_start_failed'), true); assert.equal(invalidPort.server, null);
  });
});
test('check CLI rejects empty configs with a readiness report and never outputs secrets or evidence bodies', async () => {
  const release = path.join(REPOSITORY, 'scripts/learning-release.mjs');
  const empty = spawnSync(process.execPath, [release], { encoding: 'utf8', env: { ...process.env, BREAKGLASS_RELEASE_MANIFEST: '', BREAKGLASS_EDGE_SECRET: SECRET }, timeout: 5000 });
  assert.equal(empty.status, 2); assert.equal(JSON.parse(empty.stdout).ready, false); assert.equal(empty.stdout.includes(SECRET), false);
  const production = spawnSync(process.execPath, [path.join(REPOSITORY, 'scripts/learning-production.mjs')],
    { encoding: 'utf8', env: { ...process.env, BREAKGLASS_RELEASE_MANIFEST: '', BREAKGLASS_EDGE_SECRET: SECRET }, timeout: 5000 });
  assert.equal(production.status, 2); assert.equal(JSON.parse(production.stdout).ready, false); assert.equal(production.stdout.includes(SECRET), false);
  await fixture(async ({ folder, filename }) => {
    const clockFile = path.join(folder, 'explicit-test-clock.mjs'); await fs.writeFile(clockFile, `Date.now = () => ${NOW};\n`);
    const environment = { ...process.env, BREAKGLASS_EDGE_SECRET: SECRET, READER_BASE_URL: '', READER_MODEL: '', READER_API_KEY: '', READER_JSON_MODE: '0',
      BREAKGLASS_ASR_BASE_URL: '', BREAKGLASS_ASR_MODEL: '', BREAKGLASS_ASR_API_KEY: '', BREAKGLASS_FFMPEG_PATH: '', BREAKGLASS_ASR_HOURLY_CALLS: '4' };
    const approved = spawnSync(process.execPath, ['--import', pathToFileURL(clockFile).href, release, '--manifest', filename], { encoding: 'utf8', env: environment, timeout: 5000 });
    assert.equal(approved.status, 0); assert.equal(JSON.parse(approved.stdout).runtimeMatches, true);
    for (const privateValue of [SECRET, FIXTURE_TEXT, FINGERPRINT]) assert.equal(approved.stdout.includes(privateValue), false);
    const changed = spawnSync(process.execPath, ['--import', pathToFileURL(clockFile).href, release, '--manifest', filename], { encoding: 'utf8', timeout: 5000,
      env: { ...environment, READER_BASE_URL: 'https://changed-runtime.example.com/v1', READER_MODEL: 'changed-runtime-model', READER_API_KEY: 'changed-private-test-key' } });
    assert.equal(changed.status, 2); assert.equal(JSON.parse(changed.stdout).runtimeMatches, false);
    for (const privateValue of ['changed-runtime.example.com', 'changed-runtime-model', 'changed-private-test-key', SECRET]) assert.equal(changed.stdout.includes(privateValue), false);
    for (const runtime of [{ READER_BASE_URL: 'http://unsafe-provider.example.com/v1' },
      { BREAKGLASS_ASR_BASE_URL: 'https://private-user:private-password@unsafe-asr.example.com/v1?key=private-query' }]) {
      const unsafe = spawnSync(process.execPath, ['--import', pathToFileURL(clockFile).href, release, '--manifest', filename],
        { encoding: 'utf8', timeout: 5000, env: { ...environment, ...runtime } });
      assert.equal(unsafe.status, 2); assert.equal(JSON.parse(unsafe.stdout).code, 'supplier_runtime_config_invalid');
      assert.doesNotMatch(unsafe.stdout + unsafe.stderr, /unsafe-provider|unsafe-asr|private-user|private-password|private-query/);
      assert.equal(unsafe.stdout.includes(SECRET), false);
    }
  });
});
