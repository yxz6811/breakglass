(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.recognitionWorkbench = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const deps = () => typeof require === 'function' ? {
    contracts: require('../extension/src/plugin/recognition-contracts.js'), records: require('./records.js'), provenance: require('./provenance.js')
  } : { contracts: root.BreakGlass.recognitionContracts, records: root.BreakGlass.webRecords, provenance: root.BreakGlass.webProvenance };
  const copy = value => JSON.parse(JSON.stringify(value));
  function confirmedRecord(reply, snapshot, source, { id, createdAt, kind = 'question', note = '' }) {
    const d = deps(), checked = d.contracts.validateRecognitionResponse(reply);
    if (!checked.ok || !checked.value.candidate) throw new TypeError('只有有限数学候选才能由学生确认。');
    const candidate = checked.value.candidate;
    if (!d.contracts.validateRecognitionResponse({...checked.value,candidate:{template:candidate.template,snapshot}}).ok) throw new TypeError('核对后的条件不符合有限数学范围。');
    if (source.id !== reply.sourceId || source.version !== reply.videoVersion || source.analysisVersion !== reply.analysisVersion)
      throw new TypeError('当前素材与候选来源不同。');
    return d.records.validateRecord({ id, createdAt, kind, note: note.trim() ? note : '我已对照当前帧核对数学条件。', source: copy(source), time: reply.frameTime,
      title: candidate.template === 'parabola' ? '我核对的抛物线条件' : '我核对的直角三角形条件',
      template: candidate.template, snapshot: copy(snapshot), origin: 'vision', sourceLabel: 'AI画面候选，经学生核对；位置待校对' });
  }
  function provenanceMetadata(reply, record, map = null) {
    const metadata = { recordId: record.id, requestId: reply.requestId, sourceId: reply.sourceId,
      videoVersion: reply.videoVersion, analysisVersion: reply.analysisVersion, frameTime: reply.frameTime,
      frameSize: copy(reply.frameSize), template: record.template, originalSnapshot: copy(reply.candidate.snapshot),
      placementStatus: map ? 'student-calibrated' : 'unknown', map: map ? copy(map) : null,
      profileVersion: reply.evidence.profileVersion, promptVersion: reply.evidence.promptVersion,
      calibrationVersion: reply.evidence.calibrationVersion, confirmation: 'student', attribution: 'student-confirmed-candidate' };
    return deps().provenance.validateMetadata(metadata, record);
  }
  function mount(container, { learning, video, canRead = () => true, getPermissionGeneration = () => 0,
    isActive = () => true, onScene = () => {}, document = container.ownerDocument || root.document, storage = root.localStorage } = {}) {
    const bg = root.BreakGlass, context = learning.context; const listeners = []; const parameterListeners = [];
    let disposed = false, generation = 0, controller = null, pending = null, confirmed = null, saved = false, saving = false;
    const provenanceStore = bg.webProvenance.createStore({ storage, recordsStore: context.store });
    const node = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
    const listen = (target, event, fn, group = listeners) => { target.addEventListener(event, fn); group.push(() => target.removeEventListener(event, fn)); };
    const heading = node('h3', '核对这一帧的数学条件'), intro = node('p', '暂停到想理解的一帧，再主动识别。位置不足时在独立数学画板学习；模型不会替你确认原题。');
    const selector = node('select'); selector.setAttribute('aria-label', '识别的数学对象');
    for (const [value, label] of [['parabola','抛物线'],['right-triangle','直角三角形']]) { const o = node('option', label); o.value = value; selector.append(o); }
    const read = node('button','识别当前帧'), cancel = node('button','停止本次识别'); read.type = cancel.type = 'button';
    read.dataset.recognitionAction = 'read'; cancel.dataset.recognitionAction = 'cancel';
    const actions = node('div'); actions.className = 'actions'; actions.append(selector, read, cancel);
    const status = node('p','尚未识别。模型留空时会显示未配置；手工数学探索仍可使用。'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    const evidence = node('dl'); evidence.className = 'recognition-evidence'; const fields = node('div'); fields.className = 'field-grid';
    const noteLabel = node('label','我想回顾的地方（可选）'), note = node('textarea'); note.maxLength = 1000; note.rows = 2; noteLabel.append(note);
    const confirm = node('button','我已对照画面核对数学条件'), save = node('button','保存核对后的练习记录'); confirm.type = save.type = 'button';
    confirm.dataset.recognitionAction = 'confirm'; save.dataset.recognitionAction = 'save';
    const scope = node('p'); scope.className = 'muted'; scope.dataset.saveScope = 'recognition';
    const saveActions = node('div'); saveActions.className = 'actions'; saveActions.append(confirm,save);
    const board = node('div'); const preview = bg.liveParticles.mount(board, { document });
    const style = node('style'); style.textContent = '.recognition-workbench{margin-top:20px;padding-top:18px;border-top:1px solid var(--line,#cedce3)}.recognition-workbench .recognition-evidence{display:grid;grid-template-columns:minmax(6rem,auto) 1fr;gap:8px 16px}.recognition-evidence dd{margin:0;overflow-wrap:anywhere}.recognition-workbench [hidden]{display:none!important}.recognition-workbench button,.recognition-workbench select{min-height:44px}.recognition-workbench :focus-visible{outline:2px solid #37bada;outline-offset:3px}';
    container.classList.add('recognition-workbench'); container.replaceChildren(style,heading,intro,actions,status,evidence,fields,noteLabel,scope,saveActions,board);
    const inputs = {};
    const identity = () => { const s = learning.snapshot(); return `${s.owner}:${s.generation}:${s.source?.id || ''}:${s.source?.version || ''}`; };
    const ready = () => !disposed && isActive() && !document.hidden;
    function showEvidence(reply, student = false) {
      evidence.replaceChildren();
      for (const [key, value] of [['来源', `${reply.sourceId.slice(-8)} · 第 ${reply.frameTime.toFixed(2)} 秒`],
        ['数学', student ? '学生已核对；原AI候选另行保留' : reply.evidence.mathStatus === 'consistent' ? '程序换算自洽，仍需核对题面' : '有限候选，仍需核对题面'],
        ['位置', '待校对；当前画板不叠到原视频'],['确认', student ? '学生确认' : '尚未确认'],
        ['画板', '按数学条件重新绘制；空间视角不改变二维数学关系']]) evidence.append(node('dt',key),node('dd',value));
    }
    function clearParameters() { parameterListeners.splice(0).forEach(off => off()); fields.replaceChildren(); for (const key of Object.keys(inputs)) delete inputs[key]; }
    function clear() { pending = null; confirmed = null; saved = false; clearParameters(); evidence.replaceChildren(); note.value = ''; preview.update(null); onScene(null); }
    function refresh() {
      if (disposed) return;
      if ((pending && pending.owner !== identity()) || (confirmed && confirmed.owner !== identity())) clear();
      if (confirmed?.writeRecord && !saving && !context.getState().records.some(record => record.id === confirmed.record.id)) {
        generation += 1; controller?.abort(); controller = null; clear(); status.textContent = '父学习记录已删除，旧确认与来源保存已失效。';
      }
      const target = context.getSaveTarget(); scope.textContent = `保存到：${target.label}${target.canSave ? '' : ' · 保存条件尚未确认'}`;
      read.disabled = !ready() || !canRead() || !learning.snapshot().policy?.allowed || Boolean(controller) || saving;
      selector.disabled = Boolean(controller) || saving; note.disabled = saving || Boolean(confirmed?.writeRecord);
      save.textContent = saved ? '数学与来源已保存' : confirmed?.recordSaved ? '补存这条记录的来源' : '保存核对后的练习记录'; cancel.disabled = !controller;
      confirm.disabled = !pending || !ready() || !canRead() || pending.permission !== getPermissionGeneration() || saving;
      save.disabled = !confirmed || !target.canSave || !ready() || saved || saving;
      for (const input of Object.values(inputs)) input.disabled = !pending || saving;
      noteLabel.hidden = !pending && !confirmed; confirm.hidden = !pending || Boolean(confirmed); save.hidden = !confirmed;
    }
    function stop(reason = '识别已停止，未确认候选已清除。已核对数学可继续学习。') {
      generation += 1; controller?.abort(); controller = null;
      context.getVisualSession?.()?.stop(reason);
      if (!confirmed) clear(); else pending = null;
      status.textContent = reason; refresh();
    }
    function parameterFields(reply) {
      clearParameters();
      for (const [key,value] of Object.entries(reply.candidate.snapshot)) {
        const label = node('label',key === 'unit' ? '长度单位' : key), input = node('input');
        input.type = key === 'unit' ? 'text' : 'number'; input.value = String(value); input.dataset.recognitionParameter = key;
        if (key !== 'unit') { input.step = 'any'; input.min = key === 'AB' || key === 'AC' ? '0.000001' : '-1000000'; input.max = '1000000'; } else input.maxLength = 16;
        label.append(input); fields.append(label); inputs[key] = input;
        listen(input,'input',() => { if (confirmed) { confirmed = null; saved = false; preview.update(null); onScene(null); showEvidence(reply); status.textContent = '条件已修改，请再次对照画面确认。'; } refresh(); }, parameterListeners);
      }
    }
    async function recognize() {
      refresh(); if (read.disabled) return; video.pause(); clear();
      const operation = ++generation, owner = identity(), permission = getPermissionGeneration(); const own = new AbortController(); controller = own; refresh();
      status.textContent = '正在识别当前帧；只发送这一张获准画面。';
      const valid = () => ready() && generation === operation && !own.signal.aborted && owner === identity() && permission === getPermissionGeneration() && canRead() && learning.snapshot().policy?.allowed;
      try {
        const session = await context.prepareRecognitionSession(); if (!valid()) return;
        const reply = await session.recognize({ kind: selector.value, frameSize: { width: video.videoWidth, height: video.videoHeight } }, own.signal);
        if (!valid()) return;
        if (reply.status !== 'candidate' || !reply.candidate) { status.textContent = '当前帧没有充分的明确数学条件。可改到题面清晰的一帧，或使用手工数学探索。'; return; }
        pending = { reply, owner, permission }; parameterFields(reply); showEvidence(reply); status.textContent = '已取得候选。请核对公式或直角与边长；位置待校对。';
      } catch (error) { if (generation === operation && !own.signal.aborted) status.textContent = `未取得可确认结果：${error.message}`; }
      finally { if (controller === own) controller = null; refresh(); }
    }
    function confirmMath() {
      refresh(); if (confirm.disabled) return;
      try {
        const reply = pending.reply; const snapshot = {};
        for (const [key,input] of Object.entries(inputs)) snapshot[key] = key === 'unit' ? input.value : input.value.trim() === '' ? NaN : Number(input.value);
        const record = confirmedRecord(reply,snapshot,learning.snapshot().source,{ id:root.crypto.randomUUID(),createdAt:new Date().toISOString(),note:note.value });
        confirmed = { reply,record,owner:identity() }; saved = false; showEvidence(reply,true);
        const scene = {template:record.template,snapshot:record.snapshot,confirmed:true,origin:'student'}; preview.update(scene); onScene(scene);
        status.textContent = '数学条件已由你核对。画板按这些条件绘制；原视频位置仍待校对。'; refresh();
      } catch (error) { status.textContent = `条件未通过数学校验：${error.message}`; }
    }
    async function saveMath() {
      refresh(); if (save.disabled) return;
      const item = confirmed, target = context.getSaveTarget(), owner = identity(), operation = generation; saving = true; refresh();
      const valid = () => ready() && identity() === owner && generation === operation && context.getSaveTarget().owner === target.owner && context.getSaveTarget().epoch === target.epoch;
      let recordSaved = false;
      try {
        const record = item.writeRecord || {...item.record,note:note.value.trim() ? note.value : item.record.note}; item.writeRecord = copy(record);
        if (!item.recordSaved) { await learning.saveSnapshot(record,'practice'); item.recordSaved = true; }
        recordSaved = true;
        if (!valid()) throw new Error('学习范围已改变，来源保存未确认。');
        if (!context.getState().records.some(value => value.id === record.id)) throw new Error('父学习记录已删除，旧来源不能写回。');
        const metadata = provenanceMetadata(item.reply,record);
        if (target.scope === 'account') await context.client.saveProvenance(record.id,metadata);
        else provenanceStore.save(metadata,target.epoch);
        await context.refreshData?.();
        if (!valid()) throw new Error('学习范围已改变，请到对应范围核对保存结果。');
        saved = true; status.textContent = `已保存到 ${target.label}。原候选、学生核对与位置待校对分别保留；可从疑问与易错进入复练。`;
      } catch (error) { status.textContent = `${recordSaved ? '数学记录已保存，来源保存未确认，可补存来源' : '保存未确认'}：${error.message}`; }
      finally { saving = false; refresh(); }
    }
    listen(read,'click',()=>void recognize()); listen(cancel,'click',()=>stop()); listen(confirm,'click',confirmMath); listen(save,'click',()=>void saveMath());
    listen(video,'seeking',()=>stop('视频位置改变，未确认画面已取消。')); listen(video,'emptied',()=>{stop();clear();refresh();});
    listen(document,'visibilitychange',()=>{if(document.hidden)stop('页面隐藏，识别已停止。');else refresh();});
    listen(root,'storage',refresh); refresh();
    return { stop,refresh,snapshot:()=>({pending:Boolean(pending),confirmed:Boolean(confirmed),saved,saving}),destroy(){if(disposed)return;stop();disposed=true;listeners.forEach(off=>off());clearParameters();preview.destroy();container.replaceChildren();} };
  }
  return { confirmedRecord,provenanceMetadata,mount };
});
