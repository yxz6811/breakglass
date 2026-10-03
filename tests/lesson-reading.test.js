const test = require('node:test');
const assert = require('node:assert/strict');
const mismatch = require('./fixtures/lesson-size-mismatch.json');
const lesson = require('../extension/src/lesson/reading.js');

const SOURCE = { width: 1920, height: 1080 };

/**
 * @param {number} time
 * @param {string} id
 * @param {object} [overrides]
 * @returns {object}
 */
function point(time, id, overrides) {
  const curve = {
    requestId: 'lesson-run',
    videoId: 'local-binding',
    time,
    frameSize: { width: 1920, height: 1080 },
    source: 'preset',
    fallback: null,
    definition: {
      equationId: 'fixture.parabola',
      parameters: {
        a: { initial: 0.8, min: 0.4, max: 1.2, step: 0.1 },
        h: { initial: 0, min: -2, max: 2, step: 0.1 },
        k: { initial: 0, min: -2, max: 2, step: 0.1 }
      },
      dragParameter: 'h',
      domain: { min: -4, max: 4 },
      range: { min: -4, max: 4 },
      yAxis: 'up',
      region: { x: 480, y: 220, width: 960, height: 620 }
    }
  };
  return Object.assign({
    id,
    time,
    lessonLine: id + ' 的课。',
    curve
  }, overrides || {});
}

/**
 * @param {object[]} points
 * @param {object} [extra]
 * @returns {object}
 */
function reading(points, extra) {
  return Object.assign({
    readingId: 'lesson-run',
    videoId: 'local-binding',
    origin: 'external',
    duration: 40,
    points
  }, extra || {});
}

test('短片只采中点，长片最多八处且不从零逐帧', () => {
  assert.deepEqual(lesson.sampleTimes(1), [0.5]);
  assert.deepEqual(lesson.sampleTimes(1.5), [0.75]);
  const times = lesson.sampleTimes(10);
  assert.equal(times.length, 8);
  assert.notEqual(times[0], 0);
  assert.deepEqual(times, lesson.collapseCloseTimes(times));
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index] - times[index - 1] >= 1);
  }
  assert.notDeepEqual(times.slice(0, 4), [0, 1, 2, 3]);
});

test('相邻不足一秒时丢掉较晚的采样', () => {
  assert.deepEqual(lesson.collapseCloseTimes([1, 1.4, 3, 3.2]), [1, 3]);
});

test('尺寸不符和视频不符都会丢掉，且不留下替身曲线', () => {
  const verdict = lesson.validateLessonReading(mismatch, SOURCE);
  assert.equal(verdict.points.length, 0);
  assert.equal(verdict.first, null);
  assert.deepEqual(verdict.dropped.map((item) => item.reason), [
    '抛物线没有通过检查',
    '不是这一段视频'
  ]);
});

test('时间、间隔和八个点的上限使用约定原因', () => {
  const many = [];
  for (let index = 0; index < 9; index += 1) many.push(point(index * 2, 'p' + index));
  const verdict = lesson.validateLessonReading(reading([
    point(-1, 'negative'),
    point(80, 'outside'),
    point(5, 'near-a', { lessonLine: '靠近。' }),
    point(5.4, 'near-b', { lessonLine: '更晚。' }),
    point(4, 'bad-line', { lessonLine: '' })
  ].concat(many), { duration: 30 }), SOURCE);
  const reasons = verdict.dropped.map((item) => item.reason);
  assert.ok(reasons.includes('时间无效'));
  assert.ok(reasons.includes('落在视频外面'));
  assert.ok(reasons.includes('和上一个点靠得太近'));
  assert.ok(reasons.includes('抛物线没有通过检查'));
  assert.ok(reasons.includes('超出八个点'));
  const allowed = ['抛物线没有通过检查', '不是这一段视频', '时间无效', '落在视频外面', '和上一个点靠得太近', '超出八个点'];
  for (const reason of reasons) assert.ok(allowed.includes(reason), '契约外的丢掉原因：' + reason);
  assert.equal(verdict.points.length, 8);
  for (let index = 1; index < verdict.points.length; index += 1) {
    assert.ok(verdict.points[index].time - verdict.points[index - 1].time >= 1);
  }
});

test('第一处按到达顺序，下一处只取更晚的已存点', () => {
  const later = point(12, 'later');
  const earlier = point(4, 'earlier');
  const verdict = lesson.validateLessonReading(reading([later, earlier]), SOURCE);
  assert.equal(verdict.first.id, 'later');
  assert.equal(lesson.firstAccepted([later, earlier]).id, 'later');
  assert.equal(lesson.nextPoint(verdict.points, 12), null);
  assert.equal(lesson.nextPoint(verdict.points, 4).id, 'later');
  assert.equal(lesson.nextPoint(verdict.points, 0).id, 'earlier');
});

test('课程说明超过 80 个字会被丢掉', () => {
  const longLine = Array.from({ length: 81 }, () => '字').join('');
  const verdict = lesson.validateLessonReading(reading([
    point(3, 'long', { lessonLine: longLine })
  ]), SOURCE);
  assert.equal(verdict.points.length, 0);
  assert.equal(verdict.dropped[0].reason, '抛物线没有通过检查');
});

test('重复的编号或课程说明也只用约定原因', () => {
  const verdict = lesson.validateLessonReading(reading([
    point(3, 'same'),
    point(6, 'same', { lessonLine: '另一句。' }),
    point(9, 'other', { lessonLine: 'same 的课。' })
  ]), SOURCE);
  assert.deepEqual(verdict.points.map((item) => item.id), ['same']);
  assert.deepEqual(verdict.dropped.map((item) => item.reason), ['抛物线没有通过检查', '抛物线没有通过检查']);
});

test('当次请求绑定拒绝未采样帧、旧编号、不同 duration 和变化的源尺寸', () => {
  const request = { readingId: 'lesson-run', videoId: 'local-binding', duration: 12, sampleTimes: [0.75, 3.75], frameSize: SOURCE };
  const payload = reading([point(4, 'unsampled'), point(3.75, 'sampled')], { duration: 12 });
  const verdict = lesson.validateLessonReading(payload, SOURCE, request);
  assert.deepEqual(verdict.points.map((item) => item.id), ['sampled']);
  assert.deepEqual(verdict.dropped, [{ reason: '时间无效' }]);
  assert.equal(lesson.validateLessonReading(payload, SOURCE, { ...request, readingId: 'old' }).ok, false);
  assert.equal(lesson.validateLessonReading(payload, SOURCE, { ...request, duration: 13 }).ok, false);
  assert.equal(lesson.validateLessonReading(payload, SOURCE, { ...request, sampleTimes: [] }).ok, false);
  assert.equal(lesson.validateLessonReading(payload, { width: 1280, height: 720 }, request).ok, false);
});
