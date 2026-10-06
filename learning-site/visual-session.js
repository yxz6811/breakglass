(function (root) {
  const bg = root.BreakGlass;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function createSession({ video, source: inputSource, cssText, onSave, manualOnly = false }) {
    const checked = bg.pluginContracts.validateSource(inputSource);
    if (!checked.ok) throw new Error(checked.message);
    const allowed = !manualOnly && checked.value.kind === 'local-file' && checked.value.materialMode !== 'permission-pending';
    const source = allowed ? checked.value : { kind: 'manual-notes', id: `manual-${checked.value.id}`,
      version: '1', analysisVersion: '1', materialMode: 'self-authored', title: '我输入的数学条件' };
    const media = video.currentSrc || video.src;
    let epoch = 0; let disposed = false; let summaryController = null; let sessionToken = null; let enabled = false;
    let points = []; let observations = []; let revision = 0; let summarizedRevision = 0;
    let readCalls = 0; let summaryCalls = 0; let startedAt = 0;
    const controllers = new Set(); const listeners = [];
    const current = () => !disposed && video.isConnected && (video.currentSrc || video.src) === media && !document.hidden;
    const listen = (target, event, listener) => { target.addEventListener(event, listener); listeners.push(() => target.removeEventListener(event, listener)); };
    function stop(reason = '分析已停止，未保存的视觉观察已清空。') {
      epoch += 1; enabled = false; loop.stop();
      const oldToken = sessionToken; sessionToken = null;
      if (oldToken) void fetch('/api/vision/session/end', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: oldToken }), keepalive: true }).catch(() => {});
      controllers.forEach((controller) => controller.abort()); controllers.clear();
      summaryController = null; points = []; observations = []; revision = 0; summarizedRevision = 0;
      overlay.updatePoints([]); overlay.updateSummary(null); overlay.setRecognitionState(false); overlay.updateStatus(reason);
    }
    async function request(path, body, signal) {
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await fetch(`/api/vision/${path}`, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-breakglass-visual-session': sessionToken }, body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, signal || new AbortController().signal, AbortSignal.timeout(25000)]) });
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; let text = '';
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > 65536) throw new Error('分析响应过大。');
          text += decoder.decode(chunk.value, { stream: true }); } } finally { await reader.cancel().catch(() => {}); }
        const answer = JSON.parse(text + decoder.decode());
        if (!response.ok) throw new Error(answer.error || '分析服务未就绪。');
        if (answer.requestId !== body.requestId || answer.sourceId !== source.id || answer.videoVersion !== source.version
          || answer.analysisVersion !== source.analysisVersion || answer.schemaVersion !== '1') throw new Error('分析来源或请求不匹配。');
        return answer;
      } finally { controllers.delete(controller); }
    }
    const metadata = () => ({ schemaVersion: '1', requestId: crypto.randomUUID(), sourceId: source.id,
      videoVersion: source.version, analysisVersion: source.analysisVersion, materialMode: source.materialMode });
    async function summarize(owner) {
      if (summaryController || !current() || !loop.isRunning() || !observations.length
        || (summarizedRevision && revision - summarizedRevision < 3)) return;
      if (summaryCalls >= 8) { overlay.updateStatus('本次总结额度已用完；可保留已有总结继续学习。'); return; }
      summaryCalls += 1; summarizedRevision = revision;
      const input = observations.slice(-20).map(copy); const controller = new AbortController(); summaryController = controller;
      try {
        const answer = await request('summarize', { ...metadata(), observations: input }, controller.signal);
        if (owner !== epoch || !current() || controller.signal.aborted) return;
        const times = [...new Set(input.map((item) => item.frameTime))].sort((a, b) => a - b);
        if (answer.status !== 'summary' || !Array.isArray(answer.observedTimes)
          || JSON.stringify(answer.observedTimes) !== JSON.stringify(times)) throw new Error('总结的观察时间不符。');
        overlay.updateSummary(answer);
      } catch (error) { if (owner === epoch && !controller.signal.aborted) overlay.updateStatus(`画面识别继续；${error.message}`); }
      finally { if (summaryController === controller) { summaryController = null;
        if (owner === epoch && revision - summarizedRevision >= 3) void summarize(owner); } }
    }
    const loop = bg.pluginLoop.createVisualLoop({ capture: async (signal) => {
      if (!current()) { stop('页面或文件已变化，分析停止。'); return null; }
      if (Date.now() - startedAt >= 30 * 60 * 1000) throw new Error('本次分析时长已到，请先整理结果。');
      return bg.frameSampling.capture(video, signal, current);
    }, read: async (frame, signal) => {
      if (readCalls >= 32) throw new Error('本次画面分析额度已到。');
      readCalls += 1; const owner = epoch;
      const answer = await request('read', { ...metadata(), frameTime: frame.frameTime, image: frame.image }, signal);
      if (owner !== epoch || !current() || signal.aborted || answer.frameTime !== frame.frameTime) throw new Error('已丢弃过期画面结果。');
      return { ok: true, payload: answer };
    }, onStatus: (message) => {
      overlay.updateStatus(message); queueMicrotask(() => { if (!loop.isRunning() && enabled) stop(message); });
    }, onResult: (reply, frame) => {
      const answer = reply.payload;
      if (answer.status !== 'candidate') { overlay.updateStatus(answer.status === 'needs_review' ? '画面条件需要进一步校对。' : '该画面没有支持的数学对象。'); return; }
      const valid = bg.pluginContracts.validateVisualResult(answer.result); if (!valid.ok) throw new Error(valid.message);
      const result = valid.value; const end = Math.min(video.duration, frame.frameTime + 2); if (end <= frame.frameTime) return;
      const point = { id: `vision-${crypto.randomUUID()}`, start: frame.frameTime, end, area: result.area,
        title: result.title, explanation: `${result.explanation}\n常见误区：${result.pitfallHint || '暂无，不能据此判定学生出错。'}`,
        template: result.template, snapshot: result.snapshot, origin: 'vision', sourceLabel: 'AI画面候选' };
      const validPoints = bg.pluginContracts.validatePoints([point], { duration: video.duration, source });
      if (!validPoints.ok) throw new Error(validPoints.message);
      points = [...points, validPoints.value[0]].slice(-32); overlay.updatePoints(points);
      const observation = { frameTime: frame.frameTime, title: result.title, explanation: result.explanation,
        pitfallHint: result.pitfallHint, template: result.template };
      const prior = observations.at(-1);
      if (!prior || JSON.stringify({ ...prior, frameTime: 0 }) !== JSON.stringify({ ...observation, frameTime: 0 })) {
        observations = [...observations, observation].slice(-20); revision += 1;
      }
      overlay.updateStatus(`第${frame.frameTime.toFixed(1)}秒画面已有候选，条件需要确认；未包含音频。`); void summarize(epoch);
    } });
    const overlay = bg.pluginOverlay.createLearningOverlay({ video, source, cssText, points: [], onSave,
      saveNoteLabel: '我的疑问或易错提醒',
      mount: video.parentElement.parentElement,
      onToggleRecognition: allowed ? () => loop.isRunning() ? stop() : start() : undefined,
      onClose: () => destroy() });
    async function start() {
      if (disposed) throw new Error('该文件会话已关闭。');
      if (!allowed) { overlay.updateStatus('仅本地预览和你输入的数学条件；没有采集或上传视频。'); return false; }
      if (!current()) throw new Error('请回到当前文件后再开启。');
      stop('开始本次画面分析；原文件只在本机解码，模型配置由本机服务提供。');
      const owner = epoch;
      const beginController = new AbortController(); controllers.add(beginController);
      try {
        const response = await fetch('/api/vision/session', { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: source.id }),
          signal: AbortSignal.any([beginController.signal, AbortSignal.timeout(10000)]) });
        const reply = await response.json();
        if (!response.ok || typeof reply.token !== 'string') throw new Error(reply.error || '无法开启分析会话。');
        if (disposed || owner !== epoch || !current()) {
          void fetch('/api/vision/session/end', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: reply.token }), keepalive: true }).catch(() => {});
          return false;
        }
        sessionToken = reply.token; enabled = true;
        startedAt = Date.now(); readCalls = 0; summaryCalls = 0; overlay.setRecognitionState(true); loop.start(); return true;
      } catch (error) { if (owner === epoch) stop(error.message || '无法开启会话。'); return false; }
      finally { controllers.delete(beginController); }
    }
    function destroy() { if (disposed) return; stop(); disposed = true; listeners.forEach((off) => off()); overlay.destroy(); }
    listen(video, 'seeking', () => stop('已定位到另一时间，旧帧分析清空；可重新开启。'));
    listen(video, 'emptied', destroy); listen(window, 'pagehide', destroy);
    listen(document, 'visibilitychange', () => { if (document.hidden) stop('页面隐藏，画面和总结处理已停止。'); });
    overlay.updateStatus(allowed ? '获准自制素材：点击开始后仅发送当前代表帧。模型留空时会显示未配置。'
      : '文件只在本机预览。你可以输入通用数学条件；没有启用AI或读取音轨。');
    return { start, stop, destroy };
  }
  bg.webVisual = { createSession };
})(globalThis);
