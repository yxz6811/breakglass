/**
 * T028：内存计时。只记录状态、毫秒数和缓存状态。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLatencyLog } = require('../extension/src/telemetry/latency');

/**
 * @returns {{ now: () => number, advance: (ms: number) => void }}
 */
function clock() {
  let now = 0;
  return {
    now() {
      return now;
    },
    /**
     * @param {number} ms
     */
    advance(ms) {
      now += ms;
    }
  };
}

test('mark and measure keep only the elapsed milliseconds', () => {
  const time = clock();
  const log = createLatencyLog({ clock: time, cache: 'hot' });
  log.mark('timeout-decided');
  time.advance(40);
  log.mark('svg-visible');
  assert.equal(log.measure('timeout-decided', 'svg-visible'), 40);
  const summary = log.summary()['timeout-decided->svg-visible'];
  assert.equal(summary.count, 1);
  assert.equal(summary.p50, 40);
  assert.equal(summary.p95, 40);
  assert.equal(summary.max, 40);
  assert.equal(summary.cache, 'hot');
  assert.deepEqual(Object.keys(log.snapshot()['timeout-decided->svg-visible'][0]).sort(), ['cache', 'ms', 'status']);
});

test('summary reports p50 and p95 for the fallback-visible samples', () => {
  const log = createLatencyLog({ cache: 'hot' });
  for (const ms of [10, 20, 30, 40, 100]) log.record('fallback-visible', ms);
  const summary = log.summary()['fallback-visible'];
  assert.equal(summary.count, 5);
  assert.equal(summary.p50, 30);
  assert.equal(summary.p95, 100);
  assert.equal(summary.max, 100);
  assert.equal(summary.cache, 'hot');
});

test('a cold sample is labeled cold and mixed samples stay distinguishable', () => {
  const log = createLatencyLog({ cache: 'hot' });
  log.record('fallback-visible', 12);
  log.record('fallback-visible', 80, 'cold');
  assert.equal(log.summary()['fallback-visible'].cache, 'mixed');
  const cold = createLatencyLog({ cache: 'cold' });
  cold.record('fallback-visible', 15);
  assert.equal(cold.summary()['fallback-visible'].cache, 'cold');
});

test('excluded phases and bad numbers are not stored', () => {
  const log = createLatencyLog();
  for (const name of ['extension-open', 'video-first-frame', 'network-wait', 'p1-init']) {
    assert.equal(log.mark(name), null);
    assert.equal(log.record(name, 10), null);
  }
  assert.equal(log.record('fallback-visible', Number.NaN), null);
  assert.equal(log.record('fallback-visible', -1), null);
  assert.deepEqual(log.summary(), {});
  assert.equal(log.measure('missing', 'also-missing'), null);
});

test('the log stays in memory and the source does not persist or upload it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/telemetry/latency.js'), 'utf8');
  assert.equal(/fetch|XMLHttpRequest|WebSocket|indexedDB|chrome\.storage|localStorage|https?:/i.test(source), false);
  const log = createLatencyLog({ limit: 2 });
  log.record('fallback-visible', 1);
  log.record('fallback-visible', 2);
  log.record('fallback-visible', 3);
  assert.deepEqual(log.snapshot()['fallback-visible'].map((sample) => sample.ms), [2, 3]);
  log.reset();
  assert.deepEqual(log.summary(), {});
});
