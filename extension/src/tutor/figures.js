/**
 * 提问区认识的图形。每条登记写明系数的叫法、给定 x 的求值和变化说明；
 * 绘制、裁剪和滑块不在这里。求值一律交给图形模型的 readAt，回答与画面用同一条公式。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.tutorFigures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const model = BreakGlass.figures || (typeof require === 'function' ? require('../geometry/figures') : null);

  /**
   * 其他图形才有的系数说法。当前图形没有登记这些说法时，提问整句不改图。
   * @type {Record<string, string>}
   */
  const FOREIGN_WORDS = {
    开口: '抛物线',
    半径: '圆', 直径: '圆', 圆心: '圆',
    斜率: '直线', 截距: '直线',
    振幅: '正弦', 周期: '正弦', 角频率: '正弦', 频率: '正弦', 相位: '正弦'
  };

  /** @type {Map<string, object>} */
  const entries = new Map();

  /**
   * 负数放进括号，免得「− -1」这种写法难读。
   * @param {string} text
   * @returns {string}
   */
  function wrapNegative(text) {
    return text.startsWith('-') ? '(' + text + ')' : text;
  }

  /**
   * 用图形模型在给定系数下求一个 x 上的全部 y。快照里带着画面上的那份图形定义。
   * @param {{ figure: object | null }} snapshot
   * @param {Record<string, number>} values
   * @param {number} x
   * @returns {number[]}
   */
  function modelValuesAt(snapshot, values, x) {
    if (!model || typeof model.readAt !== 'function') throw new Error('提问区需要图形模型。');
    if (!snapshot || !snapshot.figure) throw new TypeError('快照里没有图形。');
    const read = model.readAt({ ...snapshot.figure, parameters: { ...values } }, x);
    if (!read.ok) throw new TypeError(read.message || '读数失败。');
    return read.values;
  }

  /**
   * 平移说明：「抛物线向右平移 1.0」。
   * @param {string} subject
   * @param {number} delta
   * @param {'horizontal' | 'vertical'} axis
   * @param {(amount: number) => string} formatDelta
   * @returns {string}
   */
  function shiftText(subject, delta, axis, formatDelta) {
    const way = axis === 'horizontal' ? (delta > 0 ? '右' : '左') : (delta > 0 ? '上' : '下');
    return subject + '向' + way + '平移 ' + formatDelta(Math.abs(delta));
  }

  const FOUR_SHIFTS = {
    up: { name: 'k', sign: 1 },
    down: { name: 'k', sign: -1 },
    left: { name: 'h', sign: -1 },
    right: { name: 'h', sign: 1 }
  };

  const parabola = {
    kind: 'parabola',
    label: '抛物线',
    names: { a: '开口宽窄 a', h: '水平位置 h', k: '顶点高度 k' },
    aliases: {
      a: ['开口宽窄', '开口的宽窄', '开口大小', '开口的大小', '二次项系数', '开口', 'a'],
      h: ['水平位置', '左右位置', '顶点横坐标', '顶点的横坐标', 'h'],
      k: ['顶点高度', '顶点的高度', '顶点纵坐标', '顶点的纵坐标', '上下位置', '竖直位置', '高低', 'k']
    },
    examples: ['把顶点高度改成 -1', 'x 等于 1 时 y 是多少', '如果开口是 0.5，x 等于 2 时 y 是多少'],
    valuesAt: modelValuesAt,
    pointWord: '顶点',
    vertexParameters: ['h', 'k'],
    /**
     * @param {{ h: number, k: number }} values
     * @returns {{ x: number, y: number }}
     */
    vertex(values) {
      return { x: values.h, y: values.k };
    },
    /**
     * @param {string} name
     * @param {number} before
     * @param {number} after
     * @param {(amount: number) => string} formatDelta
     * @returns {string}
     */
    describe(name, before, after, formatDelta) {
      if (name === 'a') {
        if (after === 0) return '二次项消失，图像变成一条水平直线';
        if (Math.sign(after) !== Math.sign(before)) return after > 0 ? '开口改为向上' : '开口改为向下';
        return Math.abs(after) > Math.abs(before) ? '开口变窄' : '开口变宽';
      }
      if (name === 'h') return shiftText('抛物线', after - before, 'horizontal', formatDelta);
      if (name === 'k') return shiftText('抛物线', after - before, 'vertical', formatDelta);
      return '';
    },
    /**
     * 代入过程，系数用滑块上的写法，x 与 y 用读数写法。
     * @param {{ a: number, h: number, k: number }} values
     * @param {number} x
     * @param {number} y
     * @param {{ parameter: (name: string, value: number) => string, reading: (value: number) => string }} format
     * @returns {string}
     */
    showWork(values, x, y, format) {
      return 'y = ' + format.parameter('a', values.a)
        + ' × (' + format.reading(x) + ' − ' + wrapNegative(format.parameter('h', values.h)) + ')²'
        + ' + ' + wrapNegative(format.parameter('k', values.k))
        + ' = ' + format.reading(y);
    },
    shifts: FOUR_SHIFTS
  };

  const line = {
    kind: 'line',
    label: '直线',
    names: { m: '斜率 m', b: '截距 b' },
    aliases: {
      m: ['斜率', 'm'],
      b: ['纵截距', '截距', 'b']
    },
    examples: ['把斜率改成 2', '截距减小 1', 'x 等于 1 时 y 是多少'],
    valuesAt: modelValuesAt,
    /**
     * @param {string} name
     * @param {number} before
     * @param {number} after
     * @param {(amount: number) => string} formatDelta
     * @returns {string}
     */
    describe(name, before, after, formatDelta) {
      if (name === 'm') {
        if (after === 0) return '直线变成水平线';
        if (Math.sign(after) !== Math.sign(before)) return after > 0 ? '直线改为从左下往右上' : '直线改为从左上往右下';
        return Math.abs(after) > Math.abs(before) ? '直线变陡' : '直线变平缓';
      }
      if (name === 'b') return shiftText('直线', after - before, 'vertical', formatDelta);
      return '';
    },
    /**
     * @param {{ m: number, b: number }} values
     * @param {number} x
     * @param {number} y
     * @param {{ parameter: (name: string, value: number) => string, reading: (value: number) => string }} format
     * @returns {string}
     */
    showWork(values, x, y, format) {
      return 'y = ' + format.parameter('m', values.m) + ' × ' + wrapNegative(format.reading(x))
        + ' + ' + wrapNegative(format.parameter('b', values.b))
        + ' = ' + format.reading(y);
    },
    shifts: {
      up: { name: 'b', sign: 1 },
      down: { name: 'b', sign: -1 }
    },
    shiftHint: '直线左右平移要同时看斜率和截距，可以直接说截距改成几，或向上、向下平移几。'
  };

  const circle = {
    kind: 'circle',
    label: '圆',
    names: { h: '圆心横坐标 h', k: '圆心纵坐标 k', r: '半径 r' },
    aliases: {
      h: ['圆心横坐标', '圆心的横坐标', 'h'],
      k: ['圆心纵坐标', '圆心的纵坐标', 'k'],
      r: ['半径', 'r']
    },
    examples: ['把半径改成 2', '把圆心移到 (1, -1)', 'x 等于 0 时 y 是多少'],
    valuesAt: modelValuesAt,
    pointWord: '圆心',
    vertexParameters: ['h', 'k'],
    /**
     * @param {{ h: number, k: number }} values
     * @returns {{ x: number, y: number }}
     */
    vertex(values) {
      return { x: values.h, y: values.k };
    },
    /**
     * @param {string} name
     * @param {number} before
     * @param {number} after
     * @param {(amount: number) => string} formatDelta
     * @returns {string}
     */
    describe(name, before, after, formatDelta) {
      if (name === 'h') return shiftText('圆', after - before, 'horizontal', formatDelta);
      if (name === 'k') return shiftText('圆', after - before, 'vertical', formatDelta);
      if (name === 'r') return after > before ? '圆变大' : '圆变小';
      return '';
    },
    shifts: FOUR_SHIFTS
  };

  const sine = {
    kind: 'sine',
    label: '正弦',
    names: { a: '振幅 a', h: '左右位置 h', k: '上下位置 k' },
    aliases: {
      a: ['振幅', 'a'],
      h: ['左右位置', '水平位置', '相位', 'h'],
      k: ['上下位置', '竖直位置', 'k']
    },
    examples: ['把振幅改成 2', '向右平移 1', 'x 等于 1 时 y 是多少'],
    valuesAt: modelValuesAt,
    /**
     * @param {string} name
     * @param {number} before
     * @param {number} after
     * @param {(amount: number) => string} formatDelta
     * @returns {string}
     */
    describe(name, before, after, formatDelta) {
      if (name === 'a') {
        if (after === 0) return '图像变成一条水平线';
        if (before !== 0 && Math.sign(after) !== Math.sign(before)) return '图像上下翻转';
        return Math.abs(after) > Math.abs(before) ? '波峰波谷离中线更远' : '波峰波谷离中线更近';
      }
      if (name === 'h') return shiftText('图像', after - before, 'horizontal', formatDelta);
      if (name === 'k') return shiftText('图像', after - before, 'vertical', formatDelta);
      return '';
    },
    /**
     * 角度单位是弧度。
     * @param {{ a: number, h: number, k: number }} values
     * @param {number} x
     * @param {number} y
     * @param {{ parameter: (name: string, value: number) => string, reading: (value: number) => string }} format
     * @returns {string}
     */
    showWork(values, x, y, format) {
      return 'y = ' + format.parameter('a', values.a)
        + ' × sin(' + format.reading(x) + ' − ' + wrapNegative(format.parameter('h', values.h)) + ')'
        + ' + ' + wrapNegative(format.parameter('k', values.k))
        + ' = ' + format.reading(y);
    },
    shifts: FOUR_SHIFTS
  };

  /**
   * 登记一种图形。说法统一转小写，同一说法不得指向两个系数，同一 kind 不得登记两次。
   * @param {object} entry
   * @returns {object} 冻结后的登记
   */
  function register(entry) {
    if (!entry || typeof entry.kind !== 'string' || !entry.kind) throw new TypeError('图形登记缺少 kind。');
    if (entries.has(entry.kind)) throw new Error('重复登记 ' + entry.kind + '。');
    if (typeof entry.label !== 'string' || !entry.label) throw new TypeError('图形登记缺少 label。');
    if (typeof entry.valuesAt !== 'function') throw new TypeError('图形登记缺少 valuesAt。');
    if (!entry.aliases || typeof entry.aliases !== 'object') throw new TypeError('图形登记缺少 aliases。');
    const owners = new Map();
    const aliasList = [];
    for (const [name, list] of Object.entries(entry.aliases)) {
      if (!Array.isArray(list) || list.length === 0) throw new TypeError('系数 ' + name + ' 至少要有一种说法。');
      for (const raw of list) {
        if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('系数 ' + name + ' 的说法必须是非空字符串。');
        const alias = raw.trim().normalize('NFKC').toLowerCase();
        if (owners.has(alias) && owners.get(alias) !== name) throw new Error('说法「' + alias + '」同时指向 ' + owners.get(alias) + ' 和 ' + name + '。');
        owners.set(alias, name);
        aliasList.push({ alias, name });
      }
    }
    aliasList.sort((left, right) => right.alias.length - left.alias.length);
    const names = {};
    for (const name of Object.keys(entry.aliases)) names[name] = entry.names && entry.names[name] ? entry.names[name] : name;
    const frozen = Object.freeze({
      ...entry,
      pointWord: entry.vertex ? entry.pointWord || '顶点' : null,
      examples: Object.freeze(Array.isArray(entry.examples) ? entry.examples.slice() : []),
      names: Object.freeze(names),
      aliasList: Object.freeze(aliasList)
    });
    entries.set(entry.kind, frozen);
    return frozen;
  }

  /**
   * @param {unknown} kind
   * @returns {object | null}
   */
  function get(kind) {
    return typeof kind === 'string' && entries.has(kind) ? entries.get(kind) : null;
  }

  /**
   * @returns {string[]}
   */
  function list() {
    return Array.from(entries.keys());
  }

  [parabola, line, circle, sine].forEach(register);

  return { FOREIGN_WORDS, register, get, list };
});
