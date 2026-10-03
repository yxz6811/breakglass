/* Frontend visual effects adapted from breakglass-apple.zip.
   Product scope: ../docs/BreakGlass-constitution.md (1.6.0).
   Particles and depth are decorative; they do not represent recognition work. */
(function () {
  'use strict';

  const root = document.documentElement;
  const events = window.BreakGlassMotion.createListeners();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const depthScreen = window.matchMedia('(min-width: 901px) and (hover: hover) and (pointer: fine)');
  const coarseScreen = window.matchMedia('(pointer: coarse)');
  const canvas = document.getElementById('fx');
  const context = canvas && canvas.getContext('2d');
  const hero = document.querySelector('.brand-intro');
  const stage = hero && hero.querySelector('.brand-stage');
  const revealElements = new Set(document.querySelectorAll('.reveal'));
  const pendingReveals = new Set(revealElements);
  let revealObserver = null;
  let particles = [];
  let width = 0;
  let height = 0;
  let particleFrame = 0;
  let depthFrame = 0;
  let lastPaint = 0;
  let elapsed = 0;
  let suspended = document.hidden;
  let disposed = false;
  let sprite = null;

  function reveal(element) {
    if (!pendingReveals.delete(element)) return;
    element.classList.add('is-revealed');
  }

  function resetReveal(element, bounds) {
    // A partially visible or focused control must never disappear during a scroll.
    if (bounds.bottom > 0 && bounds.top < window.innerHeight) return;
    if (element.contains(document.activeElement)) return;
    element.style.setProperty('--reveal-from-y', bounds.bottom <= 0 ? '-22px' : '22px');
    element.classList.remove('is-revealed');
    pendingReveals.add(element);
  }

  function revealAll() {
    pendingReveals.forEach(reveal);
    if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }
  }

  function observeReveals() {
    if (motion.matches || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      // Ignore queued work from an observer replaced by a preference change.
      if (disposed || motion.matches || revealObserver !== observer) return;
      entries.forEach(function (entry) {
        // Keep observing both edges: leave completely, then replay on either return.
        // Individual targets let tall mobile sections enter without fitting the viewport.
        if (entry.isIntersecting) reveal(entry.target);
        else resetReveal(entry.target, entry.boundingClientRect);
      });
    }, { threshold: 0, rootMargin: '0px' });
    revealObserver = observer;
    revealElements.forEach(function (element) {
      const bounds = element.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) reveal(element);
      else resetReveal(element, bounds);
      revealObserver.observe(element);
    });
  }

  function makeParticle(fromBottom) {
    return {
      x: Math.random() * width,
      y: fromBottom ? height + Math.random() * 70 : Math.random() * height,
      radius: .75 + Math.random() * 1.25,
      speed: 5 + Math.random() * 8,
      drift: (Math.random() - .5) * 3,
      phase: Math.random() * Math.PI * 2,
      frequency: .45 + Math.random() * .65,
      alpha: .12 + Math.random() * .16
    };
  }

  function makeSprite() {
    const bitmap = document.createElement('canvas');
    bitmap.width = bitmap.height = 64;
    const bitmapContext = bitmap.getContext('2d');
    if (!bitmapContext) return null;
    const light = bitmapContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    light.addColorStop(0, 'rgba(222,248,255,1)');
    light.addColorStop(.16, 'rgba(113,221,255,.9)');
    light.addColorStop(.42, 'rgba(64,165,208,.22)');
    light.addColorStop(1, 'rgba(35,105,140,0)');
    bitmapContext.fillStyle = light;
    bitmapContext.fillRect(0, 0, 64, 64);
    return bitmap;
  }

  function paintParticles(delta) {
    if (!context || !sprite) return;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    particles.forEach(function (particle, index) {
      if (delta) {
        particle.y -= particle.speed * delta;
        particle.x += (particle.drift + Math.sin(elapsed * particle.frequency + particle.phase) * 1.3) * delta;
        if (particle.y < -30 || particle.x < -30 || particle.x > width + 30) {
          particles[index] = makeParticle(true);
          return;
        }
      }
      const size = particle.radius * 6;
      const shimmer = motion.matches ? .78 : .7 + .3 * Math.sin(elapsed * particle.frequency + particle.phase);
      context.globalAlpha = particle.alpha * shimmer;
      context.drawImage(sprite, particle.x - size, particle.y - size, size * 2, size * 2);
    });
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  function resizeParticles() {
    if (!context) return;
    const previousWidth = width;
    const previousHeight = height;
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    const compact = width < 720 || coarseScreen.matches;
    const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles.forEach(function (particle) {
      particle.x *= width / Math.max(1, previousWidth);
      particle.y *= height / Math.max(1, previousHeight);
    });
    const count = compact ? 14 : 30;
    particles.length = Math.min(particles.length, count);
    while (particles.length < count) particles.push(makeParticle(false));
    paintParticles(0);
  }

  function tickParticles(time) {
    particleFrame = 0;
    if (disposed || suspended || motion.matches) return;
    if (!lastPaint || time - lastPaint >= 1000 / 30) {
      // Timestamp velocity stays stable on displays with different refresh rates.
      const delta = lastPaint ? Math.min((time - lastPaint) / 1000, .064) : 0;
      elapsed += delta;
      lastPaint = time;
      paintParticles(delta);
    }
    particleFrame = requestAnimationFrame(tickParticles);
  }

  function startParticles() {
    if (!context || !sprite || disposed || suspended || motion.matches || particleFrame) return;
    lastPaint = 0;
    particleFrame = requestAnimationFrame(tickParticles);
  }

  function updateDepth() {
    depthFrame = 0;
    if (!stage || !hero) return;
    if (motion.matches || !depthScreen.matches) {
      stage.style.removeProperty('transform');
      stage.style.removeProperty('opacity');
      return;
    }
    const bounds = hero.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -bounds.top / Math.max(1, bounds.height)));
    stage.style.transform = 'translateY(' + (progress * 24).toFixed(2) + 'px)';
    stage.style.opacity = (1 - progress * .18).toFixed(3);
  }

  function scheduleDepth() {
    if (!disposed && !suspended && !depthFrame) depthFrame = requestAnimationFrame(updateDepth);
  }

  function stopFrames() {
    cancelAnimationFrame(particleFrame);
    cancelAnimationFrame(depthFrame);
    particleFrame = depthFrame = 0;
    lastPaint = 0;
  }

  function onMotionChange() {
    stopFrames();
    if (motion.matches) revealAll();
    else if (!revealObserver) observeReveals();
    paintParticles(0);
    updateDepth();
    startParticles();
  }

  function onVisibilityChange() {
    suspended = document.hidden;
    document.body.classList.toggle('effects-paused', suspended);
    if (suspended) stopFrames();
    else {
      startParticles();
      scheduleDepth();
    }
  }

  observeReveals();
  // The default CSS stays readable when JavaScript is unavailable.
  root.classList.add('effects-ready');
  document.body.classList.toggle('effects-paused', suspended);
  if (context) {
    sprite = makeSprite();
    resizeParticles();
    startParticles();
  }
  updateDepth();

  events.listen(document, 'focusin', function (event) {
    revealElements.forEach(function (element) {
      if (element.contains(event.target)) reveal(element);
      else if (!motion.matches && revealObserver) resetReveal(element, element.getBoundingClientRect());
    });
  });
  events.listen(window, 'scroll', scheduleDepth, { passive: true });
  events.listen(window, 'resize', function () {
    resizeParticles();
    scheduleDepth();
  }, { passive: true });
  events.listen(motion, 'change', onMotionChange);
  events.listen(depthScreen, 'change', scheduleDepth);
  events.listen(coarseScreen, 'change', resizeParticles);
  events.listen(document, 'visibilitychange', onVisibilityChange);
  events.listen(window, 'pagehide', function (event) {
    suspended = true;
    document.body.classList.add('effects-paused');
    stopFrames();
    if (!event.persisted) {
      disposed = true;
      if (revealObserver) revealObserver.disconnect();
      events.abort();
    }
  });
  events.listen(window, 'pageshow', function () {
    suspended = document.hidden;
    document.body.classList.toggle('effects-paused', suspended);
    resizeParticles();
    startParticles();
    scheduleDepth();
  });
}());
