(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryScene = Object.assign(root.BreakGlass.geometryScene || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCENE_KEYS = ['schemaVersion', 'kind', 'requestId', 'videoId', 'frameTime', 'frameSize',
    'sceneRevision', 'rightAngleAt', 'labels', 'vertices', 'lengths', 'unit', 'source', 'originSource', 'editedByUser'];
  const SOURCES = new Set(['vision', 'preset', 'manual']);
  const UNITS = new Set(['unit', 'cm', 'm']);

  function reject(code, message) { return { ok: false, code, message }; }
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  /** Only own, enumerable data fields are accepted; accessors are not JSON data. */
  function exactKeys(value, required, optional = []) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
      && keys.every((key) => typeof key === 'string' && (required.includes(key) || optional.includes(key))
        && Object.getOwnPropertyDescriptor(value, key).enumerable
        && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
  }

  function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
  function sameFrameSize(left, right) {
    return Boolean(left && right && left.width === right.width && left.height === right.height);
  }

  /** Copy only already validated JSON data, never caller-owned objects. */
  function copyScene(scene) {
    const copy = {
      schemaVersion: scene.schemaVersion, kind: scene.kind, requestId: scene.requestId,
      videoId: scene.videoId, frameTime: scene.frameTime, frameSize: { ...scene.frameSize },
      sceneRevision: scene.sceneRevision, rightAngleAt: scene.rightAngleAt,
      labels: { ...scene.labels }, lengths: { ...scene.lengths }, unit: scene.unit,
      source: scene.source, originSource: scene.originSource, editedByUser: scene.editedByUser
    };
    if (Object.prototype.hasOwnProperty.call(scene, 'vertices')) {
      copy.vertices = scene.vertices === null ? null : {
        A: { ...scene.vertices.A }, B: { ...scene.vertices.B }, C: { ...scene.vertices.C }
      };
    }
    return copy;
  }

  /**
   * Validate one SceneResult; expected identities are exact, not playback tolerances.
   * @param {unknown} value
   * @param {{requestId?: string, videoId?: string, frameTime?: number, frameSize?: object, sceneRevision?: number, duration?: number}} [expected]
   * @returns {{ok: boolean, scene?: object, code?: string, message?: string}}
   */
  function validateScene(value, expected = {}) {
    const required = SCENE_KEYS.filter((key) => key !== 'vertices');
    if (!exactKeys(value, required, ['vertices'])) return reject('invalid_schema', '场景字段不符合固定结构。');
    if (value.schemaVersion !== '1.0.0' || value.kind !== 'right-triangle') {
      return reject('unsupported_scene', '只支持 1.0.0 版直角三角形。');
    }
    if (typeof value.requestId !== 'string' || !value.requestId.trim()
      || typeof value.videoId !== 'string' || !value.videoId.trim()) {
      return reject('invalid_identity', '缺少场景或视频标识。');
    }
    if (typeof value.frameTime !== 'number' || !Number.isFinite(value.frameTime) || value.frameTime < 0
      || !Number.isSafeInteger(value.sceneRevision) || value.sceneRevision < 0) {
      return reject('invalid_identity', '帧时间或场景修订号无效。');
    }
    if (!exactKeys(value.frameSize, ['width', 'height'])
      || !Number.isSafeInteger(value.frameSize.width) || value.frameSize.width <= 0
      || !Number.isSafeInteger(value.frameSize.height) || value.frameSize.height <= 0) {
      return reject('invalid_frame_size', '源视频尺寸必须是正整数。');
    }
    if (value.rightAngleAt !== 'A') return reject('unsupported_constraint', '请先确认 A 是直角顶点。');
    if (!exactKeys(value.labels, ['A', 'B', 'C'])) return reject('invalid_labels', '请填写 A、B、C 三个标签。');
    const labels = {};
    for (const key of ['A', 'B', 'C']) {
      if (typeof value.labels[key] !== 'string') return reject('invalid_labels', '标签必须是纯文本。');
      labels[key] = value.labels[key].trim();
      if (!labels[key] || Array.from(labels[key]).length > 16) return reject('invalid_labels', '标签须为 1 到 16 个字。');
    }
    if (new Set(Object.values(labels)).size !== 3) return reject('invalid_labels', '三个标签不能相同。');
    if (!exactKeys(value.lengths, ['AB', 'AC']) || !positive(value.lengths.AB) || !positive(value.lengths.AC)) {
      return reject('invalid_lengths', '两条直角边必须是正的有限数值。');
    }
    if (!UNITS.has(value.unit)) return reject('invalid_unit', '两条边须使用同一个支持的单位。');
    if (!SOURCES.has(value.source) || !SOURCES.has(value.originSource) || typeof value.editedByUser !== 'boolean') {
      return reject('invalid_source', '请明确场景来源与校对状态。');
    }
    if ((value.source === 'manual' && value.editedByUser !== true)
      || (value.source !== 'manual' && (value.originSource !== value.source || value.editedByUser !== false))) {
      return reject('invalid_source', '修改后的场景须标为手动，并保留原始来源。');
    }
    const hasVertices = Object.prototype.hasOwnProperty.call(value, 'vertices');
    if ((value.source === 'vision' && !value.vertices) || (hasVertices && value.vertices === undefined)) {
      return reject('invalid_vertices', '原帧位置应完整填写，或在手动场景中省略。');
    }
    if (hasVertices && value.vertices !== null) {
      if (!exactKeys(value.vertices, ['A', 'B', 'C'])) return reject('invalid_vertices', '原帧位置必须包含 A、B、C。');
      for (const point of Object.values(value.vertices)) {
        if (!exactKeys(point, ['x', 'y']) || typeof point.x !== 'number' || typeof point.y !== 'number'
          || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
          || point.x > value.frameSize.width || point.y > value.frameSize.height) {
          return reject('invalid_vertices', '点的位置必须在源视频画面内。');
        }
      }
      // Scale before the determinant: very large finite pixel coordinates cannot overflow it.
      const scale = Math.max(value.frameSize.width, value.frameSize.height);
      const { A, B, C } = value.vertices;
      const cross = ((B.x - A.x) / scale) * ((C.y - A.y) / scale)
        - ((B.y - A.y) / scale) * ((C.x - A.x) / scale);
      if (!Number.isFinite(cross) || cross === 0) return reject('invalid_vertices', '三个原帧点不能重合或共线。');
    }
    const BC = Math.hypot(value.lengths.AB, value.lengths.AC);
    const span = Math.max(value.lengths.AB, value.lengths.AC);
    const bx = value.lengths.AB / span;
    const cy = value.lengths.AC / span;
    if (!positive(BC) || !positive(bx) || !positive(cy)) {
      return reject('derived_non_finite', '边长组合无法生成有效的计算或绘图结果。');
    }
    if (!record(expected)) return reject('invalid_context', '帧校验上下文无效。');
    for (const key of ['requestId', 'videoId', 'frameTime', 'sceneRevision']) {
      if (Object.prototype.hasOwnProperty.call(expected, key) && value[key] !== expected[key]) {
        return reject('context_mismatch', '结果已不属于当前帧或修订。');
      }
    }
    if (Object.prototype.hasOwnProperty.call(expected, 'frameSize') && !sameFrameSize(value.frameSize, expected.frameSize)) {
      return reject('context_mismatch', '结果源尺寸与当前帧不一致。');
    }
    if (Object.prototype.hasOwnProperty.call(expected, 'duration')
      && (typeof expected.duration !== 'number' || !Number.isFinite(expected.duration)
        || expected.duration < 0 || value.frameTime > expected.duration)) {
      return reject('context_mismatch', '帧时间超出视频时长。');
    }
    const scene = copyScene(value);
    scene.labels = labels;
    return { ok: true, scene };
  }

  return { validateScene, copyScene, exactKeys, sameFrameSize };
});
