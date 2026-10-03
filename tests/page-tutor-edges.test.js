// 提问区接到页面和图形切换之后的边缘行为。期望来自故事 2：问的是当时画面上的图形。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, flush } = require('./helpers/fake-page.js');

/**
 * @param {object} [options]
 */
async function interactiveHarness(options) {
  const harness = await createHarness(options);
  harness.ready();
  harness.elements['wake-button'].dispatch('click');
  await flush();
  return harness;
}

/**
 * @param {object} harness
 * @param {string} text
 */
function ask(harness, text) {
  harness.elements['tutor-input'].value = text;
  harness.elements['tutor-form'].dispatch('submit');
}

/**
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
 * 代入句取最后一个等号后的结果；多个纵坐标则取每一个 y。
 * @param {string | undefined} reply
 * @returns {number[]}
 */
function resultNumbers(reply) {
  if (!reply) return [];
  if (/个 y/.test(reply)) {
    return [...reply.matchAll(/y\s*=\s*(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  }
  const values = [];
  for (const sentence of reply.split('。')) {
    const found = [...sentence.matchAll(/=\s*(-?\d+(?:\.\d+)?)/g)];
    if (found.length) values.push(Number(found[found.length - 1][1]));
  }
  return values;
}

/**
 * @param {object} harness
 * @param {string} kind
 */
function select(harness, kind) {
  harness.elements['figure-kind'].value = kind;
  harness.elements['figure-kind'].dispatch('change');
}

test('换成直线、圆或正弦后清空旧回答，下一问改的是新图形', async () => {
  const harness = await interactiveHarness();
  try {
    ask(harness, '把顶点高度改成 -1');
    const opening = entries(harness).filter((item) => item.role === 'tutor').at(-1);
    const failures = [];
    if (harness.elements['parameter-k-value'].textContent !== '-1.0') {
      failures.push('破壁后提问没有改到顶点高度，回答是：' + (opening && opening.text));
    }
    const cases = [
      ['line', '把斜率改成 2', 'm', 2, 'x 等于 0 时 y 是多少', 0],
      ['circle', '把半径改成 2', 'r', 2, 'x 等于 0 时 y 是多少', 0],
      ['sine', '把振幅改成 2', 'a', 2, 'x 等于 1.5 时 y 是多少', 1.5]
    ];
    for (const [kind, change, name, expected, read, x] of cases) {
      select(harness, 'parabola');
      select(harness, kind);
      if (harness.elements['tutor-log'].children.length !== 0) {
        failures.push(kind + ' 切换后仍留着上一种图形的记录');
      }
      const before = harness.win.BreakGlass.figureSession.getState();
      ask(harness, change);
      const after = harness.win.BreakGlass.figureSession.getState();
      const reply = entries(harness).filter((item) => item.role === 'tutor').at(-1);
      if (!after || after.kind !== kind || after.parameters[name] !== expected) {
        failures.push(`${kind} 问「${change}」后系数是 ${after && after.parameters[name]}，回答：${reply && reply.text}`);
      }
      if (reply && /抛物线/.test(reply.text) && kind !== 'parabola') {
        failures.push(`${kind} 的回答仍在说抛物线：${reply.text}`);
      }
      const readout = harness.win.BreakGlass.figureSession.readAt(x);
      ask(harness, read);
      const readReply = entries(harness).filter((item) => item.role === 'tutor').at(-1);
      const shown = readout.ok ? readout.values.map((value) => Number(Number(value).toFixed(4))) : [];
      const printed = resultNumbers(readReply && readReply.text);
      const missing = shown.filter((value) => !printed.some((item) => Math.abs(item - value) < 5e-4));
      if (missing.length) {
        failures.push(`${kind} 读数回答 ${readReply && readReply.text}，画面上是 ${shown.join(',')}，回答里的结果是 ${printed.join(',')}`);
      }
      if (before && after && before.parameters[name] === after.parameters[name] && expected !== before.parameters[name]) {
        failures.push(`${kind} 的系数没有被提问改动`);
      }
    }
    select(harness, 'parabola');
    if (harness.elements['parameter-k-value'].textContent !== '-1.0') {
      failures.push('切回抛物线后顶点高度仍是 ' + harness.elements['parameter-k-value'].textContent);
    }
    assert.deepEqual(failures, []);
  } finally {
    harness.restore();
  }
});

test('直线上用抛物线的说法提问，不改直线，也不改藏在下面的抛物线', async () => {
  const harness = await interactiveHarness();
  try {
    select(harness, 'line');
    const before = harness.win.BreakGlass.figureSession.getState();
    ask(harness, '把顶点高度改成 -1');
    const after = harness.win.BreakGlass.figureSession.getState();
    assert.equal(after.kind, 'line');
    assert.deepEqual(after.parameters, before.parameters);
    assert.match(entries(harness).at(-1).text, /没有改|不能/);
    select(harness, 'parabola');
    assert.equal(harness.elements['parameter-k-value'].textContent, '1.0');
  } finally {
    harness.restore();
  }
});

test('重置后在已有记录上补一句说明', async () => {
  const harness = await interactiveHarness();
  try {
    ask(harness, '把顶点高度改成 -1');
    harness.elements['reset-button'].dispatch('click');
    assert.equal(harness.elements['parameter-k-value'].textContent, '1.0');
    const log = entries(harness);
    assert.equal(log.at(-1).role, 'note');
    assert.match(log.at(-1).text, /恢复/);
  } finally {
    harness.restore();
  }
});

test('记录被单条说明顶满时，不能留下没有问题的回答', async () => {
  const harness = await interactiveHarness();
  try {
    for (let index = 0; index < 10; index += 1) ask(harness, 'k 现在是多少');
    assert.equal(harness.elements['tutor-log'].children.length, 20);
    harness.elements['reset-button'].dispatch('click');
    const log = entries(harness);
    assert.ok(log.length <= 20);
    assert.notEqual(log[0].role, 'tutor', '最早的问题被删掉后，第一条不该是孤立的回答');
    for (let index = 0; index < log.length; index += 1) {
      if (log[index].role !== 'tutor') continue;
      assert.equal(log[index - 1] && log[index - 1].role, 'user', '回答前面应还有对应的问题');
    }
  } finally {
    harness.restore();
  }
});

test('用户原话按文本写入记录，不解析成标记', async () => {
  const harness = await interactiveHarness();
  try {
    const raw = '<img src=x onerror=alert(1)>';
    ask(harness, raw);
    const entry = harness.elements['tutor-log'].children[0];
    assert.equal(entry.children[1].textContent, raw);
    assert.equal(entry.children[1].children.length, 0);
    assert.equal(harness.elements['parameter-k-value'].textContent, '1.0');
  } finally {
    harness.restore();
  }
});

test('播放或离开目标时间后，记录清空并且不能继续问', async () => {
  const harness = await interactiveHarness();
  try {
    const { elements, video } = harness;
    ask(harness, '顶点在哪里');
    assert.equal(elements['tutor-log'].children.length, 2);
    video.paused = false;
    video.dispatch('play');
    assert.equal(elements['tutor-log'].children.length, 0);
    assert.equal(elements['tutor-input'].disabled, true);
    assert.equal(harness.overlay(), null);
  } finally {
    harness.restore();
  }
});

test('只输入空格时给出提示，并清掉这串空格', async () => {
  const harness = await interactiveHarness();
  try {
    harness.elements['tutor-input'].value = '   ';
    harness.elements['tutor-form'].dispatch('submit');
    assert.equal(entries(harness)[0].text, '先写一句问题再送出。');
    assert.equal(harness.elements['tutor-input'].value, '');
  } finally {
    harness.restore();
  }
});

test('写入系数失败时滑块保持原值，回答不能宣称已经改成', async () => {
  const sessionApi = require('../extension/src/session/session');
  const original = sessionApi.SessionController.prototype.setParameter;
  sessionApi.SessionController.prototype.setParameter = function patched(name, value) {
    if (name === 'k' && value === -1) return { ok: false, code: 'invalid_parameter_value' };
    return original.call(this, name, value);
  };
  const harness = await interactiveHarness();
  try {
    ask(harness, '把顶点高度改成 -1');
    assert.equal(harness.elements['parameter-k-value'].textContent, '1.0');
    const reply = entries(harness).at(-1).text;
    assert.match(reply, /没有改/);
    assert.doesNotMatch(reply, /改为 -1\.0/);
  } finally {
    sessionApi.SessionController.prototype.setParameter = original;
    harness.restore();
  }
});
