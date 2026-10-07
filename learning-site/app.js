(function (root) {
  'use strict';
  const bg = root.BreakGlass;
  function mount(container, options = {}) {
  const document = options.document || root.document;
  const window = options.window || root;
  const localStorage = options.storage || root.localStorage;
  let active = true; let destroyed = false;
  const listeners = [];
  function listen(target, ...args) { target.addEventListener(...args); listeners.push(() => target.removeEventListener(...args)); }
  const isActive = () => !destroyed && active && (!options.isActive || options.isActive());
  const $ = (id) => document.getElementById(id);
  const records = bg.webRecords;
  const store = records.createLocalStore(localStorage);
  const annotationStore = bg.webAnnotations.createLocalStore(localStorage, { getRecords: () => store.read() });
  const CACHE_CLEAR_PENDING = 'breakglass.website.guest-cache-clear-pending';
  const video = options.video || $('learning-video');
  const flowStore = bg.learningFlowStore?.createLocalStore(localStorage, { getRecords: () => store.read() });
  const provenanceStore = bg.webProvenance?.createStore({ storage: localStorage, recordsStore: store });
  const PROVENANCE_KEY = bg.webProvenance?.KEY || 'breakglass.website.provenance.v1';
  let flowUI = null;
  let lastSaveTarget = ''; let lastRecordIds = new Set(); let annotationRecordId = null;
  const saveScopeLabels = new Map();
  function getSaveTarget() {
    const scope = $('record-scope').value === 'account' ? 'account' : 'local';
    const state = client.snapshot();
    return { scope, label: scope === 'account' ? state.user ? `账号：${state.user.username}` : '账号：尚未登录' : '本机访客 · 这台浏览器',
      owner: learningOwner(), epoch: scope === 'account' ? state.epoch : store.read().epoch,
      canSave: !destroyed && (scope === 'local' || Boolean(state.user && accountLoaded && !accountLoading && !accountLoadError)) };
  }
  function publishSaveTarget() {
    const target = getSaveTarget(), signature = JSON.stringify(target);
    for (const id of ['save-explanation', 'create-variant']) {
      const control = $(id); if (!control?.parentElement) continue;
      if (!saveScopeLabels.has(id)) { const label = node('p', 'muted'); label.dataset.saveScope = id; control.parentElement.append(label); saveScopeLabels.set(id, label); }
    }
    for (const id of ['math-workbench', 'annotation-workbench']) {
      const host = $(id); if (!host || saveScopeLabels.has(id)) continue;
      const control = host.querySelector(id === 'math-workbench' ? '[data-math-action="save"]' : 'button[type="submit"]');
      const label = node('p', 'muted'); label.dataset.saveScope = id; (control?.parentElement || host).append(label); saveScopeLabels.set(id, label);
    }
    saveScopeLabels.forEach(label => { label.textContent = `保存到：${target.label}${target.canSave ? '' : ' · 保存条件尚未确认'}`; });
    if (signature !== lastSaveTarget) { lastSaveTarget = signature; options.onScopeChange?.({ ...target }); }
    return target;
  }
  function project(data = activeData()) {
    const target = getSaveTarget();
    return bg.learningEvidence.project(data, { scope: target.scope, owner: target.owner, epoch: target.epoch });
  }
  function mediaSnapshot() { return { selection: chosen, policy, source: chosen?.source || null, generation: importer.epoch(), owner: learningOwner(), view }; }
  function mediaChanged() { if (!destroyed) options.onMediaChange?.(mediaSnapshot()); }
  function publishScene(template, snapshot, origin = 'source', source = null) { options.onScene?.({ template, snapshot: { ...snapshot }, origin, confirmed: true, sourceId: source?.id || null, sourceVersion: source?.version || null }); }
  async function savePurpose(recordId, purpose) {
    const owner = learningOwner();
    if ($('record-scope').value === 'account') await client.savePurpose(recordId, purpose);
    else flowStore?.savePurpose(recordId, purpose);
    if (owner !== learningOwner()) throw new Error('学习范围已改变，旧用途保存已忽略。');
    if ($('record-scope').value === 'account') await loadAccountData(); else renderData();
  }
  let view = 'overview';
  let accountOwner = ''; let renderedOwner = null;
  let accountData = { records: [], attempts: [], watch: [], annotations: [], provenance: [], provenanceError: '', flow: bg.learningFlowStore?.emptyFlow() || {} };
  let accountLoading = false;
  let accountLoaded = false;
  let accountLoadError = '';
  let loadEpoch = 0;
  let chosen = null;
  let policy = null;
  let policyController = null;
  let sampleController = null;
  let session = null;
  let sessionGeneration = 0; let sessionOwner = null; let sessionManualOnly = false; let recognitionPreparing = null;
  let sessionPrepared = false;
  let candidateSelection = 0;
  let cssPromise = null;
  let scene = null;
  let practiceRecordId = null;
  let deployment = { mode: 'local-development', registrationEnabled: true };
  let renderer = null;
  const practiceHelp = new Map();
  const practiceHelpKey = () => `${learningOwner()}:${scene?.record.id || ''}`;
  function rememberPracticeHelp() { if (scene) practiceHelp.set(practiceHelpKey(), { hintLevel, answerViewed }); }
  let hintLevel = 0;
  let answerViewed = false;
  let practiceEpoch = 0;
  let prediction = null;
  let variantIndex = 0;
  let pluginPreview = [];
  let pluginImportEpoch = 0;
  let lastWatch = 0;
  let watchTracking = false;
  let progressiveUI = null;
  let audioUI = null;
  let annotationOwner = null;
  let mathWorkbench = null;
  const selectedLocal = new Set();
  const client = bg.webAccount.createClient({ onChange: accountChanged });
  const pairing = bg.webPairing.createUI({ client, document });
  const contextUI = bg.webContext.createUI({ document, video, getSelection: () => chosen, getPolicy: () => policy,
    beforeStart: () => stopSession(), onClear: () => {
      candidateSelection += 1;
      if (sessionPrepared) { sessionPrepared = false; if (session) session.destroy(); session = null; $('stop-analysis').disabled = true; }
    }, onCandidate: showContextCandidate });

  async function showContextCandidate(object, value, isCurrent) {
      const sourceId = chosen?.source.id; const owner = client.snapshot().generation;
      const selection = ++candidateSelection;
      const valid = () => isCurrent() && candidateSelection === selection && chosen?.source.id === sourceId
        && client.snapshot().generation === owner && !document.hidden && isActive();
      try {
        video.pause();
        if (Math.abs(video.currentTime - object.frameTime) > 0.001) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { video.removeEventListener('seeked', done); reject(new Error('候选定位超时。')); }, 10000);
            function done() { if (video.seeking || Math.abs(video.currentTime - object.frameTime) > 0.05) return;
              clearTimeout(timeout); video.removeEventListener('seeked', done); resolve(); }
            listen(video, 'seeked', done); video.currentTime = object.frameTime;
          });
        }
        if (valid()) await openSession(false, value, valid);
      } catch (error) { if (valid()) message('context-status', errorMessage(error)); }
  }
  const annotationEditor = bg.webAnnotationEditor.createUI({ document, container: $('annotation-workbench'),
    load: (record, scope) => scope === 'account' ? client.annotation(record.id) : Promise.resolve(annotationStore.get(record.id)),
    save: (record, scope, metadata, expectedRevision, expectedEpoch) => {
      if (!currentAnnotation(record, scope)) throw new Error('学习范围已改变，旧备注未保存。');
      if (scope === 'account') {
        if (client.snapshot().epoch !== expectedEpoch) throw new Error('账户资料已改变，请重新读取备注。');
        return client.saveAnnotation(record.id, metadata, expectedRevision);
      }
      return Promise.resolve(annotationStore.save(record.id, metadata, { expectedRevision, expectedEpoch }));
    }, isCurrent: currentAnnotation,
    onSaved: async () => { if ($('record-scope').value === 'account') await loadAccountData(); else renderData(); }
  });
  function learningOwner() {
    const state = client.snapshot();
    const scope = $('record-scope').value;
    return `${scope}:${state.generation}:${state.user?.id || 'guest'}:${scope === 'account' ? state.epoch : '-'}:${scope === 'local' ? store.read().epoch : '-'}`;
  }
  function currentAnnotation(record, scope) {
    return annotationOwner === learningOwner() && $('record-scope').value === scope
      && activeData().records.some((item) => item.id === record.id);
  }
  function openAnnotation(record, scope) {
    annotationOwner = learningOwner(); annotationRecordId = record.id; void annotationEditor.open(record, scope);
    $('annotation-workbench').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }
  mathWorkbench = bg.mathWorkbench.mount($('math-workbench'), { document, onPurpose: savePurpose, onScene: options.onScene, getState: activeData, getOwner: learningOwner,
    saveRecord: async (input) => {
      const owner = learningOwner(); const scope = $('record-scope').value; const localEpoch = store.read().epoch;
      const record = records.validateRecord(input);
      if (scope === 'account') { if (!client.snapshot().user) throw new Error('请先登录当前账户。'); await client.saveRecord(record); }
      else store.save(record, localEpoch);
      if (owner !== learningOwner()) throw new Error('学习范围已改变，旧操作结果已忽略。');
      if (scope === 'account') await loadAccountData(); else renderData();
      return record;
    }, submitAttempt: async (record, answer, hintUsed) => {
      const owner = learningOwner(); const scope = $('record-scope').value; const localEpoch = store.read().epoch;
      const receipt = scope === 'account' ? (await client.submitAttempt(record.id, answer, hintUsed)).attempt
        : store.attempt(record.id, answer, hintUsed, localEpoch);
      if (owner !== learningOwner()) throw new Error('学习范围已改变，旧作答结果已忽略。');
      if (scope === 'account') await loadAccountData(); else renderData();
      return receipt;
    }, onChanged: renderData, onOpen: (record) => { closeScene(); practiceRecordId = record.id; $('practice-empty').hidden = true; }
  });
  progressiveUI = bg.progressive.createUI({ document, mount: $('progressive-workbench'), video,
    getSelection: () => chosen, getPolicy: () => {
      if (!client.snapshot().user && localStorage.getItem(CACHE_CLEAR_PENDING)) return { ...policy, allowed: false };
      return policy;
    }, beforeStart: () => stopSession(),
    onCandidate: showContextCandidate, onClear: () => {
      candidateSelection += 1;
      if (sessionPrepared) { sessionPrepared = false; session?.destroy(); session = null; $('stop-analysis').disabled = true; }
    }
  });
  audioUI = bg.webAudio.createUI({ document, mount: $('audio-workbench'), getSelection: () => chosen,
    getPolicy: () => policy, beforeStart: () => stopSession(), getOwner: learningOwner });
  async function clearGuestAnalysis() {
    localStorage.setItem(CACHE_CLEAR_PENDING, '1'); progressiveUI.update();
    await progressiveUI.clearGuestCache(); localStorage.removeItem(CACHE_CLEAR_PENDING); progressiveUI.update();
    message('cache-lifecycle-status', '访客分析缓存已由服务清除；账户缓存与学习记录保留。');
  }

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
  function localProvenance() {
    if (!provenanceStore) return { items: [], error: localStorage.getItem(PROVENANCE_KEY) ? '来源读取模块尚未就绪，原数据保留。' : '' };
    try {
      const raw = localStorage.getItem(PROVENANCE_KEY), value = provenanceStore.read();
      const next = JSON.stringify(value);
      // Persist the store's validated parent pruning, so same-ID reimport
      // cannot recover deleted source associations. Never rewrite a peer update.
      if (raw !== null && raw !== next && store.read().epoch === value.epoch && localStorage.getItem(PROVENANCE_KEY) === raw) localStorage.setItem(PROVENANCE_KEY, next);
      return { items: value.items, error: '' };
    } catch (error) { return { items: [], error: errorMessage(error) }; }
  }
  function activeData() {
    if ($('record-scope').value === 'account') return accountData;
    const provenance = localProvenance();
    return { ...store.read(), annotations: annotationStore.read().annotations, flow: flowStore?.read().flow || {}, provenance: provenance.items, provenanceError: provenance.error };
  }
  function sourceTitle(source) { return `${source.title || '保存的数学条件'} · ${source.id.slice(-8)}`; }
  function sameFile(source) { return Boolean(chosen && records.fileId(source) === chosen.source.id && source.version === chosen.source.version); }
  function visualOwner() { return chosen ? `${learningOwner()}:${importer.epoch()}:${records.identity(chosen.source)}` : null; }
  function getVisualSession() { return session && sessionOwner === visualOwner() && !sessionManualOnly ? session : null; }
  async function prepareRecognitionSession() {
    if (!isActive() || document.hidden || !chosen || !policy?.allowed || chosen.source.kind !== 'local-file'
      || !policy.source || records.identity(policy.source) !== records.identity(chosen.source)) throw new Error('当前素材、范围或处理许可未确认，不能准备识别会话。');
    if (recognitionPreparing) return recognitionPreparing;
    const existing = getVisualSession();
    if (existing) {
      const serial = sessionGeneration;
      try {
        if (typeof existing.prepare !== 'function') throw new Error('单帧识别会话能力尚未就绪。');
        if (!await existing.prepare() || serial !== sessionGeneration || getVisualSession() !== existing || !policy?.allowed || !isActive() || document.hidden) throw new Error('识别会话准备未确认或范围已改变。');
        return existing;
      } catch (error) { if (serial === sessionGeneration && session === existing) stopSession(); throw error; }
    }
    const pending = openSession(false, null, () => true, true);
    recognitionPreparing = pending;
    try { const value = await pending; if (!value) throw new Error('识别会话准备未确认。'); return value; }
    finally { if (recognitionPreparing === pending) recognitionPreparing = null; }
  }
  function stopSession(keepContext = false) { sessionGeneration += 1; sessionOwner = null; recognitionPreparing = null; sessionPrepared = false; if (session) { session.destroy(); session = null; }
    if (!keepContext) { contextUI.stop(); progressiveUI?.stop(); } audioUI?.stop(); $('stop-analysis').disabled = true; }
  function closeScene() {
    practiceEpoch += 1;
    ['practice-number', 'practice-h', 'practice-k', 'self-explanation'].forEach(id => { $(id).value = ''; });
    options.onScene?.(null);
    if (renderer) renderer.destroy();
    renderer = null; scene = null; practiceRecordId = null; $('scene-stage').replaceChildren(); $('scene-panel').hidden = true;
    $('practice-empty').hidden = view !== 'practice';
  }
  function switchView(next) {
    if (!['overview', 'watch', 'records', 'practice', 'import', 'account'].includes(next)) return;
    if (next !== 'import') stopSession();
    if (next !== 'records') annotationEditor.close();
    view = next;
    document.querySelectorAll('[data-page]').forEach((section) => {
      section.hidden = section.dataset.page !== next || ((section.dataset.bgId || section.id) === 'scene-panel' && !scene)
        || ((section.dataset.bgId || section.id) === 'practice-empty' && Boolean(scene));
    });
    document.querySelectorAll('.site-sidebar [data-view]').forEach((control) => {
      if (control.dataset.view === next) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current');
    });
    if (next === 'overview' || next === 'records' || next === 'watch') renderData();
    if (next === 'practice') mathWorkbench?.refresh();
    options.onViewChange?.(next);
  }

  function accountChanged(state) {
    if (destroyed) return;
    pairing.update(state);
    const next = `${state.generation}:${state.user ? state.user.id : 'guest'}:${state.epoch}`;
    if (next !== accountOwner) {
      accountOwner = next; loadEpoch += 1; accountData = { records: [], attempts: [], watch: [], annotations: [], provenance: [], provenanceError: '', flow: bg.learningFlowStore?.emptyFlow() || {} };
      accountLoaded = false; accountLoadError = '';
      watchTracking = false; video.pause();
      selectedLocal.clear(); stopSession(); closeScene();
      $('record-scope').value = state.user ? 'account' : 'local';
      annotationOwner = null; annotationEditor.close(); mathWorkbench?.reset();
    }
    $('account-option').disabled = !state.user;
    accountLoading = Boolean(state.user);
    ['logout', 'clear-account-records', 'delete-account-data'].forEach((id) => { $(id).disabled = !state.user; });
    message('top-identity', state.user ? `${state.user.username} · ${deployment.mode === 'production-pilot' ? '已审批试点账户' : '本机开发账户'}` : '本机访客 · 数据保存在这台浏览器');
    message('account-status', state.user ? `当前账户：${state.user.username}。本机记录不会自动导入。` : '当前未登录。可以继续本地学习与复练。');
    renderData(); options.onOwnerChange?.(learningOwner()); mediaChanged();
    if (state.user) void loadAccountData();
  }
  async function loadAccountData() {
    const owner = client.snapshot();
    if (!owner.user) return;
    const serial = ++loadEpoch;
    accountLoading = true; accountLoadError = ''; renderData();
    message('center-status', '正在读取当前账户的记录、观看位置和真实复练结果…');
    const replies = await Promise.allSettled([client.records(), client.watch(), client.attempts(), client.annotations(), client.flow ? client.flow() : Promise.resolve({epoch: owner.epoch, flow: {}}),
      client.provenance ? client.provenance() : Promise.resolve({ epoch: owner.epoch, provenance: [] })]);
    if (serial !== loadEpoch || owner.generation !== client.snapshot().generation || owner.epoch !== client.snapshot().epoch || owner.user.id !== client.snapshot().user?.id) return;
    const failed = replies.slice(0, 5).find((reply) => reply.status === 'rejected');
    accountLoading = false;
    if (failed) { accountLoadError = errorMessage(failed.reason); renderData(); message('center-status', accountLoadError); return; }
    const epochs = replies.slice(0, 5).map((reply) => reply.value.epoch);
    if (epochs.some((epoch) => epoch !== owner.epoch)) { accountLoadError = '学习数据版本已改变，请刷新当前账户。'; renderData(); return; }
    let provenance = accountData.provenance || [], provenanceError = '';
    try {
      const reply = replies[5]; if (reply.status !== 'fulfilled') throw reply.reason;
      if (reply.value.epoch !== owner.epoch || !Array.isArray(reply.value.provenance) || reply.value.provenance.length > 500) throw new Error('来源资料版本或结构无效');
      const seen = new Set();
      provenance = reply.value.provenance.map(item => {
        if (seen.has(item.recordId)) throw new Error('来源资料存在重复父记录'); seen.add(item.recordId);
        const record = replies[0].value.records.find(record => record.id === item.recordId);
        if (!record) throw new Error('来源资料的原题不存在');
        return bg.webProvenance.validate(item, record);
      });
    } catch (error) { provenanceError = errorMessage(error); }
    accountData = { records: replies[0].value.records, watch: replies[1].value.items, attempts: replies[2].value.attempts,
      annotations: replies[3].value.annotations.map(bg.webAnnotations.validateAnnotation), flow: replies[4].value.flow, provenance, provenanceError };
    accountLoaded = true;
    renderData(); message('center-status', `当前账户已读取 ${accountData.records.length} 条记录。${provenanceError ? `来源记录读取未确认：${provenanceError}` : ''}`);
  }
  function mastery(record, evidence) {
    return evidence.records.find(item => item.recordId === record.id)?.state || '待验证';
  }
  function renderDashboard(data, evidence) {
    const accountScope = $('record-scope').value === 'account';
    const pending = accountScope && !accountLoaded;
    message('overview-identity', accountScope && accountLoading ? '正在读取当前账户的真实记录…'
      : accountScope && accountLoadError ? `账户刷新未确认：${accountLoadError}${accountLoaded ? '；保留此前确认的数据。' : ''}`
        : `${accountScope ? '当前账户' : '本机访客'}的真实学习记录；没有记录时显示空态。`);
    const summary = $('dashboard-summary'); summary.replaceChildren();
    const actualWrong = evidence.summary.wrongRecords;
    [['保存的疑问', data.records.filter((r) => r.kind === 'question').length], ['个人易错标记', data.records.filter((r) => r.kind === 'pitfall').length],
      ['有答错证据的记录', actualWrong], ['记录的课程位置', data.watch.length]].forEach(([label, count]) => {
      const card = node('div', 'stat-card'); card.append(node('p', '', label), node('strong', '', pending ? '—' : String(count))); summary.append(card);
    });
    const counts = { '待验证': 0, '使用提示完成': 0, '最近一次独立正确': 0, '需要复练': 0 };
    data.records.forEach((record) => { counts[mastery(record, evidence)] += 1; });
    $('dashboard-states').replaceChildren();
    Object.entries(counts).forEach(([label, count]) => { const row = node('div', 'status-row'); row.append(node('span', '', label), node('strong', '', pending ? '待同步' : `${count} 条`)); $('dashboard-states').append(row); });
    const activity = $('dashboard-activity'); activity.replaceChildren();
    const recent = evidence.events.slice(-4).reverse();
    recent.forEach((attempt) => {
      const record = data.records.find((item) => item.id === attempt.recordId);
      const row = node('div', 'status-row'); row.append(node('span', '', record ? record.title : '复练记录'),
        node('span', 'muted', `${attempt.stage === 'completion' ? '补步骤 · ' : attempt.stage === 'delayed' ? '延后题型（实际间隔另核） · ' : ''}${attempt.correct ? attempt.hintUsed ? '使用帮助答对' : '无帮助答对' : '实际答错'} · ${date(attempt.createdAt)}`)); activity.append(row);
    });
    if (!recent.length) activity.append(node('p', 'muted', '还没有提交过复练答案。观看进度不会替代理解验证。'));
  }
  function renderData() {
    if (destroyed) return;
    const nextOwner = learningOwner(); if (renderedOwner !== nextOwner) {
      if (renderedOwner !== null) { annotationOwner = null; annotationRecordId = null; annotationEditor.close(); mathWorkbench?.reset(); closeScene(); stopSession(); lastRecordIds.clear(); }
      renderedOwner = nextOwner; options.onOwnerChange?.(nextOwner); mediaChanged();
    }
    let data;
    try { data = activeData(); } catch (error) { message('center-status', errorMessage(error)); return; }
    const ids = new Set(data.records.map(record => record.id));
    if (practiceRecordId && lastRecordIds.has(practiceRecordId) && !ids.has(practiceRecordId)) { mathWorkbench?.reset(); closeScene(); }
    if (annotationRecordId && !ids.has(annotationRecordId)) { annotationOwner = null; annotationRecordId = null; annotationEditor.close(); }
    lastRecordIds = ids;
    const evidence = project(data);
    const metadata = new Map((data.annotations || []).map((item) => [item.recordId, item]));
    const displayRecords = data.records.map((record) => bg.webAnnotations.displayRecord(record, metadata.get(record.id)));
    renderDashboard({ ...data, records: displayRecords }, evidence);
    mathWorkbench?.refresh(); flowUI?.refresh();
    publishSaveTarget();
    const sourceFilter = $('record-source');
    const previous = sourceFilter.value;
    sourceFilter.replaceChildren(); const all = node('option', '', '全部来源'); all.value = 'all'; sourceFilter.append(all);
    const sources = new Map(data.records.map((record) => [records.identity(record.source), record.source]));
    sources.forEach((source, key) => { const option = node('option', '', sourceTitle(source)); option.value = key; sourceFilter.append(option); });
    if (previous === 'all' || sources.has(previous)) sourceFilter.value = previous;
    const wrong = new Set(evidence.records.filter(item => item.hasWrong).map(item => item.recordId));
    const kind = $('record-kind').value;
    const filtered = displayRecords.filter(record => (sourceFilter.value === 'all' || records.identity(record.source) === sourceFilter.value)
      && (kind === 'all' || (kind === 'wrong' ? wrong.has(record.id) : record.kind === kind)));
    const list = $('record-list'); list.replaceChildren();
    if (!filtered.length) list.append(node('p', 'muted', '当前范围没有符合筛选的记录。先保存一个疑问或手工数学条件，再来回顾。'));
    const localScope = $('record-scope').value === 'local';
    filtered.forEach((record) => {
      const original = data.records.find((item) => item.id === record.id);
      const card = node('article', 'record-card');
      if (localScope && client.snapshot().user) {
        const label = node('label', 'record-select'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedLocal.has(record.id);
        checkbox.addEventListener('change', () => { checkbox.checked ? selectedLocal.add(record.id) : selectedLocal.delete(record.id); updateImportButton(); });
        label.append(checkbox, node('span', '', '选择导入当前账户')); card.append(label);
      }
      card.append(node('span', 'badge', record.kind === 'question' ? '疑问' : '个人易错标记'));
      if (wrong.has(record.id)) card.append(node('span', 'badge wrong', '有实际答错证据'));
      card.append(node('h3', '', record.title), node('p', '', record.note), node('p', 'muted', `${sourceTitle(record.source)} · ${time(record.time)}`),
        node('p', 'muted', `${record.origin === 'vision' ? 'AI视觉来源，条件已由学生确认' : record.origin === 'author' ? '作者知识层（历史测试夹具）' : '手工数学条件，非AI识别'} · ${record.sourceLabel}`), node('p', 'muted', mastery(record, evidence)));
      if (data.provenance?.some(item => item.recordId === record.id)) card.append(node('p', 'muted', '来源关系已保存：学生确认的候选；模型准确性与原位效果仍需独立核对。'));
      if (data.provenanceError) card.append(node('p', 'muted', `来源记录读取未确认：${data.provenanceError}`));
      const plan = evidence.records.find(item => item.recordId === record.id)?.plan;
      const review = plan?.eligible ? plan.reviewAt : null;
      if (review) card.append(node('p', 'muted', `建议复练：${date(review)}（可跳过；不是掌握保证）`));
      if (record.tags.length) { const tags = node('p', 'reason-tags'); record.tags.forEach((tag) => tags.append(node('span', 'badge', tag))); card.append(tags); }
      const actions = node('div', 'actions'); actions.append(button('恢复数学场景 / 复练', () => openScene(original, localScope ? 'local' : 'account')),
        button('编辑备注 / 易错原因', () => openAnnotation(original, localScope ? 'local' : 'account')),
        button('删除这条记录', () => deleteRecord(original, localScope))); card.append(actions); list.append(card);
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
      contextUI.update(); progressiveUI?.update(); audioUI?.update(); mediaChanged();
    },
    onChange: (value) => {
      message('file-status', value.message);
      $('remove-file').disabled = value.state === 'error';
      if (value.state === 'ready') {
        chosen = value.selected; $('manual-explore').disabled = false;
        message('file-details', `${chosen.name} · ${time(chosen.duration)} · ${chosen.width}×${chosen.height} · SHA-256 ${chosen.source.id.slice(-12)}`);
        updateSceneBinding(); mediaChanged(); void checkPolicy();
      }
    }
  });
  async function chooseFile(file) {
    if (destroyed) return;
    if (sampleController) { sampleController.abort(); sampleController = null; }
    switchView('import');
    try { return await importer.choose(file); } catch (_) { return null; /* Importer reports its exact decode/limit error. */ }
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
      contextUI.update(); progressiveUI?.update(); audioUI?.update(); mediaChanged();
    } catch (error) { if (error.name !== 'AbortError' && owner === importer.epoch()) message('policy-status', errorMessage(error)); }
  }
  function overlayCSS() {
    if (!cssPromise) cssPromise = Promise.all(['/extension/src/plugin/overlay.css', '/learning-site/learning-layer.css'].map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('无法加载网站学习层样式。'); return response.text();
    })).then((styles) => styles.join('\n')).catch((error) => { cssPromise = null; throw error; });
    return cssPromise;
  }
  async function openSession(manualOnly, prepared = null, isPreparedCurrent = () => true, prepareOnly = false) {
    if (!chosen || !isActive()) return;
    if (!manualOnly && (!policy || !policy.allowed)) { message('session-status', '材料未获准，不发送画面。'); return; }
    const existing = !manualOnly && !prepared && !prepareOnly ? getVisualSession() : null;
    if (existing) {
      const serial = sessionGeneration;
      try { if (!await existing.start()) throw new Error('持续识别会话准备未确认。'); if (serial !== sessionGeneration || getVisualSession() !== existing) return null;
        message('session-status', '持续视觉识别使用当前同源会话与剩余额度，请以实际状态为准。'); return existing;
      } catch (error) { if (serial === sessionGeneration && session === existing) { stopSession(); message('session-status', errorMessage(error)); } return null; }
    }
    stopSession(Boolean(prepared));
    const serial = sessionGeneration;
    const owner = client.snapshot(); const target = getSaveTarget(); const learningScope = learningOwner(); const importEpoch = importer.epoch(); const file = chosen.source.id;
    try {
      const cssText = await overlayCSS();
      if (!chosen || chosen.source.id !== file || importEpoch !== importer.epoch() || owner.generation !== client.snapshot().generation
        || learningScope !== learningOwner() || serial !== sessionGeneration || !isActive() || document.hidden || (!manualOnly && !policy?.allowed) || (prepared && !isPreparedCurrent())) return;
      const localEpoch = target.scope === 'local' ? store.read().epoch : null;
      const next = bg.webVisual.createSession({ video, source: { ...chosen.source }, cssText, manualOnly, deferOverlay: prepareOnly,
        onSave: async (input) => {
          if (!isActive() || serial !== sessionGeneration || learningScope !== learningOwner() || !chosen || chosen.source.id !== file || importer.epoch() !== importEpoch || owner.generation !== client.snapshot().generation) throw new Error('来源或账户已改变，旧记录不保存。');
          const record = records.validateRecord({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          if (target.scope === 'account') {
            if (!owner.user || !getSaveTarget().canSave) throw new Error('当前账号保存条件尚未确认。');
            await client.saveRecord(record);
            if (owner.generation !== client.snapshot().generation) throw new Error('账户已改变。');
            await loadAccountData(); return { ok: true, storage: 'account' };
          }
          store.save(record, localEpoch); renderData(); return { ok: true, storage: 'local' };
        }
      });
      session = next; sessionOwner = visualOwner(); sessionManualOnly = manualOnly; sessionPrepared = Boolean(prepared); $('stop-analysis').disabled = false;
      if (prepareOnly) {
        if (typeof next.prepare !== 'function' || !await next.prepare()) throw new Error('单帧识别会话准备未确认。');
        if (serial !== sessionGeneration || learningScope !== learningOwner() || !isActive() || document.hidden || !policy?.allowed) { next.destroy(); return null; }
        message('session-status', '单帧识别会话已准备；尚未开启持续采样。');
      }
      else if (prepared) { next.showPreparedContext(prepared); message('session-status', '片段数学候选已载入热点层；点击当前时间的热点，校对后探索或保存。'); }
      else if (manualOnly) message('session-status', '独立手工条件模式：不分析原视频，不上传画面；输入和保存自己的数学条件。');
      else { if (!await next.start()) throw new Error('持续识别会话准备未确认。'); if (serial === sessionGeneration) message('session-status', '持续视觉识别操作已提交，请以学习面板的实际状态为准；失败不会替换成预设热点。'); }
      return next;
    } catch (error) { if (serial === sessionGeneration) { stopSession(); message('session-status', errorMessage(error)); } if (prepareOnly) throw error; return null; }
  }
  async function sample(path, name, { targetTime } = {}) {
    if (destroyed) return;
    const owner = learningOwner();
    if (sampleController) sampleController.abort(); importer.reset();
    const controller = new AbortController(); sampleController = controller;
    message('file-status', '正在载入仓库自制教学素材；没有预设AI热点。'); $('remove-file').disabled = false;
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('自制素材载入失败。');
      const blob = await response.blob();
      if (sampleController !== controller || controller.signal.aborted) return;
      sampleController = null;
      const pending = chooseFile(new File([blob], name, { type: 'video/mp4' }));
      const epoch = importer.epoch();
      const selected = await pending;
      if (!selected || destroyed || epoch !== importer.epoch() || owner !== learningOwner() || chosen?.source.id !== selected.source.id) return null;
      // The media owner seeks only after decode/fingerprint validation, for this explicit sample choice.
      if (Number.isFinite(targetTime) && targetTime >= 0 && targetTime <= selected.duration) {
        video.pause(); video.currentTime = targetTime;
      }
      return selected;
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
      annotationEditor.close(); mathWorkbench?.reset();
      if (localScope) { flowStore?.remove(record.id, store.read().epoch); store.remove(record.id); annotationStore.remove(record.id); const provenance = localProvenance(); practiceHelp.delete(`${learningOwner()}:${record.id}`); selectedLocal.delete(record.id); renderData(); if (provenance.error) throw new Error(`原题已删除，来源清理未确认：${provenance.error}`); }
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
    try {
      const owner = learningOwner(); let value;
      if ($('record-scope').value === 'account') {
        const [data, metadata, flowData, sourceData] = await Promise.all([client.exportData(), client.annotations(), client.flow(),
          client.provenance ? client.provenance() : Promise.resolve({ epoch: client.snapshot().epoch, provenance: [] })]);
        if (owner !== learningOwner() || data.epoch !== metadata.epoch || data.epoch !== flowData.epoch || data.epoch !== sourceData.epoch) throw new Error('导出期间账户或资料版本已改变，请重试。');
        if (!Array.isArray(sourceData.provenance) || sourceData.provenance.length > 500) throw new Error('来源记录导出结构未确认');
        const seen = new Set(), provenance = sourceData.provenance.map(item => { if (seen.has(item.recordId)) throw new Error('来源记录重复'); seen.add(item.recordId); return bg.webProvenance.validate(item, data.records.find(record => record.id === item.recordId)); });
        value = { ...data, annotations: metadata.annotations, flow: flowData.flow, provenance };
      } else {
        const provenance = localProvenance(); if (provenance.error) throw new Error(`来源记录导出未确认：${provenance.error}`);
        value = { ...store.read(), annotations: annotationStore.read().annotations, flow: flowStore?.read().flow || bg.learningFlowStore.emptyFlow(), provenance: provenance.items };
        if (owner !== learningOwner()) throw new Error('导出期间本机资料版本已改变，请重试。');
      }
      download(value, 'breakglass-learning.json'); message('data-status', '已导出当前范围的原记录、备注、作答与独立来源记录；学生确认的候选不代表模型准确性已通过验收。');
    }
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
      : `AB=${fmt(snapshot.AB)}，AC=${fmt(snapshot.AC)} ${snapshot.unit}；A为直角，BC由你求解`;
    svg.append(label);
    const previous = $('scene-stage').querySelector('svg'); if (previous) previous.remove(); $('scene-stage').append(svg);
  }
  function openScene(record, scope) {
    if (destroyed) return;
    if (bg.mathLearning.isExtended(record.template)) {
      closeScene(); $('record-scope').value = scope; switchView('practice'); $('practice-empty').hidden = true;
      mathWorkbench.open(record); flowUI?.selectRecord(record.id); $('math-workbench').scrollIntoView({ block: 'start', behavior: 'auto' }); return;
    }
    mathWorkbench?.reset();
    closeScene(); practiceRecordId = record.id; scene = { record: JSON.parse(JSON.stringify(record)), scope, owner: client.snapshot().generation };
    switchView('practice'); $('practice-empty').hidden = true; $('scene-panel').hidden = false;
    flowUI?.selectRecord(record.id);
    message('scene-title', record.title); message('scene-status', '保存的数学条件已恢复；原视频没有被永久保存。');
    $('camera-yaw').value = '0'; $('camera-pitch').value = '0';
    try {
      drawMathSVG(record.template, record.snapshot); publishScene(record.template, record.snapshot, 'source', record.source);
      const canvas = node('canvas'); canvas.setAttribute('aria-label', '数学实线观察图'); $('scene-stage').append(canvas);
      renderer = bg.particles.createRenderer({ canvas, template: record.template, snapshot: record.snapshot,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        onFallback: () => { canvas.hidden = true;
          ['camera-yaw', 'camera-pitch', 'camera-reset'].forEach((id) => { $(id).disabled = true; });
          message('scene-status', '实线空间视图不可用，已保留二维数学主图和复练条件。'); }
      });
    }
    catch (error) { message('scene-status', `实线空间视图未就绪：${errorMessage(error)}；仍可根据保存的条件复练。`); }
    renderSceneParameters(record.snapshot, record.template); updateSceneBinding(); resetPractice();
    $('scene-apply').disabled = !renderer; $('scene-reset').disabled = !renderer;
    ['camera-yaw', 'camera-pitch', 'camera-reset'].forEach((id) => { $(id).disabled = !renderer || renderer.getState().mode !== 'webgl'; });
    $('scene-title').focus({ preventScroll: true });
  }
  function resetPractice() {
    if (!scene) return;
    practiceEpoch += 1; const help = practiceHelp.get(practiceHelpKey()); hintLevel = help?.hintLevel || 0; answerViewed = Boolean(help?.answerViewed);
    $('practice-panel').hidden = false; $('practice-hint').hidden = true; $('practice-answer').hidden = true;
    ['practice-number', 'practice-h', 'practice-k', 'self-explanation'].forEach((id) => { $(id).value = ''; });
    const triangle = scene.record.template === 'right-triangle';
    $('practice-number-field').hidden = !triangle; $('practice-vertex-fields').hidden = triangle;
    const s = scene.record.snapshot;
    message('practice-question', triangle ? `A 为直角，AB=${s.AB}，AC=${s.AC}（${s.unit}）。先求斜边 BC。`
      : `函数 y=${s.a}(x−${s.h})²+${s.k} 的顶点坐标是什么？`);
    message('practice-status', '答案默认隐藏。提交后由数学程序验证；可选择提示或跳过。');
    const suggestion = project().records.find(item => item.recordId === scene.record.id)?.plan || bg.mathLearning.reviewSuggestion([]);
    $('show-hint').textContent = hintLevel ? `逐步提示（${hintLevel}/3）` : suggestion.suggestedHintCount === 1 ? '先给方向提示（0/3，可继续展开）' : '给一点提示（0/3）'; $('show-hint').disabled = hintLevel === 3;
    if (hintLevel) { $('practice-hint').hidden = false; message('practice-hint', bg.pedagogy.hints(scene.record)[hintLevel - 1]); }
    if (answerViewed) showAnswer();
    message('practice-status', `${suggestion.reason} ${hintLevel || answerViewed ? '该题已用帮助保留；再次作答仍标记为辅助完成。' : '提示可按需继续展开，答案默认隐藏。'}观看不会替代作答。`);
    message('pedagogy-status', '变式与解释需主动保存，使用当前学习记录范围；自我解释不自动评分。');
    $('prediction-options').replaceChildren(); $('apply-prediction').disabled = true; prediction = null;
    message('prediction-status', '可先预测，再查看数学程序的解释；这一操作不计掌握。');
    try {
      prediction = bg.pedagogy.prediction(scene.record); message('prediction-question', prediction.question);
      const captured = scene; const value = prediction;
      value.options.forEach((option) => $('prediction-options').append(button(option.label, () => {
        if (scene !== captured || prediction !== value) return;
        message('prediction-status', `${option.value === value.correct ? '与数学关系一致。' : '再比较一下数学关系。'}${value.explanation}`);
        $('apply-prediction').disabled = false;
      })));
    } catch (error) { message('prediction-question', `当前数值无法生成稳定变化：${errorMessage(error)}`); }
  }
  function showHint() {
    if (!scene) return; hintLevel = Math.min(3, hintLevel + 1); rememberPracticeHelp(); $('practice-hint').hidden = false;
    message('practice-hint', bg.pedagogy.hints(scene.record)[hintLevel - 1]);
    $('show-hint').textContent = `逐步提示（${hintLevel}/3）`; $('show-hint').disabled = hintLevel === 3;
  }
  function showAnswer() {
    if (!scene) return; answerViewed = true; rememberPracticeHelp(); $('practice-answer').hidden = false;
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
  listen(video, 'play', () => { watchTracking = Boolean(chosen); });
  listen(video, 'pause', () => void saveWatch()); listen(video, 'ended', () => void saveWatch());
  listen(video, 'timeupdate', () => { if (Date.now() - lastWatch > 15000 && !video.paused) { lastWatch = Date.now(); void saveWatch(); } });
  $('account-form').addEventListener('submit', (event) => { event.preventDefault(); void authenticate(false); });
  $('register').addEventListener('click', () => void authenticate(true));
  async function authenticate(register) {
    if (register && !deployment.registrationEnabled) { message('account-status', '此试点仅供已审批账户登录。'); return; }
    if (!$('account-form').reportValidity()) return;
    ['login', 'register', 'logout'].forEach((id) => { $(id).disabled = true; });
    try { await client[register ? 'register' : 'login']({ username: $('username').value, password: $('password').value }); $('password').value = ''; }
    catch (error) { message('account-status', errorMessage(error)); }
    finally { $('login').disabled = false; $('register').disabled = !deployment.registrationEnabled; $('logout').disabled = !client.snapshot().user; }
  }
  $('logout').addEventListener('click', async () => { $('logout').disabled = true; try { await client.logout(); message('account-status', '退出已由服务确认；本机访客记录仍保留。'); } catch (error) { message('account-status', `退出未确认：${errorMessage(error)}`); } });
  ['record-scope', 'record-kind', 'record-source'].forEach((id) => $(id).addEventListener('change', () => {
    if (id === 'record-scope') { annotationOwner = null; annotationEditor.close(); mathWorkbench.reset(); closeScene(); stopSession(); }
    renderData();
  }));
  $('refresh-center').addEventListener('click', async () => { try { await client.refresh(); if (client.snapshot().user) await loadAccountData(); else renderData(); } catch (error) { message('center-status', errorMessage(error)); } });
  $('import-selected').addEventListener('click', () => void importSelected()); $('export-records').addEventListener('click', () => void exportData());
  $('clear-local').addEventListener('click', async () => { if (!confirm('清除这台浏览器的本机记录、备注、观看位置、复练与访客分析缓存？账户学习数据不受影响。')) return;
    try { watchTracking = false; video.pause(); localStorage.setItem(CACHE_CLEAR_PENDING, '1'); store.clear(); annotationStore.clear(); if (provenanceStore) provenanceStore.clear(); else localStorage.removeItem(PROVENANCE_KEY); annotationOwner = null; annotationEditor.close(); mathWorkbench.reset(); selectedLocal.clear(); if (scene && scene.scope === 'local') closeScene(); stopSession(); renderData();
      message('center-status', '本机学习记录已清除，正在确认访客分析缓存清除…');
      await clearGuestAnalysis(); message('center-status', '本机记录及访客分析缓存已清除，旧写回已失效。再次主动播放后才记录新位置。');
    } catch (error) { const text = `清除尚未全部确认：${errorMessage(error)}；可在账户设置重试访客缓存清除。`; message('center-status', text); message('cache-lifecycle-status', text); }
  });
  $('clear-guest-cache').addEventListener('click', async () => { try { await clearGuestAnalysis(); message('data-status', '访客分析缓存已清除。'); }
    catch (error) { message('data-status', `访客缓存清除未确认：${errorMessage(error)}。访客分段分析暂时停用，请明确重试。`); } });
  $('clear-account-records').addEventListener('click', async () => { if (!confirm('清除当前账户的学习记录与对应作答？本机记录仍保留。')) return; stopSession(); closeScene(); try { await client.clearRecords(); await loadAccountData(); message('data-status', '当前账户学习记录清除已由服务确认。'); } catch (error) { message('data-status', `清除未确认：${errorMessage(error)}`); } });
  $('delete-account-data').addEventListener('click', async () => { if (!confirm('删除当前账户全部学习记录、观看位置与复练数据？本机访客记录不受影响。')) return; watchTracking = false; video.pause(); stopSession(); closeScene(); try { await client.deleteAccountData(); await loadAccountData(); message('data-status', '当前账户全部学习数据删除已由服务确认。再次主动播放后才开始记录新观看位置。'); } catch (error) { message('data-status', `删除未确认：${errorMessage(error)}`); } });
  $('scene-apply').addEventListener('click', () => { if (!scene || !renderer) return; try { const snapshot = { ...scene.record.snapshot }; $('scene-parameters').querySelectorAll('input').forEach((input) => { if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new Error('请输入有限参数。'); snapshot[input.dataset.parameter] = input.valueAsNumber; }); if (!records.validSnapshot(scene.record.template, snapshot)) throw new Error('数学条件无效。'); drawMathSVG(scene.record.template, snapshot); renderer.update(snapshot); publishScene(scene.record.template, snapshot, 'exploration', scene.record.source); message('scene-status', '参数探索已更新；保存记录和复练题目仍保留原条件。'); } catch (error) { message('scene-status', errorMessage(error)); } });
  $('scene-reset').addEventListener('click', () => { if (scene && renderer) { renderer.update(scene.record.snapshot); publishScene(scene.record.template, scene.record.snapshot, 'source', scene.record.source); drawMathSVG(scene.record.template, scene.record.snapshot); renderSceneParameters(scene.record.snapshot, scene.record.template); message('scene-status', '已恢复保存的数学条件。'); } });
  ['camera-yaw', 'camera-pitch'].forEach((id) => $(id).addEventListener('input', () => { if (renderer) renderer.setView({ yaw: Number($('camera-yaw').value) * Math.PI / 180, pitch: Number($('camera-pitch').value) * Math.PI / 180 }); }));
  $('camera-reset').addEventListener('click', () => { $('camera-yaw').value = '0'; $('camera-pitch').value = '0'; if (renderer) renderer.resetView(); });
  $('scene-return').addEventListener('click', () => { if (!scene || !sameFile(scene.record.source)) return; switchView('import'); video.currentTime = Math.min(scene.record.time, video.duration); video.focus(); });
  $('scene-close').addEventListener('click', closeScene); $('practice-form').addEventListener('submit', submitPractice);
  $('show-hint').addEventListener('click', showHint); $('show-answer').addEventListener('click', showAnswer);
  $('apply-prediction').addEventListener('click', () => {
    if (!scene || !prediction) return;
    try { drawMathSVG(scene.record.template, prediction.snapshot); if (renderer) renderer.update(prediction.snapshot); publishScene(scene.record.template, prediction.snapshot, 'exploration', scene.record.source);
      renderSceneParameters(prediction.snapshot, scene.record.template); message('scene-status', '已用程序验证预测变化；正式复练仍使用保存的原条件，可恢复原条件。'); }
    catch (error) { message('prediction-status', errorMessage(error)); }
  });
  async function savePedagogy(kind) {
    if (!scene) return;
    const captured = scene; const owner = client.snapshot(); const localEpoch = store.read().epoch;
    const buttonId = kind === 'variant' ? 'create-variant' : 'save-explanation'; $(buttonId).disabled = true;
    try {
      const record = kind === 'variant' ? bg.pedagogy.createVariant(captured.record, { index: variantIndex % 20 + 1 })
        : bg.pedagogy.createExplanation(captured.record, { text: $('self-explanation').value });
      if (captured.scope === 'account') await client.saveRecord(record); else store.save(record, localEpoch);
      if (scene !== captured || client.snapshot().generation !== owner.generation) return;
      await savePurpose(record.id, kind === 'variant' ? 'practice' : 'reflection');
      if (captured.scope === 'account') await loadAccountData(); else renderData();
      if (scene !== captured || client.snapshot().generation !== owner.generation) return;
      if (kind === 'variant') { variantIndex += 1; openScene(record, captured.scope); message('pedagogy-status', '程序变式已单独保存。原题条件保留；现在可以独立提交新题答案。'); }
      else message('pedagogy-status', '学生解释已保存为独立疑问笔记；没有自动评分，也没有生成作答结论。');
    } catch (error) { if (scene === captured) message('pedagogy-status', `未保存：${errorMessage(error)}`); }
    finally { $(buttonId).disabled = false; }
  }
  $('create-variant').addEventListener('click', () => void savePedagogy('variant'));
  $('save-explanation').addEventListener('click', () => void savePedagogy('explanation'));
  $('skip-practice').addEventListener('click', () => { practiceEpoch += 1; $('practice-panel').hidden = true; message('scene-status', '已跳过本次复练；没有生成作答或错误记录。'); });
  $('mixed-practice').addEventListener('click', () => { try {
    const data = activeData(); if (!data.records.length) { message('center-status', '还没有可复练的数学记录。'); return; }
    const eligible = project(data).queue.manual.map(item => item.record);
    const groups = ['parabola', 'right-triangle', ...bg.mathLearning.TEMPLATE_IDS].map((template) => eligible.filter(record => record.template === template));
    if (!groups.some((group) => group.length)) { message('center-status', '请先在课程微闭环中把记录分类为练习题；解释笔记不会加入混练。'); return; }
    const items = []; for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) {
      groups.forEach((group) => { if (group[index]) items.push(group[index]); });
    }
    const current = items.findIndex((record) => record.id === practiceRecordId);
    openScene(items[(current + 1) % items.length], $('record-scope').value);
  } catch (error) { message('center-status', errorMessage(error)); } });
  $('plugin-json').addEventListener('change', () => { if ($('plugin-json').files[0]) void importPluginFile($('plugin-json').files[0]); }); $('accept-plugin-records').addEventListener('click', acceptPluginRecords);
  const accountRefreshTimer = setInterval(() => {
    if (isActive() && !document.hidden && client.snapshot().user && !accountLoading) void client.refresh().catch(() => {});
  }, 10000);
  function destroy() { if (destroyed) return; destroyed = true; loadEpoch += 1; clearInterval(accountRefreshTimer); listeners.splice(0).forEach((remove) => remove()); pairing.destroy(); contextUI.destroy(); progressiveUI.destroy(); audioUI.destroy(); annotationEditor.close(); mathWorkbench.destroy(); flowUI?.destroy(); if (sampleController) sampleController.abort(); if (policyController) policyController.abort(); importer.reset(); closeScene(); client.invalidate(); }
  listen(window, 'pagehide', destroy);
  listen(window, 'storage', (event) => {
    if ($('record-scope').value !== 'local') return;
    if (event.key === null || [records.KEY, bg.webAnnotations.KEY, bg.learningFlowStore?.KEY, PROVENANCE_KEY].includes(event.key)) {
      renderData();
      if (annotationRecordId) message('center-status', '本机学习资料已更新；备注输入保留，保存遇修订冲突时请重新读取版本。');
    }
  });
  listen(window, 'focus', () => { if (!isActive() || document.hidden) return; if (client.snapshot().user) void client.refresh().catch(() => {}); else renderData(); });
  listen(document, 'visibilitychange', () => { if (!document.hidden && isActive()) { if (client.snapshot().user) void client.refresh().catch(() => {}); else renderData(); } });
  if (flowStore && bg.learningFlowUI && $('learning-flow-workbench')) flowUI = bg.learningFlowUI.mount($('learning-flow-workbench'), { document, getState: () => ({ ...activeData(), scope: $('record-scope').value, user: client.snapshot().user, epoch: $('record-scope').value === 'account' ? client.snapshot().epoch : store.read().epoch }), getOwner: learningOwner, getSaveTarget, localStore: flowStore, recordsStore: store, annotationStore, accountClient: client, onChanged: () => $('record-scope').value === 'account' ? loadAccountData() : renderData() });
  renderData(); switchView('overview');
  void fetch('/api/deployment', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('运行入口状态读取失败。');
    const value = await response.json();
    if (!['local-development', 'production-pilot'].includes(value.mode) || typeof value.registrationEnabled !== 'boolean') throw new Error('运行入口状态无效。');
    deployment = { mode: value.mode, registrationEnabled: value.registrationEnabled };
    $('register').disabled = !deployment.registrationEnabled;
    if (deployment.mode === 'production-pilot') {
      message('deployment-notice', '已配置的单实例试点，仅供已审批账户登录。素材处理和地区许可须保持有效；B站处理许可仍待确认。');
      message('deployment-footer', 'BreakGlass · 已配置试点。数学由程序绘制，实际托管、真实模型与学习效果分别验收。');
      $('plugin-pairing').hidden = true;
      const state = client.snapshot();
      if (state.user) message('top-identity', `${state.user.username} · 已审批试点账户`);
    }
  }).catch(() => { $('register').disabled = true; deployment.registrationEnabled = false;
    message('deployment-notice', '运行入口状态尚未确认，请稍后刷新；本机手工数学与记录仍可使用。'); });
  if (localStorage.getItem(CACHE_CLEAR_PENDING)) message('cache-lifecycle-status', '此前访客缓存清除尚未确认；请在账户设置重试后继续访客分段分析。');
  client.refresh().catch((error) => { message('account-status', `账户服务暂不可用：${errorMessage(error)}。本机学习仍可用。`); });
  return { setActive(value) { active = Boolean(value); if (!active) { candidateSelection += 1; stopSession(); } }, snapshot: mediaSnapshot, chooseFile, loadSample: sample, openSnapshot: openScene, saveSnapshot: async (input, purpose = 'unclassified') => { if (destroyed) throw new Error('学习工作台已关闭。'); const record = records.validateRecord(input); const owner = learningOwner(); if ($('record-scope').value === 'account') await client.saveRecord(record); else store.save(record, store.read().epoch); if (owner !== learningOwner()) throw new Error('学习范围已改变。'); if (purpose !== 'unclassified') await savePurpose(record.id, purpose); if ($('record-scope').value === 'account') await loadAccountData(); else renderData(); return record; }, stop: stopSession, switchView, destroy, context: { document, container, getState: activeData, getOwner: learningOwner, getSaveTarget, getVisualSession, prepareRecognitionSession, refreshData: () => $('record-scope').value === 'account' ? loadAccountData() : Promise.resolve(renderData()), client, store } };
  }
  bg.learningApp = { mount };
  if (root.document?.getElementById('learning-video')) {
    let recognition = null, permissionGeneration = 0, scopeIdentity = '', closed = false;
    const stopRecognition = () => { permissionGeneration += 1; recognition?.stop(); recognition?.refresh(); };
    const page = mount(root.document.body, {
      onMediaChange: stopRecognition, onOwnerChange: stopRecognition,
      onScopeChange: target => { const next = `${target.scope}:${target.owner}:${target.epoch}`; if (scopeIdentity !== next) { scopeIdentity = next; stopRecognition(); } else recognition?.refresh(); },
      onViewChange: view => { if (view !== 'import') stopRecognition(); else recognition?.refresh(); }
    });
    bg.learningApp.page = page;
    const host = root.document.getElementById('recognition-workbench');
    const stop = page.stop, destroy = page.destroy;
    page.stop = (...args) => { stopRecognition(); return stop(...args); };
    page.destroy = () => {
      if (closed) return; closed = true; permissionGeneration += 1;
      root.removeEventListener('pagehide', page.destroy);
      root.document.getElementById('stop-analysis')?.removeEventListener('click', stopRecognition);
      recognition?.destroy(); destroy();
    };
    root.document.getElementById('stop-analysis')?.addEventListener('click', stopRecognition);
    root.addEventListener('pagehide', page.destroy);
    if (host && bg.recognitionWorkbench) {
      try { recognition = bg.recognitionWorkbench.mount(host, {
        learning: page, video: root.document.getElementById('learning-video'),
        isActive: () => !closed && page.snapshot().view === 'import', getPermissionGeneration: () => permissionGeneration
      }); }
      catch (error) { page.destroy(); host.textContent = `学习工作台初始化未确认：${error.message}。请刷新后重试。`; }
    }
  }
})(globalThis);
