(function (root) {
  'use strict';
  const bg = root.BreakGlass;
  const $ = (id) => document.getElementById(id);
  const records = bg.webRecords;
  const store = records.createLocalStore(localStorage);
  const video = $('learning-video');
  let view = 'overview';
  let accountOwner = '';
  let accountData = { records: [], attempts: [], watch: [] };
  let accountLoading = false;
  let accountLoaded = false;
  let accountLoadError = '';
  let loadEpoch = 0;
  let chosen = null;
  let policy = null;
  let policyController = null;
  let sampleController = null;
  let session = null;
  let cssPromise = null;
  let scene = null;
  let renderer = null;
  let hintLevel = 0;
  let answerViewed = false;
  let practiceEpoch = 0;
  let pluginPreview = [];
  let pluginImportEpoch = 0;
  let lastWatch = 0;
  let watchTracking = false;
  const selectedLocal = new Set();
  const client = bg.webAccount.createClient({ onChange: accountChanged });

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, fn) { const el = node('button', '', text); el.type = 'button'; el.addEventListener('click', fn); return el; }
  function message(id, value) { $(id).textContent = value; }
  function errorMessage(error) { return error && error.code === 'stale_session' ? '账户或学习数据状态已改变；旧操作已忽略。' : error.message || '操作失败，请重试。'; }
  function time(value) { return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`; }
  function date(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
  function activeData() { return $('record-scope').value === 'account' ? accountData : store.read(); }
  function sourceTitle(source) { return `${source.title || '保存的数学条件'} · ${source.id.slice(-8)}`; }
  function sameFile(source) { return Boolean(chosen && records.fileId(source) === chosen.source.id && source.version === chosen.source.version); }
  function stopSession() { if (session) { session.destroy(); session = null; } $('stop-analysis').disabled = true; }
  function closeScene() {
    practiceEpoch += 1;
    if (renderer) renderer.destroy();
    renderer = null; scene = null; $('scene-stage').replaceChildren(); $('scene-panel').hidden = true;
    $('practice-empty').hidden = view !== 'practice';
  }
  function switchView(next) {
    if (!['overview', 'watch', 'records', 'practice', 'import', 'account'].includes(next)) return;
    if (next !== 'import') stopSession();
    view = next;
    document.querySelectorAll('[data-page]').forEach((section) => {
      section.hidden = section.dataset.page !== next || (section.id === 'scene-panel' && !scene)
        || (section.id === 'practice-empty' && Boolean(scene));
    });
    document.querySelectorAll('.site-sidebar [data-view]').forEach((control) => {
      if (control.dataset.view === next) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current');
    });
    if (next === 'overview' || next === 'records' || next === 'watch') renderData();
  }

  function accountChanged(state) {
    const next = `${state.generation}:${state.user ? state.user.id : 'guest'}`;
    if (next !== accountOwner) {
      accountOwner = next; loadEpoch += 1; accountData = { records: [], attempts: [], watch: [] };
      accountLoaded = false; accountLoadError = '';
      watchTracking = false; video.pause();
      selectedLocal.clear(); stopSession(); closeScene();
      $('record-scope').value = state.user ? 'account' : 'local';
    }
    $('account-option').disabled = !state.user;
    accountLoading = Boolean(state.user);
    ['logout', 'clear-account-records', 'delete-account-data'].forEach((id) => { $(id).disabled = !state.user; });
    message('top-identity', state.user ? `${state.user.username} · 本机开发账户` : '本机访客 · 数据保存在这台浏览器');
    message('account-status', state.user ? `当前账户：${state.user.username}。本机记录不会自动导入。` : '当前未登录。可以继续本地学习与复练。');
    renderData();
    if (state.user) void loadAccountData();
  }
  async function loadAccountData() {
    const owner = client.snapshot();
    if (!owner.user) return;
    const serial = ++loadEpoch;
    accountLoading = true; accountLoadError = ''; renderData();
    message('center-status', '正在读取当前账户的记录、观看位置和真实复练结果…');
    const replies = await Promise.allSettled([client.records(), client.watch(), client.attempts()]);
    if (serial !== loadEpoch || owner.generation !== client.snapshot().generation) return;
    const failed = replies.find((reply) => reply.status === 'rejected');
    accountLoading = false;
    if (failed) { accountLoadError = errorMessage(failed.reason); renderData(); message('center-status', accountLoadError); return; }
    accountData = { records: replies[0].value.records, watch: replies[1].value.items, attempts: replies[2].value.attempts };
    accountLoaded = true;
    renderData(); message('center-status', `当前账户已读取 ${accountData.records.length} 条记录。`);
  }
  function mastery(record, attempts) {
    return records.learningState(record, attempts);
  }
  function renderDashboard(data) {
    const accountScope = $('record-scope').value === 'account';
    const pending = accountScope && !accountLoaded;
    message('overview-identity', accountScope && accountLoading ? '正在读取当前账户的真实记录…'
      : accountScope && accountLoadError ? `账户刷新未确认：${accountLoadError}${accountLoaded ? '；保留此前确认的数据。' : ''}`
        : `${accountScope ? '当前账户' : '本机访客'}的真实学习记录；没有记录时显示空态。`);
    const summary = $('dashboard-summary'); summary.replaceChildren();
    const actualWrong = records.filterRecords(data.records, data.attempts, { kind: 'wrong' }).length;
    [['保存的疑问', data.records.filter((r) => r.kind === 'question').length], ['个人易错标记', data.records.filter((r) => r.kind === 'pitfall').length],
      ['有答错证据的记录', actualWrong], ['记录的课程位置', data.watch.length]].forEach(([label, count]) => {
      const card = node('div', 'stat-card'); card.append(node('p', '', label), node('strong', '', pending ? '—' : String(count))); summary.append(card);
    });
    const counts = { '待验证': 0, '使用提示完成': 0, '最近一次独立正确': 0, '需要复练': 0 };
    data.records.forEach((record) => { counts[mastery(record, data.attempts)] += 1; });
    $('dashboard-states').replaceChildren();
    Object.entries(counts).forEach(([label, count]) => { const row = node('div', 'status-row'); row.append(node('span', '', label), node('strong', '', pending ? '待同步' : `${count} 条`)); $('dashboard-states').append(row); });
    const activity = $('dashboard-activity'); activity.replaceChildren();
    const recent = data.attempts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
    recent.forEach((attempt) => {
      const record = data.records.find((item) => item.id === attempt.recordId);
      const row = node('div', 'status-row'); row.append(node('span', '', record ? record.title : '复练记录'),
        node('span', 'muted', `${attempt.correct ? attempt.hintUsed ? '使用提示完成' : '独立答对' : '需要复练'} · ${date(attempt.createdAt)}`)); activity.append(row);
    });
    if (!recent.length) activity.append(node('p', 'muted', '还没有提交过复练答案。观看进度不会替代理解验证。'));
  }
  function renderData() {
    let data;
    try { data = activeData(); } catch (error) { message('center-status', errorMessage(error)); return; }
    renderDashboard(data);
    const sourceFilter = $('record-source');
    const previous = sourceFilter.value;
    sourceFilter.replaceChildren(); const all = node('option', '', '全部来源'); all.value = 'all'; sourceFilter.append(all);
    const sources = new Map(data.records.map((record) => [records.identity(record.source), record.source]));
    sources.forEach((source, key) => { const option = node('option', '', sourceTitle(source)); option.value = key; sourceFilter.append(option); });
    if (previous === 'all' || sources.has(previous)) sourceFilter.value = previous;
    const filtered = records.filterRecords(data.records, data.attempts, { kind: $('record-kind').value, source: sourceFilter.value });
    const list = $('record-list'); list.replaceChildren();
    if (!filtered.length) list.append(node('p', 'muted', '当前范围没有符合筛选的记录。先保存一个疑问或手工数学条件，再来回顾。'));
    const localScope = $('record-scope').value === 'local';
    filtered.forEach((record) => {
      const card = node('article', 'record-card');
      if (localScope && client.snapshot().user) {
        const label = node('label', 'record-select'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedLocal.has(record.id);
        checkbox.addEventListener('change', () => { checkbox.checked ? selectedLocal.add(record.id) : selectedLocal.delete(record.id); updateImportButton(); });
        label.append(checkbox, node('span', '', '选择导入当前账户')); card.append(label);
      }
      card.append(node('span', 'badge', record.kind === 'question' ? '疑问' : '个人易错标记'));
      if (data.attempts.some((item) => item.recordId === record.id && item.outcome === 'wrong' && item.correct === false)) card.append(node('span', 'badge wrong', '有实际答错证据'));
      card.append(node('h3', '', record.title), node('p', '', record.note), node('p', 'muted', `${sourceTitle(record.source)} · ${time(record.time)}`),
        node('p', 'muted', `${record.origin === 'vision' ? 'AI视觉来源，条件已由学生确认' : record.origin === 'author' ? '作者知识层（历史测试夹具）' : '手工数学条件，非AI识别'} · ${record.sourceLabel}`), node('p', 'muted', mastery(record, data.attempts)));
      const review = records.nextReview(data.attempts, record.id);
      if (review) card.append(node('p', 'muted', `建议复练：${date(review)}（可跳过；不是掌握保证）`));
      const actions = node('div', 'actions'); actions.append(button('恢复数学场景 / 复练', () => openScene(record, localScope ? 'local' : 'account')),
        button('删除这条记录', () => deleteRecord(record, localScope))); card.append(actions); list.append(card);
    });
    updateImportButton(); renderWatch(data.watch);
  }
  function updateImportButton() { $('import-selected').disabled = !client.snapshot().user || !selectedLocal.size || $('record-scope').value !== 'local'; }
  function renderWatch(items) {
    const list = $('watch-list'); list.replaceChildren();
    if (!items.length) list.append(node('p', 'muted', '还没有保存的观看位置。本地视频播放后可记录私有位置元数据；处理许可待确认不会开启AI，也不代表已掌握。'));
    items.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).forEach((item) => {
      const card = node('article', 'record-card'); card.append(node('h3', '', sourceTitle(item.source)),
        node('p', 'muted', `${time(item.time)} / ${time(item.duration)} · 仅代表观看位置`));
      const jump = button(sameFile(item.source) ? '定位已匹配视频' : '重新选择匹配文件', () => {
        switchView('import');
        if (sameFile(item.source)) { video.currentTime = Math.min(item.time, video.duration); video.focus(); }
        else { message('file-status', `请重新选择指纹结尾 ${item.source.id.slice(-8)} 的原文件；当前没有绑定视频。`); $('video-file').focus(); }
      }); card.append(jump); list.append(card);
    });
  }

  const importer = bg.webImport.createImporter({ video,
    onReset: () => {
      stopSession(); chosen = null; policy = null; lastWatch = 0; watchTracking = false;
      if (policyController) policyController.abort(); policyController = null;
      ['start-analysis', 'manual-explore', 'remove-file'].forEach((id) => { $(id).disabled = true; });
      message('file-details', ''); message('policy-status', '文件尚未就绪；没有发送材料。'); updateSceneBinding();
    },
    onChange: (value) => {
      message('file-status', value.message);
      $('remove-file').disabled = value.state === 'error';
      if (value.state === 'ready') {
        chosen = value.selected; $('manual-explore').disabled = false;
        message('file-details', `${chosen.name} · ${time(chosen.duration)} · ${chosen.width}×${chosen.height} · SHA-256 ${chosen.source.id.slice(-12)}`);
        updateSceneBinding(); void checkPolicy();
      }
    }
  });
  async function chooseFile(file) {
    if (sampleController) { sampleController.abort(); sampleController = null; }
    switchView('import');
    try { await importer.choose(file); } catch (_) { /* Importer reports its exact decode/limit error. */ }
  }
  async function checkPolicy() {
    if (!chosen) return;
    const owner = importer.epoch(); const sourceId = chosen.source.id;
    if (policyController) policyController.abort(); policyController = new AbortController();
    message('policy-status', '正在由服务端核对素材指纹与处理方式…');
    try {
      const response = await fetch(`/api/vision/policy?sourceId=${encodeURIComponent(sourceId)}`, { signal: policyController.signal, credentials: 'same-origin' });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.message || '素材处理状态无法读取。');
      if (owner !== importer.epoch() || !chosen || chosen.source.id !== sourceId) return;
      policy = reply;
      if (reply.allowed && reply.source && reply.source.kind === 'local-file' && reply.source.id === sourceId && reply.source.version === '1') {
        chosen.source = { ...reply.source }; $('start-analysis').disabled = false;
        message('policy-status', `素材已登记：${reply.reason || '当前获准私有学习分析'}。开始后仅按范围发送当前稀疏画面；没有整文件上传或跨用户共享。`);
      } else {
        policy.allowed = false; $('start-analysis').disabled = true;
        message('policy-status', `${reply.reason || '此文件尚未登记AI处理许可'}。保留本地预览与独立手工数学探索；学生勾选不能改变这个门禁。`);
      }
      message('model-status', reply.supplierConfigured
        ? '识别由服务端配置的视觉模型处理；实际识别状态见学习面板，网站不接收密钥。'
        : '模型留空未配置：AI请求会诚实返回未配置，仍可手工探索与复练。地址、模型和密钥只在服务端 .env 配置。');
    } catch (error) { if (error.name !== 'AbortError' && owner === importer.epoch()) message('policy-status', errorMessage(error)); }
  }
  function overlayCSS() {
    if (!cssPromise) cssPromise = Promise.all(['/extension/src/plugin/overlay.css', '/learning-site/learning-layer.css'].map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('无法加载网站学习层样式。'); return response.text();
    })).then((styles) => styles.join('\n')).catch((error) => { cssPromise = null; throw error; });
    return cssPromise;
  }
  async function openSession(manualOnly) {
    if (!chosen) return;
    if (!manualOnly && (!policy || !policy.allowed)) { message('session-status', '材料未获准，不发送画面。'); return; }
    stopSession();
    const owner = client.snapshot(); const importEpoch = importer.epoch(); const file = chosen.source.id;
    try {
      const cssText = await overlayCSS();
      if (!chosen || chosen.source.id !== file || importEpoch !== importer.epoch() || owner.generation !== client.snapshot().generation) return;
      const localEpoch = store.read().epoch;
      const next = bg.webVisual.createSession({ video, source: { ...chosen.source }, cssText, manualOnly,
        onSave: async (input) => {
          if (!chosen || chosen.source.id !== file || importer.epoch() !== importEpoch || owner.generation !== client.snapshot().generation) throw new Error('来源或账户已改变，旧记录不保存。');
          const record = records.validateRecord({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          if (owner.user) {
            await client.saveRecord(record);
            if (owner.generation !== client.snapshot().generation) throw new Error('账户已改变。');
            await loadAccountData(); return { ok: true, storage: 'account' };
          }
          store.save(record, localEpoch); renderData(); return { ok: true, storage: 'local' };
        }
      });
      session = next; $('stop-analysis').disabled = false;
      if (manualOnly) message('session-status', '独立手工条件模式：不分析原视频，不上传画面；输入和保存自己的数学条件。');
      else { await next.start(); message('session-status', '持续视觉识别操作已提交，请以学习面板的实际状态为准；失败不会替换成预设热点。'); }
    } catch (error) { message('session-status', errorMessage(error)); }
  }
  async function sample(path, name) {
    if (sampleController) sampleController.abort(); importer.reset();
    const controller = new AbortController(); sampleController = controller;
    message('file-status', '正在载入仓库自制教学素材；没有预设AI热点。'); $('remove-file').disabled = false;
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('自制素材载入失败。');
      const blob = await response.blob();
      if (sampleController !== controller || controller.signal.aborted) return;
      sampleController = null; await chooseFile(new File([blob], name, { type: 'video/mp4' }));
    } catch (error) { if (error.name !== 'AbortError') message('file-status', errorMessage(error)); }
  }
  async function saveWatch() {
    if (!chosen || !watchTracking || !Number.isFinite(video.currentTime)) return;
    const source = { ...chosen.source }; const owner = client.snapshot(); const importEpoch = importer.epoch();
    const input = { source, time: Math.min(video.currentTime, chosen.duration), duration: chosen.duration };
    try {
      if (owner.user) {
        await client.saveWatch(input);
        if (owner.generation !== client.snapshot().generation || importEpoch !== importer.epoch()) return;
        await loadAccountData();
      } else { store.saveWatch(input); renderData(); }
    } catch (error) { message('session-status', `观看位置尚未保存：${errorMessage(error)}`); }
  }

  async function deleteRecord(record, localScope) {
    const destination = localScope ? '本机' : '当前账户';
    if (!confirm(`删除${destination}这条记录及对应复练记录？`)) return;
    try {
      message('center-status', `正在删除${destination}记录…`);
      if (localScope) { store.remove(record.id); selectedLocal.delete(record.id); renderData(); }
      else { await client.deleteRecord(record.id); await loadAccountData(); }
      if (scene && scene.record.id === record.id) closeScene();
      message('center-status', `${destination}删除已确认。`);
    } catch (error) { message('center-status', `删除未确认：${errorMessage(error)}`); }
  }
  async function importSelected() {
    const user = client.snapshot().user;
    if (!user || !selectedLocal.size) return;
    const selection = store.read().records.filter((record) => selectedLocal.has(record.id));
    if (!confirm(`将选中的 ${selection.length} 条本机数学记录导入账户 ${user.username}？不包含原视频。`)) return;
    $('import-selected').disabled = true;
    let imported = 0;
    try {
      const owner = client.snapshot().generation;
      for (const record of selection) {
        if (owner !== client.snapshot().generation) throw new Error('账户已改变，剩余记录未导入。');
        await client.saveRecord(record); imported += 1;
      }
      selectedLocal.clear(); await loadAccountData(); message('center-status', `已由服务确认导入 ${imported} 条；本机原记录保留。`);
    } catch (error) { message('center-status', `已确认 ${imported} 条，其余未导入：${errorMessage(error)}`); }
    finally { updateImportButton(); }
  }
  function download(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = node('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportData() {
    try { download($('record-scope').value === 'account' ? await client.exportData() : store.read(), 'breakglass-learning.json'); message('data-status', '已生成当前范围的数据导出，不包含原视频或密钥。'); }
    catch (error) { message('data-status', errorMessage(error)); }
  }

  function updateSceneBinding() {
    if (!scene) return;
    const matches = sameFile(scene.record.source); $('scene-return').disabled = !matches;
    message('scene-context', matches
      ? '原文件完整指纹与版本已匹配。场景来自保存的数学条件，可显式定位原视频；参数探索不会自动改写记录。'
      : '无需原视频也能回顾这个数学场景。定位原视频须重新选择并匹配完整指纹与版本；当前未绑定任何视频。');
  }
  function renderSceneParameters(snapshot, template) {
    const fields = $('scene-parameters'); fields.replaceChildren();
    (template === 'parabola' ? ['a', 'h', 'k'] : ['AB', 'AC']).forEach((name) => {
      const label = node('label'); label.append(node('span', '', name)); const input = node('input'); input.type = 'number'; input.step = 'any'; input.value = String(snapshot[name]); input.dataset.parameter = name; label.append(input); fields.append(label);
    });
  }
  function drawMathSVG(template, snapshot) {
    const samples = bg.particles.sampleScene(template, snapshot);
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 640 360'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', template === 'parabola' ? '程序生成的二维抛物线主图' : '同一比例绘制的直角三角形主图');
    const bounds = samples.bounds;
    const scale = Math.max(1, Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY));
    const minX = bounds.minX / scale, maxX = bounds.maxX / scale, minY = bounds.minY / scale, maxY = bounds.maxY / scale;
    const factor = Math.min(560 / Math.max(maxX - minX, 0.001), 280 / Math.max(maxY - minY, 0.001));
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const coords = (point) => `${320 + (point.x / scale - centerX) * factor},${180 - (point.y / scale - centerY) * factor}`;
    function path(points, color, width = 2) {
      if (!points.length) return;
      const el = document.createElementNS(namespace, 'path'); el.setAttribute('d', points.map((point, i) => `${i ? 'L' : 'M'}${coords(point)}`).join(' '));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color); el.setAttribute('stroke-width', String(width)); svg.append(el);
    }
    path(samples.axes.slice(0, 2), '#a2adb3', 1); path(samples.axes.slice(2), '#a2adb3', 1);
    path(samples.outline, '#71ddff'); path(samples.rightAngle, '#ffd08a');
    const label = document.createElementNS(namespace, 'text'); label.setAttribute('x', '24'); label.setAttribute('y', '342'); label.setAttribute('fill', '#f2f5f7'); label.setAttribute('font-size', '13');
    const fmt = bg.geometryScene.formatLength;
    label.textContent = template === 'parabola' ? `y=${snapshot.a}(x−${snapshot.h})²+${snapshot.k}；x∈[−10,10]`
      : `AB=${fmt(snapshot.AB)}，AC=${fmt(snapshot.AC)}，BC=${fmt(samples.derived.BC)} ${snapshot.unit}`;
    svg.append(label);
    const previous = $('scene-stage').querySelector('svg'); if (previous) previous.remove(); $('scene-stage').append(svg);
  }
  function openScene(record, scope) {
    closeScene(); scene = { record: JSON.parse(JSON.stringify(record)), scope, owner: client.snapshot().generation };
    switchView('practice'); $('practice-empty').hidden = true; $('scene-panel').hidden = false;
    message('scene-title', record.title); message('scene-status', '保存的数学条件已恢复；原视频没有被永久保存。');
    $('camera-yaw').value = '0'; $('camera-pitch').value = '0';
    try {
      drawMathSVG(record.template, record.snapshot);
      const canvas = node('canvas'); canvas.setAttribute('aria-label', '数学粒子观察图'); $('scene-stage').append(canvas);
      renderer = bg.particles.createRenderer({ canvas, template: record.template, snapshot: record.snapshot,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        onFallback: () => { canvas.hidden = true;
          ['camera-yaw', 'camera-pitch', 'camera-reset'].forEach((id) => { $(id).disabled = true; });
          message('scene-status', '粒子视图不可用，已保留二维数学主图和复练条件。'); }
      });
    }
    catch (error) { message('scene-status', `粒子视图未就绪：${errorMessage(error)}；仍可根据保存的条件复练。`); }
    renderSceneParameters(record.snapshot, record.template); updateSceneBinding(); resetPractice();
    $('scene-apply').disabled = !renderer; $('scene-reset').disabled = !renderer;
    ['camera-yaw', 'camera-pitch', 'camera-reset'].forEach((id) => { $(id).disabled = !renderer || renderer.getState().mode !== 'webgl'; });
    $('scene-title').focus({ preventScroll: true });
  }
  function resetPractice() {
    if (!scene) return;
    practiceEpoch += 1; hintLevel = 0; answerViewed = false;
    $('practice-panel').hidden = false; $('practice-hint').hidden = true; $('practice-answer').hidden = true;
    ['practice-number', 'practice-h', 'practice-k', 'self-explanation'].forEach((id) => { $(id).value = ''; });
    const triangle = scene.record.template === 'right-triangle';
    $('practice-number-field').hidden = !triangle; $('practice-vertex-fields').hidden = triangle;
    const s = scene.record.snapshot;
    message('practice-question', triangle ? `A 为直角，AB=${s.AB}，AC=${s.AC}（${s.unit}）。先求斜边 BC。`
      : `函数 y=${s.a}(x−${s.h})²+${s.k} 的顶点坐标是什么？`);
    message('practice-status', '答案默认隐藏。提交后由数学程序验证；可选择提示或跳过。');
  }
  function showHint() {
    if (!scene) return; hintLevel = Math.min(2, hintLevel + 1); $('practice-hint').hidden = false;
    message('practice-hint', scene.record.template === 'right-triangle'
      ? hintLevel === 1 ? '先确认哪条边在直角对面，再写出边长关系。' : '使用 BC² = AB² + AC²，最后开平方；不要直接把边长相加。'
      : hintLevel === 1 ? '先把括号内写成 x−h，再看括号外的平移量。' : '顶点式 y=a(x−h)²+k 的顶点为(h,k)，注意括号内的正负号。');
  }
  function showAnswer() {
    if (!scene) return; answerViewed = true; $('practice-answer').hidden = false;
    const answer = records.expectedAnswer(scene.record);
    message('practice-answer', typeof answer === 'number' ? `程序计算：BC=${bg.geometryScene.formatLength(answer)}` : `顶点：(${answer.h}, ${answer.k})`);
  }
  async function submitPractice(event) {
    event.preventDefault(); if (!scene) return;
    const captured = scene; const serial = practiceEpoch;
    const number = (id) => { if (!$(id).value.trim() || !Number.isFinite($(id).valueAsNumber)) throw new Error('请输入有限的数值答案。'); return $(id).valueAsNumber; };
    try {
      const answer = captured.record.template === 'right-triangle' ? number('practice-number') : { h: number('practice-h'), k: number('practice-k') };
      $('submit-practice').disabled = true; message('practice-status', '正在验证并保存本次实际作答…');
      const receipt = captured.scope === 'account'
        ? (await client.submitAttempt(captured.record.id, answer, hintLevel > 0 || answerViewed)).attempt
        : store.attempt(captured.record.id, answer, hintLevel > 0 || answerViewed);
      if (scene !== captured || serial !== practiceEpoch || captured.owner !== client.snapshot().generation) return;
      message('practice-status', receipt.correct
        ? receipt.hintUsed ? '程序判定答对，记录为使用提示完成；可稍后独立复练。' : '程序判定本次独立答对。'
        : '程序判定本次答错，已记录实际作答证据；可以换思路再试，不必立即继续。');
      if (captured.scope === 'account') await loadAccountData(); else renderData();
    } catch (error) { if (scene === captured && serial === practiceEpoch) message('practice-status', `作答未保存：${errorMessage(error)}`); }
    finally { $('submit-practice').disabled = false; }
  }
  async function importPluginFile(file) {
    const owner = ++pluginImportEpoch; pluginPreview = []; $('plugin-preview').replaceChildren(); $('accept-plugin-records').disabled = true;
    try {
      if (!file || file.size > 256 * 1024 || !/\.json$/i.test(file.name)) throw new Error('请选择不超过256KiB的插件JSON记录包。');
      const values = records.parsePluginPackage(await file.text()); if (owner !== pluginImportEpoch) return;
      pluginPreview = values;
      values.forEach((record) => {
        const label = node('label', 'record-select'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.recordId = record.id;
        checkbox.addEventListener('change', () => { $('accept-plugin-records').disabled = !$('plugin-preview').querySelector('input:checked'); });
        label.append(checkbox, node('span', '', `${record.title} · ${record.origin === 'vision' ? 'AI视觉来源' : record.origin === 'author' ? '作者知识层' : '手工来源'} · ${sourceTitle(record.source)}`)); $('plugin-preview').append(label);
      });
      message('plugin-import-status', `已校验 ${values.length} 条，请审核并勾选。仅确认后导入本机，账号仍需另外手动导入。`);
    } catch (error) { if (owner === pluginImportEpoch) message('plugin-import-status', errorMessage(error)); }
  }
  function acceptPluginRecords() {
    try {
      const selected = new Set(Array.from($('plugin-preview').querySelectorAll('input:checked'), (input) => input.dataset.recordId));
      const result = store.merge(pluginPreview.filter((record) => selected.has(record.id)));
      message('plugin-import-status', `本机已新增 ${result.added} 条，相同内容重复ID跳过 ${result.skipped} 条；未上传账号。`);
      $('record-scope').value = 'local'; renderData();
    } catch (error) { message('plugin-import-status', `未导入：${errorMessage(error)}`); }
  }

  document.querySelectorAll('[data-view]').forEach((control) => control.addEventListener('click', (event) => { event.preventDefault(); switchView(control.dataset.view); }));
  $('view-local').addEventListener('click', () => { $('record-scope').value = 'local'; renderData(); switchView('records'); });
  $('video-file').addEventListener('change', () => { if ($('video-file').files[0]) void chooseFile($('video-file').files[0]); });
  $('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
  $('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); if (event.dataTransfer.files.length === 1) void chooseFile(event.dataTransfer.files[0]); else message('file-status', '一次请选择一个视频。'); });
  $('remove-file').addEventListener('click', () => { if (sampleController) sampleController.abort(); sampleController = null; importer.reset(); $('video-file').value = ''; message('file-status', '当前源已移除，旧会话已停止，本地URL已释放；保存的数学记录仍可单独回顾。'); });
  $('sample-triangle').addEventListener('click', () => { switchView('import'); void sample('/extension/assets/video/geometry/triangle-3-4-5.mp4', 'breakglass-triangle.mp4'); });
  $('sample-parabola').addEventListener('click', () => { switchView('import'); void sample('/extension/assets/video/breakglass-demo-9s.mp4', 'breakglass-parabola.mp4'); });
  $('start-analysis').addEventListener('click', () => void openSession(false)); $('manual-explore').addEventListener('click', () => void openSession(true));
  $('stop-analysis').addEventListener('click', () => { if (session) session.stop(); message('session-status', '已请求停止当前识别与后台总结；未保存观察清除，已保存记录保留。'); });
  video.addEventListener('play', () => { watchTracking = Boolean(chosen); });
  video.addEventListener('pause', () => void saveWatch()); video.addEventListener('ended', () => void saveWatch());
  video.addEventListener('timeupdate', () => { if (Date.now() - lastWatch > 15000 && !video.paused) { lastWatch = Date.now(); void saveWatch(); } });
  $('account-form').addEventListener('submit', (event) => { event.preventDefault(); void authenticate(false); });
  $('register').addEventListener('click', () => void authenticate(true));
  async function authenticate(register) {
    if (!$('account-form').reportValidity()) return;
    ['login', 'register', 'logout'].forEach((id) => { $(id).disabled = true; });
    try { await client[register ? 'register' : 'login']({ username: $('username').value, password: $('password').value }); $('password').value = ''; }
    catch (error) { message('account-status', errorMessage(error)); }
    finally { $('login').disabled = false; $('register').disabled = false; $('logout').disabled = !client.snapshot().user; }
  }
  $('logout').addEventListener('click', async () => { $('logout').disabled = true; try { await client.logout(); message('account-status', '退出已由服务确认；本机访客记录仍保留。'); } catch (error) { message('account-status', `退出未确认：${errorMessage(error)}`); } });
  ['record-scope', 'record-kind', 'record-source'].forEach((id) => $(id).addEventListener('change', renderData));
  $('refresh-center').addEventListener('click', async () => { try { await client.refresh(); if (client.snapshot().user) await loadAccountData(); else renderData(); } catch (error) { message('center-status', errorMessage(error)); } });
  $('import-selected').addEventListener('click', () => void importSelected()); $('export-records').addEventListener('click', () => void exportData());
  $('clear-local').addEventListener('click', () => { if (!confirm('清除这台浏览器的本机记录、观看位置和复练记录？账户数据不受影响。')) return; try { watchTracking = false; video.pause(); store.clear(); selectedLocal.clear(); if (scene && scene.scope === 'local') closeScene(); stopSession(); renderData(); message('center-status', '本机清除已完成，旧本机写回已失效。再次主动播放后才记录新位置。'); } catch (error) { message('center-status', errorMessage(error)); } });
  $('clear-account-records').addEventListener('click', async () => { if (!confirm('清除当前账户的学习记录与对应作答？本机记录仍保留。')) return; stopSession(); closeScene(); try { await client.clearRecords(); await loadAccountData(); message('data-status', '当前账户学习记录清除已由服务确认。'); } catch (error) { message('data-status', `清除未确认：${errorMessage(error)}`); } });
  $('delete-account-data').addEventListener('click', async () => { if (!confirm('删除当前账户全部学习记录、观看位置与复练数据？本机访客记录不受影响。')) return; watchTracking = false; video.pause(); stopSession(); closeScene(); try { await client.deleteAccountData(); await loadAccountData(); message('data-status', '当前账户全部学习数据删除已由服务确认。再次主动播放后才开始记录新观看位置。'); } catch (error) { message('data-status', `删除未确认：${errorMessage(error)}`); } });
  $('scene-apply').addEventListener('click', () => { if (!scene || !renderer) return; try { const snapshot = { ...scene.record.snapshot }; $('scene-parameters').querySelectorAll('input').forEach((input) => { if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new Error('请输入有限参数。'); snapshot[input.dataset.parameter] = input.valueAsNumber; }); if (!records.validSnapshot(scene.record.template, snapshot)) throw new Error('数学条件无效。'); drawMathSVG(scene.record.template, snapshot); renderer.update(snapshot); message('scene-status', '参数探索已更新；保存记录和复练题目仍保留原条件。'); } catch (error) { message('scene-status', errorMessage(error)); } });
  $('scene-reset').addEventListener('click', () => { if (scene && renderer) { renderer.update(scene.record.snapshot); drawMathSVG(scene.record.template, scene.record.snapshot); renderSceneParameters(scene.record.snapshot, scene.record.template); message('scene-status', '已恢复保存的数学条件。'); } });
  ['camera-yaw', 'camera-pitch'].forEach((id) => $(id).addEventListener('input', () => { if (renderer) renderer.setView({ yaw: Number($('camera-yaw').value) * Math.PI / 180, pitch: Number($('camera-pitch').value) * Math.PI / 180 }); }));
  $('camera-reset').addEventListener('click', () => { $('camera-yaw').value = '0'; $('camera-pitch').value = '0'; if (renderer) renderer.resetView(); });
  $('scene-return').addEventListener('click', () => { if (!scene || !sameFile(scene.record.source)) return; switchView('import'); video.currentTime = Math.min(scene.record.time, video.duration); video.focus(); });
  $('scene-close').addEventListener('click', closeScene); $('practice-form').addEventListener('submit', submitPractice);
  $('show-hint').addEventListener('click', showHint); $('show-answer').addEventListener('click', showAnswer);
  $('skip-practice').addEventListener('click', () => { practiceEpoch += 1; $('practice-panel').hidden = true; message('scene-status', '已跳过本次复练；没有生成作答或错误记录。'); });
  $('mixed-practice').addEventListener('click', () => { try {
    const data = activeData(); if (!data.records.length) { message('center-status', '还没有可复练的数学记录。'); return; }
    const groups = ['parabola', 'right-triangle'].map((template) => data.records.filter((record) => record.template === template));
    const items = []; for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) {
      groups.forEach((group) => { if (group[index]) items.push(group[index]); });
    }
    const current = scene ? items.findIndex((record) => record.id === scene.record.id) : -1;
    openScene(items[(current + 1) % items.length], $('record-scope').value);
  } catch (error) { message('center-status', errorMessage(error)); } });
  $('plugin-json').addEventListener('change', () => { if ($('plugin-json').files[0]) void importPluginFile($('plugin-json').files[0]); }); $('accept-plugin-records').addEventListener('click', acceptPluginRecords);
  window.addEventListener('pagehide', () => { if (sampleController) sampleController.abort(); if (policyController) policyController.abort(); importer.reset(); closeScene(); client.invalidate(); });
  window.addEventListener('storage', (event) => { if (event.key === records.KEY) { stopSession(); closeScene(); renderData(); } });
  renderData(); switchView('overview');
  client.refresh().catch((error) => { message('account-status', `账户服务暂不可用：${errorMessage(error)}。本机学习仍可用。`); });
})(globalThis);
