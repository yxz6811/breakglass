const SYSTEM_PROMPT = [
  '你在看一节数学课视频的一帧截图，任务是读出画面里那条抛物线。',
  '只回答一个 JSON 对象，不要任何别的文字。',
  '画面上有一条能看清的二次函数图象，就回答 hasParabola 为 true。方程写在图上就按图上的数读；没写方程时，根据这条图象和坐标轴读出顶点式。',
  '方程如果是 y = ax^2 + bx + c，先化成顶点式 y = a(x - h)^2 + k，再填 a、h、k。h = -b / (2a)，k = (4ac - b^2) / (4a)。',
  '有几条抛物线时，选标着方程、和表格数值对得上、或者画得最清楚的那一条。',
  '只有画面里没有抛物线图象，或者几条一样清楚又对不上任何方程时，才回答 {"hasParabola": false}。'
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
    '{"hasParabola": true, "equation": {"a": 数, "h": 数, "k": 数}, '
      + '"anchors": [{"x": 数, "y": 数, "px": 数, "py": 数}], '
      + '"curveXMin": 数, "curveXMax": 数, "lessonLine": "一句话"}',
    'equation 写成顶点式 y = a(x - h)^2 + k 的 a、h、k，数学坐标的 y 向上。一般式要先化成顶点式，不要把 b、c 填进 h、k。',
    '图象可以是彩色、虚线、较粗的笔画，或者深色底上的浅色线。',
    'anchors 至少给 3 个你能看准的点：坐标轴刻度、原点、曲线上标出的点都可以；'
      + 'x、y 是数学坐标，px、py 是它在图片上的像素位置，允许大约几十像素的偏差；这些点里至少要有两个不同的 x 和两个不同的 y。',
    'curveXMin、curveXMax 是画面上这条曲线画出来的那一段的数学横坐标两端。',
    'lessonLine 用中文写这一刻老师在讲什么，不超过 40 个字。'
  ];
  if (courseText) {
    lines.push('下面是课程正文，只用来写 lessonLine 和排除无关的曲线，不能代替画面：', courseText);
  }
  return lines.join('\n');
}

/**
 * 思考模型会把推理放在 think 标签里。方程 JSON 只从标签后面的正文取。
 *
 * @param {unknown} content
 * @returns {string}
 */
function answerText(content) {
  const text = Array.isArray(content)
    ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('')
    : content;
  if (typeof text !== 'string') return '';
  const marker = '</think>';
  const at = text.toLowerCase().lastIndexOf(marker);
  return at >= 0 ? text.slice(at + marker.length) : text;
}

/**
 * 从模型回复里取出 JSON 对象。容忍外面包了 ``` 代码块或多了几句话。
 *
 * @param {unknown} content
 * @returns {Record<string, unknown> | null}
 */
export function parseAnswer(content) {
  const text = answerText(content);
  if (!text) return null;
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

/** 限流或上游暂时不可用时，同一次阅读里再试的等待。页面单帧截止是 30 秒。 */
const RATE_LIMIT_DELAYS_MS = [3000, 5000];
const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>} 等到时为 true；调用方已取消则为 false
 */
function waitForRetry(ms, signal) {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ready) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {object} settings
 * @returns {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }[]}
 */
function targetsOf(settings) {
  if (Array.isArray(settings.models) && settings.models.length > 0) {
    return settings.models.filter((item) => item && item.baseUrl && item.apiKey && item.model);
  }
  if (settings.baseUrl && settings.apiKey && settings.model) {
    return [{
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      jsonMode: Boolean(settings.jsonMode)
    }];
  }
  return [];
}

/**
 * 每次阅读换一个起点，避免总打在同一款已经拥塞的模型上。
 *
 * @param {number} count
 * @param {{ next?: number }} cursor
 * @returns {number}
 */
function claimStart(count, cursor) {
  if (count <= 1) return 0;
  const current = Number.isInteger(cursor?.next) ? cursor.next : 0;
  const start = ((current % count) + count) % count;
  if (cursor) cursor.next = (start + 1) % count;
  return start;
}

/**
 * 取消和整次超时不再往下换。限流、断网、5xx 和读不懂的回答可以换。
 * 模型明确说没有抛物线时不在这里处理，那是一次成功的阅读。
 *
 * @param {{ ok: boolean, reason?: string, transport?: boolean }} result
 * @returns {boolean}
 */
