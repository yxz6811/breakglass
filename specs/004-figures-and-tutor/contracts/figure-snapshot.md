# Contract: 画面快照

提问模块的输入。页面在用户送出时用 `BreakGlass.tutor.snapshotFrom(session.getState())` 组装，纯函数不得再去读 DOM 或会话。

## 形状

```json
{
  "requestId": "request-1",
  "equationId": "fixture.parabola",
  "interactive": true,
  "parameters": {
    "a": { "value": 1, "min": 0.4, "max": 1.2, "step": 0.1 },
    "h": { "value": 0, "min": -2, "max": 2, "step": 0.1 },
    "k": { "value": 1, "min": -2, "max": 2, "step": 0.1 }
  },
  "domain": { "min": -2.5, "max": 2.5 },
  "range": { "min": 0, "max": 8 }
}
```

## 组装规则

- `equationId`、`domain`、`range` 和每个系数的 `min`、`max`、`step` 来自当前 `result.definition`。
- 每个 `value` 来自当前 `currentParameters`，不是滑块 DOM 上未经确认的字符串。
- `interactive` 仅在会话状态是 `interactive` 且覆盖层仍在时为真。页面在 `snapshotFrom` 的结果上再与覆盖层是否存在相与。
- `requestId` 是这一次破壁的会话代号。应用解答前，页面确认会话仍是这个 `requestId` 且仍在交互；退出、换视频或又一次破壁都使旧快照失效。
- 快照不含图像、课程正文、阅读地址、密钥和模型原文。

## 图形登记

模块：`extension/src/tutor/figures.js`，挂在 `BreakGlass.tutorFigures`。`equationId` 要有一条登记，提问才能执行。登记不是快照的一部分，避免把函数塞进页面状态。

| 字段 | 要求 |
| --- | --- |
| `equationId` | 与快照相同才命中 |
| `label` | 图形的中文名，例如「抛物线」 |
| `names` | 每个系数键在回答里的叫法，例如 `k` 叫「顶点高度 k」。必须与该系数滑块的标签逐字相同 |
| `aliases` | 每个系数键对应一组说法。匹配取最长说法；单个 ASCII 字母两侧不能紧挨其他字母 |
| `valuesAt(snapshot, values, x)` | 返回有限数值数组。抛物线返回一个 y。圆可以返回空数组、一个或两个 y |
| `describe(name, before, after, formatDelta)` | 可选。说明这次变化，例如「向下平移 2」 |
| `vertex(values)` / `vertexParameters` | 可选。有顶点的图形才登记 |
| `showWork(values, x, y, format)` | 可选。写出代入过程 |
| `shifts` | 可选。上下左右平移各对应哪个系数、哪个方向 |

未登记时，`ask` 返回 `unavailable`，`changed` 为假。重复登记同一个 `equationId` 会被拒绝。

对方加入直线、圆或正弦时，需要交出：

- 画面上的 `equationId`
- 与滑块一致的系数键、范围和步长
- 一个 `valuesAt`
- 想被问到的中文说法

提问侧把这些写成 `figures.js` 里的一条登记。不在登记里重写绘制和裁剪。

## 窗口

点 `(x, y)` 在窗口内，当且仅当 `x` 落在 `domain` 内且 `y` 落在 `range` 内，边界算在内。读数可以返回窗口外的真实 y。快照不负责把 y 夹进 `range`。
