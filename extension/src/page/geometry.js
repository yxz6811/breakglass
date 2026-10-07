(function (root) {
  'use strict';
  const clips = Object.freeze([
    Object.freeze({ id: '3-4-5', title: '基础勾股 · 3–4–5', AB: 3, AC: 4, BC: 5, unit: 'cm', path: '../assets/video/geometry/triangle-3-4-5.mp4', target: 4 }),
    Object.freeze({ id: '5-12-13', title: '长直角边 · 5–12–13', AB: 5, AC: 12, BC: 13, unit: 'cm', path: '../assets/video/geometry/triangle-5-12-13.mp4', target: 4 }),
    Object.freeze({ id: '8-15-17', title: '迁移练习 · 8–15–17', AB: 8, AC: 15, BC: 17, unit: 'cm', path: '../assets/video/geometry/triangle-8-15-17.mp4', target: 4 })
  ]);
  function createGeometryPage(options = {}) {
    const document = options.document || root.document;
    const window = options.window || root;
    const BG = options.BreakGlass || root.BreakGlass;
    const session = BG.geometrySession.createGeometrySession();
    const node = (id) => document.getElementById(id);
    const video = options.video || node('geometry-video');
    const fixedReaderEndpoint = options.video && typeof options.fixedReaderEndpoint === 'string' ? options.fixedReaderEndpoint : '';
    let active = true; let borrowedMedia = null;
    const isActive = () => !disposed && active && (!options.isActive || options.isActive());
    const canSend = () => isActive() && (!options.canRead || options.canRead());
    const listeners = [];
    let sequence = 0;
    let videoId = null;
    let videoUrl = null;
    let selectedClip = null;
    let pendingClipSeek = null;
    let mediaFailed = false;
    let captured = null;
    let binding = null;
    let readRequest = null;
    let askRequest = null;
    let readToken = 0;
    let askToken = 0;
    let returning = false;
    let disposed = false;
    let suspended = false;
    let readPending = false;
    let askPending = false;
    let playPending = false;
    let fullscreenPending = false;
    let readFailure = null;
    let askFailure = null;
    let activeQuestion = null;
    let mediaEpoch = 0;
    let playToken = 0;
    let fullscreenToken = 0;
    let pendingReturn = null;
    const addressKey = 'breakglass.geometryReader';
    const logLimit = 40;
    const format = BG.geometryView.formatNumber;
    const view = BG.geometryView.createTriangleView({ svg: node('triangle-board'), document, onSetLength: modifyLength });
    function id(prefix) { return `${prefix}-${Date.now()}-${++sequence}`; }
    function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); }
    function status(message, error = false) {
      if (disposed) return;
      const target = node('page-status');
      target.textContent = message;
      target.classList.toggle('is-error', error);
      target.setAttribute('aria-live', error ? 'assertive' : 'polite');
      syncGuide();
    }
    function feedback(message, error = false) {
      if (disposed) return;
      node('ask-feedback').textContent = message;
      node('ask-feedback').classList.toggle('is-error', error);
      node('ask-feedback').setAttribute('aria-live', error ? 'assertive' : 'polite');
    }
    function appendLog(role, message) {
      if (disposed) return;
      const log = node('ask-log');
      const entry = document.createElement('p');
      entry.className = `ask-entry ask-entry--${role}`;
      entry.textContent = `${role === 'user' ? '你' : role === 'answer' ? '答' : '提示'}：${message}`;
      log.appendChild(entry);
      // Remove complete earlier turns rather than leave a reply without its question.
      while (log.children.length > logLimit) {
        log.removeChild(log.firstChild);
        while (log.firstChild && log.firstChild.className !== 'ask-entry ask-entry--user') log.removeChild(log.firstChild);
      }
      log.hidden = false;
      log.scrollTop = log.scrollHeight;
      node('ask-log-clear').disabled = false;
    }
    function clearLog() {
      const log = node('ask-log');
      while (log.firstChild) log.removeChild(log.firstChild);
      log.hidden = true;
      node('ask-log-clear').disabled = true;
    }
    function finishQuestion(message, error = false) {
      feedback(message, error);
      if (activeQuestion) appendLog('answer', `修订 ${session.getState().scene?.sceneRevision ?? '—'} · ${message}`);
      activeQuestion = null;
    }
    function clearSceneFeedback() {
      feedback('');
      node('explanation').textContent = '';
      node('original-summary').textContent = '';
      clearLog();
      askFailure = null;
      node('ask-retry').hidden = true;
    }
    function clearFramePreview() {
      node('frame-preview').hidden = true;
      node('frame-preview').removeAttribute('src');
      node('frame-placeholder').hidden = false;
      node('frame-surface').style.minHeight = '';
      node('frame-note').textContent = '截图只用于核对，不用像素长度计算答案。';
    }
    function cancelRead(message) {
      ++readToken; readRequest?.cancel(); readRequest = null;
      readPending = false;
      node('read-busy').hidden = true;
      node('geometry-stage').setAttribute('aria-busy', 'false');
      node('read-cancel').hidden = true;
      updateVideoButtons();
      if (message) status(message);
    }
    function cancelAsk(message) {
      ++askToken; askRequest?.cancel(); askRequest = null;
      if (activeQuestion) {
        if (askPending) { askFailure = { ...activeQuestion }; node('ask-retry').hidden = false; }
        finishQuestion(message || '先前的提问已取消，未执行迟到动作。');
      }
      askPending = false;
      node('ask-cancel').hidden = true;
      node('ask-submit').disabled = session.getState().phase !== 'confirmed';
      node('ask-form').setAttribute('aria-busy', 'false');
      updateVideoButtons();
      if (message) feedback(message);
    }
    function discardRetries() {
      readFailure = null; askFailure = null;
      node('read-retry').hidden = true;
      node('geometry-retry').hidden = true;
      node('ask-retry').hidden = true;
    }
    function rememberAddress(restore = false) {
      const field = node('reader-url');
      if (fixedReaderEndpoint) {
        field.value = fixedReaderEndpoint;
        field.readOnly = true;
        field.setAttribute('readonly', '');
        node('reader-memory-note').textContent = '当前工作台固定使用同源 reader 转发；不读取或记忆旧地址。';
        node('reader-forget').hidden = true;
        return;
      }
      let restored = false;
      try {
        const storage = window.sessionStorage;
        if (restore && !field.value.trim()) { field.value = String(storage?.getItem(addressKey) || '').trim(); restored = Boolean(field.value); }
        const raw = field.value.trim();
        if (!raw) { storage?.removeItem(addressKey); node('reader-memory-note').textContent = '地址仅在本次浏览会话中记忆；清空后不再记忆。'; return; }
        // Persist only a validated local origin, never credentials, query values or fragments.
        const checked = new URL(BG.geometryRequest.buildUrl(raw, 'read'));
        const saved = checked.origin;
        if (restore) field.value = saved;
        storage?.setItem(addressKey, saved);
        node('reader-memory-note').textContent = storage ? '已记住本次浏览会话的本地 reader 地址；不会自动发送帧。' : '此页面可用，当前环境不提供地址记忆。';
      } catch {
        if (restored) field.value = '';
        try { window.sessionStorage?.removeItem(addressKey); } catch { /* Storage can be unavailable in private contexts. */ }
        node('reader-memory-note').textContent = '地址尚未记忆。仅记忆有效本机地址；存储不可用时仍可手工填写。';
      }
    }
    function syncRanges(state) {
      const confirmed = state.phase === 'confirmed';
      for (const side of ['AB', 'AC']) {
        const name = side.toLowerCase();
        const range = node(`experiment-${name}-range`);
        range.disabled = !confirmed;
        if (!confirmed) { node(`experiment-${name}-range-value`).textContent = '—'; continue; }
        const value = state.scene.lengths[side], original = state.original.lengths[side];
        range.min = String(Math.max(Number.MIN_VALUE, Math.min(value, original) / 4));
        range.max = String(Math.min(Number.MAX_VALUE, Math.max(value, original) * 2));
        range.step = 'any';
        range.value = String(value);
        range.setAttribute('aria-valuetext', `${side} ${format(value)} ${unitText(state.scene.unit)}`);
        node(`experiment-${name}-range-value`).textContent = `${format(value)} ${unitText(state.scene.unit)}`;
      }
    }
    function syncGuide() {
      if (disposed) return;
      const state = session.getState();
      const busy = readPending || askPending;
      node('geometry-toolbar').setAttribute('data-hold', String(busy));
      node('geometry-source').textContent = sourceText(state.scene, state.phase === 'confirmed');
      node('geometry-banner').hidden = !isActive();
      node('geometry-banner').setAttribute('data-mode', busy ? 'waiting' : node('page-status').classList.contains('is-error') ? 'error' : state.phase === 'confirmed' ? 'ready' : 'idle');
      node('geometry-banner-title').textContent = readPending ? '正在识别这一帧' : askPending ? '正在等待动作提议' : state.phase === 'confirmed' ? '条件已确认，可以实验' : state.phase === 'review' ? '先校对，再开始' : videoId ? '暂停在清晰题面上' : '选择视频，或从预设开始';
      node('geometry-banner-detail').textContent = readPending ? '可取消；识别结果须经人工确认。' : askPending ? '答案由程序计算；可取消本次提问。' : node('page-status').textContent;
      node('geometry-cancel').hidden = !busy;
      node('geometry-cancel').disabled = !busy;
      node('geometry-restore').disabled = state.phase !== 'confirmed';
      node('geometry-exit').disabled = state.phase === 'empty' && !captured && !busy;
      node('geometry-reset-reason').textContent = state.phase === 'confirmed' ? '' : '请先校对并确认条件，才能恢复原题。';
      for (const name of ['change', 'query', 'explain', 'restore']) node(`ask-example-${name}`).disabled = state.phase !== 'confirmed' || busy;
      node('ask-log-clear').disabled = !node('ask-log').children.length;
      node('reader-forget').disabled = Boolean(fixedReaderEndpoint) || !node('reader-url').value.trim();
    }
    function resetQuiz() {
      node('quiz-answer').value = '';
      node('quiz-answer').disabled = false;
      node('quiz-check').disabled = false;
      node('quiz-retry').hidden = true;
      node('quiz-feedback').textContent = '尚未验证本次理解。';
    }
    function sourceText(scene, confirmed) {
      if (!scene) return '尚无题目';
      const origin = { preset: '预设演示', manual: '手工条件', vision: '真实识别候选' }[scene.originSource];
      return `${origin}${confirmed ? scene.editedByUser ? ' · 已校对 / 已修改' : ' · 已确认' : ' · 待校对'}`;
    }
    function summary(scene, result) {
      return `∠A = 90° · AB = ${format(scene.lengths.AB)} · AC = ${format(scene.lengths.AC)} · BC = ${format(result.BC)} ${unitText(scene.unit)}`;
    }
    function unitText(unit) { return { unit: '单位长度', cm: 'cm', m: 'm' }[unit] || unit; }
    function errorText(error) { return String(error.message || error.code || '请求失败').replace(/[。.!！？]+$/u, ''); }
    function render() {
      if (disposed) return;
      const state = session.getState();
      const confirmed = state.phase === 'confirmed';
      node('review-panel').hidden = state.phase !== 'review';
      node('original-panel').hidden = !confirmed;
      node('experiment-panel').hidden = !confirmed;
      node('learning-workspace').hidden = !confirmed;
      node('model-placeholder').hidden = confirmed;
      const labelMap = node('label-map');
      labelMap.hidden = !confirmed || !Object.values(state.scene.labels).some((label) => Array.from(label).length > 8);
      while (labelMap.firstChild) labelMap.removeChild(labelMap.firstChild);
      node('exit-scene').disabled = state.phase === 'empty' && !captured;
      node('return-video').disabled = !binding || binding.videoId !== videoId;
      node('source-label').textContent = sourceText(state.scene, confirmed);
      node('revision-label').textContent = confirmed ? `修订 ${state.scene.sceneRevision}` : '待确认';
      node('ask-submit').disabled = !confirmed || Boolean(askRequest);
      syncRanges(state);
      syncGuide();
      updateVideoButtons();
      if (!confirmed) { view.clear(); if (isActive()) options.onScene?.(null); return; }
      if (isActive()) options.onScene?.({ template: 'right-triangle', snapshot: { AB: state.scene.lengths.AB, AC: state.scene.lengths.AC, unit: state.scene.unit }, origin: 'exploration', confirmed: true, sourceId: borrowedMedia?.source?.id || null, sourceVersion: borrowedMedia?.source?.version || null });
      if (!labelMap.hidden) for (const key of ['A', 'B', 'C']) {
        const term = document.createElement('dt'); term.textContent = key;
        const description = document.createElement('dd'); description.textContent = state.scene.labels[key];
        labelMap.appendChild(term); labelMap.appendChild(description);
      }
      view.render(state.scene, state.result);
      node('bc-value').textContent = format(state.result.BC);
      node('result-unit').textContent = unitText(state.scene.unit);
      node('constraint-note').textContent = '∠A 始终为 90° · 每次只改变一条直角边';
      node('experiment-ab').value = String(state.scene.lengths.AB);
      node('experiment-ac').value = String(state.scene.lengths.AC);
      node('original-summary').textContent = summary(state.original, BG.geometryScene.solveTriangle(state.original));
      node('return-note').textContent = binding ? `返回视频 ${format(binding.frameTime)} 秒处。可随时退出，无需先答对理解题。` : '此场景未关联视频。可随时退出，无需先答对理解题。';
    }
    function clearErrors() {
      for (const name of ['labels-error', 'candidate-ab-error', 'candidate-ac-error', 'position-error', 'right-angle-error', 'ab-error', 'ac-error', 'reader-error']) node(name).textContent = '';
      for (const name of ['label-a', 'label-b', 'label-c', 'candidate-ab', 'candidate-ac', 'experiment-ab', 'experiment-ac']) node(name).removeAttribute('aria-invalid');
      node('review-error').hidden = true;
    }
    function showReview(scene, blank = false) {
      const checked = session.setCandidate(scene);
      if (!checked.ok) { status(checked.message || '候选结构不合法。', true); return; }
      cancelAsk();
      clearSceneFeedback();
      clearErrors(); resetQuiz();
      for (const key of ['A', 'B', 'C']) node(`label-${key.toLowerCase()}`).value = scene.labels[key];
      node('candidate-ab').value = blank ? '' : String(scene.lengths.AB);
      node('candidate-ac').value = blank ? '' : String(scene.lengths.AC);
      node('candidate-unit').value = scene.unit;
      node('right-angle-check').checked = false;
      node('position-panel').hidden = !scene.vertices;
      if (scene.vertices) for (const key of ['A', 'B', 'C']) for (const axis of ['x', 'y']) node(`candidate-${key.toLowerCase()}-${axis}`).value = String(scene.vertices[key][axis]);
      BG.geometryView.renderFrameMarkers(node('frame-markers'), scene, document);
      render();
      node('candidate-ab').focus?.();
    }
    function capture(preserveConfirmed = false) {
      if (disposed) return null;
      if (mediaFailed || video.error) { status('视频无法解码，请重新加载示例或选择本地视频。', true); return null; }
      if (playPending || returning) { status('正在完成播放或返回操作，请等画面停稳后再保存帧。', true); return null; }
      if (!videoId) { status('请先选择本地视频。', true); return null; }
      video.pause();
      const result = BG.geometryFrame.captureFrame({ video, requestId: id('geometry-read'), videoId });
      if (!result.ok) { status(result.message || '当前帧无法保存。', true); return null; }
      const preserve = preserveConfirmed && session.getState().phase === 'confirmed' && binding && BG.geometryFrame.isFrameCurrent(video, binding, videoId);
      cancelRead(); cancelAsk(); discardRetries();
      if (!preserve) { session.invalidate(); clearSceneFeedback(); resetQuiz(); }
      captured = result;
      if (!preserve) binding = { ...result.context };
      node('frame-preview').src = result.preview;
      node('frame-preview').hidden = false;
      node('frame-surface').style.minHeight = '0';
      node('frame-placeholder').hidden = true;
      node('frame-markers').hidden = true;
      node('frame-note').textContent = `已保存 ${format(result.context.frameTime)} 秒处的原帧。截图用于核对，像素距离不是题目长度。`;
      render();
      return result;
    }
    function makeLocalCandidate(source) {
      if (source === 'preset' && node('preset-button').disabled) return;
      cancelRead(); cancelAsk(); discardRetries();
      if (videoId && !capture()) return;
      const context = videoId && captured ? captured.context : { requestId: id('geometry-local'), videoId: id('standalone'), frameTime: 0, frameSize: { width: 1, height: 1 }, sceneRevision: 0 };
      // A standalone manual/preset scene has no claimed source-frame positioning.
      const values = source === 'preset' && selectedClip ? selectedClip : { AB: 3, AC: 4 };
      const scene = { schemaVersion: '1.0.0', kind: 'right-triangle', ...context, requestId: id('geometry-scene'), sceneRevision: 0, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, vertices: null, lengths: { AB: values.AB, AC: values.AC }, unit: values.unit || 'unit', source, originSource: source, editedByUser: source === 'manual' };
      if (binding) binding = { ...binding, requestId: scene.requestId };
      showReview(scene, source === 'manual');
      status(source === 'preset' ? `已载入${selectedClip ? selectedClip.title + ' 示例' : ' 3–4–5 预设'}条件，请对照题面核对并确认。此路径未调用识别模型。` : '请手工填写两条直角边并确认。此路径未调用识别模型。');
    }
    function confirm(event) {
      event.preventDefault(); clearErrors();
      const state = session.getState();
      if (state.phase !== 'review') return;
      const labels = { A: node('label-a').value.trim(), B: node('label-b').value.trim(), C: node('label-c').value.trim() };
      const lengths = { AB: Number(node('candidate-ab').value), AC: Number(node('candidate-ac').value) };
      let invalid = false;
      if (Object.values(labels).some((label) => !label || Array.from(label).length > 16) || new Set(Object.values(labels)).size !== 3) {
        node('labels-error').textContent = '三个标签需互不相同，且各为 1–16 个字符。';
        ['label-a', 'label-b', 'label-c'].forEach((name) => node(name).setAttribute('aria-invalid', 'true'));
        invalid = true;
      }
      for (const side of ['AB', 'AC']) {
        if (!(lengths[side] > 0 && Number.isFinite(lengths[side]))) {
          node(`candidate-${side.toLowerCase()}-error`).textContent = `${side} 请输入正的有限数值。`;
          node(`candidate-${side.toLowerCase()}`).setAttribute('aria-invalid', 'true'); invalid = true;
        }
      }
      if (!node('right-angle-check').checked) { node('right-angle-error').textContent = '请先核对并确认直角、边长与单位。'; invalid = true; }
      if (invalid) { node('review-error').textContent = '条件尚未确认，请检查下面标明的问题。'; node('review-error').hidden = false; node('review-error').focus?.(); return; }
      const original = state.scene;
      const position = readReviewPositions(original);
      if (!position.ok) return;
      const vertices = position.vertices;
      const changed = ['A', 'B', 'C'].some((key) => original.labels[key] !== labels[key]) || ['AB', 'AC'].some((side) => original.lengths[side] !== lengths[side]) || original.unit !== node('candidate-unit').value || differentPositions(vertices, original.vertices);
      const scene = { ...original, labels, lengths, vertices, unit: node('candidate-unit').value, ...(changed ? { source: 'manual', editedByUser: true } : {}) };
      const result = session.confirm(scene);
      if (!result.ok) { node('review-error').textContent = result.message || '这些条件无法建立有效模型，请检查数值。'; node('review-error').hidden = false; node('review-error').focus?.(); if (vertices) { node('position-error').textContent = '请检查顶点是否重复、共线或超出原帧。'; node('position-panel').open = true; } return; }
      BG.geometryView.renderFrameMarkers(node('frame-markers'), scene, document);
      render(); resetQuiz();
      node('explanation').textContent = `已确认原题。BC = √(AB² + AC²) = ${format(session.getState().result.BC)}，由本地确定性计算得到。`;
      status('条件已确认，可以单独改变 AB 或 AC。原题快照已经保存。');
    }
    function applyActions(actions, context = session.getContext()) {
      const result = session.execute(actions, context);
      if (!result.ok) return result;
      for (const side of ['ab', 'ac']) {
        node(`${side}-error`).textContent = '';
        node(`experiment-${side}`).removeAttribute('aria-invalid');
      }
      render();
      node('explanation').textContent = result.explanation || '已按当前条件完成本地计算。';
      if (actions.some((action) => action.type === 'set_length' || action.type === 'restore_original')) resetQuiz();
      return result;
    }
    function modifyLength(side, value) {
      const state = session.getState();
      if (state.phase !== 'confirmed') return;
      cancelRead(); cancelAsk(); discardRetries();
      const revision = state.scene.sceneRevision;
      const result = applyActions([{ type: 'set_length', side, value, unit: state.scene.unit }]);
      const error = node(`${side.toLowerCase()}-error`);
      error.textContent = result.ok ? '' : result.message || '请输入正的有限边长，且结果必须可计算。';
      node(`experiment-${side.toLowerCase()}`).setAttribute('aria-invalid', String(!result.ok));
      if (result.ok && session.getState().scene.sceneRevision !== revision) { status(`已修改 ${side}，另一条直角边和直角保持不变。`); feedback('条件已改变，先前的动作提议不再适用。'); }
      else if (result.ok) status(`${side} 数值未改变，条件保持不变。`);
      else { status('未执行本次修改，条件保持不变。', true); feedback('未执行本次修改，条件保持不变。', true); }
      updateVideoButtons();
    }
    function endpoint(kind) {
      const value = fixedReaderEndpoint || node('reader-url').value.trim();
      if (!value) { node('reader-error').textContent = '请填写本地 reader 地址；也可选择不调用模型的本地指令。'; node('reader-url').focus?.(); return null; }
      try { BG.geometryRequest.buildUrl(value, kind); }
      catch (error) { node('reader-error').textContent = error.message; node('reader-url').focus?.(); return null; }
      node('reader-error').textContent = '';
      return value;
    }
    function recognize() {
      if (!canSend()) { status('识别尚未获准或未主动启用；请先在学习工作台核对处理状态。', true); return; }
      if (disposed || readPending || askPending || !videoId || !video.paused || video.seeking) return;
      const url = endpoint('read'); if (!url) return;
      cancelRead(); cancelAsk();
      // Re-reading the same confirmed frame may fail; preserve its valid conditions.
      // An explicit save/new frame instead starts a fresh scene and clears the old snapshot.
      const frame = capture(true); if (!frame) return;
      const token = ++readToken;
      readPending = true;
      node('recognize-frame').disabled = true;
      node('read-cancel').hidden = false;
      node('read-busy').hidden = false;
      node('geometry-stage').setAttribute('aria-busy', 'true');
      updateVideoButtons();
      status('正在识别用户选择的这一帧，结果仍需校对。');
      let completed = false;
      const handle = BG.geometryRequest.requestGeometry({ url, kind: 'read', body: frame.body,
        onSuccess(payload) {
          completed = true;
          if (disposed || token !== readToken) return;
          if (!BG.geometryFrame.isFrameCurrent(video, frame.context, videoId)) { cancelRead('当前帧或源尺寸已变化，旧识别结果已拒绝。请重新保存当前帧。'); return; }
          cancelRead();
          if (payload.status !== 'candidate' || !payload.scene) { failRead(frame.context, '这一帧没有可执行的完整条件。请重试或显式选择手工填写。'); return; }
          const checked = BG.geometryScene.validateScene(payload.scene, frame.context);
          if (!checked.ok) { failRead(frame.context, checked.message || '识别候选与当前帧不匹配。'); return; }
          discardRetries(); binding = { ...frame.context };
          showReview(checked.scene);
          status('已取得真实识别候选，请对照原帧校对。结构合法不代表题意已经正确。');
        },
        onFailure(error) { completed = true; if (disposed || token !== readToken) return; cancelRead(); failRead(frame.context, `识别未完成：${errorText(error)}。视频与有效条件保留，可重试或手工填写。`); }
      });
      readRequest = completed ? null : handle;
    }
    function failRead(context, message) {
      readFailure = context;
      node('read-retry').hidden = false;
      node('geometry-retry').hidden = false;
      updateVideoButtons(); status(message, true);
    }
    function ask(event, retryText) {
      event.preventDefault();
      if (disposed || readPending || askPending) return;
      const state = session.getState(); if (state.phase !== 'confirmed') return;
      const text = retryText ?? node('question').value.trim();
      if (!text) { feedback('请先输入问题。', true); node('question').focus?.(); return; }
      cancelAsk();
      askFailure = null; node('ask-retry').hidden = true;
      const context = session.getContext();
      activeQuestion = { text, context };
      appendLog('user', text);
      if (node('ask-mode').value === 'local') {
        const parsed = BG.geometryScene.parseLocalQuestion(text, state.scene);
        if (parsed.status !== 'actions') { finishQuestion(parsed.reason || '请明确一条直角边及其数值；此问题没有修改画板。', true); return; }
        const result = applyActions(parsed.actions, context);
        finishQuestion(result.ok ? `本地受限指令 · ${result.explanation}` : `未执行：${result.message}`, !result.ok);
        status(result.ok ? '本地受限指令已执行，画板与回答使用同一计算结果。' : '本地指令未执行，条件保持不变。', !result.ok);
        return;
      }
      if (!canSend()) { finishQuestion('模型提问尚未获准或未主动启用。', true); return; }
      const url = endpoint('ask'); if (!url) { finishQuestion('未调用模型：请检查本地 reader 地址。', true); return; }
      const token = ++askToken;
      const body = { schemaVersion: '1.0.0', actionRequestId: id('geometry-ask'), scene: state.scene, text };
      node('ask-submit').disabled = true; node('ask-cancel').hidden = false; node('ask-form').setAttribute('aria-busy', 'true');
      askPending = true; updateVideoButtons();
      feedback('正在等待本地 reader 的动作提议；答案仍由本地计算。');
      syncGuide();
      let completed = false;
      const handle = BG.geometryRequest.requestGeometry({ url, kind: 'ask', body,
        onSuccess(payload) {
          completed = true;
          if (disposed || token !== askToken) return;
          const current = session.getContext();
          if (!current || current.sceneRevision !== context.sceneRevision || current.requestId !== context.requestId || (binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId))) { cancelAsk('条件或视频已改变，旧提议未执行。'); return; }
          askRequest = null; askPending = false; node('ask-cancel').hidden = true; node('ask-form').setAttribute('aria-busy', 'false');
          if (payload.status !== 'actions') { failAsk(text, context, '模型没有提出受支持的明确操作，画板保持不变。'); return; }
          const result = applyActions(payload.actions, payload.context);
          finishQuestion(result.ok ? `模型提议 · 本地执行：${result.explanation}` : `提议未执行：${result.message}`, !result.ok);
          if (!result.ok) { askFailure = { text, context }; node('ask-retry').hidden = false; }
          status(result.ok ? '模型提议已通过校验并在本地执行。' : '模型提议未执行，条件保持不变。', !result.ok);
          render();
        },
        onFailure(error) { completed = true; if (disposed || token !== askToken) return; askRequest = null; askPending = false; node('ask-cancel').hidden = true; node('ask-form').setAttribute('aria-busy', 'false'); failAsk(text, context, `提问未完成：${errorText(error)}。画板保持不变。`); }
      });
      askRequest = completed ? null : handle;
    }
    function failAsk(text, context, message) {
      askFailure = { text, context };
      node('ask-retry').hidden = false;
      finishQuestion(message, true); render(); updateVideoButtons();
    }
    function exit(resume = false) {
      if (disposed) return;
      const saved = binding;
      ++mediaEpoch; ++playToken; playPending = false; pendingReturn = null; returning = false;
      cancelRead(); cancelAsk(); discardRetries(); session.invalidate(); view.clear(); binding = null; captured = null;
      clearSceneFeedback();
      clearFramePreview();
      node('frame-markers').hidden = true;
      resetQuiz(); render();
      if (resume && saved && saved.videoId === videoId) {
        returning = true;
        pendingReturn = { ...saved, epoch: mediaEpoch };
        try { video.pause(); video.currentTime = saved.frameTime; if (!video.seeking) continueReturn(); }
        catch { returning = false; pendingReturn = null; status('无法返回保存的暂停时间，请使用播放器定位。', true); }
      } else { status('已退出实验，视频保留。'); }
      updateVideoButtons();
    }
    function continueReturn() {
      const saved = pendingReturn;
      if (!saved || disposed || saved.epoch !== mediaEpoch || saved.videoId !== videoId || video.seeking) return;
      pendingReturn = null;
      Promise.resolve().then(() => {
        if (disposed || saved.epoch !== mediaEpoch) return;
        return video.play();
      }).then(() => {
        if (disposed || saved.epoch !== mediaEpoch) return;
        returning = false; updateVideoButtons(); status(`已返回 ${format(saved.frameTime)} 秒处继续视频。`);
      }, () => {
        if (disposed || saved.epoch !== mediaEpoch) return;
        returning = false; updateVideoButtons(); status('已返回原暂停时间，请使用播放器继续播放。', true);
      });
    }
    function invalidateFrame() {
      if (disposed || returning) return;
      ++mediaEpoch; pendingReturn = null;
      cancelRead(); cancelAsk();
      discardRetries();
      if (binding || captured) { session.invalidate(); binding = null; captured = null; clearSceneFeedback(); clearFramePreview(); node('frame-markers').hidden = true; render(); status('视频或时间已变化，旧场景已退出。请在新帧重新确认。'); }
      updateVideoButtons();
    }
    function updateVideoButtons() {
      if (disposed) return;
      const ready = Boolean(videoId && !mediaFailed && !video.error && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0);
      const busy = readPending || askPending;
      const canCapture = ready && !video.seeking && !returning && !playPending;
      node('preset-button').textContent = selectedClip ? `载入 ${selectedClip.id.replaceAll('-', '–')} 示例条件` : '使用 3–4–5 预设';
      node('preset-button').disabled = Boolean(selectedClip && (!canCapture || !video.paused || video.currentTime < 2 || video.currentTime >= 8));
      node('geometry-preset-note').textContent = selectedClip ? '示例条件只对应 2–8 秒的暂停题面。定位到第 4 秒后可载入；仍需人工核对，不代表视觉识别。' : '预设与手工输入可独立完成实验，不代表模型已识别视频。';
      node('capture-frame').disabled = !canCapture;
      node('geometry-capture').disabled = !canCapture;
      node('recognize-frame').disabled = !canCapture || !video.paused || busy;
      node('geometry-action-reason').textContent = canCapture ? '' : video.seeking || returning ? '正在定位，请等画面停稳。' : playPending ? '正在开始播放，请等播放器完成操作。' : '请先选择视频并等待画面加载。';
      node('geometry-play').disabled = !ready || returning || playPending;
      node('geometry-play').setAttribute('aria-label', video.paused ? '播放视频' : '暂停视频');
      node('geometry-play').setAttribute('data-playing', String(!video.paused));
      node('geometry-play-reason').textContent = !ready ? '请先选择视频并等待画面加载。' : playPending ? '播放器正在完成播放操作。' : '';
      node('geometry-jump').disabled = !ready || returning || playPending;
      node('geometry-seek').disabled = node('geometry-jump').disabled;
      node('geometry-jump-reason').textContent = !ready ? '请先选择视频并等待画面加载。' : playPending ? '播放器正在完成播放操作。' : '';
      node('geometry-time').textContent = ready ? `当前 ${format(video.currentTime)} / ${format(video.duration)} 秒${video.seeking ? ' · 定位中' : video.paused ? ' · 已暂停' : ' · 播放中'}` : '当前时间：—';
      node('geometry-target').max = ready ? String(video.duration) : '';
      const canRetry = Boolean(readFailure && ready && BG.geometryFrame.isFrameCurrent(video, readFailure, videoId) && !busy);
      node('read-retry').disabled = !canRetry; node('geometry-retry').disabled = !canRetry;
      node('ask-submit').disabled = session.getState().phase !== 'confirmed' || busy;
      const current = session.getContext();
      node('ask-retry').disabled = !askFailure || busy || node('ask-mode').value !== 'model' || !BG.geometryRequest.sameContext(current, askFailure.context) || Boolean(binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId));
      node('geometry-fullscreen').disabled = fullscreenPending;
      node('geometry-fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏');
      syncGuide();
    }
    function togglePlay() {
      if (disposed || node('geometry-play').disabled) return;
      if (!video.paused) { video.pause(); updateVideoButtons(); return; }
      // Retire frame-bound work before play(), even when the media promise is delayed.
      invalidateFrame();
      const token = ++playToken;
      playPending = true; updateVideoButtons();
      try {
        Promise.resolve(video.play()).then(() => {
          if (disposed || token !== playToken) return;
          playPending = false; updateVideoButtons();
        }, () => {
          if (disposed || token !== playToken) return;
          playPending = false; updateVideoButtons();
          status('视频当前无法播放，请使用播放器重试。', true);
        });
      } catch { playPending = false; updateVideoButtons(); status('视频当前无法播放，请使用播放器重试。', true); }
    }
    function seekTarget() {
      if (disposed || node('geometry-jump').disabled) return;
      const raw = node('geometry-target').value.trim();
      const time = Number(raw);
      const error = node('geometry-seek-error');
      if (!raw || !Number.isFinite(time) || time < 0 || time > video.duration) {
        error.textContent = `请输入 0–${format(video.duration)} 秒内的有限时间。`;
        node('geometry-target').setAttribute('aria-invalid', 'true'); node('geometry-target').focus?.(); return;
      }
      error.textContent = ''; node('geometry-target').removeAttribute('aria-invalid');
      video.pause();
      try { video.currentTime = time; }
      catch { error.textContent = '播放器无法定位到这个时间，请使用原生控制条重试。'; return; }
      invalidateFrame(); updateVideoButtons(); status(`已请求定位到 ${format(time)} 秒；画面停稳后可保存当前帧。`);
    }
    function toggleFullscreen() {
      if (disposed || fullscreenPending) return;
      const target = document.documentElement || node('geometry-shell');
      const exitFull = Boolean(document.fullscreenElement);
      if (exitFull ? !document.exitFullscreen : !target?.requestFullscreen) { status('当前浏览器不支持工作台全屏。', true); return; }
      const token = ++fullscreenToken;
      fullscreenPending = true; updateVideoButtons();
      let result;
      try { result = exitFull ? document.exitFullscreen() : target.requestFullscreen(); }
      catch { fullscreenPending = false; updateVideoButtons(); status('未能切换全屏，请使用浏览器的全屏操作。', true); return; }
      Promise.resolve(result).then(() => {
        if (disposed || token !== fullscreenToken) return;
        fullscreenPending = false; updateVideoButtons();
      }, () => {
        if (disposed || token !== fullscreenToken) return;
        fullscreenPending = false; updateVideoButtons(); status('未能切换全屏，请使用浏览器的全屏操作。', true);
      });
    }
    function retryRead() {
      if (disposed || node('read-retry').disabled || !readFailure) return;
      recognize();
    }
    function restoreOriginal() {
      cancelRead(); cancelAsk(); discardRetries();
      const result = applyActions([{ type: 'restore_original' }]);
      if (result.ok) status('已恢复用户确认后的原题。');
      updateVideoButtons();
    }
    function differentPositions(left, right) {
      if (!left || !right) return Boolean(left) !== Boolean(right);
      return ['A', 'B', 'C'].some((key) => ['x', 'y'].some((axis) => left[key][axis] !== right[key][axis]));
    }
    function readReviewPositions(original) {
      if (!original.vertices) return { ok: true, vertices: original.vertices };
      const vertices = {};
      for (const key of ['A', 'B', 'C']) {
        vertices[key] = {};
        for (const axis of ['x', 'y']) {
          const raw = node(`candidate-${key.toLowerCase()}-${axis}`).value.trim();
          const number = Number(raw);
          const bound = axis === 'x' ? original.frameSize.width : original.frameSize.height;
          if (!raw || !Number.isFinite(number) || number < 0 || number > bound) {
            node('position-error').textContent = `${key} 的 ${axis} 需填写 0–${bound} 内的有限数值，空白不能当作 0。`;
            node('position-panel').open = true;
            return { ok: false };
          }
          vertices[key][axis] = number;
        }
      }
      return { ok: true, vertices };
    }
    function previewReview() {
      const state = session.getState(); if (state.phase !== 'review') return;
      const position = readReviewPositions(state.scene); if (!position.ok) return;
      const labels = Object.fromEntries(['A', 'B', 'C'].map((key) => [key, node(`label-${key.toLowerCase()}`).value.trim()]));
      const candidate = { ...state.scene, labels, vertices: position.vertices, source: 'manual', editedByUser: true };
      const valid = BG.geometryScene.validateScene(candidate);
      if (!valid.ok) {
        if (state.scene.vertices) { node('position-error').textContent = '暂无法预览：请检查标签、重复顶点、共线或越界。保留上一次有效高亮。'; node('position-panel').open = true; }
        return;
      }
      node('position-error').textContent = '';
      BG.geometryView.renderFrameMarkers(node('frame-markers'), valid.scene, document);
    }
    function replaceVideo(src, name, clip = null, objectUrl = null) {
      if (options.onSelectSample && clip) return options.onSelectSample(src, `${clip.id}.mp4`, clip);
      exit(); video.pause();
      if (videoUrl) window.URL.revokeObjectURL(videoUrl);
      videoUrl = objectUrl;
      videoId = id(clip ? 'example-video' : 'local-video');
      selectedClip = clip;
      mediaFailed = false;
      pendingClipSeek = clip ? { videoId, time: clip.target } : null;
      video.src = src;
      node('video-name').textContent = name;
      node('geometry-seek-error').textContent = '';
      node('geometry-target').removeAttribute('aria-invalid');
      if (clip) node('geometry-target').value = String(clip.target);
      video.load?.(); updateVideoButtons();
      status(clip ? '正在加载自制教学示例，将暂停在第 4 秒题面。随后可载入示例条件并核对，或主动识别当前帧。' : '视频已选择。暂停到清晰题面后，可保存或识别这一帧。');
    }
    function clipDescription() {
      const clip = clips.find((item) => item.id === node('geometry-video-select').value) || clips[0];
      node('geometry-video-summary').textContent = `自制无声教学示例 · AB = ${clip.AB} cm、AC = ${clip.AC} cm，A 为直角 · 第 4 秒题面，8 秒后展示计算。载入条件需人工确认，不代表视觉识别。`;
      return clip;
    }
    listen(node('geometry-video-select'), 'change', clipDescription);
    listen(node('geometry-video-load'), 'click', () => {
      const clip = clipDescription();
      replaceVideo(clip.path, `${clip.title} · 自制教学示例`, clip);
    });
    listen(node('local-video'), 'change', () => {
      const file = node('local-video').files?.[0]; if (!file) return;
      if (file.type && !file.type.startsWith('video/')) { status('请选择视频文件。当前视频与有效条件保持不变。', true); return; }
      if (options.onSelectFile) { options.onSelectFile(file); return; }
      const url = window.URL.createObjectURL(file);
      replaceVideo(url, file.name, null, url);
    });
    listen(node('capture-frame'), 'click', () => { cancelRead(); cancelAsk(); if (capture()) status('当前帧已保存在本机。可识别或显式填写条件。'); });
    listen(node('recognize-frame'), 'click', recognize);
    listen(node('read-retry'), 'click', retryRead);
    listen(node('read-cancel'), 'click', () => cancelRead('已取消识别，未自动采用预设。'));
    listen(node('preset-button'), 'click', () => makeLocalCandidate('preset'));
    listen(node('manual-button'), 'click', () => makeLocalCandidate('manual'));
    listen(node('review-form'), 'submit', confirm);
    listen(node('ab-form'), 'submit', (event) => { event.preventDefault(); modifyLength('AB', Number(node('experiment-ab').value)); });
    listen(node('ac-form'), 'submit', (event) => { event.preventDefault(); modifyLength('AC', Number(node('experiment-ac').value)); });
    listen(node('restore-original'), 'click', restoreOriginal);
    listen(node('ask-form'), 'submit', ask);
    listen(node('ask-cancel'), 'click', () => cancelAsk('已取消提问，旧动作不会执行。'));
    listen(node('ask-mode'), 'change', () => { cancelAsk('问题处理方式已改变。'); askFailure = null; node('ask-retry').hidden = true; });
    for (const name of ['experiment-ab', 'experiment-ac', 'question']) listen(node(name), 'input', () => { if (askPending) cancelAsk('正在编辑，先前的提问已取消，条件尚未改变。'); askFailure = null; node('ask-retry').hidden = true; });
    for (const side of ['AB', 'AC']) listen(node(`experiment-${side.toLowerCase()}-range`), 'input', () => modifyLength(side, Number(node(`experiment-${side.toLowerCase()}-range`).value)));
    const examples = { change: '把 AB 改成 6，AC 不变，BC 是多少？', query: '现在 BC 是多少', explain: '解释变化', restore: '恢复原题' };
    for (const [name, text] of Object.entries(examples)) listen(node(`ask-example-${name}`), 'click', () => {
      if (session.getState().phase !== 'confirmed' || askPending || readPending) return;
      const ab = session.getState().scene.lengths.AB;
      const next = Number.isFinite(ab * 2) ? ab * 2 : ab / 2;
      node('question').value = name === 'change' ? `把 AB 改成 ${next}，AC 不变，BC 是多少？` : text;
      askFailure = null; node('ask-retry').hidden = true;
      node('question').focus?.(); feedback('示例已填入草稿。确认后点击提交问题，不会自动修改条件。');
    });
    listen(node('ask-log-clear'), 'click', () => {
      const pending = askPending;
      if (pending) cancelAsk('清空记录时已取消当前提问，迟到动作不会执行。');
      clearLog(); feedback(pending ? '记录已清空，当前提问已取消；画板保持不变。' : '本次问答记录已清空，画板保持不变。'); node('question').focus?.();
    });
    listen(node('ask-retry'), 'click', () => {
      const current = session.getContext();
      if (!askFailure || !current || node('ask-mode').value !== 'model' || !BG.geometryRequest.sameContext(current, askFailure.context)) return;
      ask({ preventDefault() {} }, askFailure.text);
    });
    if (!fixedReaderEndpoint) {
      listen(node('reader-url'), 'change', () => { cancelRead(); cancelAsk('reader 地址已改变，先前的提问已取消。'); discardRetries(); rememberAddress(); updateVideoButtons(); });
      listen(node('reader-url'), 'blur', () => rememberAddress());
      listen(node('reader-url'), 'input', () => { cancelRead(); cancelAsk(); discardRetries(); node('reader-error').textContent = ''; });
      listen(node('reader-forget'), 'click', () => {
        cancelRead(); cancelAsk('reader 地址已清空，先前的提问已取消。'); discardRetries();
        node('reader-url').value = ''; node('reader-error').textContent = ''; rememberAddress(); node('reader-url').focus?.();
      });
    }
    listen(node('geometry-play'), 'click', togglePlay);
    listen(node('geometry-jump'), 'click', seekTarget);
    listen(node('geometry-seek'), 'click', seekTarget);
    listen(node('geometry-target'), 'keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); seekTarget(); } });
    listen(node('geometry-capture'), 'click', () => { if (!node('geometry-capture').disabled && capture()) status('当前帧已保存在本机。可识别或显式填写条件。'); });
    listen(node('geometry-cancel'), 'click', () => { if (readPending) cancelRead('已取消识别，未自动采用预设。'); if (askPending) cancelAsk('已取消提问，旧动作不会执行。'); });
    listen(node('geometry-retry'), 'click', retryRead);
    listen(node('geometry-restore'), 'click', restoreOriginal);
    listen(node('geometry-fullscreen'), 'click', toggleFullscreen);
    listen(node('geometry-exit'), 'click', () => exit());
    for (const key of ['A', 'B', 'C']) {
      listen(node(`label-${key.toLowerCase()}`), 'input', previewReview);
      for (const axis of ['x', 'y']) listen(node(`candidate-${key.toLowerCase()}-${axis}`), 'input', previewReview);
    }
    listen(node('quiz-check'), 'click', () => {
      const answer = node('quiz-answer').value;
      if (!answer) { node('quiz-feedback').textContent = '请先选择一个答案。'; return; }
      const correct = answer === 'fixed';
      node('quiz-feedback').textContent = correct ? '本次回答正确：AC 与 A 处直角不变，BC 随 AB 变化；BC² = AB² + AC²。' : '本次回答不正确：这里固定的是 AC 与直角，BC 会随 AB 变化。可以重新作答。';
      node('quiz-retry').hidden = false;
      node('quiz-answer').disabled = true; node('quiz-check').disabled = true;
    });
    listen(node('quiz-retry'), 'click', () => { resetQuiz(); node('quiz-answer').focus?.(); });
    listen(node('quiz-skip'), 'click', () => { node('quiz-feedback').textContent = '已跳过，未验证本次理解。仍可返回视频。'; });
    listen(node('exit-scene'), 'click', () => exit());
    listen(node('return-video'), 'click', () => exit(true));
    function metadataChanged() {
      if (pendingClipSeek?.videoId === videoId && Number.isFinite(video.duration) && video.duration >= pendingClipSeek.time) {
        const time = pendingClipSeek.time; pendingClipSeek = null;
        try { video.pause(); video.currentTime = time; }
        catch { status('示例已加载，自动定位失败。请用目标时间控件定位到第 4 秒。', true); }
      }
      if (binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId)) invalidateFrame(); else updateVideoButtons();
    }
    listen(video, 'loadedmetadata', metadataChanged);
    listen(video, 'resize', metadataChanged);
    listen(video, 'pause', updateVideoButtons);
    listen(video, 'play', invalidateFrame);
    listen(video, 'seeking', invalidateFrame);
    listen(video, 'seeked', () => {
      continueReturn(); updateVideoButtons();
      if (selectedClip && video.paused && Math.abs(video.currentTime - selectedClip.target) <= 0.2 && session.getState().phase === 'empty' && !captured && !readPending && !askPending) status('示例题面已停在第 4 秒。可载入示例条件并校对，或主动识别当前帧。');
    });
    listen(video, 'loadeddata', updateVideoButtons);
    listen(video, 'durationchange', updateVideoButtons);
    listen(video, 'ended', updateVideoButtons);
    listen(video, 'timeupdate', () => { if (binding && !returning && !BG.geometryFrame.isFrameCurrent(video, binding, videoId)) invalidateFrame(); updateVideoButtons(); });
    listen(video, 'error', () => { mediaFailed = true; pendingClipSeek = null; invalidateFrame(); status(selectedClip ? '教学示例无法加载，请重新加载或选择本地视频。' : '视频无法加载，请重新选择文件。', true); });
    listen(document, 'fullscreenchange', updateVideoButtons);
    listen(document, 'keydown', (event) => {
      if (!isActive()) return;
      const target = event.target;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat && String(event.key).toLowerCase() === 'b' && !editing) {
        event.preventDefault(); if (!node('geometry-capture').disabled && capture()) status('当前帧已保存在本机，尚未调用识别模型。'); return;
      }
      if (event.key !== 'Escape' || document.fullscreenElement) return;
      if (target === node('question')) { cancelAsk('草稿已清空，先前的提问已取消。'); node('question').value = ''; askFailure = null; node('ask-retry').hidden = true; return; }
      if (editing) return;
      if (readPending || askPending) { cancelRead('已取消当前请求，视频与有效条件保留。'); cancelAsk('已取消提问，旧动作不会执行。'); return; }
      if (session.getState().phase !== 'empty' || captured) { exit(); node('preset-button').focus?.(); }
    });
    function suspend() {
      if (disposed || suspended) return;
      suspended = true;
      // A cached page still owns its scene, drafts, listeners and local video URL.
      ++mediaEpoch; ++playToken; ++fullscreenToken;
      pendingReturn = null; returning = false; playPending = false; fullscreenPending = false;
      cancelRead(readPending ? '离开页面时已取消识别，视频与有效条件保留。' : undefined);
      cancelAsk(askPending ? '离开页面时已取消提问，迟到动作不会执行。' : undefined);
      video.pause(); updateVideoButtons();
    }
    function resume(event) {
      if (!event.persisted || disposed || !suspended) return;
      suspended = false;
      // Refresh controls without render(), which would overwrite unsubmitted fields.
      if (binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId)) invalidateFrame();
      else updateVideoButtons();
    }
    function dispose() {
      if (disposed) return;
      cancelRead(); cancelAsk(); disposed = true; ++mediaEpoch; pendingReturn = null;
      listeners.splice(0).forEach((remove) => remove()); session.dispose(); view.dispose();
      const docks = window.BreakGlassUI?.docks || [];
      for (const dock of docks) if (dock.root === node('geometry-toolbar')) dock.destroy();
      if (videoUrl) window.URL.revokeObjectURL(videoUrl);
    }
    listen(window, 'pagehide', (event) => { if (event.persisted) suspend(); else dispose(); });
    listen(window, 'pageshow', resume);
    rememberAddress(true); clearLog(); clipDescription(); render(); updateVideoButtons();
    return { session, capture, render, exit, dispose, destroy: dispose, setActive(value) { active = Boolean(value); if (!active) { cancelRead(); cancelAsk(); pendingReturn = null; returning = false; } else updateVideoButtons(); }, onMediaChange(value) { const changed = borrowedMedia?.generation !== value.generation || borrowedMedia?.owner !== value.owner; borrowedMedia = value; if (changed) { ++mediaEpoch; exit(); } videoId = value.source?.id || null; selectedClip = value.clip || null; pendingClipSeek = null; mediaFailed = false; node('video-name').textContent = value.selection?.name || '尚未选择视频'; if (selectedClip) node('geometry-target').value = String(selectedClip.target); updateVideoButtons(); }, getSnapshot() { const state = session.getState(); return state.phase === 'confirmed' ? { template: 'right-triangle', snapshot: { AB: state.scene.lengths.AB, AC: state.scene.lengths.AC, unit: state.scene.unit } } : null; } };
  }
  const api = { createGeometryPage, clips, mount: (container, options = {}) => createGeometryPage(options) };
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document?.getElementById('geometry-video')) api.page = createGeometryPage();
})(typeof globalThis !== 'undefined' ? globalThis : this);
