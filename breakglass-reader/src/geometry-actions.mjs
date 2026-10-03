import { askGeometryModel, askMessages } from './geometry-model.mjs';
import { exactFields, validIdentity, geometryRules, geometryError, configured, withGeometryBudget } from './geometry-scene.mjs';

export function checkGeometryAsk(body, rules) {
  if (!exactFields(body, ['schemaVersion', 'actionRequestId', 'scene', 'text'])
    || body.schemaVersion !== '1.0.0' || !validIdentity(body.actionRequestId)
    || typeof body.text !== 'string' || body.text.trim().length === 0
    || Array.from(body.text).length > 2000) return { ok: false, code: 'invalid_request' };
  const checked = rules.validateScene(body.scene);
  if (!checked.ok || checked.scene.sceneRevision < 1) return { ok: false, code: 'invalid_scene' };
  return { ok: true, scene: checked.scene, text: body.text.trim(), actionRequestId: body.actionRequestId };
}

export function geometryContext(scene) {
  return {
    requestId: scene.requestId, videoId: scene.videoId, frameTime: scene.frameTime,
    frameSize: { ...scene.frameSize }, sceneRevision: scene.sceneRevision
  };
}

export async function askGeometry(body, { settings, fetchImpl = fetch, signal, log = () => {} }) {
  signal?.throwIfAborted();
  const rules = geometryRules(settings);
  const checked = checkGeometryAsk(body, rules);
  if (!checked.ok) return geometryError(400, checked.code);
  if (!configured(settings)) return geometryError(503, 'unconfigured');
  const started = Date.now();
  const result = await withGeometryBudget({ signal, budgetMs: settings.geometryAskBudgetMs ?? 10000 }, async (workSignal) => {
    const answer = await askGeometryModel({ settings, messages: askMessages(checked.scene, checked.text), signal: workSignal, fetchImpl });
    workSignal.throwIfAborted();
    if (!exactFields(answer, ['status', 'actions']) || !Array.isArray(answer.actions)) return geometryError(502, 'model_failed');
    const envelope = {
      schemaVersion: '1.0.0', actionRequestId: checked.actionRequestId,
      context: geometryContext(checked.scene)
    };
    if (['unsupported', 'needs_clarification'].includes(answer.status) && answer.actions.length === 0) {
      return { status: 200, payload: { ...envelope, status: answer.status, actions: [], code: answer.status } };
    }
    if (answer.status !== 'actions') return geometryError(502, 'model_failed');
    const verdict = rules.validateActions(answer.actions, checked.scene);
    if (!verdict.ok) return geometryError(502, 'invalid_actions');
    return { status: 200, payload: { ...envelope, status: 'actions', actions: verdict.actions } };
  });
  signal?.throwIfAborted();
  log({ event: 'geometry_ask', status: result.status, code: result.payload.code || result.payload.status, ms: Date.now() - started });
  return result;
}
