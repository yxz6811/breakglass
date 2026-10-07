import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLearningSiteServer } from './learning-site.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';

// Actual Chromium UI, media decoding and local account HTTP. Vision inference is
// only the explicit transport stub below; this runner never reads a .env file.
const repository = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'breakglass-completion-')));
const relative = path.relative(repository, output);
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Private evidence must remain outside the repository.');
fs.mkdirSync(output, { recursive: true });
const runtime = process.env.BREAKGLASS_TEST_PLAYWRIGHT_MODULE
  || 'C:/Users/27736/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(path.resolve(runtime)).href);
const evidence = { status: 'running', scope: '009 actual browser learning workflow, private cache and account metadata',
  actualBrowser: true, actualMediaDecode: true, actualAccountHTTP: true, actualMV3: false,
  model: 'explicit injected vision transport stub', realAI: false, bilibiliSupport: false,
  publicCloudDeployment: false, realLearningEffect: false, realASR: false, checks: {}, screenshots: [], errors: [],
  expectedHTTPFailures: [], calls: { context: 0, read: 0, summary: 0, audioExtract: 0 },
  environment: { platform: os.platform(), node: process.version }, contextCoverage: [], particleChecks: [] };
const candidate = () => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
  area: { x: 0.3, y: 0.3, width: 0.4, height: 0.3 }, title: '直角三角形候选',
  explanation: '两条直角边来自这张画面的候选条件，仍须学生确认。', pitfallHint: '斜边需要平方关系，不能直接相加。' });
const provider = async (_url, init) => {
  assert.equal(typeof init.body, 'string', 'only explicit JSON visual stub is available');
  const input = JSON.parse(init.body); const system = input.messages[0].content; let answer;
  if (system.includes('本次仅收到按时间排序的稀疏截图')) {
    evidence.calls.context += 1; const parts = input.messages[1].content;
    const metadata = JSON.parse(parts[0].text);
    const times = parts.filter((part) => part.type === 'text' && part.text.startsWith('截图 frameTime='))
      .map((part) => Number(/frameTime=([\d.]+)/.exec(part.text)[1]));
    evidence.contextCoverage.push({ times, frameCount: parts.filter((part) => part.type === 'image_url').length,
      authorCueCount: metadata.authorCues.length, audio: false, wholeVideo: false });
    answer = { summary: '仅这组稀疏画面涉及直角三角形边长关系。', keyPoints: ['确认直角与单位'], pitfalls: ['斜边不能直接相加'],
      objects: [{ frameTime: times[0], result: candidate() }] };
  } else if (input.messages.some((item) => Array.isArray(item.content))) { evidence.calls.read += 1; answer = candidate(); }
  else { evidence.calls.summary += 1; answer = { summary: '仅已观察画面的候选总结。', keyPoints: ['统一单位'], pitfalls: ['确认斜边'] }; }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
};
const freePort = () => new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close((error) => error ? reject(error) : resolve(port)); }); });
const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
const settings = loadSettings({ READER_BASE_URL: 'http://explicit-stub.invalid', READER_API_KEY: 'injected-test-only', READER_MODEL: 'explicit-vision-stub' });
const server = createLearningSiteServer({ settings, allowedOrigins: [origin], dataDir: path.join(output, 'private-account-data'), fetchImpl: provider,
  audioExtractImpl: async () => { evidence.calls.audioExtract += 1; throw new Error('Unconfigured audio must never extract.'); } });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
