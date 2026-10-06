import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLearningSiteServer } from './learning-site.mjs';
import { createLabServer } from './learning-lab.mjs';
import { createReaderServer } from '../breakglass-reader/src/server.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
import pageRules from '../extension/src/lesson/reading.js';

// Actual MV3, browser media decoding and account HTTP. All model inference is
// an explicitly injected transport stub; no provider, public platform or keys.
const repo = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'breakglass-connected-' + Date.now()));
const relative = path.relative(repo, output);
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Evidence/account data must remain outside repository.');
fs.mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.BREAKGLASS_TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.BREAKGLASS_TEST_PLAYWRIGHT_MODULE)).href : 'playwright');
const evidence = { status: 'running', actualMV3: true, actualAccountHTTP: true, model: 'explicit injected transport stub',
  realModelVerified: false, publicDeploymentVerified: false, bilibiliPermissionVerified: false, learningEffectVerified: false,
  checks: {}, screenshots: [], errors: [], calls: { read: 0, summary: 0, context: 0 }, contextCoverage: [],
  environment: { platform: os.platform(), node: process.version } };
const candidate = () => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
  area: { x: 0.3, y: 0.3, width: 0.4, height: 0.35 }, title: '直角三角形',
  explanation: '核对A为直角顶点，两条直角边由题面给定，斜边由数学程序计算。', pitfallHint: '斜边不能直接把两条直角边相加。' });
