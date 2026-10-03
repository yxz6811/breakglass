/**
 * 细对齐时，采样点落在墨线上的比例。低于它就不用这次测量。
 */
const MIN_COVERAGE = 0.72;

/**
 * 粗搜用的宽容差。够高才进入细搜，免得表格和标题被当成曲线。
 */
const WIDE_COVERAGE = 0.95;

/**
 * 把暗色细线标出来：笔画本身偏暗，旁边两像素内是浅底。大块黑边不会被标上。
 *
 * @param {Buffer} rgb
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function inkMask(rgb, width, height) {
  const ink = new Uint8Array(width * height);
  const sum = (x, y) => {
    const index = (y * width + x) * 3;
    return rgb[index] + rgb[index + 1] + rgb[index + 2];
  };
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      if (sum(x, y) > 160) continue;
      if (sum(x + 2, y) > 400 || sum(x - 2, y) > 400 || sum(x, y + 2) > 400 || sum(x, y - 2) > 400) {
        ink[y * width + x] = 1;
      }
    }
  }
  return ink;
}

/**
 * @param {Uint8Array} ink
 * @param {number} width
 * @param {number} px
 * @param {number} py
 * @param {number} radius
 * @returns {boolean}
 */
function nearInk(ink, width, px, py, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (ink[(py + dy) * width + (px + dx)]) return true;
    }
  }
  return false;
}

/**
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {Uint8Array} ink
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {{ score: number, min: number, max: number }}
 */
function coverage(params, map, ink, width, height, radius) {
  let hit = 0;
  let seen = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let x = params.h - 2.6; x <= params.h + 2.6; x += 0.2) {
    const y = params.a * (x - params.h) ** 2 + params.k;
    const px = Math.round(map.ox + map.sx * x);
    const py = Math.round(map.oy - map.sy * y);
    if (px < radius || py < radius || px >= width - radius || py >= height - radius) continue;
    seen += 1;
    if (!nearInk(ink, width, px, py, radius)) continue;
    hit += 1;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return { score: seen >= 16 ? hit / seen : 0, min, max };
}

/**
 * 模型给出的 a、h、k 往往是对的，像素锚点经常不在这张图上。
 * 这里直接在画面里找和这条方程重合的细线。横纵比例先按一样处理，课件坐标轴大多如此。
 *
 * @param {Buffer} rgb 按行排列的 RGB，长度必须是 width × height × 3
 * @param {{ width: number, height: number }} image
 * @param {{ a: number, h: number, k: number }} params
 * @returns {{ map: { ox: number, sx: number, oy: number, sy: number }, drawn: { min: number, max: number }, score: number } | null}
 */
export function locateCurve(rgb, image, params) {
  const { width, height } = image;
  if (!rgb || rgb.length !== width * height * 3) return null;
  if (!Number.isFinite(params.a) || Math.abs(params.a) < 1e-6) return null;
  if (!Number.isFinite(params.h) || !Number.isFinite(params.k)
      || params.h - 2.6 + 0.2 === params.h - 2.6) return null;
  const ink = inkMask(rgb, width, height);
  const candidates = [];
  for (let sx = 10; sx <= 48; sx += 4) {
    for (let ox = 0; ox <= width; ox += 12) {
      for (let oy = 0; oy <= height; oy += 12) {
        const map = { ox, sx, oy, sy: sx };
        const wide = coverage(params, map, ink, width, height, 4);
        if (wide.score >= WIDE_COVERAGE) candidates.push({ map, score: wide.score });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  let best = null;
  for (const candidate of candidates.slice(0, 12)) {
    const { map } = candidate;
    for (let sx = map.sx - 4; sx <= map.sx + 4; sx += 1) {
      for (let ox = map.ox - 12; ox <= map.ox + 12; ox += 2) {
        for (let oy = map.oy - 18; oy <= map.oy + 18; oy += 2) {
          const next = { ox, sx, oy, sy: sx };
          const tight = coverage(params, next, ink, width, height, 1);
          if (!best || tight.score > best.score) best = { map: next, score: tight.score, min: tight.min, max: tight.max };
        }
      }
    }
  }
  if (!best || best.score < MIN_COVERAGE || !(best.min < best.max)) return null;
  return { map: best.map, drawn: { min: best.min, max: best.max }, score: best.score };
}
