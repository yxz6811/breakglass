const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('reinjecting the session file keeps its existing lifecycle owner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/plugin/session.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const first = context.BreakGlass.pluginSession;
  vm.runInContext(source, context);
  assert.equal(context.BreakGlass.pluginSession, first);
});
