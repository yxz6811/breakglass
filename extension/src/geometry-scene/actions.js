(function (root, factory) {
  const api = factory(root.BreakGlass && root.BreakGlass.geometryScene);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryScene = Object.assign(root.BreakGlass.geometryScene || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (existing) {
  const validation = typeof require === 'function' ? require('./validate') : existing;
  function reject(code, message) { return { ok: false, code, message }; }

  /** Check the whole batch before any mutation; restore shape needs no original snapshot. */
  function validateActions(actions, scene) {
    const checked = validation.validateScene(scene);
    if (!checked.ok) return checked;
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 2) {
      return reject('invalid_actions', '一次只能修改一条边，并可附带解释。');
    }
    let sets = 0;
    let restores = 0;
    let explains = 0;
    const copy = [];
    for (const action of actions) {
      if (!validation.exactKeys(action, ['type'], ['side', 'value', 'unit'])) {
        return reject('invalid_action', '动作必须是固定字段的 JSON 数据。');
      }
      if (action && action.type === 'set_length') {
        if (!validation.exactKeys(action, ['type', 'side', 'value', 'unit'])
          || !['AB', 'AC'].includes(action.side) || typeof action.value !== 'number'
          || !Number.isFinite(action.value) || action.value <= 0) {
          return reject('invalid_action', '改边动作须指定一条直角边和正的有限数值。');
        }
        if (action.unit !== checked.scene.unit) return reject('unit_mismatch', '单位不一致，请先核对；不会自动换算。');
        sets += 1;
        copy.push({ type: 'set_length', side: action.side, value: action.value, unit: action.unit });
      } else if (action && (action.type === 'explain_change' || action.type === 'restore_original')) {
        if (!validation.exactKeys(action, ['type'])) return reject('invalid_action', '该动作不接受额外字段。');
        if (action.type === 'explain_change') explains += 1;
        else restores += 1;
        copy.push({ type: action.type });
      } else return reject('unsupported_action', '只支持改一条直角边、解释或恢复原题。');
    }
    if (sets > 1 || restores > 1 || explains > 1 || (sets && restores)) {
      return reject('conflicting_actions', '请分步操作：一次只改一条边，恢复不能与改边同时进行。');
    }
    const proposal = checked.scene;
    for (const action of copy) if (action.type === 'set_length') proposal.lengths[action.side] = action.value;
    const derived = validation.validateScene(proposal);
    if (!derived.ok) return derived;
    return { ok: true, actions: copy };
  }

  const NUMBER = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)';
  const UNIT = '(cm|m|厘米|米|单位长度)?';
  const CHANGE = new RegExp('^(?:如果|假如)?\\s*(?:把|将)?\\s*(AB|AC)\\s*'
    + '(?:从\\s*' + NUMBER + '\\s*' + UNIT + '\\s*)?'
    + '(?:改为|改成|改到|变为|变成|设为|设置为|调整为|调整到|增大到|缩小到|=)\\s*'
    + NUMBER + '\\s*' + UNIT + '\\s*'
    + '(?:[，,]\\s*(AB|AC|另一条(?:直角)?边|另一边)\\s*(?:不变|保持不变|保持原值)\\s*)?'
    + '(?:[，,]\\s*(解释(?:一下)?(?:变化)?|(?:BC|斜边)\\s*(?:会怎样|会怎么变|会如何变化|会变成多少|是多少)))?$', 'i');
  function localResult(status, reason) { return { status, actions: [], reason }; }
  function unitCode(value, fallback) { return value === '厘米' ? 'cm' : value === '米' ? 'm' : value === '单位长度' ? 'unit' : value || fallback; }

  /**
   * A deliberately closed local command grammar, not AI or a general language interpreter.
   * Whole-string matching prevents a valid prefix from hiding additional instructions.
   * @param {string} text
   * @param {object} scene
   */
  function parseLocalQuestion(text, scene) {
    const checked = validation.validateScene(scene);
    if (!checked.ok || scene.sceneRevision < 1) return localResult('needs_clarification', '请先确认题目。');
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 2000) {
      return localResult('needs_clarification', '请输入不超过 2000 个字的问题。');
    }
    const input = text.trim().replace(/[。！？?!]+$/u, '').trim();
    if (/(?:代码|执行|运行|javascript|python|html|svg|<|>|=>|eval\s*\(|fetch\s*\(|console\.|function\s*\()/i.test(input)) {
      return localResult('unsupported', '本地指令只处理改一条边、询问 BC、解释变化和恢复原题。');
    }
    if (/^(?:请)?(?:恢复原题|恢复原始题目|回到原题|重置)(?:并解释(?:变化)?|[，,]解释(?:变化)?)?$/u.test(input)) {
      const actions = [{ type: 'restore_original' }];
      if (/解释/u.test(input)) actions.push({ type: 'explain_change' });
      return { status: 'actions', actions };
    }
    if (/^(?:请)?(?:(?:当前|现在的?|此时)?\s*(?:BC|斜边)(?:的长度)?\s*(?:是多少|等于多少|有多长)|求\s*(?:BC|斜边))$/i.test(input)
      || /^(?:请)?(?:解释(?:一下)?(?:变化|当前变化)|(?:BC|斜边)\s*(?:为什么变了|为什么变长了|为什么变短了|为什么变化))$/i.test(input)) {
      return { status: 'actions', actions: [{ type: 'explain_change' }] };
    }
    const match = input.match(CHANGE);
    if (!match) return localResult('unsupported', '只支持完整的单边改值，例如“把 AB 改为 6”；其他要求请分步或手动核对。');
    const side = match[1].toUpperCase();
    if (match[6] && ['AB', 'AC'].includes(match[6].toUpperCase()) && match[6].toUpperCase() === side) {
      return localResult('unsupported', '改边与保持该边不变互相冲突，请核对条件。');
    }
    const from = match[2];
    if (from !== undefined && (Number(from) !== checked.scene.lengths[side]
      || unitCode(match[3], checked.scene.unit) !== checked.scene.unit)) {
      return localResult('needs_clarification', '问题中的原边长或单位与当前题目不一致。');
    }
    const actions = [{ type: 'set_length', side, value: Number(match[4]), unit: unitCode(match[5], checked.scene.unit) }];
    if (match[7]) actions.push({ type: 'explain_change' });
    const valid = validateActions(actions, checked.scene);
    if (!valid.ok) return localResult('needs_clarification', valid.message);
    return { status: 'actions', actions: valid.actions };
  }

  return { validateActions, parseLocalQuestion };
});
