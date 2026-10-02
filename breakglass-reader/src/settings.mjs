import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 页面的截止是 300 秒。服务要在这之前回完，留出传输的余量。
 */
const PAGE_DEADLINE_MS = 300000;

/**
 * 默认放行的页面来源：任意已加载的扩展页，以及本机调试页面。
 */
const DEFAULT_ORIGINS = [
  /^chrome-extension:\/\/[a-p]{32}$/,
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
];

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function intInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 从环境变量读配置。密钥只在这里进入进程，不写进任何文件或响应。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ host: string, port: number, baseUrl: string, apiKey: string, model: string,
 *   jsonMode: boolean, timeoutMs: number, budgetMs: number, concurrency: number,
 *   allowOrigin: (origin: string) => boolean, extensionDir: string }}
 */
export function loadSettings(env) {
  const listed = (env.READER_ALLOW_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    host: env.READER_HOST || '127.0.0.1',
    port: intInRange(env.READER_PORT, 8787, 1, 65535),
    baseUrl: (env.READER_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (env.READER_API_KEY || '').trim(),
    model: (env.READER_MODEL || '').trim(),
    jsonMode: env.READER_JSON_MODE === '1',
    timeoutMs: intInRange(env.READER_MODEL_TIMEOUT_MS, 60000, 1000, PAGE_DEADLINE_MS),
    budgetMs: intInRange(env.READER_BUDGET_MS, 240000, 1000, PAGE_DEADLINE_MS - 20000),
    concurrency: intInRange(env.READER_CONCURRENCY, 2, 1, 8),
    allowOrigin: listed.length > 0
      ? (origin) => listed.includes(origin)
      : (origin) => DEFAULT_ORIGINS.some((pattern) => pattern.test(origin)),
    extensionDir: path.resolve(SERVICE_DIR, env.BREAKGLASS_EXTENSION_DIR || '../extension')
  };
}
