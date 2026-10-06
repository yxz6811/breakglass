import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export const AUDIO_LIMITS = Object.freeze({ clipSeconds: 30, sessionCalls: 2, sampleRate: 16000,
  maxPcmBytes: 960000, maxResponseBytes: 65536, textCharacters: 6000, deadlineMs: 30000 });
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const exact = (input, fields) => input && typeof input === 'object' && !Array.isArray(input)
  && Object.keys(input).length === fields.length && fields.every((field) => Object.hasOwn(input, field));
export function loadAudioSettings(env = {}) {
  const baseUrl = String(env.BREAKGLASS_ASR_BASE_URL || '').trim().replace(/\/+$/, '');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash) throw new Error('ASR地址须为HTTPS或本机HTTP，不能含凭据或查询。');
  }
  const ffmpegPath = String(env.BREAKGLASS_FFMPEG_PATH || '').trim();
  if (ffmpegPath && !path.isAbsolute(ffmpegPath)) throw new Error('FFmpeg路径须为绝对路径。');
  const maxCalls = env.BREAKGLASS_ASR_HOURLY_CALLS === undefined ? 4 : Number(env.BREAKGLASS_ASR_HOURLY_CALLS);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 16) throw new Error('音轨小时调用上限须为1至16。');
  return { baseUrl, apiKey: String(env.BREAKGLASS_ASR_API_KEY || '').trim(),
    model: String(env.BREAKGLASS_ASR_MODEL || '').trim(), ffmpegPath, maxCalls };
}

export function pcmToWav(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 320 || pcm.length > AUDIO_LIMITS.maxPcmBytes || pcm.length % 2) {
    throw error(422, 'audio_unavailable', '没有有效的短音轨；未调用转写模型。');
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function wavToPcm(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.length > 1024 * 1024
    || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw error(422, 'audio_unavailable', '短音轨解码输出不是有效WAV。');
  let fmt = false; let offset = 12;
  while (offset + 8 <= wav.length) {
    const kind = wav.toString('ascii', offset, offset + 4); const length = wav.readUInt32LE(offset + 4); offset += 8;
    if (kind === 'data') {
      const size = length === 0xffffffff ? wav.length - offset : length;
      if (!fmt || size < 320 || size > AUDIO_LIMITS.maxPcmBytes || size % 2 || offset + size !== wav.length) throw error(422, 'audio_unavailable', '短音轨PCM结构或预算无效。');
      return Buffer.from(wav.subarray(offset, offset + size));
    }
    if (length > 4096 || offset + length > wav.length) throw error(422, 'audio_unavailable', '音轨头结构无效。');
    if (kind === 'fmt ') {
      if (fmt || length < 16 || wav.readUInt16LE(offset) !== 1 || wav.readUInt16LE(offset + 2) !== 1
        || wav.readUInt32LE(offset + 4) !== 16000 || wav.readUInt32LE(offset + 8) !== 32000
        || wav.readUInt16LE(offset + 12) !== 2 || wav.readUInt16LE(offset + 14) !== 16) throw error(422, 'audio_unavailable', '音轨格式必须为16kHz单声道PCM16。');
      fmt = true;
    }
    offset += length + (length % 2);
  }
  throw error(422, 'audio_unavailable', '未找到有效音轨PCM数据。');
}

/** Only operator-registered files and a fixed executable; no shell or temporary media files. */
export async function extractAudio({ filePath, sourceId, start, end, ffmpegPath, signal, spawnImpl = spawn }) {
  signal.throwIfAborted();
  if (!path.isAbsolute(filePath || '') || !path.isAbsolute(ffmpegPath || '')) throw error(503, 'audio_not_configured', '音轨工具尚未配置。');
  const info = await fs.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw error(403, 'permission_pending', '登记视频文件无效。');
  const sha = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  if (sourceId !== 'file-' + sha) throw error(403, 'permission_pending', '登记视频指纹已变化；未提取音轨。');
  signal.throwIfAborted();
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
    '-ss', String(start), '-i', filePath, '-t', String(end - start), '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-map_metadata', '-1', '-bitexact', '-f', 'wav', 'pipe:1'];
  const decoded = await new Promise((resolve, reject) => {
    let child; let settled = false; let size = 0; const parts = [];
    const finish = (failure, value) => {
      if (settled) return; settled = true; signal.removeEventListener('abort', abort);
      if (failure) { child?.kill(); reject(failure); } else resolve(value);
    };
    const abort = () => finish(error(409, 'cancelled', '音轨处理已停止。'));
    try { child = spawnImpl(ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { finish(error(503, 'audio_not_configured', '音轨工具无法启动。')); return; }
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(error(503, 'audio_not_configured', '音轨工具无法启动。')));
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) finish(error(413, 'audio_limit', '音轨超过片段预算。'));
      else parts.push(chunk);
    });
    child.once('close', (code) => code === 0 ? finish(null, Buffer.concat(parts))
      : finish(error(422, 'audio_unavailable', '此视频没有可读取的音轨，或音轨解码失败；未调用模型。')));
    if (signal.aborted) abort();
  });
  signal.throwIfAborted();
  const pcm = wavToPcm(decoded);
  if (pcm.length / 32000 > end - start + 0.1) throw error(422, 'audio_limit', '音轨时长不符合选定范围。');
  return { wav: pcmToWav(pcm), seconds: pcm.length / 32000 };
}

async function readJSON(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw error(413, 'invalid_input', '音轨请求仅接受最小结构字段。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'invalid_input', '音轨请求JSON无效。'); }
}
async function providerText(response, signal) {
  if (!response.ok) throw error(502, 'provider_error', '转写服务失败，请检查服务端配置后明确重试。');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > AUDIO_LIMITS.maxResponseBytes) throw error(502, 'schema_rejected', '转写响应超过上限。');
      chunks.push(Buffer.from(part.value));
    }
    signal.throwIfAborted();
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error(502, 'schema_rejected', '转写响应格式无效。'); }
    if (typeof value?.text !== 'string' || value.text.length > AUDIO_LIMITS.textCharacters
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.text)) throw error(502, 'schema_rejected', '转写文本结构无效。');
    if (!value.text.trim()) throw error(422, 'no_speech', '转写没有返回可用语音文本，不能据此生成解析。');
    return value.text.trim();
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}

export function createAudioHandler({ sources, settings = loadAudioSettings(), allowedOrigins, account,
  authorizeScope, extractImpl = extractAudio, fetchImpl = fetch, now = Date.now } = {}) {
  const sessions = new Map(); let inFlight = false; const calls = [];
  const configured = Boolean(settings.baseUrl && settings.apiKey && settings.model && settings.ffmpegPath);
  const scope = async (request) => account?.privateScope ? account.privateScope(request) : null;
  const live = async (request, saved) => (!authorizeScope || (saved && await authorizeScope(saved)))
    && (account?.isPrivateScopeCurrent ? await account.isPrivateScopeCurrent(request, saved) : saved === null);
  const closeSession = (token) => { const old = sessions.get(token); old?.controller?.abort(); sessions.delete(token); };
  const send = (response, status, value) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const handler = async (request, response) => {
    const url = new URL(request.url, 'http://local.invalid');
    if (!url.pathname.startsWith('/api/audio/')) return false;
    try {
      if (url.pathname === '/api/audio/config' && request.method === 'GET') {
        send(response, 200, { configured, configuration: 'server-environment', limits: AUDIO_LIMITS,
          mode: 'registered-video-short-audio', fullVideoUploadEnabled: false }); return true;
      }
      if (request.method !== 'POST') throw error(405, 'invalid_method', '音轨操作只接受POST。');
      if (!allowedOrigins?.includes(request.headers.origin)) throw error(403, 'invalid_origin', '音轨来源不在当前网站范围。');
      if (String(request.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') throw error(415, 'invalid_input', '音轨请求只接受JSON。');
      const input = await readJSON(request);
      for (const [id, session] of sessions) if (now() - session.startedAt >= 30 * 60 * 1000) closeSession(id);
      if (url.pathname === '/api/audio/session') {
        if (!exact(input, ['sourceId'])) throw error(400, 'invalid_input', '音轨会话字段无效。');
        const registered = sources.get(input.sourceId);
        if (!registered?.filePath || registered.source.materialMode !== 'self-authored') throw error(403, 'permission_pending', '此素材没有登记音轨处理许可。');
        if (!configured) throw error(503, 'audio_not_configured', '音轨工具和转写模型尚未配置；没有读取或上传音频。');
        if (sessions.size >= 16) throw error(429, 'budget_exhausted', '请先停止其他音轨会话。');
        const privateScope = await scope(request); const token = randomUUID();
        if (!await live(request, privateScope)) throw error(403, 'stale_session', '账户或发布审批已失效，没有提取音轨。');
        sessions.set(token, { sourceId: input.sourceId, origin: request.headers.origin, scope: privateScope, startedAt: now(), calls: 0, controller: null });
        send(response, 200, { token }); return true;
      }
      if (url.pathname === '/api/audio/session/end') {
        if (!exact(input, ['token'])) throw error(400, 'invalid_input', '音轨结束字段无效。');
        if (sessions.get(input.token)?.origin === request.headers.origin) closeSession(input.token);
        send(response, 200, { ok: true }); return true;
      }
      if (url.pathname !== '/api/audio/transcribe') throw error(404, 'invalid_route', '没有此音轨接口。');
      if (!exact(input, ['token', 'start', 'end'])) throw error(400, 'invalid_input', '音轨只接受会话及时间范围，不接收文件或URL。');
      const session = sessions.get(input.token); const registered = sources.get(session?.sourceId);
      if (!session || session.origin !== request.headers.origin || !registered || !(await live(request, session.scope))) throw error(403, 'stale_session', '音轨会话、账户或素材许可已失效。');
      if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.start < 0 || input.end <= input.start
        || input.end > registered.duration || input.end - input.start > 30) throw error(400, 'invalid_input', '请选择视频内不超过30秒的音轨。');
      while (calls.length && calls[0] <= now() - 60 * 60 * 1000) calls.shift();
      if (session.calls >= 2 || calls.length >= (settings.maxCalls || 4)) throw error(429, 'budget_exhausted', '音轨调用额度已用完，未自动重试。');
      if (inFlight) throw error(429, 'busy', '上一段音轨仍在处理。');
      inFlight = true; session.calls += 1; calls.push(now());
      const controller = new AbortController(); session.controller = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AUDIO_LIMITS.deadlineMs)]);
      const disconnected = () => { if (!response.writableEnded) controller.abort(); };
      request.once('aborted', disconnected); response.once('close', disconnected);
      try {
        const extracted = await extractImpl({ filePath: registered.filePath, sourceId: registered.source.id,
          start: input.start, end: input.end, ffmpegPath: settings.ffmpegPath, signal });
        signal.throwIfAborted();
        if (sessions.get(input.token) !== session || sources.get(session.sourceId) !== registered || !(await live(request, session.scope))) throw error(403, 'stale_session', '素材或账户已改变；旧音轨没有上传。');
        if (!Buffer.isBuffer(extracted?.wav) || extracted.wav.length > 1024 * 1024
          || !Number.isFinite(extracted.seconds) || extracted.seconds <= 0 || extracted.seconds > input.end - input.start + 0.1) throw error(422, 'audio_limit', '短音轨输出不符合预算。');
        const form = new FormData(); form.set('file', new Blob([extracted.wav], { type: 'audio/wav' }), 'lesson-clip.wav');
        form.set('model', settings.model); form.set('response_format', 'json');
        const result = await fetchImpl(settings.baseUrl + '/audio/transcriptions', { method: 'POST',
          headers: { authorization: 'Bearer ' + settings.apiKey }, body: form, signal, redirect: 'error' });
        const text = await providerText(result, signal);
        signal.throwIfAborted();
        if (sessions.get(input.token) !== session || sources.get(session.sourceId) !== registered || !(await live(request, session.scope))) throw error(403, 'stale_session', '旧音轨结果已丢弃。');
        send(response, 200, { schemaVersion: '1', status: 'transcript', sourceId: registered.source.id,
          videoVersion: registered.source.version, analysisVersion: registered.source.analysisVersion,
          coverage: { start: input.start, end: input.end, actualAudioSeconds: extracted.seconds }, text,
          sourceLabel: 'AI短音轨转写候选 · 需校对', limitations: ['只处理所选短音轨，不代表完整课程。', '转写可能漏字、错字；没有推断画面对应关系或确认数学条件。'] });
      } finally {
        inFlight = false; session.controller = null;
        request.off('aborted', disconnected); response.off('close', disconnected);
      }
    } catch (failure) {
      send(response, failure.status || (failure.name === 'AbortError' || failure.name === 'TimeoutError' ? 409 : 502),
        { code: failure.code || (failure.name === 'TimeoutError' ? 'timeout' : 'audio_failed'), error: failure.status ? failure.message : '音轨处理已停止或失败；可以明确重试。' });
    }
    return true;
  };
  handler.config = () => ({ configured, limits: AUDIO_LIMITS });
  handler.invalidatePrivateScope = (event) => {
    for (const [id, session] of sessions) {
      if (session.scope?.id === event.userId && (!event.sessionKey || session.scope.sessionKey === event.sessionKey)) closeSession(id);
    }
  };
  handler.revokeSource = (sourceId) => { for (const [id, session] of sessions) if (session.sourceId === sourceId) closeSession(id); };
  const unsubscribe = account?.onPrivateScopeInvalidated?.(handler.invalidatePrivateScope);
  handler.close = () => { unsubscribe?.(); for (const id of sessions.keys()) closeSession(id); };
  return handler;
}
