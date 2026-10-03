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
  const lessonApi = window.BreakGlass.lesson || null;
  const askApi = window.BreakGlass.lessonAsk || null;
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
  const lessonStatus = $('#lesson-status');
  const lessonCancel = $('#lesson-cancel');
  const lessonNext = $('#lesson-next');
  const lessonEndpoint = $('#lesson-endpoint');
  const lessonNote = $('#lesson-note');

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
  /** 配置没加载成功时的说明。非空就不再挂包内片子，也不让随后的视频错误改口。 */
  let bootFailure = '';
  /** 用户选择的本地视频地址。有值时不再用包内演示片覆盖。 */
  let localVideoUrl = '';
  /** 新视频的元数据还没到。这之前不能沿用上一帧的宽高破壁。 */
  let mediaPending = false;
  /** 曲线至少出现过一次之后，才放出可编辑的目标时间。 */
  let curveShown = false;
  // 识别路径的判定起点；只在 visionAdapter 为 fixture 且外部演练为 off 时置位。
  let visionStartedAt = null;
  /**
   * 取消等待时的空闲文案。下一次 paused-ready 绘制用掉后清空。
   * @type {{ note: string, status: string } | null}
   */
  let pendingIdle = null;
  /** 看门狗只接受 1500。等待条不再跟随其它配置值。 */
  const FALLBACK_AFTER_MS = 1500;
  let resizeObserver = null;
  let dprQuery = null;
  let dprHandler = null;
  /** 启动时加载的 demo-parabola，退回时重新挂上。 */
  let packagedPreset = null;
  /**
   * 这一次阅读。点只存在内存里，换片子或退回时清空。
   * shown 是当前挂着（或正在定位过去）的那一处。
   * @type {{ src: string, readingId: string, videoId: string, duration: number, phase: 'reading' | 'ready', cancelled: boolean, courseNote: string, points: object[], dropped: { id: string, reason: string }[], first: object | null, shown: object | null, seeking: boolean, startedAt: number, timer: unknown, pendingJump: { before: number, after: number | null, wakeDisabled: boolean } | null, jumps: { before: number, after: number | null, wakeDisabled: boolean }[] } | null}
   */
  let lesson = null;
  let lessonSerial = 0;
  /** @type {{ cancel: Function } | null} */
  let lessonAskHandle = null;
  /** 隐藏采样视频。只在阅读采样期间存在，不挂进舞台。 */
  let lessonProbe = null;
  /** 当前会话挂的是这次阅读的点，而不是包内的 demo-parabola。 */
  let usingLessonCurve = false;
  /** 阅读点破壁的起点。只在点已经存好并落定时置位。 */
  let lessonWakeStartedAt = null;
  let wakeStartedAt = null;
  let presentationSerial = 0;
  let presentationFrame = null;
  /** 刚退回 9 秒片时的原因。那支片子加载失败时要改口，不能说已经回去了。 */
  let lessonFallbackReason = '';
  let wakeMounts = 0;

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
    if (localVideoUrl || bootFailure) return Boolean(localVideoUrl);
    try {
      const response = await fetch(PACKAGED_VIDEO_URL, { method: 'HEAD' });
      if (response.status === 404 || response.status === 410) return false;
    } catch {
      // 断网时 HEAD 失败，不代表扩展包里没有这个文件。
    }
    if (localVideoUrl || bootFailure) return Boolean(localVideoUrl);
    video.src = PACKAGED_VIDEO_URL;
    return true;
  }

  /**
   * 把用户选中的视频放进播放器。地址是浏览器临时对象，不发送到任何服务器。
   * 去掉 data-video-id，避免把别人的文件当成夹具那一支片子。
   * @param {File} file
   */
  function useLocalVideo(file) {
    if (!file || !video || typeof URL.createObjectURL !== 'function') return;
    if (file.type && file.type.indexOf('video/') !== 0) {
      setStatus('请选择一个视频文件。');
      return;
    }
    resetLesson();
    mediaPending = true;
    videoBroken = false;
    if (overlay) removeOverlay({ pauseVideo: false });
    if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    localVideoUrl = URL.createObjectURL(file);
    if (video.removeAttribute) video.removeAttribute('data-video-id');
    video.src = localVideoUrl;
    if (assetEmpty) assetEmpty.hidden = true;
    syncControls();
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
    waitingBar.style.setProperty('--wait-ms', FALLBACK_AFTER_MS + 'ms');
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
    if (presetResult && hasFrameSize() && !timeMatchesMaterial()) return seekStatus();
    return '';
  }

  /**
   * 把秒数收成一位小数，避免二进制尾巴出现在句子里。
   * @param {number} value
   * @returns {string}
   */
  function formatSecond(value) {
    return String(Math.round(value * 10) / 10);
  }

  /**
   * 定位按钮实际会跳到的秒数。有效输入优先，否则用准备结果自己的时间。
   * @returns {number}
   */
  function seekDestination() {
    const typed = targetTime();
    if (Number.isFinite(typed) && typed >= 0) return typed;
    return authoredTime();
  }

  /**
   * 两个秒数是否落在同一次时间容差里。
   * @param {number} left
   * @param {number} right
   * @returns {boolean}
   */
  function sameSecond(left, right) {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= timeTolerance() + 1e-9;
  }

  /**
   * 还没停在准备结果那一秒时，告诉用户下一步。
   * 句子里的秒数必须和定位按钮会跳到的秒数一致。
   * @returns {string}
   */
  function seekStatus() {
    const authored = authoredTime();
    const dest = seekDestination();
    if (!Number.isFinite(authored)) return '请暂停在目标时间。';
    if (!sameSecond(dest, authored)) {
      if (timeMatchesMaterial()) {
        return '目标时间已改成第 ' + formatSecond(dest) + ' 秒，准备结果只对应第 ' + formatSecond(authored) + ' 秒。';
      }
      return '准备结果对应第 ' + formatSecond(authored) + ' 秒。当前目标时间是第 ' + formatSecond(dest) + ' 秒。';
    }
    return '点定位，停在第 ' + formatSecond(authored) + ' 秒。';
  }

  /**
   * 还没有画面时的下一步。
   * @returns {string}
   */
  function pickStatus() {
    return '先选择一个视频。文件留在这台浏览器里。';
  }

  /**
   * 空闲时的状态句。素材对不上时写明它对应的秒数。
   * @returns {string}
   */
  function idleStatus() {
    if (bootFailure) return bootFailure;
    if (videoBroken) return '视频无法加载，未挂载交互层。';
    if (mediaPending) return '正在读取所选视频。';
    if (!hasFrameSize()) return pickStatus();
    if (lessonBlocksWake()) return lessonWakeStatus();
    const mismatch = materialMessage();
    if (mismatch) return mismatch;
    return atTarget() ? '现在点破壁。' : seekStatus();
  }

  /**
   * 破壁被挡住时的说明。只有宽度、高度还是 0 时保持原来的暂停提示。
   * @returns {string}
   */
  function wakeBlockedStatus() {
    if (videoBroken) return '视频无法加载，未挂载交互层。';
    if (mediaPending) return '正在读取所选视频。';
    if (!hasFrameSize()) return video && video.videoWidth > 0 ? '请先暂停在目标时间。' : pickStatus();
    return idleStatus();
  }

  /**
   * 把下一步对应的按钮亮出来，并在第一次出曲线之前藏起目标时间输入框。
   */
  function markGuide() {
    const state = sessionState();
    const busy = Boolean(state && (state.status === 'waiting' || state.status === 'recoverable-error'));
    const canSeek = hasFrameSize() && !videoBroken && !overlay && !busy && videoMatches() && !lessonBlocksWake();
    if (jumpTarget && jumpTarget.classList) jumpTarget.classList.toggle('is-next', canSeek && !atTarget());
    if (wakeButton && wakeButton.classList) {
      wakeButton.classList.toggle('is-next', Boolean(canSeek && atTarget() && !wakeButton.disabled));
    }
    const field = $('#target-time-field');
    const readout = $('#target-time-readout');
    if (field) field.hidden = !curveShown;
    if (readout) readout.hidden = curveShown;
    const jumpTip = jumpTarget && jumpTarget.querySelector ? jumpTarget.querySelector('.lg-tip') : null;
    const authored = authoredTime();
    const dest = seekDestination();
    if (jumpTarget && jumpTarget.setAttribute && Number.isFinite(dest)) {
      jumpTarget.setAttribute('aria-label', '定位到第 ' + formatSecond(dest) + ' 秒');
    }
    if (jumpTip && Number.isFinite(dest)) jumpTip.textContent = '定位到第 ' + formatSecond(dest) + ' 秒';
    if (readout && Number.isFinite(authored)) readout.textContent = '停在第 ' + formatSecond(authored) + ' 秒';
  }

  /**
   * 宽高必须同时就绪。只有宽度时去校验，会把残缺尺寸当成帧不匹配。
   * @returns {boolean}
   */
  function hasFrameSize() {
    if (mediaPending) return false;
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

  /**
   * 交互里挂的是这次阅读存好的点。来源仍是 preset，只换显示文案。
   * @param {object | null} result
   * @returns {boolean}
   */
  function isLessonResult(result) {
    return usingLessonCurve && Boolean(result) && result.source === 'preset' && result.fallback !== 'timeout';
  }

  function sourceText(result) {
    if (!result) return '等待素材';
    if (isPackagedVision(result)) return '识别结果';
    if (isLessonResult(result)) return '这次阅读';
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
    if (isLessonResult(result)) {
      sourceNote.textContent = '这一帧在阅读时已经算好。';
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
    try {
      return drawCurveUnsafe();
    } catch {
      cancelPresentation();
      dragging = false;
      dragOrigin = null;
      if (overlay) overlay.remove();
      overlay = null;
      window.__breakglassAlignment = null;
      if (controller) {
        controller.fail('render_failed', '曲线无法绘制，请重试或退出。');
        applyState(controller.getState());
      }
      return false;
    }
  }

  function drawCurveUnsafe() {
    const state = sessionState();
    if (!state || state.status !== 'interactive' || !state.result || !overlay) return;
    const result = state.result;
    const definition = result.definition;
    const rect = readContentRect();
    if (!rect) {
      const box = video.getBoundingClientRect();
      const previousPath = overlay.querySelector('path').getAttribute('d');
      // 已绘制结果遇到暂不支持的 object-fit，沿用原有的跳帧约定；零区域或空 SVG 则不能假装成功。
      if (previousPath && box.width > 0 && box.height > 0 && video.videoWidth > 0 && video.videoHeight > 0) return true;
      throw new Error('视频显示区域暂不可用。');
    }

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
      samples.push(definition.domain.min + span * (index / 80));
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
      const item = definition.parameters[row.name];
      // 阅读点的范围围着读数，可能超出页面写死的初值；先换范围再赋值，免得浏览器把值夹到旧边界。
      if (item) {
        row.input.min = String(item.min);
        row.input.max = String(item.max);
        row.input.step = String(item.step);
      }
      row.input.value = String(value);
      const precision = item && item.step > 0 ? Math.min(12, Math.max(1, -Math.floor(Math.log10(item.step)))) : 1;
      const rounded = Number(value.toFixed(precision));
      const tolerance = Math.max(Number.EPSILON * Math.max(Math.abs(value), Math.abs(rounded)) * 32, item ? item.step * 1e-9 : 0);
      const displayValue = (rounded !== 0 || value === 0) && Math.abs(rounded - value) <= tolerance
        ? value.toFixed(precision) : String(Number(value.toPrecision(12)));
      row.output.textContent = displayValue;
      if (item && row.input.setAttribute) {
        row.input.setAttribute('aria-valuetext', displayValue + '（范围 ' + item.min + ' 到 ' + item.max + '）');
      }
    });
    return true;
  }

  function removeOverlay({ pauseVideo = true } = {}) {
    cancelPresentation();
    pendingIdle = null;
    dragging = false;
    dragOrigin = null;
    placedRectKey = '';
    if (overlay) overlay.remove();
    overlay = null;
    window.__breakglassAlignment = null;
    if (pauseVideo && video && !video.paused) video.pause();
    if (wakeHandle) wakeHandle.exit();
    else paintPausedReady();
  }

  function createOverlay() {
    if (overlay) return drawCurve();
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
    return drawCurve();
  }

  function cancelPresentation() {
    presentationSerial += 1;
    if (presentationFrame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(presentationFrame);
    }
    presentationFrame = null;
  }

  /** 双 rAF 提供一次绘制机会；它不是像素呈现的硬件时间戳，隐藏页不计样本。 */
  function recordPresentation(timedOut, decidedAt, startedAt, lessonStartedAt) {
    cancelPresentation();
    if (!latencies || !overlay) return;
    const mounted = overlay;
    const domAt = localClock.now();
    if (timedOut) latencies.record('fallback-dom-ready', domAt - decidedAt, 'hot');
    if (lessonStartedAt !== null) latencies.record('lesson-wake-dom-ready', domAt - lessonStartedAt, 'hot');
    else if (startedAt !== null) latencies.record('preset-wake-dom-ready', domAt - startedAt, 'hot');
    if (typeof window.requestAnimationFrame !== 'function') return;
    const serial = presentationSerial;
    const current = () => serial === presentationSerial && overlay === mounted &&
      document.visibilityState !== 'hidden' && sessionState().status === 'interactive';
    presentationFrame = window.requestAnimationFrame(() => {
      if (!current()) { presentationFrame = null; return; }
      presentationFrame = window.requestAnimationFrame(() => {
        presentationFrame = null;
        if (!current()) return;
        const now = localClock.now();
        if (timedOut) latencies.record('fallback-frame-ready', now - decidedAt, 'hot');
        if (lessonStartedAt !== null) latencies.record('lesson-wake-frame-ready', now - lessonStartedAt, 'hot');
        else if (startedAt !== null) latencies.record('preset-wake-frame-ready', now - startedAt, 'hot');
        stage.dataset.presentationMetrics = JSON.stringify({ endpoint: 'two-animation-frames', pixelPresentationVerified: false, summary: latencies.summary() });
      });
    });
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
      }
    }
    const waiting = Boolean(sessionState() && sessionState().status === 'waiting');
    const ready = atTarget() && Boolean(presetResult);
    wakeButton.disabled = waiting || !ready || Boolean(overlay) || lessonBlocksWake();
    const playLabel = video.paused ? '播放' : '暂停';
    playToggle.setAttribute('aria-label', playLabel + '视频');
    if (playTip) playTip.textContent = playLabel;
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
    const state = sessionState();
    const idle = !state || state.status === 'paused-ready';
    if (!videoBroken && idle && !overlay && (materialMessage() || !atTarget())) {
      setStatus(idleStatus());
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
        else if (lessonBlocksWake()) reason = lessonWakeStatus();
        else if (!video.paused) reason = '请先暂停视频。';
        else if (!hasFrameSize()) reason = pickStatus();
        else if (materialMessage()) reason = materialMessage();
        else if (!atTarget()) reason = seekStatus();
        else if (!presetResult) reason = '当前没有可用的准备结果。';
        else reason = '当前还不能破壁。';
      }
      wakeReason.textContent = reason;
    }
    markGuide();
    if (resetReason) {
      resetReason.textContent = resetButton.disabled ? '需要先出现可交互的曲线再重置。' : '';
    }
  }

  function applyState(state) {
    if (!state) return;
    renderState(state);
    syncDisabledReasons();
  }

  /**
   * 会话回到 paused-ready 时复位按钮、来源和等待条。取消文案只在这一处消费。
   */
  function paintPausedReady() {
    visionStartedAt = null;
    hideWaitingControls();
    resetButton.disabled = true;
    exitButton.disabled = true;
    setSlidersEnabled(false);
    setPrimaryAction('wake');
    const note = pendingIdle;
    pendingIdle = null;
    if (note) {
      setSource(null, note.note);
      setStatus(note.status);
    } else {
      setSource(null);
      setStatus(idleStatus());
    }
    lessonWakeStartedAt = null;
    wakeStartedAt = null;
    wakeButton.disabled = !(atTarget() && Boolean(presetResult)) || lessonBlocksWake();
    markGuide();
  }

  function renderState(state) {
    // 取消、退出、播放或离开目标时间：判定没有结算，不记账。
    if (state.status === 'paused-ready') {
      cancelPresentation();
      paintPausedReady();
      return;
    }
    if (state.status === 'interactive') {
      const result = state.result;
      const timedOut = result && result.fallback === 'timeout';
      const decidedAt = localClock.now();
      if (!createOverlay()) return;
      curveShown = true;
      recordPresentation(timedOut, decidedAt, wakeStartedAt, lessonWakeStartedAt);
      wakeStartedAt = null;
      lessonWakeStartedAt = null;
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
        ? '已改用预先准备的示例。拖画面上的点，或拖右边的滑块。'
        : '拖画面上的点，或拖右边的滑块。按 Esc 退出。');
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
      cancelPresentation();
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
    if (lessonBlocksWake()) {
      setStatus(lessonWakeStatus());
      return;
    }
    if (!wakeHandle || !presetResult || !atTarget()) {
      setStatus(wakeBlockedStatus());
      return;
    }
    const state = sessionState();
    if (overlay || (state && (state.status === 'interactive' || state.status === 'waiting'))) return;
    const frameSize = { width: video.videoWidth, height: video.videoHeight };
    // 只有识别路径需要判定耗时；起点取自页面自己的时钟。阅读点改走自己的那一组。
    const visionPath = !usingLessonCurve && Boolean(config) && config.visionAdapter === 'fixture' && config.externalAttempt === 'off';
    visionStartedAt = visionPath && localClock ? localClock.now() : null;
    lessonWakeStartedAt = usingLessonCurve && localClock ? localClock.now() : null;
    wakeStartedAt = !usingLessonCurve && localClock ? localClock.now() : null;
    const started = wakeHandle.start({
      paused: true,
      currentTime: video.currentTime,
      frameSize
    });
    if (!started.ok) setStatus(started.message || '暂时无法破壁。');
  }

  function cancelWaiting() {
    if (!wakeHandle || !sessionState() || sessionState().status !== 'waiting') return;
    pendingIdle = {
      note: '已取消等待，迟到结果不会再打开交互层。',
      status: atTarget() ? '已取消等待，可以再次破壁。' : (materialMessage() || seekStatus())
    };
    wakeHandle.cancel();
  }

  /**
   * 换一条曲线：先拆掉旧的唤醒，再用这条曲线新建会话和 createWake。
   * 阅读点不走外部等待和识别样例，点击只取出已经存好的结果。
   * @param {object} result 已通过校验的准备结果
   * @param {boolean} fromLesson 是否是这次阅读的点
   */
  function mountWake(result, fromLesson) {
    if (wakeHandle) wakeHandle.dispose();
    presetResult = result;
    usingLessonCurve = Boolean(fromLesson);
    targetInput.value = String(fromLesson ? result.time : PACKAGED_DEMO_TARGET_SECONDS);
    const live = fromLesson ? { ...config, externalAttempt: 'off', visionAdapter: 'off' } : config;
    controller = new sessionApi.SessionController({
      videoId: result.videoId,
      targetTime: targetTime(),
      frameSize: result.frameSize,
      externalAttempt: live.externalAttempt
    });
    syncSessionTarget();
    wakeHandle = wakeApi.createWake({
      session: controller,
      config: live,
      preset: result,
      clock: localClock,
      onChange: (state) => applyState(state)
    });
    wakeMounts += 1;
    window.__breakglassWakeMounts = wakeMounts;
  }

  /**
   * 预先准备的 9 秒片不进入阅读。
   * @param {unknown} src
   * @returns {boolean}
   */
  function isPreparedSource(src) {
    return String(src || '').indexOf('breakglass-demo-9s.mp4') >= 0;
  }

  /**
   * 阅读中、定位中，或这支片子还没有可用的点时，不许破壁。
   * 这样不会把 demo-parabola 画到别人的片子上。
   * @returns {boolean}
   */
  function lessonBlocksWake() {
    if (!lesson) return false;
    return lesson.seeking || !usingLessonCurve;
  }

  /**
   * @returns {string}
   */
  function lessonWakeStatus() {
    if (!lesson) return '';
    if (lesson.seeking) return '正在定位，停稳后才能破壁。';
    if (lesson.phase === 'reading') return '正在读，第一处读好后会停在那一帧。';
    return '这次阅读没有可用的点，不能破壁。';
  }

  /**
   * 状态和「下一个」按钮只由这里写。note 是这一下要补充的一句。
   * @param {string} [note]
   */
  function renderLesson(note) {
    if (!lesson) {
      if (lessonNext) lessonNext.disabled = true;
      if (lessonCancel) lessonCancel.hidden = true;
      return;
    }
    const count = lesson.points.length;
    const parts = [];
    if (lesson.cancelled) parts.push('已取消阅读。');
    if (lesson.phase === 'reading') {
      parts.push(count > 0 ? '正在读，已存好 ' + count + ' 处。' : '正在读这段视频。');
      if (lesson.courseNote) parts.push(lesson.courseNote);
    } else if (!lesson.cancelled) {
      parts.push('读完了，共 ' + count + ' 处。');
    }
    if (note) parts.push(note);
    const later = lesson.shown ? lessonApi.nextPoint(lesson.points, lesson.shown.time) : null;
    const none = lesson.phase === 'ready' && !later;
    if (none && lesson.shown) parts.push('没有下一处。');
    if (lessonNext) lessonNext.disabled = !lesson.shown || lesson.seeking || none;
    if (lessonCancel) {
      lessonCancel.hidden = lesson.phase !== 'reading';
      lessonCancel.disabled = lesson.phase !== 'reading';
    }
    if (lessonStatus) lessonStatus.textContent = parts.join(' ');
  }

  /**
   * 停掉计时、请求和隐藏采样。已经存下的点不动。
   */
  function stopLessonWork() {
    if (lesson && lesson.timer != null && localClock) {
      localClock.clear(lesson.timer);
      lesson.timer = null;
    }
    if (lessonAskHandle) {
      lessonAskHandle.cancel();
      lessonAskHandle = null;
    }
    if (lessonProbe) {
      const probe = lessonProbe;
      lessonProbe = null;
      probe.finish();
    }
  }

  /**
   * 换片子时丢掉上一支片子的阅读。挂着的阅读曲线换回 demo-parabola。
   */
  function resetLesson() {
    stopLessonWork();
    lesson = null;
    lessonFallbackReason = '';
    if (lessonStatus) lessonStatus.textContent = '';
    if (usingLessonCurve && packagedPreset) {
      if (overlay) removeOverlay({ pauseVideo: false });
      mountWake(packagedPreset, false);
    }
    renderLesson();
  }

  /**
   * 片子有时长、且不是 9 秒片时开始阅读。空白地址直接退回。
   */
  function maybeStartLesson() {
    if (!lessonApi || !localClock || !packagedPreset || !video) return;
    const src = String(video.src || '');
    if (!src || isPreparedSource(src)) return;
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (lesson && lesson.src === src) return;
    resetLesson();
    lessonSerial += 1;
    const course = askApi ? askApi.prepareCourse(lessonNote ? lessonNote.value : '') : { message: '' };
    lesson = {
      src,
      readingId: 'reading-' + lessonSerial,
      videoId: 'local-binding-' + lessonSerial,
      duration,
      sampleTimes: [],
      frameSize: { width: video.videoWidth, height: video.videoHeight },
      phase: 'reading',
      cancelled: false,
      courseNote: course.message,
      points: [],
      dropped: [],
      first: null,
      shown: null,
      seeking: false,
      startedAt: localClock.now(),
      timer: null,
      pendingJump: null,
      jumps: []
    };
    if (video.removeAttribute) video.removeAttribute('data-video-id');
    renderLesson();
    setStatus(idleStatus());
    syncControls();
    const url = lessonEndpoint ? String(lessonEndpoint.value || '').trim() : '';
    if (!url || !askApi) {
      fallbackToPrepared('empty');
      return;
    }
    const owner = lesson;
    owner.timer = localClock.schedule(askApi.DEADLINE_MS, () => {
      if (lesson !== owner) return;
      owner.timer = null;
      if (owner.points.length === 0) fallbackToPrepared('timeout');
      else finishLesson();
    });
    captureFrames(lessonApi.sampleTimes(duration)).then((frames) => {
      if (lesson !== owner || owner.phase !== 'reading') return;
      if (frames.length === 0) {
        lessonFailed(owner, 'unavailable');
        return;
      }
      const body = askApi.requestBody({
          readingId: owner.readingId,
          videoId: owner.videoId,
          duration: owner.duration,
          frameSize: owner.frameSize,
          courseText: lessonNote ? lessonNote.value : '',
          frames
        });
      owner.sampleTimes = body.frames.map((frame) => frame.time);
      lessonAskHandle = askApi.startLessonAsk({
        url,
        body,
        fetchImpl: (address, init) => fetch(address, init),
        clock: localClock,
        onSuccess: (payload) => {
          if (lesson !== owner || owner.phase !== 'reading') return;
          lessonAskHandle = null;
          (Array.isArray(payload.points) ? payload.points : []).forEach((point) => offerLessonPoint(point));
          if (lesson !== owner) return;
          if (owner.points.length === 0) fallbackToPrepared('unavailable');
          else finishLesson();
        },
        onFailure: (code) => lessonFailed(owner, code)
      });
    });
  }

  /**
   * 在隐藏视频上按采样时刻截图。舞台上的片子不跟着动。
   * 测试可以预先放一个 window.__breakglassLessonFrames(times) 直接给出画面。
   * @param {number[]} times 秒
   * @returns {Promise<{ time: number, image: string }[]>}
   */
  function captureFrames(times) {
    const hook = window.__breakglassLessonFrames;
    if (typeof hook === 'function') {
      return Promise.resolve()
        .then(() => hook(times.slice()))
        .then((frames) => (Array.isArray(frames) ? frames : []))
        .catch(() => []);
    }
    if (!lesson || times.length === 0 || typeof document.createElement !== 'function') return Promise.resolve([]);
    const src = lesson.src;
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      const canvas = document.createElement('canvas');
      const frames = [];
      let index = 0;
      let done = false;
      const handle = { finish };
      lessonProbe = handle;
      function finish() {
        if (done) return;
        done = true;
        if (lessonProbe === handle) lessonProbe = null;
        if (probe.removeAttribute) probe.removeAttribute('src');
        if (typeof probe.load === 'function') probe.load();
        resolve(frames);
      }
      function step() {
        if (lessonProbe !== handle || index >= times.length) {
          finish();
          return;
        }
        probe.currentTime = times[index];
      }
      probe.addEventListener('seeked', () => {
        if (done) return;
        const image = snapshotFrame(probe, canvas);
        if (image) frames.push({ time: times[index], image });
        index += 1;
        step();
      });
      probe.addEventListener('loadeddata', function onLoaded() {
        probe.removeEventListener('loadeddata', onLoaded);
        step();
      });
      probe.addEventListener('error', finish);
      probe.muted = true;
      probe.preload = 'auto';
      probe.src = src;
    });
  }

  /**
   * 把隐藏视频当前帧缩到宽 640 以内，转成 JPEG。画不出来时返回空串。
   * @param {HTMLVideoElement} probe
   * @param {HTMLCanvasElement} canvas
   * @returns {string}
   */
  function snapshotFrame(probe, canvas) {
    const width = probe.videoWidth;
    const height = probe.videoHeight;
    if (!(width > 0 && height > 0) || !canvas || typeof canvas.getContext !== 'function') return '';
    const scale = Math.min(1, 640 / width);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return '';
    try {
      context.drawImage(probe, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return '';
    }
  }

  /**
   * 收下一处结果。已经存好的点不会因为后来的点被挤掉；
   * 和已存点冲突的新点直接丢掉。第一处通过后定位过去，之后到的点只入库。
   * @param {object} candidate
   * @returns {{ ok: boolean, reason?: string }}
   */
  function offerLessonPoint(candidate) {
    if (!lesson || lesson.phase !== 'reading' || !lessonApi) return { ok: false, reason: '不是这一段视频' };
    let point = null;
    try {
      point = JSON.parse(JSON.stringify(candidate));
    } catch {
      point = null;
    }
    const verdict = lessonApi.validateLessonReading({
      readingId: lesson.readingId,
      videoId: lesson.videoId,
      origin: 'external',
      duration: lesson.duration,
      points: lesson.points.concat([point])
    }, { width: video.videoWidth, height: video.videoHeight }, lesson);
    const kept = new Set(verdict.points.map((item) => item.id));
    const storedStay = lesson.points.every((item) => kept.has(item.id));
    const accepted = Boolean(point) && verdict.points.indexOf(point) >= 0 && storedStay;
    if (!accepted) {
      const reason = verdict.dropped.length > 0 ? verdict.dropped[0].reason : '抛物线没有通过检查';
      lesson.dropped.push({ id: point && typeof point.id === 'string' ? point.id : '', reason });
      renderLesson('丢掉一处：' + reason + '。');
      return { ok: false, reason };
    }
    lesson.points = verdict.points;
    if (!lesson.first) {
      lesson.first = point;
      if (latencies) latencies.record('lesson-first-point', localClock.now() - lesson.startedAt, 'hot');
      seekLessonPoint(point, null);
      return { ok: true };
    }
    renderLesson();
    return { ok: true };
  }

  /**
   * 先拿走当前曲线，再暂停并定位。落定之前破壁保持禁用。
   * @param {object} point
   * @param {{ before: number, after: number | null, wakeDisabled: boolean } | null} jump
   */
  function seekLessonPoint(point, jump) {
    lesson.seeking = true;
    lesson.shown = point;
    lesson.pendingJump = jump;
    lessonWakeStartedAt = null;
    if (overlay) removeOverlay({ pauseVideo: false });
    else if (wakeHandle && sessionState() && sessionState().status !== 'paused-ready') wakeHandle.exit();
    wakeButton.disabled = true;
    syncDisabledReasons();
    setStatus(lessonWakeStatus());
    renderLesson();
    if (jump) jump.wakeDisabled = wakeButton.disabled;
    video.pause();
    video.currentTime = point.time;
    if (!video.seeking) settleLessonSeek();
  }

  /**
   * 已暂停且离这一处不超过 0.2 秒才算停稳。停稳后才换上这一处的曲线。
   */
  function settleLessonSeek() {
    if (!lesson || !lesson.seeking || !lesson.shown) return;
    const point = lesson.shown;
    if (!video.paused || Math.abs(video.currentTime - point.time) > 0.2 + 1e-9) return;
    lesson.seeking = false;
    mountWake(point.curve, true);
    if (lesson.pendingJump) {
      lesson.pendingJump.after = video.currentTime;
      lesson.jumps.push(lesson.pendingJump);
      lesson.pendingJump = null;
    }
    renderLesson();
    setSource(null);
    setStatus(idleStatus());
    syncControls();
  }

  /**
   * 「下一个」：有更晚的已存点就过去；还在读就留在原地；读完了就说没有下一处。
   */
  function lessonGoNext() {
    if (!lesson || !lesson.shown || lesson.seeking || (lessonNext && lessonNext.disabled)) return;
    const later = lessonApi.nextPoint(lesson.points, lesson.shown.time);
    if (later) {
      seekLessonPoint(later, { before: video.currentTime, after: null, wakeDisabled: false });
      return;
    }
    if (lesson.phase === 'reading') {
      renderLesson('下一处还在读。');
      return;
    }
    renderLesson();
  }

  /**
   * 读完：停掉采样和请求，保留已存的点。
   * @param {string} [note]
   */
  function finishLesson(note) {
    if (!lesson) return;
    stopLessonWork();
    lesson.phase = 'ready';
    renderLesson(note);
    syncControls();
  }

  /**
   * 请求失败。已有存点就只结束阅读；一处都没有才退回。
   * @param {object} owner 发起请求时的那次阅读
   * @param {string} code
   */
  function lessonFailed(owner, code) {
    if (lesson !== owner || owner.phase !== 'reading') return;
    lessonAskHandle = null;
    if (owner.points.length > 0) {
      finishLesson('外部阅读没有返回可用结果。');
      return;
    }
    fallbackToPrepared(code);
  }

  /**
   * 取消：停掉还没完成的采样和请求。已经存下的点留着，不退回。
   */
  function cancelLesson() {
    if (!lesson || lesson.phase !== 'reading') return;
    lesson.cancelled = true;
    finishLesson();
    setStatus(idleStatus());
  }

  /**
   * 读不出来就回到预先准备的 9 秒片，清空这支片子的点，挂回 demo-parabola。
   * @param {string} code empty / timeout / unavailable
   */
  function fallbackToPrepared(code) {
    const reason = code === 'timeout' ? '这次没读完。' : '外部阅读没有返回可用结果。';
    stopLessonWork();
    lesson = null;
    if (overlay) removeOverlay({ pauseVideo: false });
    if (localVideoUrl) {
      URL.revokeObjectURL(localVideoUrl);
      localVideoUrl = '';
    }
    mediaPending = true;
    videoBroken = false;
    if (video.setAttribute && packagedPreset) video.setAttribute('data-video-id', packagedPreset.videoId);
    video.src = PACKAGED_VIDEO_URL;
    if (packagedPreset) mountWake(packagedPreset, false);
    renderLesson();
    lessonFallbackReason = reason;
    if (lessonStatus) lessonStatus.textContent = reason + '已回到预先准备的片子。';
    setSource(null);
    setStatus(reason + '已回到预先准备的片子。');
    syncControls();
  }

  /**
   * 验收只看记下来的数。破壁出现至少 20 次且 P95 ≤ 100，
   * 并且对齐真的测过、偏差不超过 2%，才算过。
   * @returns {{ passed: boolean, wakeVisible: { count: number, p95: number | null }, firstPoint: { count: number, max: number | null }, measured: boolean, maxRatio: number | null, jumps: number }}
   */
  function lessonAcceptance() {
    const summary = latencies ? latencies.summary() : {};
    const wakeSummary = summary['lesson-wake-frame-ready'];
    const firstSummary = summary['lesson-first-point'];
    const reading = window.__breakglassAlignment;
    const measured = Boolean(reading) && reading.measured === true;
    const maxRatio = reading && Number.isFinite(reading.maxRatio) ? reading.maxRatio : null;
    const count = wakeSummary ? wakeSummary.count : 0;
    const p95 = wakeSummary ? wakeSummary.p95 : null;
    return {
      passed: false,
      estimatedThresholdMet: count >= 20 && p95 !== null && p95 <= 100 && measured && maxRatio !== null && maxRatio <= 0.02,
      pixelPresentationVerified: false,
      measurement: 'two-animation-frames; pixel presentation requires browser evidence',
      wakeVisible: { count, p95 },
      firstPoint: { count: firstSummary ? firstSummary.count : 0, max: firstSummary ? firstSummary.max : null },
      measured,
      maxRatio,
      jumps: lesson ? lesson.jumps.length : 0
    };
  }

  window.__breakglassLesson = {
    offer: (point) => offerLessonPoint(point),
    finish: () => {
      if (!lesson || lesson.phase !== 'reading') return;
      if (lesson.points.length > 0) finishLesson();
      else fallbackToPrepared('unavailable');
    },
    binding: () => (lesson
      ? { readingId: lesson.readingId, videoId: lesson.videoId, duration: lesson.duration, phase: lesson.phase }
      : null),
    points: () => (lesson ? lesson.points.map((item) => ({ id: item.id, time: item.time })) : []),
    dropped: () => (lesson ? lesson.dropped.map((item) => ({ ...item })) : []),
    jumps: () => (lesson ? lesson.jumps.map((item) => ({ ...item })) : []),
    acceptance: lessonAcceptance
  };

  async function boot() {
    const packagedPromise = attachPackagedVideo();
    try {
      const loaded = await preset.loadPreset();
      if (!loaded.ok) throw new Error(loaded.message);
      config = loaded.config;
      packagedPreset = loaded.result;
      localClock = createClock();
      latencies = latencyApi.createLatencyLog({ clock: localClock });
      mountWake(packagedPreset, false);
      window.__breakglassLatency = {
        summary: () => latencies.summary(),
        snapshot: () => latencies.snapshot(),
        measurement: () => ({ dom: 'SVG path ready in JavaScript', frame: 'second requestAnimationFrame; one rendering opportunity', pixelPresentationVerified: false })
      };
      watchDevicePixelRatio();
      watchVideoSize();
      runtimeNote.textContent = `配置：${config.externalAttempt} · 本地预制已预热 · 回退 ${config.fallbackAfterMs}ms`;
      const packaged = await packagedPromise;
      if (!packaged && !video.error && !localVideoUrl) {
        setStatus(pickStatus());
      }
      setSource(null);
      maybeStartLesson();
    } catch (error) {
      bootFailure = error.message || '配置加载失败。';
      try {
        await packagedPromise;
      } catch {
        // 挂片失败不再额外覆盖配置错误。
      }
      if (video && !localVideoUrl) {
        if (video.removeAttribute) video.removeAttribute('src');
        video.src = '';
      }
      runtimeNote.textContent = '配置加载失败';
      setStatus(bootFailure);
    }
    syncControls();
  }

  video.addEventListener('resize', syncControls);
  video.addEventListener('loadedmetadata', () => {
    mediaPending = false;
    videoBroken = false;
    assetEmpty.hidden = true;
    if (!overlay) setStatus(idleStatus());
    syncControls();
    maybeStartLesson();
  });
  // 只有阅读点的定位在等这一下。其它跳转照旧由 timeupdate / pause 同步。
  video.addEventListener('seeked', () => {
    if (lesson && lesson.seeking) settleLessonSeek();
  });
  video.addEventListener('timeupdate', syncControls);
  video.addEventListener('play', syncControls);
  video.addEventListener('pause', syncControls);
  video.addEventListener('ended', syncControls);
  video.addEventListener('error', () => {
    if (bootFailure) return;
    if (lessonFallbackReason && isPreparedSource(video.src) && lessonStatus) {
      lessonStatus.textContent = lessonFallbackReason + '预先准备的片子没有加载出来。';
    }
    mediaPending = false;
    videoBroken = true;
    assetEmpty.hidden = false;
    removeOverlay();
    setStatus('视频无法加载，未挂载交互层。', 'error');
  });
  const localVideoInput = $('#local-video');
  if (localVideoInput) {
    localVideoInput.addEventListener('change', () => {
      const file = localVideoInput.files && localVideoInput.files[0];
      if (file) useLocalVideo(file);
    });
  }
  window.addEventListener('resize', drawCurve);
  document.addEventListener('fullscreenchange', drawCurve);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelPresentation();
  });
  window.addEventListener('orientationchange', drawCurve);
  window.addEventListener('pagehide', () => {
    stopLessonWork();
    removeOverlay({ pauseVideo: false });
    if (localVideoUrl) {
      URL.revokeObjectURL(localVideoUrl);
      localVideoUrl = '';
    }
    releaseWatch();
    const docks = window.BreakGlassUI && window.BreakGlassUI.docks;
    if (Array.isArray(docks)) {
      docks.forEach((dock) => {
        if (dock && typeof dock.destroy === 'function') dock.destroy();
      });
    }
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
    if (!overlay || overlay.contains(event.target)) return;
    // 原生控制条属于 video。点它只操作播放器，不把交互层拆掉。
    if (event.target === video || (video.contains && video.contains(event.target))) return;
    removeOverlay();
  });
  playToggle.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => setStatus('视频当前无法播放。'));
    else video.pause();
  });
  jumpTarget.addEventListener('click', () => {
    if (!video.videoWidth) {
      setStatus(pickStatus());
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
  if (lessonNext) lessonNext.addEventListener('click', lessonGoNext);
  if (lessonCancel) lessonCancel.addEventListener('click', cancelLesson);
  cancelButton.addEventListener('click', cancelWaiting);
  retryButton.addEventListener('click', wake);
  resetButton.addEventListener('click', () => {
    dragging = false;
    dragOrigin = null;
    if (controller) controller.reset();
    if (drawCurve()) setStatus('已恢复本次结果的初始参数。');
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
