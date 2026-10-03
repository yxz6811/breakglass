// 演示页上的提问区：送出一句话后，会话系数、滑块数字、曲线与回答一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/fake-page.js');

/**
 * 预设片子停在目标帧并破壁，得到可交互的抛物线。
 * @param {object} [config]
 */
async function interactiveHarness(config) {
  const harness = await createHarness(config ? { config } : undefined);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  return harness;
}

/**
 * 在提问框里写一句并送出。
 * @param {object} harness
 * @param {string} text
 */
function ask(harness, text) {
  harness.elements['tutor-input'].value = text;
  harness.elements['tutor-form'].dispatch('submit');
}

/**
 * 记录区里每一条的角色和文字。
 * @param {object} harness
 * @returns {{ role: string, text: string }[]}
 */
function entries(harness) {
  return harness.elements['tutor-log'].children.map((entry) => {
    const role = /tutor__entry--(\w+)/.exec(entry.className)[1];
    return { role, text: role === 'note' ? entry.textContent : entry.children[1].textContent };
  });
}

/**
 * @param {object} harness
 * @returns {string}
 */
function curvePath(harness) {
  return harness.overlay().querySelector('path').getAttribute('d');
}

test('破壁前提问区禁用，并提示先破壁', async () => {
  const harness = await createHarness();
  try {
    harness.ready();
    const { elements } = harness;
    assert.equal(elements['tutor-input'].disabled, true);
    assert.equal(elements['tutor-send'].disabled, true);
    assert.equal(elements['tutor-log'].hidden, true);
    ask(harness, '把顶点高度改成 -1');
    assert.equal(elements['tutor-log'].children.length, 0, '禁用时送出不产生回答');
  } finally {
    harness.restore();
  }
});

test('改一个系数：会话、滑块、曲线与回答用同一个数', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    assert.equal(elements['tutor-input'].disabled, false);
    assert.equal(elements['tutor-send'].disabled, false);
    assert.match(elements['tutor-hint'].textContent, /回答里的数就是画面上的数/);
    const before = curvePath(harness);
    ask(harness, '把顶点高度改成 -1');
    assert.equal(elements['parameter-k-value'].textContent, '-1.0');
    assert.equal(elements['parameter-k'].value, '-1');
    assert.notEqual(curvePath(harness), before, '曲线要按新系数重画');
    const log = entries(harness);
    assert.deepEqual(log.map((item) => item.role), ['user', 'tutor']);
    assert.equal(log[0].text, '把顶点高度改成 -1');
    assert.match(log[1].text, /改为 -1\.0/);
    assert.match(log[1].text, new RegExp(elements['parameter-k-value'].textContent.replace('.', '\\.')));
    assert.equal(elements['tutor-input'].value, '', '送出后清空输入框');
    assert.equal(elements['tutor-log'].hidden, false);
  } finally {
    harness.restore();
  }
});

test('越界的数按实际采用的数显示在滑块和回答里', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    ask(harness, '把开口改成 9');
    assert.equal(elements['parameter-a-value'].textContent, '1.2');
    const reply = entries(harness)[1].text;
    assert.match(reply, /上限 1\.2/);
    assert.doesNotMatch(reply, /\b9\b/);
  } finally {
    harness.restore();
  }
});

test('读数与之后拖动滑块互不干扰', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    ask(harness, 'x 等于 1 时 y 是多少');
    assert.match(entries(harness)[1].text, /= 2。这个点在当前坐标窗口内/);
    assert.equal(elements['parameter-a-value'].textContent, '1.0');
    assert.equal(elements['parameter-k-value'].textContent, '1.0');
    elements['parameter-k'].value = '0.5';
    elements['parameter-k'].dispatch('input');
    ask(harness, 'x 等于 1 时 y 是多少');
    assert.match(entries(harness)[3].text, /\+ 0\.5 = 1\.5/, '提问读的是拖动之后的系数');
  } finally {
    harness.restore();
  }
});

test('无法执行的提问不改滑块，也不重画', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    const before = curvePath(harness);
    for (const text of ['把半径改成 3', 'k 改成 1，k 改成 2', '今天天气怎么样']) ask(harness, text);
    assert.equal(elements['parameter-a-value'].textContent, '1.0');
    assert.equal(elements['parameter-h-value'].textContent, '0.0');
    assert.equal(elements['parameter-k-value'].textContent, '1.0');
    assert.equal(curvePath(harness), before);
    const replies = entries(harness).filter((item) => item.role === 'tutor').map((item) => item.text);
    assert.equal(replies.length, 3);
    for (const reply of replies) assert.match(reply, /图像没有改/);
  } finally {
    harness.restore();
  }
});

test('空着送出只给提示，不记成一条提问', async () => {
  const harness = await interactiveHarness();
  try {
    ask(harness, '   ');
    assert.deepEqual(entries(harness), [{ role: 'tutor', text: '先写一句问题再送出。' }]);
  } finally {
    harness.restore();
  }
});

