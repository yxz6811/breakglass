(function () {
  'use strict';

  var brandIntro = document.querySelector('.brand-intro');
  var playground = document.querySelector('#p5');
  if (!brandIntro || !playground) return;
  // Brand playback is isolated from the article's permanent content.
  var body = brandIntro;
  function find(selector) { return brandIntro.querySelector(selector); }
  var story = find('.story');
  var scene = find('.frame-scene');
  var leftPane = find('.frame-left');
  var rightPane = find('.frame-right');
  var field = find('.possibility-field');
  var frozen = find('.frozen-curve');
  var curve = find('.living-curve');
  var guide = find('.vertex-guide');
  var node = find('.model-node');
  var ring = find('.node-ring');
  var flash = find('.opening-light');
  var aValue = find('.a-value');
  var formula = find('.formula');
  var caption = find('.story-caption');
  var identity = find('.identity');
  var symbol = find('.brand-symbol');
  var logoLeft = symbol.querySelector('.aperture-left');
  var logoRightTop = symbol.querySelector('.aperture-right-top');
  var logoRightBottom = symbol.querySelector('.aperture-right-bottom');
  var logoBefore = symbol.querySelector('.curve-before');
  var logoAfter = symbol.querySelector('.curve-after');
  var fractureSweep = symbol.querySelector('.fracture-sweep');
  var logoNode = symbol.querySelector('.control-node');
  var wordmark = find('.wordmark-window');
  var coefficient = playground.querySelector('#coefficient');
  var coefficientValue = playground.querySelector('#coefficient-value');
  var smallCurve = playground.querySelector('.small-curve');
  var smallReference = playground.querySelector('.small-reference');
  var smallNode = playground.querySelector('.small-node');
  var watchCurve = playground.querySelector('.watch-curve');
  var replay = find('.replay');
  var playback = find('.playback');
  var playbackText = playback.querySelector('span');
  var pauseIcon = find('.pause-icon');
  var playIcon = find('.play-icon');
  var speed = find('#speed');
  var cutSelect = find('#cut');
  var timeline = find('.timeline');
  var timeDisplay = find('.time-display');
  var chapters = Array.from(brandIntro.querySelectorAll('[data-chapter]'));
  var motionNote = find('.motion-note');
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var events = new AbortController();
  var cuts = {
    logo: { duration: 2200, from: 4050 },
    story: { duration: 5600, from: 0 },
    entrance: { duration: 2400, from: 1200 },
    signature: { duration: 1200, from: 3600 }
  };
  var chapterTime = { watch: 520, open: 1520, explore: 2640, complete: 5600 };
  var cut = cuts.logo;
  var current = cut.duration;
  var rate = 1;
  var frame = 0;
  var lastFrame = 0;
  var running = false;
  var disposed = false;
  var target = { x: 240, y: 118 };
  var lastCaption = '';
  var lastPhase = '';

  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function progress(time, start, length) { return clamp((time - start) / length, 0, 1); }
  function out(value) { return 1 - Math.pow(1 - value, 4); }
  function smooth(value) { return value * value * (3 - 2 * value); }
  function opacity(element, value) { element.style.opacity = value.toFixed(4); }
  function drawPath(element, value) {
    element.style.strokeDasharray = '1';
    element.style.strokeDashoffset = String(1 - value);
    // Round caps otherwise leave a dot at the start of an unrevealed curve.
    opacity(element, value > 0 ? 1 : 0);
  }
  function phaseAt(time) { return time < 950 ? 'watch' : time < 1800 ? 'open' : time < 3600 ? 'explore' : 'complete'; }

  // 曲线和读数来自同一数学函数；叙事示意不调用识别服务。
  function parabola(a, centerX, baseline, unitX, unitY, extent) {
    var points = [];
    for (var i = 0; i <= 80; i += 1) {
      var x = -extent + 2 * extent * i / 80;
      points.push((i ? 'L' : 'M') + (centerX + x * unitX).toFixed(2) + ' ' + (baseline - a * x * x * unitY).toFixed(2));
    }
    return points.join('');
  }

  frozen.setAttribute('d', parabola(.65, 480, 270, 80, 32, 3));
  var referencePath = parabola(.65, 240, 228, 68, 60, 3);
  smallReference.setAttribute('d', referencePath);
  if (watchCurve) watchCurve.setAttribute('d', referencePath);
  for (var j = 0; j < 17; j += 1) {
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', parabola(.13 + j * .065, 480, 270, 110, 33, 4));
    line.setAttribute('stroke', '#71ddff');
    line.setAttribute('stroke-width', '.65');
    line.setAttribute('opacity', String(.08 + (j % 3) * .025));
    field.appendChild(line);
  }

  function renderSmallGraph(value) {
    var a = clamp(Number(value) || .65, .25, 1.4);
    smallCurve.setAttribute('d', parabola(a, 240, 228, 68, 60, 3));
    smallNode.setAttribute('cx', '342');
    smallNode.setAttribute('cy', (228 - a * 1.5 * 1.5 * 60).toFixed(2));
    coefficientValue.textContent = a.toFixed(2);
    coefficient.setAttribute('aria-valuetext', 'a 等于 ' + a.toFixed(2));
    playground.dataset.coefficient = a.toFixed(2);
  }

  function measureTarget() {
    var matrix = story.getScreenCTM();
    if (!matrix) return;
    var bounds = symbol.getBoundingClientRect();
    target = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(matrix.inverse());
  }

  function storyTime(time) { return cut.from + time / cut.duration * (5600 - cut.from); }
  function localTime(time) { return clamp((time - cut.from) / (5600 - cut.from) * cut.duration, 0, cut.duration); }

  function renderLogo(time) {
    drawPath(logoLeft, out(progress(time, 4050, 330)));
    drawPath(logoRightTop, out(progress(time, 4140, 260)));
    drawPath(logoRightBottom, out(progress(time, 4260, 150)));
    drawPath(logoBefore, smooth(progress(time, 4300, 320)));
    drawPath(fractureSweep, smooth(progress(time, 4540, 150)));
    drawPath(logoAfter, smooth(progress(time, 4670, 410)));

    // Follow the first Bezier segment and finish at the asset's control node.
    var u = out(progress(time, 4730, 400));
    var v = 1 - u;
    var x = v * v * v * 118 + 3 * v * v * u * 128 + 3 * v * u * u * 136 + u * u * u * 148;
    var y = v * v * v * 113 + 3 * v * v * u * 137 + 3 * v * u * u * 146 + u * u * u * 146;
    logoNode.setAttribute('cx', x.toFixed(3));
    logoNode.setAttribute('cy', y.toFixed(3));
    opacity(logoNode, out(progress(time, 4730, 90)));
  }

  function render(time) {
    current = clamp(time, 0, cut.duration);
    var t = storyTime(current);
    var logoCut = cut === cuts.logo;
    var opening = out(progress(t, 950, 850));
    var exploration = progress(t, 1800, 1500);
    var compress = smooth(progress(t, 3350, 1050));
    var fadeScene = 1 - smooth(progress(t, 3880, 540));
    var markReveal = out(progress(t, 4050, 90));
    var wordReveal = out(progress(t, 4800, 700));
    var a = .65;
    if (exploration < .35) a += .6 * smooth(exploration / .35);
    else if (exploration < .72) a = 1.25 - .92 * smooth((exploration - .35) / .37);
    else a = .33 + .32 * smooth((exploration - .72) / .28);

    var nodeX = 584;
    var nodeY = 270 - a * 1.3 * 1.3 * 32;
    var scale = 1 - compress * .8;
    var tx = (target.x - 480) * compress;
    var ty = (target.y - 188) * compress;
    scene.setAttribute('transform', 'translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') translate(480 188) scale(' + scale.toFixed(4) + ') translate(-480 -188)');
    leftPane.setAttribute('transform', 'translate(' + (-opening * 55).toFixed(2) + ' ' + (-opening * 9).toFixed(2) + ') rotate(' + (-opening * 4).toFixed(2) + ' 202 188)');
    rightPane.setAttribute('transform', 'translate(' + (opening * 55).toFixed(2) + ' ' + (opening * 9).toFixed(2) + ') rotate(' + (opening * 4).toFixed(2) + ' 758 188)');
    opacity(story, logoCut ? 0 : fadeScene * (.45 + .55 * out(progress(t, 0, 460))));
    opacity(leftPane, 1 - opening * .62);
    opacity(rightPane, 1 - opening * .62);
    opacity(field, opening * .85 * (1 - smooth(progress(t, 3100, 680))));
    curve.setAttribute('d', parabola(a, 480, 270, 80, 32, 3));
    curve.style.strokeDasharray = '1';
    curve.style.strokeDashoffset = String(1 - out(progress(t, 1060, 660)));
    opacity(curve, opening);
    opacity(frozen, 1 - opening * .78);
    [node, ring].forEach(function (element) {
      element.setAttribute('cx', String(nodeX));
      element.setAttribute('cy', nodeY.toFixed(2));
      opacity(element, opening);
    });
    guide.setAttribute('d', 'M480 270H' + nodeX + 'V' + nodeY.toFixed(2));
    opacity(guide, opening * .26);
    opacity(flash, Math.sin(progress(t, 940, 600) * Math.PI) * .75);
    aValue.textContent = 'a = ' + a.toFixed(2);
    opacity(aValue, opening);
    opacity(formula, .45 + opening * .55);

    opacity(symbol, markReveal);
    symbol.style.transform = 'scale(' + (.93 + .07 * markReveal).toFixed(4) + ')';
    renderLogo(t);
    opacity(wordmark, wordReveal);
    wordmark.style.clipPath = 'inset(0 ' + ((1 - wordReveal) * 100).toFixed(2) + '% 0 0)';
    wordmark.style.transform = 'translateX(' + ((1 - wordReveal) * -14).toFixed(2) + 'px)';
    identity.setAttribute('aria-hidden', String(t < 4420));
    opacity(caption, logoCut ? 0 : (1 - smooth(progress(t, 3340, 360))) * out(progress(t, 0, 450)));
    caption.setAttribute('aria-hidden', String(logoCut || t >= 3700));
    var captionText = t < 950 ? '画面停住。知识，不必停住。' : t < 1800 ? '打开画面的边界。' : '动一个参数，亲手验证一种可能。';
    if (captionText !== lastCaption) { caption.textContent = captionText; lastCaption = captionText; }
    var phase = phaseAt(t);
    if (phase !== lastPhase) {
      chapters.forEach(function (button) {
        if (button.dataset.chapter === phase) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      lastPhase = phase;
    }
    timeline.value = String(Math.round(current));
    timeline.setAttribute('aria-valuetext', (current / 1000).toFixed(2) + ' 秒，共 ' + (cut.duration / 1000).toFixed(2) + ' 秒');
    timeDisplay.firstChild.nodeValue = (current / 1000).toFixed(2) + ' ';
    timeDisplay.querySelector('span').textContent = '/ ' + (cut.duration / 1000).toFixed(2) + 's';
    body.dataset.phase = phase;
    body.dataset.time = String(Math.round(current));
    body.dataset.storyTime = String(Math.round(t));
  }

  function syncPlayback() {
    var label = running ? '暂停' : current >= cut.duration ? '播放' : '继续';
    playbackText.textContent = label;
    playback.setAttribute('aria-label', label + '品牌动画');
    pauseIcon.toggleAttribute('hidden', !running);
    playIcon.toggleAttribute('hidden', running);
    body.dataset.playback = running ? 'playing' : current >= cut.duration ? 'complete' : 'paused';
  }
  function pause() { running = false; window.cancelAnimationFrame(frame); frame = 0; syncPlayback(); }
  function tick(now) {
    if (!running || disposed) return;
    render(current + Math.max(0, now - lastFrame) * rate);
    lastFrame = now;
    if (current >= cut.duration) { pause(); return; }
    frame = window.requestAnimationFrame(tick);
  }
  function play(restart) {
    pause();
    if (motion.matches || disposed) { render(cut.duration); return; }
    measureTarget();
    if (restart || current >= cut.duration) render(0);
    running = true;
    lastFrame = performance.now();
    syncPlayback();
    frame = window.requestAnimationFrame(tick);
  }
  function applyMotionPreference() {
    var reduced = motion.matches;
    [replay, playback, speed, timeline].forEach(function (element) { element.disabled = reduced; });
    chapters.forEach(function (element) { element.disabled = reduced || chapterTime[element.dataset.chapter] < cut.from; });
    motionNote.hidden = !reduced;
    body.dataset.reducedMotion = String(reduced);
    if (reduced) { pause(); render(cut.duration); syncPlayback(); }
  }

  replay.addEventListener('click', function () { play(true); }, { signal: events.signal });
  playback.addEventListener('click', function () { if (running) pause(); else play(false); }, { signal: events.signal });
  timeline.addEventListener('input', function () { pause(); render(Number(timeline.value)); syncPlayback(); }, { signal: events.signal });
  speed.addEventListener('change', function () { rate = Number(speed.value) === .5 ? .5 : 1; }, { signal: events.signal });
  chapters.forEach(function (button) {
    button.addEventListener('click', function () { pause(); render(localTime(chapterTime[button.dataset.chapter])); syncPlayback(); }, { signal: events.signal });
  });
  cutSelect.addEventListener('change', function () {
    pause();
    cut = cuts[cutSelect.value] || cuts.logo;
    timeline.max = String(cut.duration);
    body.dataset.cut = cutSelect.value;
    applyMotionPreference();
    if (motion.matches) { render(cut.duration); syncPlayback(); } else play(true);
  }, { signal: events.signal });
  coefficient.addEventListener('input', function () { renderSmallGraph(coefficient.value); }, { signal: events.signal });
  playground.querySelector('.curve-reset').addEventListener('click', function () {
    coefficient.value = '.65';
    renderSmallGraph(coefficient.value);
  }, { signal: events.signal });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); }, { signal: events.signal });
  var visibility = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting && running) {
      pause();
      render(cut.duration);
      syncPlayback();
    }
  }) : null;
  if (visibility) visibility.observe(brandIntro);
  window.addEventListener('resize', function () { measureTarget(); render(current); }, { signal: events.signal });
  motion.addEventListener('change', applyMotionPreference, { signal: events.signal });
  window.addEventListener('pagehide', function (event) {
    pause();
    if (event.persisted) return;
    disposed = true;
    if (visibility) visibility.disconnect();
    events.abort();
  }, { signal: events.signal });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { measureTarget(); render(current); syncPlayback(); }
  }, { signal: events.signal });
  body.dataset.cut = 'logo';
  renderSmallGraph(coefficient.value);
  measureTarget();
  applyMotionPreference();
  if (!motion.matches) play(true);
})();
