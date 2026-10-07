import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as checks from './validation.mjs';
const require = createRequire(import.meta.url);
const engine = require('../../learning-site/learning-flow.js');
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };

// Called inside the existing serialized account transaction; authentication,
// epoch and beforeCommit capabilities remain owned by createLearningHandler.
export function updateLearningFlow(user, action, body, identity, now = Date.now()) {
  const flow = user.flow ||= checks.emptyFlow(), createdAt = new Date(now).toISOString();
  const recordId = action === 'exercise' ? body.recordId : identity;
  function record(id) { const found = user.records.find(r => r.id === id); if (!found) fail(404, 'record_not_found', '原学习记录不存在。'); return found; }
  function revised(existing) { if ((existing?.revision || 0) !== body.expectedRevision) fail(409, 'revision_conflict', '学习设置已更新，请保留输入并重新读取。'); }
  let result;
  try {
    if (action === 'purpose') {
      record(recordId); revised(flow.purposes.find(v => v.recordId === recordId));
      const purpose = engine.createPurpose(recordId, body.purpose, { revision: body.expectedRevision + 1, updatedAt: createdAt });
      flow.purposes = [...flow.purposes.filter(v => v.recordId !== recordId), purpose]; result = { purpose };
    } else if (action === 'review') {
      record(recordId); revised(flow.reviews.find(v => v.recordId === recordId));
      const review = engine.validateReview({ recordId, reviewAt: body.reviewAt, skippedUntil: body.skippedUntil,
        revision: body.expectedRevision + 1, updatedAt: createdAt });
      flow.reviews = [...flow.reviews.filter(v => v.recordId !== recordId), review]; result = { review };
    } else if (action === 'exercise') {
      const original = record(recordId);
      if (engine.purposeOf(recordId, flow.purposes) !== 'practice') fail(400, 'purpose_required', '请先明确把原记录设为可作答练习。');
      const exercise = engine.createExercise(original, { id: randomUUID(), kind: body.kind, stage: body.stage, index: body.index, createdAt });
      const context = engine.createContext(exercise, { id: randomUUID(), generation: user.epoch });
      flow.exercises.push(exercise); flow.contexts.push(context); result = { exercise, context };
    } else {
      const exercise = flow.exercises.find(e => e.id === identity), context = flow.contexts.find(c => c.exerciseId === identity);
      if (!exercise || !context) fail(404, 'exercise_not_found', '当前账户没有这道新题。');
      if (flow.receipts.some(r => r.exerciseId === identity)) fail(409, 'exercise_closed', '此题已经提交；请创建下一道新题。');
      if (action === 'help') {
        const next = engine.markHelp(context, { type: body.type, ...(Object.hasOwn(body, 'level') ? { level: body.level } : {}) });
        flow.contexts = flow.contexts.map(c => c.exerciseId === identity ? next : c); result = { context: next };
      } else {
        const receipt = engine.submitExercise(record(exercise.recordId), exercise, context, { id: randomUUID(), answer: body.answer, createdAt });
        flow.receipts.push(receipt); result = { receipt };
      }
    }
  } catch (error) {
    if (error.status) throw error;
    fail(400, 'invalid_flow', error.message || '学习流程字段不合法。');
  }
  if (flow.purposes.length > 500 || flow.reviews.length > 500 || ['exercises','contexts','receipts'].some(key => flow[key].length > 2000)) fail(413, 'flow_limit', '学习流程存储数量已达上限。');
  if (!checks.learningFlow(flow, user.records)) fail(400, 'invalid_flow', '学习流程未通过数学与关系校验。');
  return { ...result, epoch: user.epoch };
}

export function matchLearningFlow(path, method, body, pathId) {
  if (path === '/api/learning/flow' && method === 'GET') return { action: 'read' };
  let match, action, identity;
  if (path === '/api/learning/flow/exercises' && method === 'POST') action = 'exercise';
  else if ((match = /^\/api\/learning\/flow\/(purposes|reviews)\/([^/]+)$/.exec(path)) && method === 'PUT') {
    action = match[1] === 'purposes' ? 'purpose' : 'review'; identity = pathId(match[2]);
  } else if ((match = /^\/api\/learning\/flow\/exercises\/([^/]+)\/(help|attempts)$/.exec(path)) && method === 'POST') {
    action = match[2] === 'help' ? 'help' : 'submit'; identity = pathId(match[1]);
  } else return null;
  const keys = {
    purpose: ['purpose','expectedRevision','expectedEpoch'], review: ['reviewAt','skippedUntil','expectedRevision','expectedEpoch'],
    exercise: ['recordId','kind','stage','index','expectedEpoch'], submit: ['answer','expectedEpoch'],
    help: ['type','expectedEpoch', ...(Object.hasOwn(body || {}, 'level') ? ['level'] : [])]
  }[action];
  if (!checks.exact(body, keys) || !checks.epoch(body.expectedEpoch)
    || (['purpose','review'].includes(action) && !checks.epoch(body.expectedRevision))) fail(400, 'invalid_request', '学习流程请求需要固定字段和当前修订/数据版本。');
  return { action, identity };
}
