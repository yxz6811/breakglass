import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHarness, deferred, flush } from './helpers/workspace-harness.mjs';

const scene = { origin: 'exploration', confirmed: true, template: 'parabola', snapshot: { a: 2, h: -3, k: 1 } };
const permission = fixture => fixture.node('.workspace-reader-permission input');
const saveForm = fixture => fixture.node('.workspace-save-scene');
const saveButton = fixture => saveForm(fixture).querySelector('button[type="submit"]');
const stops = fixture => ['curve', 'geometry', 'recognition'].map(kind => fixture.controllers[kind].at(-1).stopCount);
async function readyFixture(options) {
  const fixture = createWorkspaceHarness(options); fixture.execute(); await fixture.BreakGlass.workspace.ready;
  assert.equal(fixture.BreakGlass.workspace?.snapshot().state, 'ready', fixture.document.body.textContent);
  return fixture;
}
function assertOriginalDOM(fixture) {
  assert.equal(fixture.original.parentNode, fixture.document.body, 'Original demo is returned to the body');
  assert.equal(fixture.stage.parentNode, fixture.original, 'The sole video stage returns to its original parent');
  assert.equal(fixture.document.getElementById('demo-video'), fixture.video, 'Controller namespacing is restored');
  assert.equal(fixture.document.getElementById('current-frame-help')?.parentNode, fixture.original);
  assert.equal(fixture.nodes('#learning-workspace-root').length, 0);
  assert.equal(fixture.nodes('style').length, 0, 'Owned scoped styles are removed');
  assert.equal(fixture.nodes('script').length, 0, 'Owned dependency script elements are removed');
  assert.equal(fixture.stage.children.length, 2, 'The imported geometry banner is removed');
}

test('workspace exposes destroy during module loading and rejects late script completion', async () => {
  const fixture = createWorkspaceHarness({ holdScript: () => true }); fixture.execute();
  const workspace = fixture.BreakGlass.workspace;
  assert.equal(workspace.snapshot().state, 'initializing');
  assert.equal(fixture.scripts.length, 1);
  const lateLoad = fixture.scripts[0].node.onload;
  workspace.destroy(); await workspace.ready;
  lateLoad(); await flush();
  assert.equal(workspace.snapshot().state, 'destroyed');
  assert.equal(fixture.BreakGlass.workspace, null);
  assert.equal(fixture.mounts.length, 0);
  assert.equal(fixture.fetches.length, 0);
  assertOriginalDOM(fixture);
});

test('reexecuting the entry script during initialization and after mount never creates a second workspace', async () => {
  const fixture = createWorkspaceHarness({ holdScript: (_path, count) => count === 1 }); fixture.execute();
  const workspace = fixture.BreakGlass.workspace;
  fixture.execute(); assert.equal(fixture.BreakGlass.workspace, workspace); assert.equal(fixture.scripts.length, 1);
  await fixture.scripts[0].load(); await workspace.ready;
  assert.equal(workspace.snapshot().state, 'ready');
  fixture.execute(); await flush();
  assert.equal(fixture.BreakGlass.workspace, workspace);
  assert.equal(fixture.nodes('#learning-workspace-root').length, 1);
  for (const kind of ['learning', 'curve', 'geometry', 'recognition', 'particles']) assert.equal(fixture.controllers[kind].length, 1);
  await fixture.destroy(); assertOriginalDOM(fixture);
});

test('destroy while markup is pending aborts resource signals and restores the original demo before late results', async () => {
  const gate = deferred();
  const fixture = createWorkspaceHarness({ fetchGates: new Map([['/learning-site/index.html', gate]]) }); fixture.execute();
  const workspace = fixture.BreakGlass.workspace; await flush();
  assert.ok(fixture.fetches.length >= 1);
  assert.equal(fixture.nodes('#learning-workspace-root').length, 1);
  workspace.destroy(); assert.ok(fixture.fetches.every(request => request.signal?.aborted));
  assertOriginalDOM(fixture);
  gate.resolve(); await workspace.ready; await flush();
  assert.equal(fixture.mounts.length, 0);
  assert.equal(fixture.nodes('.workspace-error').length, 0, 'Intentional destruction does not show a loading failure');
  assertOriginalDOM(fixture);
});

