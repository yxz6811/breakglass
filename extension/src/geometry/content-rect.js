(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.geometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  /**
   * 解析单个 object-position 分量，遵循 CSS <position> 的基本语义：
   * 关键字、百分比、px 长度和无单位 0；其它记号返回 null。
   * @param {unknown} raw
   * @returns {{ axis: 'x'|'y'|'both', percent?: number, length?: number } | null}
   */
  function parseComponent(raw) {
    const token = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    if (token === '') return null;
    if (token === 'left') return { axis: 'x', percent: 0 };
    if (token === 'right') return { axis: 'x', percent: 100 };
    if (token === 'top') return { axis: 'y', percent: 0 };
    if (token === 'bottom') return { axis: 'y', percent: 100 };
    if (token === 'center') return { axis: 'both', percent: 50, keyword: 'center' };
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(token);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;
    if (match[2] === '%') return { axis: 'both', percent: clampPercent(value) };
    if (match[2] === 'px') return { axis: 'both', length: Math.max(0, value) };
    if (value === 0) return { axis: 'both', percent: 0 };
    return null;
  }

  function axisValue(component) {
    return component.length === undefined ? { percent: component.percent } : { length: component.length };
  }

  /**
   * 把 object-position 解析成两个轴的偏移描述。
   * 单关键字按 CSS 语义把另一轴补成 50%；无法识别的声明回退到 50% 50%。
   * @param {unknown} objectPosition
   */
  function resolvePosition(objectPosition) {
    const fallback = { x: { percent: 50 }, y: { percent: 50 } };
    const tokens = String(objectPosition === null || objectPosition === undefined ? '50% 50%' : objectPosition)
      .trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return fallback;
    const first = parseComponent(tokens[0]);
    if (!first) return fallback;
    if (tokens.length === 1) {
      if (first.axis === 'y') return { x: { percent: 50 }, y: axisValue(first) };
      return { x: axisValue(first), y: { percent: 50 } };
    }
    const second = parseComponent(tokens[1]);
    if (!second) return fallback;
    if (first.axis === second.axis && first.axis !== 'both') return fallback;
    // `top left` 与 `left top` 等价。`center left` 里的 left 仍是横轴，center 落到另一轴。
    // 百分比不是 center 关键字：`50% left` 不是合法的双值位置，继续走下面的回退。
    if (first.axis === 'y' || (first.keyword === 'center' && second.axis === 'x')) {
      return { x: axisValue(second), y: axisValue(first) };
    }
    return { x: axisValue(first), y: second.axis === 'x' ? { percent: 50 } : axisValue(second) };
  }

  // 百分比按剩余空间换算；长度单位按 CSS 语义从对应边量起，并被剩余空间夹住。
  function offsetFor(axis, slack) {
    const room = Math.max(0, slack);
    if (axis.length !== undefined) return Math.min(room, Math.max(0, axis.length));
    return room * clampPercent(axis.percent) / 100;
  }

  function getContentRect({
    elementRect,
    videoWidth,
    videoHeight,
    objectFit = 'contain',
    objectPosition = '50% 50%'
  } = {}) {
    if (!elementRect || !Number.isFinite(elementRect.left) || !Number.isFinite(elementRect.top) ||
        !Number.isFinite(elementRect.width) || !Number.isFinite(elementRect.height) ||
        elementRect.width <= 0 || elementRect.height <= 0 ||
        !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) ||
        videoWidth <= 0 || videoHeight <= 0) {
      return null;
    }
    if (objectFit !== 'contain') throw new Error(`P0 暂不支持 object-fit: ${objectFit}`);

    const scale = Math.min(elementRect.width / videoWidth, elementRect.height / videoHeight);
    const renderWidth = videoWidth * scale;
    const renderHeight = videoHeight * scale;
    const position = resolvePosition(objectPosition);
    const offsetX = offsetFor(position.x, elementRect.width - renderWidth);
    const offsetY = offsetFor(position.y, elementRect.height - renderHeight);

    return {
      elementRect: { ...elementRect },
      contentRect: {
        left: elementRect.left + offsetX,
        top: elementRect.top + offsetY,
        width: renderWidth,
        height: renderHeight
      },
      objectFit,
      objectPosition,
      scale
    };
  }

  return { getContentRect, resolvePosition, parseComponent };
});