import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
import { loadAudioSettings } from './learning-audio.mjs';

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const MAX_BYTES = 128 * 1024;
const KINDS = ['rights', 'privacy', 'regional-release', 'supplier-data-flow', 'minor-guardian'];
const REQUIRED = KINDS.slice(0, 4);
const AUDIENCES = ['adults', 'minors'];
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const NON_COUNTRY_CODES = new Set(['AC', 'CP', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'XK', 'ZZ']);
const country = (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value)
  && !NON_COUNTRY_CODES.has(value) && Boolean(REGION_NAMES.of(value));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const iso = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const privateText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const uniqueList = (value, limit, validate) => Array.isArray(value) && value.length > 0 && value.length <= limit
  && value.every(validate) && new Set(value).size === value.length;
const within = (target, parent) => { const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const reject = (code) => { throw Object.assign(new Error(code), { code }); };

/** Production-only supplier routing validation. Development protocols remain independent. */
export function validateSupplierRuntime(settings = {}, audioSettings = {}) {
  const validBaseUrl = (value) => {
    if (value === undefined || value === '') return true;
    if (typeof value !== 'string' || value.length > 2048) return false;
    const text = value.trim();
    if (!text) return true;
    if (!/^https?:\/\//i.test(text) || /[\s\\?#]/.test(text)) return false;
    let url; try { url = new URL(text); } catch { return false; }
    if (url.username || url.password || url.search || url.hash) return false;
    const authority = text.match(/^https?:\/\/([^/]+)/i)?.[1];
    if (!authority || authority.includes('@')) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    // Require an explicit loopback spelling; URL-normalized numeric/alias hosts are rejected.
    return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(authority)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  };
  if (!settings || typeof settings !== 'object' || !audioSettings || typeof audioSettings !== 'object'
    || !validBaseUrl(settings.baseUrl) || !validBaseUrl(audioSettings.baseUrl)) reject('supplier_runtime_config_invalid');
  return true;
}

/** A non-secret fingerprint: credential rotation leaves approved supplier routing unchanged. */
export function supplierRuntimeFingerprint(settings = {}, audioSettings = {}) {
  validateSupplierRuntime(settings, audioSettings);
  const normalize = (value) => typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  const vision = { baseUrl: normalize(settings.baseUrl), model: typeof settings.model === 'string' ? settings.model.trim() : '',
    jsonMode: settings.jsonMode === true, configured: Boolean(settings.baseUrl && settings.apiKey && settings.model) };
  const audio = { baseUrl: normalize(audioSettings.baseUrl), model: typeof audioSettings.model === 'string' ? audioSettings.model.trim() : '',
    configured: Boolean(audioSettings.baseUrl && audioSettings.apiKey && audioSettings.model && audioSettings.ffmpegPath) };
  return sha(JSON.stringify({ vision, audio }));
}

async function readSmallFile(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) reject('file_size_rejected');
    const buffer = Buffer.alloc(info.size + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead; }
    if (offset !== info.size) reject('file_changed_during_read');
    return buffer.subarray(0, offset);
  } finally { await file.close(); }
}
function readSmallFileSync(filename) {
  const file = syncFs.openSync(filename, 'r');
  try {
    const info = syncFs.fstatSync(file);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) return null;
    const buffer = Buffer.alloc(info.size + 1); let offset = 0;
    while (offset < buffer.length) { const bytesRead = syncFs.readSync(file, buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead; }
    return offset === info.size ? buffer.subarray(0, offset) : null;
  } finally { syncFs.closeSync(file); }
}

function publicOrigin(value) {
  if (typeof value !== 'string' || value.length > 253) return null;
  let url; try { url = new URL(value); } catch { return null; }
  const hostname = url.hostname;
  return url.protocol === 'https:' && url.origin === value && !url.port && !url.username && !url.password && !url.search && !url.hash
    && !isIP(hostname.replace(/^\[|\]$/g, '')) && hostname.includes('.')
    && hostname.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname) ? url : null;
}

