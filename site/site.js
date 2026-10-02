/* 站点共享交互：背景接管策略、顶栏状态、滚轮翻页弹性渐显、演示降级。零依赖、渐进增强。 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* 背景：能用 WebGL 就交给 three.js 模块（background.js），否则用 canvas 2D 版本兜底。
     一个 canvas 只能有一种上下文，所以必须先判断、不能先建 2D。 */
  var canvas = document.querySelector('[data-ascii-ripple]');
  function webglAvailable() {
    try {
      var probe = document.createElement('canvas');
      return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch (error) {
      return false;
    }
  }
  function startCanvas2D() {
    if (!canvas || canvas.dataset.renderer || !window.BreakGlassAsciiRipple) return;
    canvas.dataset.renderer = 'canvas2d';
    window.breakglassRipple = window.BreakGlassAsciiRipple.create({ canvas: canvas });
  }
  if (canvas) {
    if (webglAvailable()) {
      window.setTimeout(function () { if (!canvas.dataset.renderer) startCanvas2D(); }, 1500);
    } else {
      startCanvas2D();
    }
  }

  /* 顶栏：滚动后加深投影 */
  var topbar = document.querySelector('[data-topbar]');
  function syncTopbar() {
    if (topbar) topbar.dataset.scrolled = window.scrollY > 24 ? 'true' : 'false';
  }
  window.addEventListener('scroll', syncTopbar, { passive: true });
  syncTopbar();

  /* 首屏入场：块级元素整体淡入，栅格子元素错峰 */
  var targets = Array.prototype.slice.call(
    document.querySelectorAll('.hero, .section, .mp-section, .stage, .source-note, .module-card')
  );
  var staggers = Array.prototype.slice.call(document.querySelectorAll('.caps, .steps, .changes, .quotes, .modules, .compare'));
  staggers.forEach(function (grid) {
    grid.classList.add('reveal-stagger');
    Array.prototype.forEach.call(grid.children, function (child, index) {
      child.style.transitionDelay = (180 + index * 130) + 'ms';
    });
  });
  targets.forEach(function (node) { node.classList.add('reveal'); });

  var observer = null;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.concat(staggers).forEach(function (node) { node.classList.add('is-visible'); });
  } else {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    targets.concat(staggers).forEach(function (node) { observer.observe(node); });
  }

  /* 翻页入场：用 Web Animations API，保证每次翻页都能看到弹性渐显（不受观察器影响） */
  function playEntry(section) {
    var grids = Array.prototype.slice.call(section.querySelectorAll('.reveal-stagger'));
    var blocks = [section].concat(grids);
    blocks.forEach(function (node) { node.classList.add('is-visible'); });
    if (reduceMotion || !section.animate) return;
    blocks.forEach(function (node) {
      node.animate([
        { opacity: 0, transform: 'translateY(30px)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 1500, easing: 'cubic-bezier(0.3, 0.72, 0.28, 1.02)', fill: 'none' });
    });
    grids.forEach(function (grid) {
      Array.prototype.forEach.call(grid.children, function (child, index) {
        child.animate([
          { opacity: 0, transform: 'translateY(26px)' },
          { opacity: 1, transform: 'none' },
        ], {
          duration: 1300,
          delay: 180 + index * 130,
          easing: 'cubic-bezier(0.3, 0.86, 0.34, 1.02)',
          fill: 'none',
        });
      });
    });
  }

  /* 滚轮翻页：页内先逐段，走到头就翻到下一页（共 6 页，第 1 页为留空封面） */
  var pager = document.querySelector('[data-pager]');
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-page-section]'));
  var nextPage = document.body.getAttribute('data-next-page') || '';
  var prevPage = document.body.getAttribute('data-prev-page') || '';
  var going = false;
  function goToPage(url) {
    if (!url || going) return;
    going = true;
    document.documentElement.style.transition = 'opacity 460ms var(--ease-out)';
    document.documentElement.style.opacity = '0';
    window.setTimeout(function () { window.location.href = url; }, 460);
  }
  window.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
      var list = sections;
      var at = 0;
      for (var i = 0; i < list.length; i += 1) {
        if (Math.abs(list[i].getBoundingClientRect().top - 96) < window.innerHeight * 0.5) at = i;
      }
      if (at >= list.length - 1) { event.preventDefault(); goToPage(nextPage); }
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      if (window.scrollY < 40) { event.preventDefault(); goToPage(prevPage); }
    } else if (event.key === 'Escape') {
      goToPage('../index.html');
    }
  });
  if (pager && sections.length > 0) {
    var locked = false;
    var offset = 96;
    function sectionTop(node) { return node.getBoundingClientRect().top + window.scrollY; }
    function currentIndex() {
      var best = 0;
      var bestDistance = Infinity;
      for (var i = 0; i < sections.length; i += 1) {
        var distance = Math.abs(sectionTop(sections[i]) - window.scrollY - offset);
        if (distance < bestDistance) { bestDistance = distance; best = i; }
      }
      return best;
    }
    function inScrollableArea(node) {
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.tagName === 'IFRAME') return true;
        var style = window.getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 4) return true;
        node = node.parentNode;
      }
      return false;
    }
    window.addEventListener('wheel', function (event) {
      if (event.ctrlKey || event.defaultPrevented) return;
      if (inScrollableArea(event.target)) return;
      var index = currentIndex();
      var rect = sections[index].getBoundingClientRect();
      var tallerThanView = rect.height > window.innerHeight - offset - 24;
      if (tallerThanView) {
        if (event.deltaY > 0 && rect.bottom > window.innerHeight + 32) return;
        if (event.deltaY < 0 && rect.top < -32) return;
      }
      var next = index + (event.deltaY > 0 ? 1 : -1);
      if (next < 0) {
        if (!prevPage) return;
        event.preventDefault();
        if (!locked) { locked = true; goToPage(prevPage); }
        return;
      }
      if (next >= sections.length) {
        if (!nextPage) return;
        event.preventDefault();
        if (!locked) { locked = true; goToPage(nextPage); }
        return;
      }
      event.preventDefault();
      if (locked) return;
      locked = true;
      var destination = sections[next];
      window.scrollTo({ top: sectionTop(destination) - offset, behavior: 'smooth' });
      playEntry(destination);
      window.setTimeout(function () { locked = false; }, 820);
    }, { passive: false });
  }

  /* 内嵌演示：file:// 或演示页不可用时给出可操作说明 */
  var frame = document.querySelector('[data-demo-frame]');
  var fallback = document.querySelector('[data-demo-fallback]');
  function showFallback() {
    if (frame) frame.hidden = true;
    if (fallback) fallback.hidden = false;
  }
  if (frame && fallback) {
    if (location.protocol === 'file:') {
      showFallback();
    } else {
      frame.addEventListener('load', function () {
        var usable = false;
        try {
          usable = Boolean(frame.contentDocument && frame.contentDocument.querySelector('#demo-video'));
        } catch (error) {
          usable = false;
        }
        if (!usable) showFallback();
      });
    }
  }
})();