test('a partial controller failure releases mounted resources and permits a clean button retry', async () => {
  let failOnce = true;
  const fixture = createWorkspaceHarness({ failMount: kind => { if (kind === 'geometry' && failOnce) { failOnce = false; return true; } return false; } });
  fixture.execute(); const failed = fixture.BreakGlass.workspace; await failed.ready;
  assert.equal(failed.snapshot().state, 'failed'); assert.equal(fixture.BreakGlass.workspace, null);
  for (const kind of ['learning', 'curve', 'particles']) assert.equal(fixture.controllers[kind][0].destroyCount, 1, `${kind} was already mounted`);
  assertOriginalDOM(fixture);
  const retry = fixture.node('.workspace-error button'); assert.ok(retry); assert.match(retry.textContent, /重新加载|重试/);
  await retry.click(); await fixture.BreakGlass.workspace.ready;
  assert.equal(fixture.BreakGlass.workspace.snapshot().state, 'ready');
  assert.equal(fixture.nodes('.workspace-error').length, 0);
  assert.equal(fixture.nodes('#learning-workspace-root').length, 1);
  await fixture.destroy(); assertOriginalDOM(fixture);
  assert.ok(fixture.created.every(node => node.listenerCount() === 0), 'Every workspace-owned control handler has been removed');
});

test('reader off, reenable, source identity, account epoch, permission loss and hidden page each invalidate all readers', async () => {
  const fixture = await readyFixture();
  try {
    const workspace = fixture.BreakGlass.workspace; const curve = fixture.controllers.curve[0];
    workspace.activate('curve'); const optIn = permission(fixture);
    async function invalidates(action, enabled) {
      const before = curve.options.getPermissionGeneration(); const stopCounts = stops(fixture);
      await action();
      assert.ok(curve.options.getPermissionGeneration() > before, 'Permission generations only advance');
      assert.ok(stops(fixture).every((count, index) => count > stopCounts[index]), 'Each reader receives an immediate stop hook');
      assert.equal(curve.options.canRead(), enabled);
    }
    await invalidates(async () => { optIn.checked = true; await optIn.emit('change'); }, true);
    const firstEnabled = curve.options.getPermissionGeneration();
    await invalidates(async () => { optIn.checked = false; await optIn.emit('change'); }, false);
    await invalidates(async () => { optIn.checked = true; await optIn.emit('change'); }, true);
    assert.ok(curve.options.getPermissionGeneration() > firstEnabled, 'Reenable cannot reuse a request from the old permission interval');
    await invalidates(() => fixture.setMedia({ generation: 2 }), false);
    optIn.checked = true; await optIn.emit('change');
    await invalidates(() => fixture.setMedia({ source: { id: 'second-authorized', version: '1' },
      selection: { name: '另一自制回归视频', source: { id: 'second-authorized', version: '1' } } }), false);
    optIn.checked = true; await optIn.emit('change');
    await invalidates(() => fixture.setTarget({ scope: 'account', label: '账户 Alice', owner: 'account:alice:epoch-1', epoch: 1 }), false);
    optIn.checked = true; await optIn.emit('change');
    await invalidates(() => fixture.setTarget({ epoch: 2, owner: 'account:alice:epoch-2' }), false);
    optIn.checked = true; await optIn.emit('change');
    await invalidates(() => fixture.setMedia({ policy: { allowed: false } }), false);
    fixture.setMedia({ policy: { allowed: true } }); optIn.checked = true; await optIn.emit('change');
    await invalidates(async () => { fixture.document.visibilityState = 'hidden'; await fixture.document.emit('visibilitychange'); }, false);
    fixture.document.visibilityState = 'visible'; await fixture.document.emit('visibilitychange');
    assert.equal(optIn.checked, false, 'Returning to the page does not enable reading');
    assert.equal(curve.options.canRead(), false);
    const before = curve.options.getPermissionGeneration(); const stopCounts = stops(fixture);
    await fixture.destroy();
    assert.ok(curve.options.getPermissionGeneration() > before);
    assert.ok(stops(fixture).every((count, index) => count > stopCounts[index]));
    assert.equal(curve.options.canRead(), false);
  } finally { await fixture.destroy(); }
});

