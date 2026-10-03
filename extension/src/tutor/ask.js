/**
 * 一次提问：画面快照加一句话，得到要写回的系数、读数和回答。
 * 回答里的数只来自快照、实际采用的系数和已登记的求值；本模块不读 DOM、不改会话、不发请求。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.tutor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const numbers = BreakGlass.tutorNumbers || (typeof require === 'function' ? require('./numbers') : null);
  const figures = BreakGlass.tutorFigures || (typeof require === 'function' ? require('./figures') : null);
  const parser = BreakGlass.tutorParse || (typeof require === 'function' ? require('./parse') : null);

  const COUNT_WORDS = ['零', '一', '两', '三', '四'];

  /**
   * 从画面上的当前图形抄出提问需要的只读快照。图形来自 figureSession.getState()，
   * 系数值来自 figure.parameters，范围、步长与滑块叫法来自 figure.definition.parameters。
   * @param {{ kind?: string, parameters?: Record<string, number>, definition?: object } | null | undefined} figure
   * @param {{ requestId?: string | null, interactive?: boolean } | undefined} context 送出时的会话
   * @returns {{ requestId: string | null, kind: string | null, interactive: boolean, parameters: Record<string, { value: number, min: number, max: number, step: number, label: string | null }> | null, domain: { min: number, max: number } | null, range: { min: number, max: number } | null, figure: object | null }}
   */
  function snapshotFrom(figure, context) {
    const requestId = context && typeof context.requestId === 'string' && context.requestId ? context.requestId : null;
    const kind = figure && typeof figure.kind === 'string' ? figure.kind : null;
    const definition = figure && figure.definition;
    const current = figure && figure.parameters;
    if (!kind || !definition || !definition.parameters || !current || !definition.domain || !definition.range) {
      return { requestId, kind, interactive: false, parameters: null, domain: null, range: null, figure: null };
    }
    const parameters = {};
    let finite = true;
    for (const [name, item] of Object.entries(definition.parameters)) {
      const value = typeof current[name] === 'number' ? current[name] : Number.NaN;
      if (![value, item.min, item.max, item.step].every(Number.isFinite)) finite = false;
      parameters[name] = { value, min: item.min, max: item.max, step: item.step, label: typeof item.label === 'string' && item.label ? item.label : null };
    }
    return {
      requestId,
      kind,
      interactive: Boolean(context && context.interactive) && finite,
      parameters,
      domain: { min: definition.domain.min, max: definition.domain.max },
      range: { min: definition.range.min, max: definition.range.max },
      figure: JSON.parse(JSON.stringify(figure))
    };
  }

  /**
   * @param {object | null | undefined} snapshot
   * @returns {Record<string, number>}
   */
  function valuesOf(snapshot) {
    const values = {};
    if (!snapshot || !snapshot.parameters) return values;
    for (const [name, item] of Object.entries(snapshot.parameters)) values[name] = item.value;
    return values;
  }

  /**
   * 回答里用到的写法，系数与滑块共用 formatParameter。
   * @param {object} snapshot
   */
  function formatters(snapshot) {
    return {
      parameter: (name, value) => numbers.formatParameter(value, snapshot.parameters[name]),
      reading: (value) => numbers.formatReading(value)
    };
  }

  /**
   * 系数在回答里的叫法：画面给了滑块标签就用它，否则用登记里的叫法。两者都应与滑块逐字相同。
   * @param {object} snapshot
   * @param {object} figure
   * @param {string} name
   * @returns {string}
   */
  function labelOf(snapshot, figure, name) {
    const item = snapshot && snapshot.parameters ? snapshot.parameters[name] : null;
    return (item && item.label) || figure.names[name] || name;
  }

  /**
   * 系数叫法后面接中文时，以英文字母或数字结尾的叫法补一个空格，例如「顶点高度 k 从」。
   * @param {object} snapshot
   * @param {object} figure
   * @param {string} name
   * @returns {string}
   */
  function lead(snapshot, figure, name) {
    const label = labelOf(snapshot, figure, name);
    return /[a-z0-9]$/i.test(label) ? label + ' ' : label;
  }

  /**
   * 能改的系数清单，不含阿拉伯数字。
   * @param {object} snapshot
   * @param {object} figure
   * @returns {string}
   */
  function parameterList(snapshot, figure) {
    return Object.keys(snapshot.parameters).filter((name) => figure.aliases[name]).map((name) => labelOf(snapshot, figure, name)).join('、');
  }

  /**
   * @param {object} snapshot
   * @param {object} figure
   * @returns {string}
   */
  function helpText(snapshot, figure) {
    return '可以问：把某个系数改成几、某个 x 上的 y 是多少'
      + (figure.pointWord ? '、' + figure.pointWord + '在哪里' : '')
      + '。能改的系数：' + parameterList(snapshot, figure) + '。';
  }

  /**
   * @param {{ kind: string, word?: string, name?: string }} problem
   * @param {object} snapshot
   * @param {object} figure
   * @returns {string}
   */
  function explainProblem(problem, snapshot, figure) {
    if (problem.kind === 'empty') return '先写一句问题再送出。';
    if (problem.kind === 'foreign') return '当前是' + figure.label + '，没有' + problem.word + '。图像没有改。能改的系数：' + parameterList(snapshot, figure) + '。';
    if (problem.kind === 'duplicate') return '同一句里给' + lead(snapshot, figure, problem.name) + '说了两个不同的数，不知道用哪一个。图像没有改。';
    if (problem.kind === 'no_vertex') {
      return '当前的' + figure.label + '没有顶点。图像没有改。' + (figure.pointWord ? '可以问' + figure.pointWord + '在哪里。' : '');
    }
    if (problem.kind === 'no_shift') {
      return '当前的' + figure.label + '不能用这种说法平移。图像没有改。' + (figure.shiftHint || '');
    }
    if (problem.kind === 'negated') return '这句话说了不要改，或是在问要不要改，图像没有改。想改就直接说把某个系数改成几。';
    if (problem.kind === 'bad_value') {
      return (problem.name ? lead(snapshot, figure, problem.name) + '后面的数' : '这句话里的数')
        + '读不成一个确定的值，图像没有改。可以写成小数、分数或中文数字。';
    }
    if (problem.kind === 'missing_value') return lead(snapshot, figure, problem.name) + '没说要改成几或改多少，图像没有改。';
    if (problem.kind === 'dangling') return '这句话里有的数前面没说是哪个系数或哪个 x，不知道它要改什么。图像没有改。一个系数只说一个数，或分开问。';
    if (problem.kind === 'no_target') return '这句话里有数，但没说要改哪个系数，也没说是哪个 x。图像没有改。' + helpText(snapshot, figure);
    return '这句话没对上要改的系数或要读的点，图像没有改。' + helpText(snapshot, figure);
  }

  /**
   * @param {object} snapshot
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  function insideWindow(snapshot, x, y) {
    return x >= snapshot.domain.min && x <= snapshot.domain.max && y >= snapshot.range.min && y <= snapshot.range.max;
  }

  /**
   * 一个读数项：横坐标上的值、顶点或系数当前值。valuesAt 返回非有限值时抛错，由调用方整次放弃。
   * @param {object} read
   * @param {object} snapshot
   * @param {object} figure
   * @param {Record<string, number>} values 改完之后的系数
   * @returns {object}
   */
  function readOne(read, snapshot, figure, values) {
    if (read.target === 'parameter') {
      if (!Number.isFinite(values[read.name])) throw new TypeError('快照里没有这个系数。');
      return { target: 'parameter', name: read.name, value: values[read.name] };
    }
    let x;
    let ys;
    if (read.target === 'vertex') {
      const vertex = figure.vertex(values);
      x = vertex.x;
      ys = [vertex.y];
    } else {
      // 按回答里印出的 x 求值，代入式用印出的数重算会得到印出的 y。
      x = Number(numbers.formatReading(read.x));
      ys = figure.valuesAt(snapshot, values, x);
    }
    if (!Array.isArray(ys) || !Number.isFinite(x) || ys.some((y) => !Number.isFinite(y))) throw new TypeError('读数不是有限数值。');
    const xInside = x >= snapshot.domain.min && x <= snapshot.domain.max;
    return { target: read.target, x, values: ys.slice(), inside: ys.map((y) => insideWindow(snapshot, x, y)), xInside };
  }

  /**
   * 窗口外时写出窗口边界，说明画面上看不到。
   * @param {object} read
   * @param {object} snapshot
   * @returns {string}
   */
  function windowNote(read, snapshot) {
    const reading = numbers.formatReading;
    if (!read.xInside) {
      return '横坐标窗口是 ' + reading(snapshot.domain.min) + ' 到 ' + reading(snapshot.domain.max) + '，这个点在窗口外，画面上看不到';
    }
    if (read.values.length > 0 && read.inside.every(Boolean)) {
      return read.values.length === 1 ? '这个点在当前坐标窗口内' : '这些点都在当前坐标窗口内';
    }
    if (read.values.length === 0) return '';
    return '纵坐标窗口是 ' + reading(snapshot.range.min) + ' 到 ' + reading(snapshot.range.max)
      + '，' + (read.values.length === 1 ? '这个点' : '有的点') + '在窗口外，画面上看不到这一段';
  }

  /**
   * @param {object} read
   * @param {object} snapshot
   * @param {object} figure
   * @param {Record<string, number>} values
   * @returns {string}
   */
  function describeRead(read, snapshot, figure, values) {
    const format = formatters(snapshot);
    if (read.target === 'parameter') {
      return lead(snapshot, figure, read.name) + '现在是 ' + format.parameter(read.name, read.value);
    }
    if (read.target === 'vertex') {
      const [xName, yName] = figure.vertexParameters;
      return figure.pointWord + '是 (' + format.parameter(xName, read.x) + ', ' + format.parameter(yName, read.values[0]) + ')。' + windowNote(read, snapshot);
    }
    const xText = format.reading(read.x);
    if (read.values.length === 0) return 'x = ' + xText + ' 时，' + figure.label + '上没有点';
    let head;
    if (read.values.length === 1) {
      head = 'x = ' + xText + ' 时，' + (typeof figure.showWork === 'function'
        ? figure.showWork(values, read.x, read.values[0], format)
        : 'y = ' + format.reading(read.values[0]));
    } else {
      head = 'x = ' + xText + ' 时有' + (COUNT_WORDS[read.values.length] || '多') + '个 y：'
        + read.values.map((y) => 'y = ' + format.reading(y)).join(' 或 ');
    }
    const note = windowNote(read, snapshot);
    return note ? head + '。' + note : head;
  }

  /**
   * @param {object} adjustment
   * @param {object} snapshot
   * @param {object} figure
   * @returns {string}
   */
  function describeAdjustment(adjustment, snapshot, figure) {
    const { name, before, adopted, adjusted, clamped } = adjustment;
    const item = snapshot.parameters[name];
    const format = formatters(snapshot);
    const label = lead(snapshot, figure, name);
    const beforeText = format.parameter(name, before);
    const afterText = format.parameter(name, adopted);
    const rangeText = label + '的允许范围是 ' + format.parameter(name, item.min) + ' 到 ' + format.parameter(name, item.max);
    const bound = clamped === 'max' ? '上限' : '下限';
    // 步长格子不一定落在边界上：夹进范围后又按一格取值时，不能把这一格叫成上限或下限。
    const atBound = clamped && adopted === (clamped === 'max' ? item.max : item.min);
    const nearest = '按 ' + format.parameter(name, item.step) + ' 一格，离' + bound + '最近的一格是 ' + afterText;
    if (adopted === before) {
      if (atBound) return rangeText + '，已经在' + bound + ' ' + afterText + '，图像不变';
      if (clamped) return rangeText + '，' + nearest + '，图像不变';
      if (adjusted) return label + '只能按 ' + format.parameter(name, item.step) + ' 一格调整，仍是 ' + afterText + '，图像不变';
      return label + '已经是 ' + afterText + '，图像不变';
    }
    let sentence;
    if (atBound) sentence = rangeText + '，已从 ' + beforeText + ' 改为' + bound + ' ' + afterText;
    else if (clamped) sentence = rangeText + '，' + nearest + '，已从 ' + beforeText + ' 改为 ' + afterText;
    else if (adjusted) sentence = label + '只能按 ' + format.parameter(name, item.step) + ' 一格调整，已从 ' + beforeText + ' 改为 ' + afterText;
    else sentence = label + '从 ' + beforeText + ' 改为 ' + afterText;
    const change = typeof figure.describe === 'function'
      ? figure.describe(name, before, adopted, (amount) => format.parameter(name, amount))
      : '';
    return change ? sentence + '，' + change : sentence;
  }

  /**
   * 拼成一段回答。句子之间用句号，不出现重复标点。
   * @param {string[]} parts
   * @returns {string}
   */
  function joinSentences(parts) {
    return parts.filter(Boolean).map((part) => part.replace(/[。，\s]+$/, '')).join('。') + '。';
  }

  /**
   * 回答一句问题。
   * @param {ReturnType<typeof snapshotFrom> | null | undefined} snapshot
   * @param {unknown} text
   * @returns {{ requestId: string | null, kind: 'applied' | 'read' | 'unchanged' | 'unavailable', changed: boolean, parameters: Record<string, number>, adjustments: object[], reads: object[], reply: string }}
   */
  function ask(snapshot, text) {
    const current = valuesOf(snapshot);
    const base = {
      requestId: snapshot && snapshot.requestId ? snapshot.requestId : null,
      kind: 'unavailable',
      changed: false,
      parameters: current,
      adjustments: [],
      reads: []
    };
    if (!snapshot || !snapshot.interactive || !snapshot.parameters || !snapshot.domain || !snapshot.range) {
      return { ...base, reply: '先破壁，让曲线出现，再问这条曲线。' };
    }
    const figure = figures.get(snapshot.kind);
    if (!figure) return { ...base, reply: '当前图形还不能提问，图像没有改。' };

    const intent = parser.parse(text, figure);
    if (intent.problems.length) {
      return { ...base, kind: 'unchanged', reply: explainProblem(intent.problems[0], snapshot, figure) };
    }
    if (!intent.sets.length && !intent.reads.length) {
      return { ...base, kind: 'unchanged', reply: explainProblem({ kind: 'unknown' }, snapshot, figure) };
    }

    const next = { ...current };
    const adjustments = [];
    for (const set of intent.sets) {
      const item = snapshot.parameters[set.name];
      if (!item) {
        return { ...base, kind: 'unchanged', reply: '当前的' + figure.label + '没有' + lead(snapshot, figure, set.name).trim() + '。图像没有改。' };
      }
      const before = current[set.name];
      const spoken = typeof set.delta === 'number' ? before + set.delta : set.spoken;
      const adoption = numbers.adoptValue(item, spoken);
      if (!adoption) return { ...base, reply: '这次没算出来，图像没有改。可以再问一次。' };
      adjustments.push({ name: set.name, before, spoken, adopted: adoption.adopted, adjusted: adoption.adjusted, clamped: adoption.clamped });
      next[set.name] = adoption.adopted;
    }

    const changed = adjustments.some((item) => item.adopted !== item.before);
    let reads;
    let reply;
    // 读数和讲解任何一步出错都整次放弃，图像不改，也不把异常抛给页面。
    try {
      reads = intent.reads.map((read) => readOne(read, snapshot, figure, next));
      const parts = adjustments.map((item) => describeAdjustment(item, snapshot, figure));
      const vertexMoved = figure.vertex && Array.isArray(figure.vertexParameters)
        && adjustments.some((item) => item.adopted !== item.before && figure.vertexParameters.includes(item.name))
        && !reads.some((read) => read.target === 'vertex');
      if (vertexMoved) {
        const vertex = figure.vertex(next);
        const format = formatters(snapshot);
        const [xName, yName] = figure.vertexParameters;
        parts.push(figure.pointWord + '现在是 (' + format.parameter(xName, vertex.x) + ', ' + format.parameter(yName, vertex.y) + ')');
      }
      reads.forEach((read, index) => {
        const sentence = describeRead(read, snapshot, figure, next);
        parts.push(index === 0 && changed ? '改完以后，' + sentence : sentence);
      });
      reply = joinSentences(parts);
    } catch (error) {
      return { ...base, reply: '这次没算出来，图像没有改。可以再问一次。' };
    }

    return {
      requestId: base.requestId,
      kind: adjustments.length ? 'applied' : 'read',
      changed,
      parameters: changed ? next : current,
      adjustments,
      reads,
      reply
    };
  }

  return { snapshotFrom, ask };
});
