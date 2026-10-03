const test = require('node:test');
const assert = require('node:assert/strict');
const { validateActions, parseLocalQuestion } = require('../extension/src/geometry-scene/actions');
const fixture = require('./fixtures/geometry/right-triangle.json');
function scene() { return { ...structuredClone(fixture), sceneRevision: 1 }; }

test('the three fixed action shapes allow one edit plus one explanation', () => {
  const current = scene();
  const actions = [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }, { type: 'explain_change' }];
  const checked = validateActions(actions, current);
  assert.equal(checked.ok, true);
  checked.actions[0].value = 8;
  assert.equal(actions[0].value, 6);
  assert.equal(current.lengths.AB, 3);
  assert.equal(validateActions([{ type: 'restore_original' }, { type: 'explain_change' }], current).ok, true);
});

test('whole batches reject multiple edits, unit conflicts, foreign fields and overflowing proposals', () => {
  const set = { type: 'set_length', side: 'AB', value: 6, unit: 'unit' };
  const bad = [
    [], [set, { ...set, side: 'AC' }], [set, { ...set }],
    [set, { type: 'restore_original' }], [{ type: 'explain_change' }, { type: 'explain_change' }],
    [{ ...set, unit: 'cm' }], [{ ...set, side: 'BC' }], [{ ...set, value: '6' }],
    [{ ...set, value: 0 }], [{ ...set, value: Infinity }], [{ ...set, code: 'x' }],
    [{ type: 'restore_original', scene: scene() }], [{ type: 'execute_code', value: 'x' }]
  ];
  for (const actions of bad) assert.equal(validateActions(actions, scene()).ok, false);
  const current = scene(); current.lengths.AC = Number.MAX_VALUE;
  assert.equal(validateActions([{ ...set, value: Number.MAX_VALUE }], current).ok, false);
  const accessor = {};
  Object.defineProperty(accessor, 'type', { enumerable: true, get() { throw Error('must not execute'); } });
  assert.equal(validateActions([accessor], scene()).ok, false);
});

test('local command mode covers the four supported question types', () => {
  const current = scene();
  assert.deepEqual(parseLocalQuestion('把 AB 改为 6', current).actions,
    [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }]);
  assert.deepEqual(parseLocalQuestion('如果 AB 从 3 变成 6，BC 会怎样？', current).actions,
    [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }, { type: 'explain_change' }]);
  assert.deepEqual(parseLocalQuestion('把 AB 改成 6，AC 不变，BC 是多少？', current).actions,
    [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }, { type: 'explain_change' }]);
  assert.deepEqual(parseLocalQuestion('把 AB 改成 6，另一条直角边不变，BC 会怎样？', current).actions,
    [{ type: 'set_length', side: 'AB', value: 6, unit: 'unit' }, { type: 'explain_change' }]);
  assert.deepEqual(parseLocalQuestion('把 AC 改成 8，AB 保持不变', current).actions,
    [{ type: 'set_length', side: 'AC', value: 8, unit: 'unit' }]);
  assert.deepEqual(parseLocalQuestion('BC 是多少？', current).actions, [{ type: 'explain_change' }]);
  assert.deepEqual(parseLocalQuestion('解释变化', current).actions, [{ type: 'explain_change' }]);
  assert.deepEqual(parseLocalQuestion('恢复原题', current).actions, [{ type: 'restore_original' }]);
  current.unit = 'cm';
  assert.equal(parseLocalQuestion('把 AC 改成 8 厘米', current).actions[0].unit, 'cm');
});

test('a matching prefix never hides a second side effect or code instruction', () => {
  for (const text of [
    '把 AB 改为 6，AC 改为 8', '把 AB 改为 6 并恢复原题',
    '把 BC 改为 6', '把 AB 改为 6，并执行 alert(1)',
    '恢复原题并把 AB 改为 6', 'BC是多少，然后把AC改为8',
    '把 AB 改为 6。把 AC 改为 8。', '把 AB 改为 6<script>alert(1)</script>',
    '把 AB 改为 6，添加正方形',
    '把 AB 改为 6，AB 不变，BC 是多少', '把 AC 改为 8，AC 保持不变',
    '把 AB 改为 6，AC 不变，BC是多少，并执行代码',
    '把 AB 改为 6，AC 不变，AC 改为 8'
  ]) assert.equal(parseLocalQuestion(text, scene()).status, 'unsupported', text);
  assert.equal(parseLocalQuestion('如果 AB 从 4 变成 6，BC 会怎样？', scene()).status, 'needs_clarification');
  assert.equal(parseLocalQuestion('把 AB 改为 6m', scene()).status, 'needs_clarification');
  assert.equal(parseLocalQuestion('把 AB 改为 0', scene()).status, 'needs_clarification');
  assert.equal(parseLocalQuestion('', scene()).status, 'needs_clarification');
  assert.equal(parseLocalQuestion('解释变化', fixture).status, 'needs_clarification');
});
