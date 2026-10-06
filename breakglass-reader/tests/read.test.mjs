import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest, readLesson } from '../src/read.mjs';
import { askModel, parseAnswer } from '../src/model.mjs';
import {
  FRAME_DATA_URL,
  SOURCE_SIZE,
  fakeModel,
  lessonRequest,
  pageRules,
  parabolaAnswer,
  settings
} from './helpers/fixtures.mjs';

/**
 * @param {object} body
 * @param {object} model
 * @param {object} [overrides]
 */
async function read(body, model, overrides = {}) {
  const logs = [];
  const result = await readLesson(body, {
    settings: settings(overrides),
    pageRules,
    fetchImpl: model.fetchImpl,
    log: (entry) => logs.push(entry)
  });
  return { ...result, logs };
}

test('一帧读到抛物线：回一个能被页面收下的点', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const { status, payload } = await read(lessonRequest(), model);
  assert.equal(status, 200);
  assert.equal(payload.readingId, 'reading-1');
  assert.equal(payload.videoId, 'local-binding-1');
  assert.equal(payload.origin, 'external');
  assert.equal(payload.points.length, 1);

  const [point] = payload.points;
  assert.equal(point.time, 6.451);
  assert.equal(point.curve.time, 6.451);
  assert.equal(point.curve.source, 'preset');
  assert.equal(point.curve.fallback, null);
  assert.deepEqual(point.curve.frameSize, SOURCE_SIZE);
  assert.equal(point.curve.definition.equationId, 'fixture.parabola');
  assert.deepEqual(
    Object.fromEntries(Object.entries(point.curve.definition.parameters).map(([name, item]) => [name, item.initial])),
    { a: 1, h: 0, k: 1 }
  );

  const again = pageRules.validateLessonReading(payload, SOURCE_SIZE);
  assert.equal(again.ok, true);
  assert.equal(again.points.length, 1);
  assert.deepEqual(again.dropped, []);
});

test('发给模型的是 OpenAI 兼容格式：带图、带密钥头，温度为 0', async () => {
  const model = fakeModel(() => parabolaAnswer());
  await read(lessonRequest(), model);
  assert.equal(model.calls.length, 1);
  const [call] = model.calls;
  assert.equal(call.url, 'https://model.example/v1/chat/completions');
  assert.equal(call.init.headers.authorization, 'Bearer test-key-not-real');
  assert.equal(call.body.model, 'vision-test');
  assert.equal(call.body.temperature, 0);
  assert.equal(call.body.response_format, undefined);
  const parts = call.body.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, FRAME_DATA_URL);
  assert.match(parts[0].text, /宽 640 像素、高 402 像素/);
  assert.match(parts[0].text, /顶点式二次函数的图象/);
  assert.match(call.body.messages[0].content, /先化成顶点式/);
  assert.match(call.body.messages[0].content, /没有抛物线图象/);

  const json = fakeModel(() => parabolaAnswer());
  await read(lessonRequest(), json, { jsonMode: true });
  assert.deepEqual(json.calls[0].body.response_format, { type: 'json_object' });
});

test('响应和日志里没有画面、课程正文和密钥', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const { payload, logs } = await read(lessonRequest({ courseText: '这段正文只给模型看' }), model);
  const exposed = JSON.stringify(payload) + JSON.stringify(logs);
  assert.doesNotMatch(exposed, /data:image/);
  assert.doesNotMatch(exposed, /这段正文只给模型看/);
  assert.doesNotMatch(exposed, /test-key-not-real/);
  assert.deepEqual(Object.keys(logs.at(-1)).sort(), ['event', 'frames', 'model', 'ms', 'points', 'readingId', 'reasons']);
  assert.equal(logs.at(-1).model, 'vision-test');
});

test('点按时间排好，最早的在前；同一句讲解补上秒数', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const body = lessonRequest({
    frames: [
      { time: 6.451, image: FRAME_DATA_URL },
      { time: 5.278, image: FRAME_DATA_URL }
    ]
  });
  const { payload } = await read(body, model);
  assert.deepEqual(payload.points.map((point) => point.time), [5.278, 6.451]);
  const lines = payload.points.map((point) => point.lessonLine);
  assert.equal(new Set(lines).size, 2);
  assert.match(lines[1], /（第 6\.5 秒）$/);
  assert.deepEqual(payload.points.map((point) => point.id), ['p1', 'p2']);
});

