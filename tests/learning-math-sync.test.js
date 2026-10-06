const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const math = require('../learning-site/math-learning');
const TIME = '2026-10-07T00:00:00.000Z';
const inputs = math.TEMPLATE_IDS.map((template) => ({ id: `record-${template}`, kind: 'question',
  source: { kind: 'manual-notes', id: `study-${template}`, version: '1', analysisVersion: '1', materialMode: 'self-authored' },
  time: 0, title: '我的手工数学', note: '主动保存的结构条件。', template, snapshot: math.templateInfo(template).defaults,
  origin: 'manual', sourceLabel: '学生手工条件，非视频识别', createdAt: TIME }));
const imports = ['../extension/src/curve/evaluate', '../extension/src/geometry-scene/validate', '../extension/src/plugin/math-learning',
  '../extension/src/plugin/contracts', '../extension/src/plugin/account-sync'];

test('canonical browser math validates account listing and actual sync queues for five manual types', async () => {
  const requests = []; let fixtureRecords = inputs;
  const context = vm.createContext({ AbortController, TextDecoder, setTimeout, clearTimeout, Date,
    fetch: async (url, options) => {
      requests.push({ url, options }); const common = { user: { id: 'account-a', username: 'student-a' }, epoch: 0, expiresAt: Date.now() + 600000 };
      let body = url.endsWith('/connect') ? { ...common, token: 't'.repeat(43) }
        : url.endsWith('/me') ? common : url.endsWith('/records') ? { epoch: 0, records: fixtureRecords }
          : { epoch: 0, record: JSON.parse(options.body).record };
      return new Response(JSON.stringify(body));
    } });
  for (const file of imports) vm.runInContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  // This pure-data clone double keeps objects in the same JS realm, as browser cloning does.
  vm.runInContext(`globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
    let storedQueue = null, pairedSession = null;
    globalThis.sync = BreakGlass.pluginAccountSync.createSync({
      getQueue: async()=>storedQueue, setQueue:async(v)=>{storedQueue=v;},
      getSession:async()=>pairedSession,setSession:async(v)=>{pairedSession=v;},fetch,
      clientOrigin:'chrome-extension://${'a'.repeat(32)}',validateRecord:BreakGlass.pluginContracts.validateRecord
    });`, context);
  await vm.runInContext(`sync.connect('${'c'.repeat(22)}',true)`, context);
  const response = await vm.runInContext('sync.accountRecords()', context);
  assert.equal(response.records.length, 5); assert.deepEqual(JSON.parse(JSON.stringify(response.records)), inputs);
  context.inputsJSON = JSON.stringify(inputs);
  const statuses = await vm.runInContext('(async()=>{const statuses=[];for(const record of JSON.parse(inputsJSON)) statuses.push((await sync.enqueue(record)).syncStatus);return statuses;})()', context);
  assert.deepEqual(Array.from(statuses), ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed']);
  assert.equal(requests.filter((r) => r.options.method === 'PUT').length, 5);
  fixtureRecords = [{ ...inputs[0], origin: 'vision' }]; await assert.rejects(vm.runInContext('sync.accountRecords()', context), /结构不符/);
});

test('worker imports, controlled injection and status page load the same canonical math before consumers', () => {
  const root = path.join(__dirname, '..');
  const worker = fs.readFileSync(path.join(root, 'extension/src/background/service-worker.js'), 'utf8');
  const importLine = (name) => ['import', `'../plugin/${name}.js';`].join(' ');
  assert.ok(worker.indexOf(importLine('math-learning')) < worker.indexOf(importLine('contracts')));
  const injected = worker.slice(worker.indexOf('const files = ['));
  assert.ok(injected.indexOf("'src/plugin/math-learning.js'") < injected.indexOf("'src/plugin/contracts.js'"));
  const page = fs.readFileSync(path.join(root, 'extension/plugin/status.html'), 'utf8');
  assert.ok(page.indexOf('src/plugin/math-learning.js') < page.indexOf('src="status.js"'));
  assert.match(fs.readFileSync(path.join(root, 'extension/plugin/status.js'), 'utf8'), /mathLearning\.equation\(record\.template, record\.snapshot\)/);
  assert.equal(require('../learning-site/math-learning'), require('../extension/src/plugin/math-learning'));
});
