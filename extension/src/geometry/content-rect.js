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
   * 单关键字按 CSS 语义把另一轴补成 50%；无法识别或同轴混用的声明回退到 50% 50%。
   * @param {unknown} objectPosition
   * @returns {{ x: { percent?: number, length?: number, fromEnd?: boolean }, y: { percent?: number, length?: number, fromEnd?: boolean } }}
   */
  function resolvePosition(objectPosition) {
    const fallback = { x: { percent: 50 }, y: { percent: 50 } };
    const tokens = String(objectPosition === null || objectPosition === undefined ? '50% 50%' : objectPosition)
      .trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 3) return fallback;
    const first = parseComponent(tokens[0]);
    if (!first) return fallback;
    if (tokens.length === 1) {
      if (first.axis === 'y') return { x: { percent: 50 }, y: axisValue(first) };
      return { x: axisValue(first), y: { percent: 50 } };
    }
    const second = parseComponent(tokens[1]);
    if (!second) return fallback;
    if (tokens.length === 3) {
      const third = parseComponent(tokens[2]);
      if (!third) return fallback;
      return placeThree(first, second, third) || fallback;
    }
    if (first.axis === second.axis && first.axis !== 'both') return fallback;
    // 百分比或长度和横轴关键字不是合法双值：`20% left`、`10px right` 回退居中。
    if (second.axis === 'x' && first.axis === 'both' && first.keyword !== 'center') return fallback;
    // `top left` 与 `left top` 等价。`center left` 里的 left 仍是横轴，center 落到另一轴。
    if (first.axis === 'y' || (first.keyword === 'center' && second.axis === 'x')) {
      return { x: axisValue(second), y: axisValue(first) };
    }
    return { x: axisValue(first), y: axisValue(second) };
  }

  /**
   * 三值位置：边关键字加一段 px 偏移，另一轴是对边关键字或 center。
   * `right 10px` 的长度从右边向内量。
   * @param {{ axis: string, percent?: number, length?: number, keyword?: string }} a
   * @param {{ axis: string, percent?: number, length?: number, keyword?: string }} b
   * @param {{ axis: string, percent?: number, length?: number, keyword?: string }} c
   * @returns {{ x: object, y: object } | null}
   */
  function placeThree(a, b, c) {
    const lead = insetFromEdge(a, b);
    if (lead) {
      const other = crossAxis(c, lead.axis);
      if (!other) return null;
      return lead.axis === 'x' ? { x: lead.value, y: other } : { x: other, y: lead.value };
    }
    const trail = insetFromEdge(b, c);
    if (trail) {
      const other = crossAxis(a, trail.axis);
      if (!other) return null;
      return trail.axis === 'x' ? { x: trail.value, y: other } : { x: other, y: trail.value };
    }
    return null;
  }

  /**
   * 边关键字后面的 px 是从该边向内的偏移。right / bottom 从剩余空间的末端量起。
   * @param {{ axis: string, percent?: number, keyword?: string }} edge
   * @param {{ axis: string, length?: number, keyword?: string }} offset
   * @returns {{ axis: 'x'|'y', value: { length: number, fromEnd: boolean } } | null}
   */
  function insetFromEdge(edge, offset) {
    if (!edge || (edge.axis !== 'x' && edge.axis !== 'y')) return null;
    if (!offset || offset.keyword === 'center' || offset.length === undefined) return null;
    return {
      axis: edge.axis,
      value: { length: offset.length, fromEnd: edge.percent === 100 }
    };
  }

  /**
   * 三值里剩下的那一轴：center 是 50%，对边关键字用它自己的百分比。同轴关键字无效。
   * @param {{ axis: string, percent?: number, keyword?: string }} component
   * @param {'x'|'y'} taken
   * @returns {{ percent: number } | null}
   */
  function crossAxis(component, taken) {
    if (!component) return null;
    if (component.keyword === 'center') return { percent: 50 };
    if (component.axis !== 'x' && component.axis !== 'y') return null;
    if (component.axis === taken) return null;
    return axisValue(component);
  }

  /**
   * 百分比按剩余空间换算。长度从起点量起；fromEnd 时从对边向内量，并被剩余空间夹住。
   * @param {{ percent?: number, length?: number, fromEnd?: boolean }} axis
   * @param {number} slack
   * @returns {number}
   */
  function offsetFor(axis, slack) {
    const room = Math.max(0, slack);
    if (axis.length !== undefined) {
      const inset = Math.min(room, Math.max(0, axis.length));
      return axis.fromEnd ? room - inset : inset;
    }
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