import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rules = require('../learning-site/analysis-cache.js');
const contracts = require('../extension/src/plugin/contracts.js');
const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const inside = (folder, parent) => { const relative = path.relative(parent, folder);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === fields.sort().join(',');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope) => `${scope.kind}:${scope.id}:${scope.epoch}`;

export function contextCacheIdentity(input, providerVersion) {
  return { sourceKind: 'local-file', sourceId: input.sourceId, videoVersion: input.videoVersion,
    analysisVersion: input.analysisVersion, providerVersion, contextSourceId: input.contextSourceId,
    samplingVersion: 'separate-decoder-jpeg640-q75-v1',
    frames: input.frames.map((frame) => ({ frameTime: frame.frameTime, sha256: sha(frame.image) })) };
}
const identityKey = (identity) => sha(JSON.stringify(identity));
function validScope(scope) {
  return exact(scope, ['kind', 'id', 'epoch']) && ['guest', 'account'].includes(scope.kind)
    && typeof scope.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(scope.id)
    && Number.isSafeInteger(scope.epoch) && scope.epoch >= 0;
}
function validIdentity(identity) {
  return exact(identity, ['sourceKind', 'sourceId', 'videoVersion', 'analysisVersion', 'providerVersion', 'contextSourceId', 'samplingVersion', 'frames'])
    && identity.sourceKind === 'local-file' && /^file-[a-f0-9]{64}$/.test(identity.sourceId)
    && ['videoVersion', 'analysisVersion'].every((key) => typeof identity[key] === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(identity[key]))
    && /^provider-[a-f0-9]{64}$/.test(identity.providerVersion)
    && (identity.contextSourceId === null || /^subtitle-[a-f0-9]{64}$/.test(identity.contextSourceId))
    && identity.samplingVersion === 'separate-decoder-jpeg640-q75-v1'
    && Array.isArray(identity.frames) && identity.frames.length >= 1 && identity.frames.length <= rules.LIMITS.frames
    && identity.frames.every((frame, index, frames) => exact(frame, ['frameTime', 'sha256'])
      && Number.isFinite(frame.frameTime) && frame.frameTime >= 0 && frame.frameTime <= 600
      && (index === 0 || frame.frameTime > frames[index - 1].frameTime) && /^[a-f0-9]{64}$/.test(frame.sha256))
    && identity.frames.at(-1).frameTime - identity.frames[0].frameTime <= 30;
}
function validEntry(entry) {
  if (!exact(entry, ['scope', 'identity', 'createdAt', 'value']) || !validScope(entry.scope) || !validIdentity(entry.identity)
    || !Number.isSafeInteger(entry.createdAt) || entry.createdAt <= 0 || !exact(entry.value, [...rules.VALUE_FIELDS])) return false;
  const input = { requestId: entry.value.requestId, sourceId: entry.identity.sourceId, videoVersion: entry.identity.videoVersion,
    analysisVersion: entry.identity.analysisVersion, contextSourceId: entry.identity.contextSourceId,
    frames: entry.identity.frames };
  return rules.validContext(entry.value, input, contracts.validateVisualResult);
}

