// 液态玻璃顶栏控制器：指针位置 → 每个按钮的缩放/抬升 → rAF 平滑 → transform。
// 只写 transform，不触发重排；动画收敛后自动停，省电。
(function () {
  'use strict';

  const magnify = window.BreakGlassUI && window.BreakGlassUI.magnify;
  if (!magnify) return;

  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const MAX_FRAME_SECONDS = 0.05; // 掉帧时限制单步，避免跳变

  class LiquidGlassDock {
    constructor(root, options = {}) {
      this.root = root;
      this.itemsRoot = root.querySelector('.lg-items');
      this.glass = root.querySelector('.lg-glass');
      this.items = Array.from(root.querySelectorAll('.lg-item'));
      this.options = magnify.resolveOptions(options);
      this.centers = [];
      this.scales = this.items.map(() => 1);
      this.lifts = this.items.map(() => 0);
      this.targetScales = this.items.map(() => 1);
      this.targetLifts = this.items.map(() => 0);
      this.pointerX = Number.NaN;
      this.focusIndex = -1;
      this.frame = null;
      this.lastTime = 0;
      this.applied = [];
      this.measure();
      this.detectSupport();
      this.bind();
      this.bindEdgeReveal();
    }

    // 用布局坐标测量，不受 transform 影响
    measure() {
      this.centers = this.items.map((item) => item.offsetLeft + item.offsetWidth / 2);
    }

    detectSupport() {
      const supportsFilter = typeof CSS !== 'undefined' && CSS.supports
        && (CSS.supports('backdrop-filter', 'url(#lg-refract)') || CSS.supports('-webkit-backdrop-filter', 'url(#lg-refract)'));
      if (supportsFilter && this.root.dataset.refract !== 'off') this.root.dataset.refract = 'on';
    }

    bind() {
      this.onPointerMove = (event) => this.handlePointerMove(event);
      this.onPointerLeave = () => this.handlePointerLeave();
      this.onFocusIn = (event) => this.handleFocusIn(event);
      this.onFocusOut = () => this.handleFocusOut();
      this.root.addEventListener('pointermove', this.onPointerMove);
      this.root.addEventListener('pointerleave', this.onPointerLeave);
      this.root.addEventListener('focusin', this.onFocusIn);
      this.root.addEventListener('focusout', this.onFocusOut);
      if (typeof ResizeObserver === 'function') {
        this.observer = new ResizeObserver(() => { this.measure(); this.updateTargets(); this.start(); });
        this.observer.observe(this.itemsRoot);
      }
    }

    handlePointerMove(event) {
      const rect = this.itemsRoot.getBoundingClientRect();
      this.setPointer(event.clientX - rect.left);
    }

    handlePointerLeave() {
      this.pointerX = Number.NaN;
      delete this.root.dataset.pointing;
      this.updateTargets();
      this.start();
    }

    handleFocusIn(event) {
      const index = this.items.indexOf(event.target);
      if (index < 0) return;
      this.focusIndex = index;
      this.reveal();
      this.updateTargets();
      this.start();
    }

    handleFocusOut() {
      this.focusIndex = -1;
      this.updateTargets();
      this.start();
      this.scheduleHide();
    }

    /**
     * 平时收到视口上方。指针进入浏览器顶端，或键盘焦点落在栏内时再滑出。
     * 离开后稍等再收起，避免从热区移到按钮上的空隙里闪一下。
     */
    bindEdgeReveal() {
      this.hideTimer = null;
      /** @type {{ clientX: number, clientY: number } | null} */
      this.lastPointer = null;
      this.onWindowPointer = (event) => {
        if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
          this.lastPointer = { clientX: event.clientX, clientY: event.clientY };
        }
        if (this.pointerWantsDock(event) || this.focusIndex >= 0) this.reveal();
        else this.scheduleHide();
      };
      window.addEventListener('pointermove', this.onWindowPointer);
    }

    /**
     * 顶端 10 像素是热区。栏已经打开时，指针还在栏的范围内也算停留。
     * @param {PointerEvent} event
     * @returns {boolean}
     */
    pointerWantsDock(event) {
      if (!event || !Number.isFinite(event.clientY)) return false;
      if (event.clientY <= 10) return true;
      if (this.root.dataset.revealed !== 'true') return false;
      const rect = this.root.getBoundingClientRect();
      return event.clientY <= rect.bottom + 12
        && event.clientX >= rect.left - 12
        && event.clientX <= rect.right + 12;
    }

    /** 滑出顶栏。 */
    reveal() {
      if (this.hideTimer !== null) {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.root.dataset.revealed = 'true';
    }

    /**
     * 焦点还在栏内时不收。到点后再看一次指针：滑出动画结束前指针可能已经停在栏的落点上。
     */
    scheduleHide() {
      if (this.focusIndex >= 0 || this.hideTimer !== null) return;
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = null;
        if (this.focusIndex >= 0) return;
        if (this.pointerWantsDock(this.lastPointer)) return;
        delete this.root.dataset.revealed;
      }, 220);
    }

    setPointer(pointerX) {
      this.pointerX = pointerX;
      this.root.dataset.pointing = 'true';
      if (this.glass) this.glass.style.setProperty('--lg-px', pointerX + 'px');
      this.updateTargets();
      this.start();
    }

    // 指针优先；没有指针（键盘）时用焦点按钮当中心
    updateTargets() {
      const center = Number.isFinite(this.pointerX)
        ? this.pointerX
        : (this.focusIndex >= 0 ? this.centers[this.focusIndex] : Number.NaN);
      const samples = magnify.sample(center, this.centers, this.options);
      this.targetScales = samples.map((item) => (reducedMotion && reducedMotion.matches ? 1 : item.scale));
      this.targetLifts = samples.map((item) => (reducedMotion && reducedMotion.matches ? 0 : item.lift));
    }

    start() {
      if (this.frame !== null) return;
      this.lastTime = this.now();
      this.frame = window.requestAnimationFrame((time) => this.tick(time));
    }

    stop() {
      if (this.frame !== null) window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    now() {
      return window.performance && window.performance.now ? window.performance.now() : Date.now();
    }

    tick(time) {
      this.frame = null;
      const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      this.scales = magnify.settle(this.scales, this.targetScales, dt, this.options.stiffness);
      this.lifts = magnify.settle(this.lifts, this.targetLifts, dt, this.options.stiffness);
      this.apply();
      if (!magnify.isSettled(this.scales, this.targetScales, this.options.epsilon)
          || !magnify.isSettled(this.lifts, this.targetLifts, this.options.epsilon)) {
        this.frame = window.requestAnimationFrame((next) => this.tick(next));
      }
    }

    apply() {
      for (let index = 0; index < this.items.length; index += 1) {
        const scale = this.scales[index];
        const lift = this.lifts[index];
        const last = this.applied[index];
        if (last && Math.abs(last.scale - scale) < 0.0005 && Math.abs(last.lift - lift) < 0.05) continue;
        this.applied[index] = { scale, lift };
        this.items[index].style.transform =
          'translate3d(0,' + (-lift).toFixed(2) + 'px,0) scale(' + scale.toFixed(4) + ')';
      }
    }

    getState() {
      return {
        pointerX: this.pointerX,
        scales: [...this.scales],
        lifts: [...this.lifts],
        targets: [...this.targetScales]
      };
    }

    destroy() {
      this.stop();
      if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
      if (this.onWindowPointer) window.removeEventListener('pointermove', this.onWindowPointer);
      this.root.removeEventListener('pointermove', this.onPointerMove);
      this.root.removeEventListener('pointerleave', this.onPointerLeave);
      this.root.removeEventListener('focusin', this.onFocusIn);
      this.root.removeEventListener('focusout', this.onFocusOut);
      if (this.observer) this.observer.disconnect();
      this.items.forEach((item) => { item.style.transform = ''; });
    }
  }

  window.BreakGlassUI.LiquidGlassDock = LiquidGlassDock;

  // 自动初始化：<div class="lg-dock" data-liquid-glass>…</div>
  function boot() {
    const docks = Array.from(document.querySelectorAll('[data-liquid-glass]'));
    window.BreakGlassUI.docks = docks.map((node) => new LiquidGlassDock(node));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();