(function (root) {
  'use strict';
  function createGeometryPage(options = {}) {
    const document = options.document || root.document;
    const window = options.window || root;
    const BG = options.BreakGlass || root.BreakGlass;
    const session = BG.geometrySession.createGeometrySession();
    const node = (id) => document.getElementById(id);
    const video = node('geometry-video');
    const listeners = [];
    let sequence = 0;
    let videoId = null;
    let videoUrl = null;
    let captured = null;
    let binding = null;
    let readRequest = null;
    let askRequest = null;
    let readToken = 0;
    let askToken = 0;
    let returning = false;
    const format = BG.geometryView.formatNumber;
    const view = BG.geometryView.createTriangleView({ svg: node('triangle-board'), document, onSetLength: modifyLength });
    function id(prefix) { return `${prefix}-${Date.now()}-${++sequence}`; }
    function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); }
    function status(message, error = false) {
      const target = node('page-status');
      target.textContent = message;
      target.classList.toggle('is-error', error);
      target.setAttribute('aria-live', error ? 'assertive' : 'polite');
    }
    function feedback(message, error = false) {
      node('ask-feedback').textContent = message;
      node('ask-feedback').classList.toggle('is-error', error);
    }
    function clearSceneFeedback() {
      feedback('');
      node('explanation').textContent = '';
      node('original-summary').textContent = '';
    }
    function cancelRead(message) {
      ++readToken; readRequest?.cancel(); readRequest = null;
      node('read-cancel').hidden = true;
      node('recognize-frame').disabled = !videoId || !video.paused || video.seeking;
      if (message) status(message);
    }
    function cancelAsk(message) {
      ++askToken; askRequest?.cancel(); askRequest = null;
      node('ask-cancel').hidden = true;
      node('ask-submit').disabled = session.getState().phase !== 'confirmed';
      node('ask-form').setAttribute('aria-busy', 'false');
      if (message) feedback(message);
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
      if (!confirmed) { view.clear(); return; }
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
    function capture() {
      if (!videoId) { status('请先选择本地视频。', true); return null; }
      video.pause();
      const result = BG.geometryFrame.captureFrame({ video, requestId: id('geometry-read'), videoId });
      if (!result.ok) { status(result.message || '当前帧无法保存。', true); return null; }
      captured = result;
      binding = { ...result.context };
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
      cancelRead(); cancelAsk();
      if (videoId && !capture()) return;
      const context = videoId && captured ? captured.context : { requestId: id('geometry-local'), videoId: id('standalone'), frameTime: 0, frameSize: { width: 1, height: 1 }, sceneRevision: 0 };
      // A standalone manual/preset scene has no claimed source-frame positioning.
      const scene = { schemaVersion: '1.0.0', kind: 'right-triangle', ...context, requestId: id('geometry-scene'), sceneRevision: 0, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' }, vertices: null, lengths: { AB: 3, AC: 4 }, unit: 'unit', source, originSource: source, editedByUser: source === 'manual' };
      if (binding) binding = { ...binding, requestId: scene.requestId };
      showReview(scene, source === 'manual');
      status(source === 'preset' ? '已选择 3–4–5 预设，请核对并确认。此路径未调用识别模型。' : '请手工填写两条直角边并确认。此路径未调用识别模型。');
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
      render();
      node('explanation').textContent = result.explanation || '已按当前条件完成本地计算。';
      if (actions.some((action) => action.type === 'set_length' || action.type === 'restore_original')) resetQuiz();
      return result;
    }
    function modifyLength(side, value) {
      const state = session.getState();
      if (state.phase !== 'confirmed') return;
      cancelRead(); cancelAsk();
      const revision = state.scene.sceneRevision;
      const result = applyActions([{ type: 'set_length', side, value, unit: state.scene.unit }]);
      const error = node(`${side.toLowerCase()}-error`);
      error.textContent = result.ok ? '' : result.message || '请输入正的有限边长，且结果必须可计算。';
      node(`experiment-${side.toLowerCase()}`).setAttribute('aria-invalid', String(!result.ok));
      if (result.ok && session.getState().scene.sceneRevision !== revision) { status(`已修改 ${side}，另一条直角边和直角保持不变。`); feedback('条件已改变，先前的动作提议不再适用。'); }
      else if (result.ok) status(`${side} 数值未改变，条件保持不变。`);
      else { status('未执行本次修改，条件保持不变。', true); feedback('未执行本次修改，条件保持不变。', true); }
    }
    function endpoint(kind) {
      const value = node('reader-url').value.trim();
      if (!value) { node('reader-error').textContent = '请填写本地 reader 地址；也可选择不调用模型的本地指令。'; node('reader-url').focus?.(); return null; }
      try { BG.geometryRequest.buildUrl?.(value, kind); }
      catch (error) { node('reader-error').textContent = error.message; node('reader-url').focus?.(); return null; }
      node('reader-error').textContent = '';
      return value;
    }
    function recognize() {
      const url = endpoint('read'); if (!url) return;
      cancelRead(); cancelAsk();
      const frame = capture(); if (!frame) return;
      const token = ++readToken;
      node('recognize-frame').disabled = true;
      node('read-cancel').hidden = false;
      status('正在识别用户选择的这一帧，结果仍需校对。');
      let completed = false;
      const handle = BG.geometryRequest.requestGeometry({ url, kind: 'read', body: frame.body,
        onSuccess(payload) {
          completed = true;
          if (token !== readToken) return;
          if (!BG.geometryFrame.isFrameCurrent(video, frame.context, videoId)) { cancelRead('当前帧或源尺寸已变化，旧识别结果已拒绝。请重新保存当前帧。'); return; }
          readRequest = null; node('read-cancel').hidden = true; node('recognize-frame').disabled = false;
          if (payload.status !== 'candidate' || !payload.scene) { status('这一帧没有可执行的完整条件。请重试或显式选择手工填写。', true); return; }
          const checked = BG.geometryScene.validateScene(payload.scene, frame.context);
          if (!checked.ok) { status(checked.message || '识别候选与当前帧不匹配。', true); return; }
          showReview(checked.scene);
          status('已取得真实识别候选，请对照原帧校对。结构合法不代表题意已经正确。');
        },
        onFailure(error) { completed = true; if (token !== readToken) return; readRequest = null; node('read-cancel').hidden = true; updateVideoButtons(); status(`识别未完成：${errorText(error)}。视频与有效条件保留，可重试或手工填写。`, true); }
      });
      readRequest = completed ? null : handle;
    }
    function ask(event) {
      event.preventDefault();
      const state = session.getState(); if (state.phase !== 'confirmed') return;
      const text = node('question').value.trim();
      if (!text) { feedback('请先输入问题。', true); node('question').focus?.(); return; }
      cancelAsk();
      const context = session.getContext();
      if (node('ask-mode').value === 'local') {
        const parsed = BG.geometryScene.parseLocalQuestion(text, state.scene);
        if (parsed.status !== 'actions') { feedback(parsed.reason || '请明确一条直角边及其数值；此问题没有修改画板。', true); return; }
        const result = applyActions(parsed.actions, context);
        feedback(result.ok ? `本地受限指令 · ${result.explanation}` : `未执行：${result.message}`, !result.ok);
        status(result.ok ? '本地受限指令已执行，画板与回答使用同一计算结果。' : '本地指令未执行，条件保持不变。', !result.ok);
        return;
      }
      const url = endpoint('ask'); if (!url) { feedback('未调用模型：请检查本地 reader 地址。', true); return; }
      const token = ++askToken;
      const body = { schemaVersion: '1.0.0', actionRequestId: id('geometry-ask'), scene: state.scene, text };
      node('ask-submit').disabled = true; node('ask-cancel').hidden = false; node('ask-form').setAttribute('aria-busy', 'true');
      feedback('正在等待本地 reader 的动作提议；答案仍由本地计算。');
      let completed = false;
      const handle = BG.geometryRequest.requestGeometry({ url, kind: 'ask', body,
        onSuccess(payload) {
          completed = true;
          if (token !== askToken) return;
          const current = session.getContext();
          if (!current || current.sceneRevision !== context.sceneRevision || current.requestId !== context.requestId || (binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId))) { cancelAsk('条件或视频已改变，旧提议未执行。'); return; }
          askRequest = null; node('ask-cancel').hidden = true; node('ask-form').setAttribute('aria-busy', 'false');
          if (payload.status !== 'actions') { render(); feedback('模型没有提出受支持的明确操作，画板保持不变。', true); return; }
          const result = applyActions(payload.actions, payload.context);
          feedback(result.ok ? `模型提议 · 本地执行：${result.explanation}` : `提议未执行：${result.message}`, !result.ok);
          status(result.ok ? '模型提议已通过校验并在本地执行。' : '模型提议未执行，条件保持不变。', !result.ok);
          render();
        },
        onFailure(error) { completed = true; if (token !== askToken) return; askRequest = null; node('ask-cancel').hidden = true; node('ask-form').setAttribute('aria-busy', 'false'); render(); feedback(`提问未完成：${errorText(error)}。画板保持不变。`, true); }
      });
      askRequest = completed ? null : handle;
    }
    function exit(resume = false) {
      const saved = binding;
      cancelRead(); cancelAsk(); session.invalidate(); view.clear(); binding = null; captured = null;
      clearSceneFeedback();
      node('frame-markers').hidden = true;
      resetQuiz(); render();
      if (resume && saved && saved.videoId === videoId) {
        returning = true;
        video.currentTime = saved.frameTime;
        Promise.resolve(video.play()).then(() => { returning = false; status(`已返回 ${format(saved.frameTime)} 秒处继续视频。`); }, () => { returning = false; status('已返回原暂停时间，请使用播放器继续播放。'); });
      } else { status('已退出实验，视频保留。'); }
    }
    function invalidateFrame() {
      if (returning) return;
      cancelRead(); cancelAsk();
      if (binding || captured) { session.invalidate(); binding = null; captured = null; clearSceneFeedback(); node('frame-markers').hidden = true; render(); status('视频或时间已变化，旧场景已退出。请在新帧重新确认。'); }
      updateVideoButtons();
    }
    function updateVideoButtons() {
      node('capture-frame').disabled = !videoId || !(video.videoWidth > 0 && video.videoHeight > 0) || video.seeking;
      node('recognize-frame').disabled = !videoId || !video.paused || video.seeking || Boolean(readRequest);
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
    listen(node('local-video'), 'change', () => {
      const file = node('local-video').files?.[0]; if (!file) return;
      exit();
      if (videoUrl) window.URL.revokeObjectURL(videoUrl);
      videoId = id('local-video'); videoUrl = window.URL.createObjectURL(file); video.src = videoUrl;
      node('video-name').textContent = file.name;
      node('frame-preview').hidden = true; node('frame-placeholder').hidden = false;
      node('frame-note').textContent = '截图只用于核对，不用像素长度计算答案。';
      video.load?.(); updateVideoButtons(); status('视频已选择。暂停到清晰题面后，可保存或识别这一帧。');
    });
    listen(node('capture-frame'), 'click', () => { cancelRead(); cancelAsk(); if (capture()) status('当前帧已保存在本机。可识别或显式填写条件。'); });
    listen(node('recognize-frame'), 'click', recognize);
    listen(node('read-cancel'), 'click', () => cancelRead('已取消识别，未自动采用预设。'));
    listen(node('preset-button'), 'click', () => makeLocalCandidate('preset'));
    listen(node('manual-button'), 'click', () => makeLocalCandidate('manual'));
    listen(node('review-form'), 'submit', confirm);
    listen(node('ab-form'), 'submit', (event) => { event.preventDefault(); modifyLength('AB', Number(node('experiment-ab').value)); });
    listen(node('ac-form'), 'submit', (event) => { event.preventDefault(); modifyLength('AC', Number(node('experiment-ac').value)); });
    listen(node('restore-original'), 'click', () => { cancelRead(); cancelAsk(); const result = applyActions([{ type: 'restore_original' }]); if (result.ok) status('已恢复用户确认后的原题。'); });
    listen(node('ask-form'), 'submit', ask);
    listen(node('ask-cancel'), 'click', () => cancelAsk('已取消提问，旧动作不会执行。'));
    listen(node('ask-mode'), 'change', () => cancelAsk('问题处理方式已改变。'));
    for (const name of ['experiment-ab', 'experiment-ac', 'question']) listen(node(name), 'input', () => { if (askRequest) cancelAsk('正在编辑，先前的提问已取消，条件尚未改变。'); });
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
    function metadataChanged() { if (binding && !BG.geometryFrame.isFrameCurrent(video, binding, videoId)) invalidateFrame(); else updateVideoButtons(); }
    listen(video, 'loadedmetadata', metadataChanged);
    listen(video, 'resize', metadataChanged);
    listen(video, 'pause', updateVideoButtons);
    listen(video, 'play', invalidateFrame);
    listen(video, 'seeking', invalidateFrame);
    listen(video, 'seeked', updateVideoButtons);
    listen(video, 'timeupdate', () => { if (binding && !returning && !BG.geometryFrame.isFrameCurrent(video, binding, videoId)) invalidateFrame(); });
    listen(video, 'error', () => { invalidateFrame(); status('视频无法加载，请重新选择文件。', true); });
    listen(document, 'keydown', (event) => { if (event.key === 'Escape') exit(); });
    function dispose() { cancelRead(); cancelAsk(); listeners.splice(0).forEach((remove) => remove()); session.dispose(); view.dispose(); if (videoUrl) window.URL.revokeObjectURL(videoUrl); }
    listen(window, 'pagehide', dispose);
    render(); updateVideoButtons();
    return { session, capture, render, exit, dispose };
  }
  const api = { createGeometryPage };
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document?.getElementById('geometry-video')) api.page = createGeometryPage();
})(typeof globalThis !== 'undefined' ? globalThis : this);
