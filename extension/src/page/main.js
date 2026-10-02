(function () {
  'use strict';

  const {
    geometry,
    alignment,
    preset,
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
  const sliderA = $('#parameter-a');
  const sliderAValue = $('#parameter-a-value');
  const sliderK = $('#parameter-k');
  const sliderKValue = $('#parameter-k-value');
  const sliderRows = [
    { name: 'a', input: sliderA, output: sliderAValue },
    { name: 'h', input: slider, output: sliderValue },
    { name: 'k', input: sliderK, output: sliderKValue }
  ];
  const sourceLabel = $('#source-label');
  const sourceNote = $('#source-note');
  const stateLabel = $('#state-label');
  const timeLabel = $('#time-label');
  const assetEmpty = $('#asset-empty');
  const runtimeNote = $('#runtime-note');
  const waitingBar = $('#waiting-bar');
  const waitingProgress = $('#waiting-progress');
  const fullscreenButton = $('#fullscreen-button');
  const wakeReason = $('#wake-reason');
  const resetReason = $('#reset-reason');
  const playTip = playToggle ? playToggle.querySelector('.lg-tip') : null;

  /**
   * 相对演示页的扩展包视频。仓库落盘路径只写在 extension/assets/video/README.md。
   * @type {string}
   */
  const PACKAGED_VIDEO_URL = '../assets/video/breakglass-demo-9s.mp4';

  /**
   * 包内演示片的输入框初值（秒）。准备结果自己的 time 不跟这个输入框走。
   * @type {number}
   */
  const PACKAGED_DEMO_TARGET_SECONDS = 6;

  let config = null;
  let presetResult = null;
  let controller = null;
  let wakeHandle = null;
  let latencies = null;
  let localClock = null;
  let overlay = null;
  let dragging = false;
  /** @type {{ name: string, value: number, mathX: number } | null} */
  let dragOrigin = null;
  let placedRectKey = '';
  let videoBroken = false;
  // 识别路径的判定起点；只在 visionAdapter 为 fixture 且外部演练为 off 时置位。
  let visionStartedAt = null;
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
   * 文件明确不存在时才不挂 src。
   * 不用 Range 探测：只取 1 个字节会写进缓存，断网重载后 video 可能只拿到残缺尺寸。
   * fetch 在断网时会失败，这时仍把地址交给 video，扩展包内的文件可以由播放器自己读。
   * @returns {Promise<boolean>} 是否已把地址交给演示 video
   */
  async function attachPackagedVideo() {
    try {
      const response = await fetch(PACKAGED_VIDEO_URL, { method: 'HEAD' });
      if (response.status === 404 || response.status === 410) return false;
    } catch {
      // 断网时 HEAD 失败，不代表扩展包里没有这个文件。
    }
    video.src = PACKAGED_VIDEO_URL;
    return true;
  }

  function setStatus(message, variant) {
    stateLabel.textContent = message;
    const isError = variant === 'error';
    if (stateLabel.classList) stateLabel.classList.toggle('is-error', isError);
    // 失败要立刻播报；普通状态变化保持礼貌播报，避免打断用户。
    if (stateLabel.setAttribute) stateLabel.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  }

  function setSlidersEnabled(enabled) {
    sliderRows.forEach((row) => { if (row.input) row.input.disabled = !enabled; });
  }

  function setPrimaryAction(action) {
    if (wakeButton) wakeButton.dataset.variant = action === 'wake' ? 'primary' : 'ghost';
    if (retryButton) retryButton.dataset.variant = action === 'retry' ? 'primary' : 'ghost';
  }

  // 等待条随等待态出现，进度条时长与 fallbackAfterMs 对齐（规范 §3.5）。
  function setWaitingBar(active) {
    if (!waitingBar) return;
    waitingBar.hidden = !active;
    if (!active) return;
    const ms = config && Number.isFinite(config.fallbackAfterMs) ? config.fallbackAfterMs : 1500;
    waitingBar.style.setProperty('--wait-ms', ms + 'ms');
  }

  function targetTime() {
    if (targetInput.value == null || String(targetInput.value).trim() === '') return Number.NaN;
    return Number(targetInput.value);
  }

  /**
   * 输入框是用户要停住的秒数。准备结果自己的 time 不跟着改。
   */
  function syncSessionTarget() {
    if (!controller) return;
    const nextTarget = targetTime();
    if (!Number.isFinite(nextTarget)) return;
    controller.targetTime = nextTarget;
  }

  /**
   * 准备结果写明的时间（秒）。
   * @returns {number}
   */
  function authoredTime() {
    const time = presetResult && presetResult.time;
    return typeof time === 'number' && Number.isFinite(time) ? time : Number.NaN;
  }

  /**
   * 容差跟会话。会话还没建好时用 0.2 秒。
   * @returns {number}
   */
  function timeTolerance() {
    return controller && Number.isFinite(controller.timeTolerance) ? controller.timeTolerance : 0.2;
  }

  /**
   * video 上若写了 data-video-id，必须和预制 videoId 相同。没写则不额外拦。
   * @returns {boolean}
   */
  function videoMatches() {
    if (!presetResult) return false;
    if (!video || typeof video.getAttribute !== 'function') return true;
    const marked = video.getAttribute('data-video-id');
    if (!marked) return true;
    return marked === presetResult.videoId;
  }

  /**
   * 当前播放时间是否落在准备结果自己的时间容差内。
   * 多留 1e-9，和会话 canWake 一样，避免 6.2 这种浮点差被挡在 0.2 秒门外。
   * @returns {boolean}
   */
  function timeMatchesMaterial() {
    const authored = authoredTime();
    if (!Number.isFinite(authored) || !video || !Number.isFinite(video.currentTime)) return false;
    return Math.abs(video.currentTime - authored) <= timeTolerance() + 1e-9;
  }

  /**
   * 画面视频和时间都对得上准备结果。
   * @returns {boolean}
   */
  function matchesMaterial() {
    return Boolean(presetResult) && videoMatches() && timeMatchesMaterial();
  }

  /**
   * 准备结果对不上当前画面时的说明。对得上、或还没有画面尺寸时返回空串。
   * @returns {string}
   */
  function materialMessage() {
    if (presetResult && !videoMatches()) return '这段视频和准备结果不是同一份。';
    if (presetResult && hasFrameSize() && !timeMatchesMaterial()) {
      return '准备结果对应 ' + authoredTime() + ' 秒，当前画面对不上。';
    }
    return '';
  }

  /**
   * 空闲时的状态句。素材对不上时写明它对应的秒数。
   * @returns {string}
   */
  function idleStatus() {
    const mismatch = materialMessage();
    if (mismatch) return mismatch;
    return atTarget() ? '已暂停在目标时间，可以再次破壁。' : '请暂停在目标时间。';
  }

  /**
   * 宽高必须同时就绪。只有宽度时去校验，会把残缺尺寸当成帧不匹配。
   * @returns {boolean}
   */
  function hasFrameSize() {
    return Boolean(video && video.videoWidth > 0 && video.videoHeight > 0);
  }

  /**
   * 输入框目标由会话判断。准备结果自己的时间和 videoId 必须另外对上。
   * @returns {boolean}
   */
  function atTarget() {
    if (videoBroken) return false;
    syncSessionTarget();
    if (!controller || !hasFrameSize() || !matchesMaterial()) return false;
    return controller.canWake({ paused: video.paused, currentTime: video.currentTime });
  }

  /**
   * @returns {ReturnType<SessionController['getState']> | null}
   */
  function sessionState() {
    return controller ? controller.getState() : null;
  }

  /**
   * 打包识别样例：来源必须是 vision，且必须自带 packaged-sample 证据。
   * 合法性由结果规则侧判定，页面只决定怎么如实显示。
   * @param {object | null} result
   * @returns {boolean}
   */
  function isPackagedVision(result) {
    return Boolean(result) && result.source === 'vision' && result.evidence === 'packaged-sample';
  }

  function sourceText(result) {
    if (!result) return '等待素材';
    if (isPackagedVision(result)) return '识别结果';
    if (result.fallback === 'timeout') return '预先准备的示例 · 超时回退';
    return result.source === 'preset' ? '预先准备的示例' : '来源不可用';
  }

  function setSource(result, note) {
    sourceLabel.textContent = sourceText(result);
    const vision = isPackagedVision(result);
    const preset = Boolean(result) && result.source === 'preset';
    if (sourceLabel.classList) {
      sourceLabel.classList.toggle('is-fallback', Boolean(result && result.fallback === 'timeout'));
      // 预制与打包识别样例都是已知来源，只有来源不明时才用警示色。
      sourceLabel.classList.toggle('is-warn', Boolean(result) && !preset && !vision);
    }
    if (note !== undefined) {
      sourceNote.textContent = note;
      return;
    }
    // 识别样例的说明必须写明尚未接通外部识别；也不显示可信程度百分比。
    if (vision) {
      sourceNote.textContent = '随演示打包的识别样例，尚未接通外部识别。';
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
    setWaitingBar(false);
  }

  /**
   * 当前视频的内容矩形。不支持的 object-fit 只跳过这一帧，不把异常抛进事件处理。
   * @returns {ReturnType<typeof geometry.getContentRect> | null}
   */
  function readContentRect() {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!(videoWidth > 0 && videoHeight > 0)) return null;
    const style = getComputedStyle(video);
    try {
      return geometry.getContentRect({
        elementRect: video.getBoundingClientRect(),
        videoWidth,
        videoHeight,
        objectFit: style.objectFit || 'contain',
        objectPosition: style.objectPosition || '50% 50%'
      });
    } catch {
      return null;
    }
  }

  /**
   * 把指针位置换回数学横坐标。内容矩形无效时返回 null。
   * @param {{ clientX?: number }} event
   * @param {object} definition
   * @returns {number | null}
   */
  function mathXFromPointer(event, definition) {
    const rect = readContentRect();
    const region = definition && definition.region;
    if (!rect || !region || !(region.width > 0) || !Number.isFinite(event.clientX)) return null;
    const sourceX = (event.clientX - rect.contentRect.left) / rect.scale;
    const mathX = definition.domain.min +
      ((sourceX - region.x) / region.width) * (definition.domain.max - definition.domain.min);
    return Number.isFinite(mathX) ? mathX : null;
  }

  // 坐标换算统一走 geometry/alignment.js，页面不再另写一套映射。
  function pagePointForMath(definition, parameters, mathX, rect) {
    const point = alignment.mathPointToPage(definition, parameters, mathX, rect.scale);
    return [point.x, point.y];
  }

  /**
   * 只读布局读数。不把刚画的路径当成实测，所以不算相对画面的 2% 结论。
   * 偏差算法在 alignment.js，要有独立实测点才算测过。
   * @param {object} definition
   * @param {Record<string, number>} parameters
   * @param {{ contentRect: object, scale: number }} rect
   * @returns {object}
   */
  function publishAlignment(definition, parameters, rect) {
    const counted = alignment.sampleAlignment({
      definition,
      parameters,
      scale: rect.scale,
      contentRect: rect.contentRect,
      samples: 9
    });
    window.__breakglassAlignment = {
      contentRect: { ...rect.contentRect },
      scale: rect.scale,
      samples: counted.points.length,
      maxRatio: null,
      tolerance: counted.tolerance,
      withinTolerance: null,
      measured: false,
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
    const rect = readContentRect();
    if (!rect) return;

    const rectKey = [
      rect.contentRect.left, rect.contentRect.top,
      rect.contentRect.width, rect.contentRect.height, rect.scale
    ].join(',');
    if (placedRectKey && placedRectKey !== rectKey) {
      dragging = false;
      dragOrigin = null;
    }
    placedRectKey = rectKey;

    const stageRect = stage.getBoundingClientRect();
    overlay.style.left = `${rect.contentRect.left - stageRect.left}px`;
    overlay.style.top = `${rect.contentRect.top - stageRect.top}px`;
    overlay.style.width = `${rect.contentRect.width}px`;
    overlay.style.height = `${rect.contentRect.height}px`;
    overlay.setAttribute('viewBox', `0 0 ${rect.contentRect.width} ${rect.contentRect.height}`);

    const parameters = state.currentParameters;
    const samples = [];
    const span = definition.domain.max - definition.domain.min;
    for (let index = 0; index <= 80; index += 1) {
      samples.push(definition.domain.min + span * index / 80);
    }
    const vertex = Number(parameters.h);
    if (Number.isFinite(vertex) && vertex > definition.domain.min && vertex < definition.domain.max &&
        !samples.some((value) => Math.abs(value - vertex) <= 1e-9)) {
      samples.push(vertex);
    }
    samples.sort((left, right) => left - right);
    const path = [];
    samples.forEach((x, index) => {
      const [px, py] = pagePointForMath(definition, parameters, x, rect);
      path.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
    });
    const pathData = path.join(' ');
    overlay.querySelector('path').setAttribute('d', pathData);
    const hitPath = overlay.querySelector('path.curve-hit');
    if (hitPath) hitPath.setAttribute('d', pathData);
    publishAlignment(definition, parameters, rect);

    const dragParameter = definition.dragParameter;
    const dragValue = parameters[dragParameter];
    const [cx, cy] = pagePointForMath(definition, parameters, dragParameter === 'h' ? dragValue : definition.domain.min, rect);
    const handle = overlay.querySelector('circle');
    handle.setAttribute('cx', cx.toFixed(2));
    handle.setAttribute('cy', cy.toFixed(2));

    sliderRows.forEach((row) => {
      if (!row.input || !row.output) return;
      const value = Number(parameters[row.name]);
      if (!Number.isFinite(value)) return;
      row.input.value = String(value);
      row.output.textContent = value.toFixed(1);
      const item = definition.parameters[row.name];
      if (item && row.input.setAttribute) {
        row.input.setAttribute('aria-valuetext', value.toFixed(1) + '（范围 ' + item.min + ' 到 ' + item.max + '）');
      }
    });
  }

  function removeOverlay({ pauseVideo = true } = {}) {
    if (wakeHandle) wakeHandle.exit();
    if (overlay) overlay.remove();
    overlay = null;
    dragging = false;
    dragOrigin = null;
    placedRectKey = '';
    window.__breakglassAlignment = null;
    if (pauseVideo && video && !video.paused) video.pause();
    resetButton.disabled = true;
    exitButton.disabled = true;
    setSlidersEnabled(false);
    hideWaitingControls();
    setPrimaryAction('wake');
    setSource(null);
    setStatus(idleStatus());
    wakeButton.disabled = !(atTarget() && Boolean(presetResult));
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.classList.add('curve-overlay');
    overlay.style.position = 'absolute';
    overlay.style.zIndex = '2';
    overlay.style.touchAction = 'none';
    overlay.style.pointerEvents = 'all';
    overlay.setAttribute('aria-label', '可拖动的抛物线结果');
    // 可见路径保持细线。后面的透明宽路径负责拖动命中。
    // 视觉控制点 r=10，另加一个透明 r=18 的热区圆。热区放在后面，
    // 这样 querySelector('circle') 和 querySelector('path') 仍拿到可见图形。
    overlay.innerHTML = '<path fill="none" stroke="#71ddff" stroke-width="3" stroke-linecap="round"></path>'
      + '<path class="curve-hit" fill="none" stroke="transparent" stroke-width="24" stroke-linecap="round"></path>'
      + '<circle r="10" fill="#08111f" stroke="#ffffff" stroke-width="3" tabindex="0"></circle>'
      + '<circle class="curve-hit" r="18" fill="transparent" stroke="none" aria-hidden="true"></circle>';
    stage.appendChild(overlay);

    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) return;
      const state = sessionState();
      if (!state || !state.result) return;
      const definition = state.result.definition;
      const mathX = mathXFromPointer(event, definition);
      const name = definition.dragParameter;
      if (mathX === null || !Number.isFinite(state.currentParameters[name])) return;
      dragging = true;
      dragOrigin = { name, value: state.currentParameters[name], mathX };
      if (overlay.setPointerCapture) overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!dragging || !dragOrigin) return;
      const state = sessionState();
      if (!state || !state.result) return;
      const mathX = mathXFromPointer(event, state.result.definition);
      if (mathX === null) return;
      controller.updateParameter(dragOrigin.name, dragOrigin.value + (mathX - dragOrigin.mathX));
      drawCurve();
    });
    /**
     * 松手或指针被系统取消时结束拖动，避免下一次移动继续改参数。
     * @param {PointerEvent} event
     */
    function endDrag(event) {
      dragging = false;
      dragOrigin = null;
      if (overlay && event && overlay.hasPointerCapture && overlay.hasPointerCapture(event.pointerId)) {
        overlay.releasePointerCapture(event.pointerId);
      }
    }
    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
    overlay.addEventListener('lostpointercapture', endDrag);
    drawCurve();
  }

  function syncControls() {
    if (wakeHandle && controller) {
      syncSessionTarget();
      const before = controller.getState();
      const wasActive = before.status === 'waiting' || before.status === 'interactive' || before.status === 'recoverable-error';
      const playbackState = wakeHandle.onPlaybackChange({
        paused: video.paused,
        currentTime: video.currentTime
      });
      const still = sessionState();
      const leftMaterial = wasActive && still && still.status !== 'paused-ready' && !matchesMaterial();
      if (leftMaterial || (wasActive && playbackState.status === 'paused-ready')) {
        if (overlay) removeOverlay({ pauseVideo: false });
        else if (leftMaterial) wakeHandle.exit();
        if (!overlay) {
          hideWaitingControls();
          resetButton.disabled = true;
          exitButton.disabled = true;
          setSlidersEnabled(false);
          setPrimaryAction('wake');
          setSource(null);
          setStatus(idleStatus());
        }
      }
    }
    const waiting = Boolean(sessionState() && sessionState().status === 'waiting');
    const ready = atTarget() && Boolean(presetResult);
    wakeButton.disabled = waiting || !ready || Boolean(overlay);
    const playLabel = video.paused ? '播放' : '暂停';
    playToggle.setAttribute('aria-label', playLabel + '视频');
    if (playTip) playTip.textContent = playLabel;
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
    const state = sessionState();
    const idle = !state || state.status === 'paused-ready';
    if (!videoBroken && idle && !overlay) {
      const mismatch = materialMessage();
      if (mismatch) setStatus(mismatch);
    }
    syncDisabledReasons();
  }

  // 识别判定从发起到进入交互或可恢复失败的耗时单独记一条，不写进预制回退那组。
  function recordVisionDecision() {
    if (visionStartedAt === null || !latencies) return;
    const now = localClock ? localClock.now() : Date.now();
    const elapsed = now - visionStartedAt;
    visionStartedAt = null;
    if (Number.isFinite(elapsed) && elapsed >= 0) latencies.record('vision-decision', elapsed, 'hot');
  }

  /**
   * 禁用原因只在这一处生成：按钮不可用时把原因写进视觉隐藏的说明节点，
   * 由 aria-describedby 关联，读屏与 tooltip 都能解释为什么不能点。
   */
  function syncDisabledReasons() {
    if (wakeReason) {
      let reason = '';
      if (wakeButton.disabled) {
        const state = sessionState();
        if (state && state.status === 'waiting') reason = '正在等待外部结果，可以先取消或退出。';
        else if (overlay) reason = '交互层已经出现，不需要再次破壁。';
        else if (!video.paused) reason = '请先暂停视频。';
        else if (materialMessage()) reason = materialMessage();
        else if (!atTarget()) reason = '请把视频暂停在目标时间 ±0.2 秒内。';
        else if (!presetResult) reason = '当前没有可用的准备结果。';
        else reason = '当前还不能破壁。';
      }
      wakeReason.textContent = reason;
    }
    if (resetReason) {
      resetReason.textContent = resetButton.disabled ? '需要先出现可交互的曲线再重置。' : '';
    }
  }

  function applyState(state) {
    if (!state) return;
    renderState(state);
    syncDisabledReasons();
  }

  function renderState(state) {
    // 取消、退出、播放或离开目标时间：判定没有结算，不记账。
    if (state.status === 'paused-ready') visionStartedAt = null;
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
      // 识别路径单独结算；预制路径（含超时回退）不写这组。
      if (!timedOut && isPackagedVision(result)) recordVisionDecision();
      hideWaitingControls();
      resetButton.disabled = false;
      exitButton.disabled = false;
      setSlidersEnabled(true);
      setPrimaryAction('wake');
      if (overlay) {
        overlay.classList.add('is-entering');
        window.setTimeout(() => { if (overlay) overlay.classList.remove('is-entering'); }, 240);
      }
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
      exitButton.disabled = false;
      retryButton.hidden = true;
      retryButton.disabled = true;
      resetButton.disabled = true;
      setSlidersEnabled(false);
      wakeButton.disabled = true;
      // 等待态必须能退出：FR-010 的可操作路径 + FR-011 的取消之外还要有退路。
      exitButton.disabled = false;
      setPrimaryAction('wake');
      setWaitingBar(true);
      setSource(null, '正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。');
      setStatus('正在等待外部结果…');
      if (cancelButton.focus) cancelButton.focus();
      return;
    }
    if (state.status === 'recoverable-error') {
      recordVisionDecision();
      hideWaitingControls();
      retryButton.hidden = false;
      retryButton.disabled = false;
      exitButton.disabled = false;
      resetButton.disabled = true;
      setSlidersEnabled(false);
      wakeButton.disabled = true;
      exitButton.disabled = false;
      setPrimaryAction('retry');
      setWaitingBar(false);
      setSource(null, '没有可用的准备结果，或外部结果不可用；可以重试或退出。');
      setStatus(state.message || '结果不可用，请重试或退出。', 'error');
      if (retryButton.focus) retryButton.focus();
    }
  }

  function wake() {
    if (!wakeHandle || !presetResult || !atTarget()) {
      setStatus(materialMessage() || '请先暂停在目标时间。');
      return;
    }
    const state = sessionState();
    if (overlay || (state && (state.status === 'interactive' || state.status === 'waiting'))) return;
    const frameSize = { width: video.videoWidth, height: video.videoHeight };
    // 只有识别路径需要判定耗时；起点取自页面自己的时钟。
    const visionPath = Boolean(config) && config.visionAdapter === 'fixture' && config.externalAttempt === 'off';
    visionStartedAt = visionPath && localClock ? localClock.now() : null;
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
    setStatus(atTarget() ? '已取消等待，可以再次破壁。' : (materialMessage() || '请暂停在目标时间。'));
    wakeButton.disabled = !(atTarget() && Boolean(presetResult));
  }

  async function boot() {
    const packagedPromise = attachPackagedVideo();
    try {
      const loaded = await preset.loadPreset();
      if (!loaded.ok) throw new Error(loaded.message);
      config = loaded.config;
      presetResult = loaded.result;
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

  video.addEventListener('resize', syncControls);
  video.addEventListener('loadedmetadata', () => {
    videoBroken = false;
    assetEmpty.hidden = true;
    if (!overlay) setStatus(idleStatus());
    syncControls();
  });
  video.addEventListener('timeupdate', syncControls);
  video.addEventListener('play', syncControls);
  video.addEventListener('pause', syncControls);
  video.addEventListener('ended', syncControls);
  video.addEventListener('error', () => {
    videoBroken = true;
    assetEmpty.hidden = false;
    removeOverlay();
    setStatus('视频无法加载，未挂载交互层。', 'error');
  });
  window.addEventListener('resize', drawCurve);
  document.addEventListener('fullscreenchange', drawCurve);
  window.addEventListener('orientationchange', drawCurve);
  window.addEventListener('pagehide', () => {
    dragging = false;
    dragOrigin = null;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
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
      if (document.fullscreenElement) return;
      const status = sessionState() && sessionState().status;
      if (overlay || status === 'recoverable-error') removeOverlay();
      else if (status === 'waiting') cancelWaiting();
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
    const next = targetTime();
    if (!Number.isFinite(next) || next < 0) {
      setStatus('请输入有效的目标时间。');
      return;
    }
    video.currentTime = next;
    video.pause();
    syncControls();
  });
  targetInput.addEventListener('input', () => {
    if (!Number.isFinite(targetTime())) return;
    syncControls();
  });
  wakeButton.addEventListener('click', wake);
  cancelButton.addEventListener('click', cancelWaiting);
  retryButton.addEventListener('click', wake);
  resetButton.addEventListener('click', () => {
    dragging = false;
    dragOrigin = null;
    if (controller) controller.reset();
    drawCurve();
    setStatus('已恢复本次结果的初始参数。');
  });
  exitButton.addEventListener('click', removeOverlay);
  // 滑块按参数逐个调节（会话层 setParameter）；控制点拖动仍走 updateParameter。
  sliderRows.forEach((row) => {
    if (!row.input) return;
    row.input.addEventListener('input', () => {
      if (!controller) return;
      controller.setParameter(row.name, Number(row.input.value));
      drawCurve();
    });
  });
  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    const target = document.documentElement;
    if (target && target.requestFullscreen) target.requestFullscreen();
  });

  boot();
})();