const provider = async (_url, init) => {
  const input = JSON.parse(init.body); const system = input.messages[0].content;
  let answer;
  if (system.includes('本次仅收到按时间排序的稀疏截图')) {
    evidence.calls.context += 1;
    const parts = input.messages[1].content;
    const meta = JSON.parse(parts[0].text);
    const times = parts.filter((part) => part.type === 'text' && part.text.startsWith('截图 frameTime='))
      .map((part) => Number(/frameTime=([\d.]+)/.exec(part.text)[1]));
    evidence.contextCoverage.push({ observedTimes: times, jpegCount: parts.filter((part) => part.type === 'image_url').length,
      authorCueCount: meta.authorCues.length, hasAudio: false, hasFullFile: false });
    answer = { summary: '这组稀疏画面与作者字幕涉及直角三角形边长关系。', keyPoints: ['确认直角与单位'],
      pitfalls: ['边长不能直接相加'], objects: times.map((frameTime) => ({ frameTime, result: candidate() })) };
  } else if (input.messages.some((message) => Array.isArray(message.content))) {
    evidence.calls.read += 1; answer = candidate();
  } else {
    evidence.calls.summary += 1; answer = { summary: '已观察的画面涉及两条直角边。', keyPoints: ['统一单位'], pitfalls: ['直接相加不是斜边'] };
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { headers: { 'content-type': 'application/json' } });
};
const settings = loadSettings({ READER_BASE_URL: 'http://explicit-stub.invalid', READER_API_KEY: 'injected-test-only', READER_MODEL: 'explicit-stub' });
let site = createLearningSiteServer({ settings, dataDir: path.join(output, 'private-account-data'), fetchImpl: provider });
const labServer = createLabServer();
let reader = createReaderServer({ settings, pageRules, fetchImpl: provider });
const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
const close = async (server) => { if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
await Promise.all([listen(site, 4174), listen(labServer, 4173), listen(reader, 8787)]);
let context; let web; let lab; let ext;
const step = async (name, action) => { await action(); evidence.checks[name] = true; };
const shot = async (page, name) => { const target = path.join(output, name + '.png'); await page.screenshot({ path: target, fullPage: true }); evidence.screenshots.push(name + '.png'); };
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });
const nav = async (name) => { await web.bringToFront(); await web.locator('.site-sidebar [data-view="' + name + '"]').click(); };
async function api(method, route, body) {
  return web.evaluate(async ({ method, route, body }) => {
    const me = await (await fetch('/api/account/me')).json();
    const response = await fetch(route, { method, headers: { 'content-type': 'application/json', 'X-BreakGlass-CSRF': me.csrfToken || '' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, value: await response.json() };
  }, { method, route, body });
}
async function message(type, rest = {}, expectOK = true) {
  const value = await ext.evaluate((input) => chrome.runtime.sendMessage(input), { type, ...rest });
  if (expectOK) assert.equal(value.ok, true, value.message); return value;
}
async function register(name) {
  await nav('account'); await web.locator('#username').fill(name); await web.locator('#password').fill('only-local-test-password');
  await web.locator('#register').click(); await wait(web, () => document.querySelector('#account-status').textContent.includes('当前账户：'));
}
async function freshPluginMath() {
  await lab.bringToFront();
  await lab.evaluate(() => { document.querySelector('video').pause(); document.querySelector('video').currentTime = 4; });
  await wait(lab, () => !document.querySelector('video').seeking && document.querySelector('video').readyState >= 2);
  await lab.getByRole('button', { name: '开始持续视觉识别', exact: true }).click();
  await lab.locator('.bg-point-list button').first().click(); await lab.locator('.bg-confirm input').check();
  await lab.getByRole('button', { name: '确认条件并探索', exact: true }).click();
}
async function savePlugin(note, synced) {
  await lab.getByRole('textbox', { name: '我的疑问或易错提醒（先存本机，账号同步按配对设置）', exact: true }).fill(note);
  await lab.getByRole('button', { name: '保存疑问', exact: true }).click();
  await lab.getByText(synced ? '疑问已保存到本机。 当前配对账号已确认同步。' : '疑问已保存到本机。', { exact: true }).waitFor();
}
try {
  context = await chromium.launchPersistentContext(path.join(output, 'private-browser-profile'), { executablePath: process.env.BREAKGLASS_TEST_BROWSER_EXECUTABLE || undefined,
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'], viewport: { width: 1440, height: 1000 } });
  evidence.browser = await context.browser().version();
  context.on('page', (page) => { page.on('pageerror', (error) => evidence.errors.push(error.message)); page.on('dialog', (dialog) => void dialog.accept()); });
  const cdp = await context.browser().newBrowserCDPSession(); const extension = await cdp.send('Extensions.loadUnpacked', { path: path.join(repo, 'extension') });
  web = await context.newPage(); await web.goto('http://localhost:4174/learning-site/index.html');
  await register('connected_a_' + Date.now().toString(36));
  lab = await context.newPage(); await lab.goto('http://localhost:4173/learning-lab/lesson.html');
  await wait(lab, () => document.querySelector('video').readyState >= 2);
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const target = targetInfos.find((value) => value.url === lab.url()); assert.ok(target);
  await cdp.send('Extensions.triggerAction', { id: extension.id, targetId: target.targetId });
  await step('actualMV3NoUploadBeforeExplicitStart', async () => {
    await lab.getByRole('button', { name: '开始持续视觉识别', exact: true }).waitFor(); assert.equal(evidence.calls.read, 0);
    await freshPluginMath(); await savePlugin('配对前疑问', false);
  });
  ext = await context.newPage(); await ext.goto(`chrome-extension://${extension.id}/plugin/status.html`);
  await step('websiteCodeAndRealExtensionPairingWithoutGuestMigration', async () => {
    await nav('account'); await web.locator('#create-pairing').click();
    await wait(web, () => document.querySelector('#pairing-code').textContent.length === 22);
    const code = await web.locator('#pairing-code').textContent();
    await ext.bringToFront(); await ext.locator('#pair-code').fill(code); await ext.locator('#pair-enabled').check();
    await ext.getByRole('button', { name: '配对账号', exact: true }).click();
    await wait(ext, () => document.querySelector('#account-status').textContent.includes('当前配对账号：'));
    const state = await message('plugin:account:state'); assert.equal(state.enabled, true); assert.equal(state.queued, 0);
    assert.equal(Object.hasOwn(state, 'token'), false); assert.equal((await api('GET', '/api/learning/records')).value.records.length, 0);
    const secretsIsolated = await ext.evaluate(async () => {
      const local = await chrome.storage.local.get(null); const session = await chrome.storage.session.get(null);
      const serialized = JSON.stringify(local); const sessionToken = Object.values(session).find((value) => value?.token)?.token;
      return Boolean(sessionToken && !serialized.includes(sessionToken));
    });
    assert.equal(secretsIsolated, true); evidence.checks.tokenOnlyWorkerSession = true;
    await shot(ext, 'connected-plugin-paired');
  });
  await step('futureSaveConfirmsSameAccountAndWatchMetadata', async () => {
    await freshPluginMath(); await savePlugin('配对后自动同步疑问', true);
    assert.equal((await api('GET', '/api/learning/records')).value.records.length, 1);
    await lab.evaluate(() => document.querySelector('video').play()); await lab.waitForTimeout(1000);
    await lab.evaluate(() => document.querySelector('video').pause());
    await wait(ext, async () => { const result = await chrome.runtime.sendMessage({ type: 'plugin:account:state' }); return !result.syncing; });
    const watch = (await api('GET', '/api/learning/watch')).value.items;
    assert.ok(watch.some((item) => item.source.id === 'pilot-triangle-3-4-5' && item.time > 4));
    await shot(lab, 'connected-save-and-watch');
  });
  await step('explicitSelectedOldGuestImport', async () => {
    const local = await message('plugin:list'); const old = local.records.find((record) => record.note === '配对前疑问'); assert.ok(old);
    await ext.bringToFront(); await ext.locator('#refresh').click();
    await ext.getByRole('checkbox', { name: '审核并选择：' + old.title, exact: true }).first().check();
    await ext.locator('#import-selected').click();
    await wait(ext, () => document.querySelector('#account-status').textContent.includes('待同步记录 0 条'));
    const after = (await api('GET', '/api/learning/records')).value.records; assert.ok(after.some((record) => record.id === old.id));
    assert.equal((await message('plugin:account:state')).enabled, true);
  });
  await step('offlineQueueExplicitRetrySameAccount', async () => {
    await freshPluginMath(); await close(site);
    await lab.getByRole('textbox', { name: '我的疑问或易错提醒（先存本机，账号同步按配对设置）', exact: true }).fill('离线保留疑问');
    await lab.getByRole('button', { name: '保存疑问', exact: true }).click();
    await lab.getByText('疑问已保存到本机。 账号尚未确认，请到插件记录页检查待同步队列。', { exact: true }).waitFor();
    assert.equal((await message('plugin:account:state')).queued, 1);
    await listen(site, 4174); await message('plugin:account:retry');
    assert.equal((await message('plugin:account:state')).queued, 0);
    assert.ok((await api('GET', '/api/learning/records')).value.records.some((record) => record.note === '离线保留疑问'));
  });
  await step('shortWindowAuthorSubtitlesActualIndependentDecodeAndCandidate', async () => {
    await nav('import'); await web.locator('#sample-triangle').click();
    await wait(web, () => !document.querySelector('#analyze-context').disabled);
    await web.evaluate(() => { document.querySelector('#learning-video').pause(); document.querySelector('#learning-video').currentTime = 4; });
    await wait(web, () => !document.querySelector('#learning-video').seeking && document.querySelector('#learning-video').readyState >= 2);
    await web.locator('#context-start').fill('2'); await web.locator('#context-end').fill('8'); await web.locator('#analyze-context').click();
    await web.getByRole('heading', { name: 'AI片段候选总结 · 需校对', exact: true }).waitFor();
    assert.equal(await web.locator('#learning-video').evaluate((video) => video.currentTime), 4);
    assert.match(await web.locator('#context-result').textContent(), /4张稀疏画面＋登记作者字幕/);
    assert.equal(evidence.contextCoverage.at(-1).jpegCount, 4); assert.ok(evidence.contextCoverage.at(-1).authorCueCount > 0);
    await shot(web, 'connected-context-subtitles');
    await web.locator('#context-result button').first().click(); await web.locator('.bg-point-list button').first().click();
    await web.locator('.bg-confirm input').check(); await web.getByRole('button', { name: '确认条件并探索', exact: true }).click();
    await web.getByRole('textbox', { name: '我的疑问或易错提醒', exact: true }).fill('片段中仍要核对直角边');
    await web.getByRole('button', { name: '保存疑问', exact: true }).click();
    await web.getByText('记录已由当前账号服务确认保存。', { exact: true }).waitFor();
    assert.ok((await api('GET', '/api/learning/records')).value.records.some((record) => record.sourceLabel.includes('作者字幕') && record.origin === 'vision'));
    await web.locator('#cancel-context').click(); assert.equal(await web.locator('[data-breakglass-learning]').count(), 0);
    assert.equal(await web.locator('#context-result button').count(), 0);
  });
  await step('predictionThreeHintsSeparateVariantAndExplanationActualAnswers', async () => {
    await nav('records'); await web.locator('#refresh-center').click();
    await web.locator('#record-list .record-card').filter({ hasText: '片段中仍要核对直角边' }).getByRole('button', { name: '恢复数学场景 / 复练', exact: true }).click();
    await web.getByRole('button', { name: '增加', exact: true }).click();
    assert.match(await web.locator('#prediction-status').textContent(), /与数学关系一致/);
    const before = (await api('GET', '/api/learning/attempts')).value.attempts.length;
    await web.locator('#apply-prediction').click(); await web.locator('#scene-reset').click();
    for (let index = 0; index < 3; index += 1) await web.locator('#show-hint').click();
    assert.match(await web.locator('#show-hint').textContent(), /3\/3/);
    assert.equal((await api('GET', '/api/learning/attempts')).value.attempts.length, before);
    await web.locator('#practice-number').fill('5'); await web.locator('#submit-practice').click();
    await wait(web, () => document.querySelector('#practice-status').textContent.includes('使用提示完成'));
    const originals = (await api('GET', '/api/learning/records')).value.records;
    await web.locator('#create-variant').click(); await wait(web, () => document.querySelector('#pedagogy-status').textContent.includes('程序变式已单独保存'));
    const after = (await api('GET', '/api/learning/records')).value.records;
    const variant = after.find((record) => !originals.some((item) => item.id === record.id)); assert.ok(variant);
    assert.equal(variant.origin, 'manual'); assert.equal(variant.source.kind, 'manual-notes'); assert.notDeepEqual(variant.snapshot, { AB: 3, AC: 4, unit: 'cm' });
    await web.locator('#practice-number').fill(String(Math.hypot(variant.snapshot.AB, variant.snapshot.AC)));
    await web.locator('#submit-practice').click(); await wait(web, () => document.querySelector('#practice-status').textContent.includes('本次独立答对'));
    await web.locator('#self-explanation').fill('先确认直角，再用两条直角边的平方和求斜边。'); await web.locator('#save-explanation').click();
    await wait(web, () => document.querySelector('#pedagogy-status').textContent.includes('没有自动评分'));
    const attempts = (await api('GET', '/api/learning/attempts')).value.attempts;
    assert.equal(attempts.length, before + 2); assert.equal(attempts.at(-1).recordId, variant.id); assert.equal(attempts.at(-1).outcome, 'correct_independent');
    await shot(web, 'connected-prediction-variant');
    await web.setViewportSize({ width: 390, height: 844 });
    assert.equal(await web.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); await shot(web, 'connected-practice-mobile');
    await web.setViewportSize({ width: 1440, height: 1000 });
  });
  await step('parabolaPredictionAndIndependentVariantUseActualVertexMath', async () => {
    await nav('import'); await web.locator('#manual-explore').click();
    const expand = web.getByRole('button', { name: '展开独立学习面板，不遮挡视频播放器', exact: true });
    if (await expand.isVisible()) await expand.click();
    await web.getByRole('button', { name: '校对当前条件', exact: true }).click();
    await web.locator('.bg-confirm input').check(); await web.getByRole('button', { name: '生成手工候选并探索', exact: true }).click();
    await web.getByRole('textbox', { name: '我的疑问或易错提醒', exact: true }).fill('手工二次函数平移');
    await web.getByRole('button', { name: '保存疑问', exact: true }).click(); await web.getByText('记录已由当前账号服务确认保存。', { exact: true }).waitFor();
    await nav('records'); await web.locator('#record-list .record-card').filter({ hasText: '手工二次函数平移' }).getByRole('button', { name: '恢复数学场景 / 复练', exact: true }).click();
    await web.getByRole('button', { name: '向右', exact: true }).click(); assert.match(await web.locator('#prediction-status').textContent(), /与数学关系一致/);
    const originals = (await api('GET', '/api/learning/records')).value.records;
    await web.locator('#create-variant').click(); await wait(web, () => document.querySelector('#pedagogy-status').textContent.includes('程序变式已单独保存'));
    const variant = (await api('GET', '/api/learning/records')).value.records.find((record) => !originals.some((old) => old.id === record.id));
    assert.equal(variant.template, 'parabola'); assert.equal(variant.origin, 'manual');
    await web.locator('#practice-h').fill(String(variant.snapshot.h)); await web.locator('#practice-k').fill(String(variant.snapshot.k));
    await web.locator('#submit-practice').click(); await wait(web, () => document.querySelector('#practice-status').textContent.includes('本次独立答对'));
    const attempts = (await api('GET', '/api/learning/attempts')).value.attempts;
    assert.equal(attempts.at(-1).recordId, variant.id); assert.equal(attempts.at(-1).outcome, 'correct_independent');
    await shot(web, 'connected-parabola-variant');
  });
  await step('deleteEpochPreventsQueuedResurrectionAndLocalSurvives', async () => {
    await freshPluginMath(); await close(site);
    await lab.getByRole('textbox', { name: '我的疑问或易错提醒（先存本机，账号同步按配对设置）', exact: true }).fill('删除前待同步');
    await lab.getByRole('button', { name: '保存疑问', exact: true }).click();
    await lab.getByText('疑问已保存到本机。 账号尚未确认，请到插件记录页检查待同步队列。', { exact: true }).waitFor();
    assert.equal((await message('plugin:account:state')).queued, 1); await listen(site, 4174);
    await nav('account'); await web.locator('#delete-account-data').click();
    await wait(web, () => document.querySelector('#data-status').textContent.includes('全部学习数据删除已由服务确认'));
    await message('plugin:account:retry', {}, false);
    const state = await message('plugin:account:state'); assert.equal(state.paired, false); assert.equal(state.queued, 0);
    assert.equal((await api('GET', '/api/learning/records')).value.records.length, 0);
    assert.ok((await message('plugin:list')).records.some((record) => record.note === '删除前待同步'));
  });
  await step('websiteRevocationDisconnectsRealWorker', async () => {
    await web.locator('#create-pairing').click(); await wait(web, () => document.querySelector('#pairing-code').textContent.length === 22);
    await message('plugin:account:connect', { code: await web.locator('#pairing-code').textContent(), enabled: true });
    await web.locator('#revoke-pairings').click(); await wait(web, () => document.querySelector('#pairing-status').textContent.includes('服务已确认撤销'));
    await message('plugin:account:list', {}, false); assert.equal((await message('plugin:account:state')).paired, false);
    await shot(web, 'connected-revoked');
  });
  await step('pluginWatchRemainsAvailableWhenRealReaderIsUnconfigured', async () => {
    await web.locator('#create-pairing').click(); await wait(web, () => document.querySelector('#pairing-code').textContent.length === 22);
    await message('plugin:account:connect', { code: await web.locator('#pairing-code').textContent(), enabled: true });
    await web.locator('#revoke-pairings').focus();
    await close(reader); let blankReadCalls = 0;
    reader = createReaderServer({ settings: loadSettings({}), pageRules,
      fetchImpl: async () => { blankReadCalls += 1; throw new Error('Unconfigured reader must not call provider'); } });
    await listen(reader, 8787); await lab.bringToFront();
    await cdp.send('Extensions.triggerAction', { id: extension.id, targetId: target.targetId });
    await lab.getByRole('button', { name: '开始持续视觉识别', exact: true }).click();
    await wait(lab, () => [...document.querySelectorAll('[data-breakglass-learning]')].some((host) => host.shadowRoot?.querySelector('.bg-status')?.textContent.includes('学习服务没有配置模型')));
    assert.equal(await lab.locator('.bg-point-list button').count(), 0); assert.equal(blankReadCalls, 0);
    await lab.evaluate(() => document.querySelector('video').play()); await lab.waitForTimeout(1000); await lab.evaluate(() => document.querySelector('video').pause());
    await wait(ext, async () => !(await chrome.runtime.sendMessage({ type: 'plugin:account:state' })).syncing);
    const watch = (await api('GET', '/api/learning/watch')).value.items;
    assert.ok(watch.some((item) => item.source.id === 'pilot-triangle-3-4-5' && item.time > 4));
    await shot(lab, 'connected-blank-reader-watch');
  });
  await close(site); let blankCalls = 0;
  site = createLearningSiteServer({ settings: loadSettings({}), dataDir: path.join(output, 'private-blank-data'), fetchImpl: async () => { blankCalls += 1; throw new Error('No provider when unconfigured'); } });
  await listen(site, 4174);
  await step('blankConfigurationHonestContextFailureAndNoProvider', async () => {
    await web.goto('http://localhost:4174/learning-site/index.html'); await nav('import'); await web.locator('#sample-triangle').click();
    await wait(web, () => !document.querySelector('#analyze-context').disabled); await web.locator('#analyze-context').click();
    await wait(web, () => document.querySelector('#context-status').textContent.includes('学习服务没有配置模型'));
    assert.equal(blankCalls, 0); assert.equal(await web.locator('#context-result button').count(), 0);
    await shot(web, 'connected-blank-context');
  });
  assert.deepEqual(evidence.errors, []); evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.message;
  if (web && !web.isClosed()) await shot(web, 'connected-failure').catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(path.join(output, 'connected-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, output, checks: evidence.checks, calls: evidence.calls, error: evidence.error }));
  await context?.close(); await Promise.all([close(site), close(labServer), close(reader)]);
}
