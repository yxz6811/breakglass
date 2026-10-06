import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 智谱文档里标成免费、且能看图片的模型。1305 是单个模型拥塞，同一密钥可以换着问。
 * 付费型号不放进默认池。
 */
const ZHIPU_FREE_VISION = ['glm-4.6v-flash', 'glm-4v-flash', 'glm-4.1v-thinking-flash'];

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
 * @param {string} baseUrl
 * @returns {boolean}
 */
function zhipuEndpoint(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'open.bigmodel.cn' || host === 'api.z.ai';
  } catch {
    return false;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} model
 * @param {boolean} jsonMode
 * @returns {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }}
 */
function endpoint(baseUrl, apiKey, model, jsonMode) {
  return { baseUrl, apiKey, model, jsonMode };
}

/**
 * 默认池：智谱地址上，把已配置的模型和另外两款免费视觉模型排在一起。
 * READER_MODEL_POOL 用逗号写出型号时，改用这份名单，仍共用 READER_API_KEY。
 * READER_EXTRA_MODELS 的每一项是「型号|基址|密钥环境变量名」，密钥为空就跳过。
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} model
 * @param {boolean} jsonMode
 * @returns {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }[]}
 */
function loadModels(env, baseUrl, apiKey, model, jsonMode) {
  const listed = (env.READER_MODEL_POOL || '').split(',').map((item) => item.trim()).filter(Boolean);
  const names = listed.length > 0
    ? listed
    : (zhipuEndpoint(baseUrl) && model
      ? [model, ...ZHIPU_FREE_VISION.filter((id) => id !== model)]
      : (model ? [model] : []));
  const models = [];
  if (baseUrl && apiKey) {
    for (const name of names) {
      if (!models.some((item) => item.baseUrl === baseUrl && item.model === name)) {
        models.push(endpoint(baseUrl, apiKey, name, jsonMode && name === model));
      }
    }
  }
  for (const raw of (env.READER_EXTRA_MODELS || '').split(',')) {
    const [name, extraBase, keyName] = raw.split('|').map((part) => (part || '').trim());
    const extraKey = keyName ? String(env[keyName] || '').trim() : '';
    if (!name || !extraBase || !extraKey) continue;
    const normalized = extraBase.replace(/\/+$/, '');
    if (models.some((item) => item.baseUrl === normalized && item.model === name)) continue;
    models.push(endpoint(normalized, extraKey, name, false));
  }
  return models;
}

// 几何预算不接受部分数字（如“10s”），不复用旧/read的宽松配置规则。
function geometryBudget(value, fallback) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1000 && parsed <= 120000 ? parsed : fallback;
}

/**
 * 从环境变量读配置。密钥只在这里进入进程，不写进任何文件或响应。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ host: string, port: number, baseUrl: string, apiKey: string, model: string,
 *   jsonMode: boolean, models: { baseUrl: string, apiKey: string, model: string, jsonMode: boolean }[],
 *   modelCursor: { next: number },
 *   timeoutMs: number, budgetMs: number, concurrency: number,
 *   geometryReadBudgetMs: number, geometryAskBudgetMs: number,
 *   allowOrigin: (origin: string) => boolean, extensionDir: string }}
 */
export function loadSettings(env) {
  const listed = (env.READER_ALLOW_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const baseUrl = (env.READER_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.READER_API_KEY || '').trim();
  const model = (env.READER_MODEL || '').trim();
  const jsonMode = env.READER_JSON_MODE === '1';
  return {
    host: env.READER_HOST || '127.0.0.1',
    port: intInRange(env.READER_PORT, 8787, 1, 65535),
    baseUrl,
    apiKey,
    model,
    jsonMode,
    models: loadModels(env, baseUrl, apiKey, model, jsonMode),
    modelCursor: { next: 0 },
    timeoutMs: intInRange(env.READER_MODEL_TIMEOUT_MS, 60000, 1000, PAGE_DEADLINE_MS),
    budgetMs: intInRange(env.READER_BUDGET_MS, 240000, 1000, PAGE_DEADLINE_MS - 20000),
    concurrency: intInRange(env.READER_CONCURRENCY, 2, 1, 8),
    geometryReadBudgetMs: geometryBudget(env.READER_GEOMETRY_READ_BUDGET_MS, 30000),
    geometryAskBudgetMs: geometryBudget(env.READER_GEOMETRY_ASK_BUDGET_MS, 10000),
    allowOrigin: listed.length > 0
      ? (origin) => listed.includes(origin)
      : (origin) => DEFAULT_ORIGINS.some((pattern) => pattern.test(origin)),
    extensionDir: path.resolve(SERVICE_DIR, env.BREAKGLASS_EXTENSION_DIR || '../extension')
  };
}
