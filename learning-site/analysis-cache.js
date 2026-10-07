(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ ttlMs: 24 * 60 * 60 * 1000, entries: 40, bytes: 2 * 1024 * 1024,
    duration: 600, span: 30, frames: 8, defaultFrames: 4, windows: 20, taskMs: 30 * 60 * 1000 });
  const VALUE_FIELDS = ['schemaVersion', 'requestId', 'sourceId', 'videoVersion', 'analysisVersion', 'status',
    'contextSourceId', 'observedTimes', 'coverage', 'limitations', 'summary', 'keyPoints', 'pitfalls', 'objects'];
  const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
  const finiteTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LIMITS.duration;
  const safeText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    && !/(?:data:|blob:|file:\/\/|https?:\/\/|javascript:|mailto:)/i.test(value);

  /** Explicit finite task; priority changes order, never increases its coverage or budget. */
  function plan(duration, currentTime, maxFrames = LIMITS.defaultFrames) {
    if (!finiteTime(duration) || duration <= 0 || !finiteTime(currentTime) || currentTime > duration
      || !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > LIMITS.frames) throw new Error('invalid_progressive_plan');
    const windows = [];
    for (let start = 0, index = 0; start < duration; start += LIMITS.span, index += 1) {
      const end = Math.min(duration, start + LIMITS.span); const sampleEnd = Math.max(start, end - 0.001);
      const count = sampleEnd === start ? 1 : maxFrames;
      windows.push({ id: `window-${index}`, start, end, times: Array.from({ length: count }, (_, frame) =>
        Number((count === 1 ? start : start + (sampleEnd - start) * frame / (count - 1)).toFixed(6))) });
    }
    const priority = Math.min(windows.length - 1, Math.floor(currentTime / LIMITS.span));
    return [windows[priority], ...windows.filter((_, index) => index !== priority)];
  }

  function validContext(value, input, validateVisualResult) {
    if (!value || value.schemaVersion !== '1' || value.status !== 'context' || value.requestId !== input.requestId
      || value.sourceId !== input.sourceId || value.videoVersion !== input.videoVersion || value.analysisVersion !== input.analysisVersion
      || value.contextSourceId !== input.contextSourceId || !Array.isArray(value.observedTimes)
      || JSON.stringify(value.observedTimes) !== JSON.stringify(input.frames.map((frame) => frame.frameTime))
      || !exact(value.coverage, ['start', 'end', 'frameCount', 'inputTypes'])
      || value.coverage.start !== value.observedTimes[0] || value.coverage.end !== value.observedTimes.at(-1)
      || value.coverage.frameCount !== value.observedTimes.length || value.observedTimes.length < 1 || value.observedTimes.length > LIMITS.frames
      || !value.observedTimes.every((time, index, times) => finiteTime(time) && (index === 0 || time > times[index - 1]))
      || value.coverage.end - value.coverage.start > LIMITS.span
      || ![JSON.stringify(['frames']), ...(input.contextSourceId ? [JSON.stringify(['frames', 'subtitle'])] : [])]
        .includes(JSON.stringify(value.coverage.inputTypes))
      || !safeText(value.summary, 2000) || !safeText(value.limitations, 1000)
      || ![value.keyPoints, value.pitfalls].every((items) => Array.isArray(items) && items.length <= 8
        && items.every((text) => safeText(text, 400))) || !Array.isArray(value.objects) || value.objects.length > LIMITS.frames) return false;
    const seen = new Set();
    for (const object of value.objects) {
      if (!exact(object, ['frameTime', 'result']) || !value.observedTimes.includes(object.frameTime) || seen.has(object.frameTime)
        || !validateVisualResult(object.result).ok) return false;
      seen.add(object.frameTime);
    }
    return true;
  }

  /** Strict whitelist prevents media, arbitrary fields or credentials from entering the analysis cache. */
  function candidateValue(value) {
    return Object.fromEntries(VALUE_FIELDS.map((field) => [field, JSON.parse(JSON.stringify(value[field]))]));
  }
  const api = { LIMITS, VALUE_FIELDS, plan, validContext, candidateValue };
  root.BreakGlass = root.BreakGlass || {}; root.BreakGlass.analysisCache = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
