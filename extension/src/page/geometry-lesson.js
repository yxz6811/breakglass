/**
 * 几何阅读页：自己的视频可播放后自动阅读，破壁只取已存图形。
 * 不进入曲线唤醒，也不把失败换成预设。
 */
(function (root) {
  const PRESET_SRC = '../assets/video/geometry/triangle-3-4-5.mp4';

  /**
   * @param {object} [options]
   * @returns {{ dispose: () => void, session: object }}
   */
  function createGeometryLessonPage(options) {
    const settings = options || {};
    const document = settings.document || root.document;
    const window = settings.window || root;
    const BG = settings.BreakGlass || root.BreakGlass;
    const clock = settings.clock || {
      now: () => Date.now(),
      schedule: (delay, handler) => setTimeout(handler, delay),
      clear: (id) => clearTimeout(id)
    };
    const session = BG.geometryLessonSession.createGeometryLessonSession();
    const node = (id) => document.getElementById(id);
    const video = node('lesson-video');
    const listeners = [];
    let serial = 0;
    let ownUrl = '';
    let mode = 'none';
    let epoch = 0;
    let request = null;
    let probe = null;

    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {Function} handler
     */
    function listen(target, type, handler) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, handler);
      listeners.push([target, type, handler]);
    }

    function status(message) {
      const item = node('lesson-status');
      if (item) item.textContent = message || '';
    }

    function render() {
      const view = session.getState();
      const source = node('source-label');
      const note = node('figure-note');
      const derived = node('derived-value');
      const overlay = node('geometry-overlay');
      const wake = node('wake-button');
      const next = node('lesson-next');
      const reset = node('reset-button');
      const exit = node('exit-button');
      const primary = node('parameter-primary');
      const secondary = node('parameter-secondary');
      const primaryLabel = node('parameter-primary-label');
      const secondaryLabel = node('parameter-secondary-label');
      const primaryValue = node('parameter-primary-value');
      const secondaryValue = node('parameter-secondary-value');
      if (source) source.textContent = view.sourceLabel || '等待自己的视频';
      status(view.message);
      if (wake) wake.disabled = !session.canBreak(epoch);
      if (reset) reset.disabled = view.phase !== 'interactive';
      if (exit) exit.disabled = view.phase !== 'interactive';
      const current = view.currentId && session.getState();
      const point = view.phase === 'interactive' ? shownPoint() : null;
      const draft = point && view.draft;
      if (overlay) {
        overlay.hidden = !point;
        BG.geometryLessonView.render(overlay, point, draft);
      }
      const interactive = Boolean(point && draft);
      if (primary) primary.disabled = !interactive;
      if (secondary) secondary.disabled = !interactive || !point || point.kind !== 'right-triangle';
      if (secondary) secondary.hidden = !point || point.kind !== 'right-triangle';
      if (derived) derived.textContent = view.summary || '—';
      if (note) {
        note.textContent = point
          ? '这一层按画面标记调节，像素只用来摆放。'
          : '选择自己的视频后会自动阅读。预设不会冒充这次阅读。';
      }
      if (next) {
        const base = point || currentPoint();
        const later = base ? BG.geometryLessonReading.nextPoint(storedPoints(), base.time) : null;
        next.disabled = !base || view.seeking || (!later && view.phase !== 'reading');
        if (view.phase === 'reading') next.setAttribute('aria-label', '还在读');
        else if (!later && base) next.setAttribute('aria-label', '没有下一处');
        else next.setAttribute('aria-label', '下一个');
      }
      if (!interactive || !draft) return;
      bindSlider(primary, primaryLabel, primaryValue, point, draft, 0);
      bindSlider(secondary, secondaryLabel, secondaryValue, point, draft, 1);
      void current;
    }

    /** @type {object[]} */
    let points = [];
    /** @type {object | null} */
    let shown = null;
    /** @type {object | null} */
    let current = null;

    function storedPoints() {
      return points;
    }

    function shownPoint() {
      return shown;
    }

    function currentPoint() {
      return current || (session.getState().firstId ? points.find((item) => item.id === session.getState().firstId) || null : null);
    }

    /**
     * @param {HTMLInputElement | null} input
     * @param {HTMLElement | null} label
     * @param {HTMLElement | null} output
     * @param {object} point
     * @param {object} draft
     * @param {number} index
     */
    function bindSlider(input, label, output, point, draft, index) {
      if (!input || point.kind === 'right-triangle' && index === 1 && !draft.given.legs[1]) return;
      let name = '数值';
      let value = 1;
      if (point.kind === 'right-triangle') {
        const leg = draft.given.legs[index];
        if (!leg) return;
        name = leg.id;
        value = leg.length;
      } else if (index === 1) {
        return;
      } else if (point.kind === 'circle') {
        name = '半径';
        value = draft.given.radius;
      } else {
        name = '长度';
        value = draft.given.length;
      }
      if (label) label.textContent = name;
      if (output) output.textContent = BG.geometryLessonSolve.formatLength(value);
      if (document.activeElement === input) return;
      input.min = String(value > 1 ? value / 5 : 0.1);
      input.max = String(value * 3);
      input.step = 'any';
      input.value = String(value);
    }

    /**
     * @param {object[]} nextPoints
     * @param {object | null} nextShown
     * @param {object | null} nextCurrent
     */
    function remember(nextPoints, nextShown, nextCurrent) {
      points = nextPoints;
      shown = nextShown;
      current = nextCurrent;
    }

    function syncMemory() {
      const view = session.getState();
      const known = points.filter((item) => view.points.includes(item.id));
      shown = view.shownId ? known.find((item) => item.id === view.shownId) || shown : null;
      current = view.currentId ? known.find((item) => item.id === view.currentId) || current : null;
      if (view.phase === 'idle') {
        shown = null;
        current = null;
      }
    }

    /**
     * @param {object | null} point
     */
    function goTo(point) {
      if (!point || !video) return;
      video.pause();
      if (video.paused && Math.abs(Number(video.currentTime) - point.time) <= 0.2) {
        session.settle(epoch);
        current = point;
        render();
        return;
      }
      placeAt(point.time);
    }

    function stopRequest() {
      if (request) request.cancel();
      request = null;
      if (probe && probe.finish) probe.finish();
      probe = null;
    }

    /**
     * @param {number[]} times
     * @param {string} src
     * @returns {Promise<{ time: number, image: string }[]>}
     */
    function captureFrames(times, src) {
      const hook = window.__breakglassGeometryFrames;
      if (typeof hook === 'function') {
        return Promise.resolve().then(() => hook(times.slice())).then((frames) => (Array.isArray(frames) ? frames : [])).catch(() => []);
      }
      if (!times.length || typeof document.createElement !== 'function') return Promise.resolve([]);
      return new Promise((resolve) => {
        const item = document.createElement('video');
        const canvas = document.createElement('canvas');
        const frames = [];
        let index = 0;
        let done = false;
        const handle = { finish };
        probe = handle;
        function finish() {
          if (done) return;
          done = true;
          if (probe === handle) probe = null;
          resolve(frames);
        }
        function step() {
          if (probe !== handle || index >= times.length) {
            finish();
            return;
          }
          item.currentTime = times[index];
        }
        item.addEventListener('seeked', () => {
          if (done) return;
          const image = snapshot(item, canvas);
          if (image) frames.push({ time: times[index], image });
          index += 1;
          step();
        });
        item.addEventListener('loadeddata', function onLoaded() {
          item.removeEventListener('loadeddata', onLoaded);
          step();
        });
        item.addEventListener('error', finish);
        item.muted = true;
        item.src = src;
      });
    }

    /**
     * @param {HTMLVideoElement} item
     * @param {HTMLCanvasElement} canvas
     * @returns {string}
     */
    function snapshot(item, canvas) {
      const width = item.videoWidth;
      const height = item.videoHeight;
      if (!(width > 0 && height > 0) || !canvas || typeof canvas.getContext !== 'function') return '';
      const scale = Math.min(1, 640 / width);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return '';
      try {
        context.drawImage(item, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.72);
      } catch {
        return '';
      }
    }

    function maybeStart() {
      if (mode !== 'own' || !video) return;
      const duration = Number(video.duration);
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!(duration > 0) || !(width > 0) || !(height > 0)) return;
      const endpoint = node('lesson-endpoint');
      const url = endpoint ? String(endpoint.value || '').trim() : '';
      if (!url) {
        session.fail(epoch, '还没开始看。填上阅读地址后，这支片子会被看。');
        epoch = session.getState().epoch;
        render();
        return;
      }
      const course = BG.geometryLessonReading.prepareCourse(node('lesson-note') ? node('lesson-note').value : '');
      const times = BG.geometryLessonReading.sampleTimes(duration);
      const readingId = 'geometry-reading-' + (++serial);
      const videoId = 'geometry-local-' + serial;
      epoch = session.begin({
        readingId,
        videoId,
        duration,
        frameSize: { width, height },
        sampleTimes: times
      });
      remember([], null, null);
      render();
      const token = epoch;
      captureFrames(times, String(video.src || '')).then((frames) => {
        if (token !== session.getState().epoch) return;
        if (!frames.length) {
          session.fail(token, '外部阅读没有返回可用结果。这支片子留在画面上。');
          epoch = session.getState().epoch;
          render();
          return;
        }
        const body = BG.geometryLessonRequest.requestBody({
          readingId,
          videoId,
          duration,
          frameSize: { width, height },
          frames
        }, course);
        request = BG.geometryLessonRequest.postLesson({
          url,
          body,
          fetchImpl: settings.fetchImpl,
          clock
        });
        request.promise.then((result) => {
          if (token !== session.getState().epoch) return;
          request = null;
          if (!result.ok) {
            if (result.code === 'cancelled') return;
            session.fail(token, result.message);
            epoch = session.getState().epoch;
            render();
            return;
          }
          const accepted = session.accept(result.payload, token);
          if (!accepted.ok || !accepted.first) {
            if (accepted.ok) session.fail(token, '外部阅读没有返回可用结果。这支片子留在画面上。');
            else session.fail(token, '结果不属于这次阅读。这支片子留在画面上。');
            epoch = session.getState().epoch;
            remember([], null, null);
            render();
            return;
          }
          points = [accepted.first].concat(points.filter((item) => item.id !== accepted.first.id));
          const payloadPoints = Array.isArray(result.payload.points) ? result.payload.points : [];
          points = payloadPoints.filter((item) => session.getState().points.includes(item.id));
          goTo(accepted.first);
          render();
        });
      });
    }

    function useFile(file) {
      if (!file || !video) return;
      if (file.type && file.type.indexOf('video/') !== 0) {
        status('请选择一个视频文件。');
        return;
      }
      stopRequest();
      mode = 'own';
      if (ownUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(ownUrl);
      ownUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : 'blob:geometry-own';
      video.src = ownUrl;
      session.fail(epoch, '正在打开自己的视频。');
      epoch = session.getState().epoch;
      render();
    }

    function usePreset() {
      if (!video) return;
      stopRequest();
      mode = 'preset';
      video.src = PRESET_SRC;
      status('正在打开预先准备的示例。');
    }

    /**
     * 不支持 Range 的静态服务会把 seekable 停在 0，直接写 currentTime 不会动。
     * 预设改用媒体片段重新打开，自己的 blob 视频仍只写 currentTime。
     * @param {number} time
     */
    function placeAt(time) {
      video.pause();
      if (Math.abs(Number(video.currentTime) - time) <= 0.2) return;
      try { video.currentTime = time; } catch { /* 媒体还不能定位 */ }
      if (Math.abs(Number(video.currentTime) - time) <= 0.2 || mode !== 'preset') return;
      if (String(video.currentSrc || video.src).includes('#t=')) return;
      const url = new URL(PRESET_SRC, window.location.href);
      url.hash = 't=' + time;
      video.src = url.href;
    }

    function armPreset() {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = Number(video.duration);
      if (!(width > 0) || !(height > 0) || !(duration > 0)) return;
      const point = BG.geometryLessonSession.presetPoint({ width, height }, duration);
      if (session.getState().mode === 'preset' && Math.abs(Number(video.currentTime) - point.time) <= 0.2) {
        video.pause();
        return;
      }
      epoch = session.choosePreset(point, { width, height }, duration);
      points = [point];
      current = point;
      shown = null;
      placeAt(point.time);
      render();
    }

    function onPrimary(event) {
      const point = shownPoint();
      if (!point) return;
      const value = Number(event.target.value);
      const action = point.kind === 'right-triangle'
        ? { type: 'set_leg', id: point.given.legs[0].id, value }
        : point.kind === 'circle'
          ? { type: 'set_radius', value }
          : { type: 'set_length', value };
      session.adjust(epoch, action);
      render();
    }

    function onSecondary(event) {
      const point = shownPoint();
      if (!point || point.kind !== 'right-triangle') return;
      session.adjust(epoch, { type: 'set_leg', id: point.given.legs[1].id, value: Number(event.target.value) });
      render();
    }

    listen(node('local-video'), 'change', () => {
      const input = node('local-video');
      const file = input && input.files && input.files[0];
      if (file) useFile(file);
    });
    listen(node('preset-video'), 'click', usePreset);
    listen(node('lesson-cancel'), 'click', () => {
      stopRequest();
      session.cancel(epoch);
      epoch = session.getState().epoch;
      render();
    });
    listen(node('wake-button'), 'click', () => {
      if (!session.breakGlass(epoch)) return;
      shown = current || points.find((item) => item.id === session.getState().shownId) || null;
      render();
    });
    listen(node('reset-button'), 'click', () => {
      session.resetAdjustment(epoch);
      render();
    });
    listen(node('exit-button'), 'click', () => {
      session.exitGlass(epoch);
      shown = null;
      render();
    });
    listen(node('lesson-next'), 'click', () => {
      const result = session.requestNext(epoch);
      if (!result.ok) {
        status(result.message);
        render();
        return;
      }
      shown = null;
      const point = points.find((item) => item.time === result.time);
      if (point) goTo(point);
      render();
    });
    listen(node('parameter-primary'), 'input', onPrimary);
    listen(node('parameter-secondary'), 'input', onSecondary);
    listen(video, 'loadedmetadata', () => {
      if (mode === 'preset') armPreset();
      else maybeStart();
    });
    listen(video, 'seeked', () => {
      if (session.settle(epoch)) {
        current = points.find((item) => item.id === session.getState().currentId) || current;
        render();
      }
    });
    listen(video, 'play', () => {
      stopRequest();
      session.fail(epoch, '播放后这次阅读已取消。');
      epoch = session.getState().epoch;
      render();
    });
    listen(document, 'keydown', (event) => {
      if (!event || event.key !== 'Escape') return;
      const target = event.target;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      session.exitGlass(epoch);
      shown = null;
      render();
    });

    render();
    return {
      session,
      dispose() {
        stopRequest();
        listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler));
        if (ownUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(ownUrl);
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createGeometryLessonPage };
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.createGeometryLessonPage = createGeometryLessonPage;
  if (root.document && root.document.getElementById && root.document.getElementById('lesson-video')) {
    createGeometryLessonPage();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
