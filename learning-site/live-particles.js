(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.liveParticles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  function dependencies() { return typeof require === 'function' ? {
    particles: require('../extension/src/plugin/particle-renderer'), math: require('./math-learning')
  } : { particles: root.BreakGlass.particles, math: root.BreakGlass.mathLearning }; }
  function formula(template, snapshot) {
    const math = dependencies().math;
    return math.isExtended(template) ? math.equation(template, snapshot) : template === 'parabola'
      ? `y=${snapshot.a}(x−(${snapshot.h}))²+(${snapshot.k})`
      : `A为直角，AB=${snapshot.AB}，AC=${snapshot.AC} ${snapshot.unit}`;
  }
  function mount(container, { document = root.document } = {}) {
    const { particles } = dependencies(); const listeners = [];
    let renderer = null, current = null, disposed = false, planar = false, dragging = null;
    const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const listen = (el, event, fn) => { el.addEventListener(event, fn); listeners.push([el,event,fn]); };
    const heading = node('h3', '实时数学观察'), equation = node('p'), status = node('p', '先确认一个数学场景，再观察实线图像。');
    status.setAttribute('role', 'status'); const stage = node('div'); stage.className = 'live-particle-stage';
    const canvas = node('canvas'); canvas.setAttribute('aria-label', '确认数学的实线空间视角'); canvas.tabIndex = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox','0 0 640 360');
    svg.setAttribute('role','img'); svg.setAttribute('aria-label','同一数学条件的二维实线图');
    stage.append(canvas, svg); const controls = node('div'); controls.className = 'live-particle-controls';
    const fields = {};
    for (const [key, label, min, max] of [['yaw','水平视角',-85,85],['pitch','俯仰视角',-60,60]]) {
      const field = node('label',label), input = node('input'); input.type='range'; input.min=String(min); input.max=String(max); input.value='0'; input.step='1'; input.dataset.particleControl=key;
      field.append(input); controls.append(field); fields[key] = input; listen(input,'input',applyView);
    }
    const twoD = node('button','恢复二维正视'), space = node('button','空间观察'), reset = node('button','恢复默认视角');
    for (const el of [twoD,space,reset]) el.type='button';
    twoD.dataset.particleControl='2d'; space.dataset.particleControl='space'; reset.dataset.particleControl='reset'; controls.append(twoD,space,reset);
    const style = node('style'); style.textContent = '.live-particles .live-particle-stage{background:#081521;border-radius:18px;overflow:hidden}.live-particles canvas,.live-particles svg{display:block;width:100%;height:clamp(180px,30vw,340px)}.live-particles [hidden]{display:none!important}.live-particles .live-particle-controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.live-particles label{display:grid;gap:6px}.live-particles button,.live-particles input{min-height:44px}.live-particles :focus-visible{outline:2px solid #37bada;outline-offset:3px}';
    container.classList.add('live-particles'); container.replaceChildren(style,heading,equation,stage,status,controls); stage.hidden=true;
    function draw2D(scene) {
      const points = scene.points, xs = points.map(p=>p.x), ys = points.map(p=>p.y);
      const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
      const scale=Math.min(560/Math.max(1,maxX-minX),280/Math.max(1,maxY-minY)); svg.replaceChildren();
      // Respect registered edge topology; disjoint edges never share a stroke.
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const d=scene.outline.map((p,i)=>`${scene.outlineMode==='lines'?(i%2?'L':'M'):(i?'L':'M')}${320+(p.x-(minX+maxX)/2)*scale},${180-(p.y-(minY+maxY)/2)*scale}`).join(' ');
      path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#82e7ff');path.setAttribute('stroke-width','2.5');path.setAttribute('stroke-linejoin','round');svg.append(path);
    }
    function applyView() { if (!renderer || disposed || planar) return;
      renderer.setView({yaw:Number(fields.yaw.value)*Math.PI/180,pitch:Number(fields.pitch.value)*Math.PI/180}); }
    function cameraFromRenderer() { const view=renderer?.getState().view || {yaw:0,pitch:0}; fields.yaw.value=String(view.yaw*180/Math.PI); fields.pitch.value=String(view.pitch*180/Math.PI); }
    function displayMode() {
      const fallback = !renderer || renderer.getState().mode !== 'webgl'; canvas.hidden=planar||fallback;
      // SVGElement has no reflected HTMLElement.hidden property.
      if (canvas.hidden) svg.removeAttribute('hidden'); else svg.setAttribute('hidden','');
      for (const input of Object.values(fields)) input.disabled=planar||fallback;
      space.disabled=fallback; reset.disabled=fallback;
    }
    listen(twoD,'click',()=>{planar=true; renderer?.setView({yaw:0,pitch:0}); cameraFromRenderer(); displayMode();});
    listen(space,'click',()=>{planar=false; renderer?.setView({yaw:-0.4,pitch:0.25}); cameraFromRenderer(); displayMode();});
    listen(reset,'click',()=>{planar=false; renderer?.resetView(); cameraFromRenderer(); displayMode();});
    listen(canvas,'pointerdown',event=>{if(!renderer||planar)return; dragging={x:event.clientX,y:event.clientY,view:renderer.getState().view}; canvas.setPointerCapture?.(event.pointerId);});
    listen(canvas,'pointermove',event=>{if(!dragging||!renderer)return;
      renderer.setView({yaw:dragging.view.yaw+(event.clientX-dragging.x)/200,pitch:dragging.view.pitch+(event.clientY-dragging.y)/200}); cameraFromRenderer();});
    for (const event of ['pointerup','pointercancel','lostpointercapture']) listen(canvas,event,()=>{dragging=null;});
    listen(canvas,'keydown',event=>{if(!renderer||planar||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault(); const view=renderer.getState().view;
      renderer.setView({yaw:view.yaw+(event.key==='ArrowRight'?0.05:event.key==='ArrowLeft'?-0.05:0),pitch:view.pitch+(event.key==='ArrowDown'?0.05:event.key==='ArrowUp'?-0.05:0)});cameraFromRenderer();});
    function update(input) {
      if (disposed) return;
      if (!input || input.confirmed !== true) { renderer?.destroy(); renderer=null;current=null;stage.hidden=true;equation.textContent='';status.textContent='等待学生确认数学场景。'; return; }
      try {
        const scene=particles.sampleScene(input.template,input.snapshot);
        if (!current || current.template!==input.template) { renderer?.destroy(); renderer=null;
          renderer=particles.createRenderer({canvas,template:input.template,snapshot:scene.snapshot,
            reducedMotion:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
            onFallback:()=>{ displayMode(); status.textContent='空间视图不可用，已立即恢复同一数学条件的二维实线图。'; }}); cameraFromRenderer();
        } else renderer.update(scene.snapshot);
        current={template:input.template,snapshot:scene.snapshot}; draw2D(scene); equation.textContent=formula(input.template,scene.snapshot);
        stage.hidden=false;displayMode();status.textContent=`${input.origin==='exploration'?'参数探索':'已确认条件'}；确定性实线图像。${input.template==='cuboid'?'长方体使用明确三维坐标。':'二维函数或几何位于z=0平面，空间视角只改变观察方向。'}${renderer.getState().mode!=='webgl'?'当前使用二维实线回退。':''}`;
      } catch (error) { renderer?.destroy();renderer=null;current=null;stage.hidden=true;status.textContent=`场景未通过数学校验：${error.message}`; }
    }
    return { update, getState:()=>current && {...current,view:renderer?.getState(),planar},destroy(){disposed=true;renderer?.destroy();listeners.forEach(([el,event,fn])=>el.removeEventListener(event,fn));container.replaceChildren();} };
  }
  return { mount, formula };
});