/** Private, bounded, single-process cache. Guest entries remain memory-only; no session keys or media persist. */
export function createAnalysisCache({ dataDir, now = Date.now } = {}) {
  if (dataDir !== undefined && (typeof dataDir !== 'string' || !path.isAbsolute(dataDir))) throw new TypeError('缓存目录须为仓库外绝对路径。');
  const folder = path.resolve(dataDir || path.join(os.tmpdir(), 'breakglass-learning-development'));
  if (inside(folder, REPOSITORY)) throw new TypeError('分析缓存不得保存在仓库内。');
  const filename = path.join(folder, 'analysis-cache-v1.json');
  let entries = []; let initialized; let queue = Promise.resolve(); const generations = new Map();
  const initialize = () => initialized ||= (async () => {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    if (inside(await fs.realpath(folder), await fs.realpath(REPOSITORY))) throw new Error('analysis_cache_unavailable');
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.size > rules.LIMITS.bytes) throw new Error('analysis_cache_unavailable');
      const parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (!exact(parsed, ['schemaVersion', 'entries']) || parsed.schemaVersion !== '1' || !Array.isArray(parsed.entries)
        || parsed.entries.length > rules.LIMITS.entries || !parsed.entries.every((entry) => validEntry(entry) && entry.scope.kind === 'account')) {
        throw new Error('analysis_cache_unavailable');
      }
      entries = parsed.entries;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('analysis_cache_unavailable'); }
  })();
  const serial = (work) => { const job = queue.then(async () => { await initialize(); return work(); }); queue = job.catch(() => {}); return job; };
  function prune() {
    entries = entries.filter((entry) => entry.createdAt <= now() && now() - entry.createdAt < rules.LIMITS.ttlMs);
    while (entries.length > rules.LIMITS.entries || Buffer.byteLength(JSON.stringify({ schemaVersion: '1', entries })) > rules.LIMITS.bytes) entries.shift();
  }
  async function persist(next, guard = () => true) {
    const payload = JSON.stringify({ schemaVersion: '1', entries: next.filter((entry) => entry.scope.kind === 'account') });
    const temporary = path.join(folder, `.analysis-cache-${randomUUID()}.tmp`); let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(payload); await handle.sync(); await handle.close(); handle = null;
      if (!guard()) throw Object.assign(new Error('stale_analysis'), { status: 409 });
      await fs.rename(temporary, filename);
    } finally { await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
  }
  const get = (scope, identity) => serial(async () => {
    if (!validScope(scope) || !validIdentity(identity)) throw new Error('invalid_cache_identity');
    const before = entries.length; prune();
    entries = entries.filter((entry) => entry.scope.kind !== scope.kind || entry.scope.id !== scope.id || entry.scope.epoch === scope.epoch);
    if (entries.length !== before) await persist(entries);
    const found = entries.find((entry) => scopeKey(entry.scope) === scopeKey(scope) && identityKey(entry.identity) === identityKey(identity));
    return found ? structuredClone(found) : null;
  });
  const put = (scope, identity, value, isCurrent = () => true) => {
    const owner = `${scope.kind}:${scope.id}`; const generation = generations.get(owner) || 0;
    return serial(async () => {
      const entry = { scope: { kind: scope.kind, id: scope.id, epoch: scope.epoch }, identity, createdAt: now(), value: rules.candidateValue(value) };
      if (!validEntry(entry)) throw new Error('invalid_cached_candidate');
      const live = () => generation === (generations.get(owner) || 0) && isCurrent();
      if (!live()) return false;
      prune(); const prior = entries;
      entries = entries.filter((item) => !(scopeKey(item.scope) === scopeKey(scope) && identityKey(item.identity) === identityKey(identity)));
      entries.push(entry); prune(); const next = entries; entries = prior;
      if (scope.kind === 'account') await persist(next, live);
      if (!live()) {
        // A capability can expire during the asynchronous rename itself. This queue
        // still owns the transaction, so restore the last committed account data
        // before rejecting it; a restart must not observe the rejected candidate.
        if (scope.kind === 'account') await persist(prior);
        return false;
      }
      entries = next; return true;
    });
  };
  const clear = (scope) => {
    const owner = `${scope.kind}:${scope.id}`; generations.set(owner, (generations.get(owner) || 0) + 1);
    return serial(async () => { entries = entries.filter((entry) => entry.scope.kind !== scope.kind || entry.scope.id !== scope.id); await persist(entries); });
  };
  const revokeSource = (sourceId) => serial(async () => { entries = entries.filter((entry) => entry.identity.sourceId !== sourceId); await persist(entries); });
  return { get, put, clear, revokeSource, filename };
}
