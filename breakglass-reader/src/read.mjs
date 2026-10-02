import { decodeJpegDataUrl, jpegSize, sameAspect } from './jpeg.mjs';
import { askModel } from './model.mjs';
import { fitAxes, placeCurve, sliderRanges } from './geometry.mjs';

const MAX_FRAMES = 8;
const COURSE_TEXT_LIMIT = 8000;
const LINE_LIMIT = 80;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function filled(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 按码点截断，避免把一个字劈成半个代理对。
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function clip(text, limit) {
  const chars = Array.from(text);
  return chars.length > limit ? chars.slice(0, limit).join('') : text;
}

/**
 * 检查页面请求的形状。只认契约里的字段，别的字段忽略。
 *
 * @param {unknown} body
 * @returns {{ ok: true, request: { readingId: string, videoId: string, duration: number,
 *   frameSize: { width: number, height: number } | null, courseText: string,
 *   frames: { time: number, image: string }[] } } | { ok: false, error: string }}
 */
export function checkRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求不是 JSON 对象。' };
  const { readingId, videoId, duration, frameSize, courseText, frames } = body;
  if (!filled(readingId) || !filled(videoId)) return { ok: false, error: '缺少 readingId 或 videoId。' };
  if (videoId === 'fixture-parabola') return { ok: false, error: '演示夹具不进入阅读。' };
  if (!finite(duration) || duration <= 0) return { ok: false, error: 'duration 无效。' };
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) {
    return { ok: false, error: 'frames 要有 1 到 8 张。' };
  }
  for (const frame of frames) {
    if (!frame || !finite(frame.time) || frame.time < 0 || frame.time > duration || typeof frame.image !== 'string') {
      return { ok: false, error: 'frames 里有无效的一项。' };
    }
  }
  const size = frameSize && finite(frameSize.width) && finite(frameSize.height)
    && frameSize.width > 0 && frameSize.height > 0
    ? { width: frameSize.width, height: frameSize.height }
    : null;
  return {
    ok: true,
    request: {
      readingId,
      videoId,
      duration,
      frameSize: size,
      courseText: typeof courseText === 'string' ? clip(courseText.trim(), COURSE_TEXT_LIMIT) : '',
      frames: frames.map((frame) => ({ time: frame.time, image: frame.image }))
    }
  };
}

/**
 * 有限并发地依次处理，结果保持原顺序。
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

/**
 * @param {number} value
 * @returns {string}
 */
