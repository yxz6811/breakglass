/*
 * ASCII 涟漪背景（零依赖）。
 * 思路参考 ReactBits 免费侧的字符网格实现（LetterGlitch：canvas + 字符栅格，MIT），
 * 涟漪部分自行实现：指针移动/按下向外扩散环形波，字符密度与亮度随波幅变化。
 * 与 Pro 组件 ascii-ripple 无关（那个需要订阅，且是 React + Tailwind 实现）。
 */
(function (root) {
  'use strict';

  var RAMP = ' .`-:;+=*x#%@';
  var PALETTE = ['rgba(122, 168, 214, 0.34)', 'rgba(113, 221, 255, 0.55)', 'rgba(113, 221, 255, 0.82)', 'rgba(214, 245, 255, 0.96)'];
  var CELL_W = 16;
  var CELL_H = 20;
  var FONT = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var MAX_RIPPLES = 6;
  var RIPPLE_SPEED = 0.42;
  var RIPPLE_WIDTH = 92;
  var RIPPLE_DECAY = 1.9;

  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function create(options) {
    var settings = options || {};
    var canvas = settings.canvas;
    if (!canvas) return null;
    var context = canvas.getContext('2d');
    var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var columns = 0;
    var rows = 0;
    var cellCount = 0;
    var charIndex = null;
    var shadeIndex = null;
    var base = null;
    var ripples = [];
    var frameId = 0;
    var lastPaint = 0;
    var width = 0;
    var height = 0;
    var dpr = 1;

    function randomRamp() {
      return Math.floor(Math.random() * RAMP.length);
    }

    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      width = canvas.clientWidth || root.innerWidth;
      height = canvas.clientHeight || root.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = FONT;
      context.textBaseline = 'middle';
      columns = Math.ceil(width / CELL_W) + 1;
      rows = Math.ceil(height / CELL_H) + 1;
      cellCount = columns * rows;
      charIndex = new Uint8Array(cellCount);
      shadeIndex = new Uint8Array(cellCount);
      base = new Float32Array(cellCount);
      for (var i = 0; i < cellCount; i += 1) {
        charIndex[i] = 255;
        shadeIndex[i] = 255;
        base[i] = 0.12 + Math.random() * 0.12;
      }
      context.clearRect(0, 0, width, height);
      paint(0);
    }

    function pointerAt(clientX, clientY, strength) {
      var rect = canvas.getBoundingClientRect();
      ripples.push({ x: clientX - rect.left, y: clientY - rect.top, start: lastPaint || (root.performance ? root.performance.now() : Date.now()), strength: strength });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }

    function ambient(x, y, time) {
      return (
        Math.sin((x + time * 0.02) * 0.012) * 0.5 +
        Math.cos((y - time * 0.015) * 0.016) * 0.5
      ) * 0.5 + 0.5;
    }

    function paint(time) {
      if (!context || !charIndex) return;
      var now = time;
      for (var r = ripples.length - 1; r >= 0; r -= 1) {
        var age = (now - ripples[r].start) / 1000;
        if (age > RIPPLE_DECAY) ripples.splice(r, 1);
      }
      // 只重绘发生变化的格子：整屏 clearRect 会把没变、且被跳过重绘的字擦掉。
      var fieldTime = Math.floor(now / 240) * 240;
      for (var row = 0, index = 0; row < rows; row += 1) {
        var y = row * CELL_H + CELL_H * 0.5;
        for (var column = 0; column < columns; column += 1, index += 1) {
          var x = column * CELL_W + CELL_W * 0.5;
          var value = base[index] + ambient(x, y, fieldTime) * 0.16;
          for (var k = 0; k < ripples.length; k += 1) {
            var ripple = ripples[k];
            var dx = x - ripple.x;
            var dy = y - ripple.y;
            var distance = Math.sqrt(dx * dx + dy * dy);
            var age2 = (now - ripple.start) / 1000;
            var radius = age2 * RIPPLE_SPEED * 320;
            var offset = distance - radius;
            var band = Math.exp(-(offset * offset) / (2 * RIPPLE_WIDTH * RIPPLE_WIDTH));
            value += band * ripple.strength * Math.exp(-age2 * 0.9);
          }
          value = clamp01(value);
          var nextChar = Math.round(value * (RAMP.length - 1));
          if (nextChar === charIndex[index]) continue;
          charIndex[index] = nextChar;
          context.clearRect(x - CELL_W * 0.5, y - CELL_H * 0.5, CELL_W, CELL_H);
          if (nextChar === 0) continue;
          var nextShade = Math.min(PALETTE.length - 1, Math.floor(value * PALETTE.length));
          if (nextShade !== shadeIndex[index]) {
            shadeIndex[index] = nextShade;
            context.fillStyle = PALETTE[nextShade];
          }
          context.fillText(RAMP.charAt(nextChar), x, y);
        }
      }
    }

    function loop(time) {
      lastPaint = time;
      paint(time);
      frameId = root.requestAnimationFrame(loop);
    }

    function start() {
      if (frameId || reduceMotion) return;
      frameId = root.requestAnimationFrame(loop);
    }

    function stop() {
      if (!frameId) return;
      root.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    var lastMove = 0;
    function onPointerMove(event) {
      var stamp = root.performance ? root.performance.now() : Date.now();
      if (stamp - lastMove < 70) return;
      lastMove = stamp;
      pointerAt(event.clientX, event.clientY, 0.55);
    }
    function onPointerDown(event) {
      pointerAt(event.clientX, event.clientY, 1);
    }
    function onVisibility() {
      if (root.document.hidden) stop();
      else start();
    }

    var resizeTimer = 0;
    function onResize() {
      if (resizeTimer) root.clearTimeout(resizeTimer);
      resizeTimer = root.setTimeout(resize, 160);
    }

    resize();
    if (reduceMotion) {
      paint(0);
    } else {
      root.addEventListener('pointermove', onPointerMove, { passive: true });
      root.addEventListener('pointerdown', onPointerDown, { passive: true });
      root.addEventListener('resize', onResize);
      root.document.addEventListener('visibilitychange', onVisibility);
      start();
      // 空闲时自己来一圈，保证首屏不是死图
      root.setTimeout(function () {
        ripples.push({ x: width * 0.32, y: height * 0.42, start: lastPaint, strength: 0.9 });
      }, 500);
    }
    return { start: start, stop: stop, rippleAt: pointerAt, resize: resize, reduced: reduceMotion };
  }

  root.BreakGlassAsciiRipple = { create: create, ramp: RAMP };
})(typeof window !== 'undefined' ? window : globalThis);