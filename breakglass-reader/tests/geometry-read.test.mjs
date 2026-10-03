import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createReaderServer } from '../src/server.mjs';
import { loadSettings } from '../src/settings.mjs';
import { FRAME_DATA_URL, SOURCE_SIZE, pageRules, settings, lessonRequest, parabolaAnswer } from './helpers/fixtures.mjs';

function request(overrides = {}) {
  return { schemaVersion: '1.0.0', requestId: 'geometry-r1', videoId: 'video-1',
    frameTime: 2, frameSize: { ...SOURCE_SIZE }, image: FRAME_DATA_URL, ...overrides };
}

function candidate(overrides = {}) {
  return { supported: true, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' },
    vertices: { A: { x: 100, y: 100 }, B: { x: 100, y: 200 }, C: { x: 300, y: 100 } },
    lengths: { AB: 3, AC: 4 }, unit: 'unit', ...overrides };
}

async function withServers(answer, run, overrides = {}) {
  const calls = [];
  const provider = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    calls.push(JSON.parse(text));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const logs = [];
  const reader = createReaderServer({ settings: settings({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, ...overrides }), pageRules,
    log: (entry) => logs.push(entry) });
  reader.listen(0, '127.0.0.1');
  await once(reader, 'listening');
  const base = `http://127.0.0.1:${reader.address().port}`;
  const post = (body, route = '/geometry/read') => fetch(`${base}${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { await run({ post, base, calls, logs }); }
  finally {
    reader.closeAllConnections(); provider.closeAllConnections();
    await Promise.all([new Promise((resolve) => reader.close(resolve)), new Promise((resolve) => provider.close(resolve))]);
  }
}

test('真实HTTP替身管线：只发一张JPEG，坐标映射回源尺寸并保持服务身份', async () => {
  await withServers(candidate(), async ({ post, calls, logs }) => {
    const response = await post(request());
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.status, 'candidate');
    assert.equal(value.scene.sceneRevision, 0);
    assert.equal(value.scene.requestId, 'geometry-r1');
    assert.equal(value.scene.videoId, 'video-1');
    assert.equal(value.scene.source, 'vision');
    assert.equal(value.scene.originSource, 'vision');
    assert.equal(value.scene.editedByUser, false);
    assert.equal(value.scene.vertices.C.x, 300 * SOURCE_SIZE.width / 640);
    assert.equal(value.scene.vertices.C.y, 100 * SOURCE_SIZE.height / 402);
    assert.equal(Object.hasOwn(value.scene.lengths, 'BC'), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages[1].content.filter((part) => part.type === 'image_url').length, 1);
    const logText = JSON.stringify(logs);
    assert.doesNotMatch(logText, /data:image|test-key-not-real|supported|lengths/);
  });
});

test('无适用图与不清楚条件诚实返回，未知模型字段或BC不能伪造candidate', async () => {
  for (const [answer, status, responseStatus] of [
    [{ supported: false }, 'unsupported', 200],
    [{ supported: true, needsReview: true }, 'needs_review', 200],
    [candidate({ source: 'preset' }), undefined, 502],
    [candidate({ lengths: { AB: 3, AC: 4, BC: 5 } }), undefined, 502],
    [candidate({ lengths: { AB: '3', AC: 4 } }), undefined, 502],
    [candidate({ vertices: { A: { x: 100, y: 100 }, B: { x: 800, y: 100 }, C: { x: 100, y: 200 } } }), undefined, 502]
  ]) {
    await withServers(answer, async ({ post, calls }) => {
      const response = await post(request());
      assert.equal(response.status, responseStatus);
      const value = await response.json();
      assert.equal(value.status, status);
      if (responseStatus === 200) assert.equal(value.scene, null);
      assert.equal(calls.length, 1);
    });
  }
});

test('严格几何字段/数值/JPEG画幅校验在模型调用前发生', async () => {
  await withServers(candidate(), async ({ post, calls }) => {
    for (const body of [request({ prompt: 'override' }), request({ frameTime: '2' }),
      request({ frameTime: null }), request({ frameTime: -1 }), request({ requestId: '' }),
      request({ schemaVersion: '2.0.0' }), request({ frameSize: { width: 3024, height: 1898, secret: true } }),
      request({ frameSize: { width: 3024, height: 1080 } }), request({ image: 'data:image/png;base64,eA==' })]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      await response.text();
    }
    assert.equal(calls.length, 0);
  });
});

test('几何独立4MiB返回413且不调模型，/read仍接受4MiB以上且保持原响应', async () => {
  await withServers(parabolaAnswer(), async ({ post, calls }) => {
    const oversized = await post(request({ image: 'x'.repeat(4 * 1024 * 1024) }));
    assert.equal(oversized.status, 413);
    await oversized.text();
    assert.equal(calls.length, 0);
    const legacy = await post(lessonRequest({ padding: 'x'.repeat(4 * 1024 * 1024) }), '/read');
    assert.equal(legacy.status, 200);
    const payload = await legacy.json();
    assert.equal(payload.origin, 'external');
    assert.ok(Array.isArray(payload.points));
    assert.equal(calls.length, 1);
  });
});

test('未配模型503、未知地址404、来源403、几何PNA预检与旧路由一致', async () => {
  await withServers(candidate(), async ({ post, base, calls }) => {
    assert.equal((await post(request())).status, 503);
    assert.equal((await fetch(`${base}/geometry/other`)).status, 404);
    const blocked = await fetch(`${base}/geometry/read`, { method: 'OPTIONS', headers: { origin: 'https://untrusted.example' } });
    assert.equal(blocked.status, 403);
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const allowed = await fetch(`${base}/geometry/read`, { method: 'OPTIONS', headers: { origin,
      'access-control-request-private-network': 'true' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
    assert.equal(allowed.headers.get('access-control-allow-private-network'), 'true');
    assert.equal(calls.length, 0);
  }, { apiKey: '' });
});

test('独立预算严格解析，无效值回默认且不改变旧/read预算', () => {
  const configured = loadSettings({ READER_GEOMETRY_READ_BUDGET_MS: '45000', READER_GEOMETRY_ASK_BUDGET_MS: '12000' });
  assert.equal(configured.geometryReadBudgetMs, 45000);
  assert.equal(configured.geometryAskBudgetMs, 12000);
  assert.equal(configured.budgetMs, 240000);
  for (const bad of ['0', '-1', '999', '120001', '1000ms', 'Infinity', '1e4', '']) {
    const value = loadSettings({ READER_GEOMETRY_READ_BUDGET_MS: bad, READER_GEOMETRY_ASK_BUDGET_MS: bad });
    assert.equal(value.geometryReadBudgetMs, 30000);
    assert.equal(value.geometryAskBudgetMs, 10000);
  }
});

test('客户端关闭立即取消，不配合取消的模型不阻塞服务或产出迟到candidate', { timeout: 3000 }, async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let upstream;
  const logs = [];
  const server = createReaderServer({ settings: settings(), pageRules, log: (entry) => logs.push(entry),
    fetchImpl: async (_, init) => { upstream = init.signal; entered(); return new Promise(() => {}); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = http.request(`${base}/geometry/read`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  client.on('error', () => {});
  try {
    client.end(JSON.stringify(request())); await started;
    const cancelled = once(upstream, 'abort'); client.destroy(); await cancelled;
    assert.equal(upstream.aborted, true);
    const health = await fetch(`${base}/health`); assert.equal(health.status, 200); await health.text();
    assert.equal(logs.some((item) => item.event === 'geometry_read'), false);
  } finally { client.destroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
