(function (root) {
  'use strict';
  if (!['localhost', '127.0.0.1'].includes(root.location.hostname)) return;
  const document = root.document;
  const bg = root.BreakGlass;
  const create = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
  function selectors(value) {
    const items = []; let depth = 0; let start = 0;
    for (let i = 0; i < value.length; i += 1) { if ('(['.includes(value[i])) depth += 1; if (')]'.includes(value[i])) depth -= 1; if (value[i] === ',' && !depth) { items.push(value.slice(start, i)); start = i + 1; } }
    items.push(value.slice(start)); return items;
  }
  function mountWorkspace() {
    if (bg.workspace) return bg.workspace;
    const abort = new AbortController(); let generation = 0; let disposed = false;
    const listeners = []; const nodes = []; const controllers = []; const ownedDocks = [];
    let restoreDOM = null; let stopAllReaders = () => {}; let state = 'initializing';
    let errorUI = null; let removeRetry = null;
    const api = { destroy() {
      removeRetry?.(); removeRetry = null; errorUI?.remove(); errorUI = null;
      if (disposed) return;
      stopAllReaders(); disposed = true; generation += 1; state = 'destroyed'; abort.abort();
      listeners.splice(0).forEach((remove) => remove());
      controllers.splice(0).reverse().forEach((controller) => { try { controller?.destroy?.(); } catch {} });
      if (Array.isArray(root.BreakGlassUI?.docks)) root.BreakGlassUI.docks = root.BreakGlassUI.docks.filter((dock) => !ownedDocks.includes(dock));
      restoreDOM?.(); nodes.splice(0).reverse().forEach((node) => node.remove());
      if (bg.workspace === api) bg.workspace = null;
    }, snapshot: () => ({ state }) };
    bg.workspace = api;
    const initialGeneration = generation;
    function guard() { if (disposed || generation !== initialGeneration) throw new DOMException('工作台已关闭', 'AbortError'); }
    function listen(target, ...args) { target.addEventListener(...args); listeners.push(() => target.removeEventListener(...args)); }
    function own(controller) { guard(); controllers.push(controller); return controller; }
    async function textResource(path, message) {
      guard(); const response = await fetch(path, { signal: abort.signal }); guard();
      if (!response.ok) throw new Error(message);
      const text = await response.text(); guard(); return text;
    }
  async function scopeStyles(path, scope) {
    const css = await textResource(path, '工作台样式加载失败。');
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    function rules(items) { return Array.from(items).map((rule) => {
      if (rule.type === 1) {
        const scoped = selectors(rule.selectorText).filter((s) => ![':root', 'body'].includes(s.trim())).map((s) => `${scope} ${s.trim().replace(/#([\w-]+)/g, '[data-bg-id="$1"]')}`);
        return scoped.length ? `${scoped.join(',')} { ${rule.style.cssText} }` : '';
      }
      if (rule.type === 4) return `@media ${rule.conditionText} { ${rules(rule.cssRules)} }`;
      return '';
    }).join('\n'); }
    guard(); const style = create('style'); style.textContent = rules(sheet.cssRules); nodes.push(style); document.head.append(style);
  }
  async function markup(path, container) {
    const html = await textResource(path, '工作台内容加载失败。');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach((node) => node.remove());
    parsed.querySelectorAll('a[href]').forEach((node) => { if (!node.getAttribute('href').startsWith('#')) node.removeAttribute('href'); });
    guard(); parsed.body.childNodes.forEach((node) => container.append(document.importNode(node, true)));
  }
  async function loadLearningModules() {
    const paths = ['/learning-site/account-client.js', '/learning-site/records.js', '/learning-site/pedagogy.js', '/learning-site/annotations.js', '/learning-site/annotation-editor.js', '/learning-site/math-workbench.js', '/learning-site/import.js', '/learning-site/visual-session.js', '/learning-site/pairing.js', '/learning-site/context.js', '/learning-site/analysis-cache.js', '/learning-site/progressive.js', '/learning-site/audio.js', '/learning-site/learning-flow.js', '/learning-site/learning-evidence.js', '/learning-site/learning-flow-store.js', '/learning-site/learning-flow-ui.js', '/learning-site/live-particles.js', '/extension/src/plugin/recognition-contracts.js', '/learning-site/provenance.js', '/learning-site/recognition-workbench.js', '/learning-site/app.js'];
    for (const path of paths) {
      guard();
      await new Promise((resolve, reject) => {
        const script = create('script'); script.src = path; nodes.push(script);
        const finish = (error) => { script.onload = null; script.onerror = null; abort.signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve(); };
        const cancelled = () => { script.remove(); finish(new DOMException('工作台已关闭', 'AbortError')); };
        script.onload = () => finish();
        script.onerror = () => finish(new Error('学习模块加载失败。'));
        abort.signal.addEventListener('abort', cancelled, { once: true }); document.head.append(script);
      });
      guard();
    }
  }
  async function start() {
    await loadLearningModules();
    guard();
    const curveRoot = create('section', 'workspace-curve'); curveRoot.setAttribute('aria-label', '视频曲线实验');
    const original = Array.from(document.body.childNodes);
    const shell = create('main', 'unified-workspace'); shell.id = 'learning-workspace-root';
    const header = create('header', 'workspace-header');
    header.append(create('p', 'eyebrow', 'BREAKGLASS · 学习工作台'), create('h1', '', '让视频里的数学，成为自己的理解。'));
    const identity = create('p', 'workspace-identity', '本机访客 · 学习记录与账户数据分别保存'); header.append(identity);
    const nav = create('nav', 'workspace-tabs'); nav.setAttribute('aria-label', '学习工作台功能');
    const labels = { import: '视频与识别', curve: '曲线实验', geometry: '几何实验', overview: '学习概览', records: '疑问与易错', practice: '理解复练', watch: '观看进度', account: '账户与设置' };
    const buttons = new Map();
    for (const [key, label] of Object.entries(labels)) { const button = create('button', '', label); button.type = 'button'; button.dataset.workspaceView = key; buttons.set(key, button); nav.append(button); }
    const status = create('p', 'workspace-status', '正在准备同页工作台…'); status.setAttribute('role', 'status');
    const layout = create('div', 'workspace-layout');
    const mediaColumn = create('section', 'workspace-media'); mediaColumn.setAttribute('aria-label', '唯一当前视频');
    const content = create('div', 'workspace-content'); const learningRoot = create('section', 'workspace-learning'); const geometryRoot = create('section', 'workspace-geometry');
    const stage = document.getElementById('video-stage'); const video = document.getElementById('demo-video');
    if (!stage || !video) throw new Error('当前视频入口不存在。');
    const stageParent = stage.parentNode; const stageNext = stage.nextSibling;
    const originalAttributes = Array.from(document.body.querySelectorAll('*')).map((node) => [node,
      ['id', 'data-bg-id', 'for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'data-dock-reveal', 'href', 'filter'].map((name) => [name, node.getAttribute(name)])]);
    restoreDOM = () => {
      if (stageParent) stageParent.insertBefore(stage, stageNext?.parentNode === stageParent ? stageNext : null);
      originalAttributes.forEach(([node, attrs]) => attrs.forEach(([name, value]) => value == null ? node.removeAttribute(name) : node.setAttribute(name, value)));
      original.forEach((node) => document.body.append(node));
    };
    const aliases = { 'demo-video': video, 'video-stage': stage };
    stage.querySelectorAll('[id]').forEach((el) => { aliases[el.id] = el; });
    mediaColumn.append(stage);
    const readerLabel = create('label', 'workspace-reader-permission'); const readerOptIn = create('input'); readerOptIn.type = 'checkbox';
    readerLabel.append(readerOptIn, create('span', '', '主动启用当前获准素材的同源 reader 转发'));
    mediaColumn.append(readerLabel, create('p', 'muted', '识别固定由当前工作台转发到本机 reader。只有素材登记允许、主动勾选且实验面板活动时，才能显式发送画面；加载示例和换页不会自动识别。'));
    const particleContainer = create('section', 'workspace-particle-card'); particleContainer.id = 'workspace-particles'; particleContainer.setAttribute('aria-label', '已确认数学场景的实线观察'); mediaColumn.append(particleContainer);
    content.append(learningRoot, curveRoot, geometryRoot); layout.append(mediaColumn, content); shell.append(header, nav, status, layout);
    for (const node of original) if (node.nodeType !== 1 || node.tagName !== 'SCRIPT') curveRoot.append(node);
    nodes.push(shell); document.body.append(shell);
    await Promise.all([markup('/learning-site/index.html', learningRoot), markup('/extension/demo/geometry.html', geometryRoot), scopeStyles('/learning-site/site.css', '.workspace-learning'), scopeStyles('/extension/demo/geometry.css', '.workspace-geometry'), scopeStyles('/extension/demo/demo.css', '.workspace-curve')]);
    guard();
    const workspaceStyle = document.querySelector('link[href="./workspace.css"]'); if (workspaceStyle) document.head.append(workspaceStyle);
    learningRoot.querySelector('#learning-video')?.closest('.video-stage')?.remove();
    geometryRoot.querySelector('#geometry-video')?.remove();
    const geometryBanner = geometryRoot.querySelector('#geometry-banner');
    nodes.push(geometryBanner);
    const geometryAliases = { 'geometry-video': video, 'geometry-stage': stage, 'geometry-banner': geometryBanner };
    geometryBanner.querySelectorAll('[id]').forEach((el) => { geometryAliases[el.id] = el; });
    stage.append(geometryBanner);
    const curveDocument = bg.mountContext.createDocument(curveRoot, { aliases, prefix: 'curve' });
    const learningDocument = bg.mountContext.createDocument(learningRoot, { aliases: { 'learning-video': video }, prefix: 'learning' });
    const geometryDocument = bg.mountContext.createDocument(geometryRoot, { aliases: geometryAliases, prefix: 'geometry' });
    document.querySelectorAll('[data-liquid-glass]').forEach((node) => { node.dataset.refract = 'off'; });
    if (root.BreakGlassUI?.LiquidGlassDock) {
      const dock = own(new root.BreakGlassUI.LiquidGlassDock(geometryDocument.getElementById('geometry-toolbar')));
      ownedDocks.push(dock);
      root.BreakGlassUI.docks = [...(root.BreakGlassUI.docks || []), dock];
    }
    curveDocument.getElementById('current-frame-help').textContent = '识别地址固定为当前工作台的同源转发，不读取或记忆旧地址。素材许可确认、主动勾选启用和曲线面板活动后，才可显式识别当前帧。';
    geometryDocument.getElementById('reader-hint').textContent = '识别地址固定为当前工作台的同源转发。素材许可确认、主动勾选启用和几何面板活动后，才可显式识别或发送模型问题；这里不填写模型密钥。';
    let current = 'import'; let learning = null; let curve = null; let geometry = null; let recognition = null; let media = null; let requestedSample = null; let sampleSelecting = false; let mediaChoiceSequence = 0;
    let permissionGeneration = 0; let saveSequence = 0; let saving = false;
    let saveTarget = { scope: 'local', label: '保存范围尚未确认', owner: null, epoch: null, canSave: false };
    const particles = own(bg.liveParticles.mount(particleContainer, { document }));
    const scenes = { curve: null, geometry: null, learning: null };
    const saveForm = create('form', 'workspace-save-scene'); saveForm.hidden = true;
    const saveTitle = create('input'); saveTitle.maxLength = 120; saveTitle.required = true; saveTitle.value = '我的数学探索';
    const saveLabel = create('label', '', '保存当前探索为新的数学练习'); saveLabel.append(saveTitle);
    const saveKind = create('select'); for (const [value, text] of [['question', '疑问'], ['pitfall', '个人易错标记']]) { const option = create('option', '', text); option.value = value; saveKind.append(option); }
    const kindLabel = create('label', '', '记录类型'); kindLabel.append(saveKind);
    const saveNote = create('textarea'); saveNote.maxLength = 1000; saveNote.rows = 2;
    const noteLabel = create('label', '', '我想回顾的地方（可选）'); noteLabel.append(saveNote);
    const saveButton = create('button', '', '保存练习记录并进入复练'); saveButton.type = 'submit';
    const saveScope = create('p', 'workspace-save-scope'); saveScope.dataset.saveScope = 'workspace';
    const confirmButton = create('button', '', '我已核对这些数学条件'); confirmButton.type = 'button'; confirmButton.hidden = true;
    const saveStatus = create('p', 'muted', '保存到当前学习范围；仅保存数学条件，不保存视频。原题与当前探索分别保留。'); saveStatus.setAttribute('role', 'status');
    saveForm.append(saveLabel, kindLabel, noteLabel, confirmButton, saveScope, saveButton, saveStatus); mediaColumn.append(saveForm);
    function showScene(scene) { particles.update(scene); saveForm.hidden = !['curve', 'geometry'].includes(current) || (!scene?.confirmed && !scene?.requiresConfirmation); confirmButton.hidden = !scene?.requiresConfirmation; saveButton.disabled = saving || !saveTarget.canSave || !scene?.confirmed; }
    function revokeReader(clearOptIn = true) {
      permissionGeneration += 1;
      if (clearOptIn) readerOptIn.checked = false;
      curve?.stopReader(); geometry?.stopReader(); recognition?.stop?.();
    }
    stopAllReaders = revokeReader;
    function scopeChanged(target) {
      if (disposed) return;
      const previousOwner = saveTarget.owner;
      const changed = saveTarget.owner !== target.owner || saveTarget.epoch !== target.epoch || saveTarget.scope !== target.scope;
      saveTarget = { ...target };
      if (changed) {
        revokeReader(); saveSequence += 1; saving = false;
        if (previousOwner !== null) {
          scenes.curve = null; scenes.geometry = null; scenes.learning = null;
          if (media) { media = { ...media, owner: target.owner, epoch: target.epoch }; curve?.onMediaChange(media); geometry?.onMediaChange(media); }
        }
      }
      saveScope.textContent = `保存到：${saveTarget.label}${saveTarget.canSave ? '' : ' · 保存条件尚未确认'}`;
      identity.textContent = `当前保存范围：${saveTarget.label}`;
      showScene(scenes[['curve','geometry'].includes(current) ? current : 'learning']);
      recognition?.refresh?.();
    }
    const publish = (owner) => (scene) => { if (disposed) return; scenes[owner] = scene; if (current === owner || (owner === 'learning' && !['curve', 'geometry'].includes(current))) { showScene(scene);
      saveStatus.textContent = scene?.degeneracy === 'zero-amplitude-sine' ? '零振幅已退化为常值函数，没有最小正周期；保存为直线模板练习。' : '保存到当前学习范围；仅保存数学条件，不保存视频。原题与当前探索分别保留。'; } };
    function activate(next, fromLearning = false) {
      if (disposed) return;
      if (next !== current) revokeReader(false);
      current = next; const mathPanel = ['curve', 'geometry'].includes(next);
      learningRoot.hidden = mathPanel; curveRoot.hidden = next !== 'curve'; geometryRoot.hidden = next !== 'geometry';
      learning?.setActive(!mathPanel); curve?.setActive(next === 'curve'); geometry?.setActive(next === 'geometry');
      if (!mathPanel && !fromLearning) learning?.switchView(next);
      buttons.forEach((button, key) => { if (key === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
      showScene(scenes[mathPanel ? next : 'learning']);
      aliases['stage-banner'].hidden = next !== 'curve';
      geometryBanner.hidden = next !== 'geometry';
      recognition?.refresh?.();
    }
    const canRead = () => Boolean(!disposed && document.visibilityState !== 'hidden' && readerOptIn.checked && media?.policy?.allowed && media?.selection && media.source?.id === media.selection.source.id && media.source.version === media.selection.source.version);
    const getPermissionGeneration = () => permissionGeneration;
    function mediaChanged(snapshot) {
      if (disposed) return;
      if (!snapshot.selection && !sampleSelecting) requestedSample = null;
      const changed = media?.generation !== snapshot.generation || media?.owner !== snapshot.owner || media?.source?.id !== snapshot.source?.id || media?.source?.version !== snapshot.source?.version;
      const permissionLost = media?.policy?.allowed && !snapshot.policy?.allowed;
      media = { ...snapshot, epoch: learning?.context.getSaveTarget?.().epoch ?? saveTarget.epoch, sample: requestedSample?.kind || null, clip: requestedSample?.clip || null };
      if (changed || permissionLost) revokeReader();
      if (changed) { saveSequence += 1; saving = false; scenes.curve = null; scenes.geometry = null; scenes.learning = null; particles.update(null); saveForm.hidden = true; }
      curve?.onMediaChange(media); geometry?.onMediaChange(media);
      readerOptIn.disabled = !media.policy?.allowed;
      status.textContent = media.selection ? `${media.selection.name} · ${media.policy?.allowed ? '素材登记允许，识别需主动开始' : '本地预览与手工数学可用，AI许可未确认'} · 当前视频只由一个文件入口管理` : '选择本地视频或项目自制素材开始。';
      if (learning?.context.getSaveTarget) scopeChanged(learning.context.getSaveTarget());
      recognition?.refresh?.();
    }
    async function chooseFile(file, panel) { if (disposed) return; const sequence = ++mediaChoiceSequence; revokeReader(); requestedSample = null; sampleSelecting = false; await learning.chooseFile(file); if (!disposed && sequence === mediaChoiceSequence) activate(panel); }
    async function chooseSample(path, name, panel, clip = null) {
      if (disposed) return; const sequence = ++mediaChoiceSequence; revokeReader(); requestedSample = { kind: clip ? 'geometry' : 'parabola', clip }; sampleSelecting = true;
      try { const selected = await learning.loadSample(new URL(path, document.location.href).pathname, name, { targetTime: clip?.target }); if (!disposed && sequence === mediaChoiceSequence && selected) activate(panel); }
      finally { if (sequence === mediaChoiceSequence) sampleSelecting = false; }
    }
    learning = own(bg.learningApp.mount(learningRoot, { document: learningDocument, video, isActive: () => !disposed && !['curve', 'geometry'].includes(current), onMediaChange: mediaChanged, onScopeChange: scopeChanged, onViewChange: (next) => activate(next, true), onScene: publish('learning') }));
    curve = own(bg.curvePage.mount(curveRoot, { document: curveDocument, video, stage, fixedReaderEndpoint: new URL('/read', document.location.href).href, isActive: () => !disposed && current === 'curve', canRead, getPermissionGeneration, onSelectFile: (file) => chooseFile(file, current === 'curve' ? 'curve' : 'import'), onSelectSample: (path, name) => chooseSample(path, name, current === 'curve' ? 'curve' : 'import'), onScene: publish('curve') }));
    geometry = own(bg.geometryPage.mount(geometryRoot, { document: geometryDocument, video, fixedReaderEndpoint: document.location.origin, isActive: () => !disposed && current === 'geometry', canRead, getPermissionGeneration, onSelectFile: (file) => chooseFile(file, 'geometry'), onSelectSample: (path, name, clip) => chooseSample(path, name, 'geometry', clip), onScene: publish('geometry') }));
    const recognitionHost = learningDocument.getElementById('recognition-workbench');
    if (!recognitionHost || !bg.recognitionWorkbench?.mount) throw new Error('识别工作台加载未完成。');
    recognition = own(bg.recognitionWorkbench.mount(recognitionHost, { learning, video, canRead, getPermissionGeneration, onScene: publish('learning'), isActive: () => !disposed && current === 'import' }));
    buttons.forEach((button, key) => listen(button, 'click', () => activate(key)));
    listen(readerOptIn, 'change', () => { revokeReader(!canRead()); });
    listen(confirmButton, 'click', () => { if (!disposed && current === 'curve') curve.confirmScene?.(); });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') revokeReader(); });
    listen(root, 'pagehide', api.destroy);
    listen(saveForm, 'submit', async (event) => {
      event.preventDefault(); if (disposed || saving) return;
      scopeChanged(learning.context.getSaveTarget());
      const scene = scenes[current]; const target = { ...saveTarget }; const selected = media; const sequence = ++saveSequence;
      const stillCurrent = () => {
        const currentTarget = learning.context.getSaveTarget();
        const sameMedia = selected?.generation === media?.generation && selected?.owner === media?.owner && selected?.epoch === media?.epoch &&
          selected?.source?.id === media?.source?.id && selected?.source?.version === media?.source?.version;
        return !disposed && sequence === saveSequence && currentTarget.canSave && target.scope === currentTarget.scope && target.owner === currentTarget.owner && target.epoch === currentTarget.epoch && sameMedia;
      };
      if (!target.canSave || !scene?.confirmed) return;
      if (!bg.webRecords.validSnapshot(scene.template, scene.snapshot)) { saveStatus.textContent = '当前探索超出可保存的数学模板范围，请调整参数后重试。'; return; }
      saving = true; saveButton.disabled = true;
      try {
        const id = crypto.randomUUID(); const file = selected?.source?.id;
        const source = { kind: 'manual-notes', id: file ? `manual-${file}` : `study-${id}`, version: selected?.source?.version || '1', analysisVersion: '1', materialMode: 'self-authored', title: '学生独立数学探索' };
        const record = await learning.saveSnapshot({ id, kind: saveKind.value, source, time: file ? video.currentTime : 0, title: saveTitle.value.trim(), note: saveNote.value.trim() || (scene.degeneracy === 'zero-amplitude-sine' ? '零振幅退化为常值函数，没有最小正周期；以直线模板回顾。' : '我想再次理解这些数学条件。'), template: scene.template, snapshot: { ...scene.snapshot }, origin: 'manual', sourceLabel: '学生确认的当前探索条件；程序绘制，非新增视频识别', createdAt: new Date().toISOString() }, 'practice');
        if (!stillCurrent()) return;
        learning.openSnapshot(record, target.scope); activate('practice'); saveStatus.textContent = `数学练习已保存到${target.label}；可在疑问与易错中回顾。`;
      } catch (error) { if (stillCurrent()) saveStatus.textContent = `保存未确认：${error.message}`; }
      finally { if (!disposed && sequence === saveSequence) { saving = false; showScene(scenes[['curve','geometry'].includes(current) ? current : 'learning']); } }
    });
    Object.assign(api, { learning, curve, geometry, recognition, activate, snapshot: () => ({ state, activePanel: current, media, permissionGeneration, saveTarget: { ...saveTarget }, particle: particles.getState() }) });
    state = 'ready';
    activate('import'); mediaChanged(learning.snapshot());
    if (learning.context.getSaveTarget) scopeChanged(learning.context.getSaveTarget());
  }
    api.ready = start().catch((error) => {
      if (disposed) return;
      api.destroy(); state = 'failed';
      const el = create('div', 'workspace-error', `工作台加载未完成：${error.message}。`); el.setAttribute('role', 'alert');
      const retry = create('button', '', '重新加载工作台'); retry.type = 'button';
      const retryMount = () => { api.destroy(); mountWorkspace(); };
      errorUI = el; removeRetry = () => retry.removeEventListener('click', retryMount);
      retry.addEventListener('click', retryMount, { once: true }); el.append(retry); document.body.append(el);
    });
    return api;
  }
  mountWorkspace();
})(globalThis);
