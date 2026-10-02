/* 介绍页交互：顶栏滚动状态、滚动入场、内嵌演示的降级提示。零依赖、渐进增强。 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 新打开时从页首开始，不恢复上次滚动位置 */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* 顶栏：滚动后加深投影，暗示页面已滚动 */
  var topbar = document.querySelector('[data-topbar]');
  function syncTopbar() {
    if (topbar) topbar.dataset.scrolled = window.scrollY > 24 ? 'true' : 'false';
  }
  window.addEventListener('scroll', syncTopbar, { passive: true });
  syncTopbar();

  /* 入场：滚动到位才淡入；减少动效偏好或没有 IntersectionObserver 时直接显示 */
  var targets = Array.prototype.slice.call(
    document.querySelectorAll('.section, .card, .kpi, .step, .stage, .source-note')
  );
  targets.forEach(function (node) { node.classList.add('reveal'); });
  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.forEach(function (node) { node.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
    targets.forEach(function (node) { observer.observe(node); });
  }

  /* 内嵌演示：file:// 或演示页不可用时，给出可操作说明而不是空白 */
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