function canFailover(result) {
  if (!result || result.ok || result.reason === 'model_timeout') return false;
  return result.transport === true || result.reason === 'answer_unreadable' || result.reason === 'model_bad_json';
}

/**
 * @param {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }} target
 * @param {string} dataUrl
 * @param {{ width: number, height: number }} image
 * @param {number} time
 * @param {string} courseText
 * @returns {object}
 */
function requestBody(target, dataUrl, image, time, courseText) {
  const body = {
    model: target.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt(image, time, courseText) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  };
  if (target.jsonMode) body.response_format = { type: 'json_object' };
  // 4.6V-Flash 默认可能先思考。关掉思考，把 30 秒留给换模型和读曲线。
  if (target.model === 'glm-4.6v-flash') body.thinking = { type: 'disabled' };
  return body;
}

/**
 * @param {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean }} target
 * @param {object} body
 * @param {AbortSignal} signal
 * @param {typeof fetch} fetchImpl
 * @param {number[]} delays 只有池里仅剩一个模型时才等待再试；有备选就立刻换
 * @returns {Promise<{ ok: true, answer: Record<string, unknown> } | { ok: false, reason: string, transport: boolean }>}
 */
async function askTarget(target, body, signal, fetchImpl, delays) {
  let response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetchImpl(`${target.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${target.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { ok: false, reason: timedOut ? 'model_timeout' : 'model_unreachable', transport: true };
    }
    if (signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
    if (response.ok) break;
    const delay = RETRYABLE_STATUS.has(response.status) ? delays[attempt] : undefined;
    if (delay === undefined) return { ok: false, reason: `model_http_${response.status}`, transport: true };
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    const ready = await waitForRetry(delay, signal);
    if (!ready || signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: signal.aborted ? 'model_timeout' : 'model_bad_json', transport: true };
  }
  if (signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const answer = parseAnswer(choice && choice.message ? choice.message.content : null);
  if (!answer) return { ok: false, reason: 'answer_unreadable', transport: false };
  return { ok: true, answer };
}

/**
 * 按模型池轮询读一帧。当前模型限流、不可用或答非所问时，立刻换下一个。
 * 池里只有一个模型时，429 和 503 仍按 settings.retryDelaysMs 再试，默认先等 3 秒、再等 5 秒。
 *
 * @param {object} options
 * @param {{ baseUrl: string, apiKey: string, model: string, jsonMode: boolean,
 *   models?: { baseUrl: string, apiKey: string, model: string, jsonMode: boolean }[],
 *   modelCursor?: { next: number },
 *   retryDelaysMs?: number[] }} options.settings
 * @param {string} options.dataUrl 页面送来的 JPEG data URL
 * @param {{ width: number, height: number }} options.image JPEG 宽高
 * @param {number} options.time 这一帧的秒数
 * @param {string} options.courseText
 * @param {AbortSignal} options.signal
 * @param {typeof fetch} options.fetchImpl
 * @returns {Promise<{ ok: true, answer: Record<string, unknown>, model: string } | { ok: false, reason: string, transport: boolean }>}
 */
export async function askModel({ settings, dataUrl, image, time, courseText, signal, fetchImpl }) {
  if (signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
  const targets = targetsOf(settings);
  if (targets.length === 0) return { ok: false, reason: 'model_unconfigured', transport: true };
  const start = claimStart(targets.length, settings.modelCursor);
  const delays = targets.length === 1
    ? (Array.isArray(settings.retryDelaysMs) ? settings.retryDelaysMs : RATE_LIMIT_DELAYS_MS)
    : [];
  let last = { ok: false, reason: 'model_unreachable', transport: true };
  for (let offset = 0; offset < targets.length; offset += 1) {
    if (signal.aborted) return { ok: false, reason: 'model_timeout', transport: true };
    const target = targets[(start + offset) % targets.length];
    const body = requestBody(target, dataUrl, image, time, courseText);
    last = await askTarget(target, body, signal, fetchImpl, delays);
    if (last.ok) return { ...last, model: target.model };
    if (!canFailover(last)) return last;
  }
  return last;
}
