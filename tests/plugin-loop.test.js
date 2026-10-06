const test = require('node:test');
const assert = require('node:assert/strict');
const { createVisualLoop } = require('../extension/src/plugin/live-loop');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('continuous recognition has one in-flight frame and schedules a fresh sample after completion', async () => {
  const gate = deferred(); let captures = 0; let reads = 0; const rendered = []; const timers = [];
  const loop = createVisualLoop({ capture: async () => ({ signature: `${++captures}`, frameTime: captures }),
    read: () => { reads += 1; return gate.promise; }, onResult: (result) => rendered.push(result),
    schedule: (fn) => { timers.push(fn); return timers.length; }, unschedule: () => {} });
  loop.start(); await flush();
  assert.equal(captures, 1); assert.equal(reads, 1); assert.equal(timers.length, 0);
  gate.resolve({ ok: true }); await flush();
  assert.equal(rendered.length, 1); assert.equal(timers.length, 1);
  timers.shift()(); await flush();
  assert.equal(captures, 2); assert.equal(reads, 2);
  loop.stop();
});

test('unchanged picture is not uploaded repeatedly', async () => {
  let reads = 0; const timers = [];
  const loop = createVisualLoop({ capture: async () => ({ signature: 'same-picture', frameTime: 2 }),
    read: async () => { reads += 1; return { ok: true }; }, onResult: () => {},
    schedule: (fn) => { timers.push(fn); return timers.length; }, unschedule: () => {} });
  loop.start(); await flush(); timers.shift()(); await flush();
  assert.equal(reads, 1); loop.stop();
});

test('stop aborts upstream and rejects late results even if upstream ignores cancellation', async () => {
  const gate = deferred(); let signal; let rendered = 0; const timers = [];
  const loop = createVisualLoop({ capture: async () => ({ signature: 'one', frameTime: 2 }),
    read: (frame, s) => { signal = s; return gate.promise; }, onResult: () => { rendered += 1; },
    schedule: (fn) => { timers.push(fn); return 1; }, unschedule: () => {} });
  loop.start(); await flush(); loop.stop(); assert.equal(signal.aborted, true);
  gate.resolve({ ok: true }); await flush();
  assert.equal(rendered, 0); assert.equal(timers.length, 0);
});

test('service/policy failure stops rather than building a retry queue', async () => {
  let calls = 0; let scheduled = 0; const notices = [];
  const loop = createVisualLoop({ capture: async () => ({ signature: 'one', frameTime: 2 }),
    read: async () => { calls += 1; return { ok: false, message: 'permission-pending' }; }, onResult: () => {},
    onStatus: (message) => notices.push(message), schedule: () => { scheduled += 1; return 1; } });
  loop.start(); await flush();
  assert.equal(loop.isRunning(), false); assert.equal(calls, 1); assert.equal(scheduled, 0);
  assert.ok(notices.includes('permission-pending'));
});
