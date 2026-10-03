# Contract: 一次提问

模块：`extension/src/tutor/ask.js`，挂在 `BreakGlass.tutor`。

```text
ask(snapshot, text) -> answer
```

`snapshot` 见 [figure-snapshot.md](./figure-snapshot.md)。`text` 是用户送出的一整句。函数不改快照，不碰会话，不画 SVG，不发请求。

## 解析要认出的说法

先做 NFKC，把全角数字、全角符号和空白收成普通写法，超过 120 字截断。数可以写成 `-1`、`0.5`、`1/2`、「负一点五」「二分之一」。下面是抛物线必须认出的说法。说法对上才执行，对不上返回 `unchanged`。

修改：

- 「把顶点高度改成 -1」「k=-1」「h 调到 1」
- 「如果开口是 0.5，图像怎么变」
- 「把开口改成 0.8，顶点高度改成 -1」
- 「把顶点移到 (1, -1)」
- 「向下平移 1」「往右移 0.5」「k 增加 0.5」「开口减小 0.2」

读数：

- 「x 等于 1 时 y 是多少」「f(1) 是多少」
- 「横坐标是 0.5 的时候纵坐标是多少」
- 「顶点在哪里」
- 「k 现在是多少」

改加读：

- 「如果开口是 0.5，x 等于 1 时 y 是多少」：先改开口，再用改完的曲线读数。

不执行：

- 空句、没有数也没有可读的对象
- 有数但没说改哪个系数，也没说是哪个 x
- 「把半径改成 3」而当前是抛物线
- 同一句里一个系数能改、另一个系数当前图形没有
- 同一个系数在一句里给了两个不同的数
- 当前图形没有登记，或没有登记那种平移

## 解答形状

```json
{
  "requestId": "request-1",
  "kind": "applied",
  "changed": true,
  "parameters": { "a": 1, "h": 0, "k": -1 },
  "adjustments": [
    { "name": "k", "before": 1, "spoken": -1, "adopted": -1, "adjusted": false, "clamped": null }
  ],
  "reads": [],
  "reply": "顶点高度 k 从 1.0 改为 -1.0，抛物线向下平移 2.0。顶点现在是 (0.0, -1.0)。"
}
```

`kind` 只有四种，是本模块自己的结果种类，不是会话错误码：

| kind | changed | 情况 |
| --- | --- | --- |
| `applied` | 系数确实变了才为真 | 执行了修改，可能同时有读数 |
| `read` | 假 | 只回答读数 |
| `unchanged` | 假 | 问句对不上，或有一项不能执行 |
| `unavailable` | 假 | 还不能问，图形未登记，或求值没有返回 |

`reads` 的一项：

```json
{ "target": "x", "x": 1, "values": [2], "inside": [true], "xInside": true }
{ "target": "vertex", "x": 0, "values": [1], "inside": [true], "xInside": true }
{ "target": "parameter", "name": "k", "value": 1 }
```

`values` 来自登记的 `valuesAt`。抛物线只有一个 y，圆可以有零个或两个。`inside` 与 `values` 一一对应，按快照的 `domain` 和 `range` 判断。窗口外时 `reply` 写出真实的 y，并写明这个点在当前坐标窗口外。

## 写入约定

页面只在下面四条同时成立时写入：

1. 当前会话仍是快照里的 `requestId`，且仍在交互。
2. `answer.changed` 为真。
3. `answer.kind` 为 `applied`。
4. `answer.parameters` 的键集合与快照的系数键集合相同。

写入时对每个 `adopted` 不等于 `before` 的系数调用 `setParameter(name, adopted)`。`adopted` 已经按步长对齐并夹过范围，会话层再夹一次也得到同一个数。全部写入后再 `drawCurve()`。任何一条 `setParameter` 失败，页面把已写入的系数设回 `before`，回答改为这次没有改。

`read`、`unchanged`、`unavailable` 都不调用 `setParameter`。

## 回答里的数

- 系数用 `numbers.formatParameter`，与滑块标签是同一个函数。
- 读数和横坐标用 `numbers.formatReading`，最多 4 位小数，不另做一次夹取。
- `reply` 里的数只能来自：改前的值、实际采用的值、两者之差、该系数的范围与步长、读数的 x 和 y、坐标窗口的边界。
- 用户原话越出范围或落在两格之间时，`adjusted` 为真，`reply` 写出实际采用的数，不复述原话里那个数。
- 帮助与拒绝的回答里不出现阿拉伯数字，免得被当成画面上的数。

## 页面行为

| 状态 | 提问区 | 送出后 |
| --- | --- | --- |
| 尚未破壁、等待、失败、已退出 | 输入框和送出按钮禁用，提示「先破壁，再问这条曲线」 | 不画、不改系数 |
| 交互中 | 可输入 | 按上面的写入约定 |

提问记录是 `role="log"` 区域，新回答礼貌播报。焦点在输入框内时 Esc 清空草稿，不退出破壁。记录最多保留 20 条；退出、换视频、再次破壁或换图形时清空。