test('焦点在提问框里按 Esc 只清空草稿，不退出破壁', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements, document } = harness;
    elements['tutor-input'].value = '把开口';
    document.dispatch('keydown', { key: 'Escape', target: elements['tutor-input'] });
    assert.equal(elements['tutor-input'].value, '');
    assert.ok(harness.overlay(), '覆盖层还在');
    document.dispatch('keydown', { key: 'Escape', target: elements['video-stage'] });
    assert.equal(harness.overlay(), null, '焦点不在提问框时 Esc 照常退出');
  } finally {
    harness.restore();
  }
});

test('退出后记录清空，提问区回到禁用', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    ask(harness, '顶点在哪里');
    assert.equal(elements['tutor-log'].children.length, 2);
    elements['exit-button'].dispatch('click');
    assert.equal(elements['tutor-log'].children.length, 0);
    assert.equal(elements['tutor-log'].hidden, true);
    assert.equal(elements['tutor-input'].disabled, true);
    elements['wake-button'].dispatch('click');
    assert.equal(elements['tutor-input'].disabled, false);
    assert.equal(elements['tutor-log'].children.length, 0, '再次破壁不带回上一次的记录');
  } finally {
    harness.restore();
  }
});

test('平移说法从滑块上的当前值算起', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    elements['parameter-k'].value = '0.5';
    elements['parameter-k'].dispatch('input');
    ask(harness, '抛物线向下平移 1 个单位');
    assert.equal(elements['parameter-k-value'].textContent, '-0.5');
    assert.match(entries(harness)[1].text, /从 0\.5 改为 -0\.5，抛物线向下平移 1\.0/);
  } finally {
    harness.restore();
  }
});

test('重置后在记录里补一句，没有记录时不补', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    elements['reset-button'].dispatch('click');
    assert.equal(elements['tutor-log'].children.length, 0, '没问过就不出现记录');
    ask(harness, '把顶点高度改成 -1');
    elements['reset-button'].dispatch('click');
    assert.equal(elements['parameter-k-value'].textContent, '1.0');
    const log = entries(harness);
    assert.deepEqual(log[log.length - 1], { role: 'note', text: '已恢复抛物线的初始系数。' });
  } finally {
    harness.restore();
  }
});

/**
 * @param {object} harness
 * @returns {object}
 */
function session(harness) {
  return harness.win.BreakGlass.figureSession;
}

/**
 * 用页面上的图形选择切换图形。
 * @param {object} harness
 * @param {string} kind
 */
function select(harness, kind) {
  harness.elements['figure-kind'].value = kind;
  harness.elements['figure-kind'].dispatch('change');
  assert.equal(session(harness).getState().kind, kind);
}

test('换图形就清空记录，示例换成这种图形的问法', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    ask(harness, '把顶点高度改成 -1');
    assert.equal(elements['tutor-log'].children.length, 2);
    select(harness, 'line');
    assert.equal(elements['tutor-log'].children.length, 0, '直线旁边不留抛物线的数');
    assert.equal(elements['tutor-log'].hidden, true);
    const buttons = elements['tutor-examples'].children;
    assert.deepEqual(buttons.map((button) => button.dataset.tutorExample), ['把斜率改成 2', '截距减小 1', 'x 等于 1 时 y 是多少']);
    assert.deepEqual(buttons.map((button) => button.textContent), buttons.map((button) => button.dataset.tutorExample));
    assert.ok(buttons.every((button) => button.type === 'button' && button.disabled === false));
    elements['tutor-examples'].dispatch('click', { target: buttons[0] });
    assert.equal(elements['tutor-input'].value, '把斜率改成 2');

    ask(harness, '把斜率改成 2');
    elements['reset-button'].dispatch('click');
    assert.deepEqual(entries(harness).at(-1), { role: 'note', text: '已恢复直线的初始系数。' });
    select(harness, 'circle');
    assert.equal(elements['tutor-log'].children.length, 0);
    assert.equal(elements['tutor-examples'].children[1].dataset.tutorExample, '把圆心移到 (1, -1)');
    elements['exit-button'].dispatch('click');
    assert.ok(elements['tutor-examples'].children.every((button) => button.disabled === true), '退出后示例回到禁用');
    assert.equal(elements['tutor-examples'].children[0].dataset.tutorExample, '把顶点高度改成 -1', '下一次破壁先是抛物线');
  } finally {
    harness.restore();
  }
});