async function externalLocation(target, { existing = false, directory = false } = {}) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) reject('external_absolute_path_required');
  const absolute = path.resolve(target); const repository = await fs.realpath(REPOSITORY);
  if (within(absolute, path.resolve(REPOSITORY))) reject('repository_storage_rejected');
  for (let ancestor = path.dirname(absolute); ; ancestor = path.dirname(ancestor)) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) reject('symlink_rejected'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (ancestor === path.dirname(ancestor)) break;
  }
  let cursor = absolute; const missing = [];
  while (true) {
    try {
      const info = await fs.lstat(cursor);
      if (info.isSymbolicLink()) reject('symlink_rejected');
      if (missing.length && !info.isDirectory()) reject('data_directory_invalid');
      if (cursor === absolute && directory && !info.isDirectory()) reject('data_directory_invalid');
      const actual = path.join(await fs.realpath(cursor), ...missing.reverse());
      if (within(actual, repository)) reject('repository_storage_rejected');
      if (existing && missing.length) reject('external_file_missing');
      return absolute;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor); if (parent === cursor) reject('external_file_missing');
      missing.push(path.basename(cursor)); cursor = parent;
    }
  }
}

async function safeEvidenceFile(folder, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 200 || path.isAbsolute(relative)
    || /^[A-Za-z]:/.test(relative) || relative.includes('\0') || /[\\/]/.test(relative[0])) reject('evidence_path_rejected');
  const pieces = relative.split(/[\\/]/);
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..' || piece.includes(':'))) reject('evidence_path_rejected');
  let current = folder;
  if ((await fs.lstat(folder)).isSymbolicLink()) reject('evidence_symlink_rejected');
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (index < pieces.length - 1 && !info.isDirectory())) reject('evidence_symlink_rejected');
  }
  if (!within(await fs.realpath(current), await fs.realpath(folder))) reject('evidence_path_rejected');
  return current;
}

function readVerifiedSync(filename, expected, folder = null) {
  try {
    if (syncFs.lstatSync(path.dirname(filename)).isSymbolicLink()) return false;
    if (folder) {
      const relative = path.relative(folder, filename);
      if (!within(filename, folder)) return false;
      let cursor = folder;
      for (const part of relative.split(path.sep)) { cursor = path.join(cursor, part);
        if (syncFs.lstatSync(cursor).isSymbolicLink()) return false; }
      if (!within(syncFs.realpathSync(filename), syncFs.realpathSync(folder))) return false;
    }
    const info = syncFs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_BYTES) return false;
    const bytes = readSmallFileSync(filename); return bytes !== null && sha(bytes) === expected;
  } catch { return false; }
}

function createPolicy(manifest, filename, manifestHash, evidenceFiles, edgeSecret, now) {
  const url = new URL(manifest.publicOrigin);
  const accounts = new Map(manifest.accounts.map((item) => [item.id.toLowerCase(), item]));
  const effectiveExpiry = Math.min(Date.parse(manifest.expiresAt), ...manifest.evidence.map((item) => Date.parse(item.expiresAt)));
  const live = () => Number.isFinite(now()) && now() < effectiveExpiry;
  const evidenceCurrent = () => live() && readVerifiedSync(filename, manifestHash)
    && evidenceFiles.every((item) => readVerifiedSync(item.filename, item.sha256, path.dirname(filename)));
  const approved = (value) => Boolean(value && typeof value.id === 'string' && accounts.has(value.id.toLowerCase()) && evidenceCurrent());
  const sameSecret = (value) => {
    if (typeof value !== 'string') return false;
    const left = Buffer.from(value); const right = Buffer.from(edgeSecret);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  return Object.freeze({ mode: 'production-pilot', publicOrigin: manifest.publicOrigin, host: url.hostname, secureCookies: true,
    authorizeAccount: approved, authorizeScope: approved,
    checkRequest(request) {
      const address = request?.socket?.remoteAddress;
      const loopback = typeof address === 'string' && (address === '::1' || (isIP(address) === 4 && address.startsWith('127.'))
        || (isIP(address) === 6 && /^::ffff:127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)));
      return Boolean(loopback && live() && request.headers?.host === url.hostname
        && request.headers['x-forwarded-proto'] === 'https' && sameSecret(request.headers['x-breakglass-edge-secret']));
    }
  });
}

