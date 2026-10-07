(function (root) {
  'use strict';
  function createUI({ mount, getSelection, getPolicy, beforeStart = () => {}, getOwner = () => '', document: doc = document }) {
    let generation = 0; let controller = null; let token = null; let disposed = false;
    const el = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
    const header = el('h3', '听懂这一小段 · 可选音轨转写');
    const description = el('p', '由服务器读取登记的自制视频，裁剪不超过30秒的音轨后发送转写服务。原视频不会上传；转写须校对，不自动变成数学条件。');
    const fields = el('div'); fields.className = 'field-grid';
    const start = el('input'); const end = el('input');
    [start, end].forEach((input) => { input.type = 'number'; input.min = '0'; input.step = '0.01'; });
    const a = el('label', '音轨起点（秒）'); a.append(start); const b = el('label', '音轨终点（秒）'); b.append(end); fields.append(a, b);
    const actions = el('div'); actions.className = 'actions';
    const begin = el('button', '转写这段音轨'); const cancel = el('button', '停止并清除转写');
    begin.type = cancel.type = 'button'; cancel.disabled = true; actions.append(begin, cancel);
    const status = el('p', '音轨工具及模型留空可配置。没有音轨或尚未配置时，会保留视频并说明原因。'); status.setAttribute('role', 'status');
    const result = el('div'); result.className = 'context-result';
    mount.append(header, description, fields, actions, status, result);
    async function post(route, value, signal) {
      const response = await fetch('/api/audio/' + route, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), signal });
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = ''; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 65536) throw new Error('音轨响应超过上限。'); text += decoder.decode(part.value, { stream: true }); } }
      finally { await reader.cancel().catch(() => {}); }
      const reply = JSON.parse(text + decoder.decode()); if (!response.ok) throw new Error(reply.error || '音轨服务失败。'); return reply;
    }
    const endToken = (old) => old && post('session/end', { token: old }).catch(() => {});
    function stop(message = '音轨处理已停止，未保存转写已清除。') {
      generation += 1; controller?.abort(); controller = null; const old = token; token = null;
      void endToken(old); result.replaceChildren(); cancel.disabled = true; status.textContent = message; update(false);
    }
    function update(reset = true) {
      const selected = getSelection(); const policy = getPolicy(); begin.disabled = !selected || !policy?.allowed || Boolean(controller) || disposed;
      if (selected && reset && !controller) { start.value = '0'; end.value = String(Math.min(30, selected.duration)); start.max = end.max = String(selected.duration); }
    }
    async function run() {
      if (disposed || controller) return;
      const selected = getSelection();
      if (!selected || !getPolicy()?.allowed) { status.textContent = '此素材没有登记音轨处理许可。'; return; }
      const from = start.valueAsNumber; const to = end.valueAsNumber;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > selected.duration || to - from > 30) { status.textContent = '请选择视频内不超过30秒的范围。'; return; }
      beforeStart(); stop();
      const owner = generation; const identity = getOwner(); const sourceId = selected.source.id;
      const active = new AbortController(); controller = active; begin.disabled = true; cancel.disabled = false;
      const current = () => !disposed && !doc.hidden && generation === owner && controller === active
        && getOwner() === identity && getSelection()?.source.id === sourceId;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(35000)]);
      let createdToken = null;
      try {
        status.textContent = '正在核对登记素材与音轨配置…';
        const created = await post('session', { sourceId }, signal); createdToken = created.token;
        if (!current()) { await endToken(createdToken); return; }
        token = createdToken; status.textContent = '正在处理这段音轨；可以随时停止。';
        const reply = await post('transcribe', { token, start: from, end: to }, signal);
        if (!current()) return;
        if (reply.schemaVersion !== '1' || reply.status !== 'transcript' || reply.sourceId !== sourceId
          || reply.videoVersion !== selected.source.version || reply.analysisVersion !== selected.source.analysisVersion
          || typeof reply.text !== 'string' || reply.text.length > 6000 || reply.coverage?.start !== from || reply.coverage?.end !== to
          || !Array.isArray(reply.limitations) || reply.limitations.some((value) => typeof value !== 'string' || value.length > 400)) throw new Error('转写响应不符合当前素材。');
        result.append(el('h4', 'AI短音轨转写候选 · 请校对'), el('p', reply.text),
          el('p', `范围 ${from.toFixed(2)}–${to.toFixed(2)}秒；实际音轨${reply.coverage.actualAudioSeconds.toFixed(2)}秒。`));
        reply.limitations.forEach((text) => result.append(el('p', text)));
        status.textContent = '短音轨转写已返回。它没有自动确认画面内容、数学条件或整课总结。';
      } catch (failure) { if (current()) status.textContent = failure.name === 'AbortError' || failure.name === 'TimeoutError' ? '音轨等待已停止，请明确重试。' : failure.message; }
      finally { if (controller === active) { controller = null; token = null; cancel.disabled = true; update(false); }
        await endToken(createdToken); }
    }
    begin.addEventListener('click', run); cancel.addEventListener('click', () => stop());
    const hidden = () => { if (doc.hidden) stop('页面隐藏，音轨处理已停止。'); };
    doc.addEventListener('visibilitychange', hidden);
    update();
    return { update, stop, destroy() { disposed = true; stop(); doc.removeEventListener('visibilitychange', hidden); begin.removeEventListener('click', run); mount.replaceChildren(); } };
  }
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.webAudio = { createUI };
})(typeof globalThis !== 'undefined' ? globalThis : this);
