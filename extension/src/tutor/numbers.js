/**
 * 提问区的数：从一句话里读出数，按系数的步长与范围取实际采用的值，
 * 并提供滑块标签与回答共用的格式化，保证三处显示同一个数。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.tutorNumbers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 绝对值超过它的数不当作系数或横坐标，避免平方后溢出成无穷。 */
  const LIMIT = 1e6;
  const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const CN_INT = '[零〇一二两三四五六七八九十]+';
  const ARABIC = '\\d+(?:\\.\\d+)?';

  /**
   * 句子里一个数的写法。解析层用它找位置，`parseNumber` 负责换成数值。
   * @type {string}
   */
  const NUMBER_SOURCE = '(?:(?:负|[-+])\\s*)?(?:'
    + ARABIC + '\\s*\\/\\s*' + ARABIC
    + '|(?:\\d+|' + CN_INT + ')分之(?:\\d+|' + CN_INT + ')'
    + '|' + ARABIC
    + '|\\.\\d+'
    + '|' + CN_INT + '(?:点[零〇一二三四五六七八九]+)?'
    + ')';

  /**
   * 中文整数，只认零到九十九。「一二」这种逐位写法不算。
   * @param {string} text
   * @returns {number | null}
   */
  function chineseInteger(text) {
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text);
    const tens = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
    if (tens) return (tens[1] ? DIGITS[tens[1]] : 1) * 10 + (tens[2] ? DIGITS[tens[2]] : 0);
    if (text.length === 1 && Object.prototype.hasOwnProperty.call(DIGITS, text)) return DIGITS[text];
    return null;
  }

  /**
   * 中文小数，例如「一点五」。
   * @param {string} text
   * @returns {number | null}
   */
  function chineseNumber(text) {
    const match = /^([零〇一二两三四五六七八九十]+)(?:点([零〇一二三四五六七八九]+))?$/.exec(text);
    if (!match) return null;
    const whole = chineseInteger(match[1]);
    if (whole === null) return null;
    if (!match[2]) return whole;
    const fraction = Array.from(match[2]).map((char) => DIGITS[char]).join('');
    return Number(whole + '.' + fraction);
  }

  /**
   * 把一个数的写法换成有限数值。认 `-1`、`0.5`、`.5`、`1/2`、「负一点五」「二分之一」。
   * @param {unknown} token
   * @returns {number | null} 写法不对、分母为 0、非有限或绝对值过大时为 null
   */
  function parseNumber(token) {
    if (typeof token !== 'string') return null;
    let text = token.normalize('NFKC').replace(/\s+/g, '').replace(/[−–—﹣]/g, '-');
    let sign = 1;
    if (text.startsWith('负') || text.startsWith('-')) {
      sign = -1;
      text = text.slice(1);
    } else if (text.startsWith('+') || text.startsWith('正')) {
      text = text.slice(1);
    }
    if (!text) return null;
    let value = null;
    const slash = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(text);
    const over = /^(.+)分之(.+)$/.exec(text);
    if (slash) {
      const denominator = Number(slash[2]);
      value = denominator === 0 ? null : Number(slash[1]) / denominator;
    } else if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
      value = Number(text);
    } else if (over) {
      const denominator = chineseInteger(over[1]);
      const numerator = chineseInteger(over[2]);
      value = denominator && numerator !== null ? numerator / denominator : null;
    } else {
      value = chineseNumber(text);
    }
    if (value === null || !Number.isFinite(value)) return null;
    const result = sign * value;
    if (Math.abs(result) > LIMIT) return null;
    return result === 0 ? 0 : result;
  }

  /**
   * 一个有限数在十进制下的小数位数，兼容 `1e-7` 这样的写法。
   * @param {number} value
   * @returns {number}
   */
  function decimalsOf(value) {
    if (!Number.isFinite(value)) return 0;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(String(Math.abs(value)));
    if (!match) return 0;
    const fraction = match[2] ? match[2].length : 0;
    const exponent = match[3] ? Number(match[3]) : 0;
    return Math.max(0, fraction - exponent);
  }

  /**
   * @param {number} value
   * @param {number} places
   * @returns {number}
   */
  function roundTo(value, places) {
    const rounded = Number(value.toFixed(Math.min(20, Math.max(0, places))));
    return rounded === 0 ? 0 : rounded;
  }

  /**
   * 用户说出的数在这个系数上实际能用的值：先夹进范围，再以 `min` 为起点按 `step` 取最近一格，
   * 与相邻两格等距时取更靠近 0 的一格，仍等距取较大的一格；最后去掉浮点尾数并再夹一次。
   * @param {{ min: number, max: number, step?: number }} item
   * @param {number} spoken
   * @returns {{ adopted: number, adjusted: boolean, clamped: 'min' | 'max' | null } | null}
   */
  function adoptValue(item, spoken) {
    if (!item || !Number.isFinite(spoken) || !Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min > item.max) {
      return null;
    }
    const clamped = spoken > item.max ? 'max' : (spoken < item.min ? 'min' : null);
    let value = Math.min(item.max, Math.max(item.min, spoken));
    const step = Number.isFinite(item.step) && item.step > 0 ? item.step : 0;
    if (step > 0) {
      const places = Math.min(12, Math.max(decimalsOf(step), decimalsOf(item.min)));
      const offset = (value - item.min) / step;
      const low = roundTo(item.min + Math.floor(offset) * step, places);
      const high = roundTo(item.min + Math.ceil(offset) * step, places);
      const toLow = Math.abs(value - low);
      const toHigh = Math.abs(high - value);
      if (Math.abs(toLow - toHigh) > step * 1e-6) value = toLow < toHigh ? low : high;
      else if (Math.abs(low) !== Math.abs(high)) value = Math.abs(low) < Math.abs(high) ? low : high;
      else value = Math.max(low, high);
      value = Math.min(item.max, Math.max(item.min, value));
    }
    const adopted = value === 0 ? 0 : value;
    const adjusted = Math.abs(adopted - spoken) > 1e-12 * Math.max(1, Math.abs(spoken));
    return { adopted, adjusted, clamped };
  }

  /**
   * 滑块标签与回答共用的系数写法：按步长保留小数，带浮点尾数时退回 12 位有效数字。
   * @param {number} value
   * @param {{ step?: number } | undefined} item 该系数的范围定义，可缺省
   * @returns {string}
   */
  function formatParameter(value, item) {
    const precision = item && item.step > 0 ? Math.min(12, Math.max(1, -Math.floor(Math.log10(item.step)))) : 1;
    const rounded = Number(value.toFixed(precision));
    const tolerance = Math.max(Number.EPSILON * Math.max(Math.abs(value), Math.abs(rounded)) * 32, item ? item.step * 1e-9 : 0);
    return (rounded !== 0 || value === 0) && Math.abs(rounded - value) <= tolerance
      ? value.toFixed(precision) : String(Number(value.toPrecision(12)));
  }

  /**
   * 读数与横坐标的写法：最多 4 位小数，去掉尾零，-0 写作 0。
   * @param {number} value
   * @returns {string}
   */
  function formatReading(value) {
    if (!Number.isFinite(value)) return '';
    const rounded = Number(value.toFixed(4));
    return String(rounded === 0 ? 0 : rounded);
  }

  return { LIMIT, NUMBER_SOURCE, parseNumber, decimalsOf, roundTo, adoptValue, formatParameter, formatReading };
});
