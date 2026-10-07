import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
import { readLearning, checkLearningRead } from '../breakglass-reader/src/learning.mjs';
import { readLearningContext, checkLearningContext } from '../breakglass-reader/src/learning-context.mjs';
import { registeredSources } from './learning-site.mjs';

const require = createRequire(import.meta.url);
const { parseTextCues, selectCueWindow } = require('../extension/src/plugin/video-context.js');
const runFile = promisify(execFile);
const REPOSITORY = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const VIDEO = path.join(REPOSITORY, 'extension/assets/video/geometry/triangle-3-4-5.mp4');
const SUBTITLE = path.join(REPOSITORY, 'extension/assets/video/geometry/triangle-3-4-5.zh.vtt');
export const FRAME_TIMES = Object.freeze([2, 4, 8]);
export const GROUND_TRUTH = Object.freeze({ template: 'right-triangle', AB: 3, AC: 4, unit: 'cm' });
const configured = (settings) => Boolean(settings?.baseUrl && settings?.apiKey && settings?.model);
const inside = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** No general file, URL or permission override: use the gateway's authored material registry. */
export async function evaluationFixture() {
  const [video, text] = await Promise.all([fs.readFile(VIDEO), fs.readFile(SUBTITLE, 'utf8')]);
  const sourceId = 'file-' + createHash('sha256').update(video).digest('hex');
  const contextSourceId = 'subtitle-' + createHash('sha256').update(text).digest('hex');
  const registered = registeredSources().get(sourceId);
  if (!registered || registered.source.materialMode !== 'self-authored' || registered.context?.id !== contextSourceId) {
    throw new Error('fixture_not_registered');
  }
  const parsed = parseTextCues(text, { format: 'vtt' });
  const selected = parsed.ok && selectCueWindow(parsed.cues, FRAME_TIMES[0], FRAME_TIMES.at(-1));
  if (!selected?.ok) throw new Error('fixture_subtitles_invalid');
  return { source: { ...registered.source }, contextSourceId, cues: selected.cues };
}

/** Existing local FFmpeg only; JPEG bytes stay in memory, and audio is excluded. */
export async function extractEvaluationFrames({ ffmpeg = process.env.FFMPEG || 'ffmpeg' } = {}) {
  const frames = [];
  for (const frameTime of FRAME_TIMES) {
    const { stdout } = await runFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(frameTime),
      '-i', VIDEO, '-frames:v', '1', '-an', '-vf', 'scale=640:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 20000, windowsHide: true });
    frames.push({ frameTime, image: 'data:image/jpeg;base64,' + stdout.toString('base64') });
  }
  return frames;
}

/** Compare with manual labels. Errors are numerical metrics, never provider prose. */
export function triangleMetrics(candidate) {
  const templateMatched = candidate?.template === GROUND_TRUTH.template;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const AB = templateMatched && finite(candidate.snapshot?.AB) ? Math.abs(candidate.snapshot.AB - GROUND_TRUTH.AB) : null;
  const AC = templateMatched && finite(candidate.snapshot?.AC) ? Math.abs(candidate.snapshot.AC - GROUND_TRUTH.AC) : null;
  const numericMatched = AB !== null && AC !== null && AB <= 1e-9 && AC <= 1e-9;
  const unitMatched = templateMatched && candidate.snapshot?.unit === GROUND_TRUTH.unit;
  return { templateMatched, numericMatched, unitMatched, absoluteError: { AB, AC },
    matched: templateMatched && numericMatched && unitMatched };
}

function baseReport(fixture, generatedAt, evidenceKind) {
  return { schemaVersion: '1', status: 'not-run', code: 'not_requested', evidenceKind, generatedAt,
    scope: { material: 'repository-authored-triangle-fixture', durationSeconds: 12,
      frameTimes: [...FRAME_TIMES], audio: false, completeVideo: false, longCourse: false,
      studentLearningStudy: false, thirdPartyPlatform: 'permission-pending' },
    source: { id: fixture.source.id, videoVersion: fixture.source.version,
      analysisVersion: fixture.source.analysisVersion, materialMode: fixture.source.materialMode,
      contextSourceId: fixture.contextSourceId },
    groundTruth: { ...GROUND_TRUTH, basis: 'manual-labels-of-authored-fixture' },
    providerCalls: 0, applicationCalls: 0, calls: [], metrics: null };
}

