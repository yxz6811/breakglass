(function () {
  'use strict';

  var canvas = document.getElementById('intro-video-canvas');
  var toggle = document.getElementById('intro-video-toggle');
  var screenPlay = document.getElementById('intro-video-screen-play');
  var restart = document.getElementById('intro-video-restart');
  var voiceButton = document.getElementById('intro-video-voice');
  var timeline = document.getElementById('intro-video-timeline');
  var status = document.getElementById('intro-video-status');
  var sceneLabel = document.getElementById('intro-video-scene');
  var clockLabel = document.getElementById('intro-video-clock');
  var chapterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-scene]'));
  if (!canvas || !toggle || !restart || !voiceButton || !timeline || !screenPlay) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var WIDTH = 1920;
  var HEIGHT = 1080;
  var DURATION_MS = 300000;
  var TARGET_FPS = 60;
  var FRAME_MS = 1000 / TARGET_FPS;
  var scenes = [
    { title: '一帧画面，只能看', duration: 24000, voice: '我们每天看很多教学视频。画面里的公式很清楚，真正卡住我们的，往往就是其中一帧。看见了，却还没有办法动手验证。' },
    { title: '一个学习卡点', duration: 28000, voice: '当学生想问一句，如果把这个条件改掉，会发生什么，视频只能继续播放。于是我们把问题换成一个更具体的动作：暂停这一帧，亲手改一改。' },
    { title: '我们先问身边的人', duration: 30000, voice: '团队先问了身边的十位学生。这是一次小规模的初步访谈，不是效果结论。反馈很集中：大家都有视频学习经历，也都期待能直接对画面里的图形提出问题。' },
    { title: '破壁：让像素恢复回应', duration: 28000, voice: 'BreakGlass 破壁从这里开始。我们把视频里的曲线看作一个入口，在原来的位置放回一层可以操作的图形，让观看和探索留在同一个画面里。' },
    { title: 'Demo：暂停、改变、验证', duration: 38000, voice: '在当前 P0 演示里，我们使用团队提供的固定机位示例片。停在第六秒，打开预先准备的抛物线，然后改变开口、水平位置和顶点高度。先猜，再拖动，最后看结果。' },
    { title: '围绕一个疑问，形成闭环', duration: 36000, voice: '完整的学习闭环包含四步：识别当前画面，停在疑问发生的那一帧，动手改变条件，再用一次预测或解释检查自己是否真的理解。当前页面先把数学抛物线这条路径做成了可重复的 P0 演示。' },
    { title: '让画面结构连接到交互计算', duration: 34000, voice: '技术上，我们用原生 JavaScript、CSS 和 SVG 维护这层交互。视频负责提供画面，曲线由确定性的数学函数绘制。真实视觉识别和更广的内容适配属于后续 P1，需要独立验证。' },
    { title: '先服务真正需要的人', duration: 32000, voice: '第一批用户，是经常通过视频学习、又愿意验证自己疑问的学生。老师也可以用它快速回应课堂里的那句，如果换个条件呢。学生少一些重画和切换工具的步骤，老师多一个即时演示的入口。' },
    { title: '从数学开始，走向更多学科', duration: 28000, voice: '我们会先验证使用价值，再验证付费意愿。近期继续打磨数学和物理题型，中期扩大可探索的内容范围，远期再研究更多学科。每一步都以真实使用反馈为依据。' },
    { title: '视频不该只是被观看', duration: 22000, voice: '我们想做的事情很简单：当你在某一帧产生疑问时，屏幕应该给你一个可以亲手验证的入口。这就是 BreakGlass 破壁。让更多视频内容，可以被探索。谢谢。' }
  ];
  var sceneStarts = [];
  var total = 0;
  scenes.forEach(function (scene) { sceneStarts.push(total); total += scene.duration; });

  var elapsed = 0;
  var running = false;
  var speech = 'speechSynthesis' in window && typeof window.speechSynthesis.speak === 'function' ? window.speechSynthesis : null;
  var voiceEnabled = Boolean(speech);
  var frameHandle = 0;
  var lastTime = 0;
  var frameAccumulator = 0;
  var currentScene = -1;
  var dpr = 1;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TAU = Math.PI * 2;
  if (!voiceEnabled) {
    voiceButton.disabled = true;
    voiceButton.setAttribute('aria-pressed', 'false');
    voiceButton.textContent = '配音：不可用';
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function smooth(value) { var t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(value) { var t = clamp(value, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function rgba(rgb, alpha) { return 'rgba(' + rgb + ',' + clamp(alpha, 0, 1).toFixed(3) + ')'; }
  function roundRect(x, y, width, height, radius, fill, stroke) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function text(value, x, y, size, color, weight, align) {
    ctx.font = (weight || 500) + ' ' + size + 'px Inter, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }
  function wrap(value, x, y, maxWidth, lineHeight, size, color, weight) {
    var characters = value.split('');
    var lineText = '';
    var row = 0;
    ctx.font = (weight || 500) + ' ' + size + 'px Inter, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    characters.forEach(function (character) {
      var candidate = lineText + character;
      if (ctx.measureText(candidate).width > maxWidth && lineText) {
        ctx.fillText(lineText, x, y + row * lineHeight);
        row += 1;
        lineText = character;
      } else lineText = candidate;
    });
    if (lineText) ctx.fillText(lineText, x, y + row * lineHeight);
  }
  function line(x1, y1, x2, y2, color, width, alpha, dash) {
    ctx.save();
    ctx.strokeStyle = rgba(color, alpha == null ? 1 : alpha);
    ctx.lineWidth = width || 2;
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
  function curve(box, parameters, color, alpha, width, glow, samples) {
    var points = [];
    var left = box.x + box.width * .08;
    var scaleX = box.width * .84 / 5;
    var top = box.y + box.height * .08;
    var scaleY = box.height * .075;
    var count = samples || 80;
    for (var i = 0; i <= count; i += 1) {
      var x = -2.5 + 5 * i / count;
      points.push({ x: left + (x + 2.5) * scaleX, y: top + (parameters.a * Math.pow(x - parameters.h, 2) + parameters.k) * scaleY });
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 24; }
    ctx.beginPath();
    points.forEach(function (point, index) { if (!index) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
    ctx.stroke();
    ctx.restore();
    return { x: left + (parameters.h + 2.5) * scaleX, y: top + parameters.k * scaleY };
  }
  function background(progress, sceneIndex) {
    var gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#071017'); gradient.addColorStop(.55, '#08131b'); gradient.addColorStop(1, '#0b1420');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (var x = 0; x < WIDTH; x += 96) line(x, 0, x, HEIGHT, '151,206,224', 1, .055);
    for (var y = 0; y < HEIGHT; y += 96) line(0, y, WIDTH, y, '151,206,224', 1, .055);
    for (var i = 0; i < 18; i += 1) {
      var seed = i * 2.13 + sceneIndex;
      var px = (0.06 + ((Math.sin(seed * 1.9) + 1) * .43)) * WIDTH + Math.sin(progress * TAU + seed) * 10;
      var py = (0.08 + ((Math.cos(seed * 1.3) + 1) * .4)) * HEIGHT;
      ctx.fillStyle = 'rgba(113,221,255,' + (.08 + i % 3 * .03) + ')'; ctx.beginPath(); ctx.arc(px, py, 2 + i % 3, 0, TAU); ctx.fill();
    }
  }
  function logoMark(x, y, scale, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    line(x - 78 * scale, y - 58 * scale, x - 78 * scale, y + 60 * scale, '238,246,248', 8 * scale, 1);
    line(x - 78 * scale, y - 58 * scale, x - 12 * scale, y - 58 * scale, '238,246,248', 8 * scale, 1);
    line(x + 78 * scale, y + 58 * scale, x + 78 * scale, y - 60 * scale, '238,246,248', 8 * scale, 1);
    line(x + 78 * scale, y + 58 * scale, x + 12 * scale, y + 58 * scale, '238,246,248', 8 * scale, 1);
    ctx.strokeStyle = '#a1afb4'; ctx.lineWidth = 13 * scale; ctx.beginPath(); ctx.moveTo(x - 55 * scale, y + 27 * scale); ctx.bezierCurveTo(x - 35 * scale, y - 72 * scale, x - 2 * scale, y - 72 * scale, x + 28 * scale, y + 18 * scale); ctx.stroke();
    ctx.strokeStyle = '#45d4f7'; ctx.beginPath(); ctx.moveTo(x + 6 * scale, y - 2 * scale); ctx.bezierCurveTo(x + 33 * scale, y + 82 * scale, x + 58 * scale, y + 74 * scale, x + 75 * scale, y - 8 * scale); ctx.stroke();
    line(x - 70 * scale, y + 63 * scale, x + 66 * scale, y - 66 * scale, '238,246,248', 5 * scale, .92);
    ctx.fillStyle = '#f5fbfd'; ctx.beginPath(); ctx.arc(x + 18 * scale, y + 26 * scale, 10 * scale, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function panel(x, y, width, height, title, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    roundRect(x, y, width, height, 20, 'rgba(255,255,255,.035)', 'rgba(171,220,233,.22)');
    text(title, x + 24, y + 38, 16, '#a7efff', 700);
    ctx.restore();
  }
  function drawScene(index, progress) {
    var local = smooth(progress);
    background(progress, index);
    if (index === 0) drawProblem(local);
    if (index === 1) drawCard(local);
    if (index === 2) drawResearch(local);
    if (index === 3) drawBreak(local);
    if (index === 4) drawDemo(local);
    if (index === 5) drawLoop(local);
    if (index === 6) drawTech(local);
    if (index === 7) drawUsers(local);
    if (index === 8) drawFuture(local);
    if (index === 9) drawClose(local);
    text('BREAKGLASS  /  ' + String(index + 1).padStart(2, '0') + '—10', 74, 1010, 14, 'rgba(224,239,243,.52)', 700);
  }
  function drawProblem(t) {
    var r = easeOut(t); var cx = WIDTH * .5; var cy = HEIGHT * .44;
    text('在看不懂的那一帧', cx, 220, 64, '#eef6f8', 700, 'center');
    text('你能看见结果，却还不能亲手验证。', cx, 280, 26, '#8ca2ac', 500, 'center');
    logoMark(cx, cy + 70, .92, r);
    line(300, 710, 1620, 710, '113,221,255', 2, .35, [8, 12]);
    text('观看', 540, 820, 22, '#8ca2ac', 600, 'center'); text('疑问', 960, 820, 22, '#a7efff', 600, 'center'); text('验证', 1380, 820, 22, '#8ca2ac', 600, 'center');
  }
  function drawCard(t) {
    var shift = (1 - easeOut(t)) * 160;
    text('一个学习卡点，如何变成一个产品', 150, 210 - shift, 56, '#eef6f8', 700);
    text('暂停 · 改变 · 观察 · 解释', 154, 270 - shift, 24, '#a7efff', 600);
    panel(150, 370, 690, 390, '视频里的像素', easeOut(t)); panel(1080, 370, 690, 390, '可以回应的对象', easeOut(t));
    curve({ x: 200, y: 470, width: 580, height: 220 }, { a: 1, h: 0, k: 1 }, '#a9b8bf', .84, 6, false);
    var morph = smooth((t - .25) / .75);
    curve({ x: 1130, y: 470, width: 580, height: 220 }, { a: mix(1, .58, morph), h: mix(0, .36, morph), k: mix(1, 1.14, morph) }, '#71ddff', morph, 6, true);
    line(855, 565, 1065, 565, '113,221,255', 2, .5); text('形变', 960, 545, 16, '#a7efff', 700, 'center');
  }
  function drawResearch(t) {
    text('我们问了身边的 10 位学生', 140, 210, 58, '#eef6f8', 700);
    text('初步访谈提供方向，真实使用仍要继续验证。', 144, 266, 24, '#8ca2ac', 500);
    var cards = [{ n: '10', label: '有视频学习经历' }, { n: '8+', label: '遇到理解卡点' }, { n: '10', label: '期待交互答疑' }];
    cards.forEach(function (card, i) { var x = 150 + i * 560; var rise = (1 - easeOut(t)) * 80; panel(x, 430 + rise, 450, 260, '0' + (i + 1), easeOut(t)); text(card.n, x + 32, 560 + rise, 86, '#a889ff', 700); text(card.label, x + 34, 628 + rise, 23, '#eef6f8', 600); });
  }
  function drawBreak(t) {
    var morph = smooth(t); var cx = WIDTH * .5; var cy = 560; var size = mix(280, 360, morph);
    text('为什么叫“破壁”', 150, 190, 64, '#eef6f8', 700); text('把视频的边界，变成探索的入口。', 154, 250, 26, '#a7efff', 500);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((1 - morph) * -.1); roundRect(-size, -size * .55, size * 2, size * 1.1, 24, 'rgba(255,255,255,.025)', 'rgba(171,220,233,.25)'); ctx.restore();
    line(cx - size * .85, cy + size * .5, cx + size * .86, cy - size * .5, '238,246,248', mix(7, 3, morph), .9);
    curve({ x: cx - size * .74, y: cy - size * .34, width: size * 1.48, height: size * .72 }, { a: mix(1, .58, morph), h: mix(0, .36, morph), k: mix(1, 1.14, morph) }, '#71ddff', morph, 8, true);
    text('原位 · 轻量 · 可验证', cx, 900, 22, '#8ca2ac', 600, 'center');
  }
  function drawDemo(t) {
    var m = smooth((t - .12) / .55); var panelY = 360; var panelH = 390;
    text('Demo：先猜，再动手', 140, 180, 62, '#eef6f8', 700); text('把“如果换个条件呢”变成一次可见的实验。', 144, 240, 25, '#8ca2ac', 500);
    panel(130, panelY, 720, panelH, '原始视频帧 · 6.0 s', 1); panel(1070, panelY, 720, panelH, '破壁图层 · y = a(x-h)²+k', 1);
    curve({ x: 190, y: panelY + 72, width: 600, height: 280 }, { a: 1, h: 0, k: 1 }, '#a9b8bf', 1 - m * .55, 7, false);
    var p = { a: mix(1, .58, m), h: mix(0, .36, m), k: mix(1, 1.14, m) }; var dot = curve({ x: 1130, y: panelY + 72, width: 600, height: 280 }, p, '#71ddff', .5 + m * .5, 7, true);
    var inspect = smooth((t - .58) / .25); ctx.save(); ctx.globalAlpha = inspect; ctx.fillStyle = '#fff'; ctx.shadowColor = '#71ddff'; ctx.shadowBlur = 25; ctx.beginPath(); ctx.arc(dot.x, dot.y, 13, 0, TAU); ctx.fill(); ctx.restore();
    ['开口 a', '水平位置 h', '顶点高度 k'].forEach(function (label, i) { var x = 1180 + i * 190; text(label, x, 825, 17, '#8ca2ac', 600); line(x, 850, x + 140, 850, '113,221,255', 3, .35); ctx.fillStyle = '#71ddff'; ctx.beginPath(); ctx.arc(x + [84, 48, 106][i] * (0.6 + m * .4), 850, 8, 0, TAU); ctx.fill(); });
  }
  function drawLoop(t) {
    text('围绕一个疑问，形成学习闭环', 140, 190, 60, '#eef6f8', 700); text('识别画面 → 暂停视频 → 动手探索 → 验证理解', 144, 252, 24, '#a7efff', 500);
    var nodes = [{ x: 280, y: 540, n: '01', label: '识别画面' }, { x: 760, y: 420, n: '02', label: '暂停视频' }, { x: 1160, y: 660, n: '03', label: '动手探索' }, { x: 1600, y: 450, n: '04', label: '验证理解' }];
    nodes.forEach(function (node, i) { var appear = easeOut((t - i * .12) / .35); if (i) line(nodes[i - 1].x, nodes[i - 1].y, node.x, node.y, '113,221,255', 4, appear * .55); ctx.save(); ctx.globalAlpha = appear; ctx.fillStyle = 'rgba(113,221,255,.13)'; ctx.strokeStyle = '#71ddff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.x, node.y, 62, 0, TAU); ctx.fill(); ctx.stroke(); text(node.n, node.x, node.y - 2, 17, '#a7efff', 700, 'center'); text(node.label, node.x, node.y + 95, 23, '#eef6f8', 600, 'center'); ctx.restore(); });
  }
  function drawTech(t) {
    text('让画面结构与交互计算连接起来', 140, 190, 60, '#eef6f8', 700); text('原生 JavaScript / CSS / SVG · 结果经过固定规则校验', 144, 252, 24, '#8ca2ac', 500);
    var labels = ['读取画面', '生成操作层', '保持结果一致']; labels.forEach(function (label, i) { var x = 160 + i * 580; var y = 430 + (1 - easeOut((t - i * .12) / .45)) * 90; var p = easeOut((t - i * .12) / .45); panel(x, y, 480, 260, '0' + (i + 1), p); text(label, x + 28, y + 126, 30, '#a7efff', 700); text(['HTML5 Video + Canvas', '原生 SVG + 数学函数', '参数范围 + 坐标映射'][i], x + 28, y + 182, 18, '#8ca2ac', 500); });
  }
  function drawUsers(t) {
    text('先服务真正需要的人', 140, 190, 62, '#eef6f8', 700); text('少一点重画，多一次验证。', 144, 252, 26, '#a7efff', 500);
    var cards = [{ title: '学生视角', body: '函数、几何遇到卡点时，改变条件验证自己的疑问。' }, { title: '教师视角', body: '课堂里出现“如果换个条件呢”，可以马上演示变化。' }];
    cards.forEach(function (card, i) { var x = 180 + i * 820; var y = 420 + (1 - easeOut((t - i * .15) / .5)) * 100; var p = easeOut((t - i * .15) / .5); panel(x, y, 680, 310, card.title, p); wrap(card.body, x + 34, y + 132, 580, 40, 24, '#eef6f8', 600); });
  }
  function drawFuture(t) {
    text('让更多视频内容可以亲手探索', 140, 190, 62, '#eef6f8', 700); text('先验证使用价值，再验证付费。', 144, 252, 26, '#a7efff', 500);
    var items = [{ label: '近期', detail: '数学题与抛物线', h: 210 }, { label: '中期', detail: '理科更多题型', h: 320 }, { label: '远期', detail: '更多学科的探索', h: 440 }];
    items.forEach(function (item, i) { var x = 190 + i * 570; var p = easeOut((t - i * .12) / .6); var y = 820 - item.h * p; panel(x, y, 430, item.h, item.label, p); text(item.detail, x + 26, y + 82, 24, '#a7efff', 700); line(x + 26, y + 114, x + 360, y + 114, '113,221,255', 2, .35); });
  }
  function drawClose(t) {
    var p = easeOut(t); logoMark(WIDTH / 2, 360, .86, p); text('视频不该只是被观看', WIDTH / 2, 650, 66, '#eef6f8', 700, 'center'); text('知识应该可以被触碰。', WIDTH / 2, 725, 34, '#71ddff', 600, 'center'); text('BreakGlass 破壁', WIDTH / 2, 860, 20, '#8ca2ac', 600, 'center');
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * dpr; canvas.height = HEIGHT * dpr;
    canvas.style.aspectRatio = WIDTH + ' / ' + HEIGHT;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }
  function sceneAt(time) {
    for (var i = scenes.length - 1; i >= 0; i -= 1) if (time >= sceneStarts[i]) return i;
    return 0;
  }
  function timeText(ms) { var totalSeconds = Math.floor(ms / 1000); return String(Math.floor(totalSeconds / 60)).padStart(2, '0') + ':' + String(totalSeconds % 60).padStart(2, '0'); }
  function updateScene(index) {
    if (index === currentScene) return;
    currentScene = index;
    if (sceneLabel) sceneLabel.textContent = scenes[index].title;
    chapterButtons.forEach(function (button) { button.setAttribute('aria-current', Number(button.dataset.scene) === index ? 'true' : 'false'); });
    if (running) speak(index);
  }
  function speak(index) {
    if (!voiceEnabled || !speech) return;
    try {
      speech.cancel();
      var utterance = new SpeechSynthesisUtterance(scenes[index].voice);
      utterance.lang = 'zh-CN'; utterance.rate = .92; utterance.pitch = 1; utterance.volume = 1;
      var voices = speech.getVoices();
      var chinese = voices.find(function (voice) { return /^zh/i.test(voice.lang); });
      if (chinese) utterance.voice = chinese;
      speech.speak(utterance);
    } catch (error) {
      voiceEnabled = false;
      voiceButton.disabled = true;
      voiceButton.setAttribute('aria-pressed', 'false');
      voiceButton.textContent = '配音：不可用';
      if (status) status.textContent = '语音接口不可用，动画仍会继续播放。';
    }
  }
  function paint() {
    var index = sceneAt(elapsed); var start = sceneStarts[index]; var progress = (elapsed - start) / scenes[index].duration;
    drawScene(index, progress); updateScene(index);
    timeline.value = String(elapsed / 1000);
    if (clockLabel) clockLabel.textContent = timeText(elapsed) + ' / 05:00';
  }
  function stop() { running = false; if (frameHandle) window.cancelAnimationFrame(frameHandle); frameHandle = 0; toggle.setAttribute('aria-pressed', 'false'); toggle.textContent = elapsed >= DURATION_MS ? '重新播放' : '播放介绍'; screenPlay.hidden = elapsed > 0 && elapsed < DURATION_MS; }
  function tick(now) {
    if (!running) return;
    var delta = Math.min(80, Math.max(0, now - lastTime)); lastTime = now; frameAccumulator += delta;
    if (frameAccumulator >= FRAME_MS || elapsed >= DURATION_MS) {
      var frames = Math.max(1, Math.floor(frameAccumulator / FRAME_MS));
      elapsed = Math.min(DURATION_MS, elapsed + frames * FRAME_MS);
      frameAccumulator -= frames * FRAME_MS;
      paint();
    }
    if (elapsed >= DURATION_MS) { stop(); if (status) status.textContent = '介绍动画已完成，可以重新播放或跳转章节。'; return; }
    frameHandle = window.requestAnimationFrame(tick);
  }
  function play() {
    if (running) return;
    if (elapsed >= DURATION_MS) elapsed = 0;
    running = true; toggle.setAttribute('aria-pressed', 'true'); toggle.textContent = '暂停介绍'; screenPlay.hidden = true;
    if (status) status.textContent = reduceMotion ? '已手动播放；系统开启了减少动态效果。' : '动画播放中，中文旁白已开启。';
    lastTime = window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now(); frameAccumulator = FRAME_MS; frameHandle = window.requestAnimationFrame(tick);
  }
  function togglePlayback() { if (running) { stop(); if (voiceEnabled && speech) speech.pause(); if (status) status.textContent = '已暂停，可继续播放。'; } else { if (voiceEnabled && speech) speech.resume(); play(); speak(sceneAt(elapsed)); } }
  toggle.addEventListener('click', togglePlayback);
  screenPlay.addEventListener('click', togglePlayback);
  restart.addEventListener('click', function () { stop(); if (speech) speech.cancel(); elapsed = 0; paint(); screenPlay.hidden = false; if (status) status.textContent = '已回到开头，点击播放开始介绍。'; });
  voiceButton.addEventListener('click', function () { voiceEnabled = !voiceEnabled; voiceButton.setAttribute('aria-pressed', String(voiceEnabled)); voiceButton.textContent = '配音：' + (voiceEnabled ? '开' : '关'); if (!voiceEnabled && speech) speech.cancel(); else if (voiceEnabled && running) speak(sceneAt(elapsed)); });
  timeline.addEventListener('input', function () { stop(); if (speech) speech.cancel(); elapsed = Number(timeline.value) * 1000; paint(); screenPlay.hidden = true; if (status) status.textContent = '已跳转到 ' + timeText(elapsed) + '。点击播放继续。'; });
  chapterButtons.forEach(function (button) { button.addEventListener('click', function () { stop(); if (speech) speech.cancel(); elapsed = sceneStarts[Number(button.dataset.scene)]; paint(); screenPlay.hidden = true; if (status) status.textContent = '已跳转到“' + scenes[Number(button.dataset.scene)].title + '”。'; }); });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', function () { stop(); if (speech) speech.cancel(); });
  resize(); paint();
}());
