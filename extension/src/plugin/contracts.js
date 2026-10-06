(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const PILOT_LESSON_ID = 'breakglass-plugin-pilot-v1';
  const PILOT_DURATION = 12;
  const MAX_DURATION = 600;
  const MAX_POINTS = 64;
  const SOURCE_KEYS = ['kind', 'id', 'version', 'analysisVersion', 'materialMode'];
  const POINT_KEYS = ['id', 'start', 'end', 'area', 'title', 'explanation', 'template',
    'snapshot', 'sourceLabel', 'origin'];
  const RECORD_KEYS = ['id', 'kind', 'source', 'time', 'title', 'note', 'template',
    'snapshot', 'origin', 'sourceLabel', 'createdAt'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function fail(code, message) { return { ok: false, code, message }; }
  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }
  function exact(value, required, optional = []) {
    if (!plain(value)) return false;
    const keys = Reflect.ownKeys(value);
    return required.every((key) => own(value, key)) && keys.every((key) => {
      if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor.enumerable && own(descriptor, 'value');
    });
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function identity(value, max = 128) {
    return typeof value === 'string' && value.length <= max
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  }
  function text(value, max, multiline = false) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) return false;
    const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    return !controls.test(value) && !/[\u202a-\u202e\u2066-\u2069]/.test(value);
  }
  // Records accept short personal text, never media addresses, embedded data or credentials.
  function privateText(value) {
    return !/(?:https?:\/\/|data:|blob:|file:\/\/|chrome-extension:\/\/|(?:document\.)?cookie\s*=|(?:authorization|cookie)\s*:)/i.test(value);
  }
  function dependencies() {
    if (typeof require === 'function') return {
      curve: require('../curve/evaluate'),
      geometry: require('../geometry-scene/validate')
    };
    return { curve: root.BreakGlass && root.BreakGlass.evaluate,
      geometry: root.BreakGlass && root.BreakGlass.geometryScene };
  }

  function source(value) {
    if (!exact(value, SOURCE_KEYS, ['title'])) return fail('invalid_source', '来源字段不符合固定结构。');
    if (!['visual-session', 'local-file', 'creator-layer', 'manual-notes'].includes(value.kind)
      || !identity(value.id) || !identity(value.version, 64) || value.analysisVersion !== '1'
      || !['self-authored', 'licensed', 'permission-pending'].includes(value.materialMode)) {
      return fail('invalid_source', '来源身份、版本或素材状态无效。');
    }
    if (own(value, 'title') && (!text(value.title, 120) || !privateText(value.title))) {
      return fail('invalid_source', '来源标题应为不含地址或凭证的短文本。');
    }
    if (value.kind === 'local-file' && !/^file-[a-f0-9]{64}$/.test(value.id)) {
      return fail('invalid_source', '本地文件来源需要完整SHA-256指纹。');
    }
    const copy = { kind: value.kind, id: value.id, version: value.version,
      analysisVersion: value.analysisVersion, materialMode: value.materialMode };
    if (own(value, 'title')) copy.title = value.title;
    return { ok: true, value: copy };
  }

  function context(value) {
    if (!exact(value, ['source'], ['duration'])) return fail('invalid_context', '需要当前来源与视频时长。');
    const checked = source(value.source);
    if (!checked.ok) return checked;
    const duration = own(value, 'duration') ? value.duration : PILOT_DURATION;
    if (!finite(duration) || duration <= 0 || duration > MAX_DURATION) {
      return fail('invalid_duration', '试点视频时长必须在 10 分钟以内。');
    }
    return { ok: true, source: checked.value, duration };
  }

  function snapshot(template, value) {
    const validators = dependencies();
    if (template === 'parabola') {
      if (!exact(value, ['a', 'h', 'k']) || ![value.a, value.h, value.k].every(finite)) {
        return fail('invalid_snapshot', '抛物线只接受有限的 a、h、k。');
      }
      if (!validators.curve || typeof validators.curve.assertFiniteDomain !== 'function') {
        return fail('validator_unavailable', '数学校验器未加载。');
      }
      const parameters = {};
      for (const name of ['a', 'h', 'k']) {
        parameters[name] = { initial: value[name], min: value[name], max: value[name], step: 1 };
      }
      try {
        validators.curve.assertFiniteDomain({ equationId: 'fixture.parabola', parameters,
          domain: { min: -10, max: 10 } });
      } catch (_) { return fail('invalid_snapshot', '抛物线无法生成有效数学场景。'); }
      return { ok: true, value: { a: value.a, h: value.h, k: value.k } };
    }
    if (template === 'right-triangle') {
      if (!exact(value, ['AB', 'AC', 'unit'])) return fail('invalid_snapshot', '直角三角形条件不完整。');
      if (!validators.geometry || typeof validators.geometry.validateScene !== 'function') {
        return fail('validator_unavailable', '数学校验器未加载。');
      }
      const checked = validators.geometry.validateScene({ schemaVersion: '1.0.0', kind: 'right-triangle',
        requestId: 'plugin-snapshot', videoId: PILOT_LESSON_ID, frameTime: 0,
        frameSize: { width: 1, height: 1 }, sceneRevision: 0, rightAngleAt: 'A',
        labels: { A: 'A', B: 'B', C: 'C' }, vertices: null,
        lengths: { AB: value.AB, AC: value.AC }, unit: value.unit,
        source: 'preset', originSource: 'preset', editedByUser: false });
      if (!checked.ok) return fail('invalid_snapshot', '直角三角形无法生成有效数学场景。');
      return { ok: true, value: { AB: value.AB, AC: value.AC, unit: value.unit } };
    }
    return fail('unsupported_template', '当前只支持抛物线和直角三角形。');
  }

  function area(value) {
    if (value === null) return true;
    if (!exact(value, ['x', 'y', 'width', 'height'])) return false;
    return [value.x, value.y, value.width, value.height].every(finite)
      && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
      && value.x + value.width <= 1 + 1e-9 && value.y + value.height <= 1 + 1e-9;
  }
  function matchingOrigin(value, activeSource) {
    const origins = ['visual-session', 'local-file'].includes(activeSource.kind) ? ['vision', 'manual']
      : activeSource.kind === 'creator-layer' ? ['author', 'manual'] : ['manual'];
    return origins.includes(value);
  }
  function denseArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_POINTS) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) return false;
    }
    return keys.every((key) => key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)));
  }

  function points(value, expected) {
    const active = context(expected);
    if (!active.ok) return active;
    if (active.source.materialMode === 'permission-pending') {
      return fail('permission_pending', '素材处理授权尚未确认。');
    }
    if (!denseArray(value)) return fail('invalid_points', '学习点必须是受限的完整列表。');
    const ids = new Set();
    const copies = [];
    for (const item of value) {
      if (!exact(item, POINT_KEYS) || !identity(item.id) || ids.has(item.id)) {
        return fail('invalid_point', '学习点结构或标识无效。');
      }
      if (!finite(item.start) || !finite(item.end) || item.start < 0
        || item.start >= item.end || item.end > active.duration || !area(item.area)) {
        return fail('invalid_point_bounds', '学习点时间或归一化区域超出视频。');
      }
      if (!text(item.title, 120) || !text(item.explanation, 2000, true)
        || !text(item.sourceLabel, 120) || !matchingOrigin(item.origin, active.source)) {
        return fail('invalid_point_content', '学习点文字或来源不匹配。');
      }
      const checked = snapshot(item.template, item.snapshot);
      if (!checked.ok) return checked;
      ids.add(item.id);
      copies.push({ id: item.id, start: item.start, end: item.end,
        area: item.area === null ? null : { x: item.area.x, y: item.area.y, width: item.area.width, height: item.area.height },
        title: item.title, explanation: item.explanation, template: item.template,
        snapshot: checked.value, sourceLabel: item.sourceLabel, origin: item.origin });
    }
    return { ok: true, value: copies };
  }

  // This only validates a model candidate; it does not confirm conditions or grant execution.
  function visualResult(value) {
    if (!exact(value, ['schemaVersion', 'template', 'snapshot', 'area', 'title', 'explanation', 'pitfallHint'])
      || value.schemaVersion !== '1' || !area(value.area) || !text(value.title, 120)
      || !text(value.explanation, 1500, true) || typeof value.pitfallHint !== 'string'
      || (value.pitfallHint !== '' && !text(value.pitfallHint, 400, true))) {
      return fail('invalid_visual_result', '视觉候选不符合受限数学结构。');
    }
    const checked = snapshot(value.template, value.snapshot);
    if (!checked.ok) return checked;
    return { ok: true, value: { schemaVersion: '1', template: value.template, snapshot: checked.value,
      area: value.area === null ? null : { x: value.area.x, y: value.area.y, width: value.area.width, height: value.area.height },
      title: value.title, explanation: value.explanation, pitfallHint: value.pitfallHint } };
  }

  function record(value, expected) {
    const active = context(expected);
    if (!active.ok) return active;
    if (!exact(value, RECORD_KEYS) || !identity(value.id) || !['question', 'pitfall'].includes(value.kind)) {
      return fail('invalid_record', '只保存手动疑问或个人易错标记。');
    }
    const storedSource = source(value.source);
    if (!storedSource.ok) return storedSource;
    if (storedSource.value.materialMode === 'permission-pending') return fail('permission_pending', '尚未确认素材的记录不保存。');
    for (const key of SOURCE_KEYS) {
      if (storedSource.value[key] !== active.source[key]) return fail('source_mismatch', '记录不属于当前来源版本。');
    }
    if (!finite(value.time) || value.time < 0 || value.time > active.duration
      || !matchingOrigin(value.origin, active.source)) return fail('invalid_record_identity', '记录时间或来源无效。');
    if (!text(value.title, 120) || !text(value.note, 1000, true) || !text(value.sourceLabel, 120)
      || ![value.title, value.note, value.sourceLabel].every(privateText)) {
      return fail('invalid_record_text', '记录只接受不含媒体地址或凭证的个人短文本。');
    }
    if (typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)) {
      return fail('invalid_timestamp', '记录时间戳必须是 ISO UTC。');
    }
    const date = new Date(value.createdAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.createdAt) return fail('invalid_timestamp', '记录时间戳无效。');
    const checked = snapshot(value.template, value.snapshot);
    if (!checked.ok) return checked;
    return { ok: true, value: { id: value.id, kind: value.kind, source: storedSource.value,
      time: value.time, title: value.title, note: value.note, template: value.template,
      snapshot: checked.value, origin: value.origin, sourceLabel: value.sourceLabel, createdAt: value.createdAt } };
  }

  // Pure checks fail closed even for objects whose prototype/descriptor traps throw.
  function guarded(validate) {
    return function (...args) {
      try { return validate(...args); } catch (_) { return fail('invalid_data', '输入不是受支持的纯数据。'); }
    };
  }
  function resolvePolicy(value) {
    if (typeof value !== 'string' || value.length > 2048) return { allowed: false, code: 'unsupported_site', message: '当前页面不在试点范围。' };
    let url;
    try { url = new URL(value); } catch (_) { return { allowed: false, code: 'invalid_url', message: '页面地址无效。' }; }
    if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) {
      return { allowed: false, code: 'permission_pending', message: 'B 站处理授权待确认，当前不启用。' };
    }
    const allowed = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.port === '4173' && url.pathname === '/learning-lab/lesson.html'
      && !url.username && !url.password && !url.search && !url.hash;
    return allowed ? { allowed: true, code: 'controlled_pilot', mode: 'controlled-pilot',
      lessonId: PILOT_LESSON_ID, duration: PILOT_DURATION,
      message: '受控自制素材视觉验证；需显式开启。' }
      : { allowed: false, code: 'unsupported_site', message: '当前页面不在试点范围。' };
  }

  return { validateSource: guarded(source), validatePoints: guarded(points),
    validateRecord: guarded(record), validateSnapshot: guarded(snapshot), validateVisualResult: guarded(visualResult), resolvePolicy,
    PILOT_LESSON_ID, PILOT_DURATION, MAX_DURATION, MAX_POINTS };
});
