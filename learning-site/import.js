(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.webImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_BYTES = 64 * 1024 * 1024;
  const PARABOLA_FIXTURE_SHA256 = '10cdba752936a87778e5c82635ef0afbef2ff4071080251cf272ce8810a911f1';
  function validateFile(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES) throw new TypeError('请选择大于0且不超过64MiB的视频。');
    if (!['video/mp4', 'video/webm', ''].includes(file.type) || !/\.(mp4|webm)$/i.test(file.name || '')) {
      throw new TypeError('当前接受 MP4 或 WebM；实际编码还需浏览器解码验证。');
    }
    return true;
  }
  function validateMetadata({ duration, width, height }, { sha256 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new TypeError('视频须有明确时长且不超过600秒。');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || ((width > 1920 || height > 1080) && !(sha256 === PARABOLA_FIXTURE_SHA256
        && width === 3024 && height === 1898 && duration <= 10))) throw new TypeError('视频尺寸须在1920×1080以内；已核对完整指纹的包内曲线预设保留原尺寸。');
    return true;
  }
  function createImporter({ video, url = globalThis.URL, subtle = globalThis.crypto.subtle,
    onChange = () => {}, onReset = () => {} }) {
    let epoch = 0;
    let objectURL = null;
    let selected = null;
    let cancelMetadata = null;
    const fingerprints = new WeakMap();
    function reset() {
      epoch += 1;
      if (cancelMetadata) cancelMetadata();
      cancelMetadata = null;
      onReset(); video.pause(); video.removeAttribute('src'); video.load();
      if (objectURL) url.revokeObjectURL(objectURL);
      objectURL = null; selected = null; return epoch;
    }
    async function choose(file) {
      const owner = reset();
      try {
        validateFile(file);
        objectURL = url.createObjectURL(file);
        onChange({ state: 'decoding', message: '正在本机验证解码；未上传文件。' });
        const metadata = await new Promise((resolve, reject) => {
          let timer;
          const dispose = () => { video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', failed); clearTimeout(timer); cancelMetadata = null; };
          const media = objectURL;
          const ready = () => { if (owner !== epoch || (video.currentSrc || video.src) !== media) return;
            dispose(); resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }); };
          const failed = () => { dispose(); reject(new Error('浏览器无法解码这个视频，请换用受支持的MP4/WebM编码。')); };
          cancelMetadata = () => { dispose(); reject(new Error('已取消旧文件。')); };
          video.addEventListener('loadedmetadata', ready); video.addEventListener('error', failed);
          timer = setTimeout(() => { dispose(); reject(new Error('解码等待超时，请重新选择文件。')); }, 15000);
          video.src = objectURL; video.load();
        });
        if (owner !== epoch) return null;
        // The sole higher-resolution exception is the exact repository fixture.
        // Name, caller options and material checkboxes cannot activate it.
        if (metadata.width <= 1920 && metadata.height <= 1080) validateMetadata(metadata);
        onChange({ state: 'fingerprinting', message: '正在本机计算完整SHA-256指纹（64MiB上限）；首次读取一次，不上传原视频。' });
        if (!fingerprints.has(file)) fingerprints.set(file, file.arrayBuffer().then((bytes) => subtle.digest('SHA-256', bytes))
          .then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')));
        const sha = await fingerprints.get(file);
        if (owner !== epoch) return null;
        validateMetadata(metadata, { sha256: sha });
        selected = { source: { kind: 'local-file', id: `file-${sha}`, version: '1', analysisVersion: '1',
          materialMode: 'permission-pending', title: '我的本地课程' }, ...metadata, name: file.name };
        onChange({ state: 'ready', selected: { ...selected, source: { ...selected.source } }, message: '本机视频已就绪；尚未发送AI处理材料。' });
        return selected;
      } catch (error) {
        if (owner !== epoch) return null;
        reset(); onChange({ state: 'error', message: error.message }); throw error;
      }
    }
    return { choose, reset, current: () => selected && { ...selected, source: { ...selected.source } }, epoch: () => epoch };
  }
  return { MAX_BYTES, validateFile, validateMetadata, createImporter };
});
