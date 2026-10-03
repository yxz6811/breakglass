/* Archive demo-live choreography, adapted to the P0 preset parabola.
   docs/BreakGlass-constitution.md: no vision or WASM execution is implied. */
(function () {
  'use strict';
  var section = document.querySelector('#p5');
  if (!section) return;
  var chart = section.querySelector('.hands-on-chart');
  var livePanel = section.querySelector('.live-panel');
  var slider = section.querySelector('#coefficient');
  var toggle = section.querySelector('.demo-autoplay');
  var status = section.querySelector('.demo-motion-status');
  var reset = section.querySelector('.curve-reset');
  if (!chart || !slider || !toggle || !status || !reset) return;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var events = window.BreakGlassMotion.createListeners();
  var duration = 6000;
  var elapsed = 0, last = 0, painted = 0, frame = 0;
  var running = false, visible = false, started = false, ownInput = false, disposed = false;
  var state = 'idle';

  function setState(next, message) {
    state = next;
    section.dataset.demoPlayback = next;
    section.classList.toggle('demo-active', running && visible && !document.hidden);
    toggle.setAttribute('aria-pressed', String(running));
    toggle.textContent = running ? '暂停变化' : elapsed > 0 && elapsed < duration ? '继续变化' : '播放变化';
    status.textContent = message;
  }
  function stop(next, message) {
    running = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    setState(next, message);
  }
  function draw(value) {
    // Reuse the existing deterministic drawing/number formatter, with one input owner.
    ownInput = true;
    slider.value = value.toFixed(2);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    ownInput = false;
  }
  function valueAt(t) {
    var stops = [.65, .30, 1.15, .65];
    var position = Math.min(t / duration * 3, 3);
    var i = Math.min(Math.floor(position), 2);
    var u = position - i;
    var eased = u * u * (3 - 2 * u);
    return stops[i] + (stops[i + 1] - stops[i]) * eased;
  }
  function tick(now) {
    if (!running || disposed) return;
    elapsed = Math.min(duration, elapsed + Math.min(now - last, 100));
    last = now;
    if (now - painted >= 33 || elapsed >= duration) { draw(valueAt(elapsed)); painted = now; }
    if (elapsed >= duration) { stop('complete', '自动演示已结束 · 现在由你调节。'); return; }
    frame = window.requestAnimationFrame(tick);
  }
  function play() {
    if (disposed || motion.matches || document.hidden || !visible) return;
    if (elapsed >= duration) elapsed = 0;
    started = true;
    running = true;
    last = performance.now();
    painted = 0;
    setState('playing', '自动演示 · 调参即可接管。');
    frame = window.requestAnimationFrame(tick);
  }
  function manual() {
    if (ownInput) return;
    started = true;
    elapsed = 0;
    stop('manual', '手动控制 · 参数保持你的选择。');
  }
  toggle.hidden = false;
  events.listen(toggle, 'click', function () {
    if (running) stop('paused', '变化已暂停 · 可继续或亲手调节。'); else play();
  });
  events.listen(slider, 'input', manual);
  // Stop before a keyboard/pointer edit; reset never restarts autoplay.
  events.listen(slider, 'pointerdown', manual);
  events.listen(reset, 'click', function () {
    started = true; elapsed = 0;
    stop('manual', '已恢复原曲线 · a = 0.65。');
  });
  function preference() {
    toggle.disabled = motion.matches;
    if (motion.matches) stop('reduced', '已减少动态效果 · 曲线仍可手动调节。');
    else if (state === 'reduced') setState('idle', '拖动参数，亲手验证。');
  }
  var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .05;
    section.dataset.demoVisible = String(visible);
    if (visible) {
      section.classList.add('plot-entered');
      if (!started && !motion.matches) play();
    } else if (running) stop('paused', '变化已暂停 · 回来后可继续。');
  }, { threshold: [0, .05] }) : null;
  if (observer) observer.observe(livePanel || chart);
  else { visible = true; started = true; section.classList.add('plot-entered'); }
  events.listen(document, 'visibilitychange', function () {
    if (document.hidden && running) stop('paused', '变化已暂停 · 可继续或亲手调节。');
  });
  events.listen(motion, 'change', preference);
  events.listen(window, 'pagehide', function (event) {
    stop('paused', '变化已暂停 · 可继续或亲手调节。');
    if (!event.persisted) { disposed = true; if (observer) observer.disconnect(); events.abort(); }
  });
  events.listen(window, 'pageshow', function (event) { if (event.persisted) preference(); });
  preference();
})();
