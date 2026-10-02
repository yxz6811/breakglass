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
   * 识别适配开关：只有显式写 `fixture` 才算打开。
   * 缺省、空串或其他任何值都按 `off` 处理，不得当成 `fixture`。
   * @param {object} [config]
   * @returns {'off' | 'fixture'}
   */
  function readVisionAdapter(config) {
    return config && config.visionAdapter === 'fixture' ? 'fixture' : 'off';
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
    let raw;
    try {
      raw = await loadJson(configPath);
    } catch (error) {
      return { ok: false, code: 'preset_unreadable', message: error.message || '无法读取预制配置。' };
    }
    // 开关在这里归一化，页面和唤醒层拿到的 config 只会是 off 或 fixture。
    const config = { ...raw, visionAdapter: readVisionAdapter(raw) };
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

  /**
   * 读取随扩展打包的识别样例。失败只返回可恢复的失败对象，由唤醒层统一映射成 external_unavailable。
   * @param {{ path?: string }} [options]
   * @returns {Promise<{ ok: boolean, candidate?: object, code?: string, message?: string }>}
   */
  async function loadVisionFixture({ path: fixturePath = '../assets/vision/fixture-parabola.json' } = {}) {
    try {
      return { ok: true, candidate: await loadJson(fixturePath) };
    } catch (error) {
      return { ok: false, code: 'vision_unreadable', message: error.message || '无法读取识别样例。' };
    }
  }

  return { loadJson, loadPreset, readVisionAdapter, loadVisionFixture };
});