/** Transport injection is explicitly labelled as a test, never evidence of a real model. */
export async function evaluateLearningModel({ settings = loadSettings({}), enabled = false, frames,
  fetchImpl, clock = () => performance.now(), generatedAt = new Date().toISOString() } = {}) {
  const fixture = await evaluationFixture();
  const report = baseReport(fixture, generatedAt, 'none');
  if (!configured(settings)) { report.code = 'unconfigured'; return report; }
  if (!enabled) return report;
  const metadata = { schemaVersion: '1', sourceId: fixture.source.id, videoVersion: fixture.source.version,
    analysisVersion: fixture.source.analysisVersion, materialMode: fixture.source.materialMode };
  if (!Array.isArray(frames) || frames.length !== FRAME_TIMES.length
    || frames.some((frame, index) => frame?.frameTime !== FRAME_TIMES[index]
      || !checkLearningRead({ ...metadata, requestId: 'evaluation-validation', ...frame }).ok)) {
    report.code = 'invalid_frames'; return report;
  }
  const contextRequest = { ...metadata, requestId: 'evaluation-context', frames,
    contextSourceId: fixture.contextSourceId, cues: fixture.cues };
  if (!checkLearningContext(contextRequest).ok) { report.code = 'invalid_context'; return report; }
  report.evidenceKind = fetchImpl ? 'injected-transport' : 'real-model';
  const transport = async (...args) => { report.providerCalls += 1; return (fetchImpl || fetch)(...args); };
  const envelopeMatches = (value) => value?.schemaVersion === metadata.schemaVersion
    && value?.sourceId === metadata.sourceId && value?.videoVersion === metadata.videoVersion
    && value?.analysisVersion === metadata.analysisVersion;
  for (const frame of frames) {
    const requestId = 'evaluation-frame-' + frame.frameTime;
    const start = clock(); report.applicationCalls += 1;
    const result = await readLearning({ ...metadata, requestId, ...frame }, { settings, fetchImpl: transport });
    const candidate = result.status === 200 && envelopeMatches(result.payload)
      && result.payload.requestId === requestId && result.payload.frameTime === frame.frameTime
      && result.payload.status === 'candidate' ? result.payload.result : null;
    report.calls.push({ kind: 'frame', frameTime: frame.frameTime, elapsedMs: Math.max(0, clock() - start),
      httpStatus: result.status, resultStatus: candidate ? 'candidate' :
        ['needs_review', 'unsupported'].includes(result.payload?.status) ? result.payload.status : 'failed',
      ...triangleMetrics(candidate) });
  }
  const start = clock(); report.applicationCalls += 1;
  const context = await readLearningContext(contextRequest, { settings, fetchImpl: transport });
  const valid = context.status === 200 && envelopeMatches(context.payload)
    && context.payload.requestId === contextRequest.requestId && context.payload.status === 'context'
    && context.payload.contextSourceId === fixture.contextSourceId;
  const objects = valid ? context.payload.objects : [];
  const comparison = FRAME_TIMES.map((frameTime) => {
    const object = objects.find((item) => item.frameTime === frameTime);
    return { frameTime, returned: Boolean(object), ...triangleMetrics(object?.result) };
  });
  report.calls.push({ kind: 'context', observedTimes: [...FRAME_TIMES], elapsedMs: Math.max(0, clock() - start),
    httpStatus: context.status, resultStatus: valid ? 'context' : 'failed', comparisons: comparison });
  const single = report.calls.filter((call) => call.kind === 'frame');
  const aggregate = (items) => ({ expected: FRAME_TIMES.length,
    templateMatched: items.filter((item) => item.templateMatched).length,
    numericMatched: items.filter((item) => item.numericMatched).length,
    unitMatched: items.filter((item) => item.unitMatched).length,
    matched: items.filter((item) => item.matched).length });
  report.status = 'completed'; report.code = 'fixture-evaluated';
  report.metrics = { singleFrames: aggregate(single), contextFrames: { ...aggregate(comparison), returned: objects.length },
    allFixtureCandidatesMatched: [...single, ...comparison].every((item) => item.matched) };
  return report;
}

