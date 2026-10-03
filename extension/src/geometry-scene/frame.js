(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometryFrame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const TOLERANCE_SECONDS = 0.2;
  function fail(code, message) { return { ok: false, code, message }; }
  function videoState(video) {
    if (!video || !video.paused || video.seeking || video.readyState < 2) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const time = video.currentTime;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
        !Number.isFinite(time) || time < 0 || !Number.isFinite(video.duration) || video.duration <= 0 || time > video.duration) return null;
    return { width, height, time, src: video.currentSrc || video.src || '' };
  }
  function isFrameCurrent(video, context, videoId) {
    const state = videoState(video);
    return Boolean(state && context && context.frameSize && context.videoId === videoId &&
      state.width === context.frameSize.width && state.height === context.frameSize.height &&
      Number.isFinite(context.frameTime) && Math.abs(state.time - context.frameTime) <= TOLERANCE_SECONDS);
  }
  /** Capture only the already paused frame. Pixel coordinates never become mathematical lengths. */
  function captureFrame(options) {
    const settings = options || {};
    const before = videoState(settings.video);
    if (!before) return fail('frame_unavailable', '请等待视频加载完成，并暂停在要探索的那一帧。');
    if (typeof settings.requestId !== 'string' || !settings.requestId.trim() ||
        typeof settings.videoId !== 'string' || !settings.videoId.trim()) return fail('invalid_input', '当前帧缺少请求或视频标识。');
    try {
      const createCanvas = settings.createCanvas || (() => document.createElement('canvas'));
      const canvas = createCanvas();
      canvas.width = Math.min(640, before.width);
      canvas.height = Math.max(1, Math.round(before.height * canvas.width / before.width));
      const drawing = canvas.getContext('2d');
      if (!drawing) return fail('capture_failed', '当前浏览器不能截取这一帧，可以使用手动输入。');
      drawing.drawImage(settings.video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', 0.72);
      const after = videoState(settings.video);
      if (!after || before.src !== after.src || before.time !== after.time ||
          before.width !== after.width || before.height !== after.height) return fail('stale_frame', '截帧时视频发生了变化，请重新暂停后再试。');
      if (typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,') || image.length <= 23) {
        return fail('capture_failed', '没有取得有效的 JPEG 帧，请重试或手动输入。');
      }
      const body = {
        schemaVersion: VERSION,
        requestId: settings.requestId,
        videoId: settings.videoId,
        frameTime: before.time,
        frameSize: { width: before.width, height: before.height },
        image
      };
      const context = {
        requestId: body.requestId, videoId: body.videoId, frameTime: body.frameTime,
        frameSize: { ...body.frameSize }, sceneRevision: 0
      };
      return { ok: true, body, context, preview: image };
    } catch {
      return fail('capture_failed', '这一帧无法读取，请重试或使用手动条件。');
    }
  }
  return { captureFrame, isFrameCurrent, TOLERANCE_SECONDS };
});
