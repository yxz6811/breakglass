/* Source: github.com/yxz6811/breakglass, yanghan2026-patch-1, e46bed00291c262effa7982dc3f67f2701f36191, root file 展示网站.
   Frontend constraints: ../docs/BreakGlass-constitution.md (1.6.0); P0 preset parabola only. This extraction preserves original showcase content and does not implement or validate its P1 claims. */
/* =========================================================
   2. 分页入场动画
   ========================================================= */
(function () {
  const pages = Array.from(document.querySelectorAll('.page'));

  if (!('IntersectionObserver' in window)) {
    pages.forEach(p => p.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.intersectionRatio > 0.35) {
        e.target.classList.add('in');
      } else if (!e.isIntersecting) {
        e.target.classList.remove('in');
      }
    });
  }, { threshold: [0, 0.35, 0.6, 0.9] });

  pages.forEach(p => io.observe(p));
})();


/* =========================================================
   3. 分页指示器 / 顶部进度条
   ========================================================= */
(function () {
  const pages    = Array.from(document.querySelectorAll('.page'));
  const links    = Array.from(document.querySelectorAll('.pager a'));
  const progress = document.getElementById('progress');

  let ticking = false;

  function update() {
    const vh = window.innerHeight;

    let best = 0, bestRatio = -1;
    for (let i = 0; i < pages.length; i++) {
      const r = pages[i].getBoundingClientRect();
      const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      const ratio = visible / Math.min(r.height, vh);
      if (ratio > bestRatio) { bestRatio = ratio; best = i; }
    }
    for (let i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', i === best);
    }

    const doc = document.documentElement;
    const max = doc.scrollHeight - vh;
    const prog = max > 0 ? Math.min(doc.scrollTop / max, 1) : 0;
    progress.style.transform = 'scaleX(' + prog + ')';


  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () { update(); ticking = false; });
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('load', update);

  update();
})();


/* =========================================================
   6. Page 6 · 系统技术架构 —— 点击卡片放大展开
   ========================================================= */
