/**
 * 细对齐时，命中段里落在笔画上的比例。低于它就不用这次测量。
 */
const MIN_COVERAGE = 0.72;

/**
 * 一条能画出来的抛物线，至少要有这么长的一段同时落在画面和笔画上。
 */
const MIN_HITS = 12;
const MIN_SPAN = 0.8;
const MIN_PIXEL = 36;
const SAMPLE_STEP = 0.2;
const SAMPLE_REACH = 3.2;

/**
 * 把细笔画标出来。深色线、浅色粉笔线和彩色线都算，大块同色底色不算。
 *
 * @param {Buffer} rgb
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function strokeMask(rgb, width, height) {
  const count = width * height;
  const lum = new Float32Array(count);
  const chroma = new Uint16Array(count);
  for (let index = 0, pixel = 0; index < count; index += 1, pixel += 3) {
    const red = rgb[pixel];
    const green = rgb[pixel + 1];
    const blue = rgb[pixel + 2];
    lum[index] = red * 0.299 + green * 0.587 + blue * 0.114;
    chroma[index] = Math.max(red, green, blue) - Math.min(red, green, blue);
  }
  const ink = new Uint8Array(count);
  const at = (x, y) => y * width + x;
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) {
      const index = at(x, y);
      const level = lum[index];
      const color = chroma[index];
      let maxNear = 0;
      let lowChroma = 255;
      let darkDirections = 0;
      for (const [stepX, stepY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const near = at(x + stepX * 2, y + stepY * 2);
        maxNear = Math.max(maxNear, lum[near]);
        lowChroma = Math.min(lowChroma, chroma[near]);
        if (lum[at(x + stepX * 4, y + stepY * 4)] <= 55) darkDirections += 1;
      }
      // 浅底上的深色细线，或深底上至少两个方向都露出来的浅色细线。旁边一整块亮纸不算。
      const dark = level <= 78 && maxNear - level >= 42;
      const light = level >= 200 && darkDirections >= 2;
      const colored = color >= 100 && color - lowChroma >= 55 && maxNear - level >= 18;
      if (dark || light || colored) ink[index] = 1;
    }
  }
  return ink;
}

/**
 * @param {Uint8Array} ink
 * @param {number} width
 * @param {number} height
 * @returns {Uint32Array}
 */
function inkIntegral(ink, width, height) {
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    const inkRow = (y - 1) * width;
    for (let x = 1; x <= width; x += 1) {
      row += ink[inkRow + x - 1];
      sums[y * stride + x] = sums[(y - 1) * stride + x] + row;
    }
  }
  return sums;
}

/**
 * 闭区间里有没有笔画。调用方保证坐标落在图内。
 *
 * @param {Uint32Array} sums
 * @param {number} width
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {boolean}
 */
function hasInk(sums, width, x0, y0, x1, y1) {
  const stride = width + 1;
  const sum = sums[(y1 + 1) * stride + (x1 + 1)]
    - sums[y0 * stride + (x1 + 1)]
    - sums[(y1 + 1) * stride + x0]
    + sums[y0 * stride + x0];
  return sum > 0;
}

/**
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function pixelSpan(params, map, min, max) {
  const yAt = (x) => params.a * (x - params.h) ** 2 + params.k;
  const px = (x) => map.ox + map.sx * x;
  const py = (y) => map.oy - map.sy * y;
  const x0 = px(min);
  const y0 = py(yAt(min));
  const x1 = px(max);
  const y1 = py(yAt(max));
  let span = Math.hypot(x1 - x0, y1 - y0);
  if (params.h > min && params.h < max) {
    const vertexX = px(params.h);
    const vertexY = py(params.k);
    span = Math.max(span, Math.hypot(vertexX - x0, vertexY - y0), Math.hypot(x1 - vertexX, y1 - vertexY));
  }
  return span;
}

/**
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {number} x
 * @param {Uint32Array} sums
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {{ x: number, on: boolean } | null}
 */
function sampleAt(params, map, x, sums, width, height, radius) {
  const y = params.a * (x - params.h) ** 2 + params.k;
  const px = Math.round(map.ox + map.sx * x);
  const py = Math.round(map.oy - map.sy * y);
  if (!Number.isFinite(px) || !Number.isFinite(py)
      || px < radius || py < radius || px >= width - radius || py >= height - radius) return null;
  return { x, on: hasInk(sums, width, px - radius, py - radius, px + radius, py + radius) };
}

/**
 * 顶点两侧分开计分。两侧都在画面里时必须两侧都贴住笔画，避免只蹭到一条边就当成整条抛物线。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {Uint32Array} sums
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @param {number} minSide
 * @returns {{ score: number, hits: number, min: number, max: number, pixelSpan: number } | null}
 */
/**
 * 从顶点向外走，连续踩空就停。曲线没画到窗口尽头时，不把窗外的空白算进失败。
 *
 * @param {{ x: number, on: boolean }[]} samples 已按离开顶点的顺序排好
 * @returns {{ hit: number, seen: number, far: number | null }}
 */
function walkOut(samples) {
  let hit = 0;
  let seen = 0;
  let gap = 0;
  let far = null;
  for (const sample of samples) {
    if (!sample.on) {
      gap += 1;
      if (gap > 2) break;
      continue;
    }
    seen += gap;
    gap = 0;
    seen += 1;
    hit += 1;
    far = sample.x;
  }
  return { hit, seen, far };
}