/** Absolute, outside-repository, no overwriting and no symlink escape into the checkout. */
async function openEvaluationOutput(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('absolute_output_required');
  const filename = path.resolve(output);
  if (inside(filename, REPOSITORY)) throw new Error('outside_repository_required');
  let ancestor = path.dirname(filename);
  for (;;) {
    try { await fs.lstat(ancestor); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error('invalid_output'); ancestor = parent; }
  }
  const repository = await fs.realpath(REPOSITORY);
  const actualAncestor = await fs.realpath(ancestor);
  if (inside(path.resolve(actualAncestor, path.relative(ancestor, filename)), repository)) throw new Error('outside_repository_required');
  await fs.mkdir(path.dirname(filename), { recursive: true });
  if (inside(await fs.realpath(path.dirname(filename)), repository)) throw new Error('outside_repository_required');
  return { filename, handle: await fs.open(filename, 'wx+', 0o600) };
}

async function writeOutput(handle, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  let position = 0;
  while (position < bytes.length) {
    const result = await handle.write(bytes, position, bytes.length - position, position);
    if (!result.bytesWritten) throw new Error('output_unavailable');
    position += result.bytesWritten;
  }
  await handle.truncate(bytes.length); await handle.sync();
}

export async function writeEvaluationReport(output, report) {
  const { filename, handle } = await openEvaluationOutput(output);
  try { await writeOutput(handle, report); } finally { await handle.close(); }
  return filename;
}

export function evaluationExitCode(report) {
  return report.status === 'not-run' ? 2 : report.metrics?.allFixtureCandidatesMatched ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  if (!output || !path.isAbsolute(output) || args.some((item, index) =>
    index !== outputIndex + 1 && !['--output', '--run-model'].includes(item))) {
    throw new Error('usage: --output ABSOLUTE_REPORT_PATH [--run-model]');
  }
  // Verify the destination before any optional media/model work. No existing file is replaced.
  const fixture = await evaluationFixture();
  const settings = loadSettings(process.env);
  const enabled = args.includes('--run-model');
  let frames;
  if (configured(settings) && enabled) {
    // Validate the output with an exclusive reservation before spending API calls.
    const reservation = baseReport(fixture, new Date().toISOString(), 'none');
    reservation.code = 'preparing';
    const { handle } = await openEvaluationOutput(output);
    try {
      await writeOutput(handle, reservation);
      frames = await extractEvaluationFrames();
      const report = await evaluateLearningModel({ settings, enabled: true, frames });
      // Keep the original exclusive file handle; later path replacement is never followed.
      await writeOutput(handle, report);
      process.stdout.write(JSON.stringify({ status: report.status, code: report.code, providerCalls: report.providerCalls }) + '\n');
      process.exitCode = evaluationExitCode(report);
    } catch {
      process.stderr.write('evaluation_failed; the report reservation remains not-run and contains no media or provider text.\n');
      process.exitCode = 1;
    } finally { await handle.close(); }
    return;
  }
  const report = await evaluateLearningModel({ settings, enabled });
  await writeEvaluationReport(output, report);
  process.stdout.write(JSON.stringify({ status: report.status, code: report.code, providerCalls: report.providerCalls }) + '\n');
  process.exitCode = evaluationExitCode(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('evaluation_not_run: supply a new absolute report path outside the repository.\n'); process.exitCode = 1; });
}
