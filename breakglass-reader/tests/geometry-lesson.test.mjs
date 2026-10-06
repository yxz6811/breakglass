import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createReaderServer } from '../src/server.mjs';
import { FRAME_DATA_URL, SOURCE_SIZE, pageRules, settings } from './helpers/fixtures.mjs';

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function lessonBody(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    duration: 9,
    frameSize: { ...SOURCE_SIZE },
    frames: [{ time: 1, image: FRAME_DATA_URL }],
    ...overrides
  };
}

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function triangleAnswer(overrides = {}) {
  return {
    supported: true,
    kind: 'right-triangle',
    rightAngleAt: 'A',
    unit: 'cm',
    legs: [
      { id: 'AB', from: 'A', to: 'B', length: 3 },
      { id: 'AC', from: 'A', to: 'C', length: 4 }
    ],
    vertices: {
      A: { x: 100, y: 100 },
      B: { x: 100, y: 200 },
      C: { x: 300, y: 100 }
    },
    ...overrides
  };
}

/**
 * @param {object | ((call: object) => object)} answer
 * @param {(ctx: object) => Promise<void>} run
 * @param {object} [overrides]
 */
async function withServers(answer, run, overrides = {}) {
  const calls = [];
  const provider = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const parsed = JSON.parse(text);
    calls.push(parsed);
    const payload = typeof answer === 'function' ? answer(parsed) : answer;
    const status = overrides.providerStatus || 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const logs = [];
  const reader = createReaderServer({
    settings: settings({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, ...overrides.settings }),
    pageRules,
    log: (entry) => logs.push(entry)
  });
  reader.listen(0, '127.0.0.1');
  await once(reader, 'listening');
  const base = `http://127.0.0.1:${reader.address().port}`;
  const post = (body, route = '/geometry/lesson', raw) => fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw === undefined ? JSON.stringify(body) : raw
  });
  try { await run({ post, base, calls, logs }); }
  finally {
    reader.closeAllConnections();
    provider.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => reader.close(resolve)),
      new Promise((resolve) => provider.close(resolve))
    ]);
  }
}

test('直角三角形把 JPEG 像素映射回源尺寸，斜边由服务计算', async () => {
  await withServers(triangleAnswer(), async ({ post, calls, logs }) => {
    const response = await post(lessonBody());
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.origin, 'external');
    assert.equal(value.readingId, 'reading-1');
    assert.equal(value.videoId, 'local-binding-1');
    assert.equal(value.duration, 9);
    assert.equal(value.points.length, 1);
    assert.equal(value.points[0].placement.vertices.C.x, 300 * SOURCE_SIZE.width / 640);
    assert.equal(value.points[0].placement.vertices.C.y, 100 * SOURCE_SIZE.height / 402);
    assert.equal(value.points[0].derived.hypotenuse.length, 5);
    assert.equal(value.points[0].derived.hypotenuse.length, Math.hypot(3, 4));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages[1].content.filter((part) => part.type === 'image_url').length, 1);
    const logText = JSON.stringify(logs);
    assert.doesNotMatch(logText, /data:image|test-key-not-real/);
  });
});

test('不支持、含糊和模型自报斜边都不会变成成功点', async () => {
  await withServers({ supported: false }, async ({ post }) => {
    const response = await post(lessonBody());
    const value = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(value.points, []);
    assert.equal(value.dropped[0].reason, 'unsupported');
  });
  await withServers({ supported: false, reason: 'ambiguous' }, async ({ post }) => {
    const value = await (await post(lessonBody())).json();
    assert.equal(value.dropped[0].reason, 'ambiguous');
    assert.deepEqual(value.points, []);
  });
  await withServers(triangleAnswer({ hypotenuse: 5 }), async ({ post }) => {
    const value = await (await post(lessonBody())).json();
    assert.equal(value.points.length, 0);
    assert.equal(value.dropped[0].reason, 'incomplete');
  });
});

test('圆和线段也不接收模型派生量', async () => {
  await withServers({
    supported: true,
    kind: 'circle',
    unit: 'cm',
    center: { label: 'O', x: 80, y: 90 },
    radius: 5
  }, async ({ post }) => {
    const value = await (await post(lessonBody())).json();
    assert.equal(value.points[0].kind, 'circle');
    assert.equal(value.points[0].given.radius, 5);
    assert.equal(value.points[0].placement.center.x, 80 * SOURCE_SIZE.width / 640);
    assert.deepEqual(value.points[0].derived, {});
  });
  await withServers({
    supported: true,
    kind: 'segment',
    unit: 'm',
    start: { label: 'P', x: 10, y: 20 },
    end: { label: 'Q', x: 40, y: 80 },
    length: 6
  }, async ({ post }) => {
    const value = await (await post(lessonBody())).json();
    assert.equal(value.points[0].kind, 'segment');
    assert.equal(value.points[0].given.length, 6);
    assert.deepEqual(value.points[0].derived, {});
  });
});

test('未知字段、夹具视频、超长说明和过近采样在调用模型前拒绝', async () => {
  await withServers(triangleAnswer(), async ({ post, calls }) => {
    for (const body of [
      lessonBody({ model: 'hidden' }),
      lessonBody({ videoId: 'fixture-parabola' }),
      lessonBody({ courseText: '字'.repeat(8001) }),
      lessonBody({ frames: [{ time: 1, image: FRAME_DATA_URL }, { time: 1.2, image: FRAME_DATA_URL }] })
    ]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      await response.text();
    }
    assert.equal(calls.length, 0);
  });
});

test('未配置模型 503，整段连不上 502，几何阅读用 10MiB 且不改旧路由', async () => {
  await withServers(triangleAnswer(), async ({ post, calls }) => {
    const response = await post(lessonBody());
    assert.equal(response.status, 503);
    await response.text();
    assert.equal(calls.length, 0);
  }, { settings: { apiKey: '' } });

  await withServers(triangleAnswer(), async ({ post, calls }) => {
    const response = await post(lessonBody());
    assert.equal(response.status, 502);
    await response.text();
    assert.equal(calls.length, 1);
  }, { providerStatus: 500 });

  await withServers(triangleAnswer(), async ({ post, base, calls }) => {
    const oversized = 'x'.repeat(4 * 1024 * 1024 + 1);
    const geometry = await post(null, '/geometry/read', oversized);
    assert.equal(geometry.status, 413);
    await geometry.text();
    const lesson = await post(null, '/geometry/lesson', oversized);
    assert.equal(lesson.status, 400);
    await lesson.text();
    const missing = await fetch(`${base}/geometry/other`);
    assert.equal(missing.status, 404);
    await missing.text();
    const legacy = await post({}, '/read');
    assert.notEqual(legacy.status, 404);
    await legacy.text();
    assert.equal(calls.length, 0);
  });
});
