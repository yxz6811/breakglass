/**
 * 把按准备画幅写好的区域，按当前帧的宽、高比例放进这一帧。
 * 数学 domain / range 不动。源像素区域必须和 frameSize 一起换算；
 * 只改 frameSize 会让校验通过，曲线却仍停在旧画幅上。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.frameFit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /**
   * 准备画幅上的区域按比例映到当前帧。
   * x' = x / preparedWidth * frameWidth，y 与宽高同样处理。
   * 例如 1920×1080 的 {x:480, y:220, width:960, height:620}
   * 放到 3024×1898 得到 {x:756, y:220*1898/1080, width:1512, height:620*1898/1080}。
   * @param {{ width: number, height: number }} preparedFrame
   * @param {{ x: number, y: number, width: number, height: number }} region
   * @param {{ width: number, height: number }} frame
   * @returns {{ frameSize: { width: number, height: number }, region: { x: number, y: number, width: number, height: number } } | null}
   */
  function placeRegionInFrame(preparedFrame, region, frame) {
    if (!preparedFrame || !region || !frame) return null;
    const preparedWidth = preparedFrame.width;
    const preparedHeight = preparedFrame.height;
    const frameWidth = frame.width;
    const frameHeight = frame.height;
    if (!finite(preparedWidth) || !finite(preparedHeight) || !finite(frameWidth) || !finite(frameHeight)) return null;
    if (!(preparedWidth > 0) || !(preparedHeight > 0) || !(frameWidth > 0) || !(frameHeight > 0)) return null;
    if (!finite(region.x) || !finite(region.y) || !finite(region.width) || !finite(region.height)) return null;
    if (!(region.width > 0) || !(region.height > 0)) return null;

    const scaleX = frameWidth / preparedWidth;
    const scaleY = frameHeight / preparedHeight;
    const placed = {
      x: region.x * scaleX,
      y: region.y * scaleY,
      width: region.width * scaleX,
      height: region.height * scaleY
    };
    if (placed.x < 0 || placed.y < 0) return null;
    if (placed.x + placed.width > frameWidth || placed.y + placed.height > frameHeight) return null;
    return {
      frameSize: { width: frameWidth, height: frameHeight },
      region: placed
    };
  }

  return { placeRegionInFrame };
});
