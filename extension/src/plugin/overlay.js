(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pluginOverlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_POINTS = 64;
  const MAX_TEXT = 2000;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const text = (value, max = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, max) : '';

  // Defensive copies are a UI boundary; source/rights validation remains in the caller's contract.
  function normalizeSource(value) {
    if (!value || !text(value.kind, 80) || !text(value.id, 200) || !text(value.version, 200)
      || value.analysisVersion !== '1') {
      throw new TypeError('学习层需要明确的材料来源、标识与版本。');
    }
    const source = {
      kind: text(value.kind, 80), id: text(value.id, 200), version: text(value.version, 200),
      analysisVersion: value.analysisVersion, materialMode: text(value.materialMode, 80)
    };
    if (text(value.title, 120)) source.title = text(value.title, 120);
    return source;
  }

  function normalizePoint(value) {
    if (!value || !text(value.id, 200) || !finite(value.start) || value.start < 0
      || !finite(value.end) || value.end <= value.start || !text(value.title, 200)
      || !['vision', 'author', 'manual'].includes(value.origin)
      || !['parabola', 'right-triangle'].includes(value.template)) return null;
    let area = null;
    if (value.area !== null && value.area !== undefined) {
      const a = value.area;
      if (!a || !['x', 'y', 'width', 'height'].every((key) => finite(a[key]))
        || a.x < 0 || a.y < 0 || a.width <= 0 || a.height <= 0
        || a.x + a.width > 1 || a.y + a.height > 1) return null;
      area = { x: a.x, y: a.y, width: a.width, height: a.height };
    }
    const s = value.snapshot;
    if (!s) return null;
    let snapshot;
    if (value.template === 'parabola') {
      if (!['a', 'h', 'k'].every((key) => finite(s[key])) || s.a === 0) return null;
      snapshot = { a: s.a, h: s.h, k: s.k };
    } else {
      if (!finite(s.AB) || !finite(s.AC) || s.AB <= 0 || s.AC <= 0
        || !Number.isFinite(Math.hypot(s.AB, s.AC)) || !['unit', 'cm', 'm'].includes(s.unit)) return null;
      snapshot = { AB: s.AB, AC: s.AC, unit: s.unit };
    }
    return {
      id: text(value.id, 200), start: value.start, end: value.end, area,
      title: text(value.title, 200), explanation: text(value.explanation),
      template: value.template, snapshot, origin: value.origin,
      sourceLabel: text(value.sourceLabel, 120) || originLabel(value.origin)
    };
  }

  function originLabel(origin) {
    return origin === 'vision' ? 'AI 视觉候选，数学条件待确认' : origin === 'author' ? '作者知识层（测试夹具）' : '学生手工候选（非 AI 识别）';
  }

  function normalizeSummary(value) {
    if (value === null) return null;
    if (!value || typeof value.summary !== 'string' || value.summary.length > MAX_TEXT
      || !['keyPoints', 'pitfalls'].every((key) => Array.isArray(value[key]) && value[key].length <= 8
        && value[key].every((entry) => typeof entry === 'string' && entry.length <= 500))
      || !Array.isArray(value.observedTimes) || value.observedTimes.length > 20
      || !value.observedTimes.every((time) => finite(time) && time >= 0)) {
      throw new TypeError('画面总结结构或覆盖时间无效。');
    }
    return { summary: value.summary, keyPoints: value.keyPoints.slice(), pitfalls: value.pitfalls.slice(), observedTimes: value.observedTimes.slice() };
  }

  function normalizePoints(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).slice(0, MAX_POINTS).map(normalizePoint).filter((point) => {
      if (!point || seen.has(point.id)) return false;
      seen.add(point.id);
      return true;
    });
  }

  function triangleScene(snapshot, source, time, frameSize, revision = 1) {
    return {
      schemaVersion: '1.0.0', kind: 'right-triangle', requestId: `plugin-${source.id}-${revision}`,
      videoId: `${source.kind}:${source.id}:${source.version}`, frameTime: time,
      frameSize, sceneRevision: revision, rightAngleAt: 'A', labels: { A: 'A', B: 'B', C: 'C' },
      vertices: null, lengths: { AB: snapshot.AB, AC: snapshot.AC }, unit: snapshot.unit,
      // The existing scene schema describes confirmed mathematical input; author provenance stays on the point.
      source: 'manual', originSource: 'manual', editedByUser: true
    };
  }

  function createLearningOverlay(options) {
    const { video, cssText, onSave, onClose, onToggleRecognition } = options || {};
    if (!video || video.tagName !== 'VIDEO' || !video.ownerDocument) throw new TypeError('请选择一个视频播放器。');
    if (typeof cssText !== 'string' || !cssText.trim()) throw new TypeError('学习层需要局部样式。');
    const source = normalizeSource(options.source);
    const doc = video.ownerDocument;
    const win = doc.defaultView;
    const bg = root.BreakGlass || {};
    if (!bg.geometry || !bg.evaluate || !bg.geometryScene || !bg.geometryScene.validateActions) {
      throw new Error('学习层数学与画面定位模块未加载。');
    }
    let points = normalizePoints(options.points);
    let manualPoints = [];
    let destroyed = false;
    let sourceValid = true;
    let selected = null;
    let signature = '';
    let scheduled = 0;
    let actionEpoch = 0;
    let savePending = false;
    let manualSerial = 0;
    let particleRenderer = null;
    let particleEnabled = false;
    let particleView = { yaw: 0, pitch: 0 };
    let recognizing = false;
    let recognitionPending = false;
    let hotspotSignature = '';
    let responsiveWidth = 0;
    let independentMode = false;
    let panelExpanded = true;
    const initialMedia = video.currentSrc || video.src;
    const listeners = [];
    const host = doc.createElement('div');
    host.setAttribute('data-breakglass-learning', '');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = cssText;
    shadow.append(style);

    function node(tag, className, content) {
      const el = doc.createElement(tag);
      if (className) el.className = className;
      if (content !== undefined) el.textContent = content;
      return el;
    }
    function button(label, action, className = 'bg-button') {
      const el = node('button', className, label);
      el.type = 'button';
      el.addEventListener('click', action);
      return el;
    }
    function listen(target, event, handler, opts) {
      target.addEventListener(event, handler, opts);
      listeners.push(() => target.removeEventListener(event, handler, opts));
    }
    function svgNode(tag, attrs, content) {
      const el = doc.createElementNS(SVG_NS, tag);
      Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
      if (content !== undefined) el.textContent = content;
      return el;
    }

    const layer = node('div', 'bg-hotspots');
    const panel = node('aside', 'bg-panel');
    panel.setAttribute('aria-label', 'BreakGlass 视频学习层');
    const header = node('div', 'bg-header');
    const heading = node('h2', 'bg-heading', 'BreakGlass');
    heading.tabIndex = -1;
    const close = button('退出学习层', () => {
      destroy();
      if (typeof onClose === 'function') onClose({ source: copy(source), time: video.currentTime });
    }, 'bg-button bg-close');
    const collapse = button('收起并查看视频', () => {
      setPanelExpanded(false);
      launcher.focus({ preventScroll: true });
      if (typeof video.scrollIntoView === 'function') video.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 'bg-button bg-secondary');
    collapse.hidden = true;
    header.append(heading, collapse, close);
    const launcher = button('展开学习面板', () => setPanelExpanded(true, true), 'bg-button bg-launcher');
    launcher.hidden = true;
    launcher.setAttribute('aria-label', '展开独立学习面板，不遮挡视频播放器');
    const layoutNote = node('p', 'bg-muted', '独立列表模式：学习面板位于页面末尾，不遮挡字幕或原生播放控件。点击重点后暂停探索，返回视频可收起。');
    layoutNote.hidden = true;
    const sourceInfo = node('p', 'bg-source', `${source.title || '当前视频'} · ${source.version}`);
    const mode = source.materialMode === 'self-authored' ? '自制教学材料'
      : source.materialMode === 'licensed' ? '已授权教学材料' : '材料许可待确认';
    const scope = node('p', 'bg-muted', ['visual-session', 'local-file'].includes(source.kind)
      ? `${mode} · 持续 AI 视觉识别。点击开始后，获准画面经本机 reader 发给已配置的视觉模型；不包含音频，原帧不写入学习记录。`
      : `${mode} · 作者测试夹具或手工条件；这一模式不进行视觉采集。`);
    const status = node('p', 'bg-status', '学习层已就绪');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const mapStatus = node('p', 'bg-muted');
    const recognitionStatus = node('p', 'bg-muted', '持续视觉识别未开启');
    recognitionStatus.setAttribute('role', 'status');
    const recognitionButton = button('开始持续视觉识别', toggleRecognition, 'bg-button bg-primary');
    recognitionButton.hidden = typeof onToggleRecognition !== 'function';
    recognitionStatus.hidden = recognitionButton.hidden;
    const summarySection = node('section', 'bg-summary');
    summarySection.setAttribute('aria-label', '已观察画面的 AI 总结');
    summarySection.hidden = true;
    const listHeading = node('h3', 'bg-subheading', '当前视频重点');
    const list = node('div', 'bg-point-list');
    list.setAttribute('aria-label', '与画面热点等价的重点列表');
    const detail = node('section', 'bg-detail');
    detail.hidden = true;
    const manual = button('校对当前条件', openManual, 'bg-button bg-secondary');
    const returnButton = button('返回视频', returnToVideo, 'bg-button bg-secondary');
    returnButton.hidden = true;
    panel.append(header, layoutNote, sourceInfo, scope, status, recognitionButton, recognitionStatus, mapStatus,
      listHeading, list, manual, detail, returnButton, summarySection);
    shadow.append(layer, launcher, panel);
    const mount = options.mount;
    if (mount && (mount.ownerDocument !== doc || !mount.isConnected || typeof mount.append !== 'function')) {
      throw new TypeError('学习层容器必须属于当前页面。');
    }
    (mount || doc.body || doc.documentElement).append(host);

    function updateStatus(value) {
      if (!destroyed) status.textContent = text(typeof value === 'string' ? value : value && value.message) || '学习层已就绪';
    }
    function setPanelExpanded(value, show = false) {
      panelExpanded = value === true;
      panel.hidden = independentMode && !panelExpanded;
      launcher.hidden = !independentMode || panelExpanded;
      launcher.setAttribute('aria-expanded', String(panelExpanded));
      if (show && !panel.hidden) {
        heading.focus({ preventScroll: true });
        if (independentMode && typeof host.scrollIntoView === 'function') host.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    }
    function responsiveLayout() {
      const width = win.innerWidth || doc.documentElement.clientWidth || 1024;
      const height = win.innerHeight || doc.documentElement.clientHeight || 768;
      const rect = video.getBoundingClientRect();
      const sidebarLeft = width - 20 - Math.min(376, width - 40);
      const sidebarOverlaps = rect.left + rect.width > sidebarLeft && rect.left < width - 20
        && rect.top + rect.height > 20 && rect.top < height - 20;
      // Once moved into normal flow, scrolling cannot move the panel back over the player.
      const next = width !== responsiveWidth ? width <= 600 || sidebarOverlaps : independentMode || width <= 600 || sidebarOverlaps;
      responsiveWidth = width;
      if (next !== independentMode) {
        independentMode = next;
        panelExpanded = !next;
      }
      host.setAttribute('data-bg-layout', independentMode ? 'flow' : 'sidebar');
      collapse.hidden = !independentMode;
      layoutNote.hidden = !independentMode;
      setPanelExpanded(panelExpanded);
    }
    function setRecognitionState(value) {
      if (destroyed) return;
      recognizing = value === true;
      recognitionButton.textContent = recognizing ? '停止持续视觉识别' : '开始持续视觉识别';
      recognitionStatus.textContent = recognizing ? '持续视觉识别已开启 · 分次观察当前画面' : '持续视觉识别已停止';
      recognitionButton.setAttribute('aria-pressed', String(recognizing));
    }
    function toggleRecognition() {
      if (destroyed || recognitionPending || typeof onToggleRecognition !== 'function') return;
      recognitionPending = true;
      recognitionButton.disabled = true;
      recognitionStatus.textContent = recognizing ? '正在停止视觉识别…' : '正在开启视觉识别…';
      Promise.resolve().then(() => destroyed ? undefined : onToggleRecognition(!recognizing)).catch((error) => {
        if (!destroyed) updateStatus(error && error.message || '视觉识别操作失败，请重试。');
      }).finally(() => {
        if (!destroyed) {
          recognitionPending = false;
          recognitionButton.disabled = !currentMediaValid();
          recognitionStatus.textContent = recognizing ? '持续视觉识别已开启 · 分次观察当前画面' : '持续视觉识别未开启';
        }
      });
    }
    function updateSummary(value) {
      if (destroyed) return;
      let summary;
      try { summary = normalizeSummary(value); }
      catch (_) { updateStatus('AI 画面总结无效，已保留当前学习内容。'); return; }
      if (summary && finite(video.duration) && summary.observedTimes.some((time) => time > video.duration)) {
        updateStatus('AI 总结的观察时间超出当前视频，已保留当前学习内容。');
        return;
      }
      summarySection.replaceChildren();
      summarySection.hidden = summary === null;
      if (!summary) return;
      summarySection.append(node('h3', 'bg-subheading', 'AI 画面总结'),
        node('p', 'bg-source', 'AI 辅助生成 · 数学条件与讲解仍需核对'),
        node('p', 'bg-muted', '仅来自已分析画面，未包含音频，未覆盖整段视频。'),
        node('p', 'bg-explanation', summary.summary));
      function addList(title, items) {
        if (!items.length) return;
        const itemsList = node('ul', 'bg-summary-list');
        items.forEach((item) => itemsList.append(node('li', '', item)));
        summarySection.append(node('h4', 'bg-summary-heading', title), itemsList);
      }
      addList('画面知识点', summary.keyPoints);
      addList('可能的易错提醒（不代表你已出错）', summary.pitfalls);
      summarySection.append(node('p', 'bg-muted', `已观察时间：${summary.observedTimes.map((time) => `${time.toFixed(1)} 秒`).join('、') || '暂无'}。`));
    }
    function currentMediaValid() {
      return sourceValid && video.isConnected && (!initialMedia || (video.currentSrc || video.src) === initialMedia);
    }
    function activePoints() {
      if (!currentMediaValid() || !finite(video.currentTime)) return [];
      return points.filter((point) => video.currentTime >= point.start && video.currentTime < point.end);
    }
    function clearSelection(message) {
      if (!selected) return;
      if (particleRenderer) particleRenderer.destroy();
      particleRenderer = null; particleEnabled = false; particleView = { yaw: 0, pitch: 0 };
      selected = null;
      actionEpoch += 1;
      savePending = false;
      detail.replaceChildren();
      detail.hidden = true;
      returnButton.hidden = true;
      manual.disabled = !currentMediaValid();
      if (message) updateStatus(message);
    }
    function refresh() {
      if (destroyed) return;
      responsiveLayout();
      if (!currentMediaValid()) {
        sourceValid = false;
        clearSelection('视频来源已变化，请重新开启学习层。');
        manual.disabled = true;
        recognitionButton.disabled = true;
      }
      const active = activePoints();
      const next = active.map((point) => `${point.id}:${point.title}:${point.origin}`).join('|');
      if (next !== signature || !list.childElementCount) {
        signature = next;
        list.replaceChildren();
        if (!active.length) list.append(node('p', 'bg-muted', currentMediaValid()
          ? '当前时段没有知识热点。可校对当前条件创建本机手工候选。' : '当前视频已失效，请退出后重新开启。'));
        active.forEach((point) => {
          const el = button(point.title, () => selectPoint(point), 'bg-button bg-list-button');
          el.setAttribute('aria-label', `${point.title}，${originLabel(point.origin)}，点击暂停并查看解析`);
          el.dataset.pointId = point.id;
          list.append(el);
        });
      }
      if (selected && Math.abs(video.currentTime - selected.time) > 0.05) clearSelection('播放位置已改变，请选择当前重点。');
      renderHotspots(active);
    }

    function mappedRect() {
      if (!currentMediaValid() || !video.videoWidth || !video.videoHeight) return null;
      const computed = win.getComputedStyle(video);
      if (computed.objectFit !== 'contain' || computed.transform !== 'none') return null;
      for (let ancestor = video.parentElement; ancestor && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
        if (win.getComputedStyle(ancestor).transform !== 'none') return null;
      }
      const rect = video.getBoundingClientRect();
      const inset = (side) => parseFloat(computed[`border${side}Width`]) + parseFloat(computed[`padding${side}`]);
      const left = inset('Left') || 0;
      const right = inset('Right') || 0;
      const top = inset('Top') || 0;
      const bottom = inset('Bottom') || 0;
      const positionTokens = computed.objectPosition.trim().split(/\s+/);
      if (positionTokens.length > 3 || positionTokens.some((token) => !bg.geometry.parseComponent(token)
        || /^-/.test(token) || (/%$/.test(token) && parseFloat(token) > 100))) return null;
      const result = bg.geometry.getContentRect({
        elementRect: { left: rect.left + left, top: rect.top + top, width: rect.width - left - right, height: rect.height - top - bottom },
        videoWidth: video.videoWidth, videoHeight: video.videoHeight,
        objectFit: computed.objectFit, objectPosition: computed.objectPosition
      });
      if (!result || result.contentRect.width < 44 || result.contentRect.height < 44) return null;
      const position = bg.geometry.resolvePosition(computed.objectPosition);
      if ((position.x.length !== undefined && position.x.length > result.elementRect.width - result.contentRect.width)
        || (position.y.length !== undefined && position.y.length > result.elementRect.height - result.contentRect.height)) return null;
      return result;
    }

    function renderHotspots(active) {
      const mapped = mappedRect();
      if (!mapped) {
        layer.replaceChildren();
        hotspotSignature = '';
        layer.hidden = true;
        mapStatus.textContent = '画面位置暂不能可靠映射；请使用上方重点列表。支持 contain 显示，复杂变换保留列表。';
        return;
      }
      layer.hidden = false;
      mapStatus.textContent = '点击画面小点或重点列表，会暂停这个视频。';
      const rect = mapped.contentRect;
      Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      const groups = [];
      active.filter((point) => point.area).forEach((point) => {
        const x = (point.area.x + point.area.width / 2) * rect.width;
        const y = (point.area.y + point.area.height / 2) * rect.height;
        const group = groups.find((entry) => Math.hypot(entry.x - x, entry.y - y) < 44);
        if (group) group.points.push(point);
        else groups.push({ x, y, points: [point] });
      });
      const groupSignature = groups.map((group) => group.points.map((point) => point.id).join(',')).join('|');
      if (groupSignature !== hotspotSignature || layer.childElementCount !== groups.length) {
        layer.replaceChildren();
        hotspotSignature = groupSignature;
        groups.forEach((group) => {
        const el = button(group.points.length > 1 ? String(group.points.length) : '●', () => {
          if (group.points.length === 1) selectPoint(group.points[0]);
          else {
            updateStatus('多个热点重叠，请从重点列表选择具体知识点。');
            const item = Array.from(list.children).find((entry) => entry.dataset.pointId === group.points[0].id);
            if (item) item.focus({ preventScroll: true });
          }
        }, 'bg-hotspot');
        el.setAttribute('aria-label', group.points.length > 1 ? `${group.points.length} 个重叠热点，转到重点列表`
          : `${group.points[0].title}，点击暂停并查看解析`);
        layer.append(el);
        });
      }
      groups.forEach((group, index) => {
        layer.children[index].style.left = `${Math.max(22, Math.min(rect.width - 22, group.x))}px`;
        layer.children[index].style.top = `${Math.max(22, Math.min(rect.height - 22, group.y))}px`;
      });
    }
    function schedule() {
      if (!destroyed && !scheduled) scheduled = win.requestAnimationFrame(() => { scheduled = 0; refresh(); });
    }

    function selectPoint(point) {
      if (!activePoints().some((active) => active.id === point.id)) {
        updateStatus('这个热点已不在当前时段。');
        refresh();
        return;
      }
      video.pause();
      setPanelExpanded(true, true);
      clearSelection();
      selected = { point: copy(point), candidateFingerprint: JSON.stringify(point), time: video.currentTime,
        snapshot: copy(point.snapshot), confirmed: false, scene: null };
      actionEpoch += 1;
      detail.hidden = false;
      returnButton.hidden = false;
      detail.replaceChildren();
      const title = node('h3', 'bg-subheading', point.title);
      title.tabIndex = -1;
      const origin = node('p', 'bg-source', `${originLabel(point.origin)} · ${point.sourceLabel}`);
      const explanation = node('p', 'bg-explanation', point.explanation || '请核对下方数学条件，再探索变化。');
      detail.append(title, origin, explanation, conditionEditor(false));
      appendSaveControls();
      updateStatus(`已暂停在 ${formatTime(selected.time)}。条件由你确认后，使用程序确定性计算。`);
      title.focus({ preventScroll: true });
    }

    function numberField(label, initial) {
      const wrap = node('label', 'bg-field');
      wrap.append(node('span', '', label));
      const input = node('input', 'bg-input');
      input.type = 'number';
      input.step = 'any';
      input.required = true;
      input.value = String(initial);
      wrap.append(input);
      return { wrap, input };
    }
    function readNumber(input) {
      if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new TypeError('请输入有限数值。');
      return input.valueAsNumber;
    }
    function conditionEditor(creating) {
      const form = node('form', 'bg-condition-form');
      const fields = node('div', 'bg-fields');
      const errors = node('p', 'bg-error');
      errors.setAttribute('role', 'alert');
      const template = selected.point.template;
      const snapshot = selected.snapshot;
      const names = template === 'parabola' ? ['a', 'h', 'k'] : ['AB', 'AC'];
      const controls = {};
      names.forEach((name) => {
        const field = numberField(name, snapshot[name]);
        controls[name] = field.input;
        fields.append(field.wrap);
      });
      let unit;
      if (template === 'right-triangle') {
        const label = node('label', 'bg-field');
        label.append(node('span', '', '统一单位'));
        unit = node('select', 'bg-input');
        [['unit', '单位长度'], ['cm', 'cm'], ['m', 'm']].forEach(([value, content]) => {
          const option = node('option', '', content);
          option.value = value;
          unit.append(option);
        });
        unit.value = snapshot.unit;
        label.append(unit);
        fields.append(label);
      }
      const confirmLabel = node('label', 'bg-confirm');
      const confirm = node('input');
      confirm.type = 'checkbox';
      confirm.required = true;
      confirmLabel.append(confirm, node('span', '', template === 'right-triangle'
        ? '我已核对 A 为直角顶点，AB、AC 是两条直角边且单位一致。'
        : '我已核对函数为 y = a(x − h)² + k，且 a ≠ 0。'));
      const submit = node('button', 'bg-button bg-primary', creating ? '生成手工候选并探索' : '确认条件并探索');
      submit.type = 'submit';
      form.append(node('p', 'bg-muted', template === 'parabola'
        ? '保持二维坐标与函数关系；SVG探索使用固定坐标窗口，可选粒子视角表达同一平面对象。'
        : '边长由条件给定，不根据视频像素估计；一次改变一条直角边。'), fields, confirmLabel, errors, submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!selected || !currentMediaValid()) return;
        try {
          if (!confirm.checked) throw new TypeError('请先确认数学条件。');
          const proposal = Object.fromEntries(names.map((name) => [name, readNumber(controls[name])]));
          if (unit) proposal.unit = unit.value;
          verifySnapshot(template, proposal);
          const edited = JSON.stringify(proposal) !== JSON.stringify(selected.point.snapshot);
          selected.snapshot = proposal;
          selected.confirmed = true;
          if (template === 'parabola') selected.plotWindow = curveDefinition(proposal);
          if (creating || edited) {
            selected.point.sourceLabel = selected.point.origin === 'vision'
              ? '学生已手工校对' : selected.point.origin === 'author'
                ? '作者测试夹具 · 学生已手工校对' : '学生手工校对（非 AI 识别）';
          }
          if (creating) {
            selected.point.snapshot = copy(proposal);
            selected.candidateFingerprint = JSON.stringify(selected.point);
            manualPoints = [...manualPoints, copy(selected.point)].slice(-MAX_POINTS);
            points = [...points, copy(selected.point)].slice(-MAX_POINTS);
            signature = '';
            refresh();
          }
          renderInteractive();
        } catch (error) { errors.textContent = error.message; }
      });
      return form;
    }

    function verifySnapshot(template, snapshot) {
      if (template === 'parabola') {
        if (!finite(snapshot.a) || snapshot.a === 0 || !finite(snapshot.h) || !finite(snapshot.k)) {
          throw new TypeError('a、h、k 必须有限且 a 不得为 0。');
        }
        const def = curveDefinition(snapshot, selected && selected.plotWindow);
        bg.evaluate.assertFiniteDomain(def);
        const values = [def.domain.min, def.domain.max];
        if (snapshot.h >= def.domain.min && snapshot.h <= def.domain.max) values.push(snapshot.h);
        for (const x of values) {
          const y = bg.evaluate.evaluateWithParameters(def, snapshot, x);
          if (!finite((y - def.range.min) / (def.range.max - def.range.min) * 192)) {
            throw new TypeError('该参数超出当前窗口可稳定绘制的数值范围。');
          }
        }
      } else {
        if (!video.videoWidth || !video.videoHeight) throw new TypeError('视频尺寸尚未就绪，请等待加载后重试。');
        const result = bg.geometryScene.validateScene(triangleScene(snapshot, source, selected.time,
          { width: video.videoWidth, height: video.videoHeight }));
        if (!result.ok) throw new TypeError(result.message);
      }
    }
    function curveDefinition(snapshot, window) {
      const domain = window ? { ...window.domain } : { min: snapshot.h - 5, max: snapshot.h + 5 };
      if (!finite(domain.min) || !finite(domain.max) || domain.max <= domain.min) {
        throw new TypeError('数值过大，当前绘图窗口无法分辨；请使用较小的平移参数。');
      }
      const span = Math.max(5, Math.abs(snapshot.a) * 25);
      const range = window ? { ...window.range } : { min: snapshot.k - span, max: snapshot.k + span };
      if (!finite(range.min) || !finite(range.max) || !finite(range.max - range.min)
        || range.max <= range.min) throw new TypeError('该数值组合无法稳定显示纵坐标，请使用较小的参数。');
      return {
        equationId: 'fixture.parabola', domain, range,
        parameters: Object.fromEntries(['a', 'h', 'k'].map((key) => [key, { min: snapshot[key], max: snapshot[key], initial: snapshot[key] }]))
      };
    }

    function renderInteractive() {
      if (!selected || !selected.confirmed) return;
      if (particleRenderer) particleRenderer.destroy();
      particleRenderer = null;
      const point = selected.point;
      const title = node('h3', 'bg-subheading', point.title);
      title.tabIndex = -1;
      detail.replaceChildren(title,
        node('p', 'bg-source', `${point.origin === 'vision' ? 'AI 视觉候选 · 数学条件已由学生确认'
          : point.origin === 'author' ? '作者测试夹具 · 已校对' : '学生手工校对（非 AI 识别）'} · ${point.sourceLabel}`));
      const stage = node('div', 'bg-stage');
      const summary = node('p', 'bg-math-summary');
      const controls = node('div', 'bg-interactive-controls');
      const error = node('p', 'bg-error');
      error.setAttribute('role', 'alert');
      detail.append(stage, summary, controls, error);
      if (point.template === 'parabola') {
        const values = {};
        ['a', 'h', 'k'].forEach((name) => {
          const field = numberField(name, selected.snapshot[name]);
          values[name] = field.input;
          controls.append(field.wrap);
        });
        controls.append(button('应用参数', () => {
          try {
            const proposal = Object.fromEntries(['a', 'h', 'k'].map((name) => [name, readNumber(values[name])]));
            verifySnapshot('parabola', proposal);
            selected.snapshot = proposal;
            selected.point.sourceLabel = point.origin === 'vision' ? '学生已调整参数'
              : point.origin === 'author' ? '作者测试夹具 · 学生已调整参数' : '学生参数探索（非 AI 识别）';
            renderInteractive();
          } catch (cause) { error.textContent = cause.message; }
        }, 'bg-button bg-primary'));
        drawParabola(stage, summary, selected.snapshot, selected.plotWindow);
      } else {
        selected.scene = triangleScene(selected.snapshot, source, selected.time,
          { width: video.videoWidth, height: video.videoHeight }, (selected.scene ? selected.scene.sceneRevision : 0) + 1);
        ['AB', 'AC'].forEach((side) => {
          const field = numberField(side, selected.snapshot[side]);
          const row = node('div', 'bg-edge-control');
          row.append(field.wrap, button(`改变 ${side}`, () => {
            try {
              const value = readNumber(field.input);
              const checked = bg.geometryScene.validateActions([{ type: 'set_length', side, value, unit: selected.snapshot.unit }], selected.scene);
              if (!checked.ok) throw new TypeError(checked.message);
              selected.snapshot = { ...selected.snapshot, [side]: checked.actions[0].value };
              selected.point.sourceLabel = point.origin === 'vision' ? '学生已调整直角边'
                : point.origin === 'author' ? '作者测试夹具 · 学生已调整直角边' : '学生单边探索（非 AI 识别）';
              renderInteractive();
            } catch (cause) { error.textContent = cause.message; }
          }, 'bg-button bg-secondary'));
          controls.append(row);
        });
        drawTriangle(stage, summary, selected.scene);
      }
      controls.append(button('恢复所选条件', () => {
        selected.snapshot = copy(selected.point.snapshot);
        try { verifySnapshot(point.template, selected.snapshot); renderInteractive(); }
        catch (cause) { error.textContent = cause.message; }
      }, 'bg-button bg-secondary'));
      if (bg.particles) appendParticleControls();
      appendSaveControls();
      updateStatus('条件已校对。参数与图形由本机数学程序计算；粒子视角和清晰图形表达同一二维对象。');
      title.focus({ preventScroll: true });
    }

    function appendParticleControls() {
      const group = node('section', 'bg-particles');
      group.setAttribute('aria-label', '同一数学对象的粒子视角');
      const toggle = button(particleEnabled ? '关闭粒子视角' : '开启粒子视角', () => {
        particleEnabled = !particleEnabled; renderInteractive();
      });
      group.append(toggle);
      if (particleEnabled) {
        const canvas = node('canvas', 'bg-particle-canvas');
        canvas.width = 320; canvas.height = 240;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '二维数学对象的粒子空间视角，数学高度为零');
        const note = node('p', 'bg-muted', '这是同一个二维对象，旋转只改变观察视角。上方清晰图形及计算条件始终保留。');
        group.append(canvas, note); detail.append(group);
        try {
          particleRenderer = bg.particles.createRenderer({ canvas, template: selected.point.template, snapshot: selected.snapshot,
            reducedMotion: Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches),
            onFallback: () => { canvas.hidden = true; note.textContent = '已使用简洁图形；参数、数学关系与清晰图形仍可使用。'; } });
          particleRenderer.setView(particleView);
          const controls = node('div', 'bg-particle-controls');
          const rotate = (yaw, pitch) => {
            particleView = { yaw: Math.max(-Math.PI, Math.min(Math.PI, particleView.yaw + yaw)),
              pitch: Math.max(-1.2, Math.min(1.2, particleView.pitch + pitch)) };
            particleRenderer.setView(particleView);
          };
          controls.append(button('向左观察', () => rotate(-0.2, 0)), button('向右观察', () => rotate(0.2, 0)),
            button('向上观察', () => rotate(0, 0.2)), button('向下观察', () => rotate(0, -0.2)),
            button('正视图', () => { particleView = { yaw: 0, pitch: 0 }; particleRenderer.resetView(); }));
          group.append(controls);
        } catch { canvas.hidden = true; note.textContent = '已使用简洁图形；互动参数仍可操作。'; }
      } else detail.append(group);
    }

    function drawParabola(stage, summary, snapshot, window) {
      const def = curveDefinition(snapshot, window);
      const h = snapshot.h;
      const k = snapshot.k;
      const svg = svgNode('svg', { viewBox: '0 0 320 240', role: 'img', 'aria-label': '二维抛物线参数图，横纵轴分别为 x 与 y' });
      const px = (x) => 24 + (x - def.domain.min) / (def.domain.max - def.domain.min) * 272;
      const py = (y) => 216 - (y - def.range.min) / (def.range.max - def.range.min) * 192;
      const defs = svgNode('defs');
      const clip = svgNode('clipPath', { id: 'bg-curve-clip' });
      clip.append(svgNode('rect', { x: 24, y: 24, width: 272, height: 192 }));
      defs.append(clip);
      svg.append(defs);
      svg.append(svgNode('rect', { x: 24, y: 24, width: 272, height: 192, class: 'bg-plot-border' }),
        svgNode('text', { x: 293, y: 235, class: 'bg-svg-label' }, 'x'),
        svgNode('text', { x: 6, y: 18, class: 'bg-svg-label' }, 'y'),
        svgNode('text', { x: 28, y: 37, class: 'bg-svg-label' }, bg.geometryScene.formatLength(def.range.max)),
        svgNode('text', { x: 28, y: 208, class: 'bg-svg-label' }, bg.geometryScene.formatLength(def.range.min)));
      if (def.domain.min <= 0 && def.domain.max >= 0) svg.append(svgNode('line', { x1: px(0), y1: 24, x2: px(0), y2: 216, class: 'bg-axis' }));
      if (def.range.min <= 0 && def.range.max >= 0) svg.append(svgNode('line', { x1: 24, y1: py(0), x2: 296, y2: py(0), class: 'bg-axis' }));
      let path = '';
      for (let index = 0; index <= 100; index += 1) {
        const x = def.domain.min + (def.domain.max - def.domain.min) * index / 100;
        const y = bg.evaluate.evaluateWithParameters(def, snapshot, x);
        const xPixel = px(x);
        const yPixel = py(y);
        if (!finite(xPixel) || !finite(yPixel)) throw new TypeError('该数值组合无法稳定绘图。');
        path += `${index ? ' L' : 'M'}${xPixel.toFixed(3)},${yPixel.toFixed(3)}`;
      }
      svg.append(svgNode('path', { d: path, class: 'bg-curve', 'clip-path': 'url(#bg-curve-clip)' }),
        svgNode('text', { x: 160, y: 235, 'text-anchor': 'middle', class: 'bg-svg-label' }, `${bg.geometryScene.formatLength(def.domain.min)} ≤ x ≤ ${bg.geometryScene.formatLength(def.domain.max)}`));
      if (h >= def.domain.min && h <= def.domain.max && k >= def.range.min && k <= def.range.max) {
        svg.append(svgNode('circle', { cx: px(h), cy: py(k), r: 4, class: 'bg-vertex', 'clip-path': 'url(#bg-curve-clip)' }));
      }
      stage.append(svg);
      summary.textContent = `y = ${snapshot.a}(x − ${snapshot.h})² + ${snapshot.k}；顶点 (${snapshot.h}, ${snapshot.k})；`
        + `对称轴 x = ${snapshot.h}；${snapshot.a > 0 ? '开口向上' : '开口向下'}。|a| 越大，相同横向距离处离顶点越远。`
        + '探索时坐标窗口保持固定，超出边界的部分不显示；横纵刻度分别按窗口标注。';
    }
    function drawTriangle(stage, summary, scene) {
      const solved = bg.geometryScene.solveTriangle(scene);
      const svg = svgNode('svg', { viewBox: '0 0 320 240', role: 'img', 'aria-label': 'A 点为直角的三角形，两条直角边使用同一绘图比例' });
      const b = solved.normalizedVertices.B;
      const c = solved.normalizedVertices.C;
      // One scale preserves the geometry, including the angle and side ratios.
      const scale = 160;
      const endB = 44 + b.x * scale;
      const endC = 196 - c.y * scale;
      const marker = Math.min(12, b.x * scale / 4, c.y * scale / 4);
      svg.append(svgNode('path', { d: `M44,196 L${endB},196 L44,${endC} Z`, class: 'bg-triangle' }),
        svgNode('path', { d: `M44,${196 - marker} L${44 + marker},${196 - marker} L${44 + marker},196`, class: 'bg-right-angle' }),
        svgNode('text', { x: 25, y: 215, class: 'bg-svg-label' }, 'A'),
        svgNode('text', { x: endB + 6, y: 211, class: 'bg-svg-label' }, 'B'),
        svgNode('text', { x: 26, y: endC - 8, class: 'bg-svg-label' }, 'C'));
      stage.append(svg);
      const fmt = bg.geometryScene.formatLength;
      const unit = scene.unit === 'unit' ? '单位长度' : scene.unit;
      summary.textContent = `AB = ${fmt(scene.lengths.AB)}，AC = ${fmt(scene.lengths.AC)}，BC = √(AB² + AC²) = ${fmt(solved.BC)} ${unit}。`
        + '改变一条直角边时，另一条边保持不变；A 的直角关系保持成立。显示值四舍五入，计算使用完整数值。';
    }

    function appendSaveControls() {
      const group = node('div', 'bg-save');
      const label = node('label', 'bg-field');
      label.append(node('span', '', options.saveNoteLabel || '我的疑问或易错提醒（仅本机）'));
      const note = node('textarea', 'bg-input');
      note.rows = 2;
      note.maxLength = 1000;
      note.value = selected.noteDraft || '';
      note.addEventListener('input', () => { if (selected) selected.noteDraft = note.value; });
      label.append(note);
      const feedback = node('p', 'bg-muted');
      feedback.setAttribute('role', 'status');
      const saveButtons = [];
      function save(kind) {
        if (!selected || savePending || !currentMediaValid()) return;
        if (!selected.confirmed) { feedback.textContent = '请先核对并确认数学条件，再保存可回顾的个人记录。'; return; }
        if (!note.value.trim()) { feedback.textContent = '请写下你的疑问或易错提醒。'; note.focus(); return; }
        if (typeof onSave !== 'function') { feedback.textContent = '本机记录服务尚未接入，记录未保存。'; return; }
        const captured = selected;
        const epoch = actionEpoch;
        savePending = true;
        saveButtons.forEach((el) => { el.disabled = true; });
        feedback.textContent = '正在保存个人记录…';
        const record = {
          kind, source: copy(source), time: captured.time,
          title: captured.point.title, note: note.value.trim(), template: captured.point.template,
          snapshot: copy(captured.snapshot),
          origin: captured.point.origin, sourceLabel: captured.point.sourceLabel
        };
        Promise.resolve().then(() => destroyed || epoch !== actionEpoch || selected !== captured ? null : onSave(record)).then((result) => {
          if (destroyed || epoch !== actionEpoch || selected !== captured) return;
          feedback.textContent = result && result.ok === true && result.storage === 'account'
            ? '记录已由当前账号服务确认保存。'
            : result && result.ok === true && result.storage === 'local'
              ? (kind === 'pitfall' ? '个人易错标记已保存到本机。这不代表你已经做错。' : '疑问已保存到本机。')
              : '记录未保存，请重试。';
        }).catch((error) => {
          if (!destroyed && epoch === actionEpoch && selected === captured) {
            feedback.textContent = `保存失败：${text(error && error.message, 200) || '请重试。'}`;
          }
        }).finally(() => {
          if (destroyed || epoch !== actionEpoch || selected !== captured) return;
          savePending = false;
          saveButtons.forEach((el) => { el.disabled = false; });
        });
      }
      saveButtons.push(button('保存疑问', () => save('question')), button('标记个人易错点', () => save('pitfall')));
      group.append(label, ...saveButtons, feedback);
      detail.append(group);
    }

    function openManual() {
      if (!currentMediaValid() || !finite(video.currentTime)) return;
      if (finite(video.duration) && video.currentTime >= video.duration) {
        updateStatus('视频已结束，请稍向前定位后校对当前条件。');
        return;
      }
      video.pause();
      setPanelExpanded(true, true);
      clearSelection();
      const time = video.currentTime;
      const point = {
        id: `manual-${Date.now()}-${++manualSerial}`, start: time,
        end: Math.min(time + 10, finite(video.duration) && video.duration > time ? video.duration : time + 10),
        area: null, title: '手工数学条件', explanation: '', template: 'parabola',
        snapshot: { a: 1, h: 0, k: 0 }, origin: 'manual', sourceLabel: '学生手工校对（非 AI 识别）'
      };
      selected = { point, time, snapshot: copy(point.snapshot), confirmed: false, scene: null };
      actionEpoch += 1;
      detail.hidden = false;
      returnButton.hidden = false;
      const title = node('h3', 'bg-subheading', '校对当前数学条件');
      title.tabIndex = -1;
      const templateLabel = node('label', 'bg-field');
      templateLabel.append(node('span', '', '数学模板'));
      const template = node('select', 'bg-input');
      [['parabola', '二次函数'], ['right-triangle', '直角三角形']].forEach(([value, content]) => {
        const option = node('option', '', content);
        option.value = value;
        template.append(option);
      });
      templateLabel.append(template);
      const editor = node('div');
      editor.append(conditionEditor(true));
      template.addEventListener('change', () => {
        if (!selected) return;
        selected.point.template = template.value;
        selected.snapshot = template.value === 'parabola' ? { a: 1, h: 0, k: 0 } : { AB: 3, AC: 4, unit: 'unit' };
        selected.point.snapshot = copy(selected.snapshot);
        editor.replaceChildren(conditionEditor(true));
      });
      detail.replaceChildren(title, node('p', 'bg-muted', '手工输入只建立数学候选，不识别画面，也不猜测候选在原帧的位置。'), templateLabel, editor);
      updateStatus(`已暂停在 ${formatTime(time)}。请根据你看到的条件填写并校对。`);
      title.focus({ preventScroll: true });
    }

    function returnToVideo() {
      if (!currentMediaValid()) { clearSelection('视频来源已变化，请重新开启学习层。'); return; }
      clearSelection();
      const epoch = actionEpoch;
      if (independentMode) {
        setPanelExpanded(false);
        if (typeof video.scrollIntoView === 'function') video.scrollIntoView({ block: 'center', behavior: 'auto' });
        video.focus({ preventScroll: true });
      }
      let attempt;
      try { attempt = video.play(); }
      catch (_) { updateStatus('浏览器未允许继续播放，请点击播放器的播放按钮。'); return; }
      Promise.resolve(attempt).then(() => {
        if (!destroyed && epoch === actionEpoch && currentMediaValid()) updateStatus('已返回视频。');
      }).catch(() => {
        if (!destroyed && epoch === actionEpoch && currentMediaValid()) updateStatus('浏览器未允许继续播放，请点击播放器的播放按钮。');
      });
      if (!independentMode) manual.focus({ preventScroll: true });
    }
    function formatTime(value) {
      return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
    }
    function fullscreenChanged() {
      const fullscreen = doc.fullscreenElement;
      if (fullscreen && fullscreen.tagName !== 'VIDEO' && fullscreen.contains(video)) fullscreen.append(host);
      else (mount && mount.isConnected ? mount : doc.body || doc.documentElement).append(host);
      if (fullscreen && fullscreen.tagName === 'VIDEO') {
        updateStatus('原生视频全屏不支持学习层；退出全屏后可继续使用重点列表。');
      }
      schedule();
    }
    function updatePoints(values) {
      if (destroyed) return;
      const incoming = normalizePoints(values);
      if (!incoming.length) manualPoints = [];
      const next = normalizePoints([...incoming, ...manualPoints]);
      if (selected) {
        const replacement = next.find((point) => point.id === selected.point.id);
        const manualEditor = selected.point.origin === 'manual' && !selected.confirmed && incoming.length > 0;
        if (!manualEditor && (!replacement || JSON.stringify(replacement) !== selected.candidateFingerprint)) clearSelection('画面候选已更新，请重新选择重点。');
      }
      points = next;
      refresh();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (particleRenderer) particleRenderer.destroy();
      particleRenderer = null;
      actionEpoch += 1;
      if (scheduled) win.cancelAnimationFrame(scheduled);
      listeners.forEach((dispose) => dispose());
      if (resizeObserver) resizeObserver.disconnect();
      if (mutationObserver) mutationObserver.disconnect();
      host.remove();
    }

    listen(video, 'timeupdate', schedule);
    listen(video, 'loadedmetadata', schedule);
    listen(video, 'play', () => { clearSelection('视频继续播放，已收起所选场景。'); schedule(); });
    listen(video, 'seeking', () => { clearSelection('播放位置已改变，请选择当前重点。'); schedule(); });
    listen(video, 'emptied', () => { sourceValid = false; clearSelection('视频来源已变化，请重新开启学习层。'); schedule(); });
    listen(video, 'loadstart', () => { if ((video.currentSrc || video.src) !== initialMedia) sourceValid = false; schedule(); });
    listen(win, 'resize', schedule);
    listen(win, 'scroll', schedule, true);
    listen(doc, 'fullscreenchange', fullscreenChanged);
    if (win.visualViewport) { listen(win.visualViewport, 'resize', schedule); listen(win.visualViewport, 'scroll', schedule); }
    const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
    if (resizeObserver) resizeObserver.observe(video);
    const mutationObserver = typeof win.MutationObserver === 'function' ? new win.MutationObserver(schedule) : null;
    if (mutationObserver) mutationObserver.observe(video, { attributes: true, attributeFilter: ['style', 'class', 'src'] });
    // Keyboard handlers are scoped to native controls. Host Esc/Space remain untouched.
    fullscreenChanged();
    refresh();
    return { updatePoints, updateStatus, updateSummary, setRecognitionState, destroy };
  }

  return { createLearningOverlay, normalizeSource, normalizePoint, normalizePoints, normalizeSummary, triangleScene };
});
