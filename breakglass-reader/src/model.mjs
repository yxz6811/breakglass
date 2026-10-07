import { buildModelRequest, ModelProfileError } from './model-profile.mjs';
import { cancelProviderResponse, readProviderPayload, withProviderAbort } from './provider-payload.mjs';

const SYSTEM_PROMPT = [
  '你在看一节数学课视频的一帧截图，任务是读出画面里那条抛物线。',
  '只回答一个 JSON 对象，不要任何别的文字。',
  '画面里没有清楚的坐标系，或者看不清是哪条抛物线，就回答 {"hasParabola": false}。',
  '有几条抛物线时，选标着方程、或者和表格数值对得上的那一条；还分不清就回答 {"hasParabola": false}。',
  '必须有截图中清楚的数值方程或明确数值条件；仅凭无刻度曲线外形不能猜成 y=x²。课程文本不能补足截图缺失的数学条件。'
].join('\n');

/**
 * @param {{ width: number, height: number }} image
 * @param {number} time
 * @param {string} courseText
 * @returns {string}
 */
function userPrompt(image, time, courseText) {
  const lines = [
    `这一帧在视频第 ${time.toFixed(2)} 秒，图片宽 ${image.width} 像素、高 ${image.height} 像素。`,
    '像素坐标以图片左上角为原点，px 向右增大，py 向下增大。',
    '有抛物线时按这个格式回答：',
    '{"hasParabola": true, "equation": {"form":"vertex","a":数,"h":数,"k":数}, '
      + '"anchors": [{"x": 数, "y": 数, "px": 数, "py": 数}], '
      + '"curveXMin": 数, "curveXMax": 数, "lessonLine": "一句话"}',
    'equation 只报告读到的系数：一般式 y=ax²+bx+c 用 {"form":"general","a":数,"b":数,"c":数}；顶点式 y=a(x-h)²+k 用 {"form":"vertex","a":数,"h":数,"k":数}。不要自行把一般式换算为顶点式。数学坐标的 y 向上。',
    'anchors 至少给 3 个你能看准的点：坐标轴刻度、原点、曲线上标出的点都可以；'
      + 'x、y 是数学坐标，px、py 是它在图片上的像素位置；这些点里至少要有两个不同的 x 和两个不同的 y。',
    'curveXMin、curveXMax 是画面上这条曲线画出来的那一段的数学横坐标两端。',
    'lessonLine 用中文写这一刻老师在讲什么，不超过 40 个字。'
  ];
  if (courseText) {
    lines.push('下面是课程正文，只用来写 lessonLine 和排除无关的曲线，不能代替画面：', courseText);
  }
  return lines.join('\n');
}

/**
 * 从模型回复里取出 JSON 对象。容忍外面包了 ``` 代码块或多了几句话。
 *
 * @param {unknown} content
 * @returns {Record<string, unknown> | null}
 */
export function parseAnswer(content) {
  const text = Array.isArray(content)
    ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('')
    : content;
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 请一次 OpenAI 兼容的 chat/completions，读一帧。失败不重试。
 *
 * @param {object} options
 * @param {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }} options.settings
 * @param {string} options.dataUrl 页面送来的 JPEG data URL
 * @param {{ width: number, height: number }} options.image JPEG 宽高
 * @param {number} options.time 这一帧的秒数
 * @param {string} options.courseText
 * @param {AbortSignal} options.signal
 * @param {typeof fetch} options.fetchImpl
 * @returns {Promise<{ ok: true, answer: Record<string, unknown> } | { ok: false, reason: string, transport: boolean }>}
 */
export async function askModel({ settings, dataUrl, image, time, courseText, signal, fetchImpl }) {
  if (signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
  let body;
  try {
    body = buildModelRequest(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt(image, time, courseText) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]);
  } catch (error) {
    return { ok: false, reason: error instanceof ModelProfileError ? error.code : 'invalid_model_profile', transport: true };
  }
  try {
    return await withProviderAbort(signal, async () => {
      const response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(body),
      signal
      });
      if (signal.aborted) { cancelProviderResponse(response); signal.throwIfAborted(); }
      if (!response.ok) { cancelProviderResponse(response); return { ok: false, reason: `model_http_${response.status}`, transport: true }; }
      const payload = await readProviderPayload(response, signal);
      signal.throwIfAborted();
      const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
      const answer = parseAnswer(choice && choice.message ? choice.message.content : null);
      if (!answer) return { ok: false, reason: 'answer_unreadable', transport: false };
      return { ok: true, answer };
    });
  } catch (error) {
    const timedOut = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const reason = timedOut ? 'model_timeout' : error?.code === 'response_limit' ? 'model_response_limit'
      : error?.code === 'model_bad_json' ? 'model_bad_json' : 'model_unreachable';
    return { ok: false, reason, transport: true };
  }
}
