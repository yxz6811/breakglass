/**
 * 本地数学图形模型。约束：docs/BreakGlass-constitution.md（确定性、坐标映射与 P0 边界）
 * 和 specs/004-figures-and-tutor/spec.md（FR-007..010）。不向视频识别白名单添加图形。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.figures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const names = {
    parabola: ['a', 'h', 'k'],
    line: ['m', 'b'],
    circle: ['h', 'k', 'r'],
    sine: ['a', 'h', 'k']
  };
  const labels = { parabola: '抛物线', line: '直线', circle: '圆', sine: '正弦' };
  const MAX_SAMPLES = 4097;
  const TAU = 2 * Math.PI;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function assertBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) ||
        !(bounds.max > bounds.min) || !Number.isFinite(bounds.max - bounds.min)) {
      throw new TypeError('坐标窗口必须是有限且递增的范围。');
    }
  }

  function assertDescriptor(item) {
    if (!item || !['initial', 'min', 'max', 'step'].every((key) => Number.isFinite(item[key])) ||
        item.step <= 0 || item.min > item.initial || item.initial > item.max ||
        !Number.isFinite(item.max - item.min)) {
      throw new TypeError('图形系数必须有合法的有限初值、范围和步长。');
    }
  }

  function assertDefinition(definition) {
    if (!definition || !definition.parameters) throw new TypeError('缺少图形定义。');
    assertBounds(definition.domain);
    assertBounds(definition.range);
    const region = definition.region;
    if (!region || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key])) ||
        region.width <= 0 || region.height <= 0 ||
        !Number.isFinite(region.x + region.width) || !Number.isFinite(region.y + region.height)) {
      throw new TypeError('图形区域必须是有限的正数尺寸。');
    }
    if (definition.yAxis !== 'up' && definition.yAxis !== 'down') throw new TypeError('未知坐标轴方向。');
  }

  function assertFigure(figure) {
    if (!figure || !own(names, figure.kind)) throw new TypeError('未知图形。');
    assertDefinition(figure.definition);
    const required = names[figure.kind];
    if (!figure.parameters || Object.keys(figure.parameters).some((name) => !required.includes(name))) {
      throw new TypeError('存在未知图形系数。');
    }
    for (const name of required) {
      const item = figure.definition.parameters[name];
      assertDescriptor(item);
      if (!own(figure.parameters, name) || !Number.isFinite(figure.parameters[name]) ||
          figure.parameters[name] < item.min || figure.parameters[name] > item.max) {
        throw new TypeError('图形系数必须是允许范围内的有限数值。');
      }
    }
    if (figure.kind === 'parabola' && (figure.parameters.a === 0 ||
        (figure.definition.parameters.a.min <= 0 && figure.definition.parameters.a.max >= 0))) {
      throw new TypeError('抛物线开口系数的范围不得包含 0。');
    }
    if (figure.kind === 'circle' && figure.definition.parameters.r.min <= 0) {
      throw new TypeError('圆的半径必须为正数。');
    }
    assertFiniteFigure(figure);
  }

  function yAt(figure, x) {
    const p = figure.parameters;
    let y;
    if (figure.kind === 'parabola') y = p.a * (x - p.h) * (x - p.h) + p.k;
    else if (figure.kind === 'line') y = p.m * x + p.b;
    else if (figure.kind === 'sine') y = p.a * Math.sin(x - p.h) + p.k;
    else throw new TypeError('圆不能用单值函数求值。');
    if (!Number.isFinite(y)) throw new TypeError('图形求值结果必须是有限数值。');
    return y;
  }

  // 修改完成后仍需能在当前域上有限求值；不把溢出的结果送进 SVG。
  function assertFiniteFigure(figure) {
    const p = figure.parameters;
    const finite = (value) => {
      if (!Number.isFinite(value)) throw new TypeError('图形求值结果必须是有限数值。');
    };
    if (figure.kind === 'circle') {
      [p.h - p.r, p.h + p.r, p.k - p.r, p.k + p.r].forEach(finite);
    } else {
      yAt(figure, figure.definition.domain.min);
      yAt(figure, figure.definition.domain.max);
      if (figure.kind === 'sine') {
        finite(p.k - Math.abs(p.a));
        finite(p.k + Math.abs(p.a));
      }
    }
  }

  function descriptor(item, label) {
    assertDescriptor(item);
    return { initial: item.initial, min: item.min, max: item.max, step: item.step, label };
  }

  // 新图形在原 region 内居中；横纵一个数学单位使用同样的源像素数。
  function equalUnitRegion(definition) {
    const xSpan = definition.domain.max - definition.domain.min;
    const ySpan = definition.range.max - definition.range.min;
    const region = definition.region;
    const scale = Math.min(region.width / xSpan, region.height / ySpan);
    const width = xSpan * scale;
    const height = ySpan * scale;
    if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new TypeError('无法按同一数学比例显示图形。');
    }
    return {
      x: region.x + (region.width - width) / 2,
      y: region.y + (region.height - height) / 2,
      width, height
    };
  }

  function createFigure(kind, baseDefinition) {
    if (!own(names, kind)) throw new TypeError('未知图形 ' + kind + '。');
    assertDefinition(baseDefinition);
    let definition = baseDefinition;
    if (kind !== 'parabola') {
      const h = descriptor(baseDefinition.parameters.h, '左右位置 h');
      const k = descriptor(baseDefinition.parameters.k, '上下位置 k');
      let parameters;
      if (kind === 'line') {
        parameters = {
          m: { initial: 1, min: -4, max: 4, step: 0.1, label: '斜率 m' },
          b: descriptor(k, '截距 b')
        };
      } else if (kind === 'circle') {
        const maxRadius = Math.min(baseDefinition.domain.max - baseDefinition.domain.min,
          baseDefinition.range.max - baseDefinition.range.min);
        const step = Math.min(0.1, maxRadius / 10);
        parameters = {
          h: descriptor(h, '圆心横坐标 h'),
          k: descriptor(k, '圆心纵坐标 k'),
          r: { initial: Math.min(1, maxRadius), min: step, max: maxRadius, step, label: '半径 r' }
        };
      } else {
        parameters = {
          a: { initial: 1, min: -4, max: 4, step: 0.1, label: '振幅 a' },
          h, k
        };
      }
      definition = {
        ...baseDefinition,
        equationId: 'local.' + kind,
        parameters,
        dragParameter: kind === 'line' ? 'b' : kind === 'circle' ? 'r' : 'h',
        domain: { ...baseDefinition.domain },
        range: { ...baseDefinition.range },
        region: equalUnitRegion(baseDefinition)
      };
    }
    const figure = { kind, label: labels[kind], definition, parameters: {} };
    for (const name of names[kind]) {
      assertDescriptor(definition.parameters[name]);
      figure.parameters[name] = definition.parameters[name].initial;
    }
    assertFigure(figure);
    return figure;
  }

  /** 返回新对象；整组有任何未知、非有限系数时不应用其中任何一项。 */
  function updateParameters(figure, updates) {
    try {
      assertFigure(figure);
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new TypeError('系数修改必须是对象。');
      const parameters = { ...figure.parameters };
      const changes = {};
      for (const name in updates) {
        if (!own(updates, name) || !names[figure.kind].includes(name)) throw new TypeError('未知系数 ' + name + '。');
        if (!Number.isFinite(updates[name])) throw new TypeError('系数必须是有限数值。');
        const item = figure.definition.parameters[name];
        const value = clamp(updates[name], item.min, item.max);
        parameters[name] = value;
        changes[name] = { before: figure.parameters[name], after: value, requested: updates[name], clamped: value !== updates[name] };
      }
      const next = { ...figure, parameters };
      assertFigure(next);
      return { ok: true, figure: next, changes };
    } catch (error) {
      return { ok: false, figure, changes: {}, code: 'invalid_parameters', message: error.message };
    }
  }

  function resetFigure(figure) {
    assertFigure(figure);
    const parameters = Object.fromEntries(names[figure.kind].map((name) => [name, figure.definition.parameters[name].initial]));
    return { ...figure, parameters };
  }

  function contains(figure, point) {
    const { domain, range } = figure.definition;
    return point.x >= domain.min && point.x <= domain.max && point.y >= range.min && point.y <= range.max;
  }

  function readAt(figure, x) {
    try {
      assertFigure(figure);
      if (!Number.isFinite(x)) throw new TypeError('横坐标必须是有限数值。');
      let values;
      if (figure.kind === 'circle') {
        const { h, k, r } = figure.parameters;
        const ratio = (x - h) / r;
        if (!Number.isFinite(ratio)) throw new TypeError('圆的读数必须是有限数值。');
        if (Math.abs(ratio) > 1) values = [];
        else {
          const height = r * Math.sqrt((1 - ratio) * (1 + ratio));
          values = height === 0 ? [k] : [k + height, k - height];
        }
      } else values = [yAt(figure, x)];
      if (values.some((y) => !Number.isFinite(y))) throw new TypeError('读数必须是有限数值。');
      return { ok: true, x, values, visible: values.map((y) => contains(figure, { x, y })) };
    } catch (error) {
      return { ok: false, x, values: [], visible: [], code: 'invalid_read', message: error.message };
    }
  }

  function controlPoint(figure) {
    assertFigure(figure);
    const p = figure.parameters;
    if (figure.kind === 'line') return { x: 0, y: p.b };
    if (figure.kind === 'circle') return { x: p.h + p.r, y: p.k };
    return { x: p.h, y: p.k };
  }

  function sampleCount(samples) {
    return Math.max(2, Math.min(MAX_SAMPLES, Math.floor(Number.isFinite(samples) ? samples : 321)));
  }

  function uniqueSorted(values) {
    return values.sort((a, b) => a - b).filter((value, index, list) => index === 0 || value !== list[index - 1]);
  }

  // 添加真实的边界交点与极值，让稀疏采样也不会跨过窗口外的弧。
  function functionSamples(figure, count) {
    const { domain, range } = figure.definition;
    const p = figure.parameters;
    const xs = [];
    const add = (x) => { if (Number.isFinite(x) && x >= domain.min && x <= domain.max) xs.push(x); };
    for (let i = 0; i < count; i += 1) add(domain.min + (domain.max - domain.min) * (i / (count - 1)));
    if (figure.kind === 'parabola') {
      add(p.h);
      for (const bound of [range.min, range.max]) {
        const ratio = (bound - p.k) / p.a;
        if (ratio >= 0 && Number.isFinite(ratio)) {
          const delta = Math.sqrt(ratio);
          add(p.h - delta);
          add(p.h + delta);
        }
      }
    } else if (figure.kind === 'line' && p.m !== 0) {
      [range.min, range.max].forEach((bound) => add((bound - p.b) / p.m));
    } else if (figure.kind === 'sine' && p.a !== 0) {
      const periodic = (offset) => {
        const first = Math.ceil((domain.min - p.h - offset) / TAU);
        const last = Math.floor((domain.max - p.h - offset) / TAU);
        // 巨大但有限的平移会使 period + 1 === period。此时临界点也已失去
        // 整周期精度，只保留有界的均匀采样，避免周期枚举无法结束。
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > MAX_SAMPLES) return;
        for (let period = first; period <= last; period += 1) add(p.h + offset + period * TAU);
      };
      periodic(Math.PI / 2);
      periodic(-Math.PI / 2);
      for (const bound of [range.min, range.max]) {
        const ratio = (bound - p.k) / p.a;
        if (ratio >= -1 && ratio <= 1) {
          const angle = Math.asin(ratio);
          periodic(angle);
          periodic(Math.PI - angle);
        }
      }
    }
    return uniqueSorted(xs).map((x) => ({ x, y: yAt(figure, x) }));
  }

  function circleSamples(figure, count) {
    const { domain, range } = figure.definition;
    const p = figure.parameters;
    const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, TAU];
    const add = (angle) => angles.push((angle % TAU + TAU) % TAU);
    for (let i = 0; i < count; i += 1) angles.push(TAU * i / (count - 1));
    for (const x of [domain.min, domain.max]) {
      const ratio = (x - p.h) / p.r;
      if (ratio >= -1 && ratio <= 1) {
        const angle = Math.acos(ratio);
        add(angle);
        add(-angle);
      }
    }
    for (const y of [range.min, range.max]) {
      const ratio = (y - p.k) / p.r;
      if (ratio >= -1 && ratio <= 1) {
        const angle = Math.asin(ratio);
        add(angle);
        add(Math.PI - angle);
      }
    }
    return uniqueSorted(angles).map((angle) => ({ x: p.h + p.r * Math.cos(angle), y: p.k + p.r * Math.sin(angle) }));
  }

  /** Liang–Barsky 裁剪每一条线段。交点代替窗外部分，不逐点把 y 贴边。 */
  function clipSegment(a, b, definition) {
    const { domain, range } = definition;
    // 归一化只用于求交点比例，避免有限的窗外端点差值相减溢出。
    const scale = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y),
      Math.abs(domain.min), Math.abs(domain.max), Math.abs(range.min), Math.abs(range.max), 1);
    const ax = a.x / scale;
    const ay = a.y / scale;
    const dx = b.x / scale - ax;
    const dy = b.y / scale - ay;
    const cuts = [
      { p: -dx, q: ax - domain.min / scale, axis: 'x', bound: domain.min },
      { p: dx, q: domain.max / scale - ax, axis: 'x', bound: domain.max },
      { p: -dy, q: ay - range.min / scale, axis: 'y', bound: range.min },
      { p: dy, q: range.max / scale - ay, axis: 'y', bound: range.max }
    ];
    let enter = 0;
    let leave = 1;
    let entering = null;
    let leaving = null;
    for (const cut of cuts) {
      if (cut.p === 0) {
        if (cut.q < 0) return null;
        continue;
      }
      const ratio = cut.q / cut.p;
      if (cut.p < 0) {
        if (ratio > leave) return null;
        if (ratio > enter) { enter = ratio; entering = cut; }
      } else {
        if (ratio < enter) return null;
        if (ratio < leave) { leave = ratio; leaving = cut; }
      }
    }
    if (leave <= enter) return null;
    const at = (t, boundary) => {
      const point = t === 0 ? { ...a } : t === 1 ? { ...b } : {
        x: a.x * (1 - t) + b.x * t,
        y: a.y * (1 - t) + b.y * t
      };
      if (boundary) point[boundary.axis] = boundary.bound;
      return point;
    };
    return [at(enter, entering), at(leave, leaving)];
  }

  function visiblePolylines(figure, samples = 321) {
    assertFigure(figure);
    const points = figure.kind === 'circle' ? circleSamples(figure, sampleCount(samples)) : functionSamples(figure, sampleCount(samples));
    const lines = [];
    let current = null;
    const epsilonX = (figure.definition.domain.max - figure.definition.domain.min) * Number.EPSILON * 32;
    const epsilonY = (figure.definition.range.max - figure.definition.range.min) * Number.EPSILON * 32;
    const same = (a, b) => Math.abs(a.x - b.x) <= epsilonX && Math.abs(a.y - b.y) <= epsilonY;
    for (let i = 1; i < points.length; i += 1) {
      const clipped = clipSegment(points[i - 1], points[i], figure.definition);
      if (!clipped || same(clipped[0], clipped[1])) { current = null; continue; }
      if (!current || !same(current[current.length - 1], clipped[0])) {
        current = [clipped[0]];
        lines.push(current);
      }
      if (!same(current[current.length - 1], clipped[1])) current.push(clipped[1]);
      if (!contains(figure, points[i])) current = null;
    }
    // 参数圆在 0/2π 处相接；合并的是同一条可见弧，窗外的缺口仍各自断开。
    if (figure.kind === 'circle' && lines.length > 1 && same(lines[0][0], lines[lines.length - 1].at(-1))) {
      const last = lines.pop();
      lines[0] = last.concat(lines[0].slice(1));
    }
    return lines;
  }

  function formula(figure) {
    assertFigure(figure);
    const p = figure.parameters;
    if (figure.kind === 'line') return `y = ${p.m} × x + (${p.b})`;
    if (figure.kind === 'circle') return `(x − (${p.h}))² + (y − (${p.k}))² = ${p.r}²`;
    if (figure.kind === 'sine') return `y = ${p.a} × sin(x − (${p.h})) + (${p.k})`;
    return `y = ${p.a} × (x − (${p.h}))² + (${p.k})`;
  }

  return { createFigure, updateParameters, resetFigure, readAt, visiblePolylines, controlPoint, formula };
});
