import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createLearningSiteServer } from './learning-site.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';

// Opt-in actual browser verification. The model below is an explicit transport
// stub; no model keys, user videos, prompts, cookies or passwords enter evidence.
const modulePath = process.env.BREAKGLASS_TEST_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-site-test-'));
const relativeOutput = path.relative(repo, output);
if (!relativeOutput || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput))) {
  throw new Error('Browser evidence and development accounts must remain outside the repository.');
}
fs.mkdirSync(output, { recursive: true });
const base = 'http://localhost:4174';
const LOCAL_KEY = 'breakglass.website.learning.v1';
const sourceFile = path.join(repo, 'extension/assets/video/geometry/triangle-3-4-5.mp4');
const originalBytes = fs.readFileSync(sourceFile);
const sourceId = 'file-' + createHash('sha256').update(originalBytes).digest('hex');
// A valid empty MP4 free atom changes the full fingerprint while preserving video decoding.
const otherBytes = Buffer.concat([originalBytes, Buffer.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65])]);
const otherSourceId = 'file-' + createHash('sha256').update(otherBytes).digest('hex');
const network = []; const pageErrors = []; const screenshots = [];
let visualCalls = 0; let summaryCalls = 0; let unconfiguredProviderCalls = 0;
const evidence = { status: 'running', model: 'explicit in-process transport stub; no real model inference',
  checks: {}, steps: [], screenshots, network, pageErrors, realModelVerified: false,
  publicDeploymentVerified: false, learningEffectVerified: false, platformRightsVerified: false,
  environment: { platform: os.platform(), release: os.release(), node: process.version, cpu: os.cpus()[0]?.model || 'unknown' } };
const settings = loadSettings({ READER_BASE_URL: 'http://explicit-model-stub.invalid',
  READER_API_KEY: 'test-stub-only-not-a-key', READER_MODEL: 'explicit-test-stub' });
