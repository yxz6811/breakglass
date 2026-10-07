(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.learningFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const SCHEMA_VERSION = '1';
  const PURPOSES = Object.freeze(['practice', 'reflection', 'unclassified']);
  const STAGES = Object.freeze(['completion', 'practice', 'delayed']);
  const MODES = Object.freeze(['due', 'manual', 'foundation', 'interleaved']);
  const KINDS = Object.freeze(['parabola-completion', 'parabola-equation', 'parabola-vertex',
    'triangle-completion', 'triangle-applicability', 'triangle-scaling', 'triangle-hypotenuse']);
  const LESSONS = Object.freeze(['parabola-translation', 'triangle-conditions']);
  const records = () => typeof require === 'function' ? require('./records') : root.BreakGlass.webRecords;
  const math = () => typeof require === 'function' ? require('./math-learning') : root.BreakGlass.mathLearning;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const utc = () => new Date().toISOString();
  const uuid = () => root.crypto.randomUUID();
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min && value < Number.MAX_SAFE_INTEGER;
  const safeId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !/^(?:https?|data|blob|file|chrome-extension):/i.test(value);
  const iso = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
    const actual = Reflect.ownKeys(value);
    return actual.length === keys.length && keys.every((key) => own(value, key)) && actual.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.includes(key) && descriptor.enumerable && own(descriptor, 'value');
    });
  }
  function checkedRecord(record) {
    if (!exact(record, ['id', 'kind', 'source', 'time', 'title', 'note', 'template', 'snapshot', 'origin', 'sourceLabel', 'createdAt'])) {
      throw new TypeError('原数学记录必须是严格纯数据，不能增加学习字段。');
    }
    return records().validateRecord(record);
  }
  function emptyFlow() {
    return { schemaVersion: SCHEMA_VERSION, purposes: [], exercises: [], contexts: [], receipts: [], reviews: [] };
  }
  function validatePurpose(value) {
    if (!exact(value, ['schemaVersion', 'recordId', 'purpose', 'revision', 'updatedAt'])
      || value.schemaVersion !== SCHEMA_VERSION || !safeId(value.recordId) || !PURPOSES.includes(value.purpose)
      || !integer(value.revision, 1) || !iso(value.updatedAt)) throw new TypeError('学习用途字段、修订或UTC时间无效。');
    return clone(value);
  }
  function createPurpose(recordId, purpose, { revision = 1, updatedAt = utc() } = {}) {
    return validatePurpose({ schemaVersion: SCHEMA_VERSION, recordId, purpose, revision, updatedAt });
  }
  function purposeOf(recordId, purposes = []) {
    if (!safeId(recordId) || !Array.isArray(purposes)) throw new TypeError('用途查询身份或列表无效。');
    const matches = purposes.filter((item) => item && item.recordId === recordId);
    if (matches.length > 1) throw new TypeError('同一记录不能有重复学习用途。');
    return matches.length ? validatePurpose(matches[0]).purpose : 'unclassified';
  }
  function validateReview(value) {
    if (!exact(value, ['recordId', 'reviewAt', 'skippedUntil', 'revision', 'updatedAt']) || !safeId(value.recordId)
      || !integer(value.revision, 1) || !iso(value.updatedAt)
      || !(value.reviewAt === null || iso(value.reviewAt)) || !(value.skippedUntil === null || iso(value.skippedUntil))) {
      throw new TypeError('复习时间、修订或字段无效。');
    }
    return clone(value);
  }
  function lessonId(record) {
    if (record.template === 'parabola') return 'parabola-translation';
    if (record.template === 'right-triangle') return 'triangle-conditions';
    throw new TypeError('本轮微课只支持抛物线平移和直角条件。');
  }
  function bounded(record) {
    const s = record.snapshot;
    if (record.template === 'parabola') {
      if (Math.abs(s.a) < 1e-6 || Math.abs(s.a) > 1e6 || Math.abs(s.h) > 1e6 || Math.abs(s.k) > 1e6) {
        throw new RangeError('参数过于极端，请先使用适合微课的有限数学条件。');
      }
    } else if (Math.min(s.AB, s.AC) < 1e-6 || Math.max(s.AB, s.AC) > 1e6
      || Math.min(s.AB, s.AC) / Math.max(s.AB, s.AC) < 1e-6) {
      throw new RangeError('边长过于极端，请先使用适合微课的有限数学条件。');
    }
    return clone(s);
  }
  function validateExercise(value, original) {
    const record = checkedRecord(original);
    if (!exact(value, ['schemaVersion', 'id', 'recordId', 'lessonId', 'kind', 'stage', 'index', 'createdAt'])
      || value.schemaVersion !== SCHEMA_VERSION || !safeId(value.id) || value.id === record.id
      || value.recordId !== record.id || value.lessonId !== lessonId(record) || !KINDS.includes(value.kind)
      || !STAGES.includes(value.stage) || !Number.isInteger(value.index) || value.index < 1 || value.index > 20
      || !iso(value.createdAt)) throw new TypeError('练习身份、来源、版本或有限题型无效。');
    if (value.kind.startsWith('parabola-') !== (record.template === 'parabola')
      || value.kind.endsWith('-completion') !== (value.stage === 'completion')) {
      throw new TypeError('练习阶段或微课题型不对应。');
    }
    bounded(record);
    return clone(value);
  }
  function createExercise(original, { id = uuid(), kind, stage = 'practice', index = 1, createdAt = utc() } = {}) {
    const record = checkedRecord(original);
    return validateExercise({ schemaVersion: SCHEMA_VERSION, id, recordId: record.id, lessonId: lessonId(record),
      kind, stage, index, createdAt }, record);
  }
  function equation(s) { return `y=${s.a}(x−(${s.h}))²+(${s.k})`; }
  function lessonFor(original) {
    const record = checkedRecord(original); const id = lessonId(record); const s = bounded(record);
    if (record.template === 'parabola') return {
      id, title: '从公式看平移与顶点', sourceLabel: '程序编写完整示范；沿用已核对的数学条件',
      steps: [{ title: '辨认标准形式', text: `${equation(s)}对应y=a(x−h)²+k，a=${s.a}，h=${s.h}，k=${s.k}。` },
        { title: '让平方项为零', text: `x−(${s.h})=0，所以x=${s.h}。` },
        { title: '确定高度与坐标', text: `代回后y=${s.k}，顶点是(${s.h},${s.k})。a改变开口，不改变这个顶点。` },
        { title: '对照水平平移', text: `保持a、k，令h增加2，顶点向右移2到(${s.h + 2},${s.k})，公式变为${equation({ ...s, h: s.h + 2 })}。` }],
      explanation: '括号中是x−h。先解平方项为零，再读出横坐标；不能直接照抄括号里的负号。',
      completionKind: 'parabola-completion', practiceKinds: ['parabola-equation', 'parabola-vertex'],
      delayedKinds: ['parabola-equation', 'parabola-vertex']
    };
    const squared = s.AB * s.AB + s.AC * s.AC;
    const changed = Math.hypot(2 * s.AB, s.AC);
    return {
      id, title: '直角条件与相似缩放', sourceLabel: '程序编写完整示范；沿用已核对的数学条件',
      steps: [{ title: '先检查适用条件', text: `已确认∠A=90°，AB=${s.AB}${s.unit}、AC=${s.AC}${s.unit}是直角边，BC是斜边。` },
        { title: '建立平方关系', text: `BC²=AB²+AC²=(${s.AB})²+(${s.AC})²=${squared}。` },
        { title: '取正平方根', text: `长度为正，所以BC=√${squared}≈${Math.hypot(s.AB, s.AC).toFixed(6)}${s.unit}。` },
        { title: '对照单边与整体变化', text: `只将AB翻倍，AC不变，BC≈${changed.toFixed(6)}${s.unit}，不会翻倍；两条直角边都翻倍并保持直角时，斜边才翻倍。` }],
      explanation: '两条边的长度不能直接相加。未给直角时不能只凭两边套用勾股式；仅改变一边也不能当作整体相似放大。',
      completionKind: 'triangle-completion', practiceKinds: ['triangle-applicability', 'triangle-scaling', 'triangle-hypotenuse'],
      delayedKinds: ['triangle-applicability', 'triangle-scaling', 'triangle-hypotenuse']
    };
  }
  function exerciseView(input, original) {
    const record = checkedRecord(original); const exercise = validateExercise(input, record); const s = bounded(record);
    const delayed = exercise.stage === 'delayed'; const n = exercise.index;
    const common = { stage: exercise.stage, sourceLabel: '程序编写练习，非原视频识别；来源为已保存数学条件', options: [] };
    if (record.template === 'parabola') {
      const p = { a: s.a, h: s.h + (delayed ? -n : n), k: s.k + (delayed ? n : -n) };
      if (exercise.kind === 'parabola-completion') return { ...common, title: '补一个步骤：平方项为零',
        prompt: `完整示范后试一步：${equation(p)}，令平方项为零时x是多少？`, input: { type: 'number' }, answer: p.h,
        hints: ['寻找平方项什么时候为零。', '令括号里的x−h=0。', `解x−(${p.h})=0。`],
        explanation: `x=${p.h}。这是关键步骤练习，尚不是独立完整解题。` };
      if (exercise.kind === 'parabola-vertex') return { ...common, title: '独立新题：由公式到顶点',
        prompt: `${equation(p)}的顶点坐标是多少？`, input: { type: 'vertex' }, answer: { h: p.h, k: p.k },
        hints: ['先找平方项为零的横坐标，再找高度。', '标准形式的顶点是(h,k)，注意x−h的符号。', `分别解x−(${p.h})=0，并把x代回${equation(p)}。`],
        explanation: `平方项为零时x=${p.h}、y=${p.k}，顶点为(${p.h},${p.k})。` };
      const wrongH = p.h === 0 ? 1 : -p.h;
      const options = [{ value: 'match', label: equation(p) },
        { value: 'horizontal-sign', label: equation({ ...p, h: wrongH }) },
        { value: 'vertical-offset', label: equation({ ...p, k: p.k + 1 }) }];
      // Rotate choices deterministically; the correct choice is not always first.
      const shift = n % 3;
      return { ...common, title: '独立表征题：由顶点到公式',
        prompt: `开口参数a=${p.a}，顶点为(${p.h},${p.k})，哪个公式符合这两个条件？`,
        input: { type: 'choice' }, options: options.slice(shift).concat(options.slice(0, shift)), answer: 'match',
        hints: ['核对公式的顶点和开口参数，而不是图形看起来的方向。', '将顶点横坐标作为h，纵坐标作为k，代入a(x−h)²+k。', `正确公式的平方项应在x=${p.h}时为零，并且此时y=${p.k}。`],
        explanation: `${equation(p)}同时给出a=${p.a}与顶点(${p.h},${p.k})。其他选项改变了横坐标或高度。` };
    }
    const AB = s.AB + n * (delayed ? 2 : 1); const AC = s.AC + n;
    if (exercise.kind === 'triangle-completion') return { ...common, title: '补一个步骤：平方和',
      prompt: `∠A=90°，AB=${AB}${s.unit}，AC=${AC}${s.unit}。补出BC²=AB²+AC²的数值。`,
      input: { type: 'number' }, answer: AB * AB + AC * AC,
      hints: ['需要计算平方和，不是边长和。', '分别将AB与AC平方，再相加。', `计算(${AB})²+(${AC})²。`],
      explanation: `BC²=${AB * AB + AC * AC}。还需取正平方根才能得到斜边长，补步骤不计完整独立题。` };
    if (exercise.kind === 'triangle-hypotenuse') return { ...common, title: '独立新题：计算斜边',
      prompt: `∠A=90°，AB=${AB}${s.unit}，AC=${AC}${s.unit}。BC的长度是多少（${s.unit}）？`,
      input: { type: 'number' }, answer: Math.hypot(AB, AC),
      hints: ['BC对着直角，是斜边。', 'BC²=AB²+AC²；长度取正平方根。', `先算(${AB})²+(${AC})²，再开平方。`],
      explanation: `BC=√(${AB}²+${AC}²)≈${Math.hypot(AB, AC).toFixed(6)}${s.unit}。` };
    if (exercise.kind === 'triangle-applicability') {
      const angleGiven = n % 2 === 0;
      return { ...common, title: '独立适用条件题：可以套用吗？',
        prompt: `三角形ABC给出AB=${AB}${s.unit}、AC=${AC}${s.unit}，${angleGiven ? '明确∠A=90°' : '没有给出夹角大小或直角条件'}。能确定BC=√(AB²+AC²)吗？`,
        input: { type: 'choice' }, options: [{ value: 'apply', label: '可以，直角条件充分' }, { value: 'not-guaranteed', label: '不能由给定条件确定' }],
        answer: angleGiven ? 'apply' : 'not-guaranteed',
        hints: ['先检查公式的适用条件。', '勾股关系需要AB与AC之间为直角。', angleGiven ? '题目明确给出了∠A=90°。' : '仅给两条边，并不能推出它们夹角为90°。'],
        explanation: angleGiven ? 'AB与AC夹角为90°，所以BC是斜边，可以使用勾股关系。' : '夹角未知，BC可能随夹角改变；不能把缺少的直角条件补成已知。' };
    }
    const both = n % 2 === 0;
    return { ...common, title: '独立关系题：是否相似放大？',
      prompt: `保持∠A=90°。原AB=${AB}${s.unit}、AC=${AC}${s.unit}；现在AB翻倍，AC${both ? '也翻倍' : '保持不变'}。新斜边BC是否是原来的2倍？`,
      input: { type: 'choice' }, options: [{ value: 'double', label: '是，斜边变为2倍' }, { value: 'not-double', label: '不是2倍' }],
      answer: both ? 'double' : 'not-double',
      hints: ['对照两个长度是否按相同比例变化。', '整体相似缩放要求对应边同比例；单边变化不能直接当整体缩放。', both ? '平方和的两项都变为原来的4倍。' : '平方和只有AB²变为4倍，AC²没有变。'],
      explanation: both ? '两直角边都乘2，平方和乘4，取正平方根后斜边乘2。' : '新斜边是√(4AB²+AC²)，小于2√(AB²+AC²)，所以不会翻倍。' };
  }
  function validateContext(value, exercise) {
    if (!exact(value, ['id', 'exerciseId', 'generation', 'hintsShown', 'answerShown', 'exampleShown'])
      || !safeId(value.id) || !safeId(value.exerciseId) || (exercise && value.exerciseId !== exercise.id)
      || !integer(value.generation) || !Number.isInteger(value.hintsShown) || value.hintsShown < 0 || value.hintsShown > 3
      || typeof value.answerShown !== 'boolean' || typeof value.exampleShown !== 'boolean') {
      throw new TypeError('题目帮助上下文或代次无效。');
    }
    return clone(value);
  }
  function createContext(exercise, { id = uuid(), generation = 0 } = {}) {
    if (!exercise || !safeId(exercise.id)) throw new TypeError('帮助上下文需要有效练习身份。');
    return validateContext({ id, exerciseId: exercise.id, generation, hintsShown: 0, answerShown: false, exampleShown: false }, exercise);
  }
  function markHelp(input, action) {
    const context = validateContext(input);
    if (!(exact(action, ['type']) || exact(action, ['type', 'level']))) throw new TypeError('帮助动作必须是严格纯数据。');
    const keys = action.type === 'hint' ? ['type', 'level'] : ['type'];
    if (!exact(action, keys) || !['hint', 'answer', 'example'].includes(action.type)
      || (action.type === 'hint' && (!Number.isInteger(action.level) || action.level < 1 || action.level > 3))) {
      throw new TypeError('帮助动作只允许逐级提示、答案或当前题示范。');
    }
    if (action.type === 'hint') context.hintsShown = Math.max(context.hintsShown, action.level);
    else if (action.type === 'answer') context.answerShown = true;
    else context.exampleShown = true;
    return context;
  }
  function assisted(context) { return context.hintsShown > 0 || context.answerShown || context.exampleShown; }
  function judgeExercise(exercise, record, answer) {
    const view = exerciseView(exercise, record); let normalized; let correct;
    if (view.input.type === 'number') {
      if (!finite(answer)) throw new TypeError('请提交有限数值答案。');
      normalized = answer;
      correct = Math.abs(answer - view.answer) <= Math.max(1e-9, Math.abs(view.answer) * 1e-6);
    } else if (view.input.type === 'vertex') {
      if (!exact(answer, ['h', 'k']) || !finite(answer.h) || !finite(answer.k)) throw new TypeError('顶点答案只接受有限h和k。');
      normalized = { h: answer.h, k: answer.k };
      correct = Math.abs(answer.h - view.answer.h) <= 1e-9 && Math.abs(answer.k - view.answer.k) <= 1e-9;
    } else {
      if (typeof answer !== 'string' || !view.options.some((option) => option.value === answer)) throw new TypeError('选择答案不是当前题目选项。');
      normalized = answer; correct = answer === view.answer;
    }
    return { answer: clone(normalized), expectedAnswer: clone(view.answer), correct };
  }
  function submitExercise(record, exercise, inputContext, { id = uuid(), answer, createdAt = utc() } = {}) {
    const context = validateContext(inputContext, exercise);
    const result = judgeExercise(exercise, record, answer); const hintUsed = assisted(context);
    return validateReceipt({ schemaVersion: SCHEMA_VERSION, id, exerciseId: exercise.id, recordId: record.id,
      answer: result.answer, hintUsed, correct: result.correct,
      outcome: result.correct ? hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong', createdAt }, record, exercise, context);
  }
  // The owner submits each exercise only once and then locks its context. A later
  // explanation is a display action, not a mutation of the historical help fact.
  function validateReceipt(value, record, inputExercise, inputContext) {
    const exercise = validateExercise(inputExercise, record); const context = validateContext(inputContext, exercise);
    if (!exact(value, ['schemaVersion', 'id', 'exerciseId', 'recordId', 'answer', 'hintUsed', 'correct', 'outcome', 'createdAt'])
      || value.schemaVersion !== SCHEMA_VERSION || !safeId(value.id) || value.exerciseId !== exercise.id
      || value.recordId !== record.id || typeof value.hintUsed !== 'boolean' || typeof value.correct !== 'boolean'
      || !iso(value.createdAt) || Date.parse(value.createdAt) < Date.parse(exercise.createdAt)) {
      throw new TypeError('练习作答字段、关联或时间无效。');
    }
    const result = judgeExercise(exercise, record, value.answer);
    if (value.correct !== result.correct || value.hintUsed !== assisted(context)
      || value.outcome !== (result.correct ? value.hintUsed ? 'correct_with_hint' : 'correct_independent' : 'wrong')) {
      throw new TypeError('作答数学判定或锁定帮助凭据不一致。');
    }
    return { ...clone(value), answer: result.answer };
  }
  const causes = Object.freeze({
    'coordinate-sign': { label: '括号符号与横坐标混淆', explanation: '先令平方项为零，再把横坐标用于标准形式。', kind: 'parabola-equation' },
    'vertical-offset': { label: '顶点高度与纵向平移混淆', explanation: '分开核对平方项为零的位置与此时高度。', kind: 'parabola-vertex' },
    'formula-form': { label: '公式与坐标表征待核对', explanation: '用公式和顶点双向核对，而不是只记原题数字。', kind: 'parabola-equation' },
    'side-sum': { label: '边长和与平方和混淆', explanation: '对照边长相加与平方后相加，再取正平方根。', kind: 'triangle-hypotenuse' },
    'right-angle-condition': { label: '直角适用条件待核对', explanation: '先检查直角是否已给出，不补成默认条件。', kind: 'triangle-applicability' },
    'one-side-scale': { label: '单边变化与整体相似混淆', explanation: '对照仅改一边和两边同比例改变。', kind: 'triangle-scaling' }
  });
  function causeCandidates(original, receipt, exercise) {
    const record = checkedRecord(original);
    if (!receipt || receipt.recordId !== record.id || receipt.correct !== false || receipt.outcome !== 'wrong') return [];
    if (exercise) {
      validateExercise(exercise, record);
      if (exercise.stage === 'completion' || !exact(receipt, ['schemaVersion', 'id', 'exerciseId', 'recordId', 'answer', 'hintUsed', 'correct', 'outcome', 'createdAt'])
        || receipt.schemaVersion !== SCHEMA_VERSION || !safeId(receipt.id) || !iso(receipt.createdAt)
        || Date.parse(receipt.createdAt) < Date.parse(exercise.createdAt) || typeof receipt.hintUsed !== 'boolean'
        || receipt.exerciseId !== exercise.id || judgeExercise(exercise, record, receipt.answer).correct) return [];
    } else if (!math().validReceipt(record, receipt)) return [];
    const ids = record.template === 'parabola' ? ['coordinate-sign', 'vertical-offset', 'formula-form']
      : record.template === 'right-triangle' ? ['side-sum', 'right-angle-condition', 'one-side-scale'] : [];
    return ids.map((id) => ({ id, label: causes[id].label, explanation: causes[id].explanation }));
  }
  function reviewExercise(record, { confirmedCause = null, id = uuid(), index = 1, createdAt = utc(), stage = 'delayed' } = {}) {
    const checked = checkedRecord(record);
    const applicable = checked.template === 'parabola' ? ['coordinate-sign', 'vertical-offset', 'formula-form']
      : checked.template === 'right-triangle' ? ['side-sum', 'right-angle-condition', 'one-side-scale'] : [];
    if (confirmedCause !== null && !applicable.includes(confirmedCause)) throw new TypeError('只接受学生已确认的本微课有限错因标识。');
    const kind = confirmedCause === null ? checked.template === 'parabola' ? 'parabola-vertex' : 'triangle-hypotenuse'
      : causes[confirmedCause].kind;
    return createExercise(checked, { id, kind, stage, index, createdAt });
  }
  function reviewPlan({ record: original, records: inputRecords = [original], attempts = [], purposes = [], flow = null, now = utc() } = {}) {
    const record = checkedRecord(original);
    if (!iso(now) || !Array.isArray(inputRecords) || !Array.isArray(attempts)) throw new TypeError('复习依据或UTC时间无效。');
    const purposeList = flow ? flow.purposes : purposes;
    const purpose = purposeOf(record.id, purposeList || []);
    const eligible = purpose === 'practice';
    const evidence = attempts.filter((item) => item?.recordId === record.id && math().validReceipt(record, item));
    if (flow) {
      for (const item of flow.receipts || []) {
        if (item.recordId !== record.id) continue;
        // One immutable submission per exercise. Ambiguous or duplicated state
        // cannot become a streak simply by repeating a valid answer event.
        if ((flow.receipts || []).filter((entry) => entry.exerciseId === item.exerciseId).length !== 1) continue;
        const matches = (flow.exercises || []).filter((entry) => entry.id === item.exerciseId);
        const contexts = (flow.contexts || []).filter((entry) => entry.exerciseId === item.exerciseId);
        if (matches.length !== 1 || contexts.length !== 1) continue;
        const exercise = matches[0]; const context = contexts[0];
        if (!exercise || !context || exercise.stage === 'completion') continue;
        try { evidence.push(validateReceipt(item, record, exercise, context)); } catch (_) { /* Invalid events never drive suggestions. */ }
      }
    }
    const plan = math().reviewSuggestion(evidence);
    const overrides = (flow?.reviews || []).filter((item) => item.recordId === record.id);
    if (overrides.length > 1) throw new TypeError('同一记录不能有重复复习修订。');
    const override = overrides.length ? validateReview(overrides[0]) : null;
    const defaultAt = plan.days === null ? null : new Date(Date.parse(plan.lastAttemptAt) + plan.days * 86400000).toISOString();
    const reviewAt = override?.reviewAt || defaultAt;
    const skippedUntil = override?.skippedUntil || null;
    const skipped = Boolean(skippedUntil && Date.parse(skippedUntil) > Date.parse(now));
    return { ...plan, eligible, purpose, reviewAt, defaultReviewAt: defaultAt, skippedUntil,
      due: eligible && !skipped && reviewAt !== null && Date.parse(reviewAt) <= Date.parse(now), skipped,
      reason: !eligible ? purpose === 'reflection' ? '学生解释未评分，不进入作答复练。' : '旧记录用途未确认，请先明确分类。'
        : skipped ? '学生选择暂时跳过建议。' : override?.reviewAt ? '采用学生修改的复习时间。' : plan.reason,
      policy: 'product-suggestion-v1' };
  }
  function buildQueue(data = {}, { now = utc(), mode = 'due' } = {}) {
    if (!MODES.includes(mode) || !iso(now) || !Array.isArray(data.records || [])) throw new TypeError('复练模式、数据或UTC时间无效。');
    const flow = data.flow || { ...emptyFlow(), purposes: data.purposes || [], exercises: data.exercises || [],
      contexts: data.contexts || [], receipts: data.receipts || [], reviews: data.reviews || [] };
    const seen = new Set(); const entries = [];
    for (const original of data.records || []) {
      if (seen.has(original.id)) throw new TypeError('复练输入存在重复记录身份。');
      seen.add(original.id);
      let record; let plan;
      try { record = checkedRecord(original); plan = reviewPlan({ record, records: data.records, attempts: data.attempts || [], flow, now }); }
      catch (_) { continue; }
      if (!plan.eligible || (plan.skipped && mode !== 'manual')) continue;
      if (mode === 'due' && !plan.due) continue;
      if (mode === 'foundation' && plan.independentStreak > 0) continue;
      if (mode === 'interleaved' && plan.independentStreak === 0) continue;
      const reason = mode === 'foundation' ? '先练单类基础；目前没有近期独立正确依据。'
        : mode === 'interleaved' ? '有单类独立作答依据，交替辨认不同关系；这是学习安排建议。'
          : mode === 'manual' ? '学生主动选择复练。' : '已到学生可调整的建议复练时间。';
      entries.push({ recordId: record.id, record, plan, reason });
    }
    entries.sort((a, b) => (a.plan.reviewAt || '9999').localeCompare(b.plan.reviewAt || '9999') || a.recordId.localeCompare(b.recordId));
    if (mode !== 'interleaved') return entries;
    const buckets = new Map();
    for (const entry of entries) {
      if (!buckets.has(entry.record.template)) buckets.set(entry.record.template, []);
      buckets.get(entry.record.template).push(entry);
    }
    const keys = [...buckets.keys()].sort(); const mixed = [];
    while (keys.some((key) => buckets.get(key).length)) for (const key of keys) {
      const entry = buckets.get(key).shift(); if (entry) mixed.push(entry);
    }
    return mixed;
  }
  return { SCHEMA_VERSION, PURPOSES, STAGES, MODES, KINDS, LESSONS, emptyFlow, validatePurpose, createPurpose, purposeOf,
    validateReview, createExercise, validateExercise, exerciseView, lessonFor, createContext, validateContext, markHelp,
    judgeExercise, submitExercise, validateReceipt, causeCandidates, reviewExercise, reviewPlan, buildQueue };
});
