# Contract: 画面快照

提问模块的输入。页面在用户送出时用 `BreakGlass.tutor.snapshotFrom(figureSession.getState(), { requestId, interactive })` 组装。`interactive` 由页面传入：会话在交互且覆盖层还在。纯函数不得再去读 DOM 或会话。

## 形状

```json
{
  "requestId": "request-1",
  "kind": "parabola",
  "interactive": true,
  "parameters": {
    "a": { "value": 1, "min": 0.4, "max": 1.2, "step": 0.1, "label": null },
    "h": { "value": 0, "min": -2, "max": 2, "step": 0.1, "label": null },
    "k": { "value": 1, "min": -2, "max": 2, "step": 0.1, "label": null }
  },
  "domain": { "min": -2.5, "max": 2.5 },
  "range": { "min": 0, "max": 8 },
  "figure": {}
}
```

`figure` 是 `figureSession.getState()` 的深拷贝，给登记里的 `valuesAt` 交给图形模型 `readAt`。直线、圆、正弦的 `label` 来自各自滑块，例如斜率是「斜率 m」。抛物线的定义里没有滑块标签，`label` 为 `null`，回答改用登记里的叫法。

## 组装规则

- `kind` 是画面上的图形种类：`parabola`、`line`、`circle`、`sine`。
- `domain`、`range` 和每个系数的 `min`、`max`、`step`、`label` 来自这份图形的 `definition.parameters`。
- 每个 `value` 来自 `figure.parameters`，不是滑块 DOM 上未经确认的字符串。
- `requestId` 是这一次破壁的会话代号。应用解答前，页面确认会话仍是这个 `requestId`、仍在交互，并且画面上的 `kind` 与系数仍是送出时那一份。退出、换视频、又一次破壁或换了图形都使旧快照失效。
- 快照不含图像、课程正文、阅读地址、密钥和模型原文。

## 图形登记

模块：`extension/src/tutor/figures.js`，挂在 `BreakGlass.tutorFigures`。按 `kind` 登记，提问才能执行。登记不是快照的一部分，避免把函数塞进页面状态。

| 字段 | 要求 |
| --- | --- |
| `kind` | 与快照相同才命中 |
| `label` | 图形的中文名，例如「抛物线」 |
| `names` | 每个系数键在回答里的叫法。定义里有滑块标签时，回答优先用快照里的 `label`；两者都应与滑块逐字相同 |
| `aliases` | 每个系数键对应一组说法。匹配取最长说法；单个 ASCII 字母两侧不能紧挨其他字母 |
| `valuesAt(snapshot, values, x)` | 返回有限数值数组。四种图形都交给模型的 `readAt`。圆可以返回空数组、一个或两个 y |
| `describe(name, before, after, formatDelta)` | 可选。说明这次变化，例如「向下平移 2」 |
| `pointWord` / `vertex(values)` / `vertexParameters` | 可选。抛物线的关键点叫「顶点」，圆叫「圆心」 |
| `showWork(values, x, y, format)` | 可选。写出代入过程 |
| `shifts` | 可选。上下左右平移各对应哪个系数、哪个方向 |
| `examples` | 这种图形的示例问法。换图形时页面用它们重建示例按钮 |

未登记时，`ask` 返回 `unavailable`，`changed` 为假。重复登记同一个 `kind` 会被拒绝。

写入走 `figureSession.updateParameters`，一次写完。失败或写完的数与解答不一致时，页面用送出前的系数再写回去。显示区域对不上时回答「画面的显示区域现在对不上，这次没有改图」。

## 窗口

点 `(x, y)` 在窗口内，当且仅当 `x` 落在 `domain` 内且 `y` 落在 `range` 内，边界算在内。读数可以返回窗口外的真实 y。快照不负责把 y 夹进 `range`。
