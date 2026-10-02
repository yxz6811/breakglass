(function (root, factory) {
  const api = factory(root, root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.preset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, BreakGlass) {
  /**
   * 调用时再找校验器。脚本还没挂上时返回失败，不抛 TypeError。
   * @param {typeof globalThis} root
   * @param {object} captured
   * @returns {{ validateCurveResult: Function } | null}
   */
  function validator(root, captured) {
    if (root.BreakGlass && root.BreakGlass.validate) return root.BreakGlass.validate;
    if (captured && captured.validate) return captured.validate;
    if (typeof require !== 'function') return null;
    try {
      return require('../curve/validate');
    } catch (error) {
      return null;
    }
  }

  /**
   * @param {string} path
   * @returns {Promise<object>}
   */
  async function loadJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`无法读取 ${path}（${response.status}）。`);
    return response.json();
  }

  /**
   * @param {{ configPath?: string, presetBasePath?: string }} [options]
   * @returns {Promise<{ ok: boolean, code?: string, message?: string, config?: object, result?: object }>}
   */
  async function loadPreset({ configPath = '../assets/config.json', presetBasePath = '../assets/presets/' } = {}) {
    let config;
    try {
      config = await loadJson(configPath);
    } catch (error) {
      return { ok: false, code: 'preset_unreadable', message: error.message || '无法读取预制配置。' };
    }
    if (config.enableLocalMock !== true || config.prewarmed !== true) {
      return { ok: false, code: 'preset_disabled', message: '预制结果未启用或尚未预热。', config };
    }
    let result;
    try {
      result = await loadJson(`${presetBasePath}${config.presetKey}.json`);
    } catch (error) {
      return { ok: false, code: 'preset_unreadable', message: error.message || '无法读取预制结果。', config };
    }
    const validate = validator(root, BreakGlass);
    if (!validate || typeof validate.validateCurveResult !== 'function') {
      return { ok: false, code: 'validator_unavailable', message: '结果校验器不可用。', config };
    }
    const check = validate.validateCurveResult(result);
    if (!check.ok) return { ok: false, code: check.code, message: check.message, config };
    return { ok: true, config, result: check.value };
  }

  return { loadJson, loadPreset };
});
