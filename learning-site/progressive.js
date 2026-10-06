(function (root) {
  'use strict';
  const bg = root.BreakGlass;
  function createUI({ mount, video, getSelection, getPolicy, beforeStart = () => {}, onCandidate = () => {},
    onClear = () => {}, document: doc = document }) {
    let disposed = false; let generation = 0; let active = null; let token = null; let running = false; let clearing = false;
    let state = 'idle'; let plan = []; let results = new Map(); let selectedSource = null; let selectedMedia = null;
    const node = (tag, text = '') => { const item = doc.createElement(tag); item.textContent = text; return item; };
    const heading = node('h3', '分段分析 · 当前片段优先');
    const note = node('p', '显式开始后，每段最多30秒、4张稀疏画面；最多处理10分钟文件。结果逐段就绪，未处理音频，也不代表完整课程理解。');
    const controls = node('div'); controls.className = 'actions';
    const startButton = node('button', '开始分段分析'); const pauseButton = node('button', '暂停');
    const resumeButton = node('button', '继续 / 重试未完成片段'); const cancelButton = node('button', '取消并清除暂存');
    const clearButton = node('button', '清除当前账户 / 访客分析缓存');
    for (const item of [startButton, pauseButton, resumeButton, cancelButton, clearButton]) item.type = 'button';
    controls.append(startButton, pauseButton, resumeButton, cancelButton, clearButton);
    const subtitleLabel = node('label'); const subtitles = doc.createElement('input'); subtitles.type = 'checkbox'; subtitles.checked = true;
    subtitleLabel.append(subtitles, node('span', '使用已登记作者字幕（不等于音轨识别）'));
    const status = node('p', '尚未开始，没有发送画面。'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const coverage = node('p'); const list = node('div'); list.className = 'progressive-results';
    mount.append(heading, note, controls, subtitleLabel, status, coverage, list);
    const say = (text) => { status.textContent = text; };
    function updateButtons() {
      startButton.disabled = disposed || running || clearing || !getSelection() || !getPolicy()?.allowed;
      pauseButton.disabled = state !== 'running';
      resumeButton.disabled = disposed || running || !token || !['paused', 'failed'].includes(state);
      cancelButton.disabled = !token && !results.size && !running;
      subtitles.disabled = running || Boolean(token) || !getPolicy()?.context;
      clearButton.disabled = disposed || running || clearing;
    }
    function validSource() {
      const selected = getSelection();
      return !disposed && !doc.hidden && video.isConnected && getPolicy()?.allowed
        && selected && selected.source.id === selectedSource?.id && selected.source.version === selectedSource?.version
        && selected.source.analysisVersion === selectedSource?.analysisVersion && (video.currentSrc || video.src) === selectedMedia;
    }
    const accepted = (window) => results.get(window.id);
    function render() {
      list.replaceChildren();
      const completed = plan.filter((window) => accepted(window));
      const missing = plan.filter((window) => !accepted(window));
      coverage.textContent = plan.length ? `已分析 ${completed.length}/${plan.length} 个片段。未分析时间窗：${missing.length
        ? missing.map((window) => `${window.start.toFixed(1)}–${window.end.toFixed(1)}秒`).join('、') : '无'}。每段只观察所列稀疏帧，片段区间完成不等于连续覆盖。` : '';
      const renderOwner = generation;
      for (const window of plan) {
        const box = node('section'); box.className = 'progressive-window';
        box.append(node('h4', `${window.start.toFixed(1)}–${window.end.toFixed(1)}秒 · ${accepted(window) ? '结果已就绪' : '未分析 / 覆盖缺口'}`));
        const value = accepted(window);
        if (value) {
          box.append(node('p', value.cache.hit ? `来自前次AI分析 · ${new Date(value.cache.createdAt).toLocaleString()}` : '本次AI片段候选 · 需校对'));
          box.append(node('p', value.summary));
          box.append(node('p', `实际观察：${value.observedTimes.map((time) => `${time.toFixed(2)}秒`).join('、')}；${value.coverage.frameCount}张画面${value.coverage.inputTypes.includes('subtitle') ? '＋登记作者字幕' : ''}。${value.limitations}`));
          for (const [title, values] of [['知识点', value.keyPoints], ['常见误区提醒（非个人答错）', value.pitfalls]]) {
            if (!values.length) continue;
            box.append(node('h5', title)); const items = node('ul'); values.forEach((text) => items.append(node('li', text))); box.append(items);
          }
          for (const object of value.objects) {
            const button = node('button', `${object.frameTime.toFixed(2)}秒 · 校对“${object.result.title}”`); button.type = 'button';
            button.addEventListener('click', () => {
              const current = () => renderOwner === generation && validSource() && results.get(window.id) === value;
              if (current()) void onCandidate(object, value, current);
            }); box.append(button);
          }
          if (!value.objects.length) box.append(node('p', '没有受支持的数学候选，视频与手工探索仍可用。'));
        }
        list.append(box);
      }
      updateButtons();
    }
    async function post(route, input, signal, sessionToken = token) {
      const response = await fetch('/api/vision/' + route, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'content-type': 'application/json', ...(sessionToken ? { 'x-breakglass-visual-session': sessionToken } : {}) },
        body: JSON.stringify(input), signal });
      const reader = response.body.getReader(); let size = 0; let text = ''; const decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 65536) throw new Error('片段响应超过上限。'); text += decoder.decode(chunk.value, { stream: true }); }
      } finally { await reader.cancel().catch(() => {}); }
      const value = JSON.parse(text + decoder.decode()); if (!response.ok) throw new Error(value.error || '本次片段分析未完成。'); return value;
    }
    async function end(oldToken) {
      if (!oldToken) return;
      await fetch('/api/vision/session/end', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: typeof oldToken === 'string' ? oldToken : oldToken.id }), keepalive: true }).catch(() => {});
    }
    function stop(message = '分段任务已取消，未保存结果已清除。私有分析缓存可单独清除。') {
      generation += 1; active?.abort(); active = null; const old = token; token = null; void end(old);
      state = 'idle'; plan = []; results.clear(); selectedSource = null; selectedMedia = null; onClear(); render(); say(message);
    }
    function pause() {
      if (state !== 'running') return;
      generation += 1; active?.abort(); state = 'paused'; render();
      say('任务已暂停；已就绪片段仍可校对。点击继续后才发送未完成片段，不自动重试。');
    }
    async function process() {
      if (running || clearing || !token || !validSource()) return;
      const owner = generation; const source = { ...selectedSource }; const controller = new AbortController(); active = controller;
      running = true; state = 'running'; updateButtons();
      const current = () => owner === generation && active === controller && state === 'running' && validSource();
      try {
        for (const window of plan) {
          if (results.has(window.id)) continue;
          if (!current()) return;
          say(`正在分析 ${window.start.toFixed(1)}–${window.end.toFixed(1)}秒；已完成片段可以立即校对。`);
          // Separate decoder: the student's player is neither sought nor paused by preprocessing.
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
          const captured = await bg.videoContext.extractWindow(video, { start: window.start, end: window.end,
            maxFrames: 4, signal, isCurrent: current });
          if (!current()) return;
          const input = { schemaVersion: '1', requestId: crypto.randomUUID(), sourceId: source.id,
            videoVersion: source.version, analysisVersion: source.analysisVersion, materialMode: source.materialMode,
            frames: captured.frames, contextSourceId: token.contextSourceId, windowId: window.id };
          const value = await post('progressive/context', input, signal, token.id);
          if (!current()) return;
          if (!bg.analysisCache.validContext(value, input, bg.pluginContracts.validateVisualResult)
            || !value.cache || typeof value.cache.hit !== 'boolean' || typeof value.cache.stored !== 'boolean'
            || !Number.isSafeInteger(value.cache.createdAt) || value.cache.createdAt <= 0
            || value.cache.origin !== 'AI片段候选' || (value.cache.hit && value.cache.label !== '来自前次AI分析')) {
            throw new Error('片段身份、数学候选或缓存来源不匹配。');
          }
          results.set(window.id, value); render();
        }
        if (current()) { state = 'complete'; say('本任务片段已逐段处理。每段仍是稀疏视觉候选，不能代表听懂完整课程。'); }
      } catch (error) {
        if (owner === generation && !disposed) { state = 'failed'; say(`分段处理停在未完成片段：${error.message}。已有结果保留，点击继续后才重试。`); }
      } finally {
        if (active === controller) active = null; running = false; render();
      }
    }
    async function start() {
      if (disposed || running || clearing || !getSelection() || !getPolicy()?.allowed) return;
      beforeStart(); stop();
      const selected = getSelection(); const policy = getPolicy(); if (!selected || !policy?.allowed) return;
      const source = { ...selected.source }; const media = video.currentSrc || video.src;
      selectedSource = source; selectedMedia = media; const owner = generation; const controller = new AbortController(); active = controller;
      running = true; state = 'running'; updateButtons(); let createdToken;
      try {
        say('正在核对素材、账户与本次分段预算；还没有发送画面。');
        const contextSourceId = subtitles.checked && policy.context ? policy.context.id : null;
        const began = await post('progressive/session', { sourceId: source.id, contextSourceId,
          currentTime: Math.max(0, Math.min(selected.duration, video.currentTime || 0)), maxFrames: 4 },
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), null);
        createdToken = began.token;
        if (typeof createdToken !== 'string') throw new Error('渐进任务身份无效。');
        if (owner !== generation || !validSource()) { void end(createdToken); return; }
        const expected = bg.analysisCache.plan(selected.duration, Math.max(0, Math.min(selected.duration, video.currentTime || 0)), 4);
        // Priority may move while the session is opening; require the complete frozen set rather than its order.
        if (!Array.isArray(began.plan) || began.plan.length > 20 || began.plan.length !== expected.length
          || [...began.plan].sort((a, b) => a.start - b.start).some((window, index) => {
            const match = [...expected].sort((a, b) => a.start - b.start)[index];
            return window.id !== match.id || Math.abs(window.start - match.start) > 0.05 || Math.abs(window.end - match.end) > 0.05
              || !Array.isArray(window.times) || window.times.length !== match.times.length
              || window.times.some((time, frame) => !Number.isFinite(time) || Math.abs(time - match.times[frame]) > 0.05);
          })) {
          throw new Error('渐进时间窗计划超出冻结范围。');
        }
        plan = began.plan; token = { id: createdToken, contextSourceId }; state = 'paused'; render();
      } catch (error) {
        if (createdToken && token?.id !== createdToken) void end(createdToken);
        if (owner === generation && !disposed) { state = 'failed'; say(`任务未开启：${error.message}。没有自动调用模型。`); }
      } finally { if (active === controller) active = null; running = false; updateButtons(); }
      if (owner === generation && token && validSource()) await process();
    }
    async function clearCache() {
      if (disposed || running || clearing) return;
      stop('正在清除当前私有分析缓存…'); const owner = generation; clearing = true; updateButtons();
      try { await post('cache/clear', {}, AbortSignal.timeout(10000), null);
        if (generation === owner && !disposed) say('当前账户或本机访客分析缓存已由服务清除；学习记录保留。');
      } catch (error) { if (generation === owner && !disposed) say(`缓存清除未确认：${error.message}`); }
      finally { clearing = false; updateButtons(); }
    }
    async function clearGuestCache() {
      if (disposed) throw new Error('当前学习页面已关闭。');
      if (clearing) throw new Error('上一轮缓存清除尚未确认。');
      stop('正在清除这台浏览器的访客分析缓存…'); const owner = generation; clearing = true; updateButtons();
      try {
        await post('cache/clear-guest', {}, AbortSignal.timeout(10000), null);
        if (generation === owner && !disposed) say('这台浏览器的访客分析缓存已清除；账户缓存与记录保留。');
      } catch (error) {
        if (generation === owner && !disposed) say(`访客缓存清除未确认：${error.message}`);
        throw error;
      } finally { clearing = false; updateButtons(); }
    }
    const cancel = () => stop(); const resume = () => { if (!running && ['paused', 'failed'].includes(state)) return process(); };
    const hidden = () => { if (doc.hidden) stop('页面隐藏，分段分析已取消，暂存结果已清除。'); };
    startButton.addEventListener('click', start); pauseButton.addEventListener('click', pause); resumeButton.addEventListener('click', resume);
    cancelButton.addEventListener('click', cancel); clearButton.addEventListener('click', clearCache); doc.addEventListener('visibilitychange', hidden);
    updateButtons();
    return { update: updateButtons, stop, start, pause, resume, clearCache, clearGuestCache,
      snapshot: () => ({ state, running, windows: plan.length, completed: results.size, missing: plan.filter((window) => !results.has(window.id)).map((window) => window.id) }),
      destroy() { disposed = true; stop(); doc.removeEventListener('visibilitychange', hidden);
        startButton.removeEventListener('click', start); pauseButton.removeEventListener('click', pause); resumeButton.removeEventListener('click', resume);
        cancelButton.removeEventListener('click', cancel); clearButton.removeEventListener('click', clearCache); mount.replaceChildren(); } };
  }
  bg.progressive = { createUI };
})(globalThis);
