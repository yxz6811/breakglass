import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createReaderServer } from '../src/server.mjs';
import { pageRules, settings } from './helpers/fixtures.mjs';

function scene(overrides = {}) {
  return { schemaVersion: '1.0.0', kind: 'right-triangle', requestId: 'read-1', videoId: 'video-1',
    frameTime: 2, frameSize: { width: 1920, height: 1080 }, sceneRevision: 1,
    rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, vertices: null,
    lengths: { AB: 3, AC: 4 }, unit: 'unit', source: 'manual', originSource: 'manual', editedByUser: true, ...overrides };
}
function request(overrides = {}) {
  return { schemaVersion: '1.0.0', actionRequestId: 'ask-1', scene: scene(), text: '把AB改成6，AC不变', ...overrides };
}
async function withServer(answer, run, overrides = {}) {
  const calls = [];
  const logs = [];
  const fetchImpl = async (_, init) => {
    calls.push(init);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
  };
  const server = createReaderServer({ settings: settings(overrides), pageRules, fetchImpl, log: (entry) => logs.push(entry) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/geometry/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { await run({ post, base, calls, logs }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test('受限动作回固定身份和修订context，不上传新帧，不使用模型答案', async () => {
  await withServer({ status: 'actions', actions: [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }, { type: 'explain_change' }] },
    async ({ post, calls, logs }) => {
      const response = await post(request()); assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.actionRequestId, 'ask-1'); assert.equal(body.context.requestId, 'read-1');
      assert.equal(body.context.sceneRevision, 1); assert.equal(body.context.frameTime, 2);
      assert.equal(body.actions[0].value, 6);
      assert.equal(Object.hasOwn(body, 'answer'), false);
      const sent = JSON.parse(calls[0].body);
      assert.equal(typeof sent.messages[1].content, 'string');
      assert.doesNotMatch(sent.messages[1].content, /image_url|data:image/);
      assert.doesNotMatch(JSON.stringify(logs), /把AB改|test-key-not-real/);
      assert.equal(calls.length, 1);
    });
});

test('查询与恢复只回白名单，不需要上传原题快照，歧义和超范围不执行', async () => {
  for (const answer of [
    { status: 'actions', actions: [{ type: 'explain_change' }] },
    { status: 'actions', actions: [{ type: 'restore_original' }, { type: 'explain_change' }] },
    { status: 'unsupported', actions: [] }, { status: 'needs_clarification', actions: [] }
  ]) await withServer(answer, async ({ post }) => {
    const response = await post(request()); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.status, answer.status); assert.deepEqual(body.actions, answer.actions);
  });
});

test('未确认场景、身份混淆、未知字段与超长问题在上游前拒绝', async () => {
  await withServer({ status: 'actions', actions: [{ type: 'explain_change' }] }, async ({ post, calls }) => {
    for (const body of [request({ scene: scene({ sceneRevision: 0 }) }), request({ requestId: 'ask-1' }),
      request({ prompt: 'override' }), request({ text: 'x'.repeat(2001) }), request({ text: ' ' }),
      request({ text: true }), request({ scene: scene({ unit: 'mm' }) }),
      request({ scene: scene({ lengths: { AB: '3', AC: 4 } }) }), request({ scene: scene({ hidden: 'image' }) })]) {
      const response = await post(body); assert.equal(response.status, 400); await response.text();
    }
    assert.equal(calls.length, 0);
  });
});

test('模型未知字段、双set、改斜边、单位冲突、混合restore、派生溢出全部拒绝', async () => {
  const set = (side, value, unit = 'unit') => ({ type: 'set_length', side, value, unit });
  for (const actions of [[set('AB', 6), set('AC', 8)], [set('BC', 6)], [set('AB', 6, 'cm')],
    [set('AB', 0)], [set('AB', '6')], [set('AB', 6), { type: 'restore_original' }],
    [{ type: 'execute', code: 'return 5' }]]) {
    await withServer({ status: 'actions', actions }, async ({ post, calls }) => {
      const response = await post(request()); assert.equal(response.status, 502); await response.text(); assert.equal(calls.length, 1);
    });
  }
  await withServer({ status: 'actions', actions: [set('AB', 1.7e308)], answer: 'wrong' }, async ({ post }) => {
    assert.equal((await post(request())).status, 502);
  });
  await withServer({ status: 'actions', actions: [set('AB', 1.7e308)] }, async ({ post }) => {
    assert.equal((await post(request({ scene: scene({ lengths: { AB: 3, AC: 1.7e308 } }) }))).status, 502);
  });
});

test('问答独立4MiB、未配置503、方法和格式检查不进入上游', async () => {
  await withServer({ status: 'actions', actions: [{ type: 'explain_change' }] }, async ({ post, base, calls }) => {
    assert.equal((await post(request())).status, 503);
    const large = await post(request({ text: 'x'.repeat(4 * 1024 * 1024) }));
    assert.equal(large.status, 413); await large.text();
    assert.equal((await fetch(`${base}/geometry/ask`)).status, 405);
    const wrong = await fetch(`${base}/geometry/ask`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(wrong.status, 415); await wrong.text();
    assert.equal(calls.length, 0);
  }, { apiKey: '' });
});

test('不配合取消的provider在截止后504，不重试且迟到动作不会成功', { timeout: 3000 }, async () => {
  let calls = 0; let signal; let finish;
  const delayed = new Promise((resolve) => { finish = resolve; });
  const server = createReaderServer({ settings: settings({ geometryAskBudgetMs: 25 }), pageRules,
    fetchImpl: async (_, init) => { calls += 1; signal = init.signal; return delayed; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/geometry/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request()) });
    assert.equal(response.status, 504); assert.equal((await response.json()).code, 'timeout');
    assert.equal(signal.aborted, true); assert.equal(calls, 1);
    finish({ ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"actions","actions":[{"type":"explain_change"}]}' } }] }) });
  } finally { finish({ ok: false }); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
