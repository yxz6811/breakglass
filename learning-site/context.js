(function (root) {
  'use strict';
  function createUI({ video, getSelection, getPolicy, beforeStart, onCandidate, onClear = () => {}, document: doc = document }) {
    const get = (id) => doc.getElementById(id);
    let generation = 0; let controller = null; let token = null; let disposed = false; let result = null;
    const say = (message) => { get('context-status').textContent = message; };
    async function end(oldToken) {
      if (oldToken) await fetch('/api/vision/session/end', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: oldToken }), keepalive: true }).catch(() => {});
    }
    function stop(message = '片段分析已停止，未保存的总结与候选已清除。') {
      generation += 1; if (controller) controller.abort(); controller = null;
      const old = token; token = null; void end(old); result = null;
      onClear();
      get('context-result').replaceChildren(); get('cancel-context').disabled = true; say(message);
    }
    function update() {
      const selected = getSelection(); const policy = getPolicy();
      get('analyze-context').disabled = !selected || !policy?.allowed || Boolean(controller);
      get('use-author-subtitles').disabled = !policy?.context;
      get('context-source').textContent = policy?.context?.title || '此素材没有登记作者字幕，当前仅分析稀疏画面。';
      if (selected && !controller) {
        get('context-start').max = String(selected.duration); get('context-end').max = String(selected.duration);
        get('context-start').value = '0'; get('context-end').value = String(Math.min(30, selected.duration));
      }
    }
    async function post(route, input, signal, sessionToken = token) {
      const response = await fetch('/api/vision/' + route, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'content-type': 'application/json', ...(sessionToken ? { 'x-breakglass-visual-session': sessionToken } : {}) },
        body: JSON.stringify(input), signal });
      const reader = response.body.getReader(); let size = 0; let text = ''; const decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 65536) throw new Error('片段响应超过上限。'); text += decoder.decode(chunk.value, { stream: true }); }
      } finally { await reader.cancel().catch(() => {}); }
      const value = JSON.parse(text + decoder.decode()); if (!response.ok) throw new Error(value.error || '片段服务尚未就绪。'); return value;
    }
    function render(value, capturedSource, owner) {
      const target = get('context-result'); target.replaceChildren();
      const append = (tag, text) => { const node = doc.createElement(tag); node.textContent = text; target.append(node); return node; };
      append('h4', 'AI片段候选总结 · 需校对'); append('p', value.summary);
      append('p', `实际观察 ${value.observedTimes.map((time) => time.toFixed(2) + '秒').join('、')}；${value.coverage.frameCount}张稀疏画面${value.coverage.inputTypes.includes('subtitle') ? '＋登记作者字幕' : ''}。未处理音频，不能代表完整课程。`);
      for (const [title, values] of [['知识点', value.keyPoints], ['常见误区提醒（非个人答错）', value.pitfalls]]) {
        if (!values.length) continue; append('h4', title); const list = append('ul', '');
        values.forEach((text) => { const item = doc.createElement('li'); item.textContent = text; list.append(item); });
      }
      value.objects.forEach((object) => {
        const button = append('button', `${object.frameTime.toFixed(2)}秒 · 校对“${object.result.title}”`); button.type = 'button';
        button.addEventListener('click', () => {
          if (disposed || generation !== owner || result !== value || getSelection()?.source.id !== capturedSource.id) return;
          const isCurrent = () => !disposed && generation === owner && result === value && !doc.hidden
            && getSelection()?.source.id === capturedSource.id;
          void onCandidate(object, value, isCurrent);
        });
      });
      if (!value.objects.length) append('p', '没有足够证据生成受支持的数学对象，保留视频与手工探索。');
    }
    async function start() {
      if (disposed || controller) return;
      const selected = getSelection(); const policy = getPolicy();
      if (!selected || !policy?.allowed) { say('素材处理许可未获登记，没有发送画面。'); return; }
      const start = get('context-start').valueAsNumber; const endTime = get('context-end').valueAsNumber;
      if (!Number.isFinite(start) || !Number.isFinite(endTime) || start < 0 || endTime <= start
        || endTime > selected.duration || endTime - start > 30) { say('请选择0到视频时长内、不超过30秒的有效片段。'); return; }
      beforeStart(); stop();
      const owner = generation; const source = { ...selected.source }; const media = video.currentSrc || video.src;
      const active = new AbortController(); controller = active; get('analyze-context').disabled = true; get('cancel-context').disabled = false;
      const current = () => !disposed && generation === owner && controller === active && !doc.hidden
        && video.isConnected && (video.currentSrc || video.src) === media && getSelection()?.source.id === source.id;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(25000)]);
      let createdToken = null;
      try {
        say('正在本地抽取4张代表帧；原播放器时间保持独立，没有上传整文件或音频。');
        const captured = await root.BreakGlass.videoContext.extractWindow(video, { start, end: endTime, maxFrames: 4, signal, isCurrent: current });
        if (!current()) return;
        const began = await post('session', { sourceId: source.id }, signal, null); createdToken = began.token;
        if (typeof createdToken !== 'string') throw new Error('分析会话无效。');
        if (!current()) return; token = createdToken;
        const input = { schemaVersion: '1', requestId: crypto.randomUUID(), sourceId: source.id,
          videoVersion: source.version, analysisVersion: source.analysisVersion, materialMode: source.materialMode,
          frames: captured.frames, contextSourceId: get('use-author-subtitles').checked && policy.context ? policy.context.id : null };
        say('正在分析获准稀疏画面与可选作者字幕；条件尚未确认。');
        const value = await post('context', input, signal);
        if (!current()) return;
        if (value.schemaVersion !== '1' || value.status !== 'context' || value.requestId !== input.requestId
          || value.sourceId !== source.id || value.videoVersion !== source.version || value.analysisVersion !== source.analysisVersion
          || value.contextSourceId !== input.contextSourceId || JSON.stringify(value.observedTimes) !== JSON.stringify(captured.frames.map((frame) => frame.frameTime))
          || !value.coverage || value.coverage.frameCount !== captured.frames.length
          || value.coverage.start !== captured.frames[0].frameTime || value.coverage.end !== captured.frames.at(-1).frameTime
          || !Array.isArray(value.coverage.inputTypes) || ![JSON.stringify(['frames']), ...(input.contextSourceId ? [JSON.stringify(['frames', 'subtitle'])] : [])].includes(JSON.stringify(value.coverage.inputTypes))
          || typeof value.summary !== 'string' || value.summary.length > 2000
          || ![value.keyPoints, value.pitfalls].every((items) => Array.isArray(items) && items.length <= 8 && items.every((text) => typeof text === 'string' && text.length <= 400))
          || !Array.isArray(value.objects) || value.objects.length > 8) throw new Error('片段响应身份或覆盖结构不匹配。');
        const times = new Set(value.observedTimes); const seen = new Set();
        value.objects.forEach((object) => {
          if (!times.has(object.frameTime) || seen.has(object.frameTime) || !root.BreakGlass.pluginContracts.validateVisualResult(object.result).ok) throw new Error('片段数学候选无效。');
          seen.add(object.frameTime);
        });
        result = value; render(value, source, owner); say('片段总结已返回；选取数学候选后仍须校对条件。没有自动保存到账号。');
      } catch (error) { if (generation === owner && !disposed) say(active.signal.aborted ? '片段分析已取消。' : `片段分析未完成：${error.message}。原视频与手工学习仍可用。`); }
      finally {
        if (token === createdToken) token = null; void end(createdToken);
        if (controller === active) { controller = null; get('analyze-context').disabled = !getPolicy()?.allowed; get('cancel-context').disabled = !result; }
      }
    }
    const hidden = () => { if (doc.hidden) stop('页面隐藏，片段分析与未保存结果已清除。'); };
    const cancel = () => stop();
    get('analyze-context').addEventListener('click', start); get('cancel-context').addEventListener('click', cancel); doc.addEventListener('visibilitychange', hidden);
    return { update, stop, destroy() { disposed = true; stop(); doc.removeEventListener('visibilitychange', hidden); get('analyze-context').removeEventListener('click', start); get('cancel-context').removeEventListener('click', cancel); } };
  }
  root.BreakGlass.webContext = { createUI };
})(globalThis);
