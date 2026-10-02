(function () {
  'use strict';

  const {
    geometry,
    alignment,
    preset,
    session: sessionApi,
    attempt: attemptApi,
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

  let config = null;
  let presetResult = null;
  let controller = null;
  let wakeController = null;
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

  function setStatus(message) {
    stateLabel.textContent = message;
  }

  function targetTime() {
    return Number(targetInput.value);
  }

  function atTarget() {
    return Boolean(video && video.paused && video.videoWidth &&
      Number.isFinite(video.currentTime) && Math.abs(video.currentTime - targetTime()) <= 0.2);
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

  function errorMessage(reason) {
    if (reason === 'no_preset') return '当前帧没有可用的准备结果，无法进入交互。';
    if (reason === 'external_invalid' || reason === 'external_unavailable') return '外部结果不可用，未进入交互。';
    return '准备结果不可用，请重试或退出。';
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
    if (!controller || controller.status !== 'interactive' || !overlay) return;
    const state = controller.getState();
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
    if (wakeController) wakeController.dispose();
    if (overlay) overlay.remove();
    overlay = null;
    dragging = false;
    if (controller) controller.exit();
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
      if (!dragging || !controller || !controller.current) return;
      const result = controller.current.result;
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
    if (wakeController && controller) {
      const wasActive = wakeController.isWaiting() || controller.status === 'interactive';
      const playbackState = wakeController.onPlaybackChange({
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
    const waiting = Boolean(wakeController && wakeController.isWaiting());
    const ready = atTarget() && Boolean(presetResult);
    wakeButton.disabled = waiting || !ready || Boolean(overlay);
    playToggle.textContent = video.paused ? '播放' : '暂停';
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
  }

  function applyOutcome(outcome) {
    if (!outcome) return;
    if (outcome.status === 'interactive') {
      const result = outcome.result;
      createOverlay();
      hideWaitingControls();
      resetButton.disabled = false;
      exitButton.disabled = false;
      slider.disabled = false;
      setSource(result);
      setStatus(result.fallback === 'timeout'
        ? '已改用预先准备的示例（超时回退），可拖动控制点。'
        : '交互已出现，可拖动控制点改变水平位置。');
      if (result.fallback === 'timeout' && latencies && Number.isFinite(outcome.decisionAt)) {
        latencies.record('fallback-visible', localClock.now() - outcome.decisionAt);
      }
      syncControls();
      return;
    }
    if (outcome.status === 'waiting') {
      cancelButton.hidden = false;
      cancelButton.disabled = false;
      retryButton.hidden = true;
      retryButton.disabled = true;
      resetButton.disabled = true;
      slider.disabled = true;
      wakeButton.disabled = true;
      exitButton.disabled = false;
      setSource(null, '正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。');
      setStatus('正在等待外部结果…');
      if (cancelButton.focus) cancelButton.focus();
      return;
    }
    if (outcome.status === 'recoverable-error') {
      hideWaitingControls();
      retryButton.hidden = false;
      retryButton.disabled = false;
      resetButton.disabled = true;
      slider.disabled = true;
      wakeButton.disabled = true;
      exitButton.disabled = false;
      setSource(null, '没有可用的准备结果，或外部结果不可用；可以重试或退出。');
      setStatus(errorMessage(outcome.reason));
      if (retryButton.focus) retryButton.focus();
    }
  }

  function wake() {
    if (!wakeController || !presetResult || !atTarget()) {
      setStatus('请先暂停在目标时间。');
      return;
    }
    if (overlay || (controller && controller.status === 'interactive')) return;
    // 状态变化由 wakeController 的 onOutcome 回调驱动，页面不重复渲染。
    const started = wakeController.begin({ paused: true, currentTime: video.currentTime });
    if (!started.ok) setStatus(started.message || '暂时无法破壁。');
  }

  function cancelWaiting() {
    if (!wakeController || !wakeController.isWaiting()) return;
    wakeController.cancel();
    hideWaitingControls();
    setSource(null, '已取消等待，迟到结果不会再打开交互层。');
    setStatus(atTarget() ? '已取消等待，可以再次破壁。' : '请暂停在目标时间。');
    wakeButton.disabled = !(atTarget() && Boolean(presetResult));
  }

  async function boot() {
    try {
      const loaded = await preset.loadPreset();
      if (!loaded.ok) throw new Error(loaded.message);
      config = loaded.config;
      presetResult = loaded.result;
      targetInput.value = String(presetResult.time);
      controller = new sessionApi.SessionController({
        videoId: presetResult.videoId,
        targetTime: presetResult.time,
        frameSize: presetResult.frameSize,
        externalAttempt: config.externalAttempt
      });
      localClock = createClock();
      latencies = latencyApi.createLatencyLog({ clock: localClock });
      const attempt = config.externalAttempt === 'off'
        ? null
        : attemptApi.createAttempt({ mode: config.externalAttempt, clock: localClock });
      wakeController = wakeApi.createWakeController({
        session: controller,
        clock: localClock,
        attempt,
        fallbackAfterMs: config.fallbackAfterMs,
        onOutcome: (outcome) => applyOutcome(outcome),
        resolvePreset: () => (config.enableLocalMock === true && config.prewarmed === true ? presetResult : null)
      });
      window.__breakglassLatency = {
        summary: () => latencies.summary(),
        snapshot: () => latencies.snapshot()
      };
      watchDevicePixelRatio();
      watchVideoSize();
      runtimeNote.textContent = `配置：${config.externalAttempt} · 本地预制已预热 · 回退 ${config.fallbackAfterMs}ms`;
      setStatus('正式视频素材尚未提供，加载视频后可验证交互。');
      setSource(null);
    } catch (error) {
      runtimeNote.textContent = '配置加载失败';
      setStatus(error.message || '配置加载失败。');
    }
    syncControls();
  }

  video.addEventListener('loadedmetadata', () => {
    assetEmpty.hidden = true;
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
    if (wakeController) wakeController.dispose();
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
      else if (wakeController && wakeController.isWaiting()) cancelWaiting();
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