const provider = async (_url, options) => {
  const sent = JSON.parse(options.body);
  const visual = sent.messages.some((message) => Array.isArray(message.content));
  if (visual) visualCalls += 1; else summaryCalls += 1;
  const result = visual ? { schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
    area: { x: 0.3, y: 0.3, width: 0.4, height: 0.35 }, title: '直角三角形',
    explanation: '题面给出两条直角边；斜边由数学程序计算，识别条件仍须校对。', pitfallHint: '斜边不能直接把两条直角边相加。' }
    : { summary: '这些画面观察涉及直角三角形的两条直角边。', keyPoints: ['核对直角和统一单位。'], pitfalls: ['斜边不等于两条直角边直接相加。'] };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    { headers: { 'content-type': 'application/json' } });
};
function track(server, mode) {
  server.on('request', (request, response) => {
    if (!['/api/vision/read', '/api/vision/summarize'].includes(request.url)) return;
    let text = '';
    request.on('data', (chunk) => { text += chunk; });
    request.on('end', () => {
      try {
        const body = JSON.parse(text);
        const row = { mode, path: request.url, sourceId: body.sourceId, frameTime: body.frameTime,
          hasJpeg: body.image?.startsWith('data:image/jpeg;base64,') || false,
          imageChars: body.image?.length || 0, observationCount: body.observations?.length || 0 };
        network.push(row); response.once('finish', () => { row.status = response.statusCode; });
      } catch { /* Invalid payload never enters evidence verbatim. */ }
    });
  });
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4174, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
let server = createLearningSiteServer({ settings, dataDir: path.join(output, 'account-data'), fetchImpl: provider });
track(server, 'configured-test-stub'); await listen(server);
let browser; let context; let page;
async function step(name, run) {
  console.log(`Browser check: ${name}`);
  await run(); evidence.checks[name] = true; evidence.steps.push(name);
}
async function shot(name, target = page) {
  const filename = path.join(output, name); await target.screenshot({ path: filename, fullPage: true }); screenshots.push(filename); return filename;
}
async function nav(name, target = page) { await target.locator(`.site-sidebar button[data-view="${name}"]`).click(); }
async function jsonApi(route, target = page) {
  return target.evaluate(async (pathname) => {
    const response = await fetch(pathname, { credentials: 'same-origin' });
    return { status: response.status, value: await response.json() };
  }, route);
}
async function local(target = page) { return target.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{"records":[],"attempts":[],"watch":[]}'), LOCAL_KEY); }
async function overlayOpen(target = page) {
  const launcher = target.getByRole('button', { name: '展开独立学习面板，不遮挡视频播放器', exact: true });
  if (await launcher.isVisible()) await launcher.click();
}
async function sample(target = page) {
  await nav('import', target); await target.locator('#sample-triangle').click();
  await target.waitForFunction(() => document.querySelector('#learning-video').readyState >= 2
    && document.querySelector('#learning-video').duration > 11 && !document.querySelector('#start-analysis').disabled);
}
async function seek(time, target = page) {
  await target.locator('#learning-video').evaluate((video, seconds) => { video.currentTime = seconds; }, time);
  await target.waitForFunction(() => !document.querySelector('#learning-video').seeking && document.querySelector('#learning-video').readyState >= 2);
}
async function playAndPause(target = page) {
  await target.locator('#learning-video').evaluate((video) => video.play());
  await target.waitForFunction(() => !document.querySelector('#learning-video').paused);
  await new Promise((resolve) => setTimeout(resolve, 180));
  await target.locator('#learning-video').evaluate((video) => video.pause());
}
async function recordScene(scope, target = page) {
  await nav('records', target); await target.locator('#record-kind').selectOption('all');
  await target.locator('#record-scope').selectOption(scope);
  await target.locator('#record-list .record-card').first().getByRole('button', { name: '恢复数学场景 / 复练', exact: true }).click();
  await target.locator('#scene-stage svg').waitFor();
}
async function submit(answer, text, target = page) {
  await target.locator('#practice-number').fill(String(answer)); await target.locator('#submit-practice').click();
  await target.waitForFunction((expected) => document.querySelector('#practice-status').textContent.includes(expected), text);
}
async function register(username, target = page) {
  await nav('account', target); await target.locator('#username').fill(username); await target.locator('#password').fill('verification-only-password');
  await target.locator('#register').click();
  await target.waitForFunction((expected) => document.querySelector('#top-identity').textContent.includes(expected), username);
}
async function login(username, target = page) {
  await nav('account', target); await target.locator('#username').fill(username); await target.locator('#password').fill('verification-only-password');
  await target.locator('#login').click();
  await target.waitForFunction((expected) => document.querySelector('#top-identity').textContent.includes(expected), username);
}
async function logout(target = page) {
  await nav('account', target); await target.locator('#logout').click();
  await target.waitForFunction(() => document.querySelector('#top-identity').textContent.includes('本机访客'));
}
try {
  browser = await chromium.launch({ executablePath: process.env.BREAKGLASS_TEST_BROWSER_EXECUTABLE || undefined,
    headless: true, args: ['--enable-unsafe-swiftshader'] });
  evidence.browser = await browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => { void dialog.accept(); });
  page.setDefaultTimeout(12000);
  await page.goto(`${base}/learning-site/index.html`);
  await page.waitForFunction(() => document.querySelector('#account-status').textContent.includes('当前未登录'));
  evidence.initialConfiguration = { provider: 'explicit test stub', credentialsObtainedFromUser: false };
  await step('emptyOverviewAndBrandResponsive', async () => {
    assert.deepEqual(await page.locator('#dashboard-summary strong').allTextContents(), ['0', '0', '0', '0']);
    assert.equal(await page.locator('.brand img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
    evidence.layouts = [];
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 });
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth }));
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `Horizontal overflow at ${width}`);
      evidence.layouts.push(layout); await shot(`site-empty-overview-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await step('actualFileFingerprintCaptureAndGuestSave', async () => {
    await sample(); assert.equal(visualCalls, 0); assert.equal(summaryCalls, 0);
    await seek(4); await playAndPause();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').watch?.length === 1, LOCAL_KEY);
    await seek(4); await page.locator('#start-analysis').click();
    await page.locator('.bg-point-list button').first().waitFor({ state: 'attached' }); await overlayOpen();
    await page.getByRole('heading', { name: 'AI 画面总结', exact: true }).waitFor();
    assert.ok(visualCalls >= 1); assert.ok(summaryCalls >= 1);
    assert.ok(network.some((item) => item.hasJpeg && item.sourceId === sourceId && Math.abs(item.frameTime - 4) < 0.25));
    await page.locator('.bg-point-list button').first().click();
    evidence.learningLayer = await page.locator('[data-breakglass-learning]').evaluate((host) => {
      const panel = host.shadowRoot.querySelector('.bg-panel');
      const rectangle = panel.getBoundingClientRect();
      const styles = getComputedStyle(panel);
      return { layout: host.dataset.bgLayout, parent: host.parentElement.id,
        left: rectangle.left, top: rectangle.top, width: rectangle.width,
        background: styles.backgroundColor, pointerEvents: styles.pointerEvents };
    });
    assert.equal(evidence.learningLayer.parent, 'import-workbench', 'Independent layer must remain in the website workbench');
    await page.locator('.bg-confirm input').check();
    await page.getByRole('button', { name: '确认条件并探索', exact: true }).click();
    assert.match(await page.locator('.bg-math-summary').textContent(), /BC.*= 5 cm/);
    await overlayOpen();
    const panelImage = path.join(output, 'site-model-stub-confirmed-learning-panel.png');
    await page.locator('.bg-panel').evaluate((panel) => { panel.scrollTop = 0; });
    await page.locator('.bg-panel').screenshot({ path: panelImage }); screenshots.push(panelImage);
    await page.getByRole('textbox', { name: '我的疑问或易错提醒', exact: true }).fill('为什么不能直接把两条直角边相加？');
    await page.getByRole('button', { name: '标记个人易错点', exact: true }).click();
    await page.getByText('个人易错标记已保存到本机。这不代表你已经做错。', { exact: true }).waitFor();
    const saved = await local(); assert.equal(saved.records.length, 1); assert.equal(saved.records[0].kind, 'pitfall');
    assert.equal(saved.records[0].source.id, sourceId); assert.equal(saved.records[0].origin, 'vision');
    assert.equal(saved.attempts.length, 0); evidence.guestRecordId = saved.records[0].id;
    await overlayOpen();
    await shot('site-model-stub-hotspot-confirmed-1440.png');
  });
  await step('restoredSceneWithoutVideoAndParticleCamera', async () => {
    await overlayOpen();
    await page.getByRole('button', { name: '退出学习层', exact: true }).click();
    await page.locator('#remove-file').click(); await recordScene('local');
    assert.equal(await page.locator('#scene-return').isDisabled(), true);
    assert.match(await page.locator('#scene-context').textContent(), /无需原视频/);
    assert.equal(await page.locator('#practice-answer').isVisible(), false);
    const beforeMath = await page.locator('#scene-stage svg').innerHTML();
    const canvas = page.locator('#scene-stage canvas');
    assert.equal(await canvas.isVisible(), true, 'Particle view must render or report an honest fallback');
    const before = await canvas.screenshot(); await shot('site-restored-particles-front.png');
    await page.locator('#camera-yaw').focus(); await page.locator('#camera-yaw').press('ArrowRight', { delay: 30 });
    for (let i = 0; i < 19; i += 1) await page.locator('#camera-yaw').press('ArrowRight');
    await page.locator('#camera-pitch').focus(); for (let i = 0; i < 12; i += 1) await page.locator('#camera-pitch').press('ArrowRight');
    assert.equal(await page.locator('#camera-yaw').inputValue(), '20');
    assert.equal(await page.locator('#camera-pitch').inputValue(), '12');
    const after = await canvas.screenshot(); assert.notDeepEqual(after, before);
    assert.equal(await page.locator('#scene-stage svg').innerHTML(), beforeMath, 'Camera cannot change the mathematical SVG');
    await shot('site-restored-particles-rotated.png');
    await page.locator('#camera-reset').click();
    assert.equal(await page.locator('#camera-yaw').inputValue(), '0'); assert.equal(await page.locator('#camera-pitch').inputValue(), '0');
    evidence.particleRendering = 'actual Edge canvas screenshots change with camera; mathematical SVG unchanged';
  });
  await step('guestActualWrongHintCorrectIndependentCorrectAndSkip', async () => {
    await submit(7, '本次答错'); await shot('site-guest-actual-wrong.png');
    await page.locator('#show-hint').click(); await submit(5, '使用提示完成');
    await recordScene('local'); await submit(5, '本次独立答对');
    let saved = await local(); assert.deepEqual(saved.attempts.map((item) => [item.correct, item.hintUsed]), [[false, false], [true, true], [true, false]]);
    assert.equal(saved.records[0].kind, 'pitfall');
    await recordScene('local'); await page.locator('#skip-practice').click();
    saved = await local(); assert.equal(saved.attempts.length, 3);
    await nav('records'); await page.locator('#record-kind').selectOption('wrong');
    assert.equal(await page.locator('#record-list .record-card').count(), 1);
    await page.locator('#record-kind').selectOption('all');
  });
  const suffix = Date.now().toString(36); const accountA = `site_a_${suffix}`; const accountB = `site_b_${suffix}`;
  await step('realAccountRegistrationAndExplicitGuestImport', async () => {
    await register(accountA);
    assert.deepEqual((await jsonApi('/api/learning/records')).value.records, []);
    assert.equal((await local()).records.length, 1);
    await nav('records'); await page.locator('#record-scope').selectOption('local');
    await page.locator('#record-list .record-select input').check();
    assert.deepEqual((await jsonApi('/api/learning/records')).value.records, []);
    await page.locator('#import-selected').click();
    await page.waitForFunction(() => document.querySelector('#center-status').textContent.includes('已由服务确认导入 1 条'));
    assert.equal((await jsonApi('/api/learning/records')).value.records.length, 1);
    assert.deepEqual((await jsonApi('/api/learning/attempts')).value.attempts, [], 'Guest answers are not automatically imported');
    await page.locator('#record-scope').selectOption('account'); await shot('site-account-explicit-import.png');
  });
  await step('accountProgramJudgedAttemptsAndWatch', async () => {
    await recordScene('account'); await submit(7, '本次答错');
    await page.locator('#show-hint').click(); await submit(5, '使用提示完成');
    await recordScene('account'); await submit(5, '本次独立答对');
    const attempts = (await jsonApi('/api/learning/attempts')).value.attempts;
    assert.deepEqual(attempts.map((item) => item.outcome), ['wrong', 'correct_with_hint', 'correct_independent']);
    await sample(); await seek(3);
    const savedPosition = page.waitForResponse((response) => response.url().includes('/api/learning/watch/')
      && response.request().method() === 'PUT' && response.status() === 200);
    await playAndPause(); await savedPosition;
    const watched = (await jsonApi('/api/learning/watch')).value.items;
    assert.equal(watched.length, 1); assert.equal(watched[0].source.id, sourceId); assert.ok(watched[0].time >= 3);
    await nav('watch'); assert.equal(await page.getByRole('button', { name: '定位已匹配视频', exact: true }).count(), 1);
    await shot('site-account-watch-matched.png');
  });
  await step('logoutSecondAccountIsolationAndReturn', async () => {
    await logout(); await register(accountB);
    for (const [route, field] of [['/api/learning/records', 'records'], ['/api/learning/attempts', 'attempts'], ['/api/learning/watch', 'items']]) {
      assert.deepEqual((await jsonApi(route)).value[field], []);
    }
    const denied = await page.evaluate(async (id) => {
      const me = await (await fetch('/api/account/me')).json();
      const response = await fetch(`/api/learning/records/${id}`, { method: 'DELETE',
        headers: { 'content-type': 'application/json', 'X-BreakGlass-CSRF': me.csrfToken }, body: JSON.stringify({ expectedEpoch: me.epoch }) });
      return response.status;
    }, evidence.guestRecordId);
    assert.equal(denied, 404);
    await nav('records'); await shot('site-second-account-empty.png');
    await logout(); await login(accountA);
    assert.equal((await jsonApi('/api/learning/records')).value.records.length, 1);
    assert.equal((await jsonApi('/api/learning/attempts')).value.attempts.length, 3);
    assert.equal((await jsonApi('/api/learning/watch')).value.items.length, 1);
  });
  await step('unregisteredSameNamePreviewManualAndFingerprintIsolation', async () => {
    const stopped = [visualCalls, summaryCalls]; await nav('import');
    await page.locator('#video-file').setInputFiles({ name: 'breakglass-triangle.mp4', mimeType: 'video/mp4', buffer: otherBytes });
    await page.waitForFunction(() => document.querySelector('#learning-video').readyState >= 2
      && !document.querySelector('#manual-explore').disabled && document.querySelector('#policy-status').textContent.includes('未登记'));
    assert.equal(await page.locator('#start-analysis').isDisabled(), true);
    await seek(2);
    const savedPosition = page.waitForResponse((response) => response.url().includes(`/api/learning/watch/${otherSourceId}`)
      && response.request().method() === 'PUT' && response.status() === 200);
    await playAndPause(); await savedPosition;
    await page.waitForFunction((suffix) => document.querySelector('#file-details').textContent.includes(suffix), otherSourceId.slice(-12));
    const watch = (await jsonApi('/api/learning/watch')).value.items;
    assert.equal(watch.length, 2); assert.ok(watch.some((item) => item.source.id === otherSourceId && item.source.materialMode === 'permission-pending'));
    await recordScene('local'); assert.equal(await page.locator('#scene-return').isDisabled(), true, 'Same filename cannot bind a different SHA');
    await nav('import'); await page.locator('#manual-explore').click(); await overlayOpen();
    await page.getByRole('button', { name: '校对当前条件', exact: true }).click();
    await page.getByRole('combobox', { name: '数学模板', exact: true }).selectOption('right-triangle');
    await page.locator('.bg-confirm input').check(); await page.getByRole('button', { name: '生成手工候选并探索', exact: true }).click();
    await page.getByRole('textbox', { name: '我的疑问或易错提醒', exact: true }).fill('这是我自己输入的数学条件。');
    await page.getByRole('button', { name: '保存疑问', exact: true }).click();
    await page.getByText('记录已由当前账号服务确认保存。', { exact: true }).waitFor();
    const saved = (await jsonApi('/api/learning/records')).value.records;
    assert.equal(saved.length, 2); assert.ok(saved.some((item) => item.source.kind === 'manual-notes'
      && item.source.id === `manual-${otherSourceId}` && item.origin === 'manual'));
    assert.deepEqual([visualCalls, summaryCalls], stopped);
    await shot('site-unregistered-preview-manual-no-ai.png');
  });
  await step('realExportAndAccountAndGuestClear', async () => {
    await nav('records'); await page.locator('#record-scope').selectOption('account');
    const downloaded = page.waitForEvent('download'); await page.locator('#export-records').click();
    const download = await downloaded; const filename = path.join(output, 'site-account-export.json'); await download.saveAs(filename);
    const exported = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.equal(exported.records.length, 2); assert.equal(exported.watch.length, 2); assert.equal(exported.attempts.length, 3);
    assert.doesNotMatch(JSON.stringify(exported), /password|csrfToken|data:image|blob:|file:\/\/|https?:\/\//i);
    evidence.exportPath = filename;
    await nav('account'); await page.locator('#delete-account-data').click();
    await page.waitForFunction(() => document.querySelector('#data-status').textContent.includes('全部学习数据删除已由服务确认'));
    const cleared = (await jsonApi('/api/learning/export')).value;
    assert.deepEqual(cleared.records, []); assert.deepEqual(cleared.watch, []); assert.deepEqual(cleared.attempts, []);
    assert.equal(cleared.epoch, 1); assert.equal((await local()).records.length, 1);
    await nav('records'); await page.locator('#record-scope').selectOption('local'); await page.locator('#clear-local').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').records?.length === 0, LOCAL_KEY);
    const guest = await local(); assert.deepEqual(guest.records, []); assert.deepEqual(guest.attempts, []); assert.deepEqual(guest.watch, []);
    await shot('site-cleared-local-and-account.png');
  });
  await context.close(); context = null; await close(server);
  server = createLearningSiteServer({ settings: loadSettings({}), dataDir: path.join(output, 'unconfigured-account-data'),
    fetchImpl: async () => { unconfiguredProviderCalls += 1; throw new Error('Unconfigured service must not call provider'); } });
  track(server, 'model-unconfigured'); await listen(server);
  await step('unconfiguredModelHonestEmptyResult', async () => {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(error.message)); page.setDefaultTimeout(12000);
    await page.goto(`${base}/learning-site/index.html`); await sample();
    assert.match(await page.locator('#model-status').textContent(), /模型留空未配置/);
    await seek(4); await page.locator('#start-analysis').click(); await overlayOpen();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-breakglass-learning]')]
      .some((host) => host.shadowRoot?.querySelector('.bg-status')?.textContent.includes('学习服务没有配置模型')));
    assert.equal(await page.locator('.bg-point-list button').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'AI 画面总结', exact: true }).count(), 0);
    assert.equal(unconfiguredProviderCalls, 0);
    await shot('site-unconfigured-model-no-fake-hotspot.png');
  });
  assert.deepEqual(pageErrors, []);
  evidence.status = 'passed'; evidence.visualCalls = visualCalls; evidence.summaryCalls = summaryCalls;
  evidence.unconfiguredProviderCalls = unconfiguredProviderCalls;
  fs.writeFileSync(path.join(output, 'site-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, evidencePath: path.join(output, 'site-evidence.json'), ...evidence }));
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.message; evidence.visualCalls = visualCalls; evidence.summaryCalls = summaryCalls;
  if (page && !page.isClosed()) await shot('site-failure.png').catch(() => {});
  fs.writeFileSync(path.join(output, 'site-evidence.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify({ output, evidencePath: path.join(output, 'site-evidence.json'), completedSteps: evidence.steps, error: error.message }));
  throw error;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await close(server);
}
