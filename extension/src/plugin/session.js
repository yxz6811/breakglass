(function (root) {
  root.BreakGlass = root.BreakGlass || {};
  // executeScript can run this file again on another action click. Keep the same
  // lifecycle owner so start() can cancel and destroy the existing session.
  if (root.BreakGlass.pluginSession) return;
  let active = null;
  const send = (message) => chrome.runtime.sendMessage(message);
  function start({ cssText, lessons }) {
    if (active) active.destroy();
    const video = document.querySelector('video');
    const lesson = lessons.find((item) => video?.currentSrc === `${location.origin}${item.path}`);
    if (!video || !lesson || !Number.isFinite(video.duration) || Math.abs(video.duration - lesson.duration) > 0.2) {
      throw new Error('请先加载已登记的自制教学视频。');
    }
    const source = { kind: 'visual-session', id: lesson.id, version: '1', analysisVersion: '1',
      title: lesson.title, materialMode: 'self-authored' };
    const media = video.currentSrc;
    const bg = root.BreakGlass;
    let token = null;
    let epoch = 0;
    let disposed = false;
    let summaryBusy = false;
    let summaryQueuedAt = 0;
    let observationRevision = 0;
    let points = [];
    let observations = [];
    const listeners = [];
    const listen = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
    const status = (message) => overlay.updateStatus(message);
    function stop(reason = '视觉识别已停止；未保存的画面和观察已清除。') {
      epoch += 1;
      loop.stop();
      const oldToken = token;
      token = null;
      summaryBusy = false;
      points = []; observations = []; observationRevision += 1; summaryQueuedAt = 0;
      overlay.updatePoints([]);
      overlay.updateSummary?.(null);
      overlay.setRecognitionState?.(false);
      status(reason);
      if (oldToken) void send({ type: 'plugin:end', token: oldToken }).catch(() => {});
    }
    function sameMedia() { return !disposed && video.isConnected && video.currentSrc === media
      && location.pathname === '/learning-lab/lesson.html' && !document.hidden; }
    async function capture(signal) {
      if (signal.aborted || !sameMedia()) { stop('页面或视频已变化，视觉会话停止。'); return null; }
      return bg.frameSampling.capture(video, signal, sameMedia);
    }
    function validateSummary(answer, times) {
      const text = (value, max) => typeof value === 'string' && value.length <= max;
      const expectedTimes = [...new Set(times)].sort((a, b) => a - b);
      return answer?.status === 'summary' && text(answer.summary, 2000)
        && ['keyPoints', 'pitfalls'].every((key) => Array.isArray(answer[key]) && answer[key].length <= 8 && answer[key].every((s) => text(s, 500)))
        && Array.isArray(answer.observedTimes) && answer.observedTimes.length === expectedTimes.length
        && answer.observedTimes.every((time, i) => Number.isFinite(time) && time === expectedTimes[i]);
    }
    async function summarize(owner) {
      if (summaryBusy || observations.length < 1 || !token
        || (summaryQueuedAt > 0 && observationRevision - summaryQueuedAt < 3)) return;
      summaryBusy = true;
      summaryQueuedAt = observationRevision;
      const usedRevision = observationRevision;
      const input = observations.slice(-20).map((item) => ({ ...item }));
      try {
        const reply = await send({ type: 'plugin:summary', token, observations: input });
        if (disposed || owner !== epoch || !sameMedia() || usedRevision > observationRevision) return;
        if (!reply?.ok) throw new Error(reply?.message || '后台总结失败。');
        if (!validateSummary(reply.payload, input.map((item) => item.frameTime))) throw new Error('总结覆盖范围或结构不符。');
        overlay.updateSummary(reply.payload);
      } catch (error) {
        if (!disposed && owner === epoch) status(`视觉识别继续；${error.message}`);
      } finally {
        if (owner === epoch) {
          summaryBusy = false;
          // Only fresh observations trigger another summary; a failure is not retried.
          if (observationRevision - summaryQueuedAt >= 3) void summarize(owner);
        }
      }
    }
    const loop = bg.pluginLoop.createVisualLoop({ capture, onStatus: (message) => {
      status(message);
      queueMicrotask(() => { if (!loop.isRunning() && token) stop(message); });
    }, read: async (frame, signal) => {
      const owner = epoch;
      const reply = await send({ type: 'plugin:read', token, frameTime: frame.frameTime, image: frame.image });
      if (signal.aborted || owner !== epoch || !sameMedia()) throw new Error('已丢弃过期识别。');
      return reply;
    }, onResult: (reply, frame) => {
      const answer = reply.payload;
      if (answer.status !== 'candidate') { status(answer.status === 'needs_review' ? '条件不完整，请人工补充。' : '这一帧未找到支持的数学对象。'); return; }
      const checked = bg.pluginContracts.validateVisualResult(answer.result);
      if (!checked.ok) throw new Error(checked.message);
      const result = checked.value;
      const end = Math.min(video.duration, frame.frameTime + 2);
      if (end <= frame.frameTime) return;
      const point = { id: `vision-${crypto.randomUUID()}`, start: frame.frameTime, end,
        area: result.area, title: result.title, explanation: `${result.explanation}\n常见误区提示：${result.pitfallHint || '暂无；不代表学生已经出错。'}`,
        template: result.template, snapshot: result.snapshot, origin: 'vision', sourceLabel: 'AI视觉识别' };
      const checkedPoints = bg.pluginContracts.validatePoints([point], { duration: video.duration, source });
      if (!checkedPoints.ok) throw new Error(checkedPoints.message);
      points = [...points, checkedPoints.value[0]].slice(-32);
      overlay.updatePoints(points);
      const observation = { frameTime: frame.frameTime, title: result.title, explanation: result.explanation,
        pitfallHint: result.pitfallHint, template: result.template };
      // Repeated semantic content adds no new model-summary job.
      const prior = observations[observations.length - 1];
      if (!prior || JSON.stringify({ ...prior, frameTime: 0 }) !== JSON.stringify({ ...observation, frameTime: 0 })) {
        observations = [...observations, observation].slice(-20); observationRevision += 1;
      }
      status(`第 ${frame.frameTime.toFixed(1)} 秒已有 AI 候选；仅分析画面，条件需要核对。`);
      void summarize(epoch);
    } });
    const overlay = bg.pluginOverlay.createLearningOverlay({ video, source, cssText, points: [],
      onToggleRecognition: async () => {
        if (loop.isRunning()) { stop(); return; }
        if (!sameMedia()) { stop('当前画面已变化，请重新点击插件。'); return; }
        const owner = ++epoch;
        status('连接本机视觉服务；获准当前画面将送到配置的视觉模型，不包含音频。');
        const reply = await send({ type: 'plugin:begin', lessonId: lesson.id });
        if (disposed || owner !== epoch) { if (reply?.token) void send({ type: 'plugin:end', token: reply.token }); return; }
        if (!reply?.ok) { status(reply?.message || '无法开启。'); return; }
        token = reply.token;
        overlay.setRecognitionState?.(true);
        loop.start();
      },
      onSave: async (record) => {
        if (!token) throw new Error('请先开启本次视觉会话。');
        const reply = await send({ type: 'plugin:save', token, record });
        if (!reply?.ok) throw new Error(reply?.message || '保存失败。');
        return reply;
      }, onClose: () => destroy()
    });
    const onRevoked = (message, sender, respond) => {
      if (sender.id !== chrome.runtime.id || message?.type !== 'plugin:revoked'
        || !token || message.token !== token) return;
      stop('本机记录已清除，视觉会话与未保存的热点、观察和总结已停止并清空。');
      respond({ ok: true });
    };
    chrome.runtime.onMessage.addListener(onRevoked);
    listeners.push(() => chrome.runtime.onMessage.removeListener(onRevoked));
    function destroy() { if (disposed) return; stop(); disposed = true; listeners.forEach((off) => off()); overlay.destroy(); if (active?.destroy === destroy) active = null; }
    listen(document, 'visibilitychange', () => { if (document.hidden) stop('页面已隐藏，采集和后台总结已停止。回到视频后可重新开启。'); });
    listen(video, 'seeking', () => stop('视频已跳转，旧帧候选和在途总结已清除。可重新开启识别。'));
    listen(video, 'emptied', destroy);
    listen(window, 'pagehide', destroy);
    status('自制素材验证：点击开始持续识别。画面经本机 reader 送到其已配置模型；未配置时会显示失败。');
    active = { destroy };
    return { ok: true };
  }
  root.BreakGlass.pluginSession = { start };
})(globalThis);