(function () {
  'use strict';

  var modal   = document.getElementById('archModal');
  var card    = document.getElementById('archCard');
  var visual  = document.getElementById('archVisual');
  var eyebrow = document.getElementById('archEyebrow');
  var titleEl = document.getElementById('archTitle');
  var descEl  = document.getElementById('archDesc');
  if (!modal) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lastSource = null;
  var pendingFocus = null;
  var animating = false;
  var closing = false;
  var animationTimer = 0;
  var backgroundState = [];

  var DATA = {
    '1': {
      tplId: 'tpl-arch-1',
      eyebrow: 'LAYER 01 · USER TRIGGER',
      title: '用户触发 · 一键唤醒',
      desc:  '在任意 HTML5 视频页面上，通过<em>浏览器扩展图标</em>或自定义快捷键（⌘ ⇧ B）即可启动。触发动作发生在播放器一侧，不离开当前页面、不打断观看节奏，让「动手改一改」的冲动能被立刻接住。'
    },
    '2': {
      tplId: 'tpl-arch-2',
      eyebrow: 'LAYER 02 · GEOMETRY PROBE',
      title: '内容几何探测层 · 截取当前画面',
      desc:  '获取视频 DOM 并让视频保持在底层，通过 Canvas 的 <em>drawImage()</em> 抓取当前帧画面，得到一份可供分析的像素数据。这一步只读取、不修改——无论视频来自 B 站、网课平台还是本地文件，处理方式完全一致。'
    },
    '3': {
      tplId: 'tpl-arch-3',
      eyebrow: 'LAYER 03 · MULTIMODAL PERCEPTION',
      title: '多模态感知层 · 结构化识别',
      desc:  '把截取的帧图像送入多模态 AI 接口，识别出画面中的<em>代码块与函数图像</em>，返回类型、bounding box 坐标与置信度等结构化数据。AI 只负责「看到什么、在哪里」，不生成任何可执行内容——从根源上避免幻觉。'
    },
    '4': {
      tplId: 'tpl-arch-4',
      eyebrow: 'LAYER 04 · IN-SITU OVERLAY',
      title: '原位图层挂载层 · 透明悬浮层',
      desc:  '向视频父容器注入一层高 z-index 的<em>透明悬浮交互层</em>，覆盖在被识别的区域上。不跳转、不拆分、不遮挡，只在这些区域叠加输入框与拖拽手柄，并播放一段微弱的玻璃填充动画，暗示「这块被激活了」。'
    },
    '5': {
      tplId: 'tpl-arch-5',
      eyebrow: 'LAYER 05 · DUAL-BRANCH ROUTING',
      title: '双分支业务分流 · 各走各的路',
      desc:  '识别结果沿两条路径分流：<em>代码分支</em>交给 CodeMirror 编辑器与 Pyodide WASM，可编辑、可运行；<em>函数图像分支</em>交给 SVG 画布，可拖动参数、实时重绘。两条路径完全解耦、各自独立，全程在端侧执行。'
    }
  };

  function setContent(key) {
    var d = DATA[key];
    if (!d) return false;

    var tpl = document.getElementById(d.tplId);
    visual.innerHTML = '';
    if (tpl && tpl.content) {
      visual.appendChild(tpl.content.cloneNode(true));
    }
    eyebrow.textContent = d.eyebrow;
    titleEl.textContent = d.title;
    descEl.innerHTML = d.desc;

    var info = modal.querySelector('.arch-modal__info');
    if (info) info.scrollTop = 0;
    return true;
  }

  function open(sourceEl, key) {
    if (animating) return;
    if (!setContent(key)) return;
    animating = true;

    var srcRect = sourceEl.getBoundingClientRect();

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('detail-open');
    lastSource = sourceEl;
    backgroundState = Array.from(document.querySelectorAll('body > nav, body > main, #lineSidebar, .pager')).map(function (element) {
      var state = { element: element, inert: element.inert };
      element.inert = true;
      return state;
    });
    modal.querySelector('.arch-modal__close').focus({ preventScroll: true });

    /* 先把卡片重置到最终位置，量出完整尺寸 */
    card.style.transition = 'none';
    card.style.transform = 'none';
    card.style.opacity = '1';
    void card.offsetWidth;

    var cardRect = card.getBoundingClientRect();
    var dx = srcRect.left - cardRect.left;
    var dy = srcRect.top - cardRect.top;
    var sx = cardRect.width  ? srcRect.width  / cardRect.width  : 0.5;
    var sy = cardRect.height ? srcRect.height / cardRect.height : 0.5;

    /* FLIP：把卡片缩回原位置 */
    card.style.transformOrigin = '0 0';
    card.style.transform =
      'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sx + ',' + sy + ')';
    card.style.opacity = reduceMotion ? '1' : '0.3';

    void card.offsetWidth;

    /* 播放到最终状态 */
    var dur = reduceMotion ? 1 : 300;
    card.style.transition =
      'transform ' + dur + 'ms cubic-bezier(.22,.7,.3,1),' +
      'opacity ' + (reduceMotion ? 1 : 340) + 'ms cubic-bezier(.22,.7,.3,1)';
    card.style.transform = 'translate3d(0,0,0) scale(1,1)';
    card.style.opacity = '1';

    lastSource = sourceEl;

    animationTimer = setTimeout(function () {
      animating = false;
    }, dur + 30);
  }

  function close() {
    if (closing || !lastSource) return;
    closing = true;
    clearTimeout(animationTimer);
    animating = true;

    var srcRect = lastSource.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    var dx = srcRect.left - cardRect.left;
    var dy = srcRect.top - cardRect.top;
    var sx = cardRect.width  ? srcRect.width  / cardRect.width  : 0.5;
    var sy = cardRect.height ? srcRect.height / cardRect.height : 0.5;

    var dur = reduceMotion ? 1 : 240;
    card.style.transition =
      'transform ' + dur + 'ms cubic-bezier(.4,0,.55,1),' +
      'opacity ' + (reduceMotion ? 1 : 320) + 'ms cubic-bezier(.4,0,.55,1)';
    card.style.transformOrigin = '0 0';
    card.style.transform =
      'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sx + ',' + sy + ')';
    card.style.opacity = reduceMotion ? '0' : '0.18';

    pendingFocus = lastSource;

    animationTimer = setTimeout(function () {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('detail-open');

      card.style.transition = 'none';
      card.style.transform = '';
      card.style.opacity = '';

      lastSource = null;
      animating = false;
      closing = false;
      backgroundState.forEach(function (state) { state.element.inert = state.inert; });
      backgroundState = [];

      if (pendingFocus) {
        try { pendingFocus.focus({ preventScroll: true }); } catch (e) {}
        pendingFocus = null;
      }
    }, dur + 30);
  }

  /* 绑定：只对 Page 6 的卡片生效 */
  Array.prototype.forEach.call(
    document.querySelectorAll('.step[data-arch]'),
    function (el) {
      var key = el.getAttribute('data-arch');

      /* 点击 → 直接展开 */
      el.addEventListener('click', function (e) {
        e.preventDefault();
        open(el, key);
      });

      /* 键盘：回车 / 空格 */
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          open(el, key);
        }
      });
    }
  );

  /* 关闭：✕ / 点击背景 / Esc */
  Array.prototype.forEach.call(
    modal.querySelectorAll('[data-arch-close]'),
    function (el) { el.addEventListener('click', close); }
  );

  document.addEventListener('keydown', function (e) {
    if (!modal.classList.contains('is-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      var focusable = Array.from(modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (element) { return !element.disabled && element.getClientRects().length; });
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (!modal.contains(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
  });
})();


/* =========================================================
   7. LineSidebar · 左侧竖向线条导航
   ========================================================= */
(function () {
  'use strict';

  var CFG = {
    accentColor: '#71ddff',
    textColor:   '#c4c4c4',
    markerColor: '#6c6c6c',
    showIndex:   true,
    showMarker:  true,
    proximityRadius: 100,
    maxShift:    30,
    falloff:     'smooth',
    markerLength: 60,
    markerGap:   0,
    tickScale:   0.5,
    scaleTick:   true,
    itemGap:     20,
    fontSize:    1.1,
    smoothing:   100,
    defaultActive: 0,
    onItemClick: function () {}
  };

  var host = document.getElementById('lineSidebar');
  if (!host) return;

  var src = [].slice.call(document.querySelectorAll('.pager a'));
  if (!src.length) return;

  host.style.setProperty('--ls-gap', CFG.itemGap + 'px');
  host.style.setProperty('--ls-font', CFG.fontSize + 'rem');
  host.style.setProperty('--ls-accent', CFG.accentColor);
  host.style.setProperty('--ls-text', CFG.textColor);
  host.style.setProperty('--ls-marker', CFG.markerColor);
  host.style.setProperty('--ls-marker-len', CFG.markerLength + 'px');

  var rail = document.createElement('span');
  rail.className = 'ls-rail';
  host.appendChild(rail);

  var marker = null;
  if (CFG.showMarker) {
    marker = document.createElement('span');
    marker.className = 'ls-marker';
    marker.style.left = (-1 - CFG.markerGap) + 'px';
    host.appendChild(marker);
  }

  var entries = src.map(function (a, i) {
    var el = document.createElement('a');
    el.className = 'ls-item';
    el.style.setProperty('--chapter-delay', (i * 45) + 'ms');
    el.href = a.getAttribute('href') || ('#p' + (i + 1));
    var text = a.getAttribute('data-label') || ('Section ' + (i + 1));
    el.setAttribute('aria-label', ((i + 1 < 10 ? '0' : '') + (i + 1)) + ' ' + text);

    var tick = document.createElement('span');
    tick.className = 'ls-tick';
    el.appendChild(tick);

    if (CFG.showIndex) {
      var idx = document.createElement('span');
      idx.className = 'ls-idx';
      idx.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
      el.appendChild(idx);
    }

    var label = document.createElement('span');
    label.className = 'ls-label';
    label.textContent = text;
    el.appendChild(label);

    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      var target = document.querySelector(el.getAttribute('href'));
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 72, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      CFG.onItemClick(i, text);
    });

    if (!CFG.showMarker) el.style.paddingLeft = '22px';
    host.appendChild(el);

    return { el: el, tick: tick, href: el.getAttribute('href'),
             shift: 0, scale: CFG.tickScale, hot: null, peak: null, cy: 0, cx: 0 };
  });

  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
                    Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
                    Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }
  var C_TEXT = hex2rgb(CFG.textColor);
  var C_ACCENT = hex2rgb(CFG.accentColor);
  var C_MARKER = hex2rgb(CFG.markerColor);

  function measure() {
    var hr = host.getBoundingClientRect();
    entries.forEach(function (en) {
      en.cy = en.el.offsetTop + en.el.offsetHeight / 2;
      en.cx = en.el.offsetLeft + en.el.offsetWidth / 2;
      en.vx = hr.left + en.cx;
      en.vy = hr.top + en.cy;
    });
  }

  function strength(d) {
    var t = 1 - d / CFG.proximityRadius;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (CFG.falloff === 'smooth') return t * t * (3 - 2 * t);
    if (CFG.falloff === 'linear') return t;
    return t * t;
  }

  var motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  var hoverPreference = window.matchMedia('(hover: none)');
  var mediaEvents = window.BreakGlassMotion.createListeners();
  var reduced = motionPreference.matches;
  var noHover = hoverPreference.matches;
  var mouse = { x: -1e5, y: -1e5, on: false };
  var active = CFG.defaultActive;
  var markerY = 0, markerReady = false;
  var frameId = 0, suspended = false, needsMeasure = true;

  function computeActive() {
    var mid = window.innerHeight * 0.5;
    for (var i = 0; i < entries.length; i++) {
      var el = document.querySelector(entries[i].href);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) return i;
    }
    return active;
  }

  var last = -1, lastScroll = -1;

  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    last = -1;
  }

  function canRender() {
    return !suspended && !document.hidden && host.offsetWidth !== 0;
  }

  function requestUpdate(remeasure) {
    if (remeasure) { needsMeasure = true; lastScroll = -1; }
    if (!canRender()) { stop(); return; }
    if (!frameId) frameId = requestAnimationFrame(frame);
  }

  function frame(now) {
    frameId = 0;
    if (!canRender()) { stop(); return; }
    if (needsMeasure) { measure(); needsMeasure = false; }

    if (last < 0) last = now - 16.7;
    var dt = Math.min(now - last, 64);
    if (!(dt > 0)) dt = 16.7;
    last = now;

    var k = reduced ? 1 : (1 - Math.exp(-dt / CFG.smoothing));

    if (window.scrollY !== lastScroll) {
      lastScroll = window.scrollY;
      active = computeActive();
    }

    var i, en, s, dx, dy;
    var strengths = [];
    var maxS = 0, peak = -1;
    var settling = false;

    for (i = 0; i < entries.length; i++) {
      en = entries[i];
      s = 0;
      if (mouse.on && !reduced && en.vx !== undefined) {
        dx = mouse.x - en.vx; dy = mouse.y - en.vy;
        s = strength(Math.sqrt(dx * dx + dy * dy));
      }
      strengths[i] = s;
      if (s > maxS) { maxS = s; peak = i; }
    }

    for (i = 0; i < entries.length; i++) {
      en = entries[i];
      s = strengths[i];

      var tShift = s * CFG.maxShift;
      var tScale = CFG.scaleTick ? CFG.tickScale + (1 - CFG.tickScale) * s : CFG.tickScale;

      en.shift += (tShift - en.shift) * k;
      en.scale += (tScale - en.scale) * k;
      if (Math.abs(tShift - en.shift) > 0.01 || Math.abs(tScale - en.scale) > 0.001) {
        settling = true;
      } else {
        en.shift = tShift;
        en.scale = tScale;
      }

      en.el.style.transform = 'translateX(' + en.shift.toFixed(2) + 'px)';
      en.tick.style.transform = 'translateY(-50%) scaleX(' + en.scale.toFixed(3) + ')';
      en.tick.style.opacity = (0.5 + 0.5 * s).toFixed(3);
      en.el.style.color = mix(C_TEXT, C_ACCENT, Math.max(s, i === active ? 1 : 0));

      var hot = (s > 0.35) || (i === active);
      var isPeak = (i === peak && maxS > 0.08);
      if (hot !== en.hot || isPeak !== en.peak) {
        en.hot = hot;
        en.peak = isPeak;
        en.el.classList.toggle('is-hot', hot);
        en.el.classList.toggle('is-peak', isPeak);
      }
      en.el.classList.toggle('is-active', i === active);
      if (i === active) en.el.setAttribute('aria-current', 'location');
      else en.el.removeAttribute('aria-current');
    }

    if (marker) {
      var tY = entries[active].cy - CFG.markerLength / 2;
      if (!markerReady) { markerY = tY; markerReady = true; }
      markerY += (tY - markerY) * k;
      if (Math.abs(tY - markerY) > 0.02) settling = true;
      else markerY = tY;
      marker.style.transform = 'translateY(' + markerY.toFixed(2) + 'px)';
      marker.style.background = mix(C_MARKER, C_ACCENT, maxS);
    }
    // Continue only while proximity or the active marker is still settling.
    if (settling) frameId = requestAnimationFrame(frame);
    else last = -1;
  }

  function clearMouse() {
    mouse.on = false;
    requestUpdate(false);
  }

  window.addEventListener('mousemove', function (e) {
    if (noHover || reduced) return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true;
    requestUpdate(false);
  }, { passive: true });
  window.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget) clearMouse();
  });
  document.addEventListener('mouseleave', clearMouse);
  host.addEventListener('animationend', function (event) {
    if (event.animationName.indexOf('nav-chapter-arrive') === 0 && event.target.classList.contains('ls-item')) requestUpdate(true);
  });

  function boot() { requestUpdate(true); }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });

  window.addEventListener('scroll', function () { requestUpdate(false); }, { passive: true });
  window.addEventListener('resize', function () { requestUpdate(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { mouse.on = false; stop(); }
    else requestUpdate(true);
  });
  window.addEventListener('pagehide', function (event) {
    suspended = true; stop();
    if (!event.persisted) mediaEvents.abort();
  });
  window.addEventListener('pageshow', function () { suspended = false; requestUpdate(true); });
  mediaEvents.listen(motionPreference, 'change', function (event) {
    reduced = event.matches;
    mouse.on = false;
    requestUpdate(true);
  });
  mediaEvents.listen(hoverPreference, 'change', function (event) {
    noHover = event.matches;
    clearMouse();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestUpdate(true); });
})();