test('相隔不到 1 秒的两帧只留较早的一处', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const body = lessonRequest({
    frames: [
      { time: 6.0, image: FRAME_DATA_URL },
      { time: 6.451, image: FRAME_DATA_URL }
    ]
  });
  const { payload } = await read(body, model);
  assert.deepEqual(payload.points.map((point) => point.time), [6]);
  assert.ok(payload.dropped.some((item) => item.reason === '和上一个点靠得太近'));
});

test('模型说没有抛物线时回空点，由页面保留用户视频并提示没有结果', async () => {
  const model = fakeModel(() => ({ hasParabola: false }));
  const { status, payload } = await read(lessonRequest(), model);
  assert.equal(status, 200);
  assert.deepEqual(payload.points, []);
  assert.deepEqual(payload.dropped, [{ reason: 'no_parabola' }]);
});

test('方程读对但像素锚点出了画面时，改在图上找这条曲线', async () => {
  const answer = parabolaAnswer({
    anchors: [
      { x: 0, y: 1, px: 200, py: 680 },
      { x: 1, y: 2, px: 240, py: 640 },
      { x: -1, y: 2, px: 160, py: 640 }
    ]
  });
  const { status, payload } = await read(lessonRequest(), fakeModel(() => answer));
  assert.equal(status, 200);
  assert.equal(payload.points.length, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(payload.points[0].curve.definition.parameters).map(([name, item]) => [name, item.initial])),
    { a: 1, h: 0, k: 1 }
  );
});

test('锚点对不上、方程无效或回答读不懂的帧都丢掉', async () => {
  const anchors = parabolaAnswer().anchors;
  anchors[2] = { ...anchors[2], py: anchors[2].py - 40 };
  const cases = [
    [parabolaAnswer({ equation: { a: 1, h: 8, k: 40 }, anchors }), 'anchors_disagree'],
    [parabolaAnswer({ equation: { a: 0, h: 0, k: 1 } }), 'equation_invalid'],
    [parabolaAnswer({ equation: { a: '一', h: 0, k: 1 } }), 'equation_invalid'],
    ['抱歉，我看不清这张图。', 'answer_unreadable']
  ];
  for (const [answer, reason] of cases) {
    const { status, payload } = await read(lessonRequest(), fakeModel(() => answer));
    assert.equal(status, 200);
    assert.deepEqual(payload.points, [], reason);
    assert.deepEqual(payload.dropped, [{ reason }]);
  }
});

test('源尺寸为 null 时不猜尺寸，也不去问模型', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const { status, payload } = await read(lessonRequest({ frameSize: null }), model);
  assert.equal(status, 200);
  assert.deepEqual(payload.points, []);
  assert.equal(model.calls.length, 0);
});

test('模型数值只接受 JSON number，不把布尔值、null 或数字字符串转成方程', async () => {
  for (const name of ['a', 'h', 'k']) {
    for (const value of [true, false, null, '1', '0.0001']) {
      const answer = parabolaAnswer({ equation: { a: 1, h: 0, k: 1, [name]: value } });
      const { status, payload } = await read(lessonRequest(), fakeModel(() => answer));
      assert.equal(status, 200);
      assert.deepEqual(payload.points, [], `${name}=${JSON.stringify(value)}`);
      assert.deepEqual(payload.dropped, [{ reason: 'equation_invalid' }]);
    }
  }
});

test('曲线横坐标两端不接受数字字符串、布尔值或 null', async () => {
  for (const name of ['curveXMin', 'curveXMax']) {
    for (const value of ['-2.5', '2.5', true, null]) {
      // 这条方程不在夹具画面上，强制验证锚点保底路径使用的模型端点。
      const { payload } = await read(lessonRequest(), fakeModel(() => parabolaAnswer({ equation: { a: 1, h: 8, k: 40 }, [name]: value })));
      assert.deepEqual(payload.points, []);
      assert.deepEqual(payload.dropped, [{ reason: 'curve_extent' }]);
    }
  }
});

