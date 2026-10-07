const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const modules = Promise.all([import('../scripts/evaluate-learning-model.mjs'),
  import('../breakglass-reader/tests/helpers/fixtures.mjs'), import('../breakglass-reader/src/settings.mjs')]);
const runFile = promisify(execFile);
const REPOSITORY = path.resolve(__dirname, '..');
const script = path.join(REPOSITORY, 'scripts/evaluate-learning-model.mjs');
const visual = (overrides = {}) => ({ schemaVersion: '1', template: 'right-triangle', snapshot: { AB: 3, AC: 4, unit: 'cm' },
  area: null, title: 'provider-private-title', explanation: 'provider-private-explanation', pitfallHint: 'provider-private-hint', ...overrides });
async function fixture() {
  const [api, fixtures, settingsApi] = await modules;
  return { ...api, frames: api.FRAME_TIMES.map((frameTime) => ({ frameTime, image: fixtures.FRAME_DATA_URL })),
    settings: settingsApi.loadSettings({ READER_BASE_URL: 'https://provider.example.invalid/private-endpoint',
      READER_API_KEY: 'fake-key-secret', READER_MODEL: 'test-model', READER_JSON_MODE: '1' }) };
}
function provider(answer) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    const value = typeof answer === 'function' ? answer(body, calls.length) : answer;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
      { headers: { 'content-type': 'application/json' } });
  } };
}
const contextual = (objects) => ({ summary: 'provider-private-summary', keyPoints: ['provider-private-keypoint'],
  pitfalls: ['provider-private-pitfall'], objects });
async function temporary(run) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-learning-evaluation-'));
  try { await run(folder); }
  finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('breakglass-learning-evaluation-'));
    await fs.rm(folder, { recursive: true, force: true });
  }
}

test('未配置或未主动启用时not-run且零provider调用，不需媒体工具或伪造验收成功', async () => {
  const f = await fixture(); let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('must_not_call'); };
  for (const patch of [{ baseUrl: '' }, { apiKey: '' }, { model: '' }]) {
    const report = await f.evaluateLearningModel({ settings: { ...f.settings, ...patch }, enabled: true, fetchImpl });
    assert.equal(report.status, 'not-run'); assert.equal(report.code, 'unconfigured');
    assert.equal(report.providerCalls, 0); assert.equal(report.applicationCalls, 0); assert.equal(report.metrics, null);
    assert.equal(report.evidenceKind, 'none'); assert.equal(f.evaluationExitCode(report), 2);
  }
  const report = await f.evaluateLearningModel({ settings: f.settings, fetchImpl });
  assert.equal(report.status, 'not-run'); assert.equal(report.code, 'not_requested'); assert.equal(calls, 0);
});

test('固定自制素材全文件指纹和作者VTT指纹绑定登记，时间窗不声称读取音频整课', async () => {
  const f = await fixture(); const registered = await f.evaluationFixture();
  assert.match(registered.source.id, /^file-[a-f0-9]{64}$/);
  assert.equal(registered.source.materialMode, 'self-authored'); assert.equal(registered.source.version, '1');
  assert.match(registered.contextSourceId, /^subtitle-[a-f0-9]{64}$/);
  assert.equal(registered.cues.length, 2); assert.ok(registered.cues.every((cue) => cue.text.includes('作者提供')));
  const report = await f.evaluateLearningModel();
  assert.equal(report.source.id, registered.source.id); assert.equal(report.source.contextSourceId, registered.contextSourceId);
  assert.equal(report.scope.audio, false); assert.equal(report.scope.completeVideo, false);
  assert.equal(report.scope.longCourse, false); assert.equal(report.scope.studentLearningStudy, false);
  assert.equal(report.scope.thirdPartyPlatform, 'permission-pending');
});

test('transport注入仍调用真实readLearning与context函数，3单帧加1组合共4次，不计真实模型证据', async () => {
  const f = await fixture();
  const model = provider((body, index) => index <= 3 ? visual() : contextual(f.FRAME_TIMES.map((frameTime) => ({ frameTime, result: visual() }))));
  let time = 10;
  const report = await f.evaluateLearningModel({ settings: f.settings, enabled: true, frames: f.frames, fetchImpl: model.fetchImpl,
    clock: () => { time += 5; return time; }, generatedAt: '2026-10-06T00:00:00.000Z' });
  assert.equal(report.status, 'completed'); assert.equal(report.evidenceKind, 'injected-transport');
  assert.equal(report.applicationCalls, 4); assert.equal(report.providerCalls, 4); assert.equal(model.calls.length, 4);
  assert.deepEqual(report.calls.map((call) => call.elapsedMs), [5, 5, 5, 5]);
  for (const call of model.calls.slice(0, 3)) assert.equal(call.body.messages[1].content.filter((part) => part.type === 'image_url').length, 1);
  assert.equal(model.calls[3].body.messages[1].content.filter((part) => part.type === 'image_url').length, 3);
  const metadata = JSON.parse(model.calls[3].body.messages[1].content[0].text);
  assert.equal(metadata.authorCues.length, 2); assert.equal(metadata.coverage.audio, false); assert.equal(metadata.coverage.completeVideo, false);
  assert.deepEqual(report.metrics.singleFrames, { expected: 3, templateMatched: 3, numericMatched: 3, unitMatched: 3, matched: 3 });
  assert.equal(report.metrics.contextFrames.matched, 3); assert.equal(report.metrics.allFixtureCandidatesMatched, true);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /data:image|fake-key-secret|private-endpoint|provider-private|https:\/\/|authorization/i);
});

