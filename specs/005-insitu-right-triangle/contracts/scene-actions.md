# Contract: 当前帧直角三角形与受限动作

**Date**: 2026-10-03
**Status**: 005 实施建议；以下两个 HTTP 端点、场景模块和动作执行器尚未实现，不是现有服务能力。
**Governance**: [Spec Constitution 1.9.0](../../../.specify/memory/constitution.md)、[BreakGlass Constitution 1.7.0](../../../docs/BreakGlass-constitution.md)。
**Scope**: 一张暂停帧、一个直角三角形、A 为直角顶点、两条已知直角边 AB/AC、一条本地计算的斜边 BC。004 多曲线与问答、003 开播前阅读和既有抛物线 P0 均保持独立。

本契约授权的是固定数据结构与三个操作，不接受模型生成的 JavaScript、Python、HTML、SVG、任意公式或坐标执行代码。识别候选通过结构检查后仍须用户核对题目条件；“结构合法”不能显示为“题目识别正确”。

## 1. SceneResult

### 1.1 建议结构

```json
{
  "schemaVersion": "1.0.0",
  "kind": "right-triangle",
  "requestId": "geometry-read-1",
  "videoId": "local-video-1",
  "frameTime": 6,
  "frameSize": { "width": 1920, "height": 1080 },
  "sceneRevision": 0,
  "rightAngleAt": "A",
  "labels": { "A": "A", "B": "B", "C": "C" },
  "vertices": {
    "A": { "x": 640, "y": 700 },
    "B": { "x": 640, "y": 400 },
    "C": { "x": 1040, "y": 700 }
  },
  "lengths": { "AB": 3, "AC": 4 },
  "unit": "unit",
  "source": "vision",
  "originSource": "vision",
  "editedByUser": false
}
```

这个示例是契约夹具，不是已经识别的视频。`BC` 不在上游权威输入中；若模型输出了斜边数值，必须丢弃该候选或由适配器移除后明确记录，不得用它覆盖本地计算值。

| 字段 | 校验与含义 |
| --- | --- |
| `schemaVersion` / `kind` | 精确为 `1.0.0` / `right-triangle`；未知版本或场景拒绝 |
| `requestId` / `videoId` | 页面生成的非空、不透明标识；服务原样回传，不由模型生成；与当前请求完全一致 |
| `frameTime` | JSON number、有限、非负，单位秒；等于本次捕获帧的时间，且不超过已知视频时长 |
| `frameSize` | 源视频像素宽高，均为正整数；必须与捕获帧时的 `videoWidth` / `videoHeight` 一致，不是 JPEG 或 CSS 尺寸 |
| `sceneRevision` | 非负安全整数；服务候选为 0，首次用户确认变为 1，之后每次成功条件修改或恢复递增，不倒退 |
| `rightAngleAt` | 只能为 `A`；识别或题面无法确定直角位于 A 时进入校对，不凭像素角度猜测 |
| `labels` | 恰有 A/B/C 三个语义键；显示文字为 1～16 个码点、去除首尾空白后非空且互不相同；按纯文本渲染 |
| `vertices` | `vision` 候选必须有 A/B/C 三个源像素点；x/y 必须是有限 JSON number，并落在源帧内；三个点不同且不共线，仅表示原帧定位。无原图的 `manual` 场景允许省略或为 `null`，不能伪造定位；与视频绑定的预设若声明原帧定位则同样完整校验 |
| `lengths` | 恰有 `AB` / `AC`；均为正、有限 JSON number，不转换字符串、布尔值或 `null` |
| `unit` | 精确为 `unit`、`cm` 或 `m`；两边共用一个单位，未写物理单位时用 `unit` 并显示“单位长度” |
| `source` / `originSource` | 只能为 `vision`、`preset`、`manual`；来源由可信适配器或页面设置，不由模型自由指定 |
| `editedByUser` | boolean；明确记录用户是否校正或修改条件 |

对象必须符合固定 Schema，未知字段不得进入会话或执行器。服务与浏览器各校验一次；上游模型原始回复不能直接成为 `SceneResult`。

### 1.2 题意、定位与几何绘制

- A 是规范化后的直角顶点，B/C 分别连接已知边 AB/AC。识别器须关联图中文字和边的含义；画面上恰有数字 3/4 不能据此认定它们属于这两条边。
- `vertices` 用于在暂停帧上高亮候选点、显示标签和协助校对。示意图可能未按比例绘制，不能用像素边长推算题目数值，不能把视觉上接近 90° 当成题目已知条件。
- 确认后的模型使用 `A=(0,0)`、`B=(AB,0)`、`C=(0,AC)` 或整体旋转/平移后的等价形式。整体变换不能改变 A 处直角或边长关系。画板缩放按当前两边统一计算，不能分别拉伸两轴。
- 在原帧中确认位置后，参数变化显示的是按题目条件生成的模型；界面应说明模型已修改，不能声称此时仍与原帧图形 1:1 重合。
- 源像素、数学模型与 CSS 显示坐标分开。原帧高亮复用 `contentRect` 黑边映射；窗口变化时重新计算。独立画板负责展示修改后的模型，不改原播放器 DOM、控制条或视频源。
- 鼠标拖动若用于改边，必须转换成合法 `set_length`，始终保留直角；不能任意移动顶点使题目约束失效。键盘或数值输入必须提供同等操作。

