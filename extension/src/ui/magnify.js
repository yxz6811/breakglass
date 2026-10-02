// 液态玻璃顶栏的放大内核：纯函数、无 DOM、可在 Node 里测。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlassUI = root.BreakGlassUI || {};
  root.BreakGlassUI.magnify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULTS = Object.freeze({
    radius: 132,     // 影响半径（px）：指针距按钮中心多远开始放大
    maxScale: 1.55,  // 指针正中时的放大倍数
    lift: 10,        // 放大时向上抬起的像素（Dock 观感）
    stiffness: 20    // 平滑系数（1/s）；越大越跟手，越小越顺滑
    ,epsilon: 0.0015 // 收敛阈值，用于判断动画是否可以停
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function positiveOr(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function resolveOptions(options) {
    const source = options || {};
    return {
      radius: positiveOr(source.radius, DEFAULTS.radius),
      maxScale: clamp(positiveOr(source.maxScale, DEFAULTS.maxScale), 1, 3),
      lift: Number.isFinite(source.lift) ? source.lift : DEFAULTS.lift,
      stiffness: positiveOr(source.stiffness, DEFAULTS.stiffness),
      epsilon: positiveOr(source.epsilon, DEFAULTS.epsilon)
    };
  }

  /**
   * 余弦钟形衰减：中心为 1，到 radius 处平滑归零，导数在两端都是 0。
   * 这样相邻按钮的放大是连续过渡的，滑动时不会出现台阶。
   * @param {number} distance 指针到按钮中心的水平距离
   * @param {number} radius 影响半径
   * @returns {number} 0..1
   */
  function falloff(distance, radius) {
    if (!Number.isFinite(distance) || !(radius > 0)) return 0;
    const t = Math.min(1, Math.abs(distance) / radius);
    return 0.5 * (1 + Math.cos(Math.PI * t));
  }

  /**
   * 给定指针位置与各按钮中心，算出每个按钮的目标缩放与抬升。
   * @param {number} pointerX 相对按钮容器左侧的指针位置
   * @param {number[]} centers 各按钮中心的 x（同一坐标空间）
   * @param {object} [options]
   */
  function sample(pointerX, centers, options) {
    const config = resolveOptions(options);
    const list = Array.isArray(centers) ? centers : [];
    if (!Number.isFinite(pointerX)) {
      return list.map((center, index) => ({ index, weight: 0, scale: 1, lift: 0 }));
    }
    return list.map((center, index) => {
      const weight = falloff(pointerX - center, config.radius);
      return {
        index,
        weight,
        scale: 1 + (config.maxScale - 1) * weight,
        lift: config.lift * weight
      };
    });
  }

  /**
   * 帧率无关的低通：dt 用秒，stiffness 越大收敛越快。
   * 把一帧拆成两个半步的结果与一步相同，所以掉帧时观感一致。
   */
  function smooth(current, target, dt, stiffness) {
    const rate = positiveOr(stiffness, DEFAULTS.stiffness);
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const alpha = 1 - Math.exp(-rate * step);
    return current + (target - current) * alpha;
  }

  function settle(values, targets, dt, stiffness) {
    const list = Array.isArray(values) ? values : [];
    const goal = Array.isArray(targets) ? targets : [];
    return list.map((value, index) => {
      const target = typeof goal[index] === 'number' ? goal[index] : value;
      return smooth(value, target, dt, stiffness);
    });
  }

  function isSettled(values, targets, epsilon) {
    const limit = positiveOr(epsilon, DEFAULTS.epsilon);
    const list = Array.isArray(values) ? values : [];
    const goal = Array.isArray(targets) ? targets : [];
    for (let index = 0; index < list.length; index += 1) {
      const target = typeof goal[index] === 'number' ? goal[index] : list[index];
      if (Math.abs(list[index] - target) > limit) return false;
    }
    return true;
  }

  return { DEFAULTS, resolveOptions, falloff, sample, smooth, settle, isSettled };
});