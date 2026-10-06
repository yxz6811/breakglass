const test = require('node:test');
const assert = require('node:assert/strict');

require('../extension/src/lesson/reading.js');
const reading = require('../extension/src/geometry-lesson/reading.js');
const solve = require('../extension/src/geometry-lesson/solve.js');
const request = require('../extension/src/geometry-lesson/request.js');

const frame = { width: 640, height: 360 };
const identity = {
  readingId: 'reading-1',
  videoId: 'local-binding-1',
  duration: 9,
  frameSize: frame
};

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function triangle(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    id: 'point-1',
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    time: 3.2,
    frameSize: { width: 640, height: 360 },
    lessonLine: '直角边 3 和 4。',
    kind: 'right-triangle',
    unit: 'cm',
    placement: {
      vertices: {
        A: { x: 100, y: 200 },
        B: { x: 220, y: 200 },
        C: { x: 100, y: 80 }
      }
    },
    given: {
      rightAngleAt: 'A',
      legs: [
        { id: 'AB', from: 'A', to: 'B', length: 3 },
        { id: 'AC', from: 'A', to: 'C', length: 4 }
      ]
    },
    derived: { hypotenuse: { id: 'BC', from: 'B', to: 'C', length: 5 } },
    ...overrides
  };
}

/**
 * @param {number} time
 * @param {string} id
 * @returns {object}
 */
function at(time, id) {
  return triangle({ id, time });
}

test('采样时刻复用开播前阅读，像素距离不等于边长时斜边仍须等于 Math.hypot', () => {
  assert.deepEqual(reading.sampleTimes(8), global.BreakGlass.lesson.sampleTimes(8));
  assert.equal(reading.sampleTimes(1.5)[0], 0.75);
  const point = triangle();
  const span = Math.hypot(120, 120);
  assert.notEqual(span, 5);
  assert.equal(reading.pointProblem(point, identity), '');
  point.derived.hypotenuse.length = span;
  assert.equal(reading.pointProblem(point, identity), 'derived');
});

test('未知字段、夹具视频、尺寸不符、字符串边长、圆和线段按白名单收下或拒绝', () => {
  const extra = triangle();
  extra.prompt = 'override';
  assert.equal(reading.pointProblem(extra, identity), 'unknown');
  assert.equal(reading.pointProblem(triangle({ videoId: 'fixture-parabola' }), { ...identity, videoId: 'fixture-parabola' }), 'identity');
  assert.equal(reading.pointProblem(triangle({ frameSize: { width: 640, height: 361 } }), identity), 'frame_size');
  const textual = triangle();
  textual.given.legs[0].length = '3';
  assert.equal(reading.pointProblem(textual, identity), 'not_finite');

  const circle = {
    schemaVersion: '1.0.0',
    id: 'circle-1',
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    time: 2,
    frameSize: { ...frame },
    lessonLine: '半径 5cm。',
    kind: 'circle',
    unit: 'cm',
    placement: { center: { x: 80, y: 90 } },
    given: { center: { label: 'O', x: 80, y: 90 }, radius: 5 },
    derived: {}
  };
  assert.equal(reading.pointProblem(circle, identity), '');
  circle.given.radius = 0;
  assert.equal(reading.pointProblem(circle, identity), 'not_finite');

  const segment = {
    schemaVersion: '1.0.0',
    id: 'segment-1',
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    time: 2,
    frameSize: { ...frame },
    lessonLine: '线段 6。',
    kind: 'segment',
    unit: 'unit',
    placement: { start: { x: 10, y: 20 }, end: { x: 40, y: 80 } },
    given: {
      start: { label: 'P', x: 10, y: 20 },
      end: { label: 'Q', x: 40, y: 80 },
      length: 6
    },
    derived: {}
  };
  assert.equal(reading.pointProblem(segment, identity), '');
  segment.kind = 'rectangle';
  assert.equal(reading.pointProblem(segment, identity), 'unsupported');
});