### 1.3 确定性计算与有限派生值

唯一斜边公式是 `BC = Math.hypot(AB, AC)`。不采用模型给出的 BC，也不先计算 `AB * AB + AC * AC` 以免额外溢出。

每次进入会话、改边和恢复，都先计算派生值并执行 `derivedFinite` 门禁：BC 和用于绘图的归一化坐标必须有限，BC 必须为正，最终 SVG 属性不能包含 `NaN` / `Infinity`。例如两个输入各自有限但 `Math.hypot` 溢出的组合仍整批拒绝。显示舍入只发生在展示层，不能把舍入后的值写回计算状态。

### 1.4 来源与原题快照

| 取得或修改方式 | 来源规则与界面含义 |
| --- | --- |
| 模型返回且用户尚未确认 | `source: vision`、`originSource: vision`、`editedByUser: false`；显示“识别候选，待校对” |
| 明确选择预设 | 两个来源均为 `preset`；持续显示“预设演示”，不得写为识别成功 |
| 从空白手动输入 | 两个来源均为 `manual`、`editedByUser: true`；显示“手动输入” |
| 用户校正识别候选或实验修改边长 | `source` 变为 `manual`、`originSource` 保留首次取得方式、`editedByUser: true`；显示原始来源及“已校对”或“已修改” |

首次用户点击确认时，把其核对完成的场景深拷贝为内存中的原题快照。该快照不是首次模型原始回复，也不能被随后动作覆盖。`restore_original` 恢复快照中的条件、定位和来源字段，但保留当前帧身份，把当前 `sceneRevision` 增加 1；不会把修订号退回 1。快照只在此次场景会话内存中保留，退出或换片时清理。

## 2. 建议识别接口：POST /geometry/read

**依赖状态：拟新增，当前尚未实现。** 在已有 `breakglass-reader/` 内增加独立处理分支，不改 `/read` 的 003 抛物线响应。

用户主动暂停并进入 005 后，先说明这一帧会送给所填本地服务及其配置的模型。用户触发识别才捕获和发送一张 JPEG；不扫描其他帧，不发送整段视频，不自动套用预设。不得把模型密钥放入扩展、输入框、请求、响应或仓库。

### 请求

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "geometry-read-1",
  "videoId": "local-video-1",
  "frameTime": 6,
  "frameSize": { "width": 1920, "height": 1080 },
  "image": "data:image/jpeg;base64,..."
}
```

`image` 是同一捕获帧的单张 JPEG，建议宽度不超过 640、质量 0.72，保持宽高比。服务读取 JPEG 实际尺寸，与 `frameSize` 比例检查后把识别顶点映射回源像素；允许编码取整误差，禁止把不同画幅直接拉伸适配。请求体最大 **4 MiB（4 × 1024 × 1024 字节）**，包括 JSON、base64 和元数据，超过上限返回 413。编码建议与超时值均是开发默认，实际识别效果与预算待真实片子测试冻结。

### 响应

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "geometry-read-1",
  "videoId": "local-video-1",
  "frameTime": 6,
  "status": "candidate",
  "scene": { "schemaVersion": "1.0.0", "kind": "right-triangle" }
}
```

这里的 `scene` 省略了 §1 的其余必填字段，仅示意响应层级；实际响应必须包含完整 `SceneResult`。无适用三角形时返回 `status: unsupported`、`scene: null`、一个短原因代码；无法读清标签、条件或单位时返回 `status: needs_review`、`scene: null`，由用户进入手动输入。不得伪造缺失的必填数值以凑齐可执行场景。

浏览器在收下候选前检查请求身份、帧身份、源尺寸、当前视频暂停状态和当前时间距捕获帧不超过 ±0.2 秒。换片、播放、重新捕获、取消、退出及超时后都使旧请求失效；迟到响应不得打开画板，也不得恢复已失效快照。

## 3. 建议问答接口：POST /geometry/ask

**依赖状态：拟新增，当前尚未实现。** 只有场景经用户确认后可调用；发当前固定 Schema 场景和问题文字，不追加图片、视频、课程全文或其他帧。

### 请求

```json
{
  "schemaVersion": "1.0.0",
  "actionRequestId": "geometry-ask-1",
  "scene": { "schemaVersion": "1.0.0", "kind": "right-triangle" },
  "text": "如果 AB 从 3 变成 6，BC 会怎样？"
}
```

`scene` 必须为 §1 的完整已确认场景，`sceneRevision` 至少为 1；示例仅省略重复字段。`text` 是 1～2000 个码点的非空纯文本，不自动转成可执行代码。`actionRequestId` 为本次问答身份；`scene.requestId` 仍是场景取得身份，两者不能混用。请求体同样最多 4 MiB。

