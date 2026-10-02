import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadPageRules } from '../../src/page-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const EXTENSION_DIR = path.resolve(here, '../../../extension');
export const pageRules = loadPageRules(EXTENSION_DIR);
export const alignment = require(path.join(EXTENSION_DIR, 'src/geometry/alignment.js'));

/**
 * breakglass-demo-9s.mp4 第 6.451 秒（源 3024×1898）缩到 640×402 的截帧，和页面截帧同尺寸。
 */
export const FRAME_JPEG = fs.readFileSync(path.join(here, 'fixtures/demo-6451-640x402.jpg'));
export const FRAME_DATA_URL = `data:image/jpeg;base64,${FRAME_JPEG.toString('base64')}`;
export const SOURCE_SIZE = { width: 3024, height: 1898 };
export const JPEG_SIZE = { width: 640, height: 402 };

/**
 * 这一帧里用颜色量出的点（源像素）：蓝色实线 y = x² + 1 上的红点，加上 y = x² 的顶点即原点。
 */
export const MEASURED_DOTS = [
  { x: -2, y: 5, sx: 682.9, sy: 886.5 },
  { x: -1, y: 2, sx: 789.0, sy: 1210.0 },
  { x: 0, y: 1, sx: 897.7, sy: 1318.2 },
  { x: 1, y: 2, sx: 1007.6, sy: 1210.2 },
  { x: 2, y: 5, sx: 1112.7, sy: 885.2 },
  { x: 0, y: 0, sx: 896.9, sy: 1428.8 }
];

/**
 * 假设模型看准了：把量出的点换到 JPEG 像素，保留一位小数。
 *
 * @returns {{ x: number, y: number, px: number, py: number }[]}
 */
export function accurateAnchors() {
  return MEASURED_DOTS.map((dot) => ({
    x: dot.x,
    y: dot.y,
    px: Math.round(dot.sx * (JPEG_SIZE.width / SOURCE_SIZE.width) * 10) / 10,
    py: Math.round(dot.sy * (JPEG_SIZE.height / SOURCE_SIZE.height) * 10) / 10
  }));
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function parabolaAnswer(overrides = {}) {
  return {
    hasParabola: true,
    equation: { a: 1, h: 0, k: 1 },
    anchors: accurateAnchors(),
    curveXMin: -2.5,
    curveXMax: 2.5,
    lessonLine: '把 y = x² 向上平移 1 个单位，得到 y = x² + 1',
    ...overrides
  };
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function settings(overrides = {}) {
  return {
    baseUrl: 'https://model.example/v1',
    apiKey: 'test-key-not-real',
    model: 'vision-test',
    jsonMode: false,
    timeoutMs: 5000,
    budgetMs: 10000,
    concurrency: 2,
    allowOrigin: (origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin),
    ...overrides
  };
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
export function lessonRequest(overrides = {}) {
  return {
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    duration: 9.383,
    frameSize: { ...SOURCE_SIZE },
    courseText: '顶点式二次函数的图象',
    frames: [{ time: 6.451, image: FRAME_DATA_URL }],
    ...overrides
  };
}

/**
 * 不联网的 OpenAI 兼容替身。按请求里写的秒数决定回答，记下收到的每一次请求。
 *
 * @param {(time: number) => unknown} answerFor 返回对象时当作模型回复的 JSON；返回 Error 时模拟断网
 * @returns {{ fetchImpl: typeof fetch, calls: { url: string, init: object, body: object }[] }}
 */
export function fakeModel(answerFor) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const text = body.messages[1].content[0].text;
    const time = Number(/第 ([\d.]+) 秒/.exec(text)[1]);
    const answer = answerFor(time);
    if (answer instanceof Error) throw answer;
    if (answer && answer.status) {
      return { ok: false, status: answer.status, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) } }] })
    };
  };
  return { fetchImpl, calls };
}
