import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decodeJpegDataUrl, jpegSize, sameAspect } from './jpeg.mjs';
import { exactFields, validIdentity } from './geometry-scene.mjs';
import { askLessonModel } from './geometry-lesson-model.mjs';

const require = createRequire(import.meta.url);
const DEFAULT_EXTENSION = fileURLToPath(new URL('../../extension/', import.meta.url));
const TOP_FIELDS = ['schemaVersion', 'readingId', 'videoId', 'duration', 'frameSize', 'frames'];
const UNITS = new Set(['unit', 'cm', 'm']);

/**
 * @param {object} settings
 * @returns {{ pointProblem: Function }}
 */
function readingRules(settings) {
  const folder = settings.extensionDir || DEFAULT_EXTENSION;
  return require(path.join(folder, 'src/geometry-lesson/reading.js'));
}

/**
 * @param {number} status
 * @param {string} error
 * @returns {{ status: number, payload: { error: string } }}
 */
function fail(status, error) {
  return { status, payload: { error } };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function label(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 16 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, request: object } | { ok: false, error: string }}
 */
export function checkLessonRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '几何阅读的字段无效。' };
  const keys = Object.keys(body);
  const allowed = new Set(TOP_FIELDS.concat(keys.includes('courseText') ? ['courseText'] : []));
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) return { ok: false, error: '几何阅读含有不允许的字段。' };
  if (body.schemaVersion !== '1.0.0' || !validIdentity(body.readingId) || !validIdentity(body.videoId)) {
    return { ok: false, error: '几何阅读的身份无效。' };
  }
  if (body.videoId === 'fixture-parabola') return { ok: false, error: '演示夹具不进入几何阅读。' };
  if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration <= 0) {
    return { ok: false, error: '片子时长无效。' };
  }
  if (!exactFields(body.frameSize, ['width', 'height']) || !Number.isSafeInteger(body.frameSize.width) || !Number.isSafeInteger(body.frameSize.height)
    || body.frameSize.width <= 0 || body.frameSize.height <= 0) {
    return { ok: false, error: '画面尺寸无效。' };
  }
  if ('courseText' in body && typeof body.courseText !== 'string') return { ok: false, error: '课程说明无效。' };
  if (typeof body.courseText === 'string' && Array.from(body.courseText).length > 8000) {
    return { ok: false, error: '课程说明超过 8000 字。' };
  }
  if (!Array.isArray(body.frames) || body.frames.length < 1 || body.frames.length > 8) {
    return { ok: false, error: '需要 1 到 8 张画面。' };
  }
  let previous = -1;
  for (const frame of body.frames) {
    if (!exactFields(frame, ['time', 'image']) || typeof frame.time !== 'number' || !Number.isFinite(frame.time)
      || frame.time < 0 || frame.time > body.duration || frame.time - previous < 1) {
      return { ok: false, error: '采样时刻无效。' };
    }
    previous = frame.time;
  }
  return { ok: true, request: body };
}

/**
 * @param {{ x: number, y: number }} point
 * @param {{ width: number, height: number }} image
 * @param {{ width: number, height: number }} frame
 * @returns {{ x: number, y: number } | null}
 */
function mapPixel(point, image, frame) {
  if (!exactFields(point, ['x', 'y']) || !positive(point.x + 1) || !positive(point.y + 1)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) {
    return null;
  }
  return { x: point.x * (frame.width / image.width), y: point.y * (frame.height / image.height) };
}

