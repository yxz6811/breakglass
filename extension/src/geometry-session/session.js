(function (root, factory) {
  const api = factory(root.BreakGlass && root.BreakGlass.geometryScene);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometrySession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (existing) {
  const sceneApi = typeof require === 'function'
    ? Object.assign({}, require('../geometry-scene/validate'), require('../geometry-scene/solve'), require('../geometry-scene/actions'))
    : existing;
  const CONTEXT_KEYS = ['requestId', 'videoId', 'frameTime', 'frameSize', 'sceneRevision'];
  function clone(value) { return value === null ? null : JSON.parse(JSON.stringify(value)); }
  function failure(code, message) { return { ok: false, code, message }; }
  function contextOf(scene) {
    return { requestId: scene.requestId, videoId: scene.videoId, frameTime: scene.frameTime,
      frameSize: { ...scene.frameSize }, sceneRevision: scene.sceneRevision };
  }
  function sameVertices(left, right) {
    if (!left || !right) return !left && !right;
    return ['A', 'B', 'C'].every((key) => left[key].x === right[key].x && left[key].y === right[key].y);
  }
  function number(value) { return sceneApi.formatLength(value); }
  function describe(before, after) {
    const oldResult = sceneApi.solveTriangle(before);
    const newResult = sceneApi.solveTriangle(after);
    const changes = ['AB', 'AC'].filter((side) => before.lengths[side] !== after.lengths[side]);
    const unit = after.unit === 'unit' ? '单位长度' : after.unit;
    if (!changes.length) return `AB = ${number(after.lengths.AB)}、AC = ${number(after.lengths.AC)} ${unit}，BC = ${number(newResult.BC)} ${unit}。A 处为直角，BC 由勾股关系计算。`;
    const detail = changes.map((side) => `${side} 从 ${number(before.lengths[side])} 变为 ${number(after.lengths[side])}`).join('，');
    const fixed = changes.length === 1 ? `，${changes[0] === 'AB' ? 'AC' : 'AB'} 保持不变` : '';
    return `${detail}${fixed}；BC 从 ${number(oldResult.BC)} 变为 ${number(newResult.BC)} ${unit}。A 处仍为直角，BC 由勾股关系计算。`;
  }

  /** An independent in-memory scene session; it never calls CurveResult/createWake. */
  function createGeometrySession() {
    let phase = 'empty';
    let scene = null;
    let original = null;
    let lastChange = null;
    let disposed = false;
    const retiredRequestIds = new Set();

    function getState() {
      return { phase, scene: clone(scene), original: clone(original),
        result: phase === 'confirmed' ? sceneApi.solveTriangle(scene) : null, lastChange: clone(lastChange) };
    }
    function getContext() { return scene ? contextOf(scene) : null; }
    function setCandidate(candidate, expected) {
      if (disposed) return failure('disposed', '场景会话已退出。');
      const checked = sceneApi.validateScene(candidate, expected);
      if (!checked.ok) return checked;
      if (checked.scene.sceneRevision !== 0 || retiredRequestIds.has(checked.scene.requestId)) {
        return failure('stale_candidate', '该候选已失效，请重新获取当前帧。');
      }
      // Replacing a confirmed scene also retires its identity, even at the same video time.
      if (scene && scene.requestId !== checked.scene.requestId) retiredRequestIds.add(scene.requestId);
      if (phase === 'confirmed' && scene.requestId === checked.scene.requestId) {
        return failure('stale_candidate', '确认后的场景不能被原候选覆盖。');
      }
      scene = checked.scene;
      original = null;
      lastChange = null;
      phase = 'review';
      return { ok: true, state: getState() };
    }
    function confirm(corrected = scene) {
      if (disposed || phase !== 'review' || !scene) return failure('not_reviewing', '请先取得并校对候选。');
      const checked = sceneApi.validateScene(corrected, contextOf(scene));
      if (!checked.ok) return checked;
      if (checked.scene.originSource !== scene.originSource) return failure('invalid_source', '不能改变候选的原始来源。');
      const modified = ['AB', 'AC'].some((key) => checked.scene.lengths[key] !== scene.lengths[key])
        || ['A', 'B', 'C'].some((key) => checked.scene.labels[key] !== scene.labels[key])
        || !sameVertices(checked.scene.vertices, scene.vertices) || checked.scene.unit !== scene.unit;
      if (modified && (checked.scene.source !== 'manual' || checked.scene.editedByUser !== true)) {
        return failure('invalid_source', '校正候选后请标为手动校对。');
      }
      scene = checked.scene;
      scene.sceneRevision = 1;
      original = sceneApi.copyScene(scene);
      lastChange = null;
      phase = 'confirmed';
      return { ok: true, state: getState() };
    }
    function execute(actions, context) {
      if (disposed || phase !== 'confirmed' || !scene) return failure('not_confirmed', '请先确认题目。');
      if (!sceneApi.exactKeys(context, CONTEXT_KEYS) || !sceneApi.exactKeys(context.frameSize, ['width', 'height'])) {
        return failure('invalid_context', '动作缺少完整的当前场景归属。');
      }
      const owned = sceneApi.validateScene(scene, context);
      if (!owned.ok) return owned;
      const checked = sceneApi.validateActions(actions, scene);
      if (!checked.ok) return checked;
      const before = sceneApi.copyScene(scene);
      let proposal = sceneApi.copyScene(scene);
      let restored = false;
      let changed = false;
      for (const action of checked.actions) {
        if (action.type === 'set_length' && proposal.lengths[action.side] !== action.value) {
          proposal.lengths[action.side] = action.value;
          proposal.source = 'manual';
          proposal.editedByUser = true;
          changed = true;
        } else if (action.type === 'restore_original') {
          proposal = sceneApi.copyScene(original);
          Object.assign(proposal, contextOf(scene));
          restored = true;
        }
      }
      if (changed || restored) {
        if (scene.sceneRevision >= Number.MAX_SAFE_INTEGER) return failure('revision_exhausted', '修订号已用尽，请重新进入场景。');
        proposal.sceneRevision = scene.sceneRevision + 1;
      }
      const valid = sceneApi.validateScene(proposal);
      if (!valid.ok) return valid;
      const explainOnly = checked.actions.length === 1 && checked.actions[0].type === 'explain_change';
      const explanation = describe(explainOnly && lastChange ? lastChange.before : before, valid.scene);
      // Only the successful commit changes visible state; every failure above is atomic.
      scene = valid.scene;
      if (changed || restored) lastChange = { before, after: sceneApi.copyScene(scene), restored };
      return { ok: true, state: getState(), explanation };
    }
    function invalidate() {
      if (scene) retiredRequestIds.add(scene.requestId);
      phase = 'empty'; scene = null; original = null; lastChange = null;
      return getState();
    }
    function dispose() { invalidate(); disposed = true; return getState(); }
    return { setCandidate, confirm, getState, getContext, execute, invalidate, dispose };
  }

  return { createGeometrySession };
});
