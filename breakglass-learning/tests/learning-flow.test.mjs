import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLearningHandler } from '../src/server.mjs';
import { database } from '../src/validation.mjs';
import engine from '../../learning-site/learning-flow.js';

const ORIGIN = 'http://127.0.0.1:4174';
const PASSWORD = 'development-flow-test-password';
const TIME = '2026-10-07T00:00:00.000Z';
const original = (template = 'parabola', id = `flow-${template}`) => ({ id, kind: 'question',
  source: { kind: 'manual-notes', id: 'flow-test-checked', version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  time: 0, title: '测试原题', note: '不关联用户媒体的数学测试数据。', template,
  snapshot: template === 'parabola' ? { a: 2, h: -3, k: 1 } : { AB: 3, AC: 4, unit: 'cm' },
  origin: 'manual', sourceLabel: '独立测试手工条件', createdAt: TIME });

function client(base) {
  let cookie = '', csrf = '';
  async function send(method, route, body) {
    const response = await fetch(base + route, { method, headers: { origin: ORIGIN, cookie, 'x-breakglass-csrf': csrf,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const value = await response.json(); if (value.csrfToken) csrf = value.csrfToken;
    return { status: response.status, value };
  }
  return { send, register: () => send('POST', '/api/account/register', { username: 'flow_boundary_learner', password: PASSWORD }),
    login: () => send('POST', '/api/account/login', { username: 'flow_boundary_learner', password: PASSWORD }) };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.value)); return response.value; }
async function fixture(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-flow-http-test-'));
  const options = { dataDir, allowedOrigins: [ORIGIN], now: () => Date.parse(TIME) };
  let handler = createLearningHandler(options);
  const server = http.createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ dataDir, filename: path.join(dataDir, 'accounts-v1.json'), client: () => client(base),
    restart: () => { handler = createLearningHandler(options); } }); }
  finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    const target = path.resolve(dataDir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('breakglass-flow-http-test-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}
async function seed(user, record = original()) {
  ok(await user.register(), 201);
  ok(await user.send('PUT', `/api/learning/records/${record.id}`, { record, expectedEpoch: 0 }));
  return record;
}
const purpose = (user, record, value = 'practice', revision = 0) => user.send('PUT', `/api/learning/flow/purposes/${record.id}`,
  { purpose: value, expectedRevision: revision, expectedEpoch: 0 });
const makeExercise = (user, record, changes = {}) => user.send('POST', '/api/learning/flow/exercises', {
  recordId: record.id, kind: record.template === 'parabola' ? 'parabola-vertex' : 'triangle-hypotenuse',
  stage: 'practice', index: 1, expectedEpoch: 0, ...changes });
const help = (user, ex, type, extra = {}) => user.send('POST', `/api/learning/flow/exercises/${ex.id}/help`,
  { type, expectedEpoch: 0, ...extra });
const submit = (user, ex, answer, extra = {}) => user.send('POST', `/api/learning/flow/exercises/${ex.id}/attempts`,
  { answer, expectedEpoch: 0, ...extra });
const getFlow = async (user) => ok(await user.send('GET', '/api/learning/flow')).flow;

test('HTTP exercise creation requires explicitly classified practice; reflection and old titles never grant it', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const record = await seed(user);
    const missing = await makeExercise(user, record); assert.equal(missing.status, 400); assert.equal(missing.value.code, 'purpose_required');
    ok(await purpose(user, record, 'reflection'));
    assert.equal((await makeExercise(user, record)).value.code, 'purpose_required');
    ok(await purpose(user, record, 'unclassified', 1));
    assert.equal((await makeExercise(user, record)).value.code, 'purpose_required');
    assert.deepEqual((await getFlow(user)).exercises, []);
    ok(await purpose(user, record, 'practice', 2));
    const made = ok(await makeExercise(user, record));
    assert.equal(made.exercise.recordId, record.id); assert.equal(made.context.exerciseId, made.exercise.id);
    assert.notEqual(made.exercise.id, record.id);
  });
});

test('HTTP clients cannot inject answer facts, help context, provenance, identities or mathematical fields', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const record = await seed(user); ok(await purpose(user, record));
    for (const extra of [{ id: 'client-exercise' }, { lessonId: 'parabola-translation' }, { createdAt: TIME },
      { snapshot: { a: 1, h: 99, k: 0 } }, { expectedAnswer: 0 }, { prompt: 'fake' }, { context: { hintsShown: 0 } }]) {
      assert.equal((await makeExercise(user, record, extra)).status, 400);
    }
    const { exercise: ex } = ok(await makeExercise(user, record));
    const answer = engine.exerciseView(ex, record).answer;
    for (const extra of [{ hintUsed: false }, { correct: true }, { outcome: 'correct_independent' }, { id: 'client-receipt' },
      { recordId: record.id }, { exerciseId: ex.id }, { createdAt: TIME }, { context: { hintsShown: 0 } }]) {
      assert.equal((await submit(user, ex, answer, extra)).status, 400);
    }
    for (const extra of [{ hintsShown: 0 }, { answerShown: false }, { exampleShown: false }, { generation: 0 }, { id: 'client-context' }]) {
      assert.equal((await help(user, ex, 'answer', extra)).status, 400);
    }
    assert.equal((await user.send('PUT', `/api/learning/flow/purposes/${record.id}`, {
      purpose: 'practice', expectedRevision: 1, expectedEpoch: 0, snapshot: { a: 1, h: 0, k: 0 } })).status, 400);
    assert.deepEqual((await getFlow(user)).receipts, []);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/records')).records, [record]);
    assert.equal((await user.send('GET', '/api/learning/flow?recordId=other')).status, 400);
  });
});