test('actual save scope is shown beside the action and unavailable scope prevents a success or a save request', async () => {
  const fixture = await readyFixture();
  try {
    const workspace = fixture.BreakGlass.workspace; workspace.activate('curve');
    fixture.controllers.curve[0].options.onScene({ ...scene });
    const scope = fixture.node('.workspace-save-scope');
    assert.ok(saveForm(fixture).contains(scope)); assert.match(scope.textContent, /本机访客/);
    assert.equal(scope.textContent.includes('logged-in-but-local'), false, 'A login label cannot stand in for the selected storage scope');
    assert.equal(saveButton(fixture).disabled, false);
    fixture.setTarget({ scope: 'account', label: '账户 Alice', owner: 'account:alice:epoch-1', epoch: 1, canSave: false });
    assert.match(scope.textContent, /Alice/); assert.equal(saveButton(fixture).disabled, true);
    assert.equal(saveForm(fixture).hidden, true, 'The previous owner\'s scene is no longer a save candidate');
    assert.equal(fixture.BreakGlass.workspace.snapshot().particle, null);
    const changedMedia = fixture.controllers.curve[0].mediaChanges.at(-1);
    assert.equal(changedMedia.owner, 'account:alice:epoch-1'); assert.equal(changedMedia.epoch, 1);
    await saveForm(fixture).emit('submit');
    assert.equal(fixture.saves.length, 0); assert.equal(fixture.opened.length, 0);
    assert.equal(saveForm(fixture).textContent.includes('已保存'), false);
    fixture.setTarget({ canSave: true });
    assert.equal(saveButton(fixture).disabled, true, 'Restoring save availability does not resurrect the former owner\'s mathematics');
    fixture.controllers.curve[0].options.onScene({ ...scene });
    assert.equal(saveButton(fixture).disabled, false);
    await saveForm(fixture).emit('submit');
    assert.equal(fixture.saves.length, 1); assert.equal(fixture.opened[0].scope, 'account');
    assert.match(saveForm(fixture).textContent, /已保存到.*Alice/);
  } finally { await fixture.destroy(); }
});

test('reader cancellation leaves previously confirmed mathematics available for manual save', async () => {
  const fixture = await readyFixture();
  try {
    fixture.BreakGlass.workspace.activate('geometry'); fixture.controllers.geometry[0].options.onScene({ ...scene });
    const optIn = permission(fixture); optIn.checked = true; await optIn.emit('change');
    optIn.checked = false; await optIn.emit('change');
    assert.equal(saveForm(fixture).hidden, false); assert.equal(saveButton(fixture).disabled, false);
    await saveForm(fixture).emit('submit'); assert.equal(fixture.saves.length, 1);
  } finally { await fixture.destroy(); }
});

test('destroy cleans listeners and a completed save from a former epoch cannot navigate or report success', async () => {
  const gate = deferred(); const fixture = await readyFixture({ beforeSave: () => gate.promise });
  try {
    fixture.BreakGlass.workspace.activate('curve'); fixture.controllers.curve[0].options.onScene({ ...scene });
    const oldForm = saveForm(fixture); const pending = oldForm.emit('submit');
    fixture.setTarget({ owner: 'local:epoch-1', epoch: 1 });
    gate.resolve(); await pending;
    assert.equal(fixture.opened.length, 0); assert.equal(oldForm.textContent.includes('已保存'), false);
    const oldCheckbox = permission(fixture); const curve = fixture.controllers.curve[0];
    await fixture.destroy(); const count = curve.stopCount;
    await oldCheckbox.emit('change'); await fixture.document.emit('visibilitychange'); await fixture.window.emit('pagehide');
    assert.equal(curve.stopCount, count, 'Detached controls and page events cannot reach a destroyed controller');
    assert.equal(fixture.document.listenerCount(), 0); assert.equal(fixture.window.listenerCount(), 0);
    assert.ok(fixture.created.every(node => node.listenerCount() === 0));
    assertOriginalDOM(fixture);
  } finally { gate.resolve(); await fixture.destroy(); }
});

test('a pending save cannot claim success after the same storage owner becomes unavailable', async () => {
  const gate = deferred(); const fixture = await readyFixture({ beforeSave: () => gate.promise });
  try {
    fixture.BreakGlass.workspace.activate('curve'); fixture.controllers.curve[0].options.onScene({ ...scene });
    const form = saveForm(fixture); const pending = form.emit('submit');
    fixture.setTarget({ canSave: false });
    assert.equal(saveButton(fixture).disabled, true);
    gate.resolve(); await pending;
    assert.equal(fixture.opened.length, 0, 'An unavailable save target cannot open a new success result');
    assert.equal(form.textContent.includes('已保存'), false);
  } finally { gate.resolve(); await fixture.destroy(); }
});

test('an unchanged media snapshot during a confirmed save keeps the valid result visible', async () => {
  const gate = deferred(); const fixture = await readyFixture({ beforeSave: () => gate.promise });
  try {
    fixture.BreakGlass.workspace.activate('curve'); fixture.controllers.curve[0].options.onScene({ ...scene });
    const form = saveForm(fixture); const pending = form.emit('submit');
    fixture.setMedia({ policy: { allowed: true } });
    gate.resolve(); await pending;
    assert.equal(fixture.opened.length, 1); assert.match(form.textContent, /已保存到.*本机访客/);
  } finally { gate.resolve(); await fixture.destroy(); }
});

