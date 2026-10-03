/**
 * 开播前阅读的纯函数：稀疏采样、校验、第一处和下一处。
 * 不读取页面，不发起请求，也不调用唤醒工厂。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.lesson = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const MAX_POINTS = 8;
  const MIN_GAP = 1;
  const SHORT_DURATION = 2;
  const LINE_LIMIT = 80;

  /**
   * 按码点计长度，避免把代理对当成两个字。
   * @param {unknown} value
   * @returns {number}
   */
  function codePointLength(value) {
    return Array.from(String(value)).length;
  }

  /**
   * 相邻不足 1 秒时丢掉较晚的时刻。
   * @param {number[]} times 秒
   * @returns {number[]}
   */
  function collapseCloseTimes(times) {
    const sorted = (Array.isArray(times) ? times : [])
      .filter((time) => typeof time === 'number' && Number.isFinite(time))
      .slice()
      .sort((left, right) => left - right);
    const kept = [];
    sorted.forEach((time) => {
      if (kept.length === 0 || time - kept[kept.length - 1] >= MIN_GAP) kept.push(time);
    });
    return kept.slice(0, MAX_POINTS);
  }

  /**
   * 整段等分取中点。短于 2 秒只取一处，最多 8 处，不从 0 逐帧递增。
   * @param {number} duration 秒
   * @returns {number[]}
   */
  function sampleTimes(duration) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return [];
    if (duration < SHORT_DURATION) return [duration / 2];
    const segments = Math.max(1, Math.min(MAX_POINTS, Math.floor(duration)));
    const width = duration / segments;
    const times = [];
    for (let index = 0; index < segments; index += 1) {
      times.push(width * index + width / 2);
    }
    return collapseCloseTimes(times);
  }

  /**
   * @param {typeof globalThis} scope
   * @returns {Function | null}
   */
  function curveValidator(scope) {
    const live = scope.BreakGlass && scope.BreakGlass.validate && scope.BreakGlass.validate.validateCurveResult;
    if (live) return live;
    if (typeof require === 'function') {
      try {
        return require('../curve/validate').validateCurveResult;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  /**
   * @param {object} point
   * @param {object} reading
   * @param {{ width: number, height: number }} sourceSize
   * @param {Function} validate
   * @returns {string | null} 丢掉原因；通过时为 null
   */
  function rejectPoint(point, reading, sourceSize, validate, request) {
    if (!point || typeof point.id !== 'string' || point.id.length === 0) return '抛物线没有通过检查';
    if (typeof point.lessonLine !== 'string' || codePointLength(point.lessonLine) === 0 || codePointLength(point.lessonLine) > LINE_LIMIT) {
      return '抛物线没有通过检查';
    }
    if (!point.curve || point.curve.videoId !== reading.videoId) return '不是这一段视频';
    if (typeof point.time !== 'number' || !Number.isFinite(point.time) || point.time < 0) return '时间无效';
    if (point.time > reading.duration) return '落在视频外面';
    if (request && !request.sampleTimes.includes(point.time)) return '时间无效';
    const verdict = validate(point.curve, {
      videoId: reading.videoId,
      frameSize: sourceSize
    });
    if (!verdict.ok) {
      if (verdict.code === 'video_mismatch') return '不是这一段视频';
      return '抛物线没有通过检查';
    }
    if (point.curve.source !== 'preset' || point.curve.fallback !== null) return '抛物线没有通过检查';
    if (point.curve.time !== point.time) return '抛物线没有通过检查';
    return null;
  }

  /**
   * 先按时间丢掉靠得太近的较晚一点，再只留最早的 8 个。
   * @param {object[]} arrivals 已经通过单点检查、按到达顺序排列
   * @returns {{ kept: object[], dropped: { reason: string }[] }}
   */
  function retain(arrivals) {
    const dropped = [];
    const byTime = arrivals.slice().sort((left, right) => left.time - right.time);
    const spaced = [];
    byTime.forEach((point) => {
      const previous = spaced[spaced.length - 1];
      if (previous && point.time - previous.time < MIN_GAP) {
        dropped.push({ reason: '和上一个点靠得太近' });
        return;
      }
      spaced.push(point);
    });
    const kept = spaced.slice(0, MAX_POINTS);
    spaced.slice(MAX_POINTS).forEach(() => dropped.push({ reason: '超出八个点' }));
    return { kept, dropped };
  }

  /**
   * @param {object} reading
   * @param {{ width: number, height: number }} sourceSize
   * @param {{ readingId: string, videoId: string, duration: number, sampleTimes: number[] }} [request] 当次实际发送的帧，而非重新推算的采样表
   * @returns {{ ok: boolean, points: object[], dropped: { reason: string }[], first: object | null }}
   */
  function validateLessonReading(reading, sourceSize, request) {
    const validate = curveValidator(root);
    if (!reading || reading.origin !== 'external' || typeof reading.readingId !== 'string' || reading.readingId.length === 0 ||
        typeof reading.videoId !== 'string' || reading.videoId.length === 0 ||
        typeof reading.duration !== 'number' || !Number.isFinite(reading.duration) || reading.duration <= 0 ||
        !sourceSize || !(sourceSize.width > 0) || !(sourceSize.height > 0) || !validate) {
      return { ok: false, points: [], dropped: [{ reason: '不是这一段视频' }], first: null };
    }
    if (request && (reading.readingId !== request.readingId || reading.videoId !== request.videoId ||
        reading.duration !== request.duration || !Array.isArray(request.sampleTimes) ||
        request.sampleTimes.length === 0 || request.sampleTimes.length > MAX_POINTS ||
        (request.frameSize && (request.frameSize.width !== sourceSize.width || request.frameSize.height !== sourceSize.height)) ||
        request.sampleTimes.some((time) => typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > request.duration))) {
      return { ok: false, points: [], dropped: [{ reason: '不是这一段视频' }], first: null };
    }
    const dropped = [];
    const arrivals = [];
    const seenIds = new Set();
    const seenLines = new Set();
    (Array.isArray(reading.points) ? reading.points : []).forEach((point) => {
      if (point && seenIds.has(point.id)) {
        dropped.push({ reason: '抛物线没有通过检查' });
        return;
      }
      if (point && typeof point.lessonLine === 'string' && seenLines.has(point.lessonLine)) {
        dropped.push({ reason: '抛物线没有通过检查' });
        return;
      }
      const reason = rejectPoint(point, reading, sourceSize, validate, request);
      if (reason) {
        dropped.push({ reason });
        return;
      }
      seenIds.add(point.id);
      seenLines.add(point.lessonLine);
      arrivals.push(point);
    });
    const retained = retain(arrivals);
    const keptIds = new Set(retained.kept.map((point) => point.id));
    const first = arrivals.find((point) => keptIds.has(point.id)) || null;
    const points = retained.kept.slice().sort((left, right) => left.time - right.time);
    return { ok: true, points, dropped: dropped.concat(retained.dropped), first };
  }

  /**
   * 按校验完成（到达）顺序的第一处，调用方传入的就是这个顺序。
   * @param {object[]} points
   * @returns {object | null}
   */
  function firstAccepted(points) {
    return Array.isArray(points) && points.length > 0 ? points[0] : null;
  }

  /**
   * 只返回时间严格更晚的下一处。
   * @param {object[]} points
   * @param {number} time 当前点的秒数
   * @returns {object | null}
   */
  function nextPoint(points, time) {
    if (!Array.isArray(points) || typeof time !== 'number' || !Number.isFinite(time)) return null;
    const later = points.filter((point) => point && typeof point.time === 'number' && point.time > time);
    later.sort((left, right) => left.time - right.time);
    return later[0] || null;
  }

  return {
    MAX_POINTS,
    sampleTimes,
    collapseCloseTimes,
    validateLessonReading,
    firstAccepted,
    nextPoint
  };
});