let browser; let context; let page; let phase = 'initialization';
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });
const step = async (name, action) => { phase = name; await action(); evidence.checks[name] = true; };
const shot = async (name) => { await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); evidence.screenshots.push(name + '.png'); };
const nav = async (view) => { await page.locator(`.site-sidebar [data-view="${view}"]`).click(); };
const action = (name) => page.locator(`#math-workbench [data-math-action="${name}"]`);
const mathStatus = () => action('status');
const localData = () => page.evaluate(() => BreakGlass.webRecords.createLocalStore(localStorage).read());
async function api(method, route, body) {
  return page.evaluate(async ({ method, route, body }) => {
    const me = await (await fetch('/api/account/me')).json();
    const response = await fetch(route, { method, headers: { 'content-type': 'application/json', 'x-breakglass-csrf': me.csrfToken || '' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, value: await response.json() };
  }, { method, route, body });
}
async function register(username) {
  await nav('account'); await page.locator('#username').fill(username); await page.locator('#password').fill('only-local-completion-test');
  await page.locator('#register').click(); await wait(() => document.querySelector('#account-status').textContent.includes('当前账户：'));
  await wait(() => !document.querySelector('#account-option').disabled);
}
async function login(username) {
  await nav('account'); await page.locator('#username').fill(username); await page.locator('#password').fill('only-local-completion-test');
  await page.locator('#login').click(); await wait((name) => document.querySelector('#account-status').textContent.includes(name), username);
}
function expected(record) {
  const s = record.snapshot;
  if (record.template === 'line') return s.b;
  if (record.template === 'circle') return Math.PI * s.r * s.r;
  if (record.template === 'sine') return 2 * Math.PI / Math.abs(s.omega);
  if (record.template === 'similar-triangles') return s.scale * s.scale;
  if (record.template === 'cuboid') return s.length * s.width * s.height;
  if (record.template === 'right-triangle') return Math.hypot(s.AB, s.AC);
  return { h: s.h, k: s.k };
}
async function currentRecord(scope) {
  const data = scope === 'account' ? (await api('GET', '/api/learning/records')).value : await localData(); return data.records.at(-1);
}
async function fillAnswer(answer) {
  if (typeof answer === 'number') await page.locator('#math-workbench [data-math-answer="number"]').fill(String(answer));
  else for (const key of ['h', 'k']) await page.locator(`#math-workbench [data-math-answer="${key}"]`).fill(String(answer[key]));
}
async function saveMath(title) {
  await page.locator('#math-workbench').getByLabel('保存标题', { exact: true }).fill(title);
  await action('save').click(); await wait(() => document.querySelector('[data-math-action="status"]').textContent.includes('已保存'));
  assert.equal(await action('submit').isDisabled(), false);
}
async function submit(answer, outcome) {
  await fillAnswer(answer); await action('submit').click();
  await wait((text) => document.querySelector('[data-math-action="status"]').textContent.includes(text), outcome);
}
async function editRecord(title) {
  await nav('records'); await page.locator('#refresh-center').click();
  const card = page.locator('#record-list .record-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: '编辑备注 / 易错原因', exact: true }).click();
  await page.locator('#annotation-workbench').getByRole('button', { name: '保存备注', exact: true }).waitFor();
  await wait(() => document.querySelector('#annotation-workbench [role="status"]').textContent.includes('可以编辑'));
  return page.locator('#annotation-workbench');
}
try {
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  evidence.environment.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage();
  await page.addInitScript(() => {
    // Observe real browser WebGL buffers without replacing the renderer or its math.
    globalThis.__completionGLWrites = [];
    const original = WebGLRenderingContext.prototype.bufferData;
    WebGLRenderingContext.prototype.bufferData = function (...args) {
      const data = args[1]; if (ArrayBuffer.isView(data)) {
        let digest = 0; for (let index = 0; index < data.length; index += 1) digest += data[index] * (index % 23 + 1);
        globalThis.__completionGLWrites.push({ length: data.length, digest });
      }
      return original.apply(this, args);
    };
  });
  page.on('pageerror', (error) => evidence.errors.push({ kind: 'pageerror', message: error.message }));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource: the server responded with a status of')) {
    evidence.errors.push({ kind: 'console', message: message.text() }); } });
  page.on('response', (response) => { if (response.status() >= 400) evidence.expectedHTTPFailures.push({
    route: new URL(response.url()).pathname.replace(/^(\/api\/annotations)\/[^/]+$/, '$1/:recordId'), status: response.status() }); });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(origin + '/learning-site/index.html'); await wait(() => document.querySelector('#account-status').textContent.includes('未登录'));
  await step('fiveManualTemplatesActualLocalSaveAnswersAndExploration', async () => {
    await nav('practice'); assert.equal(await page.locator('.math-path-node').count(), 7);
    assert.equal(await page.locator('.math-path-node').filter({ hasText: '待验证' }).count(), 7);
    for (const template of ['line', 'circle', 'sine', 'similar-triangles', 'cuboid']) {
      await action('template').selectOption(template); await action('new').click(); await saveMath('completion-local-' + template);
      assert.equal(await page.locator('#math-workbench .math-particles canvas').count(), 0, 'new scene disposes the previous renderer');
      const record = await currentRecord('local'); assert.equal(record.template, template); assert.equal(record.origin, 'manual'); assert.equal(record.source.kind, 'manual-notes');
      if (template === 'line') await action('hint').click();
      if (template === 'circle') await submit(0, '这次答错');
      await submit(expected(record), template === 'line' ? '借助提示答对' : '独立答对');
      const data = await localData(); assert.equal(data.attempts.at(-1).correct, true); assert.equal(data.attempts.at(-1).hintUsed, template === 'line');
      const parameter = page.locator('#math-workbench [data-math-parameter]').first();
      const originalSVG = await page.locator('#math-workbench .math-svg svg').getAttribute('viewBox'); assert.ok(originalSVG);
      const initial = Number(await parameter.inputValue()); await parameter.fill(String(initial + 0.5)); await action('apply').click();
      assert.equal(await action('submit').isDisabled(), true); assert.match(await mathStatus().textContent(), /参数探索/);
      await action('restore').click(); assert.equal(await parameter.inputValue(), String(initial));
      const glBefore = await page.evaluate(() => __completionGLWrites.length); await action('particles').click();
      assert.equal(await page.locator('#math-workbench .math-particles canvas').count(), 1);
      assert.equal(await page.locator('#math-workbench .math-svg svg').count(), 1);
      const webGL = !await action('camera-yaw').isDisabled();
      if (webGL) {
        const firstBuffers = await page.evaluate((start) => __completionGLWrites.slice(start), glBefore); assert.ok(firstBuffers.length > 0);
        await action('camera-yaw').evaluate((input) => { input.value = '17'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await action('camera-pitch').evaluate((input) => { input.value = '-11'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await action('camera-reset').click();
        assert.ok(Math.abs(Number(await action('camera-yaw').inputValue()) - (template === 'cuboid' ? -0.55 * 180 / Math.PI : 0)) <= 1);
        assert.ok(Math.abs(Number(await action('camera-pitch').inputValue()) - (template === 'cuboid' ? 0.35 * 180 / Math.PI : 0)) <= 1);
        const beforeUpdate = await page.evaluate(() => __completionGLWrites.length);
        await parameter.fill(String(initial + 0.5)); await action('apply').click();
        const updated = await page.evaluate((start) => __completionGLWrites.slice(start), beforeUpdate);
        assert.equal(updated.length, firstBuffers.length); assert.notDeepEqual(updated, firstBuffers, template + ' applies math parameters to real WebGL buffers');
        assert.equal((await localData()).records.find((item) => item.id === record.id).snapshot[await parameter.getAttribute('data-math-parameter')], initial);
        await action('restore').click(); assert.equal(await page.locator('#math-workbench .math-particles canvas').count(), 0);
        await action('particles').click();
      } else assert.match(await page.locator('#math-workbench').textContent(), /粒子视图不可用/);
      evidence.particleChecks.push({ template, svgPresent: true, canvasPresent: true, webGL, cameraReset: webGL, bufferUpdateVerified: webGL });
      await shot('completion-' + template);
    }
    const data = await localData(); assert.equal(data.records.length, 5); assert.equal(data.attempts.length, 6);
    assert.ok(data.attempts.some((attempt) => attempt.outcome === 'wrong')); assert.ok(data.attempts.some((attempt) => attempt.outcome === 'correct_with_hint'));
  });
  await step('mixedPracticeRotatesFiveManualTemplatesWithoutCreatingAnswers', async () => {
    const before = await localData(); const visited = [];
    for (let index = 0; index < 5; index += 1) {
      await nav('records'); await page.locator('#mixed-practice').click();
      const title = await page.locator('#math-workbench > section > h3').textContent();
      const record = before.records.find((item) => item.title === title); assert.ok(record); visited.push(record.template);
    }
    assert.deepEqual(new Set(visited), new Set(['line', 'circle', 'sine', 'similar-triangles', 'cuboid']));
    assert.deepEqual((await localData()).attempts, before.attempts, 'opening mixed practice does not create fabricated answer evidence');
  });
  await step('sevenLearningNodesReflectActualReceiptsAndIndependentVariant', async () => {
    for (const id of ['coordinate-vertex', 'square-distance']) {
      await action('diagnostic-' + id).click(); await action('save').click();
      await wait(() => document.querySelector('[data-math-action="status"]').textContent.includes('手工题已保存'));
      const record = await currentRecord('local'); await submit(expected(record), '独立答对');
    }
    const data = await localData(); const graph = await page.evaluate(() => BreakGlass.mathLearning.learningGraph(BreakGlass.webRecords.createLocalStore(localStorage).read()));
    assert.equal(graph.length, 7); assert.equal(graph.every((node) => node.evidenceCount > 0), true);
    assert.equal(graph.find((node) => node.template === 'line').state, '使用提示完成');
    assert.equal(graph.filter((node) => node.state === '最近一次独立正确').length, 6);
    assert.equal(graph.filter((node) => node.diagnosticCount === 1).length, 2);
    const before = data.records.map((record) => ({ id: record.id, snapshot: record.snapshot }));
    await action('variant').click(); await action('save').click(); await wait(() => document.querySelector('[data-math-action="status"]').textContent.includes('已保存'));
    const after = await localData(); assert.equal(after.records.length, before.length + 1);
    for (const original of before) assert.deepEqual(after.records.find((record) => record.id === original.id).snapshot, original.snapshot);
    const variant = after.records.at(-1); assert.equal(variant.origin, 'manual'); assert.equal(variant.source.kind, 'manual-notes');
    await submit(expected(variant), '独立答对');
  });
  await step('localAnnotationChangesOnlyMetadata', async () => {
    const before = await localData(); const record = before.records.find((item) => item.title === 'completion-local-line');
    const editor = await editRecord(record.title); await editor.getByLabel('标题', { exact: true }).fill('本机直线易错原因');
    await editor.getByLabel('个人备注', { exact: true }).fill('先令x为0，再观察纵截距。');
    await editor.locator('select').selectOption('pitfall'); await editor.getByLabel(/原因标签/).fill('截距，符号');
    await editor.getByRole('button', { name: '保存备注', exact: true }).click();
    await wait(() => document.querySelector('#annotation-workbench [role="status"]').textContent.includes('修订 1'));
    const after = await localData(); assert.deepEqual(after.records.find((item) => item.id === record.id), record); assert.deepEqual(after.attempts, before.attempts);
    await page.getByRole('heading', { name: '本机直线易错原因', exact: true }).waitFor();
  });
  const alice = 'completion_a_' + Date.now().toString(36); const bob = 'completion_b_' + Date.now().toString(36);
  await step('accountManualTemplateActualSaveAndJudgment', async () => {
    await register(alice); await nav('practice'); await action('template').selectOption('line'); await action('new').click();
    await saveMath('completion-account-line'); const record = await currentRecord('account'); await submit(expected(record), '独立答对');
    assert.equal((await api('GET', '/api/learning/attempts')).value.attempts.length, 1);
  });
  await step('accountAnnotation409PreservesInputAndOriginalMath', async () => {
    const record = (await api('GET', '/api/learning/records')).value.records.find((item) => item.title === 'completion-account-line');
    const editor = await editRecord(record.title); await editor.getByLabel('标题', { exact: true }).fill('我的冲突输入仍应保留');
    await editor.getByLabel('个人备注', { exact: true }).fill('我选择重新核对后再保存。'); await editor.getByLabel(/原因标签/).fill('截距');
    const current = await api('GET', '/api/annotations/' + record.id);
    const other = await api('PUT', '/api/annotations/' + record.id, { annotation: { title: '另一页面的新修订', note: '其他页面更新', kind: 'question', tags: ['符号'] },
      expectedRevision: current.value.annotation?.revision || 0, expectedEpoch: current.value.epoch }); assert.equal(other.status, 200);
    await editor.getByRole('button', { name: '保存备注', exact: true }).click();
    await wait(() => document.querySelector('#annotation-workbench [role="status"]').textContent.includes('输入已保留'));
    assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '我的冲突输入仍应保留');
    assert.equal(await editor.getByRole('button', { name: '保存备注', exact: true }).isDisabled(), true);
    await editor.getByRole('button', { name: '重新读取版本（保留输入）', exact: true }).click();
    await wait(() => document.querySelector('#annotation-workbench [role="status"]').textContent.includes('已读取最新'));
    await editor.getByRole('button', { name: '保存备注', exact: true }).click();
    await wait(() => document.querySelector('#annotation-workbench [role="status"]').textContent.includes('修订 2'));
    assert.deepEqual((await api('GET', '/api/learning/records')).value.records.find((item) => item.id === record.id), record);
    assert.equal((await api('GET', '/api/learning/attempts')).value.attempts.length, 1); await shot('completion-annotation-conflict-resolved');
  });
  await step('actualKnownMediaProgressiveDecodePrivateCacheHitAndClear', async () => {
    await nav('import'); await page.locator('#sample-triangle').click(); await wait(() => !document.querySelector('#start-analysis').disabled);
    await page.evaluate(() => { const video = document.querySelector('#learning-video'); video.pause(); video.currentTime = 4; });
    await wait(() => !document.querySelector('#learning-video').seeking && document.querySelector('#learning-video').readyState >= 2);
    const begin = page.locator('#progressive-workbench').getByRole('button', { name: '开始分段分析', exact: true });
    const prior = evidence.calls.context; await begin.click();
    await wait(() => document.querySelector('#progressive-workbench').textContent.includes('本任务片段已逐段处理'));
    assert.equal(evidence.calls.context, prior + 1); assert.equal(await page.locator('#learning-video').evaluate((video) => video.currentTime), 4);
    assert.equal(evidence.contextCoverage.at(-1).frameCount, 4); assert.ok(evidence.contextCoverage.at(-1).authorCueCount > 0);
    assert.match(await page.locator('#progressive-workbench').textContent(), /已分析 1\/1/);
    await begin.click(); await wait(() => document.querySelector('#progressive-workbench').textContent.includes('来自前次AI分析'));
    assert.equal(evidence.calls.context, prior + 1); await shot('completion-progressive-private-cache');
    await page.locator('#progressive-workbench').getByRole('button', { name: '清除当前账户 / 访客分析缓存', exact: true }).click();
    await wait(() => document.querySelector('#progressive-workbench').textContent.includes('缓存已由服务清除'));
    await begin.click(); await wait(() => document.querySelector('#progressive-workbench').textContent.includes('本任务片段已逐段处理'));
    assert.equal(evidence.calls.context, prior + 2);
  });
  await step('unconfiguredAudioFailsBeforeAnyExtractionOrSupplierCall', async () => {
    const before = { ...evidence.calls }; await page.locator('#audio-workbench').getByRole('button', { name: '转写这段音轨', exact: true }).click();
    await wait(() => document.querySelector('#audio-workbench').textContent.includes('尚未配置'));
    assert.deepEqual(evidence.calls, before); assert.equal(evidence.calls.audioExtract, 0); assert.equal(await page.locator('#learning-video').evaluate((video) => video.readyState >= 2), true);
  });
  await step('unknownFingerprintIsPreviewOnlyAndSendsZeroAIInputs', async () => {
    const original = fs.readFileSync(path.join(repository, 'extension/assets/video/geometry/triangle-3-4-5.mp4'));
    const before = { ...evidence.calls };
    await page.locator('#video-file').setInputFiles({ name: 'unknown-self-video.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([original, Buffer.from('unknown-fingerprint-test')]) });
    await wait(() => document.querySelector('#policy-status').textContent.includes('未登记'));
    assert.equal(await page.locator('#start-analysis').isDisabled(), true); assert.equal(await page.locator('#analyze-context').isDisabled(), true);
    assert.equal(await page.locator('#progressive-workbench').getByRole('button', { name: '开始分段分析', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#learning-video').evaluate((video) => video.readyState >= 1 && video.duration > 0), true);
    assert.deepEqual(evidence.calls, before); await shot('completion-unknown-preview-only');
  });
  await step('accountSwitchAndDeleteDoNotLeakPreviousRecordsOrAnnotations', async () => {
    await register(bob); assert.equal((await api('GET', '/api/learning/records')).value.records.length, 0);
    assert.equal((await api('GET', '/api/annotations')).value.annotations.length, 0);
    await nav('records'); assert.equal(await page.locator('#record-list .record-card').count(), 0);
    await login(alice); await nav('records'); await page.locator('#refresh-center').click();
    await page.getByRole('heading', { name: '我的冲突输入仍应保留', exact: true }).waitFor();
    await nav('account'); await page.locator('#delete-account-data').click(); await wait(() => document.querySelector('#data-status').textContent.includes('删除已由服务确认'));
    for (const [route, key] of [['/api/learning/records', 'records'], ['/api/learning/attempts', 'attempts'], ['/api/annotations', 'annotations']]) assert.equal((await api('GET', route)).value[key].length, 0);
    assert.equal((await localData()).records.length, 8);
  });
  await step('desktopMobileLayoutAndConsole', async () => {
    await page.locator('#view-local').click(); await nav('practice'); await action('template').selectOption('cuboid'); await action('new').click();
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' horizontal overflow');
      await shot('completion-' + name);
    }
    assert.deepEqual(evidence.errors, []);
    assert.equal(evidence.expectedHTTPFailures.every((item) => (item.route.startsWith('/api/annotations/') && item.status === 409)
      || (item.route === '/api/audio/session' && item.status === 503)), true, 'only the intentional revision conflict and unconfigured audio should fail HTTP');
  });
  await step('unavailableWebGLKeepsMathAndActualPracticeUsable', async () => {
    await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl' ? null : original.call(this, type, ...rest); }; });
    await page.reload(); await page.locator('#view-local').click(); await nav('practice');
    await action('template').selectOption('cuboid'); await action('new').click(); await action('particles').click();
    assert.equal(await action('camera-yaw').isDisabled(), true); assert.match(await page.locator('#math-workbench').textContent(), /粒子视图不可用/);
    assert.equal(await page.locator('#math-workbench .math-svg svg').count(), 1);
    await saveMath('completion-fallback-cuboid'); const record = await currentRecord('local'); await submit(expected(record), '独立答对');
    assert.equal((await localData()).attempts.at(-1).correct, true); await shot('completion-svg-fallback'); assert.deepEqual(evidence.errors, []);
  });
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = { phase, message: error.message };
  if (page) await shot('completion-failure').catch(() => {}); process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, phase: evidence.failure?.phase, checks: Object.keys(evidence.checks).length,
    output, errors: evidence.errors.length, realAI: false, publicCloudDeployment: false }));
}
