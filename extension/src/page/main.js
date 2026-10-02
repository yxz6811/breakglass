(function () {
  'use strict';

  const { geometry, preset, session: sessionApi, evaluate } = window.BreakGlass;
  const $ = (selector) => document.querySelector(selector);
  const video = $('#demo-video');
  const stage = $('#video-stage');
  const targetInput = $('#target-time');
  const playToggle = $('#play-toggle');
  const jumpTarget = $('#jump-target');
  const wakeButton = $('#wake-button');
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
  let overlay = null;
  let dragging = false;

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
    return '预先准备的示例';
  }

  function setSource(result) {
    const text = sourceText(result);
    sourceLabel.textContent = text;
    sourceNote.textContent = result
      ? (result.fallback === 'timeout' ? '因等待超过 1.5 秒，改用预先准备的示例。' : '这是扩展包内预先准备的示例，不代表实时识别成功。')
      : '数据来源将在交互出现后显示。';
  }

  function pagePointForMath(definition, parameters, mathX, rect) {
    const y = evaluate.evaluateWithParameters(definition, parameters, mathX);
    const xRatio = (mathX - definition.domain.min) / (definition.domain.max - definition.domain.min);
    const yRatio = definition.yAxis === 'up'
      ? (definition.range.max - y) / (definition.range.max - definition.range.min)
      : (y - definition.range.min) / (definition.range.max - definition.range.min);
    const sourceX = definition.region.x + xRatio * definition.region.width;
    const sourceY = definition.region.y + yRatio * definition.region.height;
    return [sourceX * rect.scale, sourceY * rect.scale];
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
    overlay.querySelector('path').setAttribute('d', path.join(' '));

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
    if (overlay) overlay.remove();
    overlay = null;
    dragging = false;
    if (controller) controller.exit();
    if (pauseVideo && video && !video.paused) video.pause();
    resetButton.disabled = true;
    exitButton.disabled = true;
    slider.disabled = true;
    setSource(null);
    setStatus(atTarget() ? '已暂停在目标时间，可以再次破壁。' : '请暂停在目标时间。');
  }

  function createOverlay() {
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
    if (controller) {
      const wasActive = controller.status === 'waiting' || controller.status === 'interactive';
      const playbackState = controller.onPlaybackChange({
        paused: video.paused,
        currentTime: video.currentTime
      });
      if (overlay && wasActive && playbackState.status === 'paused-ready') {
        removeOverlay({ pauseVideo: false });
      }
    }
    const ready = atTarget() && Boolean(presetResult);
    wakeButton.disabled = !ready || Boolean(overlay);
    playToggle.textContent = video.paused ? '播放' : '暂停';
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
  }

  function wake() {
    if (overlay || (controller && controller.status === 'interactive')) return;
    if (!controller || !presetResult || !atTarget()) {
      setStatus('请先暂停在目标时间。');
      return;
    }
    const waiting = controller.beginWait({ paused: true, currentTime: video.currentTime });
    if (!waiting.ok) {
      setStatus(waiting.message);
      return;
    }
    const result = { ...presetResult, requestId: waiting.requestId };
    const resolved = controller.resolve(result);
    if (!resolved.ok) {
      setStatus(resolved.message || '准备结果不可用，请重试或退出。');
      return;
    }
    createOverlay();
    resetButton.disabled = false;
    exitButton.disabled = false;
    slider.disabled = false;
    setSource(result);
    setStatus('交互已出现，可拖动控制点改变水平位置。');
    syncControls();
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
      runtimeNote.textContent = `配置：${config.externalAttempt} · 本地预制已预热`;
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
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      wake();
    }
    if (event.key === 'Escape' && overlay) removeOverlay();
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
