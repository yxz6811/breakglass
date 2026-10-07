(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.pedagogy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const records = () => typeof require === 'function' ? require('./records') : root.BreakGlass.webRecords;
  const math = () => typeof require === 'function' ? require('./math-learning') : root.BreakGlass.mathLearning;
  const uuid = () => root.crypto.randomUUID();
  const utc = () => new Date().toISOString();
  function checked(input) {
    if (!records() || typeof records().validateRecord !== 'function') throw new Error('学习记录校验器未加载。');
    return records().validateRecord(input);
  }
  function newIdentity(original, id) {
    if (typeof id !== 'string' || id === original.id) throw new TypeError('新记录必须使用独立标识，不能覆盖原题。');
    return id;
  }
  function bounded(original, snapshot = original.snapshot) {
    if (!records().validSnapshot(original.template, snapshot)) throw new TypeError('变化后的数学条件无效。');
    if (math()?.isExtended(original.template)) return { ...snapshot };
    if (original.template === 'right-triangle') {
      const lengths = [snapshot.AB, snapshot.AC];
      if (lengths.some((value) => value < 1e-6 || value > 1e6)
        || Math.min(...lengths) / Math.max(...lengths) < 1e-6) {
        throw new RangeError('边长过于极端，无法生成适合当前教学场景的变化。');
      }
    } else if (Math.abs(snapshot.a) < 1e-6 || Math.abs(snapshot.a) > 1e6
      || Math.abs(snapshot.h) > 1e6 || Math.abs(snapshot.k) > 1e6) {
      throw new RangeError('抛物线参数过于极端，无法生成适合当前教学场景的变化。');
    }
    return { ...snapshot };
  }
  function hints(input) {
    const original = checked(input); const s = original.snapshot;
    if (math()?.isExtended(original.template)) return math().hints(original.template, s);
    if (original.template === 'right-triangle') return [
      '先找直角A。它对面的BC是斜边，想想斜边和两条直角边是什么关系。',
      '勾股关系比较的是平方：BC²=AB²+AC²。边长不能直接相加。',
      `代入已知条件：BC²=(${s.AB})²+(${s.AC})²。先算平方之和，再取正平方根。`
    ];
    return [
      '先想平方项什么时候为零，再看这时图像的高度。',
      '在y=a(x−h)²+k中，h影响左右位置，k影响上下位置，a影响开口。',
      `把平方项(x−(${s.h}))²设为零，再把对应x代回。注意括号里的符号，不能直接抄成顶点横坐标。`
    ];
  }
  function prediction(input) {
    const original = checked(input); const s = bounded(original);
    if (math()?.isExtended(original.template)) return math().prediction(original.template, s);
    if (original.template === 'right-triangle') {
      const snapshot = bounded(original, { ...s, AB: s.AB + 1 });
      if (!(snapshot.AB > s.AB) || !(Math.hypot(snapshot.AB, snapshot.AC) > Math.hypot(s.AB, s.AC))) {
        throw new RangeError('参数变化无法可靠比较，请使用较小的有限条件。');
      }
      return { question: `AC保持${s.AC}${s.unit}，AB从${s.AB}增加到${snapshot.AB}${s.unit}，BC会怎样变化？`,
        options: [{ value: 'increase', label: '增加' }, { value: 'decrease', label: '减少' }, { value: 'same', label: '不变' }],
        correct: 'increase', explanation: 'AC不变时，AB增大会使AB²+AC²增大；取正平方根后BC也增大。', snapshot };
    }
    const snapshot = bounded(original, { ...s, h: s.h + 1 });
    if (!(snapshot.h > s.h)) throw new RangeError('参数变化无法可靠比较，请使用较小的有限条件。');
    return { question: `a和k不变，h从${s.h}增加到${snapshot.h}，抛物线顶点向哪边移动？`,
      options: [{ value: 'left', label: '向左' }, { value: 'right', label: '向右' }, { value: 'same', label: '不动' }],
      correct: 'right', explanation: '顶点横坐标是h。h增加1时，整个图像和顶点向右移动1，顶点高度保持不变。', snapshot };
  }
  function createVariant(input, { id = uuid(), now = utc(), index = 1 } = {}) {
    const original = checked(input);
    newIdentity(original, id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new TypeError('程序变式需要新的UUID标识。');
    }
    if (!Number.isSafeInteger(index) || index < 1 || index > 20) throw new RangeError('本轮变式序号须为1至20的整数。');
    const s = bounded(original);
    const snapshot = bounded(original, math()?.isExtended(original.template)
      ? math().variantSnapshot(original.template, s, index)
      : original.template === 'right-triangle'
      ? { ...s, AB: s.AB * (1 + index / 4), AC: s.AC * (index % 2 === 0 ? 1 + index / 10 : 1) }
      : { a: index % 2 === 0 ? -s.a : s.a, h: s.h + index, k: s.k + (index % 2 === 0 ? -1 : 1) * (1 + index % 3) });
    if (JSON.stringify(snapshot) === JSON.stringify(s)) throw new RangeError('变化未形成独立新条件，未生成变式。');
    const sourceLabel = `程序生成，非AI；原记录:${original.id}`;
    if (sourceLabel.length > 120) throw new RangeError('原记录标识过长，无法在来源标签中完整追溯。');
    return checked({ id, kind: 'question', source: { kind: 'manual-notes', id: `variant-${id}`, version: '1',
      analysisVersion: '1', materialMode: 'self-authored', title: '程序生成变式' }, time: 0,
    title: math()?.isExtended(original.template) ? `程序变式：${math().templateInfo(original.template).title}`
      : original.template === 'right-triangle' ? '程序变式：直角三角形' : '程序变式：抛物线',
    note: '程序根据已保存数学条件生成了独立新题。请先独立作答；它不是原视频的新识别结果。',
    template: original.template, snapshot, origin: 'manual', sourceLabel, createdAt: now });
  }
  function createExplanation(input, { text, id = uuid(), now = utc() } = {}) {
    const original = checked(input); newIdentity(original, id);
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 1000) {
      throw new TypeError('请主动输入1至1000字的自我解释。');
    }
    return checked({ ...original, id, kind: 'question', title: '学生自我解释', note: text.trim(),
      sourceLabel: '学生解释（未自动评分）；沿用原数学来源', createdAt: now });
  }
  return { hints, prediction, createVariant, createExplanation };
});
