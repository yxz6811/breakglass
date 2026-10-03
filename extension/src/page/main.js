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
  const currentFrameApi = window.BreakGlass.currentFrame || null;
  const figuresApi = window.BreakGlass.figures || null;
  const tutorNumbers = window.BreakGlass.tutorNumbers;
  const tutorApi = window.BreakGlass.tutor || null;
  const tutorFigures = window.BreakGlass.tutorFigures || null;
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
  const figureSelect = $('#figure-kind');
  const figureTitle = $('#figure-title');
  const figureFormula = $('#figure-formula');
  const figureNote = $('#figure-note');
  const parabolaParameters = $('#parabola-parameters');
  const localParameters = $('#local-parameters');
  const figureRows = [1, 2, 3].map((index) => ({
    row: $('#figure-row-' + index), label: $('#figure-label-' + index),
    input: $('#parameter-figure-' + index), output: $('#parameter-figure-' + index + '-value'), name: null
  }));
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
  const stageBanner = $('#stage-banner');
  const stageBannerTitle = $('#stage-banner-title');
  const stageBannerDetail = $('#stage-banner-detail');
  const wakeTip = wakeButton ? wakeButton.querySelector('.lg-tip') : null;
  const tutorForm = $('#tutor-form');
  const tutorInput = $('#tutor-input');
  const tutorSend = $('#tutor-send');
  const tutorLog = $('#tutor-log');
  const tutorHint = $('#tutor-hint');
  const tutorExamples = $('#tutor-examples');
  let tutorExampleButtons = tutorExamples && typeof tutorExamples.querySelectorAll === 'function'
    ? Array.from(tutorExamples.querySelectorAll('[data-tutor-example]')) : [];
  /** 提问记录最多保留的条数，问与答各算一条。 */
  const TUTOR_LOG_LIMIT = 20;
  /**
   * 记录属于哪一次破壁、哪一种图形。变了就清空，免得旧图形的数字留在旁边。
   * @type {string}
   */
  let tutorEpoch = '';
  /** 示例按钮现在是哪种图形的问法。页面初始写的是抛物线。 */
  let tutorExamplesKind = 'parabola';

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
  // 本地探索属于 004 故事 1；不改 CurveResult、识别白名单或 1500ms 唤醒。
  // 产品约束：docs/BreakGlass-constitution.md。提问读取的也必须是这一份状态。
  let figureKind = 'parabola';
  let localFigure = null;
  let figureOutsideWindow = false;
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
  /**
   * 阅读采样进行到哪一张。只给画面上的「正在看」用。
   * @type {{ phase: 'frame' | 'waiting', index: number, total: number, time: number } | null}
   */
  let lessonLook = null;
  /** 阅读点破壁的起点。只在点已经存好并落定时置位。 */
  let lessonWakeStartedAt = null;
  let currentFrameWakeStartedAt = null;
  let wakeStartedAt = null;
  let presentationSerial = 0;
  let presentationFrame = null;
  /** 刚退回 9 秒片时的原因。那支片子加载失败时要改口，不能说已经回去了。 */
  let lessonFallbackReason = '';
  /** 用户片子已在画面上，但阅读地址还空着。 */
  let awaitingEndpoint = false;
  /** 地址栏连续输入时，等停手再决定要不要开始看。 */
  let endpointWait = null;
  let wakeMounts = 0;
  window.__breakglassWakeMounts = wakeMounts;
  // 独立的按需单帧请求，不进入 P0 的 1500ms 示范回退。
  // 产品约束：docs/BreakGlass-constitution.md 第 IX 条。
  let frameRead = null;
  let frameReadSerial = 0;
  let frameMediaEpoch = 0;
  let frameReadFailure = null;
  let usingCurrentFrame = false;
  let currentFrameSource = '';
  let localVideoSerial = 0;
  let localVideoIdentity = '';

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
   * 点「选择预设」才挂上包内 9 秒片。进入页面时不自动选中。
   * @returns {Promise<void>}
   */
  async function choosePackagedVideo() {
    if (bootFailure || !video) return;
    invalidateFrameRead();
    resetLesson();
    if (overlay) removeOverlay({ pauseVideo: false });
    if (localVideoUrl) {
      URL.revokeObjectURL(localVideoUrl);
      localVideoUrl = '';
    }
    videoBroken = false;
    mediaPending = true;
    if (video.setAttribute && packagedPreset) video.setAttribute('data-video-id', packagedPreset.videoId);
    const attached = await attachPackagedVideo();
    if (!attached) {
      mediaPending = false;
      if (!bootFailure) setStatus('预先准备的片子没有加载出来。');
    }
    syncControls();
  }

  /**
   * 文件明确不存在时才不挂 src。
   * 不用 Range 探测：只取 1 个字节会写进缓存，断网重载后 video 可能只拿到残缺尺寸。
   * fetch 在断网时会失败，这时仍把地址交给 video，扩展包内的文件可以由播放器自己读。
   * 只在用户点「选择预设」，或阅读失败退回时调用。
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
    invalidateFrameRead();
    resetLesson();
    mediaPending = true;
    videoBroken = false;
    if (overlay) removeOverlay({ pauseVideo: false });
    if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    localVideoUrl = URL.createObjectURL(file);
    localVideoIdentity = 'current-video-' + (++localVideoSerial);
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
    sliderRows.forEach((row) => { if (row.input) row.input.disabled = !enabled || figureKind !== 'parabola'; });
    figureRows.forEach((row) => { if (row.input) row.input.disabled = !enabled || figureKind === 'parabola' || !row.name; });
    if (figureSelect) figureSelect.disabled = !enabled || !figuresApi;
    setTutorEnabled(enabled);
  }

  /**
   * 提问区与滑块同时可用、同时禁用。禁用时提示先破壁。
   * @param {boolean} enabled
   */
  function setTutorEnabled(enabled) {
    const usable = Boolean(enabled && tutorApi);
    if (tutorInput) tutorInput.disabled = !usable;
    if (tutorSend) tutorSend.disabled = !usable;
    tutorExampleButtons.forEach((button) => { button.disabled = !usable; });
    if (tutorHint) {
      tutorHint.textContent = usable
        ? '用平常的话问：改一个系数，或问某个 x 上的 y。回答里的数就是画面上的数。'
        : '先破壁，再问这条曲线。';
    }
  }

  /**
   * 往提问记录里追加一条。只写 textContent，用户原话不当作标记解析。
   * @param {'user' | 'tutor' | 'note'} role
   * @param {string} text
   */
  function appendTutorEntry(role, text) {
    if (!tutorLog || typeof document.createElement !== 'function') return;
    const entry = document.createElement('p');
    entry.className = 'tutor__entry tutor__entry--' + role;
    if (role === 'note') {
      entry.textContent = text;
    } else {
      const who = document.createElement('span');
      who.className = 'tutor__who';
      who.textContent = role === 'user' ? '你：' : '答：';
      const body = document.createElement('span');
      body.textContent = text;
      entry.appendChild(who);
      entry.appendChild(body);
    }
    tutorLog.appendChild(entry);
    // 超出上限时从最早一条删起；删到问题时连同紧跟的回答一起删，不留没有问题的回答。
    while (tutorLog.children.length > TUTOR_LOG_LIMIT) {
      tutorLog.children[0].remove();
      while (tutorLog.children.length && /tutor__entry--tutor/.test(tutorLog.children[0].className)) tutorLog.children[0].remove();
    }
    tutorLog.hidden = false;
    tutorLog.scrollTop = tutorLog.scrollHeight;
  }

  function clearTutorLog() {
    if (!tutorLog) return;
    while (tutorLog.children.length) tutorLog.children[0].remove();
    tutorLog.hidden = true;
  }

  /**
   * 示例换成这种图形的问法。只在图形种类变了时重建；按钮只写 textContent。
   * @param {string} kind
   */
  function renderTutorExamples(kind) {
    if (kind === tutorExamplesKind || !tutorExamples || !tutorFigures || typeof document.createElement !== 'function') return;
    const entry = tutorFigures.get(kind);
    if (!entry) return;
    tutorExampleButtons.forEach((button) => button.remove());
    tutorExampleButtons = entry.examples.map((text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tutorExample = text;
      button.textContent = text;
      tutorExamples.appendChild(button);
      return button;
    });
    tutorExamplesKind = kind;
  }

  /**
   * 提问区跟着画面上的图形走：换了一次破壁或换了图形，就清空记录、换示例。
   * @param {object | null} figure activeFigure() 的结果
   */
  function syncTutorFigure(figure) {
    const state = figure ? sessionState() : null;
    const epoch = figure ? String(state && state.requestId || '') + '|' + figure.kind : '';
    if (epoch === tutorEpoch) return;
    tutorEpoch = epoch;
    clearTutorLog();
    renderTutorExamples(figure ? figure.kind : 'parabola');
  }

  /**
   * 两份系数逐项相同。
   * @param {Record<string, number>} left
   * @param {Record<string, number>} right
   * @returns {boolean}
   */
  function sameParameters(left, right) {
    const names = Object.keys(left);
    return names.length === Object.keys(right).length && names.every((name) => right[name] === left[name]);
  }

  /**
   * 写回提问得到的系数，与滑块走同一个 updateFigureParameters，一次写完。
   * 画面已不是送出时那一次破壁、那一种图形，或写入失败、写完的数与解答不一致时，
   * 退回送出时的系数，返回失败原因。
   * @param {ReturnType<typeof tutorApi.snapshotFrom>} snapshot
   * @param {ReturnType<typeof tutorApi.ask>} answer
   * @returns {{ ok: true } | { ok: false, code: string }}
   */
  function applyTutorAnswer(snapshot, answer) {
    const state = sessionState();
    const current = figureSnapshot();
    const before = {};
    Object.keys(snapshot.parameters).forEach((name) => { before[name] = snapshot.parameters[name].value; });
    const sameKeys = Object.keys(answer.parameters).sort().join(',') === Object.keys(before).sort().join(',');
    if (!overlay || !state || state.status !== 'interactive' || state.requestId !== snapshot.requestId
      || !current || current.kind !== snapshot.kind || !sameParameters(before, current.parameters) || !sameKeys) {
      return { ok: false, code: 'stale' };
    }
    const updates = {};
    answer.adjustments.forEach((item) => { if (item.adopted !== item.before) updates[item.name] = item.adopted; });
    const outcome = updateFigureParameters(updates);
    if (outcome && outcome.ok && outcome.figure && sameParameters(answer.parameters, outcome.figure.parameters)) {
      dragging = false;
      dragOrigin = null;
      return { ok: true };
    }
    const written = figureSnapshot();
    if (written && written.kind === snapshot.kind && !sameParameters(before, written.parameters)) updateFigureParameters(before);
    return { ok: false, code: outcome && !outcome.ok && outcome.code ? outcome.code : 'mismatch' };
  }

  /**
   * 写回失败时的回答。这时图像保持送出前的样子。
   * @param {string} code
   * @returns {string}
   */
  function tutorFailureReply(code) {
    if (code === 'mapping_unavailable') return '画面的显示区域现在对不上，这次没有改图。恢复显示区域后再问一次。';
    return '画面刚刚变了，这次没有改成功，图像保持原样。可以再问一次。';
  }

  /**
   * 送出提问区的一句话：用画面上当前图形的快照求解，必要时写回系数并重画，再记下问与答。
   */
  function submitTutor() {
    if (!tutorApi || !tutorInput || tutorInput.disabled) return;
    const text = String(tutorInput.value || '').trim();
    const state = sessionState();
    const snapshot = tutorApi.snapshotFrom(figureSnapshot(), {
      requestId: state ? state.requestId : null,
      interactive: Boolean(state && state.status === 'interactive' && overlay)
    });
    const answer = tutorApi.ask(snapshot, text);
    if (!text) {
      tutorInput.value = '';
      appendTutorEntry('tutor', answer.reply);
      return;
    }
    let reply = answer.reply;
    if (answer.kind === 'applied' && answer.changed) {
      const applied = applyTutorAnswer(snapshot, answer);
      if (!applied.ok) reply = tutorFailureReply(applied.code);
    }
    appendTutorEntry('user', text);
    appendTutorEntry('tutor', reply);
    tutorInput.value = '';
  }

  function activeFigure() {
    const state = sessionState();
    if (!figuresApi || !state || state.status !== 'interactive' || !state.result) return null;
    if (figureKind !== 'parabola') return localFigure;
    const figure = figuresApi.createFigure('parabola', state.result.definition);
    figure.parameters = { ...state.currentParameters };
    return figure;
  }

  function syncFigureControls() {
    const figure = activeFigure();
    const local = Boolean(figure && figure.kind !== 'parabola');
    if (figureSelect) figureSelect.value = figure ? figure.kind : 'parabola';
    if (figureTitle) figureTitle.textContent = (figure ? figure.label : '抛物线') + '参数';
    if (parabolaParameters) parabolaParameters.hidden = local;
    if (localParameters) localParameters.hidden = !local;
    if (figureFormula) {
      figureFormula.hidden = !figure;
      figureFormula.textContent = figure && figuresApi.formula ? figuresApi.formula(figure) : '';
    }
    if (figureNote) figureNote.textContent = !figure
      ? '破壁后可切换图形。新图形由本地公式绘制。'
      : local && figureOutsideWindow ? '当前图形全部在坐标窗口外。调整系数或重置，可以让它回到窗口内。'
        : local ? '本地数学图形 · 未从视频识别。重置只恢复当前图形。' : '切换图形可探索直线、圆与正弦。';
    if (figure && !local) sliderRows.forEach((row) => {
      if (!row.input || !row.output) return;
      const item = figure.definition.parameters[row.name];
      row.input.min = String(item.min);
      row.input.max = String(item.max);
      row.input.step = String(item.step);
      row.input.value = String(figure.parameters[row.name]);
      row.output.textContent = formatParameter(figure.parameters[row.name], item);
      row.input.setAttribute('aria-valuetext', row.output.textContent + '（范围 ' + item.min + ' 到 ' + item.max + '）');
    });
    const names = local ? Object.keys(figure.definition.parameters) : [];
    figureRows.forEach((row, index) => {
      row.name = names[index] || null;
      if (row.row) row.row.hidden = !row.name;
      if (!row.name || !row.input || !row.output) return;
      const item = figure.definition.parameters[row.name];
      if (row.label) row.label.textContent = item.label || row.name;
      row.input.min = String(item.min);
      row.input.max = String(item.max);
      row.input.step = String(item.step);
      row.input.value = String(figure.parameters[row.name]);
      row.output.textContent = formatParameter(figure.parameters[row.name], item);
      row.input.setAttribute('aria-valuetext', row.output.textContent + '（范围 ' + item.min + ' 到 ' + item.max + '）');
    });
    syncTutorFigure(figure);
    setSlidersEnabled(Boolean(figure));
  }

  /**
   * 滑块标签的写法。提问区的回答用同一个函数，滑块上的数与回答里的数逐字相同。
   * @param {number} value
   * @param {{ step: number } | undefined} item
   * @returns {string}
   */
  function formatParameter(value, item) {
    return tutorNumbers.formatParameter(value, item);
  }

  function clearFigure() {
    figureKind = 'parabola';
    localFigure = null;
    figureOutsideWindow = false;
  }

  function unavailableFigureMapping() {
    if (readContentRect()) return null;
    const failure = { ok: false, code: 'mapping_unavailable', message: '当前视频显示区域无法更新图形，本次没有改图。请恢复显示区域后重试。' };
    syncFigureControls();
    setStatus(failure.message, 'error');
    return failure;
  }

  function selectFigure(kind) {
    const state = sessionState();
    if (!figuresApi || !overlay || !state || state.status !== 'interactive') return { ok: false, code: 'not_interactive' };
    const unavailable = unavailableFigureMapping();
    if (unavailable) return unavailable;
    let candidate;
    try {
      const base = state.result.definition;
      const frame = state.result.frameSize;
      // 新图形使用清晰的本地坐标窗口；视频抛物线仍保持原来的区域与范围。
      const localBase = kind === 'parabola' ? base : {
        ...base,
        domain: { min: -4, max: 4 }, range: { min: -4, max: 4 },
        region: { x: frame.width * .08, y: frame.height * .08, width: frame.width * .84, height: frame.height * .78 }
      };
      candidate = figuresApi.createFigure(kind, localBase);
    }
    catch { return { ok: false, code: 'unknown_figure' }; }
    dragging = false;
    dragOrigin = null;
    figureKind = kind;
    localFigure = kind === 'parabola' ? null : candidate;
    if (!drawCurve()) return { ok: false, code: 'render_failed' };
    setSource(state.result);
    setStatus(figureOutsideWindow ? '当前图形全部在坐标窗口外。调整系数或重置，可以让它回到窗口内。'
      : candidate.label + '已显示。调整自己的系数，或拖动画面控制点。');
    return { ok: true, figure: figureSnapshot() };
  }

  function figureSnapshot() {
    const figure = activeFigure();
    return figure ? JSON.parse(JSON.stringify(figure)) : null;
  }

  function updateFigureParameters(updates) {
    const figure = activeFigure();
    if (!figure || !overlay) return { ok: false, code: 'not_interactive' };
    const unavailable = unavailableFigureMapping();
    if (unavailable) return unavailable;
    const changed = figuresApi.updateParameters(figure, updates);
    if (!changed.ok) return changed;
    if (figureKind === 'parabola') {
      Object.entries(changed.figure.parameters).forEach(([name, value]) => controller.setParameter(name, value));
    } else localFigure = changed.figure;
    if (!drawCurve()) return { ok: false, code: 'render_failed' };
    setStatus(figureOutsideWindow ? '当前图形全部在坐标窗口外。调整系数或重置，可以让它回到窗口内。'
      : figure.label + '系数已更新。图形按当前数值绘制。');
    return { ...changed, figure: figureSnapshot() };
  }

  function resetFigureParameters() {
    if (!activeFigure()) return { ok: false, code: 'not_interactive' };
    const unavailable = unavailableFigureMapping();
    if (unavailable) return unavailable;
    dragging = false;
    dragOrigin = null;
    if (figureKind === 'parabola') controller.reset();
    else localFigure = figuresApi.resetFigure(localFigure);
    if (!drawCurve()) return { ok: false, code: 'render_failed' };
    setStatus(figureOutsideWindow ? '已恢复初始参数，图形仍在坐标窗口外。请调整系数。' : '已恢复当前图形的初始参数。');
    return { ok: true, figure: figureSnapshot() };
  }

  // 故事 2 使用此接口，与滑块/拖动共用真实状态；不接受字符串代码或改变视频识别来源。
  window.BreakGlass.figureSession = {
    getState: figureSnapshot,
    select: selectFigure,
    updateParameters: updateFigureParameters,
    reset: resetFigureParameters,
    readAt: (x) => {
      const figure = activeFigure();
      return figure ? figuresApi.readAt(figure, x) : { ok: false, code: 'not_interactive' };
    }
  };

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
    // 定位输入是下一次跳转的目的地，不改写已识别缓存对应的帧。
    if (usingCurrentFrame && presetResult) { controller.targetTime = presetResult.time; return; }
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
    if (localVideoUrl && !usingLessonCurve) return false;
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
    if (frameRead) return '正在识别第 ' + formatSecond(frameRead.time) + ' 秒的当前帧，可取消。';
    if (frameReadFailure) return frameReadFailure.message;
    if (lesson && lesson.seeking) return lessonWakeStatus();
    if (localVideoUrl && !(atTarget() && videoMatches())) {
      if (canReadCurrentFrame()) return '暂停帧已就绪。点破壁识别这一帧的抛物线。';
      return '请暂停视频，等画面加载完成后再破壁识别。';
    }
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
    const canSeek = hasFrameSize() && !videoBroken && !overlay && !busy &&
      (localVideoUrl || (videoMatches() && !lessonBlocksWake()));
    if (jumpTarget) jumpTarget.disabled = !hasFrameSize() || videoBroken;
    if (jumpTarget && jumpTarget.classList) jumpTarget.classList.toggle('is-next', canSeek && !atTarget());
    if (wakeButton && wakeButton.classList) {
      wakeButton.classList.toggle('is-next', Boolean(canSeek && atTarget() && !wakeButton.disabled));
    }
    const field = $('#target-time-field');
    const readout = $('#target-time-readout');
    if (field) field.hidden = !(curveShown || localVideoUrl);
    if (readout) readout.hidden = Boolean(curveShown || localVideoUrl);
    const jumpTip = jumpTarget && jumpTarget.querySelector ? jumpTarget.querySelector('.lg-tip') : null;
    const authored = authoredTime();
    const dest = seekDestination();
    if (jumpTarget && jumpTarget.setAttribute && Number.isFinite(dest)) {
      jumpTarget.setAttribute('aria-label', '定位到第 ' + formatSecond(dest) + ' 秒');
    }
    if (jumpTip && Number.isFinite(dest)) jumpTip.textContent = '定位到第 ' + formatSecond(dest) + ' 秒';
    if (readout && Number.isFinite(authored)) readout.textContent = '停在第 ' + formatSecond(authored) + ' 秒';
    syncStageBanner();
  }

  /**
   * 记下正在看的那一帧，并刷新画面上的提示。
   * @param {{ phase: 'frame' | 'waiting', index: number, total: number, time: number }} next
   */
  function noteLessonLook(next) {
    lessonLook = next;
    syncStageBanner();
  }

  /**
   * 在画面上分开说明两件事：正在看，以及破壁开了没有。
   * 有片子时把顶栏留在屏幕上，破壁按钮不用等指针移到最顶端。
   */
  function syncStageBanner() {
    if (!stageBanner) return;
    const state = sessionState();
    const waiting = Boolean(state && state.status === 'waiting');
    const failed = Boolean(state && state.status === 'recoverable-error');
    const open = Boolean(overlay);
    let mode = '';
    let title = '';
    let detail = '';
    if (videoBroken) {
      mode = '';
    } else if (mediaPending) {
      mode = 'idle';
      title = '正在读取片子';
      detail = '还没开始看，也还没破壁。';
    } else if (frameRead) {
      mode = 'looking';
      title = '正在识别当前帧';
      detail = '只提交第 ' + formatSecond(frameRead.time) + ' 秒这一帧，最多等待 30 秒。可取消或退出。';
    } else if (frameReadFailure) {
      mode = 'idle';
      title = '当前帧还未识别';
      detail = frameReadFailure.message;
    } else if (waiting) {
      mode = 'waking';
      title = '正在破壁';
      detail = '正在等结果。超过 1.5 秒会改用预先准备的示例。';
    } else if (failed) {
      mode = 'idle';
      title = '破壁没有打开';
      detail = (state && state.message) || '结果不可用，可以重试或退出。';
    } else if (open && figureKind !== 'parabola') {
      // 本地坐标轴和刻度完整可见；状态与来源继续在面板、顶栏展示。
      mode = '';
    } else if (open) {
      mode = 'open';
      title = '破壁已打开';
      detail = usingCurrentFrame
        ? '这是当前暂停帧识别出的抛物线。拖动控制点或滑块，也可以提问。'
        : usingLessonCurve
        ? '这是这次阅读找到的曲线。拖画面上的点，或拖右边的滑块。'
        : '曲线已经盖在画面上。拖画面上的点，或拖右边的滑块。';
    } else if (lesson && lesson.seeking) {
      mode = 'seeking';
      title = '正在停到这一帧';
      detail = '停稳之后才能破壁。';
    } else if (localVideoUrl && canReadCurrentFrame() && (!lessonEndpoint || !String(lessonEndpoint.value || '').trim())) {
      mode = 'need-address';
      title = '填入本机阅读地址';
      detail = '配置本地 reader 后，暂停并点破壁识别当前帧。视频文件保留在浏览器里。';
    } else if (lesson && lesson.phase === 'reading' && !usingLessonCurve) {
      mode = 'looking';
      title = 'AI 正在看这段画面';
      if (lessonLook && lessonLook.phase === 'waiting') {
        detail = '画面已经交出去，正在等结果。破壁还没开始。也可暂停后点破壁，改为只识别当前帧。';
      } else if (lessonLook && lessonLook.phase === 'frame' && Number.isFinite(lessonLook.time)) {
        detail = '正在看第 ' + formatSecond(lessonLook.time) + ' 秒（' + lessonLook.index + '/' + lessonLook.total + '）。破壁还没开始。';
      } else if (lesson.points.length > 0) {
        detail = '已找到 ' + lesson.points.length + ' 处，还在继续看。破壁还没开始。';
      } else {
        detail = '正在抽出画面。破壁还没开始。';
      }
    } else if (wakeButton && !wakeButton.disabled) {
      mode = 'ready';
      title = '可以破壁';
      detail = '点顶栏的破壁，或按 Alt+B。曲线还没出现。';
      if (localVideoUrl && !(atTarget() && videoMatches())) detail = '点破壁或按 Alt+B，只识别当前暂停帧的抛物线。';
      if (lesson && lesson.phase === 'reading') detail += '画面还在继续看。';
    } else if (awaitingEndpoint) {
      mode = 'need-address';
      title = '还没开始看';
      detail = '阅读地址是空的。填上下方的地址，就会开始看这支片子。';
    } else if (hasFrameSize() && !videoMatches()) {
      mode = 'idle';
      title = '这是你选的片子';
      detail = '画面不会换回示例片。预设曲线对不上这支片子。';
    } else if (hasFrameSize()) {
      mode = 'idle';
      title = '还没破壁';
      const authored = authoredTime();
      detail = Number.isFinite(authored)
        ? '先停在第 ' + formatSecond(authored) + ' 秒，再破壁。'
        : '先暂停在目标时间，再破壁。';
    }
    stageBanner.hidden = !mode;
    if (stageBanner.dataset) stageBanner.dataset.mode = mode;
    if (stage && stage.classList) stage.classList.toggle('is-looking', mode === 'looking');
    if (stageBannerTitle) stageBannerTitle.textContent = title;
    if (stageBannerDetail) stageBannerDetail.textContent = detail;
    if (lessonEndpoint && lessonEndpoint.classList) {
      lessonEndpoint.classList.toggle('is-needed', mode === 'need-address');
    }
    const dock = document.querySelector('.lg-dock');
    if (dock && dock.dataset) {
      if (mode) dock.dataset.hold = 'true';
      else delete dock.dataset.hold;
    }
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
    if (usingCurrentFrame) return '当前帧识别';
    if (isPackagedVision(result)) return '识别结果';
    if (isLessonResult(result)) return '这次阅读';
    if (result.fallback === 'timeout') return '预先准备的示例 · 超时回退';
    return result.source === 'preset' ? '预先准备的示例' : '来源不可用';
  }

  function setSource(result, note) {
    if (result && figureKind !== 'parabola' && localFigure) {
      sourceLabel.textContent = '本地数学图形 · ' + localFigure.label;
      sourceNote.textContent = '按当前系数在浏览器中计算；未从视频识别。切回抛物线可继续原来的结果。';
      sourceLabel.classList.remove('is-fallback');
      sourceLabel.classList.remove('is-warn');
      return;
    }
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
    if (result && usingCurrentFrame) {
      sourceNote.textContent = '由本地 reader 读取你主动提交的当前帧；视频、时刻和源尺寸已校验。';
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

  function mathYFromPointer(event, definition) {
    const rect = readContentRect();
    if (!rect || !Number.isFinite(event.clientY)) return null;
    const sourceY = (event.clientY - rect.contentRect.top) / rect.scale;
    const ratio = (sourceY - definition.region.y) / definition.region.height;
    return definition.yAxis === 'up'
      ? definition.range.max - ratio * (definition.range.max - definition.range.min)
      : definition.range.min + ratio * (definition.range.max - definition.range.min);
  }

  function drawFigureCoordinates(figure, rect) {
    const group = overlay.querySelector('g.figure-coordinates');
    if (!group) return;
    group.style.display = figure ? '' : 'none';
    if (!figure) return;
    const d = figure.definition;
    const map = (x, y) => alignment.mathCoordinatesToPage(d, { x, y }, rect.scale);
    const parts = [`<rect x="0" y="0" width="${rect.contentRect.width}" height="${rect.contentRect.height}" fill="#0E1720"/>`];
    const line = (x0, y0, x1, y1, axis) => {
      const a = map(x0, y0), b = map(x1, y1);
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${axis ? '#C8DCE6' : '#4E6474'}" stroke-opacity="${axis ? '.85' : '.35'}" stroke-width="1"/>`);
    };
    for (let index = 0; index <= 4; index += 1) {
      const x = d.domain.min + (d.domain.max - d.domain.min) * index / 4;
      const y = d.range.min + (d.range.max - d.range.min) * index / 4;
      line(x, d.range.min, x, d.range.max, false);
      line(d.domain.min, y, d.domain.max, y, false);
    }
    if (d.range.min <= 0 && d.range.max >= 0) line(d.domain.min, 0, d.domain.max, 0, true);
    if (d.domain.min <= 0 && d.domain.max >= 0) line(0, d.range.min, 0, d.range.max, true);
    const low = map(d.domain.min, d.range.min), high = map(d.domain.max, d.range.max);
    parts.push(`<text x="${low.x}" y="${low.y + 11}" fill="#C8DCE6" font-size="10">${d.domain.min}</text>`);
    parts.push(`<text x="${high.x}" y="${low.y + 11}" text-anchor="end" fill="#C8DCE6" font-size="10">${d.domain.max} x</text>`);
    parts.push(`<text x="${low.x - 3}" y="${high.y + 9}" text-anchor="end" fill="#C8DCE6" font-size="10">${d.range.max}</text>`);
    parts.push(`<text x="${low.x - 3}" y="${low.y}" text-anchor="end" fill="#C8DCE6" font-size="10">${d.range.min}</text>`);
    const origin = map(0, 0);
    parts.push(`<text x="${origin.x + 4}" y="${origin.y + 12}" fill="#C8DCE6" font-size="10">0</text>`);
    parts.push(`<text x="${origin.x + 5}" y="${high.y + 10}" fill="#C8DCE6" font-size="10">y</text>`);
    group.innerHTML = parts.join('');
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
      clearFigure();
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
    const local = figureKind !== 'parabola' ? activeFigure() : null;
    const definition = local ? local.definition : result.definition;
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

    const parameters = local ? local.parameters : state.currentParameters;
    const path = [];
    const polylines = local ? figuresApi.visiblePolylines(local) : alignment.visibleCurvePolylines(definition, parameters, 81);
    figureOutsideWindow = Boolean(local && polylines.length === 0);
    polylines.forEach((line) => {
      line.forEach((point, index) => {
        const mapped = local ? alignment.mathCoordinatesToPage(definition, point, rect.scale) : null;
        const [px, py] = mapped ? [mapped.x, mapped.y] : pagePointForMath(definition, parameters, point.x, rect);
        path.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
      });
    });
    const pathData = path.join(' ');
    overlay.querySelector('path').setAttribute('d', pathData);
    const hitPath = overlay.querySelector('path.curve-hit');
    if (hitPath) hitPath.setAttribute('d', pathData);
    if (local) window.__breakglassAlignment = null;
    else publishAlignment(definition, parameters, rect);
    drawFigureCoordinates(local, rect);
    overlay.setAttribute('aria-label', local ? '可调节的本地' + local.label : '可拖动的抛物线结果');

    const dragParameter = definition.dragParameter;
    const dragValue = parameters[dragParameter];
    const control = local ? figuresApi.controlPoint(local) : null;
    const mappedControl = control ? alignment.mathCoordinatesToPage(definition, control, rect.scale) : null;
    const [cx, cy] = mappedControl ? [mappedControl.x, mappedControl.y]
      : pagePointForMath(definition, parameters, dragParameter === 'h' ? dragValue : definition.domain.min, rect);
    const handle = overlay.querySelector('circle');
    handle.setAttribute('cx', cx.toFixed(2));
    handle.setAttribute('cy', cy.toFixed(2));
    const offscreen = control && (control.x < definition.domain.min || control.x > definition.domain.max || control.y < definition.range.min || control.y > definition.range.max);
    handle.style.display = offscreen ? 'none' : '';
    handle.setAttribute('tabindex', offscreen ? '-1' : '0');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', (local ? local.label : '抛物线') + '控制点，调节 ' + dragParameter);
    handle.setAttribute('aria-valuemin', String(definition.parameters[dragParameter].min));
    handle.setAttribute('aria-valuemax', String(definition.parameters[dragParameter].max));
    handle.setAttribute('aria-valuenow', String(dragValue));
    const hotHandle = overlay.querySelector('circle.curve-hit');
    if (hotHandle) {
      hotHandle.setAttribute('cx', cx.toFixed(2));
      hotHandle.setAttribute('cy', cy.toFixed(2));
      hotHandle.style.display = offscreen ? 'none' : '';
    }

    sliderRows.forEach((row) => {
      if (local) return;
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
      // 提问区的回答用同一个格式化，滑块上的数与回答里的数逐字相同。
      const displayValue = tutorNumbers.formatParameter(value, item);
      row.output.textContent = displayValue;
      if (item && row.input.setAttribute) {
        row.input.setAttribute('aria-valuetext', displayValue + '（范围 ' + item.min + ' 到 ' + item.max + '）');
      }
    });
    syncFigureControls();
    syncStageBanner();
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
    clearFigure();
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
    overlay.innerHTML = '<g class="figure-coordinates" aria-hidden="true"></g><path fill="none" stroke="#71ddff" stroke-width="3" stroke-linecap="round"></path>'
      + '<path class="curve-hit" fill="none" stroke="transparent" stroke-width="24" stroke-linecap="round"></path>'
      + '<circle r="10" fill="#08111f" stroke="#ffffff" stroke-width="3" tabindex="0"></circle>'
      + '<circle class="curve-hit" r="18" fill="transparent" stroke="none" aria-hidden="true"></circle>';
    stage.appendChild(overlay);

    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) return;
      const state = sessionState();
      if (!state || !state.result) return;
      const figure = activeFigure();
      const definition = figure ? figure.definition : state.result.definition;
      const vertical = figureKind === 'line';
      const mathX = vertical ? mathYFromPointer(event, definition) : mathXFromPointer(event, definition);
      const name = definition.dragParameter;
      const parameters = figure ? figure.parameters : state.currentParameters;
      if (mathX === null || !Number.isFinite(parameters[name])) return;
      dragging = true;
      dragOrigin = { name, value: parameters[name], mathX, vertical };
      if (overlay.setPointerCapture) overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!dragging || !dragOrigin) return;
      const state = sessionState();
      if (!state || !state.result) return;
      const figure = activeFigure();
      const definition = figure ? figure.definition : state.result.definition;
      const mathX = dragOrigin.vertical ? mathYFromPointer(event, definition) : mathXFromPointer(event, definition);
      if (mathX === null) return;
      const value = dragOrigin.value + (mathX - dragOrigin.mathX);
      if (figuresApi) updateFigureParameters({ [dragOrigin.name]: value });
      else { controller.updateParameter(dragOrigin.name, value); drawCurve(); }
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
    overlay.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const figure = activeFigure();
      if (!figure || event.target !== overlay.querySelector('circle')) return;
      event.preventDefault();
      const name = figure.definition.dragParameter;
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
      updateFigureParameters({ [name]: figure.parameters[name] + direction * figure.definition.parameters[name].step });
    });
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
  function recordPresentation(timedOut, decidedAt, startedAt, lessonStartedAt, frameStartedAt) {
    cancelPresentation();
    if (!latencies || !overlay) return;
    const mounted = overlay;
    const domAt = localClock.now();
    if (timedOut) latencies.record('fallback-dom-ready', domAt - decidedAt, 'hot');
    if (frameStartedAt !== null) latencies.record('current-frame-cache-dom-ready', domAt - frameStartedAt, 'hot');
    else if (lessonStartedAt !== null) latencies.record('lesson-wake-dom-ready', domAt - lessonStartedAt, 'hot');
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
        if (frameStartedAt !== null) latencies.record('current-frame-cache-frame-ready', now - frameStartedAt, 'hot');
        else if (lessonStartedAt !== null) latencies.record('lesson-wake-frame-ready', now - lessonStartedAt, 'hot');
        else if (startedAt !== null) latencies.record('preset-wake-frame-ready', now - startedAt, 'hot');
        stage.dataset.presentationMetrics = JSON.stringify({ endpoint: 'two-animation-frames', pixelPresentationVerified: false, summary: latencies.summary() });
      });
    });
  }

  function syncControls() {
    if (frameRead && !frameReadStillCurrent(frameRead)) invalidateFrameRead();
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
    const ready = cachedCurveReady();
    wakeButton.disabled = waiting || Boolean(frameRead) || Boolean(overlay) ||
      !(ready || (canReadCurrentFrame() && !(lesson && lesson.seeking)));
    const playLabel = video.paused ? '播放' : '暂停';
    playToggle.setAttribute('aria-label', playLabel + '视频');
    if (playTip) playTip.textContent = playLabel;
    timeLabel.textContent = `当前时间：${Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : '—'}`;
    const state = sessionState();
    const idle = !state || state.status === 'paused-ready';
    if (!videoBroken && idle && !overlay && (materialMessage() || !atTarget())) {
      setStatus(idleStatus());
    }
    syncFrameReadControls();
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
        if (frameRead) reason = '正在识别当前帧，可以先取消或退出。';
        else if (state && state.status === 'waiting') reason = '正在等待外部结果，可以先取消或退出。';
        else if (overlay) reason = '交互层已经出现，不需要再次破壁。';
        else if (lesson && lesson.seeking) reason = lessonWakeStatus();
        else if (!video.paused) reason = '请先暂停视频。';
        else if (localVideoUrl && !canReadCurrentFrame()) reason = '当前画面尚未解码、正在定位或时间无效，请等暂停帧就绪。';
        else if (lessonBlocksWake()) reason = lessonWakeStatus();
        else if (!hasFrameSize()) reason = pickStatus();
        else if (materialMessage()) reason = materialMessage();
        else if (!atTarget()) reason = seekStatus();
        else if (!presetResult) reason = '当前没有可用的准备结果。';
        else reason = '当前还不能破壁。';
      }
      wakeReason.textContent = reason;
      if (wakeTip) wakeTip.textContent = reason || '破壁 Alt+B';
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
    clearFigure();
    syncFigureControls();
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
    currentFrameWakeStartedAt = null;
    wakeStartedAt = null;
    wakeButton.disabled = Boolean(frameRead) || !(cachedCurveReady() ||
      (canReadCurrentFrame() && !(lesson && lesson.seeking)));
    syncFrameReadControls();
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
      recordPresentation(timedOut, decidedAt, wakeStartedAt, lessonWakeStartedAt, currentFrameWakeStartedAt);
      currentFrameWakeStartedAt = null;
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
        : '拖画面上的点，或拖右边的滑块，也可以在下面提问。按 Esc 退出。');
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
    if (frameRead || overlay) return;
    if (localVideoUrl && !cachedCurveReady()) {
      readCurrentFrame();
      return;
    }
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
    if (usingCurrentFrame) {
      currentFrameWakeStartedAt = localClock.now();
      const started = wakeHandle.startCached({ paused: true, currentTime: video.currentTime, frameSize });
      if (!started.ok) {
        currentFrameWakeStartedAt = null;
        setStatus(started.message || '缓存结果不可用，请重新识别。', 'error');
      }
      return;
    }
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
    if (frameRead) {
      invalidateFrameRead();
      syncControls();
      setStatus('已取消当前帧识别，迟到结果不会打开交互层。');
      return;
    }
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
  function mountWake(result, fromLesson, fromCurrentFrame = false) {
    if (wakeHandle) wakeHandle.dispose();
    presetResult = result;
    usingLessonCurve = Boolean(fromLesson);
    usingCurrentFrame = Boolean(fromCurrentFrame);
    if (!usingCurrentFrame) currentFrameSource = '';
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
      cachedReading: usingCurrentFrame,
      clock: localClock,
      onChange: (state) => applyState(state)
    });
    wakeMounts += 1;
    window.__breakglassWakeMounts = wakeMounts;
  }

  function canReadCurrentFrame() {
    return Boolean(localVideoUrl && config && currentFrameApi && !bootFailure && !videoBroken && !mediaPending &&
      video.paused && !video.seeking && video.readyState >= 2 &&
      Number.isSafeInteger(video.videoWidth) && video.videoWidth > 0 &&
      Number.isSafeInteger(video.videoHeight) && video.videoHeight > 0 &&
      Number.isFinite(video.duration) && video.duration > 0 && Number.isFinite(video.currentTime) &&
      video.currentTime >= 0 && video.currentTime <= video.duration);
  }

  function cachedCurveReady() {
    if (!atTarget() || !presetResult || !videoMatches() || lessonBlocksWake()) return false;
    if (!usingCurrentFrame) return true;
    return canReadCurrentFrame() && currentFrameSource === video.src &&
      presetResult.time === video.currentTime && presetResult.frameSize.width === video.videoWidth &&
      presetResult.frameSize.height === video.videoHeight;
  }

  function frameReadStillCurrent(owner) {
    return frameRead === owner && owner.epoch === frameMediaEpoch && owner.videoId === localVideoIdentity &&
      owner.src === video.src && canReadCurrentFrame() && owner.time === video.currentTime &&
      owner.duration === video.duration && owner.frameSize.width === video.videoWidth &&
      owner.frameSize.height === video.videoHeight;
  }

  function invalidateFrameRead() {
    frameMediaEpoch += 1;
    const owner = frameRead;
    frameRead = null;
    frameReadFailure = null;
    if (owner && owner.handle) owner.handle.cancel();
    if (owner) hideWaitingControls();
  }

  function syncFrameReadControls() {
    if (stage && stage.setAttribute) stage.setAttribute('aria-busy', String(Boolean(frameRead)));
    if (overlay) return;
    if (frameRead) {
      cancelButton.hidden = false;
      cancelButton.disabled = false;
      retryButton.hidden = true;
      retryButton.disabled = true;
      exitButton.disabled = false;
      resetButton.disabled = true;
      setSlidersEnabled(false);
      setWaitingBar(false);
      setSource(null, '本地 reader 正在处理你提交的这一帧，最多等待 30 秒。');
      setStatus(idleStatus());
    } else if (frameReadFailure) {
      hideWaitingControls();
      retryButton.hidden = false;
      retryButton.disabled = !canReadCurrentFrame();
      exitButton.disabled = false;
      setPrimaryAction('retry');
      setSource(null, frameReadFailure.message);
      setStatus(frameReadFailure.message, 'error');
    } else if (sessionState() && sessionState().status === 'paused-ready') {
      hideWaitingControls();
      exitButton.disabled = true;
      setPrimaryAction('wake');
    }
  }

  function failFrameRead(failure) {
    frameReadFailure = failure;
    syncControls();
    if (retryButton.focus) retryButton.focus();
  }

  function readCurrentFrame() {
    if (!canReadCurrentFrame() || (lesson && lesson.seeking)) {
      setStatus(wakeBlockedStatus());
      return;
    }
    let url;
    try { url = currentFrameApi.buildUrl(lessonEndpoint ? lessonEndpoint.value : ''); }
    catch {
      failFrameRead({ message: '请填入本机 reader 阅读地址（根地址或 /read），再点破壁识别当前帧。' });
      if (lessonEndpoint && lessonEndpoint.focus) lessonEndpoint.focus();
      return;
    }
    if (endpointWait != null) {
      window.clearTimeout(endpointWait);
      endpointWait = null;
    }
    // 主动读取当前帧后，旧预读不能再自动定位到它找到的第一处。
    stopLessonWork();
    if (lesson) {
      lesson.phase = 'ready';
      lesson.cancelled = true;
      renderLesson('改为按需识别当前帧；已存的阅读点仍保留。');
    }
    const owner = {
      src: video.src, videoId: localVideoIdentity, epoch: frameMediaEpoch,
      readingId: 'current-read-' + (++frameReadSerial), time: video.currentTime,
      duration: video.duration, frameSize: { width: video.videoWidth, height: video.videoHeight }, handle: null
    };
    let body;
    try {
      body = currentFrameApi.requestBody({
        readingId: owner.readingId, videoId: owner.videoId, duration: owner.duration,
        frameSize: owner.frameSize, courseText: lessonNote ? lessonNote.value : '',
        frames: [{ time: owner.time, image: snapshotFrame(video, document.createElement('canvas')) }]
      });
    } catch (error) {
      failFrameRead({ message: error.message || '当前帧无法读取，请等画面加载完成后重试。' });
      return;
    }
    frameReadFailure = null;
    frameRead = owner;
    awaitingEndpoint = false;
    syncControls();
    owner.handle = currentFrameApi.startRead({
      url, body, clock: localClock, fetchImpl: (address, init) => fetch(address, init),
      onSuccess(point) {
        if (!frameReadStillCurrent(owner)) return;
        frameRead = null;
        mountWake(point.curve, true, true);
        currentFrameSource = owner.src;
        if (video.setAttribute) video.setAttribute('data-video-id', point.curve.videoId);
        renderLesson();
        if (lessonStatus) lessonStatus.textContent = '第 ' + formatSecond(point.time) + ' 秒：' + point.lessonLine;
        wake();
      },
      onFailure(failure) {
        if (!frameReadStillCurrent(owner)) return;
        frameRead = null;
        failFrameRead(failure);
      }
    });
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
    const later = lesson.shown ? lessonApi.nextPoint(lesson.points, lessonNavigationTime()) : null;
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
    lessonLook = null;
    lessonFallbackReason = '';
    awaitingEndpoint = false;
    if (lessonStatus) lessonStatus.textContent = '';
    if (usingCurrentFrame && !packagedPreset) {
      usingCurrentFrame = false;
      usingLessonCurve = false;
      currentFrameSource = '';
      presetResult = null;
      controller = null;
      if (wakeHandle) wakeHandle.dispose();
      wakeHandle = null;
    }
    if (usingLessonCurve && packagedPreset) {
      if (overlay) removeOverlay({ pauseVideo: false });
      mountWake(packagedPreset, false);
    }
    renderLesson();
  }

  /**
   * 读用户这次浏览里填过的阅读地址。地址不写进页面；没有存储时返回空串。
   * @returns {string}
   */
  function readStoredEndpoint() {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage || typeof sessionStorage.getItem !== 'function') return '';
      return String(sessionStorage.getItem('breakglass.lessonEndpoint') || '').trim();
    } catch {
      return '';
    }
  }

  /**
   * 记住这一栏里的地址，刷新后还能接着看。空字符串会清掉上次的记录。
   */
  function rememberEndpoint() {
    if (!lessonEndpoint) return;
    const url = String(lessonEndpoint.value || '').trim();
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return;
      if (url) sessionStorage.setItem('breakglass.lessonEndpoint', url);
      else sessionStorage.removeItem('breakglass.lessonEndpoint');
    } catch {
      // 无痕窗口写不进去时，这一页仍使用输入框里的值。
    }
  }

  /**
   * 输入框还是空的时候，用这次浏览里填过的地址补上。
   */
  function restoreEndpoint() {
    if (!lessonEndpoint || String(lessonEndpoint.value || '').trim()) return;
    const saved = readStoredEndpoint();
    if (saved) lessonEndpoint.value = saved;
  }

  /**
   * 片子有时长、且不是 9 秒片时开始阅读。空白地址不发请求，并在画面上说明。
   * 同一支片子、同一个地址已经在看时，不重新开始。
   */
  function maybeStartLesson() {
    if (!lessonApi || !localClock || !packagedPreset || !video) return;
    const src = String(video.src || '');
    if (!src || isPreparedSource(src)) return;
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const url = lessonEndpoint ? String(lessonEndpoint.value || '').trim() : '';
    if (lesson && lesson.src === src && lesson.endpoint === url) return;
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
      endpoint: url,
      startedAt: localClock.now(),
      timer: null,
      pendingJump: null,
      jumps: []
    };
    if (video.removeAttribute) video.removeAttribute('data-video-id');
    renderLesson();
    setStatus(idleStatus());
    syncControls();
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
      noteLessonLook({ phase: 'waiting', index: frames.length, total: frames.length, time: Number.NaN });
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
    noteLessonLook({ phase: 'frame', index: 1, total: times.length, time: times[0] });
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
        noteLessonLook({ phase: 'frame', index: index + 1, total: times.length, time: times[index] });
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
    if (video.setAttribute) video.setAttribute('data-video-id', point.curve.videoId);
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
    const later = lessonApi.nextPoint(lesson.points, lessonNavigationTime());
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

  function lessonNavigationTime() {
    return usingCurrentFrame && presetResult ? presetResult.time : lesson.shown.time;
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
   * 请求失败。已有存点就只结束阅读；一处都没有时保留用户视频并给出说明。
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
   * 阅读没有可用的点。用户选中的片子留在画面上，不换回 9 秒片。
   * 只有画面本来就空着时，才挂上包内示例。
   * @param {string} code empty / timeout / unavailable
   */
  function fallbackToPrepared(code) {
    const reason = code === 'timeout' ? '这次没读完。' : '外部阅读没有返回可用结果。';
    const kept = code === 'empty'
      ? '还没开始看。填上阅读地址后，这支片子会被看。'
      : reason + '这支片子留在画面上。';
    stopLessonWork();
    lesson = null;
    lessonLook = null;
    if (overlay) removeOverlay({ pauseVideo: false });
    const chosen = Boolean(localVideoUrl) || (video && String(video.src || '') && !isPreparedSource(video.src));
    if (chosen) {
      awaitingEndpoint = code === 'empty';
      if (usingLessonCurve && packagedPreset) mountWake(packagedPreset, false);
      renderLesson();
      lessonFallbackReason = '';
      if (lessonStatus) lessonStatus.textContent = kept;
      setSource(null);
      setStatus(kept);
      syncControls();
      return;
    }
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
    try {
      const loaded = await preset.loadPreset();
      const currentFrameOnly = !loaded.ok && loaded.code === 'preset_disabled' &&
        loaded.config && loaded.config.enableLocalMock === false;
      if (!loaded.ok && !currentFrameOnly) throw new Error(loaded.message);
      config = loaded.config;
      packagedPreset = loaded.result || null;
      localClock = createClock();
      latencies = latencyApi.createLatencyLog({ clock: localClock });
      if (packagedPreset) mountWake(packagedPreset, false);
      window.__breakglassLatency = {
        summary: () => latencies.summary(),
        snapshot: () => latencies.snapshot(),
        measurement: () => ({ dom: 'SVG path ready in JavaScript', frame: 'second requestAnimationFrame; one rendering opportunity', pixelPresentationVerified: false })
      };
      watchDevicePixelRatio();
      watchVideoSize();
      runtimeNote.textContent = currentFrameOnly
        ? '本地预制已关闭；自有视频仍可请求本机 reader 识别当前帧。'
        : `配置：${config.externalAttempt} · 本地预制已预热 · 回退 ${config.fallbackAfterMs}ms`;
      setSource(null);
      if (!localVideoUrl && !String(video.src || '')) setStatus(pickStatus());
      restoreEndpoint();
      maybeStartLesson();
    } catch (error) {
      bootFailure = error.message || '配置加载失败。';
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
  video.addEventListener('seeking', () => {
    invalidateFrameRead();
    if (overlay) removeOverlay({ pauseVideo: false });
    syncControls();
  });
  video.addEventListener('loadeddata', syncControls);
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
    syncControls();
  });
  video.addEventListener('timeupdate', syncControls);
  video.addEventListener('play', () => { invalidateFrameRead(); syncControls(); });
  video.addEventListener('pause', syncControls);
  video.addEventListener('ended', syncControls);
  video.addEventListener('error', () => {
    if (bootFailure) return;
    invalidateFrameRead();
    if (lessonFallbackReason && isPreparedSource(video.src) && lessonStatus) {
      lessonStatus.textContent = lessonFallbackReason + '预先准备的片子没有加载出来。';
    }
    mediaPending = false;
    videoBroken = true;
    assetEmpty.hidden = false;
    removeOverlay();
    setStatus('视频无法加载，未挂载交互层。', 'error');
    syncStageBanner();
  });
  const localVideoInput = $('#local-video');
  if (localVideoInput) {
    localVideoInput.addEventListener('change', () => {
      const file = localVideoInput.files && localVideoInput.files[0];
      if (file) useLocalVideo(file);
    });
  }
  const pickVideoButton = $('#pick-video');
  if (pickVideoButton && localVideoInput) {
    pickVideoButton.addEventListener('click', () => { localVideoInput.click(); });
  }
  if (lessonEndpoint) {
    lessonEndpoint.addEventListener('input', () => {
      invalidateFrameRead();
      syncControls();
      rememberEndpoint();
      if (endpointWait != null) window.clearTimeout(endpointWait);
      endpointWait = window.setTimeout(() => {
        endpointWait = null;
        maybeStartLesson();
      }, 300);
    });
    lessonEndpoint.addEventListener('change', () => {
      invalidateFrameRead();
      syncControls();
      rememberEndpoint();
      if (endpointWait != null) {
        window.clearTimeout(endpointWait);
        endpointWait = null;
      }
      maybeStartLesson();
    });
  }
  const presetVideoButton = $('#preset-video');
  if (presetVideoButton) presetVideoButton.addEventListener('click', () => { choosePackagedVideo(); });
  const presetAgain = document.querySelector('[data-choose-preset]');
  if (presetAgain) presetAgain.addEventListener('click', () => { choosePackagedVideo(); });
  window.addEventListener('resize', drawCurve);
  document.addEventListener('fullscreenchange', drawCurve);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelPresentation();
  });
  window.addEventListener('orientationchange', drawCurve);
  window.addEventListener('pagehide', () => {
    invalidateFrameRead();
    if (endpointWait != null) {
      window.clearTimeout(endpointWait);
      endpointWait = null;
    }
    stopLessonWork();
    // 隐藏采样的 Promise 可能稍后才落定；结束本轮，不能在页面离开后再发阅读请求。
    if (lesson) {
      lesson.phase = 'ready';
      lesson.cancelled = true;
    }
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
    // 在提问框里按 Esc 只清空草稿，不拆掉正在提问的曲线。
    if (event.key === 'Escape' && tutorInput && event.target === tutorInput) {
      tutorInput.value = '';
      return;
    }
    const target = event.target;
    const editing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat &&
        !editing && String(event.key).toLowerCase() === 'b') {
      event.preventDefault();
      wake();
    }
    if (event.key === 'Escape') {
      if (document.fullscreenElement) return;
      if (frameRead) { cancelWaiting(); return; }
      if (frameReadFailure) { invalidateFrameRead(); syncControls(); return; }
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
    if (video.paused) {
      invalidateFrameRead();
      if (overlay) removeOverlay({ pauseVideo: false });
      syncControls();
      video.play().catch(() => setStatus('视频当前无法播放。'));
    }
    else video.pause();
  });
  jumpTarget.addEventListener('click', () => {
    if (!video.videoWidth) {
      setStatus(pickStatus());
      return;
    }
    const next = targetTime();
    if (!Number.isFinite(next) || next < 0 || (Number.isFinite(video.duration) && next > video.duration)) {
      setStatus('请输入有效的目标时间。');
      return;
    }
    invalidateFrameRead();
    if (overlay) removeOverlay({ pauseVideo: false });
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
    if (figuresApi) {
      const outcome = resetFigureParameters();
      if (outcome.ok && outcome.figure && tutorLog && tutorLog.children.length) {
        appendTutorEntry('note', '已恢复' + outcome.figure.label + '的初始系数。');
      }
      return;
    }
    dragging = false;
    dragOrigin = null;
    if (controller) controller.reset();
    if (drawCurve()) setStatus('已恢复本次结果的初始参数。');
  });
  exitButton.addEventListener('click', () => {
    invalidateFrameRead();
    removeOverlay();
    syncControls();
  });
  if (tutorForm) {
    tutorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitTutor();
    });
  }
  // 示例只填进输入框，不替用户送出；用户可以先改数再问。
  if (tutorExamples) {
    tutorExamples.addEventListener('click', (event) => {
      const target = event.target;
      const button = target && typeof target.closest === 'function' ? target.closest('[data-tutor-example]') : target;
      const text = button && button.dataset ? button.dataset.tutorExample : '';
      if (!text || !tutorInput || tutorInput.disabled) return;
      tutorInput.value = text;
      if (typeof tutorInput.focus === 'function') tutorInput.focus();
    });
  }
  // 滑块按参数逐个调节（会话层 setParameter）；控制点拖动仍走 updateParameter。
  sliderRows.forEach((row) => {
    if (!row.input) return;
    row.input.addEventListener('input', () => {
      if (!controller || figureKind !== 'parabola') return;
      if (figuresApi) { updateFigureParameters({ [row.name]: Number(row.input.value) }); return; }
      controller.setParameter(row.name, Number(row.input.value));
      drawCurve();
    });
  });
  if (figureSelect) figureSelect.addEventListener('change', () => {
    const selected = selectFigure(figureSelect.value);
    if (!selected.ok) syncFigureControls();
  });
  figureRows.forEach((row) => {
    if (!row.input) return;
    row.input.addEventListener('input', () => {
      if (figureKind === 'parabola' || !row.name) return;
      updateFigureParameters({ [row.name]: Number(row.input.value) });
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
