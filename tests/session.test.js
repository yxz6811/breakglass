const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../extension/src/session/session');

function result(requestId) {
  return {
    requestId,
    videoId: 'fixture-parabola',
    time: 12.5,
    frameSize: { width: 1920, height: 1080 },
    source: 'preset',
    fallback: null,
    definition: {
      equationId: 'fixture.parabola',
      parameters: {
        a: { initial: 1, min: 0.4, max: 1.2, step: 0.1 },
        h: { initial: 0, min: -2, max: 2, step: 0.1 },
        k: { initial: 0, min: -2, max: 2, step: 0.1 }
      },
      dragParameter: 'h',
      domain: { min: -4, max: 4 },
      range: { min: -4, max: 4 },
      yAxis: 'up',
      region: { x: 100, y: 80, width: 640, height: 360 }
    }
  };
}

function controller(options = {}) {
  return new SessionController({
    videoId: 'fixture-parabola',
    targetTime: 12.5,
    frameSize: { width: 1920, height: 1080 },
    ...options
  });
}

test('only wakes while paused at the target time', () => {
  const session = controller();
  assert.equal(session.beginWait({ paused: false, currentTime: 12.5 }).code, 'not_ready');
  assert.equal(session.beginWait({ paused: true, currentTime: 10 }).code, 'not_ready');
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).ok, true);
});

test('resolves, clamps the drag parameter and resets without leaving', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(pending.requestId)).ok, true);
  assert.equal(session.updateParameter('h', 99).session.currentParameters.h, 2);
  assert.equal(session.reset().session.currentParameters.h, 0);
  assert.equal(session.getState().status, 'interactive');
});

test('old request results cannot replace a newer wait', () => {
  const session = controller();
  const first = session.beginWait({ paused: true, currentTime: 12.5 });
  session.cancel();
  const second = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.resolve(result(first.requestId)).ok, false);
  assert.equal(session.resolve(result(second.requestId)).ok, true);
});

test('non-off external attempts can wait but a failed check never becomes interactive', () => {
  for (const externalAttempt of ['hang', 'invalid', 'late']) {
    const session = controller({ externalAttempt });
    const pending = session.beginWait({ paused: true, currentTime: 12.5 });
    assert.equal(pending.ok, true);
    assert.equal(session.getState().status, 'waiting');
    assert.equal(session.getState().result, null);

    const vision = result(pending.requestId);
    vision.source = 'vision';
    assert.equal(session.resolve(vision).ok, false);
    assert.notEqual(session.getState().status, 'interactive');
    assert.equal(session.getState().result, null);
    assert.equal(/识别成功/.test(JSON.stringify(session.getState())), false);

    const broken = result(pending.requestId);
    delete broken.definition;
    assert.equal(session.resolve(broken).ok, false);
    assert.notEqual(session.getState().status, 'interactive');
    assert.equal(session.getState().result, null);

    const accepted = session.resolve(result(pending.requestId));
    assert.equal(accepted.ok, true);
    assert.equal(session.getState().status, 'interactive');
    assert.equal(session.getState().result.source, 'preset');
    assert.equal(/识别成功/.test(JSON.stringify(session.getState())), false);
  }
});

test('only one session may be active at a time', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).code, 'session_active');
  assert.equal(session.resolve(result(pending.requestId)).ok, true);
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).code, 'session_active');
  session.exit();
  assert.equal(session.beginWait({ paused: true, currentTime: 12.5 }).ok, true);
});

test('playing or leaving the target time ends a pending or interactive session', () => {
  const waiting = controller();
  const pending = waiting.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(waiting.onPlaybackChange({ paused: false, currentTime: 12.5 }).status, 'paused-ready');
  assert.equal(waiting.resolve(result(pending.requestId)).ok, false);

  const interactive = controller();
  const request = interactive.beginWait({ paused: true, currentTime: 12.5 });
  assert.equal(interactive.resolve(result(request.requestId)).ok, true);
  assert.equal(interactive.onPlaybackChange({ paused: true, currentTime: 10 }).status, 'paused-ready');
  assert.equal(interactive.getState().result, null);
});

test('exit clears the active session and returns to paused-ready', () => {
  const session = controller();
  const pending = session.beginWait({ paused: true, currentTime: 12.5 });
  session.resolve(result(pending.requestId));
  assert.equal(session.exit().status, 'paused-ready');
  assert.equal(session.getState().result, null);
});