function shortNumber(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * 模型没写讲解句时用读出的方程顶上。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @returns {string}
 */
function equationLine(params) {
  return `这一帧在讲 y = ${shortNumber(params.a)}(x − ${shortNumber(params.h)})² + ${shortNumber(params.k)}`;
}

/**
 * 读一帧：量尺寸、问模型、拟合坐标、算区域。只返回曲线素材或丢掉的原因。
 *
 * @param {{ time: number, image: string }} frame
 * @param {object} context
 * @returns {Promise<{ ok: true, time: number, params: { a: number, h: number, k: number },
 *   placement: object, lessonLine: string } | { ok: false, reason: string, transport?: boolean }>}
 */
async function readFrame(frame, context) {
  const { request, settings, fetchImpl, budget } = context;
  const bytes = decodeJpegDataUrl(frame.image);
  const image = bytes ? jpegSize(bytes) : null;
  if (!image) return { ok: false, reason: 'image_unreadable' };
  if (!sameAspect(image, request.frameSize)) return { ok: false, reason: 'size_mismatch' };
  if (budget.aborted) return { ok: false, reason: 'budget_spent', transport: true };

  const reply = await askModel({
    settings,
    dataUrl: frame.image,
    image,
    time: frame.time,
    courseText: request.courseText,
    signal: AbortSignal.any([budget, AbortSignal.timeout(settings.timeoutMs)]),
    fetchImpl
  });
  if (!reply.ok) return reply;
  const answer = reply.answer;
  if (answer.hasParabola !== true) return { ok: false, reason: 'no_parabola' };

  const equation = answer.equation && typeof answer.equation === 'object' ? answer.equation : {};
  const params = { a: Number(equation.a), h: Number(equation.h), k: Number(equation.k) };
  if (!finite(params.a) || !finite(params.h) || !finite(params.k) || Math.abs(params.a) < 1e-6) {
    return { ok: false, reason: 'equation_invalid' };
  }
  const axes = fitAxes(answer.anchors, image);
  if (!axes.ok) return axes;
  const placement = placeCurve(
    params,
    { min: Number(answer.curveXMin), max: Number(answer.curveXMax) },
    axes.map,
    image,
    request.frameSize
  );
  if (!placement.ok) return placement;

  const line = typeof answer.lessonLine === 'string' ? answer.lessonLine.trim() : '';
  return {
    ok: true,
    time: frame.time,
    params,
    placement,
    lessonLine: clip(line || equationLine(params), LINE_LIMIT)
  };
}

/**
 * 把一帧的读数拼成契约里的点。
 *
 * @param {object} reading
 * @param {object} request
 * @param {string} id
 * @param {string} lessonLine
 * @returns {object}
 */
function toPoint(reading, request, id, lessonLine) {
  return {
    id,
    time: reading.time,
    lessonLine,
    curve: {
      requestId: `${request.readingId}:${id}`,
      videoId: request.videoId,
      time: reading.time,
      frameSize: { width: request.frameSize.width, height: request.frameSize.height },
      source: 'preset',
      fallback: null,
      definition: {
        equationId: 'fixture.parabola',
        parameters: sliderRanges(reading.params),
        dragParameter: 'h',
        domain: reading.placement.domain,
        range: reading.placement.range,
        yAxis: 'up',
        region: reading.placement.region
      }
    }
  };
}

/**
 * 同一次阅读里讲解句不能重复，重复时补上秒数。
 *
 * @param {string} line
 * @param {number} time
 * @param {Set<string>} seen
 * @returns {string}
 */
function uniqueLine(line, time, seen) {
  let next = line;
  if (seen.has(next)) next = clip(`${clip(line, LINE_LIMIT - 12)}（第 ${time.toFixed(1)} 秒）`, LINE_LIMIT);
  seen.add(next);
  return next;
}

/**
 * 处理一次阅读请求。返回 HTTP 状态和响应体，不碰网络连接本身。
 *
 * @param {unknown} body 已解析的请求 JSON
 * @param {object} options
 * @param {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean,
 *   timeoutMs: number, budgetMs: number, concurrency: number }} options.settings
 * @param {{ validateLessonReading: Function }} options.pageRules 扩展里的 reading.js
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(entry: object) => void} [options.log] 只收编号、计数、原因和耗时
 * @param {() => number} [options.now]
 * @returns {Promise<{ status: number, payload: object }>}
 */
export async function readLesson(body, options) {
  const { settings, pageRules, fetchImpl = fetch, log = () => {}, now = Date.now } = options;
  const started = now();
  const checked = checkRequest(body);
  if (!checked.ok) {
    log({ event: 'rejected', error: checked.error });
    return { status: 400, payload: { error: checked.error } };
  }
  const request = checked.request;
  const envelope = {
    readingId: request.readingId,
    videoId: request.videoId,
    origin: 'external',
    duration: request.duration
  };
  if (!request.frameSize) {
    log({ event: 'read', readingId: request.readingId, frames: request.frames.length, points: 0, reasons: { no_frame_size: 1 } });
    return { status: 200, payload: { ...envelope, points: [], dropped: [{ reason: 'no_frame_size' }] } };
  }
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    log({ event: 'unconfigured', readingId: request.readingId });
    return { status: 503, payload: { error: '阅读服务没有配置模型。' } };
  }

  const budget = AbortSignal.timeout(settings.budgetMs);
  const readings = await mapLimited(
    request.frames,
    settings.concurrency,
    (frame) => readFrame(frame, { request, settings, fetchImpl, budget }).catch(() => ({ ok: false, reason: 'frame_failed' }))
  );

  const reasons = {};
  for (const item of readings) {
    if (!item.ok) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  }
  const passed = readings.filter((item) => item.ok).sort((left, right) => left.time - right.time);
  const seenLines = new Set();
  const candidates = passed.map((item, index) => toPoint(item, request, `p${index + 1}`, uniqueLine(item.lessonLine, item.time, seenLines)));
  const verdict = pageRules.validateLessonReading({ ...envelope, points: candidates }, request.frameSize);
  const points = verdict.ok ? verdict.points : [];
  const dropped = readings.filter((item) => !item.ok).map((item) => ({ reason: item.reason }))
    .concat(verdict.dropped || []);

  const allTransport = readings.length > 0 && readings.every((item) => !item.ok && item.transport);
  log({
    event: 'read',
    readingId: request.readingId,
    frames: request.frames.length,
    points: points.length,
    reasons,
    ms: now() - started
  });
  if (allTransport) return { status: 502, payload: { error: '模型没有回应。' } };
  return { status: 200, payload: { ...envelope, points, dropped } };
}
