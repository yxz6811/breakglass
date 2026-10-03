import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createReaderServer } from '../src/server.mjs';
import { loadSettings } from '../src/settings.mjs';
import { FRAME_DATA_URL, fakeModel, lessonRequest, pageRules, parabolaAnswer, settings } from './helpers/fixtures.mjs';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/**
 * 在随机端口起一个服务，测完关掉。
 *
 * @param {(base: string, server: import('node:http').Server) => Promise<void>} run
 * @param {object} [overrides]
 */
async function withServer(run, overrides = {}) {
  const model = fakeModel(() => parabolaAnswer());
  const server = createReaderServer({ settings: settings(overrides), pageRules, fetchImpl: model.fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, server);
  } finally {
    server.close();
  }
}

test('健康检查只说有没有配模型，不带密钥', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(text), { ok: true, modelConfigured: true });
    assert.doesNotMatch(text, /test-key-not-real/);
  });
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    assert.deepEqual(await response.json(), { ok: true, modelConfigured: false });
  }, { apiKey: '' });
});

test('扩展页预检通过，并允许从公网页面访问本机地址', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/read`, {
      method: 'OPTIONS',
      headers: {
        origin: EXTENSION_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
        'access-control-request-private-network': 'true'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
  });
});

test('名单外的来源被拒，也拿不到跨域头', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/read`, {
      method: 'OPTIONS',
      headers: { origin: 'https://elsewhere.example', 'access-control-request-method': 'POST' }
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('扩展页发来的阅读请求拿到点和跨域头', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/read`, {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(lessonRequest())
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN);
    const payload = await response.json();
    assert.equal(payload.origin, 'external');
    assert.equal(payload.points.length, 1);
  });
});

test('格式、地址、方法、大小不对时各回各的状态', async () => {
  await withServer(async (base) => {
    const plain = await fetch(`${base}/read`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(plain.status, 415);
    const broken = await fetch(`${base}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(broken.status, 400);
    const missing = await fetch(`${base}/elsewhere`);
    assert.equal(missing.status, 404);
    const wrongMethod = await fetch(`${base}/read`);
    assert.equal(wrongMethod.status, 405);
    const huge = await fetch(`${base}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(11 * 1024 * 1024) })
    }).catch((error) => error);
    if (!(huge instanceof Error)) assert.equal(huge.status, 413);
  });
});

test('配置：默认只听本机，总预算压在页面 300 秒截止之前，来源名单可以收紧', () => {
  const defaults = loadSettings({});
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.port, 8787);
  assert.equal(defaults.budgetMs, 240000);
  assert.equal(defaults.allowOrigin(EXTENSION_ORIGIN), true);
  assert.equal(defaults.allowOrigin('http://127.0.0.1:8765'), true);
  assert.equal(defaults.allowOrigin('https://127.0.0.1'), false);
  assert.equal(defaults.allowOrigin('chrome-extension://short'), false);

  const tight = loadSettings({
    READER_BUDGET_MS: '900000',
    READER_ALLOW_ORIGINS: `${EXTENSION_ORIGIN}, http://127.0.0.1:8768`,
    READER_BASE_URL: 'https://model.example/v1/',
    READER_CONCURRENCY: '99'
  });
  assert.equal(tight.budgetMs, 280000);
  assert.equal(tight.baseUrl, 'https://model.example/v1');
  assert.equal(tight.concurrency, 8);
  assert.equal(tight.allowOrigin(EXTENSION_ORIGIN), true);
  assert.equal(tight.allowOrigin('chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba'), false);
  assert.equal(tight.allowOrigin('http://127.0.0.1:8768'), true);
});

test('客户端断开会取消模型，迟到的响应不会开始下一帧或写入断开的连接', { timeout: 3000 }, async () => {
  const calls = [];
  const logs = [];
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let finishModel;
  const lateReply = new Promise((resolve) => { finishModel = resolve; });
  let finished;
  const cancelled = new Promise((resolve) => { finished = resolve; });
  const server = createReaderServer({
    settings: settings({ concurrency: 1 }), pageRules,
    fetchImpl: async (url, init) => {
      calls.push(init);
      entered();
      // 故意模拟不配合取消的模型；迟到结果仍不能继续队列。
      return lateReply;
    },
    log: (entry) => {
      logs.push(entry);
      if (entry.event === 'cancelled') finished();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = http.request(`${base}/read`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  let responses = 0;
  client.on('response', () => { responses += 1; });
  client.on('error', () => {});
  try {
    client.end(JSON.stringify(lessonRequest({ frames: [
      { time: 2, image: FRAME_DATA_URL }, { time: 6.451, image: FRAME_DATA_URL }
    ] })));
    await started;
    const upstreamAborted = once(calls[0].signal, 'abort');
    client.destroy();
    await upstreamAborted;
    assert.equal(calls[0].signal.aborted, true);
    finishModel({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parabolaAnswer()) } }] }) });
    await cancelled;
    assert.equal(calls.length, 1);
    assert.equal(responses, 0);
    assert.equal(logs.some((entry) => entry.event === 'read' || entry.event === 'crashed'), false);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    await health.text();
  } finally {
    client.destroy();
    finishModel({ ok: false, status: 503 });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('请求体上传期间断开也会结束读取，服务仍可接受下一次请求', { timeout: 3000 }, async () => {
  await withServer(async (base, server) => {
    const incoming = once(server, 'request');
    const client = http.request(`${base}/read`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    client.on('error', () => {});
    client.write('{"readingId":');
    const [request] = await incoming;
    const disconnected = once(request, 'aborted');
    client.destroy();
    await disconnected;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    await health.text();
  });
});