test('HTTP help actions have strict types and levels, accumulate, and lock after an independent or assisted submission', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const record = await seed(user); ok(await purpose(user, record));
    const { exercise: ex } = ok(await makeExercise(user, record));
    for (const [type, extra] of [['hint', {}], ['hint', { level: 0 }], ['hint', { level: 4 }], ['hint', { level: 1.5 }],
      ['hint', { level: '1' }], ['answer', { level: 1 }], ['example', { level: 1 }], ['reset', {}]]) {
      assert.equal((await help(user, ex, type, extra)).status, 400);
    }
    assert.equal(ok(await help(user, ex, 'hint', { level: 3 })).context.hintsShown, 3);
    assert.equal(ok(await help(user, ex, 'hint', { level: 1 })).context.hintsShown, 3);
    ok(await help(user, ex, 'example')); ok(await help(user, ex, 'answer'));
    const before = await getFlow(user); assert.equal(before.contexts[0].exampleShown, true); assert.equal(before.contexts[0].answerShown, true);
    const receipt = ok(await submit(user, ex, engine.exerciseView(ex, record).answer)).receipt;
    assert.equal(receipt.hintUsed, true); assert.equal(receipt.outcome, 'correct_with_hint');
    assert.equal((await help(user, ex, 'hint', { level: 1 })).value.code, 'exercise_closed');
    assert.equal((await submit(user, ex, engine.exerciseView(ex, record).answer)).value.code, 'exercise_closed');
    const independent = ok(await makeExercise(user, record, { index: 2 })).exercise;
    const cleanReceipt = ok(await submit(user, independent, engine.exerciseView(independent, record).answer)).receipt;
    assert.equal(cleanReceipt.hintUsed, false); assert.equal(cleanReceipt.outcome, 'correct_independent');
    assert.equal((await help(user, independent, 'answer')).value.code, 'exercise_closed');
    const after = await getFlow(user);
    assert.deepEqual(after.contexts[0], before.contexts[0]); assert.equal(after.contexts[1].answerShown, false);
    assert.equal(after.receipts.length, 2);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/attempts')).attempts, []);
  });
});

test('HTTP rejects cross-template recipes, invalid stages and indices, malformed answers, and false mathematical candidates', async () => {
  await fixture(async ({ client }) => {
    const user = client(); const record = await seed(user); ok(await purpose(user, record));
    for (const changes of [{ kind: 'triangle-hypotenuse' }, { kind: 'execute-model-code' }, { kind: 'parabola-completion', stage: 'practice' },
      { stage: 'completion' }, { stage: 'prediction' }, { stage: 'example' }, { stage: 'reflection' },
      { index: 0 }, { index: 21 }, { index: 1.5 }, { index: '1' }]) {
      assert.equal((await makeExercise(user, record, changes)).status, 400);
    }
    assert.equal((await makeExercise(user, record, { recordId: 'nonexistent-original' })).status, 404);
    assert.equal((await submit(user, { id: 'nonexistent-exercise' }, 0)).status, 404);
    for (const candidate of [{ ...record, snapshot: { a: 0, h: 0, k: 0 } }, { ...record, origin: 'vision' },
      { ...record, source: { ...record.source, materialMode: 'permission-pending' } }]) {
      assert.equal((await user.send('PUT', '/api/learning/records/bad-candidate', { record: { ...candidate, id: 'bad-candidate' }, expectedEpoch: 0 })).status, 400);
    }
    const { exercise: ex } = ok(await makeExercise(user, record));
    for (const answer of [null, 0, '0', {}, { h: 1 }, { h: 1, k: '1' }, { h: 1, k: 1, hidden: true }]) {
      assert.equal((await submit(user, ex, answer)).status, 400);
    }
    const wrong = ok(await submit(user, ex, { h: 99, k: 99 })).receipt;
    assert.equal(wrong.correct, false); assert.equal(wrong.outcome, 'wrong');
    const choice = ok(await makeExercise(user, record, { kind: 'parabola-equation' })).exercise;
    assert.equal((await submit(user, choice, 'arbitrary-value')).status, 400);
    assert.equal((await submit(user, choice, { value: 'match' })).status, 400);
    assert.deepEqual(ok(await user.send('GET', '/api/learning/records')).records, [record]);
  });
});

