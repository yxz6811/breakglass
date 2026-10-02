(function () {
  'use strict';

  const {
    geometry,
    alignment,
    preset,
    frameFit,
    session: sessionApi,
    wake: wakeApi,
    latency: latencyApi
  } = window.BreakGlass;
  const $ = (selector) => document.querySelector(selector);
  const video = $('#demo-video');
  const stage = $('#video-stage');
  const targetInput = $('#target-time');
  const playToggle = $('#play-toggle');
  const jumpTarget = $('#jump-target');
  const wakeButton = $('#wake-button');
  const cancelButton = $('#cancel-button');
  const retryButton = $('#retry-button');
  const resetButton = $('#reset-button');
  const exitButton = $('#exit-button');
  const slider = $('#parameter-h');
  const sliderValue = $('#parameter-h-value');
  const sourceLabel = $('#source-label');
  const sourceNote = $('#source-note');
  const stateLabel = $('#state-label');
  const timeLabel = $('#time-label');
  const assetEmpty = $('#asset-empty');
  const runtimeNote = $('#runtime-note');

  /**
   * 相对演示页的扩展包视频。仓库落盘路径只写在 extension/assets/video/README.md。
   * @type {string}
   */
  const PACKAGED_VIDEO_URL = '../assets/video/breakglass-demo-9s.mp4';

  /**
   * 包内 9 秒演示片的目标时间（秒）。输入框初值用它。
   * 夹具 JSON 里的 time 不作为演示默认值，磁盘上的 JSON 也不改。
   * @type {number}
   */
  const PACKAGED_DEMO_TARGET_SECONDS = 6;

  let config = null;
  let presetResult = null;
  let preparedFrame = null;
  let preparedRegion = null;
  let controller = null;
  let wakeHandle = null;
  let latencies = null;
  let localClock = null;
  let overlay = null;
  let dragging = false;
  let resizeObserver = null;
  let dprQuery = null;
  let dprHandler = null;

  function createClock() {
    const read = window.performance && typeof window.performance.now === 'function'
      ? () => window.performance.now()
      : () => Date.now();
    return {
      now: read,
      schedule: (delayMs, handler) => window.setTimeout(handler, delayMs),
      clear: (handle) => window.clearTimeout(handle)
    };
  }

  /**
   * 文件可读时才把演示 video 指到扩展包内的 mp4。
   * 缺失时不设置 src，避免 error 事件把空状态改成加载失败。
   * @returns {Promise<boolean>} 是否已把地址交给演示 video
   */
  async function attachPackagedVideo() {
    try {
      const response = await fetch(PACKAGED_VIDEO_URL, { headers: { Range: 'bytes=0-0' } });
      if (response.body) await response.body.cancel();
      if (!response.ok) return false;
    } catch {
      return false;
    }
    video.src = PACKAGED_VIDEO_URL;
    return true;
  }

  function setStatus(message) {
    stateLabel.textContent = message;
  }

  function targetTime() {
    return Number(targetInput.value);
  }

  /**
   * 会话是否允许破壁，以目标时间输入框的当前值为准。
   * 内存里的预制结果时间一并跟上，校验仍对照会话目标；磁盘上的 JSON 不改。
   */
  function syncSessionTarget() {
    if (!controller) return;
    const nextTarget = targetTime();
    if (!Number.isFinite(nextTarget)) return;
    controller.targetTime = nextTarget;
    if (presetResult && typeof presetResult === 'object') presetResult.time = nextTarget;
  }

  /**
   * 目标时间容差只问会话。页面不再自己比较 ±0.2 秒。
   * @returns {boolean}
   */
  function atTarget() {
    syncSessionTarget();
    if (!controller || !video || !(video.videoWidth > 0)) return false;
    return controller.canWake({ paused: video.paused, currentTime: video.currentTime });
  }

  /**
   * @returns {ReturnType<SessionController['getState']> | null}
   */
  function sessionState() {
    return controller ? controller.getState() : null;
  }

  function sourceText(result) {
    if (!result) return '等待素材';
    if (result.fallback === 'timeout') return '预先准备的示例 · 超时回退';
    return result.source === 'preset' ? '预先准备的示例' : '来源不可用';
  }

  function setSource(result, note) {
    sourceLabel.textContent = sourceText(result);
    if (note !== undefined) {
      sourceNote.textContent = note;
      return;
    }
    sourceNote.textContent = result
      ? (result.fallback === 'timeout' ? '因等待超过 1.5 秒，改用预先准备的示例。' : '这是扩展包内预先准备的示例，不代表实时识别成功。')
      : '数据来源将在交互出现后显示。';
  }

  function hideWaitingControls() {
    cancelButton.hidden = true;
    cancelButton.disabled = true;
    retryButton.hidden = true;
    retryButton.disabled = true;
  }

  // 坐标换算统一走 geometry/alignment.js，页面不再另写一套映射。
  function pagePointForMath(definition, parameters, mathX, rect) {
    const point = alignment.mathPointToPage(definition, parameters, mathX, rect.scale);
    return [point.x, point.y];
  }

  function parsePathPoints(data) {
    const points = [];
    const pattern = /[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    let match = pattern.exec(data);
    while (match) {
      points.push({ x: Number(match[1]), y: Number(match[2]) });
      match = pattern.exec(data);
    }
    return points;
  }

  // 只读测量输出：比较期望页面点与刚写入 DOM 的 path 采样点，供手工验收核对。
  function publishAlignment(definition, parameters, rect, pathData) {
    const drawn = parsePathPoints(pathData);
    const report = alignment.sampleAlignment({
      definition,
      parameters,
      scale: rect.scale,
      contentRect: rect.contentRect,
      samples: 9,
      readActual: (mathX) => {
        if (drawn.length === 0) return null;
        const ratio = (mathX - definition.domain.min) / (definition.domain.max - definition.domain.min);
        const index = Math.max(0, Math.min(drawn.length - 1, Math.round(ratio * (drawn.length - 1))));
        return drawn[index];
      }
    });
    window.__breakglassAlignment = {
      contentRect: { ...rect.contentRect },
      scale: rect.scale,
      samples: report.points.length,
      maxRatio: report.maxRatio,
      tolerance: report.tolerance,
      withinTolerance: report.withinTolerance,
      at: localClock ? localClock.now() : Date.now()
    };
    return window.__breakglassAlignment;
  }

  // 窗口、全屏、设备像素比和视频元素尺寸变化后都要重算坐标。
  function watchDevicePixelRatio() {
    if (!window.matchMedia) return;
    if (dprQuery && dprHandler && typeof dprQuery.removeEventListener === 'function') {
      dprQuery.removeEventListener('change', dprHandler);
    }
    const dpr = window.devicePixelRatio || 1;
    dprQuery = window.matchMedia('(resolution: ' + dpr + 'dppx)');
    dprHandler = () => { watchDevicePixelRatio(); drawCurve(); };
    if (dprQuery && typeof dprQuery.addEventListener === 'function') {
      dprQuery.addEventListener('change', dprHandler);
    }
  }

  function watchVideoSize() {
    if (typeof window.ResizeObserver !== 'function' || !video) return;
    resizeObserver = new window.ResizeObserver(() => drawCurve());
    resizeObserver.observe(video);
  }

  function releaseWatch() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (dprQuery && dprHandler && typeof dprQuery.removeEventListener === 'function') {
      dprQuery.removeEventListener('change', dprHandler);
    }
    dprQuery = null;
    dprHandler = null;
  }

  function drawCurve() {
    const state = sessionState();
    if (!state || state.status !== 'interactive' || !state.result || !overlay) return;
    const result = state.result;
    const definition = result.definition;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!(videoWidth > 0 && videoHeight > 0)) return;
    const rect = geometry.getContentRect({
      elementRect: video.getBoundingClientRect(),
      videoWidth,
      videoHeight,
      objectFit: getComputedStyle(video).objectFit || 'contain',
      objectPosition: getComputedStyle(video).objectPosition || '50% 50%'
    });
    if (!rect) return;

    const stageRect = stage.getBoundingClientRect();
    overlay.style.left = `${rect.contentRect.left - stageRect.left}px`;
    overlay.style.top = `${rect.contentRect.top - stageRect.top}px`;
    overlay.style.width = `${rect.contentRect.width}px`;
    overlay.style.height = `${rect.contentRect.height}px`;
    overlay.setAttribute('viewBox', `0 0 ${rect.contentRect.width} ${rect.contentRect.height}`);

    const parameters = state.currentParameters;
    const path = [];
    for (let index = 0; index <= 80; index += 1) {
      const x = definition.domain.min + (definition.domain.max - definition.domain.min) * index / 80;
      const [px, py] = pagePointForMath(definition, parameters, x, rect);
      path.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
    }
    const pathData = path.join(' ');
    overlay.querySelector('path').setAttribute('d', pathData);
    publishAlignment(definition, parameters, rect, pathData);

    const dragParameter = definition.dragParameter;
    const dragValue = parameters[dragParameter];
    const [cx, cy] = pagePointForMath(definition, parameters, dragParameter === 'h' ? dragValue : definition.domain.min, rect);
    const handle = overlay.querySelector('circle');
    handle.setAttribute('cx', cx.toFixed(2));
    handle.setAttribute('cy', cy.toFixed(2));

    slider.value = String(parameters.h ?? 0);
    sliderValue.textContent = Number(parameters.h ?? 0).toFixed(1);
  }

  function removeOverlay({ pauseVideo = true } = {}) {
    if (wakeHandle) wakeHandle.exit();
    if (overlay) overlay.remove();
    overlay = null;
    dragging = false;
    if (pauseVideo && video && !video.paused) video.pause();
    resetButton.disabled = true;
    exitButton.disabled = true;
    slider.disabled = true;
    hideWaitingControls();
    setSource(null);
    setStatus(atTarget() ? '已暂停在目标时间，可以再次破壁。' : '请暂停在目标时间。');
    wakeButton.disabled = !(atTarget() && Boolean(presetResult));
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.classList.add('curve-overlay');
    overlay.style.position = 'absolute';
    overlay.style.zIndex = '2';
    overlay.setAttribute('aria-label', '可拖动的预先准备抛物线');
    overlay.innerHTML = '<path fill="none" stroke="#71ddff" stroke-width="3" stroke-linecap="round"></path><circle r="10" fill="#08111f" stroke="#ffffff" stroke-width="3" tabindex="0"></circle>';
    stage.appendChild(overlay);

    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) {
        removeOverlay();
        return;
      }
      dragging = true;
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', (event) => {
      const state = sessionState();
      if (!dragging || !state || !state.result) return;
      const result = state.result;
      const definition = result.definition;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!(videoWidth > 0 && videoHeight > 0)) return;
      const rect = geometry.getContentRect({
        elementRect: video.getBoundingClientRect(),
        videoWidth,
        videoHeight,
        objectFit: getComputedStyle(video).objectFit || 'contain',
        objectPosition: getComputedStyle(video).objectPosition || '50% 50%'
      });
      if (!rect) return;
      const sourceX = (event.clientX - rect.contentRect.left) / rect.scale;
      const mathX = definition.domain.min +
        ((sourceX - definition.region.x) / definition.region.width) * (definition.domain.max - definition.domain.min);
      controller.updateParameter(definition.dragParameter, mathX);
      drawCurve();
    });
    overlay.addEventListener('pointerup', (event) => {
      dragging = false;
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    });
    drawCurve();
  }

  function syncControls() {
    if (wakeHandle && controller) {
      syncSessionTarget();
      const before = controller.getState();
      const wasActive = before.status === 'waiting' || before.status === 'interactive';
      const playbackState = wakeHandle.onPlaybackChange({
        paused: video.paused,
        currentTime: video.currentTime
      });
      if (wasActive && playbackState.status === 'paused-ready') {
        if (overlay) removeOverlay({ pauseVideo: false });
        else {
          hideWaitingControls();
          setSource(null);
        }
      }
    }
    const waiting = Boolean(sessionState() && sessionState().status === 'waiting');
    const ready = atTarget() && Boolean(presetResult);
    wakeButton.disabled = waiting || !ready || Boolean(overlay);
    playToggle.textContent = video.paused ? '播放' : '暂停';
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
  }

  /**
   * 只按会话状态渲染。超时耗时用页面自己的两次 mark，不读唤醒回调里的时间戳。
   * @param {object} state
   */
  function applyState(state) {
    if (!state) return;
    if (state.status === 'interactive') {
      const result = state.result;
      const timedOut = result && result.fallback === 'timeout';
      if (timedOut && latencies) latencies.mark('timeout-decided');
      createOverlay();
      if (timedOut && latencies) {
        const visibleAt = latencies.mark('svg-visible');
        const decidedAt = latencies.measure('timeout-decided', 'svg-visible');
        if (Number.isFinite(visibleAt) && Number.isFinite(decidedAt)) {
          latencies.record('fallback-visible', decidedAt);
        }
      }
      hideWaitingControls();
      resetButton.disabled = false;
      exitButton.disabled = false;
      slider.disabled = false;
      setSource(result);
      setStatus(timedOut
        ? '已改用预先准备的示例（超时回退），可拖动控制点。'
        : '交互已出现，可拖动控制点改变水平位置。');
      syncControls();
      return;
    }
    if (state.status === 'waiting') {
      cancelButton.hidden = false;
      cancelButton.disabled = false;
      retryButton.hidden = true;
      retryButton.disabled = true;
      resetButton.disabled = true;
      slider.disabled = true;
      wakeButton.disabled = true;
      setSource(null, '正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。');
      setStatus('正在等待外部结果…');
      if (cancelButton.focus) cancelButton.focus();
      return;
    }
    if (state.status === 'recoverable-error') {
      hideWaitingControls();
      retryButton.hidden = false;
      retryButton.disabled = false;
      resetButton.disabled = true;
      slider.disabled = true;
      wakeButton.disabled = true;
      setSource(null, '没有可用的准备结果，或外部结果不可用；可以重试或退出。');
      setStatus(state.message || '结果不可用，请重试或退出。');
      if (retryButton.focus) retryButton.focus();
    }
  }

  /**
   * 破壁前把包内预制区域按当前片子的宽、高比例放进这一帧。
   * 每次都从准备画幅重算，避免连续破壁把已经换算过的坐标再乘一次。
   * 外部结果不走这里；画幅对不上时仍由校验拒绝。
   * @param {{ width: number, height: number }} frameSize
   * @returns {boolean}
   */
  function placePreparedExample(frameSize) {
    if (!frameFit || !presetResult || !preparedFrame || !preparedRegion) return false;
    const placed = frameFit.placeRegionInFrame(preparedFrame, preparedRegion, frameSize);
    if (!placed) return false;
    presetResult.frameSize.width = placed.frameSize.width;
    presetResult.frameSize.height = placed.frameSize.height;
    const region = presetResult.definition.region;
    region.x = placed.region.x;
    region.y = placed.region.y;
    region.width = placed.region.width;
    region.height = placed.region.height;
    if (controller && controller.frameSize) {
      controller.frameSize.width = placed.frameSize.width;
      controller.frameSize.height = placed.frameSize.height;
    }
    return true;
  }

  function wake() {
    if (!wakeHandle || !presetResult || !atTarget()) {
      setStatus('请先暂停在目标时间。');
      return;
    }
    const state = sessionState();
    if (overlay || (state && (state.status === 'interactive' || state.status === 'waiting'))) return;
    const frameSize = { width: video.videoWidth, height: video.videoHeight };
    placePreparedExample(frameSize);
    const started = wakeHandle.start({
      paused: true,
      currentTime: video.currentTime,
      frameSize
    });
    if (!started.ok) setStatus(started.message || '暂时无法破壁。');
  }

  function cancelWaiting() {
    if (!wakeHandle || !sessionState() || sessionState().status !== 'waiting') return;
    wakeHandle.cancel();
    hideWaitingControls();
    setSource(null, '已取消等待，迟到结果不会再打开交互层。');
    setStatus(atTarget() ? '已取消等待，可以再次破壁。' : '请暂停在目标时间。');
    wakeButton.disabled = !(atTarget() && Boolean(presetResult));
  }

  async function boot() {
    const packagedPromise = attachPackagedVideo();
    try {
      const loaded = await preset.loadPreset();
      if (!loaded.ok) throw new Error(loaded.message);
      config = loaded.config;
      presetResult = loaded.result;
      preparedFrame = {
        width: presetResult.frameSize.width,
        height: presetResult.frameSize.height
      };
      preparedRegion = {
        x: presetResult.definition.region.x,
        y: presetResult.definition.region.y,
        width: presetResult.definition.region.width,
        height: presetResult.definition.region.height
      };
      targetInput.value = String(PACKAGED_DEMO_TARGET_SECONDS);
      controller = new sessionApi.SessionController({
        videoId: presetResult.videoId,
        targetTime: targetTime(),
        frameSize: presetResult.frameSize,
        externalAttempt: config.externalAttempt
      });
      syncSessionTarget();
      localClock = createClock();
      latencies = latencyApi.createLatencyLog({ clock: localClock });
      wakeHandle = wakeApi.createWake({
        session: controller,
        config,
        preset: presetResult,
        clock: localClock,
        onChange: (state) => applyState(state)
      });
      window.__breakglassLatency = {
        summary: () => latencies.summary(),
        snapshot: () => latencies.snapshot()
      };
      watchDevicePixelRatio();
      watchVideoSize();
      runtimeNote.textContent = `配置：${config.externalAttempt} · 本地预制已预热 · 回退 ${config.fallbackAfterMs}ms`;
      const packaged = await packagedPromise;
      if (!packaged && !video.error) {
        setStatus('正式视频素材尚未提供，加载视频后可验证交互。');
      }
      setSource(null);
    } catch (error) {
      runtimeNote.textContent = '配置加载失败';
      setStatus(error.message || '配置加载失败。');
    }
    syncControls();
  }

  video.addEventListener('loadedmetadata', () => {
    assetEmpty.hidden = true;
    if (!overlay) {
      setStatus(atTarget() ? '已暂停在目标时间，可以再次破壁。' : '请暂停在目标时间。');
    }
    syncControls();
  });
  video.addEventListener('timeupdate', syncControls);
  video.addEventListener('play', syncControls);
  video.addEventListener('pause', syncControls);
  video.addEventListener('ended', syncControls);
  video.addEventListener('error', () => {
    assetEmpty.hidden = false;
    removeOverlay();
    setStatus('视频无法加载，未挂载交互层。');
  });
  window.addEventListener('resize', drawCurve);
  document.addEventListener('fullscreenchange', drawCurve);
  window.addEventListener('orientationchange', drawCurve);
  window.addEventListener('pagehide', () => {
    if (wakeHandle) wakeHandle.dispose();
    releaseWatch();
    window.__breakglassAlignment = null;
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      wake();
    }
    if (event.key === 'Escape') {
      if (overlay) removeOverlay();
      else if (sessionState() && sessionState().status === 'waiting') cancelWaiting();
    }
  });
  stage.addEventListener('click', (event) => {
    if (overlay && !overlay.contains(event.target)) removeOverlay();
  });
  playToggle.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => setStatus('视频当前无法播放。'));
    else video.pause();
  });
  jumpTarget.addEventListener('click', () => {
    if (!video.videoWidth) {
      setStatus('正式视频素材尚未提供，暂时无法定位。');
      return;
    }
    video.currentTime = targetTime();
    video.pause();
  });
  wakeButton.addEventListener('click', wake);
  cancelButton.addEventListener('click', cancelWaiting);
  retryButton.addEventListener('click', wake);
  resetButton.addEventListener('click', () => {
    if (controller) controller.reset();
    drawCurve();
    setStatus('已恢复本次结果的初始参数。');
  });
  exitButton.addEventListener('click', removeOverlay);
  slider.addEventListener('input', () => {
    if (!controller) return;
    controller.updateParameter('h', Number(slider.value));
    drawCurve();
  });

  boot();
})();