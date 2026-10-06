(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.webAnnotationEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const rules = () => typeof require === 'function' ? require('./annotations') : root.BreakGlass.webAnnotations;
  function createUI({ document: doc = root.document, container, load, save, isCurrent, onSaved = () => {} }) {
    if (!container || !doc || ![load, save, isCurrent, onSaved].every((fn) => typeof fn === 'function')) {
      throw new TypeError('备注编辑器需要容器、读写和生命周期校验。');
    }
    let generation = 0; let active = null; let busy = false; let conflict = false;
    const make = (tag, text) => { const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
    const form = make('form'); form.className = 'annotation-editor record-card';
    form.append(make('h3', '编辑个人学习记录'), make('p', '更新标题、备注和原因标签。数学条件、来源与实际作答证据保留在原记录中。'));
    const field = (text, control) => { const label = make('label'); label.append(make('span', text), control); form.append(label); return control; };
    const title = field('标题', make('input')); title.type = 'text'; title.maxLength = 120; title.required = true;
    const note = field('个人备注', make('textarea')); note.maxLength = 1000; note.rows = 4;
    const kind = field('记录类型', make('select'));
    [['question', '疑问'], ['pitfall', '个人易错标记']].forEach(([value, text]) => { const option = make('option', text); option.value = value; kind.append(option); });
    const tags = field('原因标签（用中文或英文逗号分隔，最多8个，每个24字以内）', make('input')); tags.type = 'text';
    const status = make('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const latest = make('p'); latest.className = 'muted';
    const actions = make('div'); actions.className = 'actions';
    const submit = make('button', '保存备注'); submit.type = 'submit';
    const reread = make('button', '重新读取版本（保留输入）'); reread.type = 'button';
    const cancel = make('button', '关闭编辑'); cancel.type = 'button';
    actions.append(submit, reread, cancel); form.append(latest, status, actions); container.replaceChildren(form); container.hidden = true;
    const controls = [title, note, kind, tags];
    function current(owner) { return active === owner && generation === owner.generation && isCurrent(owner.record, owner.scope); }
    function update() { controls.forEach((input) => { input.disabled = busy || !active; }); submit.disabled = busy || !active || conflict; reread.disabled = busy || !active; }
    function close() { generation += 1; active = null; busy = false; conflict = false; container.hidden = true;
      controls.forEach((input) => { input.value = ''; }); latest.textContent = ''; status.textContent = ''; update(); }
    function receipt(value, owner) {
      if (!value || !Number.isSafeInteger(value.epoch) || value.epoch < 0 || value.epoch >= Number.MAX_SAFE_INTEGER) throw new Error('备注响应数据版本无效。');
      if (value.annotation !== null) {
        value = { ...value, annotation: rules().validateAnnotation(value.annotation) };
        if (value.annotation.recordId !== owner.record.id) throw new Error('备注响应不属于当前记录。');
      }
      return value;
    }
    async function read(owner, keepInput) {
      busy = true; update(); status.textContent = '正在读取当前备注修订…';
      try {
        const value = receipt(await load(owner.record, owner.scope), owner);
        if (!current(owner)) return;
        owner.revision = value.annotation?.revision || 0; owner.epoch = value.epoch; conflict = false;
        const metadata = value.annotation || { ...owner.record, tags: [] };
        if (!keepInput) { title.value = metadata.title; note.value = metadata.note; kind.value = metadata.kind; tags.value = metadata.tags.join('，'); }
        latest.textContent = `当前修订 ${owner.revision}：${metadata.title}；${metadata.note || '空备注'}；标签：${metadata.tags.join('、') || '无'}`;
        status.textContent = keepInput ? '已读取最新修订，你的输入保留。请比较后再次保存。' : '可以编辑个人备注和原因标签。';
      } catch (error) { if (current(owner)) { conflict = true; status.textContent = `读取未确认：${error.message}`; } }
      finally { if (current(owner)) { busy = false; update(); } }
    }
    async function open(record, scope) {
      close();
      if (!record || !['local', 'account'].includes(scope) || !isCurrent(record, scope)) return;
      const owner = { record, scope, generation, revision: 0, epoch: null }; active = owner; container.hidden = false;
      await read(owner, false); if (current(owner) && !busy) title.focus();
    }
    async function submitForm(event) {
      event.preventDefault(); const owner = active;
      if (!owner || busy || conflict || !current(owner)) return;
      let metadata;
      try { metadata = rules().validateMetadata({ title: title.value, note: note.value, kind: kind.value,
        tags: tags.value.trim() ? tags.value.split(/[,，]/).map((tag) => tag.trim()) : [] }); }
      catch (error) { status.textContent = error.message; return; }
      busy = true; update(); status.textContent = '正在保存备注，结果待确认…';
      try {
        const value = receipt(await save(owner.record, owner.scope, metadata, owner.revision, owner.epoch), owner);
        if (!current(owner)) return;
        if (value.epoch !== owner.epoch || !value.annotation) throw new Error('数据版本已改变，请重新读取当前记录。');
        owner.revision = value.annotation.revision; status.textContent = `备注已确认保存，修订 ${owner.revision}。`;
        latest.textContent = `当前修订 ${owner.revision}：${value.annotation.title}；${value.annotation.note || '空备注'}；标签：${value.annotation.tags.join('、') || '无'}`;
        onSaved(value, owner.record, owner.scope);
      } catch (error) {
        if (current(owner)) {
          conflict = ['revision_conflict', 'epoch_conflict', 'record_not_found'].includes(error.code);
          status.textContent = conflict ? `${error.message} 输入已保留，请重新读取版本。` : `保存未确认：${error.message} 输入已保留。`;
        }
      } finally { if (current(owner)) { busy = false; update(); } }
    }
    form.addEventListener('submit', submitForm);
    const reload = () => { if (active && !busy && current(active)) void read(active, true); };
    reread.addEventListener('click', reload);
    cancel.addEventListener('click', close);
    update();
    return { open, close, invalidate: close, destroy() { close(); form.removeEventListener('submit', submitForm);
      reread.removeEventListener('click', reload); cancel.removeEventListener('click', close); container.replaceChildren(); } };
  }
  return { createUI };
});