/**
 * @param {object} answer
 * @param {object} request
 * @param {{ time: number }} frame
 * @param {{ width: number, height: number }} image
 * @param {string} id
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
export function buildLessonPoint(answer, request, frame, image, id) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { ok: false, reason: 'model_unreadable' };
  if (answer.supported === false) {
    return { ok: false, reason: answer.reason === 'ambiguous' && exactFields(answer, ['supported', 'reason']) ? 'ambiguous' : 'unsupported' };
  }
  const shared = {
    schemaVersion: '1.0.0',
    id,
    readingId: request.readingId,
    videoId: request.videoId,
    time: frame.time,
    frameSize: { width: request.frameSize.width, height: request.frameSize.height }
  };
  if (answer.kind === 'right-triangle') return buildTriangle(answer, shared, image, request.frameSize);
  if (answer.kind === 'circle') return buildCircle(answer, shared, image, request.frameSize);
  if (answer.kind === 'segment') return buildSegment(answer, shared, image, request.frameSize);
  return { ok: false, reason: 'unsupported' };
}

/**
 * @param {object} answer
 * @param {object} shared
 * @param {{ width: number, height: number }} image
 * @param {{ width: number, height: number }} frame
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
function buildTriangle(answer, shared, image, frame) {
  const fields = ['supported', 'kind', 'rightAngleAt', 'unit', 'legs', 'vertices'];
  if (!exactFields(answer, fields) || answer.supported !== true || !label(answer.rightAngleAt) || !UNITS.has(answer.unit)) {
    return { ok: false, reason: 'incomplete' };
  }
  if (!Array.isArray(answer.legs) || answer.legs.length !== 2) return { ok: false, reason: 'incomplete' };
  const legs = [];
  for (const leg of answer.legs) {
    if (!exactFields(leg, ['id', 'from', 'to', 'length']) || !label(leg.id) || !label(leg.from) || !label(leg.to) || !positive(leg.length)) {
      return { ok: false, reason: 'not_finite' };
    }
    legs.push({ id: leg.id, from: leg.from, to: leg.to, length: leg.length });
  }
  const right = answer.rightAngleAt;
  const far = legs.map((leg) => (leg.from === right ? leg.to : leg.from));
  if (far.some((name, index) => legs[index].from !== right && legs[index].to !== right) || new Set([right, far[0], far[1]]).size !== 3) {
    return { ok: false, reason: 'incomplete' };
  }
  if (!exactFields(answer.vertices, [right, far[0], far[1]])) return { ok: false, reason: 'incomplete' };
  const vertices = {};
  for (const name of [right, far[0], far[1]]) {
    const mapped = mapPixel(answer.vertices[name], image, frame);
    if (!mapped) return { ok: false, reason: 'frame_size' };
    vertices[name] = mapped;
  }
  const line = `直角边 ${legs[0].length} 和 ${legs[1].length}${answer.unit === 'unit' ? '' : answer.unit}。`;
  return {
    ok: true,
    point: {
      ...shared,
      lessonLine: line,
      kind: 'right-triangle',
      unit: answer.unit,
      placement: { vertices },
      given: { rightAngleAt: right, legs },
      derived: {
        hypotenuse: { id: far[0] + far[1], from: far[0], to: far[1], length: Math.hypot(legs[0].length, legs[1].length) }
      }
    }
  };
}

/**
 * @param {object} answer
 * @param {object} shared
 * @param {{ width: number, height: number }} image
 * @param {{ width: number, height: number }} frame
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
function buildCircle(answer, shared, image, frame) {
  if (!exactFields(answer, ['supported', 'kind', 'unit', 'center', 'radius']) || answer.supported !== true || !UNITS.has(answer.unit) || !positive(answer.radius)) {
    return { ok: false, reason: 'incomplete' };
  }
  if (!exactFields(answer.center, ['label', 'x', 'y']) || !label(answer.center.label)) return { ok: false, reason: 'incomplete' };
  const mapped = mapPixel({ x: answer.center.x, y: answer.center.y }, image, frame);
  if (!mapped) return { ok: false, reason: 'frame_size' };
  const center = { label: answer.center.label, ...mapped };
  return {
    ok: true,
    point: {
      ...shared,
      lessonLine: `半径 ${answer.radius}${answer.unit === 'unit' ? '' : answer.unit}。`,
      kind: 'circle',
      unit: answer.unit,
      placement: { center: { x: center.x, y: center.y } },
      given: { center, radius: answer.radius },
      derived: {}
    }
  };
}

/**
 * @param {object} answer
 * @param {object} shared
 * @param {{ width: number, height: number }} image
 * @param {{ width: number, height: number }} frame
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
function buildSegment(answer, shared, image, frame) {
  if (!exactFields(answer, ['supported', 'kind', 'unit', 'start', 'end', 'length']) || answer.supported !== true || !UNITS.has(answer.unit) || !positive(answer.length)) {
    return { ok: false, reason: 'incomplete' };
  }
  if (!exactFields(answer.start, ['label', 'x', 'y']) || !exactFields(answer.end, ['label', 'x', 'y'])) return { ok: false, reason: 'incomplete' };
  if (!label(answer.start.label) || !label(answer.end.label)) return { ok: false, reason: 'incomplete' };
  const startPixel = mapPixel({ x: answer.start.x, y: answer.start.y }, image, frame);
  const endPixel = mapPixel({ x: answer.end.x, y: answer.end.y }, image, frame);
  if (!startPixel || !endPixel) return { ok: false, reason: 'frame_size' };
  const start = { label: answer.start.label, ...startPixel };
  const end = { label: answer.end.label, ...endPixel };
  return {
    ok: true,
    point: {
      ...shared,
      lessonLine: `线段长度 ${answer.length}${answer.unit === 'unit' ? '' : answer.unit}。`,
      kind: 'segment',
      unit: answer.unit,
      placement: { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } },
      given: { start, end, length: answer.length },
      derived: {}
    }
  };
}

/**
 * @param {object} frame
 * @param {{ width: number, height: number }} frameSize
 * @returns {{ ok: true, image: { width: number, height: number } } | { ok: false, reason: string }}
 */