test('候选误差、单位不符、needs_review和上下文缺帧分开记录，不将失败或缺失算正确', async () => {
  const f = await fixture();
  const model = provider((body, index) => index === 1 ? visual({ snapshot: { AB: 3.2, AC: 4, unit: 'cm' } })
    : index === 2 ? { schemaVersion: '1', status: 'needs_review' }
      : index === 3 ? visual({ snapshot: { AB: 3, AC: 4, unit: 'm' } })
        : contextual([{ frameTime: 2, result: visual() }, { frameTime: 8, result: visual({ snapshot: { AB: 2, AC: 4, unit: 'cm' } }) }]));
  const report = await f.evaluateLearningModel({ settings: f.settings, enabled: true, frames: f.frames, fetchImpl: model.fetchImpl });
  assert.ok(Math.abs(report.calls[0].absoluteError.AB - 0.2) < 1e-9); assert.equal(report.calls[0].numericMatched, false);
  assert.equal(report.calls[1].resultStatus, 'needs_review'); assert.equal(report.calls[1].absoluteError.AB, null);
  assert.equal(report.calls[2].numericMatched, true); assert.equal(report.calls[2].unitMatched, false);
  assert.equal(report.calls[3].comparisons[1].returned, false); assert.equal(report.calls[3].comparisons[1].matched, false);
  assert.equal(report.metrics.singleFrames.matched, 0); assert.equal(report.metrics.contextFrames.matched, 1);
  assert.equal(report.metrics.contextFrames.returned, 2); assert.equal(report.metrics.allFixtureCandidatesMatched, false);
  assert.equal(f.evaluationExitCode(report), 1);
});

test('错误模板与非法模型结构经实际reader拒绝，异常不把provider原文写报告或自动重试', async () => {
  const f = await fixture();
  const model = provider((body, index) => index === 1 ? visual({ template: 'parabola', snapshot: { a: 1, h: 0, k: 0 } })
    : index === 2 ? visual({ snapshot: { AB: 3, AC: 4, unit: 'cm', BC: 5 } })
      : index === 3 ? { unsupportedProviderField: 'provider-private-secret' } : contextual([]));
  const report = await f.evaluateLearningModel({ settings: f.settings, enabled: true, frames: f.frames, fetchImpl: model.fetchImpl });
  assert.equal(report.calls[0].templateMatched, false); assert.equal(report.calls[0].absoluteError.AB, null);
  assert.equal(report.calls[1].httpStatus, 502); assert.equal(report.calls[2].httpStatus, 502);
  assert.equal(report.providerCalls, 4); assert.equal(report.metrics.contextFrames.matched, 0);
  assert.doesNotMatch(JSON.stringify(report), /provider-private|unsupportedProviderField|BC/);
});

test('无效或错误采样时间和非JPEG帧先拒绝，零provider调用', async () => {
  const f = await fixture(); let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('must_not_call'); };
  for (const frames of [[], f.frames.slice(0, 2), f.frames.map((frame, index) => index === 0 ? { ...frame, frameTime: 1 } : frame),
    f.frames.map((frame) => ({ ...frame, image: 'https://media.invalid/frame' }))]) {
    const report = await f.evaluateLearningModel({ settings: f.settings, enabled: true, frames, fetchImpl });
    assert.equal(report.status, 'not-run'); assert.equal(report.code, 'invalid_frames'); assert.equal(report.providerCalls, 0);
  }
  assert.equal(calls, 0);
});

test('报告仅写绝对仓库外新文件，已有报告不覆盖，仓库与相对路径拒绝', async () => {
  const f = await fixture(); const report = await f.evaluateLearningModel();
  await temporary(async (folder) => {
    const output = path.join(folder, 'report.json');
    assert.equal(await f.writeEvaluationReport(output, report), output);
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), report);
    await assert.rejects(f.writeEvaluationReport(output, { ...report, code: 'replace' }), /EEXIST/);
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).code, 'unconfigured');
    await assert.rejects(f.writeEvaluationReport('relative-report.json', report), /absolute_output_required/);
    await assert.rejects(f.writeEvaluationReport(path.join(REPOSITORY, 'unwanted-evaluation.json'), report), /outside_repository_required/);
  });
});

test('实际CLI未配置运行退出2并输出not-run零调用报告，不需要FFmpeg或密钥', async () => {
  await temporary(async (folder) => {
    const output = path.join(folder, 'not-run.json');
    const env = { ...process.env, READER_BASE_URL: '', READER_API_KEY: '', READER_MODEL: '', FFMPEG: 'missing-ffmpeg-evaluation-test' };
    let result;
    try { await runFile(process.execPath, [script, '--output', output], { env, windowsHide: true }); }
    catch (error) { result = error; }
    assert.equal(result.code, 2); assert.deepEqual(JSON.parse(result.stdout), { status: 'not-run', code: 'unconfigured', providerCalls: 0 });
    const report = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(report.status, 'not-run'); assert.equal(report.providerCalls, 0); assert.equal(report.calls.length, 0);
    assert.equal(report.evidenceKind, 'none'); assert.equal(report.metrics, null);
  });
});

test('仓库外目录链接指向仓库时也不能写报告或创建子目录', async (t) => {
  const f = await fixture(); const report = await f.evaluateLearningModel();
  await temporary(async (folder) => {
    const link = path.join(folder, 'repository-link');
    try { await fs.symlink(REPOSITORY, link, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('当前主机不允许目录链接'); return; } throw error; }
    try {
      const target = path.join(link, 'unwanted-evaluation-folder', 'report.json');
      await assert.rejects(f.writeEvaluationReport(target, report), /outside_repository_required/);
      await assert.rejects(fs.stat(path.join(REPOSITORY, 'unwanted-evaluation-folder')), /ENOENT/);
    } finally { await fs.unlink(link); }
  });
});
