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
  async function scopeStyles(path, scope) {
    const response = await fetch(path); if (!response.ok) throw new Error('工作台样式加载失败。');
    const sheet = new CSSStyleSheet(); sheet.replaceSync(await response.text());
    function rules(items) { return Array.from(items).map((rule) => {
      if (rule.type === 1) {
        const scoped = selectors(rule.selectorText).filter((s) => ![':root', 'body'].includes(s.trim())).map((s) => `${scope} ${s.trim().replace(/#([\w-]+)/g, '[data-bg-id="$1"]')}`);
        return scoped.length ? `${scoped.join(',')} { ${rule.style.cssText} }` : '';
      }
      if (rule.type === 4) return `@media ${rule.conditionText} { ${rules(rule.cssRules)} }`;
      return '';
    }).join('\n'); }
    const style = create('style'); style.textContent = rules(sheet.cssRules); document.head.append(style);
  }
  async function markup(path, container) {
    const response = await fetch(path); if (!response.ok) throw new Error('工作台内容加载失败。');
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    parsed.querySelectorAll('script').forEach((node) => node.remove());
    parsed.querySelectorAll('a[href]').forEach((node) => { if (!node.getAttribute('href').startsWith('#')) node.removeAttribute('href'); });
    parsed.body.childNodes.forEach((node) => container.append(document.importNode(node, true)));
  }
  async function loadLearningModules() {
    const paths = ['/learning-site/account-client.js', '/learning-site/records.js', '/learning-site/pedagogy.js', '/learning-site/annotations.js', '/learning-site/annotation-editor.js', '/learning-site/math-workbench.js', '/learning-site/import.js', '/learning-site/visual-session.js', '/learning-site/pairing.js', '/learning-site/context.js', '/learning-site/analysis-cache.js', '/learning-site/progressive.js', '/learning-site/audio.js', '/learning-site/learning-flow.js', '/learning-site/learning-flow-store.js', '/learning-site/learning-flow-ui.js', '/learning-site/live-particles.js', '/learning-site/app.js'];
    for (const path of paths) await new Promise((resolve, reject) => { const script = create('script'); script.src = path; script.onload = resolve; script.onerror = () => reject(new Error('学习模块加载失败。')); document.head.append(script); });
  }
  async function start() {
    await loadLearningModules();
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
    const aliases = { 'demo-video': video, 'video-stage': stage };
    stage.querySelectorAll('[id]').forEach((el) => { aliases[el.id] = el; });
    mediaColumn.append(stage);
    const readerLabel = create('label', 'workspace-reader-permission'); const readerOptIn = create('input'); readerOptIn.type = 'checkbox';
    readerLabel.append(readerOptIn, create('span', '', '主动启用当前获准素材的同源 reader 转发'));
    mediaColumn.append(readerLabel, create('p', 'muted', '识别固定由当前工作台转发到本机 reader。只有素材登记允许、主动勾选且实验面板活动时，才能显式发送画面；加载示例和换页不会自动识别。'));
    const particleContainer = create('section', 'workspace-particle-card'); particleContainer.id = 'workspace-particles'; particleContainer.setAttribute('aria-label', '已确认数学场景的实线观察'); mediaColumn.append(particleContainer);
    content.append(learningRoot, curveRoot, geometryRoot); layout.append(mediaColumn, content); shell.append(header, nav, status, layout);
    for (const node of original) if (node.nodeType !== 1 || node.tagName !== 'SCRIPT') curveRoot.append(node);
    curveRoot.querySelector('.workspace-nav')?.remove();
    document.body.append(shell);
    await Promise.all([markup('/learning-site/index.html', learningRoot), markup('/extension/demo/geometry.html', geometryRoot), scopeStyles('/learning-site/site.css', '.workspace-learning'), scopeStyles('/extension/demo/geometry.css', '.workspace-geometry'), scopeStyles('/extension/demo/demo.css', '.workspace-curve')]);
    document.head.append(document.querySelector('link[href="./workspace.css"]'));
    learningRoot.querySelector('#learning-video')?.closest('.video-stage')?.remove();
    geometryRoot.querySelector('#geometry-video')?.remove();
    const geometryBanner = geometryRoot.querySelector('#geometry-banner');
    const geometryAliases = { 'geometry-video': video, 'geometry-stage': stage, 'geometry-banner': geometryBanner };
    geometryBanner.querySelectorAll('[id]').forEach((el) => { geometryAliases[el.id] = el; });
    stage.append(geometryBanner);
    const curveDocument = bg.mountContext.createDocument(curveRoot, { aliases, prefix: 'curve' });
    const learningDocument = bg.mountContext.createDocument(learningRoot, { aliases: { 'learning-video': video }, prefix: 'learning' });
    const geometryDocument = bg.mountContext.createDocument(geometryRoot, { aliases: geometryAliases, prefix: 'geometry' });
    document.querySelectorAll('[data-liquid-glass]').forEach((node) => { node.dataset.refract = 'off'; });
    if (root.BreakGlassUI?.LiquidGlassDock) {
      const dock = new root.BreakGlassUI.LiquidGlassDock(geometryDocument.getElementById('geometry-toolbar'));
      root.BreakGlassUI.docks = [...(root.BreakGlassUI.docks || []), dock];
    }
    curveDocument.getElementById('current-frame-help').textContent = '识别地址固定为当前工作台的同源转发，不读取或记忆旧地址。素材许可确认、主动勾选启用和曲线面板活动后，才可显式识别当前帧。';
    geometryDocument.getElementById('reader-hint').textContent = '识别地址固定为当前工作台的同源转发。素材许可确认、主动勾选启用和几何面板活动后，才可显式识别或发送模型问题；这里不填写模型密钥。';
    let current = 'import'; let learning = null; let curve = null; let geometry = null; let media = null; let requestedSample = null; let sampleSelecting = false; let mediaChoiceSequence = 0;
    const particles = bg.liveParticles.mount(particleContainer, { document });
    const scenes = { curve: null, geometry: null, learning: null };
    const saveForm = create('form', 'workspace-save-scene'); saveForm.hidden = true;
    const saveTitle = create('input'); saveTitle.maxLength = 120; saveTitle.required = true; saveTitle.value = '我的数学探索';
    const saveLabel = create('label', '', '保存当前探索为新的数学练习'); saveLabel.append(saveTitle);
    const saveKind = create('select'); for (const [value, text] of [['question', '疑问'], ['pitfall', '个人易错标记']]) { const option = create('option', '', text); option.value = value; saveKind.append(option); }
    const kindLabel = create('label', '', '记录类型'); kindLabel.append(saveKind);
    const saveNote = create('textarea'); saveNote.maxLength = 1000; saveNote.rows = 2;
    const noteLabel = create('label', '', '我想回顾的地方（可选）'); noteLabel.append(saveNote);
    const saveButton = create('button', '', '保存练习记录并进入复练'); saveButton.type = 'submit';
    const saveStatus = create('p', 'muted', '保存到当前学习范围；仅保存数学条件，不保存视频。原题与当前探索分别保留。'); saveStatus.setAttribute('role', 'status');
    saveForm.append(saveLabel, kindLabel, noteLabel, saveButton, saveStatus); mediaColumn.append(saveForm);
    const publish = (owner) => (scene) => { scenes[owner] = scene; if (current === owner || (owner === 'learning' && !['curve', 'geometry'].includes(current))) { particles.update(scene); saveForm.hidden = !scene?.confirmed || !['curve', 'geometry'].includes(current);
      saveStatus.textContent = scene?.degeneracy === 'zero-amplitude-sine' ? '零振幅已退化为常值函数，没有最小正周期；保存为直线模板练习。' : '保存到当前学习范围；仅保存数学条件，不保存视频。原题与当前探索分别保留。'; } };
    function activate(next, fromLearning = false) {
      current = next; const mathPanel = ['curve', 'geometry'].includes(next);
      learningRoot.hidden = mathPanel; curveRoot.hidden = next !== 'curve'; geometryRoot.hidden = next !== 'geometry';
      learning?.setActive(!mathPanel); curve?.setActive(next === 'curve'); geometry?.setActive(next === 'geometry');
      if (!mathPanel && !fromLearning) learning?.switchView(next);
      buttons.forEach((button, key) => { if (key === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
      particles.update(scenes[mathPanel ? next : 'learning']);
      saveForm.hidden = !mathPanel || !scenes[next]?.confirmed;
      aliases['stage-banner'].hidden = next !== 'curve';
      geometryBanner.hidden = next !== 'geometry';
    }
    const canRead = () => Boolean(readerOptIn.checked && media?.policy?.allowed && media?.selection && media.source?.id === media.selection.source.id && media.source.version === media.selection.source.version);
    function mediaChanged(snapshot) {
      if (!snapshot.selection && !sampleSelecting) requestedSample = null;
      const changed = media?.generation !== snapshot.generation || media?.owner !== snapshot.owner;
      media = { ...snapshot, sample: requestedSample?.kind || null, clip: requestedSample?.clip || null };
      if (changed) { readerOptIn.checked = false; scenes.curve = null; scenes.geometry = null; scenes.learning = null; particles.update(null); saveForm.hidden = true; }
      curve?.onMediaChange(media); geometry?.onMediaChange(media);
      readerOptIn.disabled = !media.policy?.allowed;
      status.textContent = media.selection ? `${media.selection.name} · ${media.policy?.allowed ? '素材登记允许，识别需主动开始' : '本地预览与手工数学可用，AI许可未确认'} · 当前视频只由一个文件入口管理` : '选择本地视频或项目自制素材开始。';
      const account = learning?.context.client.snapshot(); identity.textContent = account?.user ? `${account.user.username} · 当前账户范围与本机访客范围独立` : '本机访客 · 学习记录与账户数据分别保存';
    }
    async function chooseFile(file, panel) { const sequence = ++mediaChoiceSequence; requestedSample = null; sampleSelecting = false; await learning.chooseFile(file); if (sequence === mediaChoiceSequence) activate(panel); }
    async function chooseSample(path, name, panel, clip = null) {
      const sequence = ++mediaChoiceSequence; requestedSample = { kind: clip ? 'geometry' : 'parabola', clip }; sampleSelecting = true;
      try { const selected = await learning.loadSample(new URL(path, document.location.href).pathname, name, { targetTime: clip?.target }); if (sequence === mediaChoiceSequence && selected) activate(panel); }
      finally { if (sequence === mediaChoiceSequence) sampleSelecting = false; }
    }
    learning = bg.learningApp.mount(learningRoot, { document: learningDocument, video, isActive: () => !['curve', 'geometry'].includes(current), onMediaChange: mediaChanged, onViewChange: (next) => activate(next, true), onScene: publish('learning') });
    curve = bg.curvePage.mount(curveRoot, { document: curveDocument, video, stage, fixedReaderEndpoint: new URL('/read', document.location.href).href, isActive: () => current === 'curve', canRead, onSelectFile: (file) => chooseFile(file, current === 'curve' ? 'curve' : 'import'), onSelectSample: (path, name) => chooseSample(path, name, current === 'curve' ? 'curve' : 'import'), onScene: publish('curve') });
    geometry = bg.geometryPage.mount(geometryRoot, { document: geometryDocument, video, fixedReaderEndpoint: document.location.origin, isActive: () => current === 'geometry', canRead, onSelectFile: (file) => chooseFile(file, 'geometry'), onSelectSample: (path, name, clip) => chooseSample(path, name, 'geometry', clip), onScene: publish('geometry') });
    buttons.forEach((button, key) => button.addEventListener('click', () => activate(key)));
    readerOptIn.addEventListener('change', () => { if (!canRead()) readerOptIn.checked = false; });
    saveForm.addEventListener('submit', async (event) => {
      event.preventDefault(); const scene = scenes[current]; const owner = learning.context.getOwner(); const selected = media;
      if (!scene?.confirmed) return;
      if (!bg.webRecords.validSnapshot(scene.template, scene.snapshot)) { saveStatus.textContent = '当前探索超出可保存的数学模板范围，请调整参数后重试。'; return; }
      saveButton.disabled = true;
      try {
        const id = crypto.randomUUID(); const file = selected?.source?.id;
        const source = { kind: 'manual-notes', id: file ? `manual-${file}` : `study-${id}`, version: selected?.source?.version || '1', analysisVersion: '1', materialMode: 'self-authored', title: '学生独立数学探索' };
        const record = await learning.saveSnapshot({ id, kind: saveKind.value, source, time: file ? video.currentTime : 0, title: saveTitle.value.trim(), note: saveNote.value.trim() || (scene.degeneracy === 'zero-amplitude-sine' ? '零振幅退化为常值函数，没有最小正周期；以直线模板回顾。' : '我想再次理解这些数学条件。'), template: scene.template, snapshot: { ...scene.snapshot }, origin: 'manual', sourceLabel: '学生确认的当前探索条件；程序绘制，非新增视频识别', createdAt: new Date().toISOString() }, 'practice');
        if (owner !== learning.context.getOwner() || selected !== media) return;
        learning.openSnapshot(record, learning.context.getOwner().split(':')[0]); activate('practice'); saveStatus.textContent = '数学练习已保存；可在疑问与易错中回顾。';
      } catch (error) { if (owner === learning.context.getOwner()) saveStatus.textContent = `保存未确认：${error.message}`; }
      finally { saveButton.disabled = false; }
    });
    bg.workspace = { learning, curve, geometry, activate, snapshot: () => ({ activePanel: current, media, particle: particles.getState() }), destroy() { learning.destroy(); curve.destroy(); geometry.destroy(); particles.destroy(); shell.remove(); bg.workspace = null; } };
    activate('import'); mediaChanged(learning.snapshot());
  }
  start().catch((error) => { const el = create('p', 'workspace-error', `工作台加载未完成：${error.message}。请刷新重试。`); el.setAttribute('role', 'alert'); document.body.append(el); });
})(globalThis);
