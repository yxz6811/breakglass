(function (root) {
  const bg = root.BreakGlass;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function createSession({ video, source: inputSource, cssText, onSave, manualOnly = false, deferOverlay = false }) {
    const checked = bg.pluginContracts.validateSource(inputSource);
    if (!checked.ok) throw new Error(checked.message);
    const allowed = !manualOnly && checked.value.kind === 'local-file' && checked.value.materialMode !== 'permission-pending';
    const source = allowed ? checked.value : { kind: 'manual-notes', id: `manual-${checked.value.id}`,
      version: '1', analysisVersion: '1', materialMode: 'self-authored', title: '我输入的数学条件' };
    const media = video.currentSrc || video.src;
    let epoch = 0; let disposed = false; let summaryController = null; let sessionToken = null; let enabled = false;
    let points = []; let observations = []; let revision = 0; let summarizedRevision = 0;
    let readCalls = 0; let summaryCalls = 0; let startedAt = 0; let preparing = null; let reading = null; let starting = null;
    const controllers = new Set(); const listeners = [];
    const current = () => !disposed && video.isConnected && (video.currentSrc || video.src) === media && !document.hidden;
    const listen = (target, event, listener) => { target.addEventListener(event, listener); listeners.push(() => target.removeEventListener(event, listener)); };
    function stop(reason = '分析已停止，未保存的视觉观察已清空。') {
      epoch += 1; enabled = false; preparing = null; reading = null; starting = null; loop.stop();
      const oldToken = sessionToken; sessionToken = null;
      if (oldToken) void fetch('/api/vision/session/end', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: oldToken }), keepalive: true }).catch(() => {});
      controllers.forEach((controller) => controller.abort()); controllers.clear();
      summaryController = null; points = []; observations = []; revision = 0; summarizedRevision = 0;
      overlay.updatePoints([]); overlay.updateSummary(null); overlay.setRecognitionState(false); overlay.updateStatus(reason);
    }
    function abortable(promise, signal) {
      if (signal.aborted) return Promise.reject(new Error('识别已取消。'));
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('识别已取消。'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    }
    async function bodyJSON(response, signal) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; let text = '';
      try { for (;;) { const chunk = await abortable(reader.read(), signal); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 65536) throw new Error('分析响应过大。');
        text += decoder.decode(chunk.value, { stream: true }); }
        return JSON.parse(text + decoder.decode());
      } finally { void reader.cancel().catch(() => {}); }
    }
    async function request(path, body, signal) {
      const controller = new AbortController(); controllers.add(controller);
      const combined = AbortSignal.any([controller.signal, signal || new AbortController().signal, AbortSignal.timeout(25000)]);
      try {
        const response = await abortable(fetch(`/api/vision/${path}`, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-breakglass-visual-session': sessionToken }, body: JSON.stringify(body),
          signal: combined }), combined);
        const answer = await bodyJSON(response, combined);
        if (!response.ok) throw new Error(answer.error || '分析服务未就绪。');
        if (path === 'recognition') {
          const valid = bg.recognitionContracts.validateRecognitionResponse(answer, body);
          if (!valid.ok) throw new Error(valid.message); return valid.value;
        }
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
      if (reading) throw new Error('当前画面识别正在处理，请稍后再试。');
      if (readCalls >= 32) throw new Error('本次画面分析额度已到。');
      readCalls += 1; const owner = epoch; const slot = {}; reading = slot;
      try {
        const answer = await request('read', { ...metadata(), frameTime: frame.frameTime, image: frame.image }, signal);
        if (owner !== epoch || !current() || signal.aborted || answer.frameTime !== frame.frameTime) throw new Error('已丢弃过期画面结果。');
        return { ok: true, payload: answer };
      } finally { if (reading === slot) reading = null; }
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
    let actualOverlay = null;
    function ensureOverlay() {
      if (actualOverlay) return;
      actualOverlay = bg.pluginOverlay.createLearningOverlay({ video, source, cssText, points: [], onSave,
      saveNoteLabel: '我的疑问或易错提醒',
      mount: video.parentElement.parentElement,
      onToggleRecognition: allowed ? () => loop.isRunning() ? stop() : start() : undefined,
      onClose: () => destroy() });
    }
    const overlay = Object.fromEntries(['updatePoints','updateSummary','updateStatus','setRecognitionState','destroy']
      .map(method => [method, (...args) => actualOverlay?.[method](...args)]));
    if (!deferOverlay) ensureOverlay();
    async function prepare() {
      if (disposed) throw new Error('该文件会话已关闭。');
      if (!allowed) { overlay.updateStatus('仅本地预览和你输入的数学条件；没有采集或上传视频。'); return false; }
      if (!current()) throw new Error('请回到当前文件后再开启。');
      if (sessionToken) return true;
      if (preparing) return preparing;
      const owner = epoch;
      const beginController = new AbortController(); controllers.add(beginController);
      const beginSignal = AbortSignal.any([beginController.signal, AbortSignal.timeout(10000)]);
      let transport;
      const pending = (async () => {
        try {
          transport = fetch('/api/vision/session', { method: 'POST', credentials: 'same-origin', redirect: 'error',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: source.id,
              ...(bg.recognitionContracts ? { capability: 'recognition-v1' } : {}) }),
            signal: beginSignal });
          const response = await abortable(transport, beginSignal);
          const reply = await bodyJSON(response, beginSignal.aborted ? AbortSignal.timeout(1000) : beginSignal);
          if (!response.ok || typeof reply.token !== 'string') throw new Error(reply.error || '无法开启分析会话。');
          if (disposed || owner !== epoch || !current() || beginSignal.aborted) {
            void fetch('/api/vision/session/end', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: reply.token }), keepalive: true }).catch(() => {});
            return false;
          }
          sessionToken = reply.token; startedAt = Date.now(); readCalls = 0; summaryCalls = 0; return true;
        } catch (error) {
          if (beginSignal.aborted && transport) void transport.then(async response => {
            if (response.bodyUsed) return;
            const late = await bodyJSON(response, AbortSignal.timeout(1000));
            if (typeof late.token === 'string') void fetch('/api/vision/session/end', {method:'POST', credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token:late.token}),keepalive:true}).catch(()=>{});
          }).catch(()=>{});
          if (owner === epoch) stop(error.message || '无法开启会话。'); return false;
        }
        finally { controllers.delete(beginController); if (preparing === pending) preparing = null; }
      })();
      preparing = pending; return pending;
    }
    async function start() {
      if (preparing && starting) stop('重新开始本次画面分析。');
      const owner = epoch; const slot = {}; starting = slot;
      try {
        if (!await prepare() || owner !== epoch || !current() || !sessionToken) return false;
        ensureOverlay(); enabled = true; overlay.setRecognitionState(true); loop.start(); return true;
      } finally { if (starting === slot) starting = null; }
    }
    async function recognize({ kind, frameSize }, signal) {
      if (!bg.recognitionContracts || !allowed || !current() || !sessionToken) throw new Error('请先主动准备获准素材的识别会话。');
      if (reading) throw new Error('当前画面识别正在处理，请稍后再试。');
      if (readCalls >= 32 || Date.now() - startedAt >= 30 * 60 * 1000) throw new Error('本次画面分析额度或时长已到。');
      if (!['parabola', 'right-triangle'].includes(kind)) throw new Error('当前只支持抛物线和直角三角形。');
      const owner = epoch; const controller = new AbortController(); controllers.add(controller); const slot = {}; reading = slot;
      const combined = AbortSignal.any([controller.signal, signal || new AbortController().signal, AbortSignal.timeout(25000)]);
      const valid = () => current() && owner === epoch && !combined.aborted && Boolean(sessionToken);
      try {
        const frame = await abortable(bg.frameSampling.capture(video, combined, valid), combined);
        if (!frame || !valid()) throw new Error('当前画面不能采集或已经改变。');
        const body = { ...metadata(), schemaVersion: '011.1', kind, frameTime: frame.frameTime, frameSize, image: frame.image };
        const checked = bg.recognitionContracts.validateRecognitionRequest(body);
        if (!checked.ok) throw new Error(checked.message);
        readCalls += 1;
        const answer = await request('recognition', body, combined);
        if (!valid()) throw new Error('已丢弃过期画面结果。');
        return answer;
      } finally { controllers.delete(controller); if (reading === slot) reading = null; }
    }
    function destroy() { if (disposed) return; stop(); disposed = true; listeners.forEach((off) => off()); overlay.destroy(); }
    listen(video, 'seeking', () => stop('已定位到另一时间，旧帧分析清空；可重新开启。'));
    listen(video, 'emptied', destroy); listen(window, 'pagehide', destroy);
    listen(document, 'visibilitychange', () => { if (document.hidden) stop('页面隐藏，画面和总结处理已停止。'); });
    overlay.updateStatus(allowed ? '获准自制素材：点击开始后仅发送当前代表帧。模型留空时会显示未配置。'
      : '文件只在本机预览。你可以输入通用数学条件；没有启用AI或读取音轨。');
    function showPreparedContext(value) {
      if (!allowed || !current() || value?.status !== 'context' || value.sourceId !== source.id
        || value.videoVersion !== source.version || value.analysisVersion !== source.analysisVersion
        || !Array.isArray(value.objects)) throw new Error('片段来源已改变。');
      stop(); ensureOverlay();
      const prepared = value.objects.flatMap(({ frameTime, result }) => {
        const candidate = bg.pluginContracts.validateVisualResult(result); if (!candidate.ok) throw new Error(candidate.message);
        const end = Math.min(video.duration, frameTime + 2); if (end <= frameTime) return [];
        return [{ id: `context-${crypto.randomUUID()}`, start: frameTime, end, area: candidate.value.area,
          title: candidate.value.title, explanation: `${candidate.value.explanation}\n常见误区：${candidate.value.pitfallHint || '暂无提醒，不能据此判定学生出错。'}`,
          template: candidate.value.template, snapshot: candidate.value.snapshot, origin: 'vision',
          sourceLabel: value.coverage?.inputTypes?.includes('subtitle') ? 'AI片段候选（稀疏画面＋作者字幕）' : 'AI片段候选（稀疏画面）' }];
      });
      const valid = bg.pluginContracts.validatePoints(prepared, { duration: video.duration, source });
      if (!valid.ok) throw new Error(valid.message);
      points = valid.value; overlay.updatePoints(points); overlay.updateSummary(value);
      overlay.updateStatus('片段候选已载入；当前帧热点可点击，数学条件仍须人工确认。未处理音频。');
    }
    return { prepare, recognize, start, stop, destroy, showPreparedContext, snapshot: () => ({ readCalls, summaryCalls, running: loop.isRunning() }) };
  }
  bg.webVisual = { createSession };
})(globalThis);