test('小系数从模型到页面曲线完整保留，不被舍入成直线', async () => {
  const params = { a: 0.0001, h: 0.00012345, k: 1 };
  const { payload } = await read(lessonRequest(), fakeModel(() => parabolaAnswer({ equation: params, lessonLine: '' })));
  assert.equal(payload.points.length, 1);
  assert.deepEqual(payload.dropped, []);
  const point = payload.points[0];
  for (const name of ['a', 'h', 'k']) assert.equal(point.curve.definition.parameters[name].initial, params[name]);
  assert.ok(Math.abs(point.curve.definition.parameters.a.step - 0.00001) < 1e-18);
  assert.match(point.lessonLine, /0\.0001\(/);
  assert.equal(pageRules.validateLessonReading(payload, SOURCE_SIZE).points.length, 1);
});

test('截帧比例和源尺寸对不上时丢掉这一帧', async () => {
  const model = fakeModel(() => parabolaAnswer());
  const { payload } = await read(lessonRequest({ frameSize: { width: 1920, height: 1080 } }), model);
  assert.deepEqual(payload.points, []);
  assert.deepEqual(payload.dropped, [{ reason: 'size_mismatch' }]);
  assert.equal(model.calls.length, 0);
});

test('没配模型时回 503，不发请求', async () => {
  for (const missing of [{ apiKey: '' }, { model: '' }, { baseUrl: '' }]) {
    const model = fakeModel(() => parabolaAnswer());
    const { status } = await read(lessonRequest(), model, missing);
    assert.equal(status, 503);
    assert.equal(model.calls.length, 0);
  }
});

test('每一帧都连不上模型时回 502；部分帧读完时照常回 200', async () => {
  const offline = await read(lessonRequest(), fakeModel(() => new TypeError('fetch failed')));
  assert.equal(offline.status, 502);

  const refusedModel = fakeModel(() => ({ status: 401 }));
  const refused = await read(lessonRequest(), refusedModel);
  assert.equal(refused.status, 502);
  assert.equal(refusedModel.calls.length, 1);

  const body = lessonRequest({
    frames: [
      { time: 2.0, image: FRAME_DATA_URL },
      { time: 6.451, image: FRAME_DATA_URL }
    ]
  });
  const mixed = await read(body, fakeModel((time) => (time < 3 ? new TypeError('fetch failed') : parabolaAnswer())));
  assert.equal(mixed.status, 200);
  assert.deepEqual(mixed.payload.points.map((point) => point.time), [6.451]);
  assert.ok(mixed.payload.dropped.some((item) => item.reason === 'model_unreachable'));
});

test('模型限流时在同一次请求里再试，第二次成功就返回点', async () => {
  let attempts = 0;
  const model = fakeModel(() => {
    attempts += 1;
    return attempts === 1 ? { status: 429 } : parabolaAnswer();
  });
  const { status, payload } = await read(lessonRequest(), model, { retryDelaysMs: [0] });
  assert.equal(status, 200);
  assert.equal(payload.points.length, 1);
  assert.equal(model.calls.length, 2);
});

test('连续限流只再试两次，耗尽后仍回 502', async () => {
  const model = fakeModel(() => ({ status: 429 }));
  const { status, payload } = await read(lessonRequest(), model, { retryDelaysMs: [0, 0] });
  assert.equal(status, 502);
  assert.equal(payload.error, '模型没有回应。');
  assert.equal(model.calls.length, 3);
});

test('限流等待期间取消就不再请求模型', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await askModel({
    settings: settings({ retryDelaysMs: [5000] }),
    dataUrl: 'data:image/jpeg;base64,/9j/aaaa',
    image: { width: 2, height: 2 },
    time: 1,
    courseText: '',
    signal: controller.signal,
    fetchImpl: async () => {
      calls += 1;
      controller.abort();
      return { ok: false, status: 429 };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'model_timeout');
  assert.equal(calls, 1);
});

test('模型池限流后立刻换下一个，不再空等同一个模型', async () => {
  const calls = [];
  const result = await askModel({
    settings: settings({
      modelCursor: { next: 0 },
      models: [
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4.6v-flash', jsonMode: false },
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4v-flash', jsonMode: false },
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4.1v-thinking-flash', jsonMode: false }
      ]
    }),
    dataUrl: 'data:image/jpeg;base64,/9j/aaaa',
    image: { width: 2, height: 2 },
    time: 1,
    courseText: '',
    signal: AbortSignal.timeout(5000),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.model);
      if (body.model === 'glm-4.6v-flash') {
        assert.deepEqual(body.thinking, { type: 'disabled' });
        return { ok: false, status: 429 };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ hasParabola: false }) } }] })
      };
    }
  });
  assert.deepEqual(calls, ['glm-4.6v-flash', 'glm-4v-flash']);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'glm-4v-flash');
  assert.equal(result.answer.hasParabola, false);
});

test('下一次阅读从池里的下一个模型开始', async () => {
  const cursor = { next: 0 };
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(JSON.parse(init.body).model);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"hasParabola":false}' } }] })
    };
  };
  const base = settings({
    modelCursor: cursor,
    models: [
      { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4.6v-flash', jsonMode: false },
      { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4v-flash', jsonMode: false }
    ]
  });
  const input = {
    dataUrl: 'data:image/jpeg;base64,/9j/aaaa',
    image: { width: 2, height: 2 },
    time: 1,
    courseText: '',
    signal: AbortSignal.timeout(5000),
    fetchImpl
  };
  await askModel({ settings: base, ...input });
  await askModel({ settings: base, ...input });
  assert.deepEqual(seen, ['glm-4.6v-flash', 'glm-4v-flash']);
});

