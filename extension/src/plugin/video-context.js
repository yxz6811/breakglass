(function (root) {
  'use strict';
  root.BreakGlass = root.BreakGlass || {};
  const LIMITS = Object.freeze({ bytes: 64 * 1024, cues: 1000, cueText: 500,
    selectedCues: 12, selectedText: 6000, duration: 600, span: 30, frames: 8, extractionMs: 20000 });
  const active = new WeakMap();
  const error = (code) => Object.assign(new Error(code), { code });
  const finiteTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LIMITS.duration;
  const safeText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= LIMITS.cueText
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
    && !/(?:https?:\/\/|ftp:\/\/|data:|blob:|file:\/\/|javascript:|mailto:|chrome-extension:\/\/|<[^>]*>)/i.test(value);
  const fail = (code = 'invalid_subtitles') => ({ ok: false, code });

  function stamp(value, format) {
    const parts = /^(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)([.,])(\d{3})$/.exec(value);
    if (!parts || (format === 'srt' && (!parts[1] || parts[4] !== ','))
      || (format === 'vtt' && parts[4] !== '.')) return null;
    const time = Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) + Number(parts[5]) / 1000;
    return finiteTime(time) ? time : null;
  }

  /** Plain author text only. This parser does not grant rights to read or upload captions. */
  function parseTextCues(text, { format = 'auto' } = {}) {
    if (typeof text !== 'string' || !['auto', 'vtt', 'srt'].includes(format)
      || new TextEncoder().encode(text).byteLength > LIMITS.bytes) return fail();
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const isVtt = /^WEBVTT(?:\n|$)/.test(normalized);
    const actual = format === 'auto' ? (isVtt ? 'vtt' : 'srt') : format;
    if ((actual === 'vtt') !== isVtt) return fail();
    const blocks = (isVtt ? normalized.slice(6) : normalized).trim().split(/\n[ \t]*\n/);
    if (!blocks[0]) return { ok: true, format: actual, cues: [] };
    const cues = []; let previous = -1;
    for (const block of blocks) {
      const lines = block.split('\n');
      if (!lines[0].includes('-->')) {
        if (actual === 'srt' ? !/^\d+$/.test(lines[0])
          : (!/^[\p{L}\p{N}._ -]{1,120}$/u.test(lines[0]) || /^(?:NOTE|STYLE|REGION)\b/.test(lines[0]))) return fail();
        lines.shift();
      }
      const timing = /^(\S+) --> (\S+)$/.exec(lines.shift() || '');
      if (!timing) return fail();
      const start = stamp(timing[1], actual); const end = stamp(timing[2], actual);
      const content = lines.join('\n');
      if (start === null || end === null || end <= start || start <= previous || !safeText(content)) return fail();
      cues.push({ start, end, text: content }); previous = start;
      if (cues.length > LIMITS.cues) return fail();
    }
    return { ok: true, format: actual, cues };
  }

  /** Apply a bounded explicit alignment offset without inventing or silently truncating text. */
  function selectCueWindow(cues, start, end, offset = 0) {
    if (!Array.isArray(cues) || cues.length > LIMITS.cues || !finiteTime(start) || !finiteTime(end)
      || end < start || end - start > LIMITS.span || typeof offset !== 'number' || !Number.isFinite(offset)
      || Math.abs(offset) > 30) return fail('invalid_window');
    const selected = []; let previous = -1; let total = 0;
    for (const cue of cues) {
      if (!cue || typeof cue !== 'object' || Array.isArray(cue) || Object.keys(cue).sort().join(',') !== 'end,start,text'
        || !finiteTime(cue.start) || !finiteTime(cue.end) || cue.end <= cue.start
        || cue.start <= previous || !safeText(cue.text)) return fail();
      previous = cue.start;
      const shifted = { start: cue.start + offset, end: cue.end + offset, text: cue.text };
      if (!finiteTime(shifted.start) || !finiteTime(shifted.end)) return fail('invalid_offset');
      if (shifted.end < start || shifted.start > end) continue;
      total += shifted.text.length; selected.push(shifted);
      if (selected.length > LIMITS.selectedCues || total > LIMITS.selectedText) return fail('context_limit');
    }
    return { ok: true, cues: selected };
  }

  function samplingTimes(start, end, maxFrames = 4) {
    if (!finiteTime(start) || !finiteTime(end) || end < start || end - start > LIMITS.span
      || !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > LIMITS.frames) return fail('invalid_window');
    const count = start === end ? 1 : maxFrames;
    return { ok: true, times: Array.from({ length: count }, (_, index) =>
      Number((count === 1 ? start : start + (end - start) * index / (count - 1)).toFixed(6))) };
  }

  function supportedSource(raw, document) {
    try {
      const url = new URL(raw, document.baseURI);
      const origin = document.defaultView.location.origin;
      if (url.origin !== origin || url.search || url.hash || url.username || url.password) return false;
      if (url.protocol === 'blob:') return true;
      return /^https?:$/.test(url.protocol) && [
        '/extension/assets/video/geometry/triangle-3-4-5.mp4',
        '/extension/assets/video/breakglass-demo-9s.mp4'
      ].includes(url.pathname);
    } catch { return false; }
  }

  /** Decode selected sparse frames locally using a separate muted element; do not seek the student's player. */
  async function extractWindow(video, { start, end, maxFrames = 4, signal, isCurrent = () => true } = {}) {
    const sample = samplingTimes(start, end, maxFrames);
    if (!sample.ok) throw error(sample.code);
    const document = video?.ownerDocument; const source = video?.currentSrc || video?.src;
    if (!document || !supportedSource(source, document)) throw error('unsupported_source');
    if (active.has(video)) throw error('context_busy');
    const controller = new AbortController(); active.set(video, controller);
    const abort = () => controller.abort(signal?.reason || error('context_cancelled'));
    const hidden = () => { if (document.hidden) controller.abort(error('context_hidden')); };
    const guard = () => {
      controller.signal.throwIfAborted();
      if (document.hidden || !isCurrent() || (video.currentSrc || video.src) !== source) throw error('context_cancelled');
    };
    const deadline = setTimeout(() => controller.abort(error('context_timeout')), LIMITS.extractionMs);
    signal?.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', hidden);
    if (signal?.aborted) abort();
    const decoder = document.createElement('video'); const canvas = document.createElement('canvas');
    const wait = (events, ready) => new Promise((resolve, reject) => {
      const cleanup = () => {
        events.forEach((name) => decoder.removeEventListener(name, changed));
        decoder.removeEventListener('error', failed); controller.signal.removeEventListener('abort', cancelled);
      };
      const failed = () => { cleanup(); reject(error('decode_failed')); };
      const cancelled = () => { cleanup(); reject(controller.signal.reason || error('context_cancelled')); };
      const changed = () => {
        try { guard(); } catch (cause) { cleanup(); reject(cause); return; }
        if (ready()) { cleanup(); resolve(); }
      };
      events.forEach((name) => decoder.addEventListener(name, changed));
      decoder.addEventListener('error', failed); controller.signal.addEventListener('abort', cancelled, { once: true });
      if (controller.signal.aborted) cancelled(); else changed();
    });
    try {
      guard(); decoder.muted = true; decoder.playsInline = true; decoder.preload = 'auto'; decoder.src = source;
      decoder.load();
      await wait(['loadedmetadata', 'loadeddata'], () => decoder.readyState >= 1);
      guard();
      if (!finiteTime(decoder.duration) || decoder.duration <= 0 || decoder.videoWidth <= 0 || decoder.videoHeight <= 0
        || decoder.videoWidth > 1920 || decoder.videoHeight > 1080 || start >= decoder.duration || end > decoder.duration) {
        throw error('unsupported_media');
      }
      const adjusted = samplingTimes(start, Math.min(end, decoder.duration - 0.001), maxFrames);
      if (!adjusted.ok) throw error('invalid_window');
      canvas.width = Math.min(640, decoder.videoWidth);
      canvas.height = Math.round(decoder.videoHeight * canvas.width / decoder.videoWidth);
      const context = canvas.getContext('2d');
      if (!context) throw error('capture_unavailable');
      const frames = []; let bytes = 0;
      for (const target of adjusted.times) {
        guard();
        if (Math.abs(decoder.currentTime - target) > 0.000001) {
          decoder.currentTime = target;
          await wait(['seeked', 'loadeddata'], () => !decoder.seeking && decoder.readyState >= 2
            && Math.abs(decoder.currentTime - target) <= 0.05);
        } else await wait(['loadeddata', 'seeked'], () => !decoder.seeking && decoder.readyState >= 2);
        guard(); context.drawImage(decoder, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', 0.75);
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)) throw error('capture_unavailable');
        bytes += image.length;
        if (bytes > 4 * 1024 * 1024) throw error('context_limit');
        const frameTime = Number(decoder.currentTime.toFixed(6));
        if (frames.length && frameTime <= frames.at(-1).frameTime) throw error('decode_failed');
        frames.push({ frameTime, image });
      }
      guard();
      return { frames, coverage: { start: frames[0].frameTime, end: frames.at(-1).frameTime, frameCount: frames.length } };
    } finally {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', hidden);
      decoder.pause(); decoder.removeAttribute('src'); decoder.load(); decoder.remove();
      canvas.width = 0; canvas.height = 0; canvas.remove();
      if (active.get(video) === controller) active.delete(video);
    }
  }

  const api = { LIMITS, parseTextCues, selectCueWindow, samplingTimes, extractWindow };
  root.BreakGlass.videoContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
