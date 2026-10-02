// 液态玻璃顶栏的放大内核（纯函数）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, resolveOptions, falloff, sample, smooth, settle, isSettled } = require('../extension/src/ui/magnify.js');

test('衰减曲线：中心为 1、边界为 0、单调不增', () => {
  assert.equal(falloff(0, 100), 1);
  assert.equal(falloff(100, 100), 0);
  assert.equal(falloff(-50, 100), falloff(50, 100), '左右对称');
  let previous = 1;
  for (let distance = 0; distance <= 100; distance += 5) {
    const weight = falloff(distance, 100);
    assert.equal(weight <= previous + 1e-12, true, 'distance=' + distance);
    assert.equal(weight >= 0 && weight <= 1, true);
    previous = weight;
  }
  assert.equal(falloff(999, 100), 0, '半径外归零');
  assert.equal(falloff(Number.NaN, 100), 0);
  assert.equal(falloff(10, 0), 0);
});

test('sample 给出缩放与抬升，且指针在正中时最大', () => {
  const centers = [40, 120, 200];
  const middle = sample(120, centers, { radius: 100, maxScale: 1.5, lift: 8 });
  assert.equal(middle.length, 3);
  assert.equal(middle[1].scale, 1.5);
  assert.equal(middle[1].lift, 8);
  assert.equal(middle[1].weight, 1);
  assert.equal(middle[0].scale < middle[1].scale, true);
  assert.equal(middle[0].scale, middle[2].scale, '左右对称');
  assert.equal(middle[0].scale > 1, true, '相邻按钮也被带动');
});

test('指针离开容器时不放大任何按钮', () => {
  const idle = sample(Number.NaN, [40, 120, 200]);
  assert.equal(idle.every((item) => item.scale === 1 && item.lift === 0), true);
  assert.deepEqual(sample(0, [], {}), []);
  assert.deepEqual(sample(0, null, {}), []);
});

test('相邻按钮的放大是连续过渡，不会出现台阶', () => {
  const centers = [60, 132, 204, 276, 348];
  const atFirst = sample(60, centers, { radius: 130, maxScale: 1.5 });
  const between = sample(96, centers, { radius: 130, maxScale: 1.5 });
  const gapFirst = Math.abs(atFirst[0].scale - atFirst[1].scale);
  const gapBetween = Math.abs(between[0].scale - between[1].scale);
  assert.equal(gapBetween < gapFirst, true, '滑到两个按钮之间时高度差变小');
});

test('参数被夹在合理范围', () => {
  const config = resolveOptions({ radius: -5, maxScale: 99, lift: Number.NaN, stiffness: 0 });
  assert.equal(config.radius, DEFAULTS.radius);
  assert.equal(config.maxScale, 3);
  assert.equal(config.lift, DEFAULTS.lift);
  assert.equal(config.stiffness, DEFAULTS.stiffness);
});

test('平滑与帧率无关：两个半步约等于一个整步', () => {
  const one = smooth(1, 2, 0.016, 20);
  const half = smooth(smooth(1, 2, 0.008, 20), 2, 0.008, 20);
  assert.equal(Math.abs(one - half) < 1e-9, true, one + ' vs ' + half);
  assert.equal(smooth(1, 2, 0, 20), 1, 'dt=0 不推进');
  assert.equal(smooth(1, 2, -1, 20), 1, '负 dt 不推进');
  assert.equal(smooth(1, 2, 1, 1000) > 1.99, true, '高刚度快速收敛');
});

test('settle 与 isSettled 驱动动画收敛', () => {
  let scales = [1, 1, 1];
  const targets = [1.5, 1.2, 1];
  assert.equal(isSettled(scales, targets), false);
  for (let frame = 0; frame < 120; frame += 1) scales = settle(scales, targets, 1 / 60, 20);
  assert.equal(isSettled(scales, targets), true);
  assert.equal(Math.abs(scales[0] - 1.5) < 0.002, true);
  assert.deepEqual(settle([1], [], 0.016, 20), [1], '目标缺失时保持原值');
});