test('相邻不足 1 秒留下较早时间，超过 8 个丢掉多出的点，后到的更早点不改第一处顺序规则', () => {
  const payload = {
    schemaVersion: '1.0.0',
    origin: 'external',
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    duration: 30,
    points: [at(6, 'late'), at(1, 'early'), at(3.2, 'kept'), at(3.4, 'gap')]
  };
  const accepted = reading.acceptReading(payload, { ...identity, duration: 30 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.first.id, 'late');
  assert.deepEqual(accepted.points.map((item) => item.id), ['early', 'kept', 'late']);
  assert.equal(accepted.dropped.some((item) => item.reason === 'gap' && item.time === 3.4), true);
  assert.equal(reading.nextPoint(accepted.points, 6), null);
  assert.equal(reading.nextPoint(accepted.points, 3.2).id, 'late');

  const many = [];
  for (let index = 0; index < 9; index += 1) many.push(at(index * 2, 'p' + index));
  const capped = reading.acceptReading({ ...payload, points: many }, { ...identity, duration: 30 });
  assert.equal(capped.points.length, 8);
  assert.equal(capped.dropped.some((item) => item.reason === 'limit'), true);
});

test('一次只改一条直角边、半径或长度，零和另一类动作保持原值', () => {
  const point = triangle();
  const given = solve.copyGiven(point);
  const changed = solve.adjust(point, given, { type: 'set_leg', id: 'AB', value: 6 });
  assert.equal(changed.ok, true);
  assert.equal(changed.derived.hypotenuse.length, Math.hypot(6, 4));
  assert.equal(solve.formatLength(changed.derived.hypotenuse.length), '7.211');
  assert.equal(point.given.legs[0].length, 3);
  assert.equal(given.legs[0].length, 3);
  assert.equal(solve.adjust(point, given, { type: 'set_leg', id: 'AB', value: 0 }).ok, false);
  assert.equal(solve.adjust(point, given, { type: 'set_radius', value: 2 }).reason, 'unsupported');
  const circle = { kind: 'circle', given: { center: { label: 'O', x: 1, y: 2 }, radius: 5 } };
  const radius = solve.adjust(circle, circle.given, { type: 'set_radius', value: 8 });
  assert.equal(radius.given.radius, 8);
  assert.equal(circle.given.radius, 5);
});

test('阅读地址只留在本机，请求体不含指令、模型和超长说明', () => {
  assert.equal(request.buildLessonUrl('http://127.0.0.1:8787/read?x=1'), 'http://127.0.0.1:8787/geometry/lesson');
  assert.equal(request.buildLessonUrl('http://localhost:8787'), 'http://localhost:8787/geometry/lesson');
  assert.equal(request.buildLessonUrl('http://[::1]:8787/other'), 'http://[::1]:8787/geometry/lesson');
  for (const url of ['http://example.com', 'http://user:secret@127.0.0.1:8787', 'http://localhost.example.com']) {
    assert.throws(() => request.buildLessonUrl(url), (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.match(error.message, /请填写本机阅读地址/);
      assert.doesNotMatch(error.message, /https?:\/\//);
      return true;
    });
  }
  const frames = Array.from({ length: 9 }, (_, index) => ({ time: index, image: 'data:image/jpeg;base64,aa' }));
  const body = request.requestBody({
    readingId: 'reading-1',
    videoId: 'local-binding-1',
    duration: 9,
    frameSize: frame,
    frames,
    prompt: 'hidden',
    model: 'hidden'
  }, { ok: false, courseText: 'x'.repeat(8001) });
  assert.equal(body.frames.length, 8);
  assert.equal(body.courseText, '');
  assert.equal(Object.hasOwn(body, 'prompt'), false);
  assert.equal(Object.hasOwn(body, 'model'), false);
  assert.equal(reading.prepareCourse('x'.repeat(8001)).ok, false);
  assert.equal(reading.prepareCourse('直角').courseText, '直角');
});
