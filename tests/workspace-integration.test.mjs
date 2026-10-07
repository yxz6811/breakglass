import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWorkspaceIntegrationFixture, createIntegrationClient } from '../scripts/workspace-integration-fixture.mjs';

const require = createRequire(import.meta.url);
const flowEngine = require('../learning-site/learning-flow.js');
const source = { kind: 'manual-notes', id: 'integration-manual-math', version: '1', analysisVersion: '1',
  materialMode: 'self-authored', title: '隔离验收手工数学条件' };
const record = (id = 'integration-triangle') => ({ id, kind: 'pitfall', source: { ...source }, time: 0,
  title: '直角条件练习', note: '测试记录，不关联用户数据。', template: 'right-triangle',
  snapshot: { AB: 3, AC: 4, unit: 'cm' }, origin: 'manual', sourceLabel: '独立测试手工条件',
  createdAt: '2026-10-07T00:00:00.000Z' });
function ok(response, expected = 200) {
  assert.equal(response.status, expected, JSON.stringify(response.value));
  return response.value;
}
async function fixture(run) {
  const server = await createWorkspaceIntegrationFixture();
  try { await run({ ...server, client: () => createIntegrationClient(server.origin) }); }
  finally { await server.close(); }
}
async function learner(client, name = 'integration_learner') {
  const user = client();
  ok(await user.register(name), 201);
  return user;
}
async function save(user, original = record()) {
  ok(await user.send('PUT', '/api/learning/records/' + original.id, { record: original, expectedEpoch: user.epoch }));
  return original;
}
async function purpose(user, original, value = 'practice', revision = 0) {
  return user.send('PUT', '/api/learning/flow/purposes/' + original.id,
    { purpose: value, expectedRevision: revision, expectedEpoch: user.epoch });
}
async function exercise(user, original, extra = {}) {
  return user.send('POST', '/api/learning/flow/exercises', { recordId: original.id,
    kind: 'triangle-hypotenuse', stage: 'practice', index: 1, expectedEpoch: user.epoch, ...extra });
}
const attempt = (user, ex, answer, extra = {}) => user.send('POST',
  `/api/learning/flow/exercises/${ex.id}/attempts`, { answer, expectedEpoch: user.epoch, ...extra });

test('real gateway through front door preserves help across reload, recomputes receipt, and locks one submission', async () => {
  await fixture(async ({ client }) => {
    const user = await learner(client); const original = await save(user);
    assert.equal((await exercise(user, original)).status, 400, 'unclassified records are not practice');
    ok(await purpose(user, original));
    const { exercise: ex } = ok(await exercise(user, original));
    const route = `/api/learning/flow/exercises/${ex.id}/help`;
    ok(await user.send('POST', route, { type: 'hint', level: 2, expectedEpoch: user.epoch }));
    ok(await user.send('POST', route, { type: 'hint', level: 1, expectedEpoch: user.epoch }));
    const reloaded = ok(await user.send('GET', '/api/learning/flow')).flow;
    assert.equal(reloaded.contexts.find(c => c.exerciseId === ex.id).hintsShown, 2);
    const answer = flowEngine.exerciseView(ex, original).answer;
    assert.equal((await attempt(user, ex, answer, { hintUsed: false, correct: true })).status, 400);
    const receipt = ok(await attempt(user, ex, answer)).receipt;
    assert.equal(receipt.correct, true); assert.equal(receipt.hintUsed, true);
    assert.equal(receipt.outcome, 'correct_with_hint');
    assert.equal((await attempt(user, ex, answer)).status, 409);
    assert.equal((await user.send('POST', route, { type: 'answer', expectedEpoch: user.epoch })).status, 409);
    const final = ok(await user.send('GET', '/api/learning/flow')).flow;
    assert.equal(final.receipts.length, 1); assert.equal(final.contexts[0].hintsShown, 2);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/attempts')).attempts, [], 'new exercise receipts stay separate from old attempts');
    assert.deepEqual(ok(await user.send('GET', '/api/learning/records')).records, [original]);
  });
});

test('second account cannot read or mutate first account exercises through the same front door', async () => {
  await fixture(async ({ client }) => {
    const first = await learner(client, 'integration_first'); const original = await save(first);
    ok(await purpose(first, original));
    const { exercise: ex } = ok(await exercise(first, original));
    const second = await learner(client, 'integration_second');
    assert.deepEqual(ok(await second.send('GET', '/api/learning/flow')).flow, flowEngine.emptyFlow());
    assert.deepEqual(ok(await second.send('GET', '/api/learning/records')).records, []);
    assert.equal((await second.send('POST', `/api/learning/flow/exercises/${ex.id}/help`,
      { type: 'answer', expectedEpoch: second.epoch })).status, 404);
    assert.equal((await attempt(second, ex, 5)).status, 404);
    assert.equal((await purpose(second, original)).status, 404);
    assert.equal((await first.send('GET', '/api/learning/flow')).value.flow.receipts.length, 0);
  });
});

