(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.mathWorkbench = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  function dependencies() {
    return typeof require === 'function' ? { math: require('./math-learning'), records: require('./records'), pedagogy: require('./pedagogy'),
      particles: require('../extension/src/plugin/particle-renderer') }
      : { math: root.BreakGlass.mathLearning, records: root.BreakGlass.webRecords, pedagogy: root.BreakGlass.pedagogy, particles: root.BreakGlass.particles };
  }
  function mount(container, { document = root.document, getState, getOwner = () => 'local', saveRecord,
    submitAttempt, onChanged = () => {}, onOpen = () => {}, onScene = () => {}, onPurpose = async () => {}, id = () => root.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
    if (!container || !document || typeof getState !== 'function' || typeof saveRecord !== 'function'
      || typeof submitAttempt !== 'function') throw new TypeError('数学工作台需要记录、实际作答和账户范围回调。');
    const { math, records, pedagogy, particles } = dependencies();
    let generation = 0, owner = ownerKey(), current = null, hintLevel = 0, answerViewed = false;
    let saved = false, dirty = false, prediction = null, variantIndex = 0, disposed = false, busy = false;
    let particleRenderer = null, displaySnapshot = null, particleEnabled = false;
    const refs = {}, parameters = new Map(), answers = new Map(); const listeners = [];
    const helpLedger = new Map();
    function helpKey() { return current && `${ownerKey()}:${current.id}`; }
    function rememberHelp() { if (current) helpLedger.set(helpKey(), { hintLevel, answerViewed }); }
    function ownerKey() { return JSON.stringify(getOwner()); }
    function node(tag, text, className = '') { const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
      if (className) el.className = className; return el; }
    function ref(name, el) { refs[name] = el; el.dataset.mathAction = name; return el; }
    function listen(el, event, fn) { el.addEventListener(event, fn); listeners.push([el, event, fn]); }
    function empty(el) {
      const descendants = new Set();
      function walk(parent) { for (const child of Array.from(parent.children || [])) { descendants.add(child); walk(child); } }
      walk(el);
      for (let i = listeners.length - 1; i >= 0; i -= 1) if (descendants.has(listeners[i][0])) {
        const [target, event, fn] = listeners[i]; target.removeEventListener(event, fn); listeners.splice(i, 1);
      }
      el.replaceChildren();
    }
    function button(name, label, fn) { const el = ref(name, node('button', label)); el.type = 'button'; listen(el, 'click', fn); return el; }
    function notice(value) { refs.status.textContent = value; }
    function destroyParticles() {
      particleRenderer?.destroy(); particleRenderer = null; particleEnabled = false;
      if (refs.particleStage) refs.particleStage.replaceChildren();
      if (refs.particleSection) refs.particleSection.hidden = true;
      if (refs.particleToggle) refs.particleToggle.textContent = '打开同一状态的实线观察';
    }
    function reset(clear = true) {
      generation += 1; owner = ownerKey(); current = null; saved = false; dirty = false; busy = false;
      destroyParticles(); displaySnapshot = null;
      onScene(null);
      hintLevel = 0; answerViewed = false; variantIndex = 0; refs.study.hidden = true;
      if (clear) { refs.stage.replaceChildren(); notice('选择一个手工模板或可跳过的基础诊断。观看与操作不会更新理解状态。'); }
      refs.save.disabled = false; refs.submit.disabled = true;
    }
    function ensureOwner() { if (ownerKey() !== owner) { reset(); return false; } return !disposed; }
    function guard(g, o) { return !disposed && g === generation && o === ownerKey(); }
    function info(template) {
      if (math.isExtended(template)) return math.templateInfo(template);
      const nodeInfo = math.learningGraph().find((n) => n.template === template);
      return template === 'parabola' ? { title: '顶点坐标基础诊断', foundation: nodeInfo.foundation,
        fields: [{ key: 'a', label: 'a', min: -10, max: 10 }, { key: 'h', label: 'h', min: -20, max: 20 }, { key: 'k', label: 'k', min: -20, max: 20 }],
        question: '求y=a(x−h)²+k的顶点坐标。' }
        : { title: '直角边平方关系基础诊断', foundation: nodeInfo.foundation,
          fields: [{ key: 'AB', label: 'AB', min: 0.1, max: 100 }, { key: 'AC', label: 'AC', min: 0.1, max: 100 }], question: 'A为直角，求斜边BC的长度。', answerLabel: '斜边 BC' };
    }
    function sourceRecord(template, snapshot, title = info(template).title, kind = 'question', note = '我主动建立的手工数学条件。', diagnosticId = '') {
      const nextId = id();
      return records.validateRecord({ id: nextId, kind, source: { kind: 'manual-notes', id: diagnosticId ? `diagnostic-${diagnosticId}-${nextId}` : `study-${nextId}`, version: '1',
        analysisVersion: '1', materialMode: 'self-authored', title: '学生手工数学学习' }, time: 0,
        title, note, template, snapshot, origin: 'manual', sourceLabel: '学生手工条件；程序绘制与判定，非视频识别', createdAt: now() });
    }
    function snapshotFromFields() {
      const value = {};
      parameters.forEach((input, key) => { if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new Error('每个数学参数都需要有限数字。'); value[key] = input.valueAsNumber; });
      if (refs.unit.parentElement && !refs.unit.parentElement.hidden) value.unit = refs.unit.value;
      if (!records.validSnapshot(current.template, value)) throw new Error('数学条件不满足模板范围或严格三角不等式。');
      return value;
    }
    function oldSVG(record) {
      const s = record.snapshot; let points;
      if (record.template === 'right-triangle') { const scale = Math.max(s.AB, s.AC); points = [[0, 0], [s.AB / scale, 0], [0, s.AC / scale], [0, 0]]; }
      else { const max = Math.max(1, Math.abs(s.h), Math.abs(s.k), Math.abs(s.a) * (10 + Math.abs(s.h)) ** 2);
        points = Array.from({ length: 101 }, (_, i) => { const x = -10 + i / 5; return [x / 10, (s.a * (x - s.h) ** 2 + s.k) / max]; }); }
      const minX = Math.min(...points.map((p) => p[0])), maxX = Math.max(...points.map((p) => p[0]));
      const minY = Math.min(...points.map((p) => p[1])), maxY = Math.max(...points.map((p) => p[1]));
      const factor = Math.min(520 / Math.max(0.1, maxX - minX), 240 / Math.max(0.1, maxY - minY));
      const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${320 + (x - (minX + maxX) / 2) * factor},${160 - (y - (minY + maxY) / 2) * factor}`).join(' ');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="程序生成的基础数学诊断示意"><path d="${path}" fill="none" stroke="#71ddff" stroke-width="2"/></svg>`;
    }
    function draw(snapshot = current.snapshot) {
      displaySnapshot = { ...snapshot };
      refs.stage.innerHTML = math.isExtended(current.template) ? math.sceneSVG(current.template, snapshot) : oldSVG({ ...current, snapshot });
      refs.equation.textContent = math.isExtended(current.template) ? math.equation(current.template, snapshot)
        : current.template === 'parabola' ? `y=${snapshot.a}(x−(${snapshot.h}))²+(${snapshot.k})`
          : `A为直角，AB=${snapshot.AB}、AC=${snapshot.AC} ${snapshot.unit}`;
      if (particleRenderer) particleRenderer.update(displaySnapshot);
      onScene({ template: current.template, snapshot: { ...displaySnapshot }, confirmed: true,
        origin: JSON.stringify(displaySnapshot) === JSON.stringify(current.snapshot) ? 'source' : 'exploration',
        sourceId: current.source.id, sourceVersion: current.source.version });
    }
    function cameraValues() {
      if (!particleRenderer) return;
      const view = particleRenderer.getState().view;
      refs.yaw.value = String(view.yaw * 180 / Math.PI); refs.pitch.value = String(view.pitch * 180 / Math.PI);
    }
    function openParticles() {
      if (!ensureOwner() || !current) return;
      if (particleEnabled) { destroyParticles(); return; }
      particleEnabled = true; refs.particleSection.hidden = false; refs.particleToggle.textContent = '收起实线观察';
      refs.particleStatus.textContent = current.template === 'cuboid'
        ? '长方体实线来自明确的长、宽、高数学坐标；旋转只是观察视角，不是视频图像重建。'
        : '数学点全部位于z=0的二维平面；旋转只是观察视角，不改变函数或几何条件。';
      const canvas = node('canvas'); canvas.setAttribute('aria-label', '与主图同一数学状态的实线观察'); refs.particleStage.append(canvas);
      const fallback = () => {
        canvas.hidden = true; [refs.yaw, refs.pitch, refs.cameraReset].forEach((control) => { control.disabled = true; });
        refs.particleStatus.textContent = '实线空间视图不可用，保留SVG主图、数学条件与实际复练。';
      };
      try {
        particleRenderer = particles.createRenderer({ canvas, template: current.template, snapshot: displaySnapshot,
          reducedMotion: typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onFallback: fallback });
        if (particleRenderer.getState().mode !== 'webgl') fallback();
        else [refs.yaw, refs.pitch, refs.cameraReset].forEach((control) => { control.disabled = false; });
        cameraValues();
      } catch (_) { fallback(); }
    }
    function preparePractice() {
      const used = helpLedger.get(helpKey()); hintLevel = used?.hintLevel || 0; answerViewed = used?.answerViewed || false;
      refs.hint.textContent = hintLevel ? pedagogy.hints(current)[hintLevel - 1] : ''; refs.answer.textContent = '';
      answers.clear(); refs.answerFields.replaceChildren();
      const fields = current.template === 'parabola' ? [{ key: 'h', label: '顶点横坐标 h' }, { key: 'k', label: '顶点纵坐标 k' }]
        : [{ key: 'number', label: info(current.template).answerLabel }];
      fields.forEach((f) => { const label = node('label', f.label); const input = node('input'); input.type = 'number'; input.step = 'any';
        input.dataset.mathAnswer = f.key; label.append(input); answers.set(f.key, input); refs.answerFields.append(label); });
      refs.question.textContent = info(current.template).question;
      refs.submit.disabled = !saved || dirty;
      const data = getState(); const plan = math.historyPlan(current, data.attempts || [], data.records || []);
      refs.plan.textContent = `${plan.reason} ${plan.days === null ? '' : `建议${plan.days}天后再练。`}这是基于已提交答案的产品建议，不是学习效果测量。`;
      refs.moreHints.hidden = plan.suggestedHintCount === 3; refs.hintButton.dataset.suggested = String(plan.suggestedHintCount);
      refs.hintButton.textContent = `给一点提示（${hintLevel}/${plan.suggestedHintCount}）`; refs.hintButton.disabled = hintLevel >= plan.suggestedHintCount;
      empty(refs.predictionOptions); refs.predictionStatus.textContent = '预测是可跳过的探索，不形成掌握或正式作答结论。';
      try {
        prediction = pedagogy.prediction(current); refs.predictionQuestion.textContent = prediction.question;
        for (const option of prediction.options) refs.predictionOptions.append(button(`predict-${option.value}`, option.label, () => {
          if (!ensureOwner() || !current || !prediction) return;
          refs.predictionStatus.textContent = `${option.value === prediction.correct ? '符合数学关系。' : '再比较数学关系。'}${prediction.explanation}`;
          draw(prediction.snapshot);
        }));
      } catch (error) { refs.predictionQuestion.textContent = `当前条件不能生成稳定预测：${error.message}`; }
    }
    function open(input) {
      if (disposed) return;
      reset(false); current = records.validateRecord(input);
      saved = (getState().records || []).some((record) => record.id === current.id);
      refs.study.hidden = false; refs.heading.textContent = current.title; refs.foundation.textContent = info(current.template).foundation;
      refs.source.textContent = `${current.sourceLabel}；复练使用保存条件，探索不覆盖原题。`;
      empty(refs.params); parameters.clear();
      for (const f of info(current.template).fields) {
        const label = node('label', f.label); const input = node('input'); input.type = 'number'; input.step = 'any'; input.min = String(f.min); input.max = String(f.max);
        input.value = String(current.snapshot[f.key]); input.dataset.mathParameter = f.key;
        listen(input, 'input', () => { dirty = true; refs.submit.disabled = true; notice('条件正在探索，原题保持不变；应用后保存新题才能作答。'); });
        label.append(input); parameters.set(f.key, input); refs.params.append(label);
      }
      refs.unit.parentElement.hidden = !own(current.snapshot, 'unit'); refs.unit.value = current.snapshot.unit || 'cm';
      refs.save.textContent = saved ? '已保存；条件变化时保存为新题' : '保存这道手工题'; refs.title.value = current.title; refs.note.value = current.note; refs.kind.value = current.kind;
      draw(); preparePractice(); notice(saved ? '已恢复保存条件，可以提交实际答案。' : '先主动保存本次诊断/手工题，再提交答案。'); onOpen(current);
    }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
    async function save() {
      if (!ensureOwner() || !current || busy) return;
      const g = generation, o = ownerKey(); busy = true; refs.save.disabled = true;
      try {
        const snapshot = snapshotFromFields(); const edited = JSON.stringify(snapshot) !== JSON.stringify(current.snapshot)
          || refs.title.value.trim() !== current.title || refs.note.value.trim() !== current.note || refs.kind.value !== current.kind;
        const record = edited ? sourceRecord(current.template, snapshot, refs.title.value.trim(), refs.kind.value, refs.note.value.trim()) : current;
        notice('正在保存当前范围的手工数学条件…'); await saveRecord(record); await onPurpose(record.id, 'practice');
        if (!guard(g, o)) return;
        current = record; saved = true; dirty = false; draw(); preparePractice(); onChanged(); refreshGraph();
        notice(edited ? '已保存独立新题，原记录及原作答保持完整。' : '手工题已保存，现在可以提交实际答案。');
      } catch (error) { if (guard(g, o)) notice(`保存未确认：${error.message}`); }
      finally { if (guard(g, o)) { busy = false; refs.save.disabled = false; } }
    }
    function revealHint() {
      if (!ensureOwner() || !current) return;
      const limit = Number(refs.hintButton.dataset.suggested);
      hintLevel = Math.min(limit, hintLevel + 1); refs.hint.textContent = pedagogy.hints(current)[hintLevel - 1];
      rememberHelp();
      refs.hintButton.textContent = `逐步提示（${hintLevel}/${limit}）`; refs.hintButton.disabled = hintLevel === limit;
    }
    async function submit(event) {
      event.preventDefault(); if (!ensureOwner() || !current || !saved || dirty || busy) return;
      const g = generation, o = ownerKey(); const record = current;
      try {
        const value = {}; answers.forEach((input, key) => { if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new Error('请输入有限的数值答案。'); value[key] = input.valueAsNumber; });
        const answer = current.template === 'parabola' ? value : value.number;
        busy = true; refs.submit.disabled = true; notice('正在保存并验证这次实际作答…');
        const result = await submitAttempt(record, answer, hintLevel > 0 || answerViewed);
        if (!guard(g, o)) return;
        const receipt = result?.attempt || result;
        if (!receipt || typeof receipt.correct !== 'boolean') throw new Error('服务未返回明确的实际作答结果。');
        onChanged(); refreshGraph();
        notice(receipt.correct ? receipt.hintUsed ? '这次借助提示答对，已单独记录。' : '这次独立答对，已保存实际证据。'
          : '这次答错，已保存实际证据；可展开基础补充或换思路再试。');
      } catch (error) { if (guard(g, o)) notice(`作答未确认：${error.message}`); }
      finally { if (guard(g, o)) { busy = false; refs.submit.disabled = !saved || dirty; } }
    }
    async function variant() {
      if (!ensureOwner() || !current || busy) return;
      try { variantIndex = variantIndex % 20 + 1; const variant = pedagogy.createVariant(current, { id: id(), now: now(), index: variantIndex }); open(variant);
        notice('已生成独立新条件，来源为程序生成；先保存再实际作答。原题没有改变。'); }
      catch (error) { notice(`变式未生成：${error.message}`); }
    }
    function refreshGraph() {
      empty(refs.graph);
      const nodes = math.learningGraph(getState());
      for (const item of nodes) {
        const row = node('div', undefined, 'math-path-node'); row.append(node('strong', item.title), node('span', item.state));
        row.append(node('p', `实际基础诊断 ${item.diagnosticCount} 次；其他实际复练 ${item.practiceCount} 次。`, 'muted'));
        const relations = item.prerequisites.map((p) => {
          const prior = nodes.find((n) => n.id === p); return prior ? `${prior.title}（${prior.state}）` : '';
        }).filter(Boolean);
        row.append(node('p', relations.length ? `可先回顾：${relations.join(' → ')}。这是学习顺序参考。` : '可直接尝试这项基础诊断。', 'muted'));
        const detail = node('details'); detail.append(node('summary', '基础补充（可跳过）'), node('p', item.foundation)); row.append(detail);
        row.append(button(`diagnostic-${item.id}`, '尝试一题基础诊断', () => {
          if (!ensureOwner()) return;
          open(sourceRecord(item.template, item.snapshot, `基础诊断：${item.title}`, 'question', '学生主动尝试的固定题型基础诊断；单题结果不代表完整知识掌握。', item.id));
        })); refs.graph.append(row);
      }
    }
    const style = node('style'); style.textContent = '.math-workbench .math-path-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.math-workbench .math-path-node{border:1px solid var(--line,rgba(113,221,255,.2));border-radius:14px;padding:16px;display:grid;gap:8px}.math-workbench .math-controls{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.math-workbench .math-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.math-workbench input,.math-workbench select,.math-workbench button,.math-workbench summary{min-height:44px}.math-workbench .math-svg,.math-workbench .math-particles{background:var(--stage,#0e1720);border-radius:13px;overflow:hidden}.math-workbench svg,.math-workbench canvas{display:block;width:100%;height:auto;max-height:360px}.math-workbench canvas{aspect-ratio:16/9;height:clamp(180px,34vw,360px)}.math-workbench .math-result{min-height:48px}.math-workbench label{display:grid;gap:6px}.math-workbench :focus-visible{outline:2px solid #71ddff;outline-offset:3px}';
    container.className += ' math-workbench'; container.replaceChildren(style);
    container.append(node('h3', '知识关系与基础诊断'), node('p', '这是一组固定题型的学习路径参考。状态来自实际提交的答案；看完视频、展开说明和预测不计掌握。每项都可以跳过。', 'muted'));
    refs.graph = node('div', undefined, 'math-path-grid'); container.append(refs.graph);
    const chooser = node('div', undefined, 'math-controls'); const selectLabel = node('label', '手工数学模板'); refs.template = ref('template', node('select'));
    math.TEMPLATE_IDS.forEach((template) => { const option = node('option', math.templateInfo(template).title); option.value = template; refs.template.append(option); });
    refs.template.value = 'line'; selectLabel.append(refs.template); chooser.append(selectLabel, button('new', '建立手工数学场景', () => {
      if (ensureOwner()) open(sourceRecord(refs.template.value, math.templateInfo(refs.template.value).defaults));
    })); container.append(chooser);
    refs.study = node('section'); refs.study.hidden = true; refs.heading = node('h3'); refs.source = node('p', undefined, 'muted');
    const detail = node('details'); refs.foundation = node('p'); detail.append(node('summary', '基础补充（可跳过）'), refs.foundation);
    refs.stage = node('div', undefined, 'math-svg'); refs.equation = node('p'); refs.params = node('div', undefined, 'math-fields');
    refs.particleToggle = button('particles', '打开同一状态的实线观察', openParticles);
    refs.particleSection = node('section'); refs.particleSection.hidden = true; refs.particleStage = node('div', undefined, 'math-particles');
    refs.particleStatus = node('p', undefined, 'muted'); const cameraFields = node('div', undefined, 'math-fields');
    for (const [key, label, min, max] of [['yaw', '空间水平视角', -90, 90], ['pitch', '空间俯仰视角', -60, 60]]) {
      const field = node('label', label); const input = ref(`camera-${key}`, node('input')); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '1'; input.value = '0';
      refs[key] = input; field.append(input); cameraFields.append(field);
      listen(input, 'input', () => { if (!ensureOwner() || !particleRenderer) return;
        particleRenderer.setView({ yaw: Number(refs.yaw.value) * Math.PI / 180, pitch: Number(refs.pitch.value) * Math.PI / 180 }); });
    }
    refs.cameraReset = button('camera-reset', '恢复默认观察视角', () => { if (ensureOwner() && particleRenderer) { particleRenderer.resetView(); cameraValues(); } });
    refs.particleSection.append(refs.particleStage, refs.particleStatus, cameraFields, refs.cameraReset);
    refs.unit = node('select'); ['cm', 'm', 'unit'].forEach((unit) => { const option = node('option', unit); option.value = unit; refs.unit.append(option); });
    const unitLabel = node('label', '单位'); unitLabel.append(refs.unit); listen(refs.unit, 'change', () => { dirty = true; refs.submit.disabled = true; });
    const actions = node('div', undefined, 'math-controls'); actions.append(button('apply', '在图中探索这些参数', () => {
      if (!ensureOwner() || !current) return;
      try { draw(snapshotFromFields()); dirty = true; refs.submit.disabled = true; notice('当前是参数探索。保存为新题后才可复练，原题不会覆盖。'); }
      catch (error) { notice(error.message); }
    }), button('restore', '恢复原题条件', () => { if (ensureOwner() && current) open(current); }));
    const saveFields = node('div', undefined, 'math-fields'); refs.title = node('input'); refs.title.maxLength = 120;
    refs.note = node('textarea'); refs.note.maxLength = 1000; refs.note.rows = 2; refs.kind = node('select');
    [['question', '个人疑问'], ['pitfall', '个人易错标记']].forEach(([value, label]) => { const option = node('option', label); option.value = value; refs.kind.append(option); });
    for (const [label, input] of [['保存标题', refs.title], ['我的备注', refs.note], ['记录类型', refs.kind]]) { const field = node('label', label); field.append(input); saveFields.append(field); }
    refs.save = button('save', '保存这道手工题', save);
    refs.predictionQuestion = node('p'); refs.predictionOptions = node('div', undefined, 'math-controls'); refs.predictionStatus = node('p', undefined, 'muted');
    refs.question = node('p'); refs.plan = node('p', undefined, 'muted'); const form = node('form'); refs.answerFields = node('div', undefined, 'math-fields');
    refs.submit = ref('submit', node('button', '提交实际答案')); refs.submit.type = 'submit';
    refs.hintButton = button('hint', '给一点提示', revealHint); refs.moreHints = button('more-hints', '展开完整三阶段提示', () => {
      if (!ensureOwner() || !current) return;
      refs.hintButton.dataset.suggested = '3'; refs.hintButton.disabled = false; refs.moreHints.hidden = true;
      refs.hintButton.textContent = `逐步提示（${hintLevel}/3）`;
    });
    const practiceActions = node('div', undefined, 'math-controls'); practiceActions.append(refs.submit, refs.hintButton, refs.moreHints,
      button('answer', '查看程序答案', () => { if (!ensureOwner() || !current) return; answerViewed = true; rememberHelp();
        const answer = records.expectedAnswer(current); refs.answer.textContent = typeof answer === 'number' ? `程序计算：${answer}` : `程序计算的顶点：(${answer.h}, ${answer.k})`; }),
      button('skip', '跳过这次复练', () => { reset(); notice('已跳过，没有生成作答或掌握结论。'); }));
    refs.hint = node('p', undefined, 'muted'); refs.answer = node('p'); form.append(refs.answerFields, practiceActions, refs.hint, refs.answer); listen(form, 'submit', submit);
    const reflection = node('section'); const reflectionLabel = node('label', '用自己的话解释：为什么这样做，条件改变会怎样？');
    refs.reflection = node('textarea'); refs.reflection.rows = 3; refs.reflection.maxLength = 1000; refs.reflection.dataset.mathAction = 'reflection'; reflectionLabel.append(refs.reflection);
    reflection.append(node('h4', '我的解释'), reflectionLabel, button('save-reflection', '保存解释笔记', async () => {
      if (!ensureOwner() || !current || busy) return; const g=generation, o=ownerKey(); busy=true;
      try { const record=pedagogy.createExplanation(current,{text:refs.reflection.value,id:id(),now:now()});
        await saveRecord(record); await onPurpose(record.id,'reflection'); if (!guard(g,o))return; onChanged(); notice('解释已保存为笔记，不进入可作答队列，也不生成作答结果。'); }
      catch(error){if(guard(g,o))notice(`解释未确认：${error.message}`);}finally{if(guard(g,o))busy=false;}
    }));
    refs.study.append(refs.heading, refs.source, detail, refs.stage, refs.equation, refs.particleToggle, refs.particleSection, refs.params, unitLabel, actions, saveFields, refs.save,
      node('h4', '先预测，再在图中验证'), refs.predictionQuestion, refs.predictionOptions, refs.predictionStatus,
      node('h4', '可跳过的理解复练'), refs.question, refs.plan, form, button('variant', '换一道独立程序变式', variant), reflection);
    refs.status = ref('status', node('p', undefined, 'math-result')); refs.status.setAttribute('role', 'status');
    container.append(refs.study, refs.status); reset(); refreshGraph();
    return { open, refresh() { if (ensureOwner()) refreshGraph(); }, reset, destroy() { disposed = true; generation += 1;
      destroyParticles(); onScene(null);
      listeners.forEach(([el, event, fn]) => el.removeEventListener(event, fn)); container.replaceChildren(); } };
  }
  return { mount };
});
