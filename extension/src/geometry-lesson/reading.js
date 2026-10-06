/**
 * 几何自动阅读的纯函数：复用曲线阅读的采样时刻，校验一帧一个白名单图形。
 * 不发请求，也不进入曲线会话。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryLessonReading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const COURSE_LIMIT = 8000;
  const LINE_LIMIT = 80;
  const UNITS = ['unit', 'cm', 'm'];
  const KINDS = ['right-triangle', 'circle', 'segment'];

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function codePoints(value) {
    return Array.from(String(value)).length;
  }

  /**
   * 采样时刻沿用开播前阅读，避免两套等分规则。
   * @param {number} duration 秒
   * @returns {number[]}
   */
  function sampleTimes(duration) {
    const lesson = root.BreakGlass && root.BreakGlass.lesson;
    if (lesson && typeof lesson.sampleTimes === 'function') return lesson.sampleTimes(duration);
    return [];
  }

  /**
   * 超长说明不送出。空说明仍允许阅读。
   * @param {unknown} text
   * @returns {{ ok: boolean, courseText: string, message: string }}
   */
  function prepareCourse(text) {
    const value = typeof text === 'string' ? text : '';
    if (codePoints(value) > COURSE_LIMIT) {
      return { ok: false, courseText: '', message: '请把课程说明缩短到 8000 字以内。这次不会送出说明。' };
    }
    return { ok: true, courseText: value, message: value ? '' : '这次没有课程文本。' };
  }

  /**
   * @param {unknown} value
   * @param {string[]} keys
   * @returns {boolean}
   */
  function exactKeys(value, keys) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length
      && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function label(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 16
      && !/[\u0000-\u001f\u007f]/.test(value);
  }

  /**
   * 带名字的端点仍要落在画面里。exactKeys 只约束纯像素点。
   * @param {unknown} point
   * @param {{ width: number, height: number }} frame
   * @returns {boolean}
   */
  function coordinate(point, frame) {
    return Boolean(point) && typeof point.x === 'number' && typeof point.y === 'number'
      && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.y >= 0 && point.x <= frame.width && point.y <= frame.height;
  }

  /**
   * @param {unknown} point
   * @param {{ width: number, height: number }} frame
   * @returns {boolean}
   */
  function pixel(point, frame) {
    return exactKeys(point, ['x', 'y']) && coordinate(point, frame);
  }

  /**
   * @param {object} leg
   * @param {string} right
   * @returns {string | null}
   */
  function farEnd(leg, right) {
    if (leg.from === right && leg.to !== right) return leg.to;
    if (leg.to === right && leg.from !== right) return leg.from;
    return null;
  }

  /**
   * @param {object} point
   * @param {{ width: number, height: number }} frame
   * @returns {string}
   */
  function figureProblem(point, frame) {
    if (!exactKeys(point, ['schemaVersion', 'id', 'readingId', 'videoId', 'time', 'frameSize', 'lessonLine', 'kind', 'unit', 'placement', 'given', 'derived'])) {
      return 'unknown';
    }
    if (point.schemaVersion !== '1.0.0' || !label(point.id) || point.videoId === 'fixture-parabola') return 'identity';
    if (typeof point.lessonLine !== 'string' || codePoints(point.lessonLine) > LINE_LIMIT) return 'incomplete';
    if (!KINDS.includes(point.kind) || !UNITS.includes(point.unit)) return point.kind && !KINDS.includes(point.kind) ? 'unsupported' : 'unit_mismatch';
    if (!exactKeys(point.frameSize, ['width', 'height']) || point.frameSize.width !== frame.width || point.frameSize.height !== frame.height) {
      return 'frame_size';
    }
    if (point.kind === 'right-triangle') return triangleProblem(point, frame);
    if (point.kind === 'circle') return circleProblem(point, frame);
    return segmentProblem(point, frame);
  }

  /**
   * @param {object} point
   * @param {{ width: number, height: number }} frame
   * @returns {string}
   */
  function triangleProblem(point, frame) {
    if (!exactKeys(point.placement, ['vertices']) || !exactKeys(point.given, ['rightAngleAt', 'legs'])
      || !exactKeys(point.derived, ['hypotenuse'])) return 'unknown';
    const right = point.given.rightAngleAt;
    const legs = point.given.legs;
    if (!label(right) || !Array.isArray(legs) || legs.length !== 2) return 'incomplete';
    if (!legs.every((leg) => exactKeys(leg, ['id', 'from', 'to', 'length']) && label(leg.id) && label(leg.from) && label(leg.to) && positive(leg.length))) {
      return 'not_finite';
    }
    const far = legs.map((leg) => farEnd(leg, right));
    if (far.some((name) => !name) || new Set([right, far[0], far[1]]).size !== 3) return 'incomplete';
    const names = [right, far[0], far[1]];
    if (!exactKeys(point.placement.vertices, names)) return 'incomplete';
    if (!names.every((name) => pixel(point.placement.vertices[name], frame))) return 'frame_size';
    const hypot = point.derived.hypotenuse;
    if (!exactKeys(hypot, ['id', 'from', 'to', 'length']) || !label(hypot.id)) return 'unknown';
    if (hypot.from !== far[0] || hypot.to !== far[1]) return 'incomplete';
    const expected = Math.hypot(legs[0].length, legs[1].length);
    if (typeof hypot.length !== 'number' || !Number.isFinite(hypot.length) || hypot.length !== expected) return 'derived';
    return '';
  }

  /**
   * @param {object} point
   * @param {{ width: number, height: number }} frame
   * @returns {string}
   */
  function circleProblem(point, frame) {
    if (!exactKeys(point.placement, ['center']) || !exactKeys(point.given, ['center', 'radius']) || !exactKeys(point.derived, [])) {
      return Object.keys(point.derived || {}).length ? 'unknown' : 'incomplete';
    }
    const center = point.given.center;
    if (!exactKeys(center, ['label', 'x', 'y']) || !label(center.label) || !coordinate(center, frame)) return 'incomplete';
    if (!positive(point.given.radius)) return 'not_finite';
    if (!exactKeys(point.placement.center, ['x', 'y']) || point.placement.center.x !== center.x || point.placement.center.y !== center.y) {
      return 'frame_size';
    }
    return '';
  }

  /**
   * @param {object} point
   * @param {{ width: number, height: number }} frame
   * @returns {string}
   */
  function segmentProblem(point, frame) {
    if (!exactKeys(point.placement, ['start', 'end']) || !exactKeys(point.given, ['start', 'end', 'length']) || !exactKeys(point.derived, [])) {
      return Object.keys(point.derived || {}).length ? 'unknown' : 'incomplete';
    }
    const { start, end, length } = point.given;
    if (!exactKeys(start, ['label', 'x', 'y']) || !exactKeys(end, ['label', 'x', 'y'])) return 'incomplete';
    if (!label(start.label) || !label(end.label) || start.label === end.label) return 'incomplete';
    if (!coordinate(start, frame) || !coordinate(end, frame)) return 'frame_size';
    if (start.x === end.x && start.y === end.y) return 'incomplete';
    if (!positive(length)) return 'not_finite';
    if (!pixel(point.placement.start, frame) || !pixel(point.placement.end, frame)) return 'frame_size';
    if (point.placement.start.x !== start.x || point.placement.start.y !== start.y
      || point.placement.end.x !== end.x || point.placement.end.y !== end.y) return 'frame_size';
    return '';
  }

  /**
   * @param {object} point
   * @param {{ readingId: string, videoId: string, duration: number, frameSize: { width: number, height: number }, sampleTimes?: number[] }} request
   * @returns {string} 空字符串表示通过
   */
  function pointProblem(point, request) {
    if (!point || typeof point !== 'object') return 'unknown';
    if (!request || point.readingId !== request.readingId || point.videoId !== request.videoId) return 'identity';
    if (typeof point.time !== 'number' || !Number.isFinite(point.time) || point.time < 0 || point.time > request.duration) return 'time';
    if (Array.isArray(request.sampleTimes) && !request.sampleTimes.includes(point.time)) return 'time';
    if (!request.frameSize) return 'frame_size';
    return figureProblem(point, request.frameSize);
  }

  /**
   * 按响应里的先后决定第一处，库存按时间升序。不足 1 秒时留下较早的时间。
   * @param {object} payload
   * @param {{ readingId: string, videoId: string, duration: number, frameSize: { width: number, height: number }, sampleTimes?: number[] }} request
   * @returns {{ ok: true, points: object[], first: object | null, dropped: object[] } | { ok: false, reason: string }}
   */
  function acceptReading(payload, request) {
    if (!payload || payload.schemaVersion !== '1.0.0' || payload.origin !== 'external') return { ok: false, reason: 'identity' };
    if (!request || payload.readingId !== request.readingId || payload.videoId !== request.videoId || payload.duration !== request.duration) {
      return { ok: false, reason: 'identity' };
    }
    const raw = Array.isArray(payload.points) ? payload.points : [];
    /** @type {object[]} */
    const kept = [];
    /** @type {{ time?: number, reason: string }[]} */
    const dropped = [];
    /** @type {object | null} */
    let first = null;
    raw.forEach((point) => {
      const reason = pointProblem(point, request);
      if (reason) {
        dropped.push({ time: point && typeof point.time === 'number' ? point.time : undefined, reason });
        return;
      }
      const clash = kept.find((item) => Math.abs(item.time - point.time) < 1);
      if (clash) {
        if (point.time >= clash.time) {
          dropped.push({ time: point.time, reason: 'gap' });
          return;
        }
        const removed = kept.splice(kept.indexOf(clash), 1)[0];
        dropped.push({ time: removed.time, reason: 'gap' });
        if (first && first.id === removed.id) first = null;
      }
      kept.push(point);
      if (!first) first = point;
    });
    kept.sort((left, right) => left.time - right.time);
    while (kept.length > 8) {
      const extra = kept.pop();
      if (extra) dropped.push({ time: extra.time, reason: 'limit' });
    }
    if (first && !kept.some((item) => item.id === first.id)) first = kept[0] || null;
    return { ok: true, points: kept, first, dropped };
  }

  /**
   * @param {object[]} points
   * @param {number} time
   * @returns {object | null}
   */
  function nextPoint(points, time) {
    if (!Array.isArray(points) || typeof time !== 'number' || !Number.isFinite(time)) return null;
    return points.filter((point) => point && point.time > time).sort((left, right) => left.time - right.time)[0] || null;
  }

  return {
    COURSE_LIMIT,
    sampleTimes,
    prepareCourse,
    pointProblem,
    acceptReading,
    nextPoint
  };
});
