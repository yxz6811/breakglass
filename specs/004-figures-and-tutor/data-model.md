# Data Model: 旁边提问

实体都在浏览器内存里。本功能不新增可持久化记录，也不改 `CurveResult`。

## 画面快照

提问送出的那一瞬间，从当前交互会话抄出的只读数据。字段定义见 [contracts/figure-snapshot.md](./contracts/figure-snapshot.md)。

| 字段 | 含义 | 规则 |
| --- | --- | --- |
| `requestId` | 这一次破壁的会话代号 | 页面在写入前核对仍是同一次 |
| `equationId` | 当前图形 | 必须有登记才能执行 |
| `parameters` | 当前每个系数的值、上下限、步长 | 值来自 `currentParameters`，范围来自 `definition.parameters` |
| `domain` | 横坐标窗口 | 沿用当前定义 |
| `range` | 纵坐标窗口 | 沿用当前定义 |
| `interactive` | 是否已破壁且覆盖层还在 | 否则整次不改图 |

快照不是第二份会话。写入仍回到 `setParameter`。

## 意图

`parse.js` 的输出。它只描述用户想做什么，不含算好的 y。见 [contracts/tutor-turn.md](./contracts/tutor-turn.md)。

| 种类 | 字段 | 进入下一步的条件 |
| --- | --- | --- |
| 修改 | `sets`：`{ name, spoken }` 或 `{ name, delta }` | 每个 `name` 都属于当前图形，每个数是有限数 |
| 读数 | `reads`：`{ target: "x", x }`、`{ target: "vertex" }` 或 `{ target: "parameter", name }` | 当前图形有对应登记；读数不改系数 |
| 无法执行 | `problems`：`{ kind, ... }` | 只要有一项，整句不改图 |

`problems.kind` 取 `empty`、`no_target`、`foreign`、`duplicate`、`no_vertex`、`no_shift`。一句里只要有一项无法执行，整句不改图，不保留另一项。

## 实际采用的系数

修改意图的中间结果。每个被点名的系数有：

| 字段 | 含义 |
| --- | --- |
| `name` | 系数键，如抛物线的 `a`、`h`、`k` |
| `before` | 送出时画面上的值 |
| `spoken` | 用户原话里的数；相对说法时是 `before + delta` |
| `adopted` | 按步长对齐并夹进范围后的值 |
| `adjusted` | `adopted` 与 `spoken` 是否不同 |
| `clamped` | 夹到上限为 `max`，夹到下限为 `min`，否则为 `null` |

全部系数都得到有限的 `adopted` 时，这一组才可以写入。写入值是 `adopted`，不是 `spoken`。

## 解答

一次送出的最终结果，页面用它决定说什么、画什么。

| 字段 | 含义 | 规则 |
| --- | --- | --- |
| `kind` | 结果种类 | `applied`、`read`、`unchanged`、`unavailable` |
| `changed` | 是否改了系数 | 有系数的 `adopted` 不等于 `before` 时为真 |
| `parameters` | 写入后的全部系数 | `changed` 为假时等于快照里的原值 |
| `adjustments` | 每个被点名的系数 | 见上一节 |
| `reads` | 本次读到的点或系数 | 读数用改完之后的系数 |
| `reply` | 给用户看的一段中文 | 其中的数只能来自上面几项和坐标窗口边界 |

`kind` 是提问模块自己的结果种类，不是会话错误码，也不进入 `CurveResult`。

## 对话

| 字段 | 含义 |
| --- | --- |
| `role` | `user` 或 `tutor` |
| `text` | 原文或解答的 `reply` |

只存在页面的记录区里，最多 20 条。退出破壁、换视频、再次破壁或换图形种类时清空，避免上一种图形的数字留在旁边。不重放旧问句。按重置时追加一行说明。

## 抛物线登记

| 系数 | 回答里的叫法 | 可以认出的说法 |
| --- | --- | --- |
| `a` | 开口宽窄 a | 开口宽窄、开口大小、二次项系数、开口、a |
| `h` | 水平位置 h | 水平位置、左右位置、顶点横坐标、h |
| `k` | 顶点高度 k | 顶点高度、顶点纵坐标、上下位置、竖直位置、高低、k |

回答里的叫法与滑块标签逐字相同，`tests/page-integration.test.js` 会核对。

范围和步长不写死在登记里。预设夹具是 a 为 0.4 到 1.2、h 和 k 为 -2 到 2、步长 0.1；阅读结果可以带来另一组范围，以当时的 `definition.parameters` 为准。

一个 x 的读数是 `a(x-h)^2+k`，由现有 `evaluateWithParameters` 计算，登记只包成单元素数组。顶点是 `(h, k)`。平移：上下改 `k`，左右改 `h`。

## 状态怎么走

```text
未破壁  --送出-->  输入区禁用；ask 返回 unavailable
交互中  --改系数成功-->  写入 adopted，重画，applied
交互中  --只读数成功-->  不写入，read
交互中  --对不上 / 整句有一项失败-->  不写入，unchanged
交互中  --求值失败或图形未登记-->  不写入，unavailable
交互中  --写入前会话已变-->  不写入，回答说明这次没有改
```

重置按钮仍把系数恢复成这次破壁的初值，与提问无关。提问不调用重置。