test('legacy account without flow reopens unchanged, defaults to empty flow, and acquires sidecars only on explicit writes', async () => {
  await fixture(async ({ client, filename, restart }) => {
    const user = client(); const record = await seed(user);
    const state = JSON.parse(await fs.readFile(filename, 'utf8')); delete state.users[0].flow;
    assert.equal(database(state), true); const legacy = JSON.stringify(state); await fs.writeFile(filename, legacy);
    restart(); const reopened = client(); ok(await reopened.login());
    assert.deepEqual(await getFlow(reopened), engine.emptyFlow());
    assert.equal(await fs.readFile(filename, 'utf8'), legacy, 'reading must not rewrite an old account');
    assert.equal((await makeExercise(reopened, record)).value.code, 'purpose_required');
    assert.equal(await fs.readFile(filename, 'utf8'), legacy, 'a denied request must not create partial flow');
    ok(await purpose(reopened, record));
    const persisted = JSON.parse(await fs.readFile(filename, 'utf8'));
    assert.equal(persisted.users[0].flow.purposes[0].purpose, 'practice');
    assert.deepEqual(persisted.users[0].records, state.users[0].records);
    assert.deepEqual(persisted.users[0].attempts, []);
    assert.equal(persisted.users[0].passwordHash, state.users[0].passwordHash);
  });
});

test('corrupt database flow is rejected on HTTP restart without overwriting math, help facts or evidence', async () => {
  await fixture(async ({ client, filename, restart }) => {
    const user = client(); const record = await seed(user); ok(await purpose(user, record));
    const { exercise: ex } = ok(await makeExercise(user, record)); ok(await help(user, ex, 'hint', { level: 1 }));
    ok(await submit(user, ex, engine.exerciseView(ex, record).answer));
    const baseline = JSON.parse(await fs.readFile(filename, 'utf8')); assert.equal(database(baseline), true);
    const alterations = [
      flow => { flow.schemaVersion = '2'; },
      flow => { flow.exercises[0].kind = 'triangle-hypotenuse'; },
      flow => { flow.exercises[0].recordId = 'orphan'; },
      flow => { flow.contexts[0].exerciseId = 'orphan'; },
      flow => { flow.contexts[0].hintsShown = 4; },
      flow => { flow.receipts[0].hintUsed = false; flow.receipts[0].outcome = 'correct_independent'; },
      flow => { flow.receipts[0].answer = { h: 99, k: 99 }; },
      flow => { flow.receipts.push({ ...flow.receipts[0], id: 'duplicate-submission' }); },
      flow => { flow.exercises[0].expectedAnswer = 0; },
      flow => { flow.reviews = [{ recordId: record.id, reviewAt: '2026-02-30T00:00:00.000Z', skippedUntil: null, revision: 1, updatedAt: TIME }]; },
      flow => { flow.purposes = Array(501).fill(flow.purposes[0]); },
      flow => { flow.contexts = Array(2001).fill(flow.contexts[0]); }
    ];
    for (const alter of alterations) {
      const corrupted = structuredClone(baseline); alter(corrupted.users[0].flow);
      assert.equal(database(corrupted), false);
      const raw = JSON.stringify(corrupted); await fs.writeFile(filename, raw); restart();
      const response = await client().login();
      assert.equal(response.status, 503); assert.equal(response.value.code, 'local_storage_unavailable');
      assert.equal(await fs.readFile(filename, 'utf8'), raw);
      assert.doesNotMatch(JSON.stringify(response.value), /passwordHash|passwordSalt|expectedAnswer|duplicate-submission/);
    }
    await fs.writeFile(filename, '{broken-json'); restart();
    assert.equal((await client().login()).status, 503);
    assert.equal(await fs.readFile(filename, 'utf8'), '{broken-json');
  });
});

test('HTTP at the 2000-exercise limit rejects a new exercise atomically rather than retaining its orphan context', async () => {
  await fixture(async ({ client, filename, restart }) => {
    const user = client(); const record = await seed(user); ok(await purpose(user, record));
    const state = JSON.parse(await fs.readFile(filename, 'utf8')); const flow = state.users[0].flow;
    for (let index = 0; index < 2000; index++) {
      const ex = engine.createExercise(record, { id: `limit-exercise-${index}`, kind: 'parabola-vertex', stage: 'practice', index: 1, createdAt: TIME });
      flow.exercises.push(ex); flow.contexts.push(engine.createContext(ex, { id: `limit-context-${index}`, generation: 0 }));
    }
    assert.equal(database(state), true); const raw = JSON.stringify(state); await fs.writeFile(filename, raw); restart();
    const reopened = client(); ok(await reopened.login());
    const denied = await makeExercise(reopened, record);
    assert.equal(denied.status, 413); assert.equal(denied.value.code, 'flow_limit');
    const after = await getFlow(reopened);
    assert.equal(after.exercises.length, 2000); assert.equal(after.contexts.length, 2000); assert.equal(after.receipts.length, 0);
    assert.equal(await fs.readFile(filename, 'utf8'), raw);
  });
});