### 响应

```json
{
  "schemaVersion": "1.0.0",
  "actionRequestId": "geometry-ask-1",
  "context": {
    "requestId": "geometry-read-1",
    "videoId": "local-video-1",
    "frameTime": 6,
    "frameSize": { "width": 1920, "height": 1080 },
    "sceneRevision": 1
  },
  "status": "actions",
  "actions": [
    { "type": "set_length", "side": "AB", "value": 6, "unit": "unit" },
    { "type": "explain_change" }
  ]
}
```

`context` 和 `actionRequestId` 由服务按请求填写，不能让模型覆盖。不支持的问题返回 `status: unsupported`、`actions: []` 和短原因代码，不执行最接近的替代操作。模型返回的答案数字、运算过程或任意文本不作为计算权威；本次切片通过本地执行结果生成说明。

## 4. 动作白名单与原子执行

| 操作 | 唯一合法字段 | 行为 |
| --- | --- | --- |
| `set_length` | `type`、`side: AB\|AC`、正有限 JSON number `value`、当前 `unit` | 修改一条直角边，保持 A 为直角并重算 BC |
| `explain_change` | 只有 `type` | 用本次实际前后状态、BC 与固定勾股关系说明变化；不修改修订号 |
| `restore_original` | 只有 `type` | 恢复首次确认快照；成功恢复使修订号递增 |

单批动作最多 2 个，至多一个 `set_length`，另一个只能是 `explain_change`。首版每次只改一条直角边并固定另一条；收到两个或更多改边动作时整批拒绝，即使它们都合法也不部分执行。`explain_change` 至多一次；`restore_original` 不得与 `set_length` 同批，允许恢复后解释。`unit` 必须与场景一致，不自动把 cm 换成 m；请求改斜边、移动直角顶点、改变角度、添加对象、换公式或执行代码均拒绝。

执行顺序必须是：

1. 对完整响应做 Schema 检查；核对 `actionRequestId`、场景 `requestId`、`videoId`、`frameTime`、`frameSize`、`sceneRevision` 与当前会话完全相同。
2. 确认当前帧仍有效且已确认。请求中途发生人工修改、恢复、播放、换片、退出或新问题时，使旧动作响应失效。
3. 在状态副本上验证整批动作、单位、数值和派生结果。任一操作失败，整批拒绝，AB/AC/BC、图形和修订号均不改变。
4. 验证通过后一次提交新状态，成功修改条件的批次只把 `sceneRevision` 增加 1，再按提交后的状态重绘。
5. 说明模板读取实际提交前后数字。无更改时说明当前两条直角边和 BC；有更改时说明哪条边如何改变、BC 的实际前后值及 A 处仍为直角。对话声称 6 后，执行失败就不能显示“已改成 6”。

预设例：AB=3、AC=4 时 `Math.hypot(3,4)=5`；只改 AB=6 后 BC=`Math.hypot(6,4)=√52≈7.2111025509`；再进行一次独立操作，只改 AC=8、固定 AB=6，此时 BC=10。所有解释使用这些本地结果，不用模型预测答案。

## 5. 截止、取消与失败

- 005 识别开发默认截止 **30000ms**，问答开发默认截止 **10000ms**，均覆盖一次本地服务处理与上游模型调用。预算待真实样本测试后冻结，不能宣传为已测延迟或成功率。
- 每次用户识别/提问最多一次上游调用，不自动重试。取消、页面退出、客户端断开和预算截止须传播到模型请求；不配合取消的迟到结果在服务与浏览器都丢弃。
- 这些预算属于 005；不修改既有 `fallbackAfterMs: 1500`、P0 的缓存回退或 003 的 5 分钟阅读截止。005 失败后保留用户视频和已确认有效场景；本次无有效候选则提供重试、手动校对或返回视频，不自动改成预设。
- 模型密钥仅由 `breakglass-reader/` 服务进程的环境读取；日志不记录 image data URL、问题全文、响应全文、密钥或课程正文。可以记录请求编号、操作类型、原因代码和耗时。
- 端点沿用本地服务来源白名单，不新增扩展 `host_permissions`，不放宽 CSP，不引入远程可执行代码、数据库、账号或云端平台部署。

建议错误语义如下；不是现有 `/read` 的新增承诺：

| 状态 | 场景 |
| --- | --- |
| 400 | 字段/类型/版本/归属无效，未知动作或单位冲突 |
| 403 | 请求来源不在本地服务白名单 |
| 413 / 415 | 超过 4 MiB / 不是 `application/json` |
| 503 | 模型未配置 |
| 502 | 上游调用或上游结构化结果失败 |
| 504 | 005 独立预算截止 |
| 200 + `unsupported` / `needs_review` | 清楚的范围不支持或题目条件不足；不是可执行成功场景 |

客户端取消不伪造成功响应。错误提示保留必要上下文和可恢复入口，不暴露密钥、画面内容或模型原文。