test('模型明确说没有抛物线时不改问下一个', async () => {
  let calls = 0;
  const result = await askModel({
    settings: settings({
      modelCursor: { next: 0 },
      models: [
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4v-flash', jsonMode: false },
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4.6v-flash', jsonMode: false }
      ]
    }),
    dataUrl: 'data:image/jpeg;base64,/9j/aaaa',
    image: { width: 2, height: 2 },
    time: 1,
    courseText: '',
    signal: AbortSignal.timeout(5000),
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"hasParabola":false}' } }] })
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test('取消发生在第一个模型上时不再问后面的模型', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await askModel({
    settings: settings({
      modelCursor: { next: 0 },
      models: [
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4.6v-flash', jsonMode: false },
        { baseUrl: 'https://model.example/v1', apiKey: 'test-key-not-real', model: 'glm-4v-flash', jsonMode: false }
      ]
    }),
    dataUrl: 'data:image/jpeg;base64,/9j/aaaa',
    image: { width: 2, height: 2 },
    time: 1,
    courseText: '',
    signal: controller.signal,
    fetchImpl: async () => {
      calls += 1;
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  });
  assert.equal(result.reason, 'model_timeout');
  assert.equal(calls, 1);
});

test('单帧超时按时限放弃，不重试', async () => {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(url);
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  };
  // AbortSignal.timeout 的计时器不占住进程；真服务有监听端口撑着，测试里要自己撑。
  const keepAlive = setInterval(() => {}, 1000);
  const result = await readLesson(lessonRequest(), {
    settings: settings({ timeoutMs: 30 }),
    pageRules,
    fetchImpl
  }).finally(() => clearInterval(keepAlive));
  assert.equal(result.status, 502);
  assert.equal(calls.length, 1);
});

test('请求形状不对时回 400', async () => {
  const bad = [
    lessonRequest({ readingId: '' }),
    lessonRequest({ videoId: 'fixture-parabola' }),
    lessonRequest({ duration: 0 }),
    lessonRequest({ frames: [] }),
    lessonRequest({ frames: Array.from({ length: 9 }, (_, index) => ({ time: index, image: FRAME_DATA_URL })) }),
    lessonRequest({ frames: [{ time: 20, image: FRAME_DATA_URL }] }),
    null
  ];
  for (const body of bad) {
    const { status } = await read(body, fakeModel(() => parabolaAnswer()));
    assert.equal(status, 400);
  }
  assert.equal(checkRequest(lessonRequest({ frameSize: { width: 0, height: 10 } })).request.frameSize, null);
});

test('主动取消传播到模型，且不会领取下一帧', { timeout: 2000 }, async () => {
  const cancelled = new AbortController();
  const calls = [];
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const result = readLesson(lessonRequest({ frames: [
    { time: 2, image: FRAME_DATA_URL },
    { time: 6.451, image: FRAME_DATA_URL }
  ] }), {
    settings: settings({ concurrency: 1 }), pageRules, signal: cancelled.signal,
    fetchImpl: (url, init) => {
      calls.push(init);
      entered();
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    }
  });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await started;
  cancelled.abort(new DOMException('页面取消', 'AbortError'));
  await rejected;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});

test('已经取消的请求不发模型请求', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const model = fakeModel(() => parabolaAnswer());
  await assert.rejects(readLesson(lessonRequest(), {
    settings: settings(), pageRules, fetchImpl: model.fetchImpl, signal: cancelled.signal
  }), { name: 'AbortError' });
  assert.equal(model.calls.length, 0);
});

test('回答外面包了代码块或多了几句话也能取出 JSON', () => {
  assert.deepEqual(parseAnswer('```json\n{"hasParabola": false}\n```'), { hasParabola: false });
  assert.deepEqual(parseAnswer('结果如下：{"hasParabola": true, "equation": {"a": 1}} 以上。'), {
    hasParabola: true,
    equation: { a: 1 }
  });
  assert.deepEqual(parseAnswer([{ type: 'text', text: '{"hasParabola": false}' }]), { hasParabola: false });
  assert.equal(parseAnswer('[1, 2]'), null);
  assert.equal(parseAnswer(null), null);
  assert.deepEqual(
    parseAnswer('<think>{"a":9}</think>\n{"hasParabola":false}'),
    { hasParabola: false }
  );
});
