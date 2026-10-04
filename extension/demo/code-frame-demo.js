(function () {
  'use strict';

  var canvas = document.getElementById('code-frame-canvas');
  var stage = canvas && canvas.closest ? canvas.closest('.code-frame-demo') : null;
  var toggle = document.getElementById('code-frame-toggle');
  var replay = document.getElementById('code-frame-replay');
  var phaseLabel = document.getElementById('code-frame-phase');
  var progressLabel = document.getElementById('code-frame-progress');
  if (!canvas || !stage || !toggle || !replay) return;

  var context = canvas.getContext('2d');
  if (!context) return;

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var duration = 6600;
  var frameHandle = 0;
  var elapsed = 0;
  var lastTime = 0;
  var running = false;
  var visible = true;
  var started = false;
  var disposed = false;
  var currentDpr = 1;
  var TAU = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(value) {
    var t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function easeOutBack(value) {
    var t = clamp(value, 0, 1);
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
    roundedRectPath(ctx, x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.round(rect.width || canvas.clientWidth || 1280));
    var height = Math.max(260, Math.round(width * 560 / 1280));
    currentDpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * currentDpr);
    canvas.height = Math.round(height * currentDpr);
    context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    draw(elapsed / duration);
  }

  function dimensions() {
    var rect = canvas.getBoundingClientRect();
    return {
      width: Math.max(320, rect.width || canvas.clientWidth || 1280),
      height: Math.max(260, rect.height || canvas.clientHeight || 560)
    };
  }

  function drawGrid(ctx, x, y, width, height, opacity) {
    ctx.save();
    ctx.strokeStyle = 'rgba(142, 190, 211, ' + (0.07 * opacity).toFixed(3) + ')';
    ctx.lineWidth = 1;
    for (var gx = x; gx <= x + width; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + height);
      ctx.stroke();
    }
    for (var gy = y; gy <= y + height; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + width, gy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParabola(ctx, box, parameters, color, alpha, width, glow) {
    var left = box.x + box.width * 0.08;
    var right = box.x + box.width * 0.92;
    var baseline = box.y + box.height * 0.72;
    var scaleX = (right - left) / 5;
    var scaleY = box.height * 0.055;
    var top = baseline - box.height * 0.08;
    var points = [];
    for (var i = 0; i <= 72; i += 1) {
      var mathX = -2.5 + (5 * i / 72);
      var mathY = parameters.a * Math.pow(mathX - parameters.h, 2) + parameters.k;
      points.push({
        x: left + (mathX + 2.5) * scaleX,
        y: top + mathY * scaleY
      });
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
    return {
      x: left + (parameters.h + 2.5) * scaleX,
      y: top + parameters.k * scaleY,
      scaleX: scaleX,
      scaleY: scaleY
    };
  }

  function drawParticles(ctx, width, height, progress) {
    ctx.save();
    for (var i = 0; i < 12; i += 1) {
      var seed = i * 1.73;
      var x = (0.08 + ((Math.sin(seed * 2.7) + 1) * 0.42)) * width;
      var y = (0.12 + ((Math.cos(seed * 1.9) + 1) * 0.38)) * height;
      var drift = Math.sin(progress * TAU + seed) * 6;
      var radius = 1.2 + ((i % 3) * 0.7);
      ctx.fillStyle = 'rgba(113, 221, 255, ' + (0.12 + (i % 4) * 0.025).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x + drift, y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChip(ctx, x, y, label, active, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    var width = ctx.measureText(label).width + 28;
    fillRoundRect(ctx, x, y, width, 30, 15, active ? 'rgba(113, 221, 255, .15)' : 'rgba(255, 255, 255, .045)', active ? 'rgba(113, 221, 255, .72)' : 'rgba(255, 255, 255, .16)');
    ctx.fillStyle = active ? '#9cecff' : 'rgba(224, 235, 240, .62)';
    ctx.fillText(label, x + 14, y + 19);
    ctx.restore();
    return width;
  }

  function draw(progress) {
    var size = dimensions();
    var width = size.width;
    var height = size.height;
    var ctx = context;
    var t = clamp(progress, 0, 1);
    var reveal = smoothstep(t / 0.26);
    var morph = smoothstep((t - 0.2) / 0.36);
    var inspect = smoothstep((t - 0.56) / 0.23);
    var settle = smoothstep((t - 0.79) / 0.21);
    var panelY = height * 0.16;
    var panelH = height * 0.62;
    var gutter = Math.max(18, width * 0.03);
    var leftX = width * 0.07;
    var rightX = width * 0.55;
    var panelW = width * 0.38;
    var leftW = width * 0.34;
    var original = { a: 1, h: 0, k: 1 };
    var target = { a: 0.58, h: 0.36, k: 1.14 };
    var current = {
      a: original.a + (target.a - original.a) * morph,
      h: original.h + (target.h - original.h) * morph,
      k: original.k + (target.k - original.k) * morph
    };

    ctx.clearRect(0, 0, width, height);
    var background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#071017');
    background.addColorStop(0.58, '#08131b');
    background.addColorStop(1, '#0b1420');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    drawParticles(ctx, width, height, t);

    ctx.save();
    ctx.fillStyle = 'rgba(113, 221, 255, .06)';
    ctx.beginPath();
    ctx.arc(width * 0.77, height * 0.34, width * 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.font = '700 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(156, 236, 255, .85)';
    ctx.letterSpacing = '2px';
    ctx.fillText('FRAME 06.0 s  /  CODE DRAWN', leftX, height * 0.09);

    ctx.save();
    ctx.globalAlpha = reveal;
    fillRoundRect(ctx, leftX, panelY, leftW, panelH, 16, 'rgba(255, 255, 255, .035)', 'rgba(255, 255, 255, .16)');
    fillRoundRect(ctx, rightX, panelY, panelW, panelH, 16, 'rgba(5, 21, 31, .62)', 'rgba(113, 221, 255, .35)');
    drawGrid(ctx, rightX + 1, panelY + 1, panelW - 2, panelH - 2, 1);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(224, 235, 240, .66)';
    ctx.fillText('原始画面', leftX + 18, panelY + 28);
    ctx.fillStyle = '#9cecff';
    ctx.fillText('可操作图层', rightX + 18, panelY + 28);
    ctx.restore();

    // 左侧的灰线先出现，随后被一条青色曲线“接管”。
    var leftBox = { x: leftX + 10, y: panelY + 34, width: leftW - 20, height: panelH - 46 };
    drawParabola(ctx, leftBox, original, '#a9b8bf', reveal * (1 - morph * 0.68), 4, false);
    var rightBox = { x: rightX + 10, y: panelY + 34, width: panelW - 20, height: panelH - 46 };
    var handle = drawParabola(ctx, rightBox, current, '#71ddff', reveal * (0.45 + morph * 0.55), 4, true);
    if (morph > 0.03) {
      ctx.save();
      ctx.globalAlpha = reveal * morph;
      ctx.strokeStyle = 'rgba(156, 236, 255, .26)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(handle.x, handle.y);
      ctx.lineTo(handle.x, panelY + panelH - 16);
      ctx.stroke();
      ctx.restore();
    }

    // 控制点的弹性落位是形变的视觉重点。
    if (inspect > 0) {
      var pop = easeOutBack(inspect);
      ctx.save();
      ctx.globalAlpha = reveal * inspect;
      ctx.shadowColor = '#71ddff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#eefbff';
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 7 + pop * 2, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#071017';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#d8f7ff';
      ctx.fillText('拖动顶点，验证猜想', handle.x + 16, handle.y - 14);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.strokeStyle = 'rgba(113, 221, 255, .22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftX + leftW + gutter * 0.4, panelY + panelH / 2);
    ctx.lineTo(rightX - gutter * 0.4, panelY + panelH / 2);
    ctx.stroke();
    ctx.fillStyle = '#71ddff';
    ctx.beginPath();
    ctx.arc((leftX + leftW + rightX) / 2, panelY + panelH / 2, 3, 0, TAU);
    ctx.fill();
    ctx.restore();

    var chipY = height * 0.86;
    var chipX = leftX;
    chipX += drawChip(ctx, chipX, chipY, '暂停疑问', reveal > 0.06, reveal) + 10;
    chipX += drawChip(ctx, chipX, chipY, '改变参数', morph > 0.18, reveal) + 10;
    drawChip(ctx, chipX, chipY, '验证理解', settle > 0.1, reveal);

    ctx.save();
    ctx.globalAlpha = settle;
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#9cecff';
    ctx.textAlign = 'right';
    ctx.fillText('一帧画面，变成一次实验。', width - leftX, height * 0.09);
    ctx.restore();

    updateLabels(t, morph, inspect, settle);
  }

  function updateLabels(progress, morph, inspect, settle) {
    var text = '准备逐帧绘制';
    if (progress >= 0.8) text = '验证理解 · 演示完成';
    else if (inspect > 0.1) text = '拖动顶点 · 验证猜想';
    else if (morph > 0.08) text = '改变参数 · 曲线正在形变';
    else if (progress > 0.04) text = '暂停疑问 · 读取当前帧';
    if (phaseLabel) phaseLabel.textContent = text;
    if (progressLabel) progressLabel.textContent = Math.round(progress * 100) + '%';
    stage.dataset.framePhase = text;
  }

  function setButtonState() {
    toggle.setAttribute('aria-pressed', String(running));
    toggle.textContent = running ? '暂停形变' : (elapsed > 0 && elapsed < duration ? '继续形变' : '播放形变');
    replay.disabled = running || Boolean(reducedMotion && reducedMotion.matches);
    if (reducedMotion && reducedMotion.matches) {
      toggle.disabled = true;
      toggle.textContent = '已减少动态效果';
    } else {
      toggle.disabled = false;
    }
  }

  function stop(nextElapsed) {
    running = false;
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    if (typeof nextElapsed === 'number') elapsed = clamp(nextElapsed, 0, duration);
    setButtonState();
  }

  function tick(now) {
    if (!running || disposed) return;
    var delta = Math.min(80, Math.max(0, now - lastTime));
    lastTime = now;
    elapsed = Math.min(duration, elapsed + delta);
    draw(elapsed / duration);
    if (elapsed >= duration) {
      stop(duration);
      return;
    }
    frameHandle = window.requestAnimationFrame(tick);
  }

  function play() {
    if (disposed || running || !visible || (reducedMotion && reducedMotion.matches)) return;
    if (elapsed >= duration) elapsed = 0;
    started = true;
    running = true;
    lastTime = window.performance && performance.now ? performance.now() : Date.now();
    setButtonState();
    frameHandle = window.requestAnimationFrame(tick);
  }

  function replayAnimation() {
    if (disposed) return;
    stop(0);
    draw(0);
    if (!(reducedMotion && reducedMotion.matches)) play();
  }

  function handleVisibility(entries) {
    visible = Boolean(entries[0] && entries[0].isIntersecting);
    if (!visible && running) stop(elapsed);
    if (visible && !started && !(reducedMotion && reducedMotion.matches)) play();
  }

  toggle.addEventListener('click', function () {
    if (running) stop(elapsed);
    else play();
  });
  replay.addEventListener('click', replayAnimation);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && running) stop(elapsed);
  });
  window.addEventListener('pagehide', function (event) {
    stop(elapsed);
    if (!event.persisted) {
      disposed = true;
      if (observer) observer.disconnect();
    }
  });
  var observer = 'IntersectionObserver' in window ? new IntersectionObserver(handleVisibility, { threshold: 0.2 }) : null;
  if (observer) observer.observe(stage);

  function onMotionPreference() {
    if (reducedMotion && reducedMotion.matches) {
      stop(duration);
      draw(1);
    }
    setButtonState();
  }
  if (reducedMotion) {
    if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', onMotionPreference);
    else if (typeof reducedMotion.addListener === 'function') reducedMotion.addListener(onMotionPreference);
  }

  resize();
  onMotionPreference();
  if (!observer && !(reducedMotion && reducedMotion.matches)) play();
}());
