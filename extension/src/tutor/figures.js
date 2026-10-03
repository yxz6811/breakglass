/**
 * 提问区认识的图形。每条登记写明系数的叫法、给定 x 的求值和变化说明；
 * 绘制、裁剪和滑块不在这里。现在只登记抛物线，新图形由图形侧补一条登记。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.tutorFigures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const evaluate = BreakGlass.evaluate || (typeof require === 'function' ? require('../curve/evaluate') : null);

  /**
   * 其他图形才有的系数说法。当前图形没有登记这些说法时，提问整句不改图。
   * @type {Record<string, string>}
   */
  const FOREIGN_WORDS = {
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

  const parabola = {
    equationId: 'fixture.parabola',
    label: '抛物线',
    names: { a: '开口宽窄 a', h: '水平位置 h', k: '顶点高度 k' },
    aliases: {
      a: ['开口宽窄', '开口大小', '二次项系数', '开口', 'a'],
      h: ['水平位置', '左右位置', '顶点横坐标', 'h'],
      k: ['顶点高度', '顶点纵坐标', '上下位置', '竖直位置', '高低', 'k']
    },
    /**
     * @param {object} snapshot
     * @param {{ a: number, h: number, k: number }} values
     * @param {number} x
     * @returns {number[]}
     */
    valuesAt(snapshot, values, x) {
      if (!evaluate) throw new Error('提问区需要 evaluate 模块。');
      return [evaluate.evaluateWithParameters({ equationId: 'fixture.parabola' }, { a: values.a, h: values.h, k: values.k }, x)];
    },
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
      const delta = after - before;
      if (name === 'a') {
        if (Math.sign(after) !== Math.sign(before)) return after > 0 ? '开口改为向上' : '开口改为向下';
        return Math.abs(after) > Math.abs(before) ? '开口变窄' : '开口变宽';
      }
      if (name === 'h') return '抛物线向' + (delta > 0 ? '右' : '左') + '平移 ' + formatDelta(Math.abs(delta));
      if (name === 'k') return '抛物线向' + (delta > 0 ? '上' : '下') + '平移 ' + formatDelta(Math.abs(delta));
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
    shifts: {
      up: { name: 'k', sign: 1 },
      down: { name: 'k', sign: -1 },
      left: { name: 'h', sign: -1 },
      right: { name: 'h', sign: 1 }
    }
  };

  /**
   * 登记一种图形。说法统一转小写，同一说法不得指向两个系数，同一 equationId 不得登记两次。
   * @param {object} entry
   * @returns {object} 冻结后的登记
   */
  function register(entry) {
    if (!entry || typeof entry.equationId !== 'string' || !entry.equationId) throw new TypeError('图形登记缺少 equationId。');
    if (entries.has(entry.equationId)) throw new Error('重复登记 ' + entry.equationId + '。');
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
    const frozen = Object.freeze({ ...entry, names: Object.freeze(names), aliasList: Object.freeze(aliasList) });
    entries.set(entry.equationId, frozen);
    return frozen;
  }

  /**
   * @param {unknown} equationId
   * @returns {object | null}
   */
  function get(equationId) {
    return typeof equationId === 'string' && entries.has(equationId) ? entries.get(equationId) : null;
  }

  /**
   * @returns {string[]}
   */
  function list() {
    return Array.from(entries.keys());
  }

  register(parabola);

  return { FOREIGN_WORDS, register, get, list };
});