function inspectFrame(frame, frameSize) {
  const bytes = decodeJpegDataUrl(frame.image);
  const image = bytes && jpegSize(bytes);
  if (!bytes || !image || image.width > 640 || !sameAspect(image, frameSize)) return { ok: false, reason: 'image_invalid' };
  return { ok: true, image };
}

/**
 * @param {unknown} body
 * @param {object} options
 * @returns {Promise<{ status: number, payload: object }>}
 */
export async function readGeometryLesson(body, options) {
  const { settings, fetchImpl = fetch, log = () => {}, signal } = options;
  signal?.throwIfAborted();
  const started = Date.now();
  const checked = checkLessonRequest(body);
  if (!checked.ok) {
    log({ event: 'geometry_lesson_rejected' });
    return fail(400, checked.error);
  }
  const request = checked.request;
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    log({ event: 'geometry_lesson_unconfigured', readingId: request.readingId });
    return fail(503, '阅读服务没有配置模型。');
  }
  const rules = readingRules(settings);
  const budget = AbortSignal.timeout(settings.budgetMs);
  const work = signal ? AbortSignal.any([signal, budget]) : budget;
  const points = [];
  const dropped = [];
  let transport = 0;
  try {
    for (let index = 0; index < request.frames.length; index += 1) {
      work.throwIfAborted();
      const frame = request.frames[index];
      const image = inspectFrame(frame, request.frameSize);
      if (!image.ok) {
        dropped.push({ time: frame.time, reason: image.reason });
        continue;
      }
      const asked = await askLessonModel({
        settings, dataUrl: frame.image, image: image.image, time: frame.time, signal: work, fetchImpl
      });
      if (!asked.ok) {
        if (asked.transport) transport += 1;
        dropped.push({ time: frame.time, reason: 'model_unreadable' });
        continue;
      }
      const built = buildLessonPoint(asked.answer, request, frame, image.image, `g${index + 1}`);
      if (!built.ok) {
        dropped.push({ time: frame.time, reason: built.reason === 'unsupported' && asked.answer?.supported === false && asked.answer.reason !== 'ambiguous' ? 'unsupported' : built.reason });
        continue;
      }
      const problem = rules.pointProblem(built.point, {
        readingId: request.readingId,
        videoId: request.videoId,
        duration: request.duration,
        frameSize: request.frameSize,
        sampleTimes: request.frames.map((item) => item.time)
      });
      if (problem) dropped.push({ time: frame.time, reason: problem });
      else points.push(built.point);
    }
  } catch {
    signal?.throwIfAborted();
    log({ event: 'geometry_lesson', readingId: request.readingId, frames: request.frames.length, points: 0, ms: Date.now() - started });
    return fail(budget.aborted ? 504 : 502, budget.aborted ? '这次阅读超时。' : '模型没有回应。');
  }
  signal?.throwIfAborted();
  const looked = request.frames.length - dropped.filter((item) => item.reason === 'image_invalid').length;
  log({
    event: 'geometry_lesson',
    readingId: request.readingId,
    frames: request.frames.length,
    points: points.length,
    reasons: dropped.reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] || 0) + 1 }), {}),
    ms: Date.now() - started
  });
  if (looked > 0 && transport === looked && points.length === 0) return fail(502, '模型没有回应。');
  return {
    status: 200,
    payload: {
      schemaVersion: '1.0.0',
      readingId: request.readingId,
      videoId: request.videoId,
      duration: request.duration,
      origin: 'external',
      points,
      dropped
    }
  };
}
