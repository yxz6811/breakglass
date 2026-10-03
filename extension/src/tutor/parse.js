/**
 * 把一句中文问题收成意图：改哪个系数、改成几，读哪个 x、顶点或系数。
 * 只描述用户想做什么，不计算 y，也不决定实际采用的数。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.tutorParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const numbers = BreakGlass.tutorNumbers || (typeof require === 'function' ? require('./numbers') : null);
  const figures = BreakGlass.tutorFigures || (typeof require === 'function' ? require('./figures') : null);

  const MAX_LENGTH = 120;
  const MAX_READS = 6;
  const NUM = numbers.NUMBER_SOURCE;
  /** 坐标对 (x, y) 先换成占位符，免得逗号把它拆进两个分句。 */
  const PAIR_MARK = '\uE000';
  /** 已认出的系数说法在副本里用它占位，保持下标不变。 */
  const MASK = '\uE001';
  const SET_VERBS = [
    '设置为', '设置成', '调整为', '调整到', '取值为',
    '改成', '改为', '改到', '变成', '变为', '变到', '调到', '调成', '调为', '设为', '设成', '换成', '换为',
    '等于', '到', '成', '是', '为', '取', '=', ':'
  ];
  /**
   * 「一个更大的」「一下」「一点」里的一不是要改成的数；
   * 「0 个」「1 个单位」这种量词收在分句末尾或接「单位」时仍是数。
   */
  const NOT_A_VALUE = '(?!\\s*(?:个(?!\\s*(?:单位|$))|[些下种点]))';
  const SET_PATTERN = new RegExp('(?:' + SET_VERBS.join('|') + ')\\s*(' + NUM + ')' + NOT_A_VALUE, 'g');
  const DIRECT_PATTERN = new RegExp('^\\s*(' + NUM + ')' + NOT_A_VALUE);
  const RAISE_WORDS = ['增加', '加上', '增大', '提高', '升高', '上调', '调大', '加'];
  const LOWER_WORDS = ['减少', '减去', '减小', '降低', '下调', '调小', '减'];
  const DELTA_PATTERN = new RegExp('(' + RAISE_WORDS.concat(LOWER_WORDS).join('|') + ')\\s*(?:了\\s*)?(' + NUM + ')' + NOT_A_VALUE, 'g');
  /** 「向下平移 1 个单位」「向下平移 1 个」放行，「向下移一个点」「往上一点」不算。 */
  const SHIFT_PATTERN = new RegExp(
    '(?:(?:向|往|朝)\\s*(上|下|左|右)\\s*(?:平移|移动|移|挪)?|(上|下|左|右)\\s*(?:平移|移动|移|挪))' +
    '\\s*(?:了\\s*)?(' + NUM + ')' + NOT_A_VALUE,
    'g'
  );
  /** 改的说法后面跟着像数却读不成数的写法，例如 `1e2`、`1.2.3`。 */
  const BAD_VALUE_PATTERN = new RegExp('(?:' + SET_VERBS.concat(RAISE_WORDS, LOWER_WORDS).join('|') + ')\\s*(?:负|[-+])?\\s*\\.?\\d');
  /** 点了系数、说了改，却没写改成几。 */
  const MISSING_VALUE_PATTERN = new RegExp('(?:' + SET_VERBS.concat(RAISE_WORDS, LOWER_WORDS).join('|') + ')\\s*(?:一下|一点)?\\s*$');
  /** 分句里只剩一个数，例如「h 改成 1 和 2」里的「2」。 */
  const BARE_NUMBER_PATTERN = new RegExp('^\\s*(?:' + NUM + ')\\s*$');
  /**
   * 否定与是非问句：说了不要改，或在问要不要改。整句有修改时不执行。
   * 「能不能」「可不可以」是请求，不算否定。
   */
  const NEGATION_PATTERN = /不要|不用|不必|不想|不需要|无需|是不是|是否|别(?=把|动|改|变|调|移|让)|不(?=把|动|改|变|调|移)/;
  const DIRECTIONS = { 上: 'up', 下: 'down', 左: 'left', 右: 'right' };
  const READ_X_PATTERN = new RegExp('(?:^|[^a-z])(?:x|横坐标|自变量)\\s*(?:等于|取值为|取|为|是|=|:)\\s*(' + NUM + ')', 'g');
  const CALL_PATTERN = new RegExp('(?:^|[^a-z])(?:f|y)\\s*\\(\\s*(' + NUM + ')\\s*\\)', 'g');
  const PAIR_PATTERN = new RegExp('\\(\\s*(' + NUM + ')\\s*,\\s*(' + NUM + ')\\s*\\)', 'g');
  /** 坐标对的下标用私有区字符写，不能是数字，否则会被当成句子里的数。 */
  const PAIR_INDEX_BASE = 0xE100;
  const POINT_MOVE_VERBS = '(?:移动到|平移到|移到|移至|挪到|改成|改为|变成|变为|放到|放在|设为|在|是)';
  const PAIR_SLOT = PAIR_MARK + '[\\uE100-\\uE1FF]' + PAIR_MARK;
  /** @type {Map<string, RegExp>} */
  const pointMovePatterns = new Map();

  /**
   * 「顶点移到 (1, -1)」「圆心从 (0, 0) 移到 (1, -1)」「顶点是 (1, -1)」：
   * 关键点的叫法后面跟一个目标坐标对占位符，起点坐标只是说法的一部分。
   * @param {string} word
   * @returns {RegExp}
   */
  function pointMovePattern(word) {
    if (!pointMovePatterns.has(word)) {
      pointMovePatterns.set(word, new RegExp(
        word + '\\s*(?:从\\s*' + PAIR_SLOT + '\\s*)?' + POINT_MOVE_VERBS + '\\s*' + PAIR_MARK + '([\\uE100-\\uE1FF])' + PAIR_MARK
      ));
    }
    return pointMovePatterns.get(word);
  }
  const CLAUSE_SPLIT = /[,;。!、]|以及|并且|同时|然后|和/;
  const DELIMITER_PATTERN = /时候|时|的话/g;
  /** 「几何」里的几不是在问数。 */
  const QUERY_PATTERN = /多少|几(?!何)|什么|啥|\?|现在|当前|目前|呢/;

  /**
   * 收成统一写法：NFKC、统一减号、ASCII 小写、压缩空白，超长截断。
   * @param {unknown} text
   * @returns {string}
   */
  function normalize(text) {
    if (typeof text !== 'string') return '';
    const value = text.normalize('NFKC')
      .replace(/[−–—﹣]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(value).slice(0, MAX_LENGTH).join('');
  }

  /**
   * @param {string} char
   * @returns {boolean}
   */
  function isAsciiLetter(char) {
    return typeof char === 'string' && /^[a-z]$/.test(char);
  }

  /**
   * 从左到右找系数说法，每处取最长的一种。单个英文字母两侧不能紧挨其他字母。
   * @param {string} clause
   * @param {object} figure
   * @returns {{ name: string, start: number, end: number }[]}
   */
  function findMentions(clause, figure) {
    const mentions = [];
    let index = 0;
    while (index < clause.length) {
      let matched = null;
      for (const { alias, name } of figure.aliasList) {
        if (!clause.startsWith(alias, index)) continue;
        if (/^[a-z]+$/.test(alias) && (isAsciiLetter(clause[index - 1]) || isAsciiLetter(clause[index + alias.length]))) continue;
        matched = { name, start: index, end: index + alias.length };
        break;
      }
      if (matched) {
        mentions.push(matched);
        index = matched.end;
      } else {
        index += 1;
      }
    }
    return mentions;
  }

  /**
   * @param {string} clause
   * @param {{ start: number, end: number }[]} mentions
   * @returns {string}
   */
  function maskMentions(clause, mentions) {
    let masked = clause;
    for (const { start, end } of mentions) {
      masked = masked.slice(0, start) + MASK.repeat(end - start) + masked.slice(end);
    }
    return masked;
  }

  /**
   * 在副本上找全部匹配，返回数与它在分句里的起点。
   * @param {RegExp} pattern 带 g 标记
   * @param {string} text
   * @returns {{ value: number | null, start: number }[]}
   */
  function findNumbers(pattern, text) {
    const found = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      found.push({ value: numbers.parseNumber(match[1]), start: match.index });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return found;
  }

  /**
   * 前面只点了名、没说做什么的系数，跟着后面的问句一起读，例如「开口和顶点高度现在是多少」。
   * @param {{ bare: string[] }} context
   * @param {{ reads: object[] }} intent
   */
  function flushBare(context, intent) {
    context.bare.forEach((name) => intent.reads.push({ target: 'parameter', name }));
    context.bare = [];
  }

  /**
   * 一个系数说法后面那一段：改成几、增减多少，或在问它现在是几。
   * 同一段里给了几个数就全部记下，由 settle 判断是否冲突。
   * @param {string} name
   * @param {string} segment
   * @param {{ bare: string[] }} context
   * @param {{ sets: object[], reads: object[], problems: object[] }} intent
   */
  function parseSegment(name, segment, context, intent) {
    const assigned = findNumbers(SET_PATTERN, segment);
    const deltas = [];
    DELTA_PATTERN.lastIndex = 0;
    let delta;
    while ((delta = DELTA_PATTERN.exec(segment))) {
      deltas.push({ value: numbers.parseNumber(delta[2]), sign: RAISE_WORDS.includes(delta[1]) ? 1 : -1 });
    }
    if (assigned.some((item) => item.value === null) || deltas.some((item) => item.value === null)) {
      intent.problems.push({ kind: 'bad_value', name });
      return;
    }
    assigned.forEach((item) => intent.sets.push({ name, spoken: item.value }));
    deltas.forEach((item) => intent.sets.push({ name, delta: item.sign * item.value }));
    if (assigned.length || deltas.length) return;
    const direct = DIRECT_PATTERN.exec(segment);
    if (direct) {
      const value = numbers.parseNumber(direct[1]);
      if (value === null) intent.problems.push({ kind: 'bad_value', name });
      else intent.sets.push({ name, spoken: value });
      return;
    }
    if (QUERY_PATTERN.test(segment)) {
      flushBare(context, intent);
      intent.reads.push({ target: 'parameter', name });
      return;
    }
    if (BAD_VALUE_PATTERN.test(segment)) intent.problems.push({ kind: 'bad_value', name });
    else if (MISSING_VALUE_PATTERN.test(segment)) intent.problems.push({ kind: 'missing_value', name });
    else if (!segment.trim()) context.bare.push(name);
  }

  /**
   * 解析一个分句，结果直接写进 intent。
   * @param {string} clause
   * @param {object} figure
   * @param {{ sentence: string, pairs: Array<[number | null, number | null]>, bare: string[] }} context
   * @param {{ sets: object[], reads: object[], problems: object[] }} intent
   */
  function parseClause(clause, figure, context, intent) {
    const mentions = findMentions(clause, figure);
    const masked = maskMentions(clause, mentions);
    let targeted = mentions.length > 0;

    for (const [word, owner] of Object.entries(figures.FOREIGN_WORDS)) {
      if (owner !== figure.label && masked.includes(word)) {
        targeted = true;
        intent.problems.push({ kind: 'foreign', word, owner });
      }
    }

    const anchors = [];
    for (const pattern of [READ_X_PATTERN, CALL_PATTERN]) {
      for (const { value, start } of findNumbers(pattern, masked)) {
        anchors.push(start);
        targeted = true;
        if (value !== null) intent.reads.push({ target: 'x', x: value });
        else intent.problems.push({ kind: 'bad_value', name: null });
      }
    }

    const pointWord = figure.vertex && Array.isArray(figure.vertexParameters) ? figure.pointWord || '顶点' : null;
    const vertexAt = masked.indexOf('顶点');
    if (vertexAt >= 0 && pointWord !== '顶点') {
      anchors.push(vertexAt);
      targeted = true;
      intent.problems.push({ kind: 'no_vertex' });
    }
    const pointAt = pointWord ? masked.indexOf(pointWord) : -1;
    if (pointAt >= 0) {
      anchors.push(pointAt);
      targeted = true;
      const moved = pointMovePattern(pointWord).exec(masked);
      if (moved) {
        const pair = context.pairs[moved[1].charCodeAt(0) - PAIR_INDEX_BASE];
        figure.vertexParameters.forEach((name, index) => {
          if (pair && pair[index] !== null) intent.sets.push({ name, spoken: pair[index] });
        });
      } else {
        intent.reads.push({ target: 'vertex' });
      }
    }

    // 平移不截断系数后面那一段：「顶点高度往上 1 改成 -1」要看出同一系数给了两个数。
    SHIFT_PATTERN.lastIndex = 0;
    let shift;
    while ((shift = SHIFT_PATTERN.exec(masked))) {
      targeted = true;
      const amount = numbers.parseNumber(shift[3]);
      const rule = figure.shifts && figure.shifts[DIRECTIONS[shift[1] || shift[2]]];
      if (amount === null) intent.problems.push({ kind: 'bad_value', name: null });
      else if (!rule) intent.problems.push({ kind: 'no_shift' });
      else intent.sets.push({ name: rule.name, delta: rule.sign * amount });
    }

    DELIMITER_PATTERN.lastIndex = 0;
    let delimiter;
    while ((delimiter = DELIMITER_PATTERN.exec(masked))) anchors.push(delimiter.index);

    mentions.forEach((mention, index) => {
      const next = index + 1 < mentions.length ? mentions[index + 1].start : clause.length;
      const end = anchors.filter((at) => at >= mention.end && at < next).reduce((low, at) => Math.min(low, at), next);
      parseSegment(mention.name, clause.slice(mention.end, end), context, intent);
    });

    if (!targeted && (/\d/.test(masked) || findNumbers(SET_PATTERN, masked).length || BARE_NUMBER_PATTERN.test(masked))) {
      intent.problems.push({ kind: 'no_target' });
    }
  }

  /**
   * 同一系数给了两个不同的数时整句不执行；相同的数只保留一次。读数去重并限量。
   * @param {{ sets: object[], reads: object[], problems: object[] }} intent
   */
  function settle(intent) {
    const byName = new Map();
    for (const item of intent.sets) {
      const key = 'delta' in item ? 'delta:' + item.delta : 'value:' + item.spoken;
      const seen = byName.get(item.name);
      if (!seen) byName.set(item.name, { key, item });
      else if (seen.key !== key && !intent.problems.some((problem) => problem.kind === 'duplicate' && problem.name === item.name)) {
        intent.problems.push({ kind: 'duplicate', name: item.name });
      }
    }
    intent.sets = Array.from(byName.values()).map((entry) => entry.item);
    const seenReads = new Set();
    intent.reads = intent.reads.filter((read) => {
      const key = read.target + ':' + (read.target === 'x' ? read.x : (read.name || ''));
      if (seenReads.has(key)) return false;
      seenReads.add(key);
      return true;
    }).slice(0, MAX_READS);
  }

  /**
   * 解析一句问题。
   * @param {unknown} text
   * @param {object} figure 已登记的图形
   * @returns {{ text: string, sets: Array<{ name: string, spoken?: number, delta?: number }>, reads: object[], problems: object[] }}
   */
  function parse(text, figure) {
    const sentence = normalize(text);
    const intent = { text: sentence, sets: [], reads: [], problems: [] };
    if (!sentence) {
      intent.problems.push({ kind: 'empty' });
      return intent;
    }
    const pairs = [];
    const protectedText = sentence.replace(PAIR_PATTERN, (whole, first, second) => {
      if (pairs.length >= 0x100) return whole;
      pairs.push([numbers.parseNumber(first), numbers.parseNumber(second)]);
      return PAIR_MARK + String.fromCharCode(PAIR_INDEX_BASE + pairs.length - 1) + PAIR_MARK;
    });
    const context = { sentence, pairs, bare: [] };
    for (const clause of protectedText.split(CLAUSE_SPLIT)) {
      const trimmed = clause.trim();
      if (trimmed) parseClause(trimmed, figure, context, intent);
    }
    settle(intent);
    if (intent.sets.length || intent.reads.length) {
      intent.problems = intent.problems.map((problem) => (problem.kind === 'no_target' ? { kind: 'dangling' } : problem));
    }
    if (intent.sets.length && NEGATION_PATTERN.test(sentence)) intent.problems.unshift({ kind: 'negated' });
    if (!intent.problems.length && !intent.sets.length && !intent.reads.length && /\d/.test(sentence)) {
      intent.problems.push({ kind: 'no_target' });
    }
    return intent;
  }

  return { MAX_LENGTH, normalize, parse };
});