function measureSides(params, map, sums, width, height, radius, minSide) {
  if (!(map.sx > 0) || !(map.sy > 0)) return null;
  const leftSamples = [];
  const rightSamples = [];
  let vertexOn = false;
  let vertexSeen = false;
  for (let x = params.h - SAMPLE_REACH; x <= params.h + SAMPLE_REACH + 1e-9; x += SAMPLE_STEP) {
    const sample = sampleAt(params, map, x, sums, width, height, radius);
    if (!sample) continue;
    if (x < params.h - 0.15) leftSamples.push(sample);
    else if (x > params.h + 0.15) rightSamples.push(sample);
    else {
      vertexSeen = true;
      vertexOn = sample.on;
    }
  }
  leftSamples.reverse();
  const left = walkOut(leftSamples);
  const right = walkOut(rightSamples);
  const hits = left.hit + right.hit;
  const bothVisible = leftSamples.length >= 6 && rightSamples.length >= 6;
  const vertexOk = !vertexSeen || vertexOn;
  let score = 0;
  if (bothVisible) {
    if (!vertexOk || left.hit < 5 || right.hit < 5 || left.seen < 5 || right.seen < 5) return null;
    score = Math.min(left.hit / left.seen, right.hit / right.seen);
    if (score < minSide) return null;
  } else {
    const visible = leftSamples.length >= 6 ? left : right;
    const otherHidden = leftSamples.length >= 6 ? rightSamples.length === 0 : leftSamples.length === 0;
    if (!otherHidden || visible.seen < 6 || visible.hit < 10 || !vertexOk) return null;
    score = visible.hit / visible.seen;
    if (score < Math.max(minSide, 0.88)) return null;
  }
  const min = left.far == null ? params.h : left.far;
  const max = right.far == null ? params.h : right.far;
  if (!(max - min >= MIN_SPAN) || hits < MIN_HITS) return null;
  const span = pixelSpan(params, map, min, max);
  if (span < MIN_PIXEL) return null;
  return { score, hits, min, max, pixelSpan: span };
}

/**
 * 模型给出的 a、h、k 往往是对的，像素锚点经常不在这张图上。
 * 这里直接在画面里找和这条方程重合的笔画：彩色线、粉笔线、横纵比例不同的坐标轴都可以。
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
      || params.h - SAMPLE_REACH + SAMPLE_STEP === params.h - SAMPLE_REACH) return null;
  const sums = inkIntegral(strokeMask(rgb, width, height), width, height);
  const candidates = [];
  for (let sx = 8; sx <= 112; sx += 4) {
    for (const ratio of [0.75, 1, 1.33]) {
      const sy = Math.max(6, Math.round(sx * ratio));
      for (let ox = 0; ox <= width; ox += 12) {
        for (let oy = 0; oy <= height; oy += 12) {
          const map = { ox, sx, oy, sy };
          const wide = measureSides(params, map, sums, width, height, 4, 0.8);
          if (wide) candidates.push({ map, score: wide.score, pixelSpan: wide.pixelSpan });
        }
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.pixelSpan - left.pixelSpan);
  let best = null;
  for (const candidate of candidates.slice(0, 8)) {
    const { map } = candidate;
    for (let sx = map.sx - 6; sx <= map.sx + 6; sx += 2) {
      if (sx < 8) continue;
      for (let sy = map.sy - 6; sy <= map.sy + 6; sy += 2) {
        if (sy < 8 || sy / sx < 0.55 || sy / sx > 1.8) continue;
        for (let ox = map.ox - 12; ox <= map.ox + 12; ox += 2) {
          for (let oy = map.oy - 12; oy <= map.oy + 12; oy += 2) {
            const next = { ox, sx, oy, sy };
            const tight = measureSides(params, next, sums, width, height, 1, MIN_COVERAGE);
            if (!tight || !specific(params, next, tight, sums, width, height)) continue;
            const exact = measureSides(params, next, sums, width, height, 0, 0);
            const exactHits = exact ? exact.hits : 0;
            // 贴在笔画中心上的命中比蹭到笔画边缘更可信，长的真曲线因此胜过短的巧合。
            const quality = exactHits * exactHits / Math.max(1, tight.hits);
            if (!best || quality > best.quality + 0.5) {
              best = {
                map: next,
                score: tight.score,
                quality,
                min: exact && exactHits >= MIN_HITS ? exact.min : tight.min,
                max: exact && exactHits >= MIN_HITS ? exact.max : tight.max
              };
            }
          }
        }
      }
    }
  }
  if (!best || !(best.min < best.max)) return null;
  return { map: best.map, drawn: { min: best.min, max: best.max }, score: best.score };
}

/**
 * 平移几像素后两侧不应仍然贴住笔画。贴在文字或坐标轴上的巧合匹配会被丢掉。
 *
 * @param {{ a: number, h: number, k: number }} params
 * @param {{ ox: number, sx: number, oy: number, sy: number }} map
 * @param {{ score: number }} item
 * @param {Uint32Array} sums
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
function specific(params, map, item, sums, width, height) {
  for (const [stepX, stepY] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
    const shifted = measureSides(params, {
      ox: map.ox + stepX,
      oy: map.oy + stepY,
      sx: map.sx,
      sy: map.sy
    }, sums, width, height, 1, MIN_COVERAGE);
    if (shifted && shifted.score >= item.score - 0.08) return false;
  }
  return true;
}