test('在直线、圆、正弦上提问：改的是画面上的图形，读数与 figureSession.readAt 相同', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements } = harness;
    const api = session(harness);

    select(harness, 'line');
    ask(harness, '把斜率改成 2');
    assert.deepEqual(api.getState().parameters, { m: 2, b: 1 });
    assert.equal(elements['parameter-figure-1-value'].textContent, '2.0');
    assert.equal(elements['parameter-figure-1'].value, '2');
    assert.match(entries(harness)[1].text, /^斜率 m 从 1\.0 改为 2\.0，直线变陡/);
    ask(harness, 'x 等于 1 时 y 是多少');
    assert.deepEqual(api.readAt(1).values, [3]);
    assert.match(entries(harness)[3].text, /y = 2\.0 × 1 \+ 1\.0 = 3/);
    ask(harness, '把顶点高度改成 -1');
    assert.equal(api.getState().kind, 'line', '抛物线的说法不把图形改回抛物线');
    assert.deepEqual(api.getState().parameters, { m: 2, b: 1 });
    assert.match(entries(harness)[5].text, /^当前的直线没有顶点/);

    select(harness, 'circle');
    ask(harness, 'x 等于 0 时 y 是多少');
    assert.deepEqual(api.readAt(0).values, [2, 0]);
    assert.match(entries(harness)[1].text, /有两个 y：y = 2 或 y = 0/);
    ask(harness, '把圆心移到 (1, -1)');
    assert.deepEqual(api.getState().parameters, { h: 1, k: -1, r: 1 });
    assert.equal(elements['parameter-figure-1-value'].textContent, '1.0');
    assert.equal(elements['parameter-figure-2-value'].textContent, '-1.0');
    assert.match(entries(harness)[3].text, /圆心现在是 \(1\.0, -1\.0\)/);

    select(harness, 'sine');
    elements['parameter-figure-1'].value = '2';
    elements['parameter-figure-1'].dispatch('input');
    ask(harness, 'x 等于 1 时 y 是多少');
    const [y] = api.readAt(1).values;
    const reply = entries(harness)[1].text;
    assert.match(reply, /^x = 1 时，y = 2\.0 × sin\(1 − 0\.0\) \+ 1\.0 = /, '读的是拖动滑块之后的振幅');
    const shown = Number(/= (-?\d+(?:\.\d+)?)。/.exec(reply)[1]);
    assert.ok(Math.abs(shown - y) < 5e-5, `回答 ${shown} 与画面读数 ${y} 一致`);
    ask(harness, '向右平移 1');
    assert.deepEqual(api.getState().parameters, { a: 2, h: 1, k: 1 });
    assert.equal(elements['parameter-figure-2-value'].textContent, '1.0');
  } finally {
    harness.restore();
  }
});

test('显示区域对不上时提问不改图，并说明原因', async () => {
  let objectFit = 'contain';
  const harness = await createHarness({ getComputedStyle: () => ({ objectFit, objectPosition: '50% 50%' }) });
  try {
    harness.ready();
    harness.elements['wake-button'].dispatch('click');
    const api = session(harness);
    select(harness, 'circle');
    const before = api.getState();
    const path = curvePath(harness);
    objectFit = 'fill';
    ask(harness, '把半径改成 2');
    assert.deepEqual(api.getState(), before);
    assert.equal(curvePath(harness), path);
    assert.equal(harness.elements['parameter-figure-3-value'].textContent, '1.0');
    assert.equal(entries(harness)[1].text, '画面的显示区域现在对不上，这次没有改图。恢复显示区域后再问一次。');
    ask(harness, 'x=0 时 y 是多少');
    assert.match(entries(harness)[3].text, /有两个 y/, '只读不改的提问照常回答');
    objectFit = 'contain';
    ask(harness, '把半径改成 2');
    assert.equal(api.getState().parameters.r, 2);
  } finally {
    harness.restore();
  }
});

test('点示例只填进输入框，不替用户送出', async () => {
  const harness = await createHarness();
  try {
    harness.ready();
    const { elements } = harness;
    const example = { dataset: { tutorExample: 'x 等于 1 时 y 是多少' } };
    elements['tutor-examples'].dispatch('click', { target: example });
    assert.equal(elements['tutor-input'].value, '', '破壁前示例不可用');
    elements['wake-button'].dispatch('click');
    let focused = 0;
    elements['tutor-input'].focus = () => { focused += 1; };
    elements['tutor-examples'].dispatch('click', { target: example });
    assert.equal(elements['tutor-input'].value, 'x 等于 1 时 y 是多少');
    assert.equal(focused, 1);
    assert.equal(elements['tutor-log'].children.length, 0);
    elements['tutor-examples'].dispatch('click', { target: elements['tutor-examples'] });
    assert.equal(elements['tutor-input'].value, 'x 等于 1 时 y 是多少', '点到按钮之间的空白不改输入');
  } finally {
    harness.restore();
  }
});

test('记录最多保留二十条', async () => {
  const harness = await interactiveHarness();
  try {
    for (let index = 0; index < 15; index += 1) ask(harness, 'k 现在是多少');
    assert.equal(harness.elements['tutor-log'].children.length, 20);
  } finally {
    harness.restore();
  }
});

test('提问全程不发请求', async () => {
  const harness = await interactiveHarness();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => {
    calls += 1;
    return original(...args);
  };
  try {
    for (const text of ['把顶点高度改成 -1', 'x 等于 1 时 y 是多少', '如果开口是 0.5，x 等于 2 时 y 是多少', '把半径改成 3']) {
      ask(harness, text);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    harness.restore();
  }
});