test('destroy followed by a new entry execution mounts against the restored original IDs once', async () => {
  const fixture = await readyFixture();
  fixture.BreakGlass.workspace.activate('geometry'); await fixture.destroy(); assertOriginalDOM(fixture);
  fixture.execute(); await fixture.BreakGlass.workspace.ready;
  assert.equal(fixture.BreakGlass.workspace.snapshot().state, 'ready');
  assert.equal(fixture.nodes('#learning-workspace-root').length, 1);
  assert.equal(fixture.nodes('video').length, 1);
  for (const kind of ['learning', 'curve', 'geometry', 'recognition', 'particles']) assert.equal(fixture.controllers[kind].length, 2);
  await fixture.destroy(); assertOriginalDOM(fixture);
  assert.ok(fixture.created.every(node => node.listenerCount() === 0));
});

test('an unconfirmed curve displays a student confirmation action and cannot be saved by submitting its form', async () => {
  const fixture = await readyFixture();
  try {
    fixture.BreakGlass.workspace.activate('curve'); const curve = fixture.controllers.curve[0];
    const candidate = { ...scene, confirmed: false, requiresConfirmation: true };
    curve.options.onScene(candidate);
    const form = saveForm(fixture); const confirm = form.children.find(node => node.tagName === 'BUTTON' && node.type === 'button');
    assert.ok(confirm); assert.match(confirm.textContent, /核对/); assert.equal(confirm.hidden, false);
    assert.equal(form.hidden, false); assert.equal(saveButton(fixture).disabled, true);
    await form.emit('submit'); assert.equal(fixture.saves.length, 0);
    let confirmations = 0;
    curve.confirmScene = () => { confirmations += 1; curve.options.onScene({ ...candidate, confirmed: true, requiresConfirmation: false }); };
    await confirm.click(); assert.equal(confirmations, 1); assert.equal(confirm.hidden, true);
    assert.equal(saveButton(fixture).disabled, false);
    await form.emit('submit'); assert.equal(fixture.saves.length, 1);
  } finally { await fixture.destroy(); }
});

test('explicit destruction of a failed initialization retires its retry action', async () => {
  const fixture = createWorkspaceHarness({ failMount: kind => kind === 'geometry' }); fixture.execute();
  const failed = fixture.BreakGlass.workspace; await failed.ready;
  const retry = fixture.node('.workspace-error button'); assert.ok(retry);
  failed.destroy(); const before = fixture.scripts.length;
  await retry.click(); await flush();
  assert.equal(fixture.scripts.length, before, 'A retained failed runtime cannot restart after explicit destruction');
  assert.equal(retry.listenerCount(), 0);
  assert.equal(fixture.nodes('.workspace-error').length, 0);
});

test('destroy retires its geometry dock from the shared registry while preserving unrelated docks', async () => {
  const fixture = await readyFixture({ withDock: true });
  const dock = fixture.createdDocks[0]; assert.ok(dock);
  assert.ok(fixture.window.BreakGlassUI.docks.includes(dock));
  await fixture.destroy();
  assert.equal(dock.destroyCount, 1);
  assert.deepEqual(Array.from(fixture.window.BreakGlassUI.docks), [fixture.existingDock]);
  fixture.execute(); await fixture.BreakGlass.workspace.ready;
  assert.equal(fixture.window.BreakGlassUI.docks.length, 2, 'A replacement mount has exactly one new owned dock');
  await fixture.destroy();
  assert.deepEqual(Array.from(fixture.window.BreakGlassUI.docks), [fixture.existingDock]);
});

test('same-owner account refresh preserves the learning scene in the import panel, but changed owner clears it', async () => {
 const fixture=await readyFixture();
 try {
  fixture.controllers.learning[0].options.onScene({...scene});
  assert.ok(fixture.BreakGlass.workspace.snapshot().particle);
  fixture.setTarget({canSave:false});assert.ok(fixture.BreakGlass.workspace.snapshot().particle);
  fixture.setTarget({canSave:true});assert.ok(fixture.BreakGlass.workspace.snapshot().particle);
  fixture.setTarget({owner:'account:other:epoch-0',scope:'account',label:'其他测试账户'});
  assert.equal(fixture.BreakGlass.workspace.snapshot().particle,null);
 } finally {await fixture.destroy();}
});
