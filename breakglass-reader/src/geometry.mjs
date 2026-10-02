/**
 * 模型读出的锚点（数学坐标 ↔ JPEG 像素）在拟合后，最远一个点允许偏离的距离，
 * 按 JPEG 短边的比例计。超出说明模型自己的读数前后不一致，整帧丢掉。
 */
export const ANCHOR_TOLERANCE = 0.02;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {number} value
 * @param {number} digits
 * @returns {number}
 */
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 一维最小二乘：pixel ≈ offset + slope × value。
 *
 * @param {{ value: number, pixel: number }[]} pairs
 * @returns {{ offset: number, slope: number } | null}
 */
function fitLine(pairs) {
  const count = pairs.length;
  const meanValue = pairs.reduce((sum, item) => sum + item.value, 0) / count;
  const meanPixel = pairs.reduce((sum, item) => sum + item.pixel, 0) / count;
  let spread = 0;
  let shared = 0;
  for (const item of pairs) {
    spread += (item.value - meanValue) ** 2;
    shared += (item.value - meanValue) * (item.pixel - meanPixel);
  }
  if (spread < 1e-12) return null;
  const slope = shared / spread;
  return { offset: meanPixel - slope * meanValue, slope };
}

/**
 * 由锚点求出数学坐标到 JPEG 像素的映射：px = ox + sx·x，py = oy − sy·y（y 向上）。
 *
 * @param {unknown} anchors 每项含数学 x、y 和 JPEG 像素 px、py
 * @param {{ width: number, height: number }} image JPEG 宽高
 * @returns {{ ok: true, map: { ox: number, sx: number, oy: number, sy: number }, maxResidual: number }
 *   | { ok: false, reason: string }}
 */
export function fitAxes(anchors, image) {
  const usable = (Array.isArray(anchors) ? anchors : []).filter((item) => item
    && finite(item.x) && finite(item.y) && finite(item.px) && finite(item.py));
  if (usable.length < 3) return { ok: false, reason: 'too_few_anchors' };
  if (new Set(usable.map((item) => item.x)).size < 2 || new Set(usable.map((item) => item.y)).size < 2) {
    return { ok: false, reason: 'degenerate_anchors' };
  }

  const xFit = fitLine(usable.map((item) => ({ value: item.x, pixel: item.px })));
  const yFit = fitLine(usable.map((item) => ({ value: item.y, pixel: item.py })));
  if (!xFit || !yFit) return { ok: false, reason: 'degenerate_anchors' };
  const map = { ox: xFit.offset, sx: xFit.slope, oy: yFit.offset, sy: -yFit.slope };
  if (!(map.sx > 0) || !(map.sy > 0)) return { ok: false, reason: 'axis_direction' };
  const aspect = map.sy / map.sx;
  if (aspect < 0.1 || aspect > 10) return { ok: false, reason: 'axis_ratio' };

  let maxResidual = 0;
  for (const item of usable) {
    const dx = map.ox + map.sx * item.x - item.px;
    const dy = map.oy - map.sy * item.y - item.py;
    maxResidual = Math.max(maxResidual, Math.hypot(dx, dy));
  }
  if (maxResidual > ANCHOR_TOLERANCE * Math.min(image.width, image.height)) {
    return { ok: false, reason: 'anchors_disagree' };
  }
  return { ok: true, map, maxResidual };
}

/**
 * 顶点式在 [min, max] 上的最低值和最高值。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @param {number} min
 * @param {number} max
 * @returns {{ low: number, high: number }}
 */
function extent(params, min, max) {
  const at = (x) => params.a * (x - params.h) ** 2 + params.k;
  const values = [at(min), at(max)];
  if (params.h > min && params.h < max) values.push(params.k);
  return { low: Math.min(...values), high: Math.max(...values) };
}

/**
 * 把横坐标区间收窄到曲线不越出 [yMin, yMax] 的那一段。顶点本身出画时返回 null。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @param {number} min
 * @param {number} max
 * @param {number} yMin
 * @param {number} yMax
 * @returns {{ min: number, max: number } | null}
 */
