/**
 * 几何阅读的当次状态。不进入曲线唤醒工厂。
 * 换片、播放和地址变更靠代次丢掉旧响应。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryLessonSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  /**
   * @returns {object}
   */
  function createGeometryLessonSession() {
    const readingApi = () => root.BreakGlass && root.BreakGlass.geometryLessonReading;
    const solveApi = () => root.BreakGlass && root.BreakGlass.geometryLessonSolve;
    const state = {
      phase: 'idle',
      epoch: 0,
      mode: 'none',
      readingId: '',
      videoId: '',
      duration: 0,
      frameSize: null,
      sampleTimes: [],
      points: [],
      first: null,
      current: null,
      shown: null,
      draft: null,
      pending: null,
      seeking: false,
      sourceLabel: '',
      message: '选择自己的视频。阅读地址填好后会自动开始。'
    };

    /**
     * @returns {object}
     */
    function snapshot() {
      return {
        phase: state.phase,
        epoch: state.epoch,
        mode: state.mode,
        readingId: state.readingId,
        videoId: state.videoId,
        duration: state.duration,
        frameSize: state.frameSize ? { ...state.frameSize } : null,
        points: state.points.map((point) => point.id),
        firstId: state.first ? state.first.id : null,
        currentId: state.current ? state.current.id : null,
        shownId: state.shown ? state.shown.id : null,
        seeking: state.seeking,
        sourceLabel: state.sourceLabel,
        message: state.message,
        draft: state.draft ? JSON.parse(JSON.stringify(state.draft)) : null,
        summary: state.shown && state.draft ? solveApi().summary(state.shown, state.draft.given) : ''
      };
    }

    function bump() {
      state.epoch += 1;
    }

    /**
     * @param {{ readingId: string, videoId: string, duration: number, frameSize: { width: number, height: number }, sampleTimes: number[] }} reading
     * @returns {number}
     */
    function begin(reading) {
      bump();
      state.phase = 'reading';
      state.mode = 'own';
      state.readingId = reading.readingId;
      state.videoId = reading.videoId;
      state.duration = reading.duration;
      state.frameSize = { ...reading.frameSize };
      state.sampleTimes = reading.sampleTimes.slice();
      state.points = [];
      state.first = null;
      state.current = null;
      state.shown = null;
      state.draft = null;
      state.pending = null;
      state.seeking = false;
      state.sourceLabel = '';
      state.message = '正在读这支片子里的几何图形。';
      return state.epoch;
    }

    /**
     * @param {object} payload
     * @param {number} epoch
     * @returns {{ ok: true, first: object | null } | { ok: false, reason: string }}
     */
    function accept(payload, epoch) {
      if (epoch !== state.epoch || state.phase !== 'reading') return { ok: false, reason: 'stale' };
      const verdict = readingApi().acceptReading(payload, {
        readingId: state.readingId,
        videoId: state.videoId,
        duration: state.duration,
        frameSize: state.frameSize,
        sampleTimes: state.sampleTimes
      });
      if (!verdict.ok) return verdict;
      state.points = verdict.points;
      state.first = verdict.first;
      state.pending = verdict.first;
      state.seeking = Boolean(verdict.first);
      state.phase = verdict.first ? 'seeking' : 'idle';
      state.message = verdict.first ? '正在停到第一处。' : '外部阅读没有返回可用结果。这支片子留在画面上。';
      if (!verdict.first) state.sourceLabel = '';
      return { ok: true, first: verdict.first };
    }

    /**
     * @param {number} epoch
     */
    function settle(epoch) {
      if (epoch !== state.epoch || !state.seeking || !state.pending) return false;
      state.current = state.pending;
      state.pending = null;
      state.seeking = false;
      state.shown = null;
      state.draft = null;
      state.phase = 'paused';
      state.message = state.current === state.first ? '第一处已经停下，可以破壁。' : '已停在下一处，可以破壁。';
      return true;
    }

    /**
     * @param {number} epoch
     * @returns {boolean}
     */
    function canBreak(epoch) {
      return epoch === state.epoch && !state.seeking && state.phase === 'paused' && Boolean(state.current || state.first);
    }

    /**
     * @param {number} epoch
     * @returns {boolean}
     */
    function breakGlass(epoch) {
      if (!canBreak(epoch)) return false;
      const point = state.current || state.first;
      state.current = point;
      state.shown = point;
      state.draft = { given: solveApi().copyGiven(point), derived: solveApi().derivedFor(point, point.given) };
      state.phase = 'interactive';
      state.sourceLabel = state.mode === 'preset' ? '预先准备的示例' : '这次几何阅读';
      state.message = state.sourceLabel;
      return true;
    }

    /**
     * @param {number} epoch
     * @param {{ type: string, id?: string, value?: number }} action
     * @returns {{ ok: boolean, reason?: string }}
     */
    function adjust(epoch, action) {
      if (epoch !== state.epoch || state.phase !== 'interactive' || !state.shown || !state.draft) return { ok: false, reason: 'stale' };
      const result = solveApi().adjust(state.shown, state.draft.given, action);
      if (!result.ok) return result;
      state.draft = { given: result.given, derived: result.derived };
      return { ok: true };
    }

    /**
     * @param {number} epoch
     */
    function resetAdjustment(epoch) {
      if (epoch !== state.epoch || !state.shown) return false;
      state.draft = { given: solveApi().copyGiven(state.shown), derived: solveApi().derivedFor(state.shown, state.shown.given) };
      state.phase = 'interactive';
      return true;
    }

    /**
     * @param {number} epoch
     */
    function exitGlass(epoch) {
      if (epoch !== state.epoch) return false;
      state.shown = null;
      state.draft = null;
      if (state.current || state.first) state.phase = 'paused';
      state.message = '已退出几何层。';
      return true;
    }

    /**
     * @param {number} epoch
     * @returns {{ ok: true, time: number } | { ok: false, reason: string, message: string }}
     */
    function requestNext(epoch) {
      if (epoch !== state.epoch) return { ok: false, reason: 'stale', message: '' };
      const base = state.current || state.first;
      if (!base) {
        if (state.phase === 'reading') {
          state.message = '还在读';
          return { ok: false, reason: 'reading', message: '还在读' };
        }
        return { ok: false, reason: 'empty', message: '还没有可去的下一处。' };
      }
      const later = readingApi().nextPoint(state.points, base.time);
      if (!later) {
        if (state.phase === 'reading') {
          state.message = '还在读';
          return { ok: false, reason: 'reading', message: '还在读' };
        }
        state.message = '没有下一处';
        return { ok: false, reason: 'none', message: '没有下一处' };
      }
      state.shown = null;
      state.draft = null;
      state.pending = later;
      state.seeking = true;
      state.phase = 'seeking';
      state.message = '正在定位到下一处。';
      return { ok: true, time: later.time };
    }

    /**
     * 取消未完成的采样。已经存下的点保留。
     * @param {number} epoch
     */
    function cancel(epoch) {
      if (epoch !== state.epoch || state.phase !== 'reading') return false;
      bump();
      state.phase = state.first ? 'paused' : 'idle';
      state.message = state.first ? '已取消阅读。已经存下的点还在。' : '已取消阅读。这支片子留在画面上。';
      return true;
    }

    /**
     * @param {number} epoch
     * @param {string} message
     */
    function fail(epoch, message) {
      if (epoch !== state.epoch) return false;
      bump();
      const label = state.sourceLabel;
      state.points = [];
      state.first = null;
      state.current = null;
      state.shown = null;
      state.draft = null;
      state.pending = null;
      state.seeking = false;
      state.phase = 'idle';
      state.mode = 'own';
      state.sourceLabel = label && state.mode === 'preset' ? label : '';
      state.sourceLabel = '';
      state.message = message;
      return true;
    }

    /**
     * @param {object} point
     * @param {{ width: number, height: number }} frameSize
     * @param {number} duration
     * @returns {number}
     */
    function choosePreset(point, frameSize, duration) {
      bump();
      state.phase = 'paused';
      state.mode = 'preset';
      state.readingId = point.readingId;
      state.videoId = point.videoId;
      state.duration = duration;
      state.frameSize = { ...frameSize };
      state.sampleTimes = [point.time];
      state.points = [point];
      state.first = point;
      state.current = point;
      state.shown = null;
      state.draft = null;
      state.pending = null;
      state.seeking = false;
      state.sourceLabel = '预先准备的示例';
      state.message = '预先准备的示例已就绪。破壁不会把它当成自动阅读。';
      return state.epoch;
    }

    return {
      getState: snapshot,
      begin,
      accept,
      settle,
      canBreak,
      breakGlass,
      adjust,
      resetAdjustment,
      exitGlass,
      requestNext,
      cancel,
      fail,
      choosePreset
    };
  }

  /**
   * 预设只带写明的 3 和 4，像素按当前画幅摆放，不测量边长。
   * @param {{ width: number, height: number }} frameSize
   * @param {number} duration
   * @returns {object}
   */
  function presetPoint(frameSize, duration) {
    const width = frameSize.width;
    const height = frameSize.height;
    const time = duration >= 4 ? 4 : duration / 2;
    const vertices = {
      A: { x: width * 0.25, y: height * 0.72 },
      B: { x: width * 0.72, y: height * 0.72 },
      C: { x: width * 0.25, y: height * 0.28 }
    };
    return {
      schemaVersion: '1.0.0',
      id: 'preset-triangle',
      readingId: 'preset-geometry',
      videoId: 'preset-triangle-3-4-5',
      time,
      frameSize: { width, height },
      lessonLine: '预先准备的直角三角形，直角边 3 和 4 厘米。',
      kind: 'right-triangle',
      unit: 'cm',
      placement: { vertices },
      given: {
        rightAngleAt: 'A',
        legs: [
          { id: 'AB', from: 'A', to: 'B', length: 3 },
          { id: 'AC', from: 'A', to: 'C', length: 4 }
        ]
      },
      derived: { hypotenuse: { id: 'BC', from: 'B', to: 'C', length: 5 } }
    };
  }

  return { createGeometryLessonSession, presetPoint };
});
