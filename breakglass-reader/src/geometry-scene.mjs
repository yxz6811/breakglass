import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decodeJpegDataUrl, jpegSize, sameAspect } from './jpeg.mjs';
import { askGeometryModel, readMessages } from './geometry-model.mjs';

const require = createRequire(import.meta.url);
const DEFAULT_EXTENSION = fileURLToPath(new URL('../../extension/', import.meta.url));
const READ_FIELDS = ['schemaVersion', 'requestId', 'videoId', 'frameTime', 'frameSize', 'image'];
const CANDIDATE_FIELDS = ['supported', 'rightAngleAt', 'labels', 'vertices', 'lengths', 'unit'];

export function exactFields(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export function validIdentity(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function sizeValid(size) {
  return exactFields(size, ['width', 'height']) && Number.isSafeInteger(size.width)
    && Number.isSafeInteger(size.height) && size.width > 0 && size.height > 0;
}

export function geometryRules(settings) {
  const folder = settings.extensionDir || DEFAULT_EXTENSION;
  const { validateScene } = require(path.join(folder, 'src/geometry-scene/validate.js'));
  const { validateActions } = require(path.join(folder, 'src/geometry-scene/actions.js'));
  return { validateScene, validateActions };
}

export function geometryError(status, code) {
  const messages = {
    invalid_request: '几何请求的字段或类型无效。',
    invalid_scene: '当前场景尚未确认或未通过校验。',
    invalid_image: '截图不是可读取的JPEG或画幅与源视频不一致。',
    unconfigured: '几何服务没有配置模型。',
    model_failed: '模型没有返回可用的结构化结果。',
    invalid_actions: '模型操作不符合当前单边实验范围。',
    timeout: '本次几何请求已超时，可以重试。'
  };
  return { status, payload: { code, error: messages[code] || '几何请求失败。' } };
}

export function configured(settings) {
  return Boolean(settings.baseUrl && settings.apiKey && settings.model);
}

/** 独立预算从处理此请求开始，不修改旧/read计时。 */
export async function withGeometryBudget({ signal, budgetMs }, run) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Geometry timeout', 'TimeoutError')), budgetMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    combined.throwIfAborted();
    return await run(combined);
  } catch {
    signal?.throwIfAborted();
    return geometryError(deadline.signal.aborted ? 504 : 502, deadline.signal.aborted ? 'timeout' : 'model_failed');
  } finally {
    clearTimeout(timer);
  }
}

export function checkGeometryRead(body) {
  if (!exactFields(body, READ_FIELDS) || body.schemaVersion !== '1.0.0'
    || !validIdentity(body.requestId) || !validIdentity(body.videoId)
    || typeof body.frameTime !== 'number' || !Number.isFinite(body.frameTime) || body.frameTime < 0
    || !sizeValid(body.frameSize)) return { ok: false, code: 'invalid_request' };
  const bytes = decodeJpegDataUrl(body.image);
  const image = bytes && jpegSize(bytes);
  if (!bytes || body.image !== `data:image/jpeg;base64,${bytes.toString('base64')}`
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9
    || !image || image.width > 640 || !sameAspect(image, body.frameSize)) {
    return { ok: false, code: 'invalid_image' };
  }
  return { ok: true, request: body, image };
}

/** 模型只报告JPEG坐标与题面明确数值，身份/来源由服务填写。 */
export function candidateScene(answer, request, image, rules) {
  if (exactFields(answer, ['supported']) && answer.supported === false) {
    return { status: 'unsupported', scene: null, code: 'unsupported_frame' };
  }
  if (exactFields(answer, ['supported', 'needsReview']) && answer.supported === true && answer.needsReview === true) {
    return { status: 'needs_review', scene: null, code: 'unclear_conditions' };
  }
  if (!exactFields(answer, CANDIDATE_FIELDS) || answer.supported !== true
    || !exactFields(answer.vertices, ['A', 'B', 'C'])) return null;
  const vertices = {};
  for (const name of ['A', 'B', 'C']) {
    const point = answer.vertices[name];
    if (!exactFields(point, ['x', 'y']) || typeof point.x !== 'number' || typeof point.y !== 'number'
      || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) return null;
    vertices[name] = {
      x: point.x * (request.frameSize.width / image.width),
      y: point.y * (request.frameSize.height / image.height)
    };
  }
  const checked = rules.validateScene({
    schemaVersion: '1.0.0', kind: 'right-triangle',
    requestId: request.requestId, videoId: request.videoId, frameTime: request.frameTime,
    frameSize: { ...request.frameSize }, sceneRevision: 0,
    rightAngleAt: answer.rightAngleAt, labels: answer.labels, vertices,
    lengths: answer.lengths, unit: answer.unit,
    source: 'vision', originSource: 'vision', editedByUser: false
  }, request);
  return checked.ok ? { status: 'candidate', scene: checked.scene } : null;
}

export async function readGeometry(body, { settings, fetchImpl = fetch, signal, log = () => {} }) {
  signal?.throwIfAborted();
  const checked = checkGeometryRead(body);
  if (!checked.ok) return geometryError(400, checked.code);
  if (!configured(settings)) return geometryError(503, 'unconfigured');
  const { request, image } = checked;
  const started = Date.now();
  const result = await withGeometryBudget({ signal, budgetMs: settings.geometryReadBudgetMs ?? 30000 }, async (workSignal) => {
    const answer = await askGeometryModel({ settings, messages: readMessages(request, image), signal: workSignal, fetchImpl });
    workSignal.throwIfAborted();
    const candidate = candidateScene(answer, request, image, geometryRules(settings));
    if (!candidate) return geometryError(502, 'model_failed');
    return { status: 200, payload: {
      schemaVersion: '1.0.0', requestId: request.requestId, videoId: request.videoId,
      frameTime: request.frameTime, ...candidate
    } };
  });
  signal?.throwIfAborted();
  log({ event: 'geometry_read', status: result.status, code: result.payload.code || result.payload.status, ms: Date.now() - started });
  return result;
}
