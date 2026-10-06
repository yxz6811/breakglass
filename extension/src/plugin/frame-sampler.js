(function (root) {
  root.BreakGlass = root.BreakGlass || {};
  function capture(video, signal, isCurrent = () => true) {
    if (signal.aborted || !isCurrent() || video.ownerDocument.hidden) return null;
    const win = video.ownerDocument.defaultView;
    const bounds = video.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0
      || bounds.top >= win.innerHeight || bounds.left >= win.innerWidth || video.seeking
      || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const frameTime = video.currentTime;
    const canvas = video.ownerDocument.createElement('canvas');
    canvas.width = Math.min(640, video.videoWidth);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    const probe = video.ownerDocument.createElement('canvas'); probe.width = 16; probe.height = 9;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = probe.getContext('2d', { willReadFrequently: true });
      if (!context || !pixels) throw new Error('画面采样不可用。');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      pixels.drawImage(canvas, 0, 0, 16, 9);
      const values = pixels.getImageData(0, 0, 16, 9).data;
      let signature = '';
      for (let i = 0; i < values.length; i += 4) signature += String.fromCharCode(Math.round((values[i] + values[i + 1] + values[i + 2]) / 24));
      const image = canvas.toDataURL('image/jpeg', 0.75);
      if (signal.aborted || !isCurrent() || video.seeking || Math.abs(video.currentTime - frameTime) > 0.25) return null;
      return { frameTime, image, signature };
    } catch {
      throw new Error('当前采集方式无法读取画面；请检查解码或保护限制。');
    } finally { canvas.width = 0; canvas.height = 0; probe.width = 0; probe.height = 0; }
  }
  root.BreakGlass.frameSampling = { capture };
  if (typeof module !== 'undefined' && module.exports) module.exports = { capture };
})(typeof globalThis !== 'undefined' ? globalThis : this);