test('concurrent purpose revisions have one winner, preserve original math and do not create attempts', async () => {
  await fixture(async ({ client }) => {
    const user = await learner(client); const original = await save(user);
    const results = await Promise.all([purpose(user, original, 'practice'), purpose(user, original, 'reflection')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const initial = ok(await user.send('GET', '/api/learning/flow')).flow;
    assert.equal(initial.purposes.length, 1); assert.equal(initial.purposes[0].revision, 1);
    ok(await user.send('PUT', '/api/learning/flow/reviews/' + original.id, {
      reviewAt: '2026-10-10T00:00:00.000Z', skippedUntil: null, expectedRevision: 0, expectedEpoch: user.epoch }));
    const state = ok(await user.send('GET', '/api/learning/flow')).flow;
    assert.equal(state.reviews.length, 1); assert.equal(state.receipts.length, 0); assert.equal(state.exercises.length, 0);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/records')).records, [original]);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/attempts')).attempts, []);
  });
});

test('record deletion cascades flow sidecars and rejects late exercise/help submissions', async () => {
  await fixture(async ({ client }) => {
    const user = await learner(client); const original = await save(user);
    ok(await purpose(user, original)); const { exercise: ex } = ok(await exercise(user, original));
    ok(await attempt(user, ex, flowEngine.exerciseView(ex, original).answer));
    ok(await user.send('PUT', '/api/learning/flow/reviews/' + original.id, {
      reviewAt: null, skippedUntil: '2026-10-12T00:00:00.000Z', expectedRevision: 0, expectedEpoch: user.epoch }));
    ok(await user.send('DELETE', '/api/learning/records/' + original.id, { expectedEpoch: user.epoch }));
    assert.deepEqual(ok(await user.send('GET', '/api/learning/flow')).flow, flowEngine.emptyFlow());
    assert.equal((await attempt(user, ex, 5)).status, 404);
    assert.equal((await purpose(user, original)).status, 404);
    assert.equal((await exercise(user, original)).status, 404);
  });
});

test('account data deletion increments epoch and prevents old flow writes after same record is resaved', async () => {
  await fixture(async ({ client }) => {
    const user = await learner(client); const original = await save(user);
    ok(await purpose(user, original)); const { exercise: ex } = ok(await exercise(user, original));
    const oldEpoch = user.epoch;
    ok(await user.send('DELETE', '/api/account/data', { expectedEpoch: oldEpoch }));
    assert.ok(user.epoch > oldEpoch);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/flow')).flow, flowEngine.emptyFlow());
    await save(user, original);
    assert.equal((await user.send('PUT', '/api/learning/flow/purposes/' + original.id,
      { purpose: 'practice', expectedRevision: 0, expectedEpoch: oldEpoch })).status, 409);
    assert.equal((await attempt(user, ex, 5, { expectedEpoch: oldEpoch })).status, 409);
    assert.equal((await user.send('POST', `/api/learning/flow/exercises/${ex.id}/help`,
      { type: 'answer', expectedEpoch: oldEpoch })).status, 409);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/flow')).flow, flowEngine.emptyFlow());
  });
});

test('real flow writes remain protected by Origin and CSRF, and empty model config remains honest', async () => {
  await fixture(async ({ client, upstreams }) => {
    const user = await learner(client); const original = await save(user);
    const body = { purpose: 'practice', expectedRevision: 0, expectedEpoch: user.epoch };
    assert.equal((await user.send('PUT', '/api/learning/flow/purposes/' + original.id, body,
      { 'x-breakglass-csrf': '' })).status, 403);
    const before = upstreams.length;
    assert.equal((await user.send('PUT', '/api/learning/flow/purposes/' + original.id, body,
      { origin: 'https://untrusted.example' })).status, 403);
    assert.equal(upstreams.length, before, 'foreign origin blocked before gateway');
    assert.deepEqual(ok(await user.send('GET', '/api/learning/flow')).flow, flowEngine.emptyFlow());
    assert.equal(ok(await user.send('GET', '/api/vision/config')).supplierConfigured, false);
    const policy = ok(await user.send('GET', '/api/vision/policy?sourceId=file-unregistered'));
    assert.equal(policy.allowed, false); assert.equal(policy.supplierConfigured, false);
  });
});
