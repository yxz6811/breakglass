(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.mathLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const TEMPLATE_IDS = Object.freeze(['line', 'circle', 'sine', 'similar-triangles', 'cuboid']);
  const definitions = {
    line: { title: '直线与截距', defaults: { m: 2, b: 1 }, fields: [
      { key: 'm', label: '斜率 m', min: -20, max: 20 }, { key: 'b', label: '纵截距 b', min: -20, max: 20 }],
    question: '图像与纵轴交点的纵坐标是多少？', answerLabel: '纵轴交点的纵坐标',
    foundation: '纵轴上的点横坐标为0。把x=0代入y=mx+b，只留下b。m决定每向右走1时高度改变多少；水平直线也有截距。' },
    circle: { title: '圆的平移与面积', defaults: { h: 1, k: -1, r: 3 }, fields: [
      { key: 'h', label: '圆心横坐标 h', min: -20, max: 20 }, { key: 'k', label: '圆心纵坐标 k', min: -20, max: 20 },
      { key: 'r', label: '半径 r', min: 0.1, max: 20 }], question: '这个圆的面积是多少？请用数值表示，可用π≈3.141592653589793。',
    answerLabel: '圆面积（平方单位）', foundation: '圆心(h,k)决定位置，r决定大小。圆的方程是(x−h)²+(y−k)²=r²；面积是πr²。移动圆心只改变位置，不改变面积。' },
    sine: { title: '正弦函数与周期', defaults: { A: 2, omega: 1, phi: 0, k: 0 }, fields: [
      { key: 'A', label: '振幅 A', min: 0.1, max: 10 }, { key: 'omega', label: '角频率 ω', min: 0.1, max: 5 },
      { key: 'phi', label: '相位 φ（弧度）', min: -2 * Math.PI, max: 2 * Math.PI }, { key: 'k', label: '中线高度 k', min: -20, max: 20 }],
    question: 'y=A sin(ωx+φ)+k的最小正周期是多少？请用数值表示，角度使用弧度。', answerLabel: '最小正周期',
    foundation: 'sin在括号里的角度增加2π时重复一次。这里角度随x以ω倍速度增长，所以x只需增加2π/ω。A决定振幅，k决定中线，φ改变相位，它们不改变周期。' },
    'similar-triangles': { title: '相似三角形与面积比', defaults: { a: 3, b: 4, c: 5, scale: 2, unit: 'cm' }, fields: [
      { key: 'a', label: '原三角形 AB', min: 0.1, max: 100 }, { key: 'b', label: '原三角形 BC', min: 0.1, max: 100 },
      { key: 'c', label: '原三角形 CA', min: 0.1, max: 100 }, { key: 'scale', label: '新图与原图的边长比', min: 0.1, max: 10 }],
    question: '新三角形每条边都乘以scale，新图面积÷原图面积是多少？', answerLabel: '新图面积 / 原图面积',
    foundation: '相似时对应角相同、对应边同比例。底和高都乘以s，所以面积乘以s²；周长只乘以s。图中的大小是数学条件绘制的示意，不是从视频像素测出。' },
    cuboid: { title: '长方体与体积', defaults: { length: 4, width: 3, height: 2, unit: 'cm' }, fields: [
      { key: 'length', label: '长', min: 0.1, max: 100 }, { key: 'width', label: '宽', min: 0.1, max: 100 },
      { key: 'height', label: '高', min: 0.1, max: 100 }], question: '这个标准长方体的体积是多少？', answerLabel: '体积（立方单位）',
    foundation: '长方体的体积是底面积乘高，也就是长×宽×高。表面积把6个面的面积相加，单位是平方单位；体积使用立方单位。图像是固定投影，透视不会改变边长。' }
  };
  function exact(v, fields) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    const keys = Reflect.ownKeys(v);
    return keys.length === fields.length && fields.every((key) => {
      if (!own(v, key)) return false;
      const d = Object.getOwnPropertyDescriptor(v, key);
      return d && d.enumerable && own(d, 'value');
    });
  }
  const isExtended = (template) => TEMPLATE_IDS.includes(template);
  function validateSnapshot(template, value) {
    try {
      const d = definitions[template];
      if (!isExtended(template) || !d) return { ok: false, message: '不是已登记的手工数学模板。' };
      const keys = d.fields.map((f) => f.key).concat(['similar-triangles', 'cuboid'].includes(template) ? ['unit'] : []);
      if (!exact(value, keys) || d.fields.some((f) => !finite(value[f.key]) || value[f.key] < f.min || value[f.key] > f.max)) {
        return { ok: false, message: '手工数学条件必须为范围内的有限数字，且只包含规定字段。' };
      }
      if (keys.includes('unit') && !['cm', 'm', 'unit'].includes(value.unit)) return { ok: false, message: '单位只支持cm、m或unit。' };
      if (template === 'similar-triangles') {
        const { a, b, c } = value;
        // Keep the fixed coordinate construction clear of nearly degenerate triangles.
        if (Math.min(a + b - c, a + c - b, b + c - a) <= Math.max(a, b, c) * 1e-6) {
          return { ok: false, message: '三边必须满足严格三角不等式，不能退化或接近一条直线。' };
        }
      }
      return { ok: true, value: Object.fromEntries(keys.map((key) => [key, value[key]])) };
    } catch (_) { return { ok: false, message: '数学条件必须是纯数据。' }; }
  }
  function checked(template, snapshot) {
    const result = validateSnapshot(template, snapshot);
    if (!result.ok) throw new TypeError(result.message);
    return result.value;
  }
  function templateInfo(template) {
    if (!isExtended(template)) throw new TypeError('手工数学模板未登记。');
    return clone(definitions[template]);
  }
  function expectedAnswer(template, snapshot) {
    const s = checked(template, snapshot);
    if (template === 'line') return s.b;
    if (template === 'circle') return Math.PI * s.r * s.r;
    if (template === 'sine') return 2 * Math.PI / s.omega;
    if (template === 'similar-triangles') return s.scale * s.scale;
    return s.length * s.width * s.height;
  }
  function judge(template, snapshot, answer) {
    if (!isExtended(template) || !finite(answer)) return null;
    const s = validateSnapshot(template, snapshot);
    if (!s.ok) return null;
    const expected = expectedAnswer(template, s.value);
    return { expectedAnswer: expected, correct: Math.abs(answer - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6) };
  }
  function equation(template, snapshot) {
    const s = checked(template, snapshot);
    if (template === 'line') return `y=${s.m}x+(${s.b})`;
    if (template === 'circle') return `(x−(${s.h}))²+(y−(${s.k}))²=${s.r}²`;
    if (template === 'sine') return `y=${s.A}sin(${s.omega}x+(${s.phi}))+(${s.k})（弧度）`;
    if (template === 'similar-triangles') return `AB=${s.a}，BC=${s.b}，CA=${s.c} ${s.unit}；新边=原边×${s.scale}`;
    return `长=${s.length}，宽=${s.width}，高=${s.height} ${s.unit}；固定投影`;
  }
  function hints(template, snapshot) {
    const s = checked(template, snapshot);
    if (template === 'line') return ['纵轴上的点横坐标是什么？', '把x=0代入y=mx+b，比较哪些项还存在。', `y=(${s.m})×0+(${s.b})。计算这个表达式，不要把斜率当作截距。`];
    if (template === 'circle') return ['先区分圆心位置、半径和直径。', '圆面积=π×半径²；平移圆心不影响面积。', `代入π×(${s.r})²。先把半径平方，再乘π；单位是平方单位。`];
    if (template === 'sine') return ['想想sin括号里的角度增加多少会重复一次。', '角度要增加2π；设ω×周期=2π。', `周期=2π÷(${s.omega})。振幅、相位与中线不改变这道题的周期。`];
    if (template === 'similar-triangles') return ['长度变大时，底与高各变了几倍？', '面积=(底×高)/2，所以两个方向的比例要相乘。', `新图面积/原图面积=(${s.scale})×(${s.scale})。它不是周长比。`];
    return ['把长方体想成一层层相同的底面。', '先计算底面积，再乘高。', `体积=(${s.length})×(${s.width})×(${s.height})。不要套用表面积公式；单位是立方单位。`];
  }
  function prediction(template, snapshot) {
    const s = checked(template, snapshot); let next; let question; let correct; let explanation;
    if (template === 'line') { next = { ...s, b: s.b >= 19 ? s.b - 1 : s.b + 1 }; correct = next.b > s.b ? 'increase' : 'decrease';
      question = `斜率不变，b从${s.b}变成${next.b}，纵轴交点的高度怎样变？`; explanation = '纵轴交点的高度就是b；改变b会让直线整体上下平移。'; }
    if (template === 'circle') { next = { ...s, h: s.h >= 19 ? s.h - 1 : s.h + 1 }; correct = 'same';
      question = `半径不变，圆心横坐标从${s.h}变成${next.h}，面积怎样变？`; explanation = '圆只发生平移，半径不变，所以面积不变。'; }
    if (template === 'sine') { next = { ...s, omega: s.omega <= 2.5 ? s.omega * 2 : s.omega / 2 }; correct = next.omega > s.omega ? 'decrease' : 'increase';
      question = `ω从${s.omega}变成${next.omega}，周期怎样变？`; explanation = '周期=2π/ω。角频率增大，重复一次需要的横向距离缩短；角频率减小则相反。'; }
    if (template === 'similar-triangles') { next = { ...s, scale: s.scale <= 5 ? s.scale * 2 : s.scale / 2 }; correct = next.scale > s.scale ? 'increase' : 'decrease';
      question = `对应边比例从${s.scale}变成${next.scale}，面积比怎样变？`; explanation = '面积比等于对应边比例的平方，边比加倍时面积比变为原来的4倍。'; }
    if (template === 'cuboid') { next = { ...s, height: s.height <= 50 ? s.height * 2 : s.height / 2 }; correct = next.height > s.height ? 'increase' : 'decrease';
      question = `底面不变，高从${s.height}变成${next.height}，体积怎样变？`; explanation = '体积=底面积×高，底面积不变时体积与高同比例变化。'; }
    return { question, correct, explanation, snapshot: checked(template, next), options: [
      { value: 'increase', label: '增加' }, { value: 'decrease', label: '减少' }, { value: 'same', label: '不变' }] };
  }
  function variantSnapshot(template, snapshot, index) {
    const s = checked(template, snapshot);
    if (!Number.isSafeInteger(index) || index < 1 || index > 20) throw new RangeError('变式序号必须为1至20。');
    const stepped = (value, min, max) => min + ((value - min + index * (max - min) / 23) % (max - min));
    let result;
    if (template === 'line') result = { m: s.m, b: stepped(s.b, -20, 20) };
    if (template === 'circle') result = { ...s, r: stepped(s.r, 0.1, 20) };
    if (template === 'sine') result = { ...s, omega: stepped(s.omega, 0.1, 5) };
    if (template === 'similar-triangles') result = { ...s, scale: stepped(s.scale, 0.1, 10) };
    if (template === 'cuboid') result = { ...s, height: stepped(s.height, 0.1, 100) };
    return checked(template, result);
  }
  const graph = Object.freeze([
    { id: 'coordinate-vertex', title: '顶点坐标', template: 'parabola', prerequisites: [], foundation: '平方项为0时，顶点坐标是(h,k)。括号里写x−h，不要把负号照抄成横坐标。', snapshot: { a: 1, h: -2, k: 3 } },
    { id: 'square-distance', title: '直角边平方关系', template: 'right-triangle', prerequisites: [], foundation: '斜边对着直角。先将两条直角边平方相加，再取正平方根；不能直接相加边长。', snapshot: { AB: 3, AC: 4, unit: 'cm' } },
    { id: 'linear-intercept', title: '直线纵截距', template: 'line', prerequisites: ['coordinate-vertex'], snapshot: definitions.line.defaults },
    { id: 'circle-area', title: '圆半径与面积', template: 'circle', prerequisites: ['square-distance', 'coordinate-vertex'], snapshot: definitions.circle.defaults },
    { id: 'sine-period', title: '正弦周期', template: 'sine', prerequisites: ['linear-intercept'], snapshot: definitions.sine.defaults },
    { id: 'similar-area', title: '相似面积比', template: 'similar-triangles', prerequisites: ['square-distance'], snapshot: definitions['similar-triangles'].defaults },
    { id: 'solid-volume', title: '长方体体积', template: 'cuboid', prerequisites: [], snapshot: definitions.cuboid.defaults }
  ]);
  function learningGraph(data = {}) {
    const records = Array.isArray(data.records) ? data.records : []; const attempts = Array.isArray(data.attempts) ? data.attempts : [];
    return graph.map((item) => {
      const evidence = attempts.filter((attempt) => {
        const record = records.find((r) => r.id === attempt.recordId);
        if (!record || record.template !== item.template) return false;
        return validReceipt(record, attempt);
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const latest = evidence.at(-1);
      const diagnosticCount = evidence.filter((attempt) => {
        const record = records.find((r) => r.id === attempt.recordId);
        return record.source?.kind === 'manual-notes' && typeof record.source.id === 'string'
          && record.source.id.startsWith(`diagnostic-${item.id}-`);
      }).length;
      return { ...clone(item), foundation: item.foundation || definitions[item.template].foundation,
        state: !latest ? '待验证' : !latest.correct ? '需要复练' : latest.hintUsed ? '使用提示完成' : '最近一次独立正确',
        evidenceCount: evidence.length, diagnosticCount, practiceCount: evidence.length - diagnosticCount,
        lastAttemptAt: latest?.createdAt || null };
    });
  }
  function validReceipt(record, attempt) {
    if (!attempt || typeof attempt.hintUsed !== 'boolean' || typeof attempt.correct !== 'boolean'
      || typeof attempt.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attempt.createdAt)
      || !Number.isFinite(Date.parse(attempt.createdAt)) || new Date(attempt.createdAt).toISOString() !== attempt.createdAt) return false;
    let correct;
    if (record.source?.materialMode === 'permission-pending') return false;
    if (isExtended(record.template)) {
      if (record.origin !== 'manual' || record.source?.kind !== 'manual-notes') return false;
      correct = judge(record.template, record.snapshot, attempt.answer)?.correct;
    }
    else if (record.template === 'right-triangle') {
      const expected = Math.hypot(record.snapshot?.AB, record.snapshot?.AC);
      if (!exact(record.snapshot, ['AB', 'AC', 'unit']) || record.snapshot.AB <= 0 || record.snapshot.AC <= 0
        || !['unit', 'cm', 'm'].includes(record.snapshot.unit) || !finite(expected) || !finite(attempt.answer)) return false;
      correct = Math.abs(attempt.answer - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6);
    } else if (record.template === 'parabola') {
      if (!exact(record.snapshot, ['a', 'h', 'k']) || !Object.values(record.snapshot).every(finite) || record.snapshot.a === 0
        || ![-10, 10].every((x) => finite(record.snapshot.a * (x - record.snapshot.h) ** 2 + record.snapshot.k))
        || !exact(attempt.answer, ['h', 'k'])) return false;
      correct = finite(attempt.answer.h) && finite(attempt.answer.k)
      && Math.abs(attempt.answer.h - record.snapshot.h) <= 1e-9 && Math.abs(attempt.answer.k - record.snapshot.k) <= 1e-9;
    }
    return typeof correct === 'boolean' && correct === attempt.correct
      && attempt.outcome === (correct ? attempt.hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong');
  }
  function historyPlan(record, attempts = [], records = [record]) {
    const byId = new Map(records.filter((r) => r.template === record.template).map((r) => [r.id, r]));
    const evidence = attempts.filter((a) => byId.has(a.recordId) && validReceipt(byId.get(a.recordId), a))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let streak = 0;
    for (let i = evidence.length - 1; i >= 0 && evidence[i].correct && !evidence[i].hintUsed; i -= 1) streak += 1;
    const last = evidence.at(-1);
    return { independentStreak: streak, suggestedHintCount: streak >= 2 ? 1 : 3,
      days: !last ? null : !last.correct ? 1 : last.hintUsed ? 3 : Math.min(28, 7 * 2 ** Math.min(streak - 1, 2)),
      reason: !last ? '还没有实际作答，先验证这道题。' : !last.correct ? '最近一次答错，建议短间隔再练。'
        : last.hintUsed ? '最近一次借助提示，建议稍后独立再练。'
          : streak >= 2 ? '连续独立正确，默认减少提示，可主动展开完整提示。' : '最近一次独立正确，保留可选提示。' };
  }
  function sceneSVG(template, snapshot) {
    const s = checked(template, snapshot); const paths = []; const lines = [];
    const stroke = '#71ddff', alt = '#ffd08a';
    let all = []; let description = definitions[template].title;
    if (['line', 'circle', 'sine'].includes(template)) {
      let minX = -10, maxX = 10;
      if (template === 'circle') { minX = s.h - s.r * 1.3; maxX = s.h + s.r * 1.3; }
      if (template === 'sine') { minX = -2 * Math.PI / s.omega; maxX = 2 * Math.PI / s.omega; }
      const curve = [];
      for (let i = 0; i <= 240; i += 1) {
        if (template === 'circle') { const angle = i / 240 * Math.PI * 2; curve.push([s.h + s.r * Math.cos(angle), s.k + s.r * Math.sin(angle)]); }
        else { const x = minX + i / 240 * (maxX - minX); curve.push([x, template === 'line' ? s.m * x + s.b : s.A * Math.sin(s.omega * x + s.phi) + s.k]); }
      }
      all = [...curve]; paths.push({ points: curve, color: stroke });
      const ys = curve.map((p) => p[1]); const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
      paths.push({ points: [[minX, 0], [maxX, 0]], color: '#8799ab', width: 1 });
      paths.push({ points: [[0, lo], [0, hi]], color: '#8799ab', width: 1 });
      all.push([0, 0], [minX, lo], [maxX, hi]);
      if (template === 'circle') { paths.push({ points: [[s.h, s.k], [s.h + s.r, s.k]], color: alt }); all.push([s.h, s.k]); }
      if (template === 'sine') paths.push({ points: [[minX, s.k], [maxX, s.k]], color: alt, width: 1 });
    } else if (template === 'similar-triangles') {
      const x = (s.a * s.a + s.c * s.c - s.b * s.b) / (2 * s.a), y = Math.sqrt(Math.max(0, s.c * s.c - x * x));
      const p = [[0, 0], [s.a, 0], [x, y], [0, 0]];
      const shift = Math.max(s.a, x) + Math.max(s.a, s.c) * 0.25 - Math.min(0, x * s.scale);
      const q = p.map(([px, py]) => [px * s.scale + shift, py * s.scale]);
      all = [...p, ...q]; paths.push({ points: p, color: stroke }, { points: q, color: alt });
      description += '：对应三边严格同比例，图像按数学条件绘制';
    } else {
      const l = s.length, w = s.width, h = s.height;
      const v = [[0, 0], [l, 0], [l + w * 0.55, w * 0.4], [w * 0.55, w * 0.4],
        [0, h], [l, h], [l + w * 0.55, h + w * 0.4], [w * 0.55, h + w * 0.4]];
      all = v;
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        paths.push({ points: [v[a], v[b]], color: [2, 3].includes(a) ? '#8799ab' : stroke });
      }
      description += '：明确三维数学定义的固定平行投影';
    }
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
    const factor = Math.min(560 / Math.max(0.1, maxX - minX), 255 / Math.max(0.1, maxY - minY));
    const coords = ([x, y]) => `${(320 + (x - (minX + maxX) / 2) * factor).toFixed(3)},${(165 - (y - (minY + maxY) / 2) * factor).toFixed(3)}`;
    for (const p of paths) lines.push(`<path d="${p.points.map((v, i) => `${i ? 'L' : 'M'}${coords(v)}`).join(' ')}" stroke="${p.color}" stroke-width="${p.width || 2}" fill="none"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${description}">${lines.join('')}<text x="20" y="330" fill="#eef5ff" font-size="13">${equation(template, s)}</text></svg>`;
  }
  return { TEMPLATE_IDS, isExtended, validateSnapshot, templateInfo, expectedAnswer, judge, equation,
    hints, prediction, variantSnapshot, learningGraph, historyPlan, sceneSVG };
});
