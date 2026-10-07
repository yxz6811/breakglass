(function(root,factory){const api=factory(root);if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BreakGlass=root.BreakGlass||{};root.BreakGlass.learningFlowUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  function mount(container,{document=root.document,getState,getOwner,getSaveTarget,localStore,recordsStore,annotationStore,accountClient,onChanged=()=>{}}={}){
    const flow=root.BreakGlass.learningFlow, storeAPI=root.BreakGlass.learningFlowStore;
    const listeners=[],downloads=new Map();let owner='',generation=0,disposed=false,current=null,preview=null,busy=false,exampleDetails=null,exampleBody=null;
    let displayedRecordId=null,purposeDirty=false,reviewDirty=false,causeDirty=false,purposeRevision=0,reviewRevision=0,causeRevision=0,causeMetadata=null;
    const projection=typeof require==='function'?require('./learning-evidence'):root.BreakGlass.learningEvidence;
    const evidence=()=>projection.project(data(),{scope:data().scope||'local',owner:key(),epoch:data().epoch||0});
    const n=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    const listen=(el,type,fn,scope='persistent')=>{el.addEventListener(type,fn);listeners.push([el,type,fn,scope]);};
    function release(scope){for(let i=listeners.length-1;i>=0;i--){const[e,t,f,s]=listeners[i];if(s===scope){e.removeEventListener(t,f);listeners.splice(i,1);}}}
    function button(key,label,fn,scope='persistent'){const b=n('button',label);b.type='button';b.dataset.flowAction=key;listen(b,'click',fn,scope);return b;}
    function key(){return JSON.stringify(getOwner());}function data(){return getState();}function account(){return data().scope==='account';}
    function checked(g,o){return!disposed&&g===generation&&o===key();}function message(text){status.textContent=text;}
    async function operation(fn){if(busy)return;const g=generation,o=key();busy=true;
      try{await fn(g,o);}catch(error){if(checked(g,o))message(`操作未确认：${error.message}。输入已保留。`);}finally{if(checked(g,o))busy=false;}}
    function calendarDate(value){if(!value)return'';const d=new Date(value);return `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
    function calendarInstant(value){if(!value)return null;const d=new Date(`${value}T00:00:00`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(d.getTime())||calendarDate(d)!==value)throw new Error('请选择有效的本地日历日期');return d.toISOString();}
    function closeExample(){if(exampleDetails)exampleDetails.open=false;exampleBody?.replaceChildren();}
    function changeRecord(){generation++;busy=false;renderRecord();}
    function selectRecord(id){if(disposed||!data().records.some(r=>r.id===id))return false;select.value=id;changeRecord();return true;}
    function record(){return data().records.find(r=>r.id===select.value);}
    function writePurpose(r,p){const d=data(),rev=purposeRevision;
      return account()?accountClient.savePurpose(r.id,p,rev):Promise.resolve(localStore.savePurpose(r.id,p,{expectedRevision:rev,expectedEpoch:d.epoch}));}
    function formAnswer(view){if(view.input.type==='choice')return answerFields.querySelector('select').value;
      const inputs=Array.from(answerFields.querySelectorAll('input'));if(inputs.some(i=>!i.value.trim()||!Number.isFinite(i.valueAsNumber)))throw new Error('请填有限数值答案');
      return view.input.type==='vertex'?{h:inputs[0].valueAsNumber,k:inputs[1].valueAsNumber}:inputs[0].valueAsNumber;}
    function openExercise(exercise,context){const r=data().records.find(r=>r.id===exercise.recordId);if(!r)return;closeExample();release('cause');
      const view=flow.exerciseView(exercise,r);current={exercise,context,record:r,view};study.hidden=false;prompt.textContent=`${exercise.stage==='completion'?'补关键步骤':exercise.stage==='delayed'?'延后题型（可先试做，未证明延后记忆）':'独立新题'} · ${view.prompt}`;
      answerFields.replaceChildren();feedback.textContent='';help.textContent='';causePanel.replaceChildren();causePanel.hidden=true;
      if(view.input.type==='choice'){const label=n('label','选择答案'),input=n('select');input.dataset.flowAnswer='choice';
        for(const option of view.options){const el=n('option',option.label);el.value=option.value;input.append(el);}label.append(input);answerFields.append(label);
      }else for(const name of view.input.type==='vertex'?['h','k']:['number']){const label=n('label',name==='number'?'你的数值答案':`顶点坐标 ${name}`),input=n('input');input.type='number';input.step='any';input.dataset.flowAnswer=name;label.append(input);answerFields.append(label);}
      const receipt=data().flow?.receipts.find(r=>r.exerciseId===exercise.id);submit.disabled=Boolean(receipt);
      if(receipt)showReceipt(receipt);else message('这是一道独立的新题。提示和答案使用会保存为帮助事实；跳过不生成作答。');
    }
    async function create(kind,stage='practice',index=null){const g=generation,o=key(),r=record();if(!r)throw new Error('先选择一条已保存原题');
      if(flow.purposeOf(r.id,data().flow?.purposes||[])!=='practice')throw new Error('先明确选择“可作答练习”并保存用途');
      const count=data().flow?.exercises.filter(e=>e.recordId===r.id&&e.kind===kind).length||0;
      const opts={recordId:r.id,kind,stage,index:index||count%20+1};const result=account()?await accountClient.createExercise(opts):localStore.createExercise(opts,data().epoch);
      if(!checked(g,o)||select.value!==r.id)return;await onChanged();
      if(!checked(g,o)||select.value!==r.id)return;openExercise(result.exercise,result.context);
    }
    async function showHelp(type){if(!current)return;const g=generation,o=key(),c=current;
      const receipt=data().flow?.receipts.find(r=>r.exerciseId===c.exercise.id);
      if(!receipt){const value={type,...(type==='hint'?{level:Math.min(3,c.context.hintsShown+1)}:{})};
        const result=account()?await accountClient.exerciseHelp(c.exercise.id,value):localStore.help(c.exercise.id,value,data().epoch);
        if(!checked(g,o)||current!==c)return;c.context=result.context;await onChanged();}
      if(!checked(g,o)||current!==c)return false;
      help.textContent=type==='hint'?c.view.hints[Math.max(0,c.context.hintsShown-1)]:type==='answer'?`程序答案：${typeof c.view.answer==='object'?JSON.stringify(c.view.answer):c.view.answer}。${c.view.explanation}`:c.view.explanation;
      return true;
    }
    function showReceipt(receipt){current.receiptId=receipt.id;submit.disabled=true;feedback.textContent=`${current.exercise.stage==='completion'?'补步骤结果：':''}${receipt.correct?receipt.hintUsed?'借助帮助完成':'无帮助实际正确':'实际答错'}。${current.view.explanation}`;
      const candidates=flow.causeCandidates(current.record,receipt,current.exercise);release('cause');causePanel.replaceChildren();causePanel.hidden=!candidates.length;
      if(!candidates.length)return;causePanel.append(n('p','以下只是错因候选，请自行确认、修正或保留待确认。'));
      const choose=n('select');choose.dataset.flowAction='cause';const unknown=n('option','待确认 / 暂不归因');unknown.value='';choose.append(unknown);
      for(const c of candidates){const option=n('option',c.label);option.value=c.id;choose.append(option);}
      const old=data().annotations?.find(a=>a.recordId===current.record.id),prior=old?.tags.find(t=>t.startsWith('确认:'))?.slice(3);choose.value=prior||'';
      causeRevision=old?.revision||0;causeMetadata=old;causeDirty=false;listen(choose,'change',()=>{causeDirty=true;},'cause');
      causePanel.append(choose,button('confirm-cause','保存我的错因判断',()=>operation(async(g,o)=>{
        const c=current,r=c.record,existing=causeMetadata,confirmed=choose.value;
        const tags=(existing?.tags||[]).filter(t=>!t.startsWith('确认:'));if(confirmed)tags.push(`确认:${confirmed}`);
        const metadata={title:existing?.title||r.title,note:existing?.note||r.note,kind:existing?.kind||r.kind,tags};
        if(account())await accountClient.saveAnnotation(r.id,metadata,causeRevision);
        else annotationStore.save(r.id,metadata,{expectedRevision:causeRevision,expectedEpoch:data().epoch});
        if(!checked(g,o)||current!==c)return;await onChanged();if(!checked(g,o)||current!==c)return;message(confirmed?'已保存学生确认错因，可重新选择修正。':'已恢复待确认，不生成能力诊断。');
        causeDirty=false;causeMetadata=data().annotations?.find(a=>a.recordId===r.id);causeRevision=causeMetadata?.revision||0;
      }),'cause'),button('targeted','按已确认错因生成新题',()=>operation(async()=>{
        const r=current.record,tag=data().annotations?.find(a=>a.recordId===r.id)?.tags.find(t=>t.startsWith('确认:'));
        const ex=flow.reviewExercise(r,{confirmedCause:tag?.slice(3)||null,index:(data().flow?.exercises.length||0)%20+1});await create(ex.kind,ex.stage,ex.index);
      }),'cause'));
    }
    function renderSchedule(r=record()){if(!r){reviewDate.value='';schedule.textContent='先选择一条学习原题。';return;}
      const review=data().flow?.reviews.find(v=>v.recordId===r.id),revision=review?.revision||0;
      if(!reviewDirty){reviewDate.value=calendarDate(review?.reviewAt);reviewRevision=revision;}
      else if(revision!==reviewRevision)message('复练设置已在其他位置更新；日期草稿保留，请重新读取版本并比较后保存。');
      try{const plan=evidence().records.find(item=>item.recordId===r.id)?.plan;if(!plan)throw new Error('原题未通过学习证据核对');
        schedule.textContent=`${plan.reason} ${plan.reviewAt?`建议日期：${new Date(plan.reviewAt).toLocaleDateString()}`:'尚无作答安排'}；这是可调整的产品建议。`;
      }catch(error){schedule.textContent=error.message;}}
    function renderRecord(){const r=record();displayedRecordId=r?.id||null;purposeDirty=false;reviewDirty=false;causeDirty=false;release('lesson');release('cause');lesson.replaceChildren();lessonActions.replaceChildren();study.hidden=true;current=null;exampleDetails=null;exampleBody=null;answerFields.replaceChildren();feedback.textContent='';help.textContent='';causePanel.replaceChildren();renderSchedule(r);if(!r)return;
      const setting=data().flow?.purposes.find(v=>v.recordId===r.id);purposeRevision=setting?.revision||0;purpose.value=flow.purposeOf(r.id,data().flow?.purposes||[]);
      try{
        const course=flow.lessonFor(r);lesson.append(n('h4',course.title),n('p',course.sourceLabel));
        const details=n('details'),summary=n('summary','完整例题：展开示范'),body=n('div');details.append(summary,body);exampleDetails=details;exampleBody=body;
        lesson.append(details,n('p','可以先看完整示范，再补步骤，再做不同条件的新题。各阶段可以跳过。'));
        const reveal=()=>operation(async(g,o)=>{const c=current;if(c&&!(await showHelp('example')))return;
          if(!checked(g,o)||current!==c||exampleDetails!==details)return;
          body.replaceChildren(...course.steps.map(step=>n('p',`${step.title}：${step.text}`)));details.open=true;});
        listen(summary,'click',(event)=>{event.preventDefault();if(details.open){details.open=false;return;}void reveal();},'lesson');
        // Native accessibility expansion may bypass click. Keep the body empty
        // until the durable help write succeeds, so a failed write never leaks steps.
        listen(details,'toggle',()=>{if(details.open&&!body.children.length){details.open=false;void reveal();}},'lesson');
        lessonActions.append(button('completion','补一个关键步骤',()=>operation(()=>create(course.completionKind,'completion')),'lesson'));
        course.practiceKinds.forEach((kind,index)=>lessonActions.append(button(`practice-${index}`,index===0?'做一道独立新题':'换一种表征 / 适用条件',()=>operation(()=>create(kind)),'lesson')));
        lessonActions.append(button('delayed','延后关系新题（可先试做）',()=>operation(()=>create(course.delayedKinds[0],'delayed')),'lesson'));
        const pending=(data().flow?.exercises||[]).filter(e=>e.recordId===r.id&&!data().flow.receipts.some(a=>a.exerciseId===e.id)).slice(-1)[0];
        if(pending)lessonActions.append(button('resume','继续未提交题（保留提示事实）',()=>{generation++;busy=false;openExercise(pending,data().flow.contexts.find(c=>c.exerciseId===pending.id));},'lesson'));
      }catch(error){lesson.append(n('p','此模板继续使用七模板工作台；两条微课目前针对抛物线平移与直角条件。'));schedule.textContent=error.message;}
    }
    function queue(){release('queue');queueList.replaceChildren();const entries=evidence().queue[mode.value]||[];
      entries.slice(0,20).forEach(e=>{const row=n('div');row.append(n('p',`${e.record.title} · ${e.reason}`),button(`queue-${e.recordId}`,'开始这条记录',()=>{select.value=e.recordId;changeRecord();},'queue'));queueList.append(row);});
      if(!entries.length)queueList.append(n('p','暂无符合此策略的练习；解释和用途待确认记录不会混入。'));
    }
    const style=n('style');style.textContent='.learning-flow-workbench{display:grid;gap:16px}.learning-flow-workbench .flow-fields{display:flex;flex-wrap:wrap;gap:12px}.learning-flow-workbench label{display:grid;gap:6px}.learning-flow-workbench input,.learning-flow-workbench select,.learning-flow-workbench button,.learning-flow-workbench summary{min-height:44px}.learning-flow-workbench section{padding:16px;border:1px solid var(--line,#a5cbd3);border-radius:16px}.learning-flow-workbench :focus-visible{outline:2px solid #22a7c5;outline-offset:3px}';
    container.classList.add('learning-flow-workbench');const status=n('p');status.setAttribute('role','status');status.dataset.flowAction='status';
    const stats=n('p'),select=n('select');select.dataset.flowAction='record';const selectLabel=n('label','学习原题');selectLabel.append(select);listen(select,'change',changeRecord);
    const purpose=n('select');purpose.dataset.flowAction='purpose';for(const[v,t]of[['unclassified','用途待确认'],['practice','可作答练习'],['reflection','解释笔记']]){const o=n('option',t);o.value=v;purpose.append(o);}
    listen(purpose,'change',()=>{purposeDirty=true;});
    const purposeLabel=n('label','记录用途');purposeLabel.append(purpose);const fields=n('div');fields.className='flow-fields';
    fields.append(selectLabel,purposeLabel,button('save-purpose','保存用途',()=>operation(async(g,o)=>{const r=record();if(!r)throw new Error('没有原题');await writePurpose(r,purpose.value);if(!checked(g,o))return;purposeDirty=false;await onChanged();if(!checked(g,o))return;refresh();message('用途已保存；原数学与作答保持完整。');})));
    const lesson=n('section'),lessonActions=n('div');lessonActions.className='flow-fields';const study=n('section');study.hidden=true;const prompt=n('p'),answerFields=n('div');answerFields.className='flow-fields';
    const submit=button('submit','提交这道新题',()=>operation(async(g,o)=>{if(!current)return;const c=current,answer=formAnswer(c.view);
      const result=account()?await accountClient.submitExercise(c.exercise.id,answer):localStore.submit(c.exercise.id,answer,data().epoch);
      if(!checked(g,o)||current!==c)return;await onChanged();if(!checked(g,o)||current!==c)return;showReceipt(result.receipt);message('已保存实际作答；同题帮助上下文锁定，复练请创建新题。');}));
    const help=n('p'),feedback=n('p'),causePanel=n('div');const helpActions=n('div');helpActions.className='flow-fields';
    helpActions.append(submit,button('hint','给下一层提示',()=>operation(()=>showHelp('hint'))),button('answer','查看答案与解析',()=>operation(()=>showHelp('answer'))),button('skip','跳过此题',()=>{generation++;busy=false;current=null;closeExample();study.hidden=true;message('已跳过，不保存作答；以后继续时提示事实保留。');}));
    study.append(prompt,answerFields,helpActions,help,feedback,causePanel);
    const schedule=n('p'),reviewDate=n('input');reviewDate.type='date';reviewDate.dataset.flowAction='review-date';listen(reviewDate,'input',()=>{reviewDirty=true;});listen(reviewDate,'change',()=>{reviewDirty=true;});const dateLabel=n('label','调整复练日期（本地日历）');dateLabel.append(reviewDate);
    async function review(skip){const g=generation,o=key(),r=record();if(!r)throw new Error('先选原题');
      const value={reviewAt:calendarInstant(reviewDate.value),skippedUntil:skip?new Date(Date.now()+86400000).toISOString():null};
      if(account())await accountClient.saveReview(r.id,value,reviewRevision);else localStore.saveReview(r.id,value,{expectedRevision:reviewRevision,expectedEpoch:data().epoch});
      if(!checked(g,o))return;reviewDirty=false;await onChanged();if(!checked(g,o))return;refresh();message(skip?'已暂跳一天，没有作答。':'复练日期已保存，可再次修改。');}
    const scheduleBox=n('section');scheduleBox.append(schedule,dateLabel,button('review-save','保存复练日期',()=>operation(()=>review(false))),button('review-skip','暂跳一天',()=>operation(()=>review(true))),button('reread-settings','重新读取版本（保留输入）',()=>{
      const r=record();if(!r)return;purposeRevision=data().flow?.purposes.find(v=>v.recordId===r.id)?.revision||0;reviewRevision=data().flow?.reviews.find(v=>v.recordId===r.id)?.revision||0;
      if(current){causeMetadata=data().annotations?.find(v=>v.recordId===current.record.id);causeRevision=causeMetadata?.revision||0;}
      message('已读取最新修订；用途、日期和错因输入保留，请比较后保存。');}));
    const mode=n('select');mode.dataset.flowAction='queue-mode';for(const[v,t]of[['due','到期复练'],['manual','主动复练'],['foundation','单类基础'],['interleaved','有独立基础后混练']]){const o=n('option',t);o.value=v;mode.append(o);}listen(mode,'change',queue);
    const queueList=n('div'),queueBox=n('section');queueBox.append(n('h4','选择复练策略'),mode,queueList);
    const migration=n('section'),previewBox=n('div');migration.append(n('h4','网站访客记录迁移'),n('p','完整来源包括主机和端口。先导出、预览与选择；导入历史答案只供核对，不写入独立表现或调度。'));
    function download(){const d=recordsStore.read();const pack={schemaVersion:'1',kind:'breakglass-website-visitor',origin:root.location.origin,createdAt:new Date().toISOString(),records:d.records,attempts:d.attempts,annotations:annotationStore.read().annotations,watch:d.watch,flow:localStore.read().flow};
      const text=JSON.stringify(pack,null,2);storeAPI.parseWebsitePackage(text);const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=n('a','下载迁移包');link.href=url;link.download='breakglass-visitor.json';migration.append(link);link.click();const timer=setTimeout(()=>{URL.revokeObjectURL(url);link.remove();downloads.delete(url);},1000);downloads.set(url,{timer,link});}
    const file=n('input');file.type='file';file.accept='application/json,.json';file.dataset.flowAction='migration-file';const fileLabel=n('label','选择网站访客迁移包');fileLabel.append(file);
    listen(file,'change',()=>operation(async(g,o)=>{const input=file.files[0];if(!input)return;if(input.size>2*1024*1024)throw new Error('迁移文件超过2MiB');const pack=storeAPI.parseWebsitePackage(await input.text());if(!checked(g,o))return;preview=pack;previewBox.replaceChildren(n('p',`来源 ${pack.origin}；${pack.records.length}条原题，${pack.attempts.length+pack.flow.receipts.length}条用户提供历史（未验证）。`));
      pack.records.forEach(r=>{const label=n('label',r.title),check=n('input');check.type='checkbox';check.dataset.flowImport=r.id;label.prepend(check);previewBox.append(label);});}));
    migration.append(button('migration-export','导出当前网站访客数据',()=>operation(download)),fileLabel,previewBox,button('migration-import','导入勾选的原题与备注 / 观看',()=>operation(async(g,o)=>{
      if(!preview)throw new Error('先预览迁移包');const pack=preview,ids=new Set(Array.from(previewBox.querySelectorAll('input:checked')).map(i=>i.dataset.flowImport));if(!ids.size)throw new Error('先选择原题');let count=0;
      for(const r of pack.records.filter(r=>ids.has(r.id))){if(!checked(g,o)||preview!==pack)return;
        const existing=data().records.find(v=>v.id===r.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(r))throw new Error('同ID原题内容冲突，已保留两边输入');
        if(account())await accountClient.saveRecord(r);else recordsStore.save(r,data().epoch);if(!checked(g,o)||preview!==pack)return;count++;
        const annotation=pack.annotations.find(a=>a.recordId===r.id);if(annotation){const old=data().annotations?.find(a=>a.recordId===r.id);if(old)continue;
          const metadata={title:annotation.title,note:annotation.note,kind:annotation.kind,tags:annotation.tags};if(account())await accountClient.saveAnnotation(r.id,metadata,0);else annotationStore.save(r.id,metadata,{expectedRevision:0,expectedEpoch:data().epoch});}
      }
      const sources=new Set(pack.records.filter(r=>ids.has(r.id)).map(r=>root.BreakGlass.webRecords.identity(r.source)));
      for(const w of pack.watch.filter(w=>sources.has(root.BreakGlass.webRecords.identity(w.source)))){if(!checked(g,o)||preview!==pack)return;if(account())await accountClient.saveWatch(w);else recordsStore.saveWatch(w,data().epoch);}
      if(!checked(g,o)||preview!==pack)return;await onChanged();if(!checked(g,o)||preview!==pack)return;refresh();message(`已确认导入${count}条原题；历史答案未计独立表现，用途待你重新确认。`);
    })));
    const saveScope=n('p');saveScope.dataset.flowAction='save-scope';
    container.replaceChildren(style,n('h3','理解与复练闭环'),stats,saveScope,fields,lesson,lessonActions,study,scheduleBox,queueBox,migration,status);
    function refresh(){if(disposed)return;const next=key();if(next!==owner){owner=next;generation++;current=null;preview=null;busy=false;displayedRecordId=null;purposeDirty=false;reviewDirty=false;causeDirty=false;study.hidden=true;previewBox.replaceChildren();}
      const d=data(),f=d.flow||storeAPI.emptyFlow(),latest=select.value;select.replaceChildren();for(const r of d.records||[]){const option=n('option',r.title);option.value=r.id;select.append(option);}if(d.records?.some(r=>r.id===latest))select.value=latest;
      const p=evidence(),s=p.summary;stats.textContent=`统一作答证据：独立正确 ${s.independentCorrect}；辅助正确 ${s.assistedCorrect}；错误 ${s.wrong}；补步骤 ${s.completion}；延后题型提交（实际间隔另核） ${s.delayed}。观看时长单独记录，不换算掌握百分比。`;
      const target=getSaveTarget?.()||{label:account()?`账号：${d.user?.username||'尚未登录'}`:'本机访客 · 这台浏览器',canSave:!account()||Boolean(d.user)};
      saveScope.textContent=`保存到：${target.label}${target.canSave?'':' · 保存条件尚未确认'}`;
      if(current&&(!d.records.some(r=>r.id===current.record.id)||!f.exercises.some(e=>e.id===current.exercise.id))){generation++;busy=false;current=null;displayedRecordId=null;study.hidden=true;}
      if(displayedRecordId!==select.value||!displayedRecordId)renderRecord();else{
        const setting=f.purposes.find(v=>v.recordId===select.value),revision=setting?.revision||0;
        if(!purposeDirty){purpose.value=setting?.purpose||'unclassified';purposeRevision=revision;}else if(revision!==purposeRevision)message('用途已在其他位置更新；输入保留，请重新读取版本并比较后保存。');
        renderSchedule();
        if(current){const contexts=f.contexts.filter(c=>c.exerciseId===current.exercise.id),context=contexts[0];
          if(contexts.length===1){const previous=current.context;current.context=flow.validateContext(context,current.exercise);
            if(current.context.hintsShown>previous.hintsShown||current.context.answerShown&&!previous.answerShown||current.context.exampleShown&&!previous.exampleShown)message('同题帮助事实已更新；答案输入保留，提交按最新帮助核对。');}
          const event=p.events.find(e=>e.sourceType==='receipt'&&e.exerciseId===current.exercise.id),receipt=event&&f.receipts.find(r=>r.id===event.key.slice(8));
          submit.disabled=f.receipts.some(r=>r.exerciseId===current.exercise.id)||contexts.length!==1;
          if(receipt&&current.receiptId!==receipt.id){showReceipt(receipt);message('此题已在其他位置提交；输入保留，作答与帮助已锁定，请创建新题复练。');}
          const annotation=d.annotations?.find(a=>a.recordId===current.record.id),rev=annotation?.revision||0;
          if(current.receiptId&&rev!==causeRevision){if(causeDirty)message('错因备注已在其他位置更新；选择保留，请重新读取版本并比较后保存。');else{causeMetadata=annotation;causeRevision=rev;const choose=causePanel.querySelector('select');if(choose)choose.value=annotation?.tags.find(t=>t.startsWith('确认:'))?.slice(3)||'';}}
        }
      }queue();}
    refresh();return{refresh,selectRecord,destroy(){disposed=true;generation++;listeners.splice(0).forEach(([e,t,f])=>e.removeEventListener(t,f));downloads.forEach(({timer,link},url)=>{clearTimeout(timer);URL.revokeObjectURL(url);link.remove();});downloads.clear();container.replaceChildren();}};
  }
  return{mount};
});
