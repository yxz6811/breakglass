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
    sine: ['a', 'h', 'k'],
    ellipse: ['h', 'k', 'rx', 'ry'],
    hyperbola: ['h', 'k', 'a', 'b'],
    polygon: ['h', 'k', 'r', 'n', 'theta']
  };
  const labels = { parabola: '抛物线', line: '直线', circle: '圆', sine: '正弦', ellipse: '椭圆', hyperbola: '双曲线', polygon: '正多边形' };
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
    const positive = { circle: ['r'], ellipse: ['rx', 'ry'], hyperbola: ['a', 'b'], polygon: ['r'] }[figure.kind];
    if (positive && positive.some((name) => figure.definition.parameters[name].min <= 0)) {
      throw new TypeError('半径与半轴系数必须为正数。');
    }
    if (figure.kind === 'polygon' && (!Number.isInteger(figure.parameters.n) ||
        !['initial', 'min', 'max', 'step'].every((key) => Number.isInteger(figure.definition.parameters.n[key])))) {
      throw new TypeError('正多边形边数 n 必须是整数。');
    }
    assertFiniteFigure(figure);
  }

  function yAt(figure, x) {
    const p = figure.parameters;
    let y;
    if (figure.kind === 'parabola') y = p.a * (x - p.h) * (x - p.h) + p.k;
    else if (figure.kind === 'line') y = p.m * x + p.b;
    else if (figure.kind === 'sine') y = p.a * Math.sin(x - p.h) + p.k;
    else throw new TypeError('当前图形不能用单值函数求值。');
    if (!Number.isFinite(y)) throw new TypeError('图形求值结果必须是有限数值。');
    return y;
  }

  // 修改完成后仍需能在当前域上有限求值；不把溢出的结果送进 SVG。
  function assertFiniteFigure(figure) {
    const p = figure.parameters;
    const finite = (value) => {
      if (!Number.isFinite(value)) throw new TypeError('图形求值结果必须是有限数值。');
    };
    if (['circle', 'ellipse', 'polygon'].includes(figure.kind)) {
      const rx = figure.kind === 'ellipse' ? p.rx : p.r;
      const ry = figure.kind === 'ellipse' ? p.ry : p.r;
      [p.h - rx, p.h + rx, p.k - ry, p.k + ry].forEach(finite);
    } else if (figure.kind === 'hyperbola') {
      [p.h - p.a, p.h + p.a].forEach(finite);
      for (const x of [figure.definition.domain.min, figure.definition.domain.max]) {
        const height = hyperbolaHeight(figure, x);
        if (height !== null) [p.k - height, p.k + height].forEach(finite);
      }
      for (const y of [figure.definition.range.min, figure.definition.range.max]) {
        hyperbolaX(figure, y, -1);
        hyperbolaX(figure, y, 1);
      }
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

  function lengthDescriptor(initial, maximum, label) {
    const max = Math.min(8, maximum);
    const step = Math.min(0.1, max / 10);
    return { initial: Math.min(initial, max), min: step, max, step, label };
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
      } else if (kind === 'sine') {
        parameters = {
          a: { initial: 1, min: -4, max: 4, step: 0.1, label: '振幅 a' },
          h, k
        };
      } else if (kind === 'ellipse') {
        parameters = {
          h: descriptor(h, '中心横坐标 h'), k: descriptor(k, '中心纵坐标 k'),
          rx: lengthDescriptor(2, baseDefinition.domain.max - baseDefinition.domain.min, '水平半轴 rx'),
          ry: lengthDescriptor(1, baseDefinition.range.max - baseDefinition.range.min, '垂直半轴 ry')
        };
      } else if (kind === 'hyperbola') {
        parameters = {
          h: descriptor(h, '中心横坐标 h'), k: descriptor(k, '中心纵坐标 k'),
          a: lengthDescriptor(1, baseDefinition.domain.max - baseDefinition.domain.min, '水平半轴 a'),
          b: lengthDescriptor(1, baseDefinition.range.max - baseDefinition.range.min, '垂直系数 b')
        };
      } else {
        parameters = {
          h: descriptor(h, '中心横坐标 h'), k: descriptor(k, '中心纵坐标 k'),
          r: lengthDescriptor(2, Math.min(baseDefinition.domain.max - baseDefinition.domain.min,
            baseDefinition.range.max - baseDefinition.range.min), '外接圆半径 r'),
          n: { initial: 6, min: 3, max: 12, step: 1, label: '边数 n' },
          theta: { initial: 0, min: -180, max: 180, step: 1, label: '旋转角 θ（度）' }
        };
      }
      definition = {
        ...baseDefinition,
        equationId: 'local.' + kind,
        parameters,
        dragParameter: { line: 'b', circle: 'r', sine: 'h', ellipse: 'rx', hyperbola: 'a', polygon: 'r' }[kind],
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
        if (figure.kind === 'polygon' && name === 'n' && !Number.isInteger(updates[name])) {
          throw new TypeError('正多边形边数 n 必须是整数。');
        }
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

  function hyperbolaHeight(figure, x) {
    const { h, a, b } = figure.parameters;
    // 调用方常用 h ± a 构造顶点；相减再除可能把舍入误差放大成两个交点。
    if (x !== h && (x === h - a || x === h + a)) return 0;
    const ratio = Math.abs(x - h) / a;
    if (!Number.isFinite(ratio)) throw new TypeError('双曲线的读数必须是有限数值。');
    if (ratio < 1) return null;
    // 分开开方，避免 ratio² 在最终高度仍有限时先溢出。
    const height = b * Math.sqrt(ratio - 1) * Math.sqrt(ratio + 1);
    if (!Number.isFinite(height)) throw new TypeError('双曲线的读数必须是有限数值。');
    return height;
  }

  function hyperbolaX(figure, y, side) {
    const { h, k, a, b } = figure.parameters;
    const x = h + side * a * Math.hypot(1, (y - k) / b);
    if (!Number.isFinite(x)) throw new TypeError('双曲线的绘图坐标必须是有限数值。');
    return x;
  }

  function ovalPoint(p, angle, rx, ry) {
    let cosine = Math.cos(angle);
    let sine = Math.sin(angle);
    const epsilon = Number.EPSILON * 32;
    // 极值点使用精确的 0/±1，使仅触碰窗口的图形不会因三角误差出现微小边线。
    if (Math.abs(cosine) < epsilon) cosine = 0;
    if (Math.abs(sine) < epsilon) sine = 0;
    if (Math.abs(Math.abs(cosine) - 1) < epsilon) cosine = Math.sign(cosine);
    if (Math.abs(Math.abs(sine) - 1) < epsilon) sine = Math.sign(sine);
    return { x: p.h + rx * cosine, y: p.k + ry * sine };
  }

  function polygonPoints(figure) {
    const p = figure.parameters;
    const radians = p.theta * Math.PI / 180;
    const points = Array.from({ length: p.n }, (_, i) => ovalPoint(p, radians + TAU * i / p.n, p.r, p.r));
    points.push({ ...points[0] });
    return points;
  }

  function polygonRead(figure, x) {
    const points = polygonPoints(figure);
    const epsilon = Math.max(figure.parameters.r, 1) * Number.EPSILON * 128;
    const values = [];
    let interval = null;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (Math.abs(a.x - b.x) <= epsilon) {
        if (Math.abs(x - a.x) <= epsilon) {
          const min = Math.min(a.y, b.y);
          const max = Math.max(a.y, b.y);
          if (max - min > epsilon) {
            interval = interval ? { min: Math.min(interval.min, min), max: Math.max(interval.max, max) } : { min, max };
          } else values.push(min);
        }
        continue;
      }
      if (x < Math.min(a.x, b.x) - epsilon || x > Math.max(a.x, b.x) + epsilon) continue;
      const t = clamp((x - a.x) / (b.x - a.x), 0, 1);
      values.push(a.y * (1 - t) + b.y * t);
    }
    if (interval) {
      return { ok: false, x, values: [], visible: [], code: 'ambiguous_read', interval,
        message: `这条纵线与正多边形的竖直边重合，纵坐标是一段区间 [${interval.min}, ${interval.max}]。` };
    }
    const sorted = values.sort((a, b) => b - a).filter((y, i, list) => i === 0 || Math.abs(y - list[i - 1]) > epsilon);
    if (sorted.some((y) => !Number.isFinite(y))) throw new TypeError('读数必须是有限数值。');
    return { ok: true, x, values: sorted, visible: sorted.map((y) => contains(figure, { x, y })) };
  }

  function readAt(figure, x) {
    try {
      assertFigure(figure);
      if (!Number.isFinite(x)) throw new TypeError('横坐标必须是有限数值。');
      let values;
      if (figure.kind === 'circle' || figure.kind === 'ellipse') {
        const { h, k } = figure.parameters;
        const rx = figure.kind === 'circle' ? figure.parameters.r : figure.parameters.rx;
        const ry = figure.kind === 'circle' ? figure.parameters.r : figure.parameters.ry;
        const ratio = (x - h) / rx;
        if (!Number.isFinite(ratio)) throw new TypeError('图形的读数必须是有限数值。');
        if (figure.kind === 'ellipse' && x !== h && (x === h - rx || x === h + rx)) values = [k];
        else if (Math.abs(ratio) > 1) values = [];
        else {
          const height = ry * Math.sqrt((1 - ratio) * (1 + ratio));
          values = height === 0 ? [k] : [k + height, k - height];
        }
      } else if (figure.kind === 'hyperbola') {
        const height = hyperbolaHeight(figure, x);
        const k = figure.parameters.k;
        values = height === null ? [] : height === 0 ? [k] : [k + height, k - height];
      } else if (figure.kind === 'polygon') {
        return polygonRead(figure, x);
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
    if (figure.kind === 'circle' || figure.kind === 'polygon') return { x: p.h + p.r, y: p.k };
    if (figure.kind === 'ellipse') return { x: p.h + p.rx, y: p.k };
    if (figure.kind === 'hyperbola') return { x: p.h + p.a, y: p.k };
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

  function ovalSamples(figure, count) {
    const { domain, range } = figure.definition;
    const p = figure.parameters;
    const rx = figure.kind === 'circle' ? p.r : p.rx;
    const ry = figure.kind === 'circle' ? p.r : p.ry;
    const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, TAU];
    const add = (angle) => angles.push((angle % TAU + TAU) % TAU);
    for (let i = 0; i < count; i += 1) angles.push(TAU * i / (count - 1));
    for (const x of [domain.min, domain.max]) {
      const ratio = (x - p.h) / rx;
      if (ratio >= -1 && ratio <= 1) {
        const angle = Math.acos(ratio);
        add(angle);
        add(-angle);
      }
    }
    for (const y of [range.min, range.max]) {
      const ratio = (y - p.k) / ry;
      if (ratio >= -1 && ratio <= 1) {
        const angle = Math.asin(ratio);
        add(angle);
        add(Math.PI - angle);
      }
    }
    return uniqueSorted(angles).map((angle) => ovalPoint(p, angle, rx, ry));
  }

  function hyperbolaSamples(figure, count, side) {
    const { domain, range } = figure.definition;
    const p = figure.parameters;
    const ys = [];
    const add = (y) => { if (Number.isFinite(y) && y >= range.min && y <= range.max) ys.push(y); };
    for (let i = 0; i < count; i += 1) add(range.min + (range.max - range.min) * (i / (count - 1)));
    add(p.k);
    for (const x of [domain.min, domain.max]) {
      if ((x - p.h) * side < p.a) continue;
      const height = hyperbolaHeight(figure, x);
      if (height !== null) {
        add(p.k - height);
        add(p.k + height);
      }
    }
    return uniqueSorted(ys).map((y) => ({ x: hyperbolaX(figure, y, side), y }));
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
    const count = sampleCount(samples);
    const oval = figure.kind === 'circle' || figure.kind === 'ellipse';
    const closed = oval || figure.kind === 'polygon';
    const groups = figure.kind === 'hyperbola' ? [hyperbolaSamples(figure, count, -1), hyperbolaSamples(figure, count, 1)] :
      [oval ? ovalSamples(figure, count) : figure.kind === 'polygon' ? polygonPoints(figure) : functionSamples(figure, count)];
    const lines = [];
    const epsilonX = (figure.definition.domain.max - figure.definition.domain.min) * Number.EPSILON * 32;
    const epsilonY = (figure.definition.range.max - figure.definition.range.min) * Number.EPSILON * 32;
    const same = (a, b) => Math.abs(a.x - b.x) <= epsilonX && Math.abs(a.y - b.y) <= epsilonY;
    for (const points of groups) {
      let current = null;
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
    }
    // 闭合图形在首尾参数处相接；只合并同一可见弧，窗外缺口与双曲线分支仍断开。
    if (closed && lines.length > 1 && same(lines[0][0], lines[lines.length - 1].at(-1))) {
      const last = lines.pop();
      lines[0] = last.concat(lines[0].slice(1));
    }
    return lines;
  }

  function formula(figure) {
    assertFigure(figure);
    // 展示与页面读数保持 12 位有效数字；模型与 API 仍保留实际计算系数。
    const p = Object.fromEntries(Object.entries(figure.parameters).map(([name, value]) => [name, String(Number(value.toPrecision(12)))]));
    if (figure.kind === 'line') return `y = ${p.m} × x + (${p.b})`;
    if (figure.kind === 'circle') return `(x − (${p.h}))² + (y − (${p.k}))² = ${p.r}²`;
    if (figure.kind === 'ellipse') return `(x − (${p.h}))² / ${p.rx}² + (y − (${p.k}))² / ${p.ry}² = 1`;
    if (figure.kind === 'hyperbola') return `(x − (${p.h}))² / ${p.a}² − (y − (${p.k}))² / ${p.b}² = 1`;
    if (figure.kind === 'polygon') return `正 ${p.n} 边形：中心 (${p.h}, ${p.k})，外接圆半径 ${p.r}，旋转角 ${p.theta}°`;
    if (figure.kind === 'sine') return `y = ${p.a} × sin(x − (${p.h})) + (${p.k})`;
    return `y = ${p.a} × (x − (${p.h}))² + (${p.k})`;
  }

  return { createFigure, updateParameters, resetFigure, readAt, visiblePolylines, controlPoint, formula };
});