/** Checks operator-provided files only. It does not verify legal sufficiency or deploy anything. */
export async function inspectRelease(manifestPath, { edgeSecret, now = Date.now, expectedFingerprint } = {}) {
  const report = { schemaVersion: '1', mode: 'production-pilot', ready: false, publicOrigin: null, expiresAt: null,
    approvedAccounts: 0, runtimeMatches: false, checks: [], actualCloudDeploymentVerified: false,
    limitations: ['只校验运营配置、文件位置、有效期与散列；证据真实性及法律充分性仍须外部验收。', '运行入口仅用于单实例最多50个预先创建账户的试点；不开放注册。'] };
  const block = (name, code) => report.checks.push({ name, status: 'blocked', code });
  const pass = (name) => report.checks.push({ name, status: 'passed' });
  let manifest; let filename; let bytes;
  try {
    if (typeof now !== 'function' || !Number.isFinite(now())) reject('invalid_clock');
    if (!manifestPath) reject('manifest_required');
    filename = await externalLocation(manifestPath, { existing: true });
    const info = await fs.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_BYTES) reject('manifest_file_invalid');
    bytes = await readSmallFile(filename);
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!exact(manifest, ['schemaVersion', 'mode', 'publicOrigin', 'dataDir', 'operator', 'countries', 'audience', 'expiresAt', 'evidence', 'accounts', 'runtimeFingerprint'])
      || manifest.schemaVersion !== '1' || manifest.mode !== 'production-pilot') reject('manifest_schema_invalid');
    pass('manifest');
  } catch (error) { block('manifest', error.code || 'manifest_unreadable'); return { report, policy: null }; }
  if (publicOrigin(manifest.publicOrigin)) { report.publicOrigin = manifest.publicOrigin; pass('publicOrigin'); }
  else block('publicOrigin', 'public_https_origin_required');
  if (typeof manifest.runtimeFingerprint === 'string' && /^[a-f0-9]{64}$/.test(manifest.runtimeFingerprint)
    && typeof expectedFingerprint === 'string' && /^[a-f0-9]{64}$/.test(expectedFingerprint)
    && manifest.runtimeFingerprint === expectedFingerprint) { report.runtimeMatches = true; pass('supplierRuntime'); }
  else block('supplierRuntime', 'supplier_runtime_approval_mismatch');
  try { await externalLocation(manifest.dataDir, { directory: true }); pass('dataDir'); }
  catch (error) { block('dataDir', error.code || 'data_directory_invalid'); }
  if (exact(manifest.operator, ['name', 'contact']) && privateText(manifest.operator.name, 120)
    && typeof manifest.operator.contact === 'string' && /^[^\s@]{1,64}@[^\s@]{1,180}\.[A-Za-z]{2,24}$/.test(manifest.operator.contact)) pass('operator');
  else block('operator', 'operator_contact_required');
  const scopeValid = uniqueList(manifest.countries, 20, country)
    && uniqueList(manifest.audience, 2, (audience) => AUDIENCES.includes(audience));
  if (scopeValid) pass('regionAudience'); else block('regionAudience', 'region_audience_invalid');
  if (iso(manifest.expiresAt) && Date.parse(manifest.expiresAt) > now()) { report.expiresAt = manifest.expiresAt; pass('expiry'); }
  else block('expiry', 'release_expired_or_missing');
  if (typeof edgeSecret === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(edgeSecret) && new Set(edgeSecret).size >= 12) pass('edgeSecret');
  else block('edgeSecret', 'strong_edge_secret_required');

  const evidenceFiles = []; const evidenceIds = new Set(); let evidenceValid = Array.isArray(manifest.evidence) && manifest.evidence.length > 0 && manifest.evidence.length <= 64;
  if (evidenceValid) for (const item of manifest.evidence) {
    try {
      if (!exact(item, ['id', 'kind', 'file', 'sha256', 'countries', 'audience', 'expiresAt']) || !id(item.id) || evidenceIds.has(item.id)
        || !KINDS.includes(item.kind) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
        || !uniqueList(item.countries, 20, country)
        || !uniqueList(item.audience, 2, (audience) => AUDIENCES.includes(audience))
        || !iso(item.expiresAt) || Date.parse(item.expiresAt) <= now()) reject('evidence_schema_or_expiry_invalid');
      const evidencePath = await safeEvidenceFile(path.dirname(filename), item.file);
      const info = await fs.lstat(evidencePath);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) reject('evidence_file_invalid');
      const evidence = await readSmallFile(evidencePath);
      if (sha(evidence) !== item.sha256) reject('evidence_hash_mismatch');
      evidenceIds.add(item.id); evidenceFiles.push({ filename: evidencePath, sha256: item.sha256 });
    } catch (error) { evidenceValid = false; block('evidence', error.code || 'evidence_unreadable'); }
  }
  if (!evidenceValid) {
    if (!report.checks.some((check) => check.name === 'evidence')) block('evidence', 'approval_evidence_required');
  } else {
    const covers = (kind, country, audience) => manifest.evidence.some((item) => item.kind === kind && item.countries.includes(country) && item.audience.includes(audience));
    if (scopeValid && manifest.countries.every((country) => manifest.audience.every((audience) => [...REQUIRED, ...(audience === 'minors' ? ['minor-guardian'] : [])]
      .every((kind) => covers(kind, country, audience))))) pass('evidence');
    else { evidenceValid = false; block('evidence', 'approval_scope_incomplete'); }
  }
  let accountsValid = scopeValid && evidenceValid && Array.isArray(manifest.accounts) && manifest.accounts.length > 0 && manifest.accounts.length <= 50;
  const accountIds = new Set();
  if (accountsValid) for (const account of manifest.accounts) {
    const audience = account?.ageBand === 'adult' ? 'adults' : account?.ageBand === 'minor' ? 'minors' : null;
    const guardian = manifest.evidence?.find?.((item) => item.id === account?.guardianEvidenceId);
    if (!exact(account, ['id', 'country', 'ageBand', 'guardianEvidenceId']) || !UUID.test(account.id || '')
      || accountIds.has(account.id.toLowerCase()) || !manifest.countries.includes(account.country) || !manifest.audience.includes(audience)
      || (audience === 'adults' ? account.guardianEvidenceId !== null : !guardian || guardian.kind !== 'minor-guardian'
        || !guardian.countries.includes(account.country) || !guardian.audience.includes('minors'))) { accountsValid = false; break; }
    accountIds.add(account.id.toLowerCase());
  }
  if (accountsValid && evidenceValid) { report.approvedAccounts = manifest.accounts.length; pass('accountApprovals'); }
  else block('accountApprovals', 'approved_account_scope_required');
  report.ready = report.checks.every((check) => check.status === 'passed');
  if (report.ready) report.expiresAt = new Date(Math.min(Date.parse(manifest.expiresAt), ...manifest.evidence.map((item) => Date.parse(item.expiresAt)))).toISOString();
  return { report, policy: report.ready ? createPolicy(manifest, filename, sha(bytes), evidenceFiles, edgeSecret, now) : null,
    ...(report.ready ? { dataDir: path.resolve(manifest.dataDir) } : {}) };
}

export function releaseArguments(args, env = {}) {
  if (args.length === 0) return env.BREAKGLASS_RELEASE_MANIFEST || '';
  if (args.length === 2 && args[0] === '--manifest' && args[1]) return args[1];
  throw new Error('仅支持 --manifest <仓库外绝对路径>。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifestPath = releaseArguments(process.argv.slice(2), process.env); let expectedFingerprint;
    try { expectedFingerprint = supplierRuntimeFingerprint(loadSettings(process.env), loadAudioSettings(process.env)); }
    catch { reject('supplier_runtime_config_invalid'); }
    const { report } = await inspectRelease(manifestPath, { edgeSecret: process.env.BREAKGLASS_EDGE_SECRET, expectedFingerprint });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exitCode = report.ready ? 0 : 2;
  } catch (error) { process.stdout.write(JSON.stringify({ ready: false,
    code: error.code === 'supplier_runtime_config_invalid' ? error.code : 'invalid_release_arguments', actualCloudDeploymentVerified: false }) + '\n'); process.exitCode = 2; }
}
