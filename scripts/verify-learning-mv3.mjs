import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// Opt-in browser verification: model transport below is an explicit test stub.
// Supply a local Playwright module path if it is not available as a package.
const modulePath = process.env.BREAKGLASS_TEST_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-mv3-test-'));
fs.mkdirSync(output, { recursive: true });
const { createLabServer } = await import(pathToFileURL(path.join(repo, 'scripts/learning-lab.mjs')));
const { createReaderServer } = await import(pathToFileURL(path.join(repo, 'breakglass-reader/src/server.mjs')));
const { loadSettings } = await import(pathToFileURL(path.join(repo, 'breakglass-reader/src/settings.mjs')));
const rules = await import(pathToFileURL(path.join(repo, 'extension/src/lesson/reading.js')));
const settings = loadSettings({ READER_BASE_URL: 'http://model-stub.invalid', READER_API_KEY: 'test-only', READER_MODEL: 'explicit-test-stub' });
let visualCalls = 0; let summaryCalls = 0; let stubTemplate = 'right-triangle'; const network = []; const errors = [];
const reader = createReaderServer({ settings, pageRules: rules.default || rules,
  fetchImpl: async (url, options) => {
    const sent = JSON.parse(options.body);
    const visual = sent.messages.some((message) => Array.isArray(message.content));
    if (visual) visualCalls += 1; else summaryCalls += 1;
    const value = visual ? (stubTemplate === 'parabola' ? { schemaVersion: '1', template: 'parabola', snapshot: { a: 1, h: 0, k: 1 },
      area: { x: 0.2, y: 0.2, width: 0.6, height: 0.5 }, title: '抛物线', explanation: '顶点式可以分别观察开口和平移。', pitfallHint: '括号里的减号与水平平移方向需要核对。' }
      : { schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
      area: { x: 0.3, y: 0.3, width: 0.4, height: 0.35 }, title: '直角三角形', explanation: '由两条直角边确定斜边，长度使用程序计算。', pitfallHint: '斜边不等于两条直角边直接相加。' })
      : stubTemplate === 'parabola'
        ? { summary: '这次画面给出了抛物线。', keyPoints: ['核对顶点式的参数。'], pitfalls: ['括号里的减号与平移方向需要核对。'] }
        : { summary: '这次画面给出了直角三角形的两条边长。', keyPoints: ['同一单位下核对直角边。'], pitfalls: ['不能直接把3和4相加作为斜边。'] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } });
  } });