function trimToHeight(params, min, max, yMin, yMax) {
  const { a, h, k } = params;
  if (k <= yMin || k >= yMax) {
    if (h > min && h < max) return null;
  }
  const limit = a > 0 ? yMax : yMin;
  if ((a > 0 && k < limit) || (a < 0 && k > limit)) {
    const half = Math.sqrt((limit - k) / a);
    min = Math.max(min, h - half);
    max = Math.min(max, h + half);
  }
  return min < max ? { min, max } : null;
}

/**
 * 把要画的那段曲线放进画面：算出 domain、range，再把区域从 JPEG 像素乘回源像素。
 * 区域、domain、range 一起决定页面的坐标映射，和锚点拟合出的映射一致。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ min: number, max: number }} drawn 模型说画出来的那段数学横坐标
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map JPEG 像素映射
 * @param {{ width: number, height: number }} image JPEG 宽高
 * @param {{ width: number, height: number }} frameSize 源尺寸
 * @returns {{ ok: true, domain: { min: number, max: number }, range: { min: number, max: number },
 *   region: { x: number, y: number, width: number, height: number } } | { ok: false, reason: string }}
 */
export function placeCurve(params, drawn, map, image, frameSize) {
  if (!drawn || !finite(drawn.min) || !finite(drawn.max) || !(drawn.min < drawn.max)) {
    return { ok: false, reason: 'curve_extent' };
  }
  const frame = {
    xMin: -map.ox / map.sx,
    xMax: (image.width - map.ox) / map.sx,
    yMin: (map.oy - image.height) / map.sy,
    yMax: map.oy / map.sy
  };
  const across = trimToHeight(
    params,
    Math.max(drawn.min, frame.xMin),
    Math.min(drawn.max, frame.xMax),
    frame.yMin,
    frame.yMax
  );
  if (!across) return { ok: false, reason: 'outside_frame' };

  const { low, high } = extent(params, across.min, across.max);
  const pad = Math.max(0.25, (high - low) * 0.05);
  const domain = { min: round(across.min, 4), max: round(across.max, 4) };
  const range = {
    min: round(Math.max(low - pad, frame.yMin), 4),
    max: round(Math.min(high + pad, frame.yMax), 4)
  };
  if (!(domain.min < domain.max) || !(range.min < range.max)) return { ok: false, reason: 'outside_frame' };

  const scaleX = frameSize.width / image.width;
  const scaleY = frameSize.height / image.height;
  const left = Math.max(0, (map.ox + map.sx * domain.min) * scaleX);
  const right = Math.min(frameSize.width, (map.ox + map.sx * domain.max) * scaleX);
  const top = Math.max(0, (map.oy - map.sy * range.max) * scaleY);
  const bottom = Math.min(frameSize.height, (map.oy - map.sy * range.min) * scaleY);
  const region = {
    x: round(left, 2),
    y: round(top, 2),
    width: round(right - left, 2),
    height: round(bottom - top, 2)
  };
  region.width = Math.min(region.width, round(frameSize.width - region.x, 2));
  region.height = Math.min(region.height, round(frameSize.height - region.y, 2));
  if (!(region.width > 0) || !(region.height > 0)) return { ok: false, reason: 'outside_frame' };
  return { ok: true, domain, range, region };
}

/**
 * 页面滑块的范围：围着读出的值留出可调的余地，步长 0.1。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @returns {Record<'a' | 'h' | 'k', { initial: number, min: number, max: number, step: number }>}
 */
export function sliderRanges(params) {
  const around = (value, span) => ({
    initial: round(value, 3),
    min: round(value - span, 3),
    max: round(value + span, 3),
    step: 0.1
  });
  return {
    a: around(params.a, Math.max(0.5, Math.abs(params.a) * 0.5)),
    h: around(params.h, 2),
    k: around(params.k, 2)
  };
}
