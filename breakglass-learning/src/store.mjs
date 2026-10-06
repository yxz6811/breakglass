import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function inside(folder, parent) {
  const relative = path.relative(parent, folder);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Single-process local development persistence; no media or session tokens. */
export function createAccountStore({ dataDir, validate }) {
  if (dataDir !== undefined && (typeof dataDir !== 'string' || !path.isAbsolute(dataDir))) {
    throw new TypeError('账户数据目录必须是仓库外的绝对路径。');
  }
  const folder = path.resolve(dataDir || path.join(os.tmpdir(), 'breakglass-learning-development'));
  if (inside(folder, REPOSITORY)) throw new TypeError('账户数据不得保存在仓库目录内。');
  const filename = path.join(folder, 'accounts-v1.json');
  let state;
  let queue = Promise.resolve();
  let initialized;
  const initialize = () => initialized ||= (async () => {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const [actual, repository] = await Promise.all([fs.realpath(folder), fs.realpath(REPOSITORY)]);
    if (inside(actual, repository)) throw new TypeError('账户数据目录不能指向仓库。');
    try {
      const info = await fs.lstat(filename);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) throw new Error('invalid_store');
      const parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (!validate(parsed)) throw new Error('invalid_store');
      state = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('local_storage_unavailable');
      state = { schemaVersion: 1, users: [] };
    }
  })();
  const serial = (operation) => {
    const job = queue.then(async () => { await initialize(); return operation(); });
    queue = job.catch(() => {});
    return job;
  };
  const read = () => serial(() => structuredClone(state));
  const transact = (operation, { beforeCommit } = {}) => serial(async () => {
    const next = structuredClone(state);
    const result = await operation(next);
    if (!validate(next)) throw new Error('invalid_store');
    const json = JSON.stringify(next);
    if (Buffer.byteLength(json) > MAX_STATE_BYTES) throw Object.assign(new Error('storage_full'), { status: 413, code: 'storage_full' });
    const temporary = path.join(folder, `.accounts-${randomUUID()}.tmp`);
    let file;
    try {
      file = await fs.open(temporary, 'wx', 0o600);
      await file.writeFile(json, 'utf8');
      await file.sync();
      await file.close(); file = null;
      // Request capabilities can be revoked during asynchronous file I/O. The
      // temporary snapshot remains private and must not replace state afterwards.
      beforeCommit?.();
      await fs.rename(temporary, filename);
      state = next;
      return structuredClone(result);
    } finally {
      await file?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  });
  return { read, transact };
}