reader.on('request', (request) => {
  if (!request.url.startsWith('/learning/')) return;
  let text = ''; request.on('data', (chunk) => { text += chunk; });
  request.on('end', () => { try { const body = JSON.parse(text); network.push({ path: request.url, sourceId: body.sourceId,
    frameTime: body.frameTime, imageBytes: body.image?.length || 0, hasJpeg: body.image?.startsWith('data:image/jpeg;base64,') || false,
    observationCount: body.observations?.length || 0 }); } catch {} });
});
const lab = createLabServer();
await Promise.all([new Promise((resolve) => reader.listen(8787, '127.0.0.1', resolve)), new Promise((resolve) => lab.listen(4173, '127.0.0.1', resolve))]);
const context = await chromium.launchPersistentContext(path.join(output, `browser-profile-${Date.now()}`), { executablePath: process.env.BREAKGLASS_TEST_BROWSER_EXECUTABLE || undefined, headless: true,
  viewport: { width: 1440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
try {
  const browserCdp = await context.browser().newBrowserCDPSession();
  const extension = await browserCdp.send('Extensions.loadUnpacked', { path: path.join(repo, 'extension') });
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:4173/learning-lab/lesson.html');
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await page.evaluate(() => { document.querySelector('video').currentTime = 4; });
  await page.waitForFunction(() => !document.querySelector('video').seeking && document.querySelector('video').readyState >= 2);
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const targetInfo = targetInfos.find((target) => target.url === page.url()) || targetInfos[0];
  if (!targetInfo) throw new Error('Missing tab target for real action invocation.');
  await browserCdp.send('Extensions.triggerAction', { id: extension.id, targetId: targetInfo.targetId });
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).waitFor();
  assert.equal(visualCalls, 0, 'opening overlay alone must not upload');
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).click();
  await page.locator('.bg-point-list button').first().waitFor();
  await page.getByRole('heading', { name: 'AI 画面总结', exact: true }).waitFor();
  assert.equal(visualCalls, 1); assert.equal(summaryCalls, 1);
  assert.ok(network.some((row) => row.hasJpeg && row.sourceId === 'pilot-triangle-3-4-5' && row.frameTime === 4));
  await page.locator('.bg-point-list button').first().focus();
  await page.locator('.bg-point-list button').first().press('Enter');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认条件并探索', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'AB', exact: true }).fill('6');
  await page.getByRole('button', { name: '改变 AB', exact: true }).click();
  assert.match(await page.locator('.bg-math-summary').textContent(), /AC = 4.*7\.211/);
  await page.getByRole('button', { name: '恢复所选条件', exact: true }).click();
  assert.match(await page.locator('.bg-math-summary').textContent(), /BC.*= 5 cm/);
  await page.getByRole('textbox', { name: '我的疑问或易错提醒（仅本机）', exact: true }).fill('为什么不能直接相加？');
  await page.getByRole('button', { name: '保存疑问', exact: true }).click();
  await page.getByText('疑问已保存到本机。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'mv3-model-stub-learning.png'), fullPage: true });
  await browserCdp.send('Extensions.triggerAction', { id: extension.id, targetId: targetInfo.targetId });
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).waitFor();
  assert.equal(await page.locator('[data-breakglass-learning]').count(), 1);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(visualCalls, 1, 'old recognition must stop after reinjection');
  const recordsPage = await context.newPage();
  await recordsPage.goto(`chrome-extension://${extension.id}/plugin/status.html`);
  await recordsPage.getByText('为什么不能直接相加？', { exact: true }).waitFor();
  await page.bringToFront();
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).click();
  await page.locator('.bg-point-list button').first().waitFor();
  await page.getByRole('heading', { name: 'AI 画面总结', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.hidden), false);
  assert.equal(visualCalls, 2); assert.equal(summaryCalls, 2);
  // Clear from the extension page while the video tab remains visible and its
  // paused frame is unchanged: there is no new request to detect a stale token.
  await recordsPage.locator('#clear').evaluate((button) => button.click());
  await recordsPage.getByText('已清除记录并使在途会话失效。', { exact: true }).waitFor();
  assert.equal(await recordsPage.locator('#records li').count(), 0);
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).waitFor();
  assert.equal(await page.locator('.bg-point-list button').count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'AI 画面总结', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.hidden), false);
  await recordsPage.screenshot({ path: path.join(output, 'mv3-cleared-records.png'), fullPage: true });
  await page.bringToFront();
  stubTemplate = 'parabola';
  await page.getByLabel('选择自制视频').selectOption('parabola');
  await page.waitForFunction(() => document.querySelector('video').duration < 10 && document.querySelector('video').readyState >= 2);
  await page.evaluate(() => { document.querySelector('video').currentTime = 6; });
  await page.waitForFunction(() => !document.querySelector('video').seeking && document.querySelector('video').readyState >= 2);
  await browserCdp.send('Extensions.triggerAction', { id: extension.id, targetId: targetInfo.targetId });
  await page.getByRole('button', { name: '开始持续视觉识别', exact: true }).click();
  await page.locator('.bg-point-list button').first().waitFor();
  await page.locator('.bg-point-list button').first().click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认条件并探索', exact: true }).click();
  const beforeCurve = await page.locator('.bg-curve').getAttribute('d');
  await page.getByRole('spinbutton', { name: 'h', exact: true }).fill('1');
  await page.getByRole('button', { name: '应用参数', exact: true }).click();
  assert.notEqual(await page.locator('.bg-curve').getAttribute('d'), beforeCurve);
  await page.screenshot({ path: path.join(output, 'mv3-model-stub-parabola.png'), fullPage: true });
  const layouts = [];
  for (const width of [760, 360]) {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForFunction(() => document.querySelector('[data-breakglass-learning]')?.dataset.bgLayout === 'flow');
    const initial = await page.locator('[data-breakglass-learning]').evaluate((host) => ({
      hidden: host.shadowRoot.querySelector('.bg-panel').hidden,
      height: host.shadowRoot.querySelector('.bg-launcher').getBoundingClientRect().height
    }));
    assert.equal(initial.hidden, true); assert.ok(initial.height >= 44);
    await page.getByRole('button', { name: '展开独立学习面板，不遮挡视频播放器', exact: true }).click();
    const layout = await page.locator('[data-breakglass-learning]').evaluate((host) => {
      const video = document.querySelector('video').getBoundingClientRect();
      const panel = host.shadowRoot.querySelector('.bg-panel').getBoundingClientRect();
      return { video: { top: video.top, bottom: video.bottom }, panel: { top: panel.top, bottom: panel.bottom },
        overlap: panel.bottom > video.top && panel.top < video.bottom };
    });
    assert.equal(layout.overlap, false);
    await page.screenshot({ path: path.join(output, `mv3-model-stub-flow-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '收起并查看视频', exact: true }).click();
    layouts.push({ width, defaultCollapsed: true, launcherHeight: initial.height, ...layout });
  }
  await page.getByRole('button', { name: '展开独立学习面板，不遮挡视频播放器', exact: true }).click();
  await page.getByRole('button', { name: '停止持续视觉识别', exact: true }).click();
  const stoppedCalls = [visualCalls, summaryCalls];
  await page.goto('http://localhost:4173/learning-lab/lesson.html?unsupported=1');
  const deniedPage = context.waitForEvent('page');
  await browserCdp.send('Extensions.triggerAction', { id: extension.id, targetId: targetInfo.targetId });
  const deniedStatus = await deniedPage;
  await deniedStatus.waitForLoadState('domcontentloaded');
  assert.ok(deniedStatus.url().startsWith(`chrome-extension://${extension.id}/plugin/status.html`));
  assert.equal(await page.locator('[data-breakglass-learning]').count(), 0);
  assert.deepEqual([visualCalls, summaryCalls], stoppedCalls, 'unsupported page must not upload');
  assert.deepEqual(errors, []);
  const evidence = { status: 'passed', browser: await context.browser().version(), actualMV3: true,
    invocation: 'CDP Extensions.triggerAction (real action permission grant)', model: 'explicit in-process test stub; not a real vision model',
    actualVideoCapture: true, visualCalls, summaryCalls, noUploadBeforeStart: true, reinjectionSingleOwner: true,
    localSaveAndClear: true, clearRevokesVisibleUnchangedSession: true,
    keyboardPointSelection: true, triangleDeterministicChangeAndRestore: true, parabolaRenderedParameterChange: true,
    unsupportedPageNoInjectionOrUpload: true,
    environment: { platform: os.platform(), release: os.release(), node: process.version, cpu: os.cpus()[0]?.model || 'unknown' },
    layouts, network, errors, realModelVerified: false, bilibiliPermissionVerified: false };
  fs.writeFileSync(path.join(output, 'mv3-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, ...evidence }));
} catch (error) {
  const failed = context.pages().find((page) => page.url().includes('/learning-lab/lesson.html'));
  if (failed) console.log(JSON.stringify(await failed.evaluate(() => ({ duration: document.querySelector('video')?.duration,
    src: document.querySelector('video')?.currentSrc, hostCount: document.querySelectorAll('[data-breakglass-learning]').length }))));
  throw error;
} finally {
  await context.close(); await Promise.all([new Promise((resolve) => reader.close(resolve)), new Promise((resolve) => lab.close(resolve))]);
}
