# Data Model: 识别结果适配

**Date**: 2026-10-02  
**Extends**: `specs/001-insitu-parabola/contracts/curve-result.md` 与 `specs/001-insitu-parabola/data-model.md`  
**Does not replace**: 001 的预制结果。未出现的新字段保持原校验。

## 实体

### RuntimeConfig 增量

在现有配置上增加一个字段。其余字段规则不变：`fallbackAfterMs` 必须是 1500，`enableLocalMock` 为布尔，`prewarmed` 为布尔，`externalAttempt` 为 `off` | `hang` | `invalid` | `late`。

| 字段 | 规则 |
| --- | --- |
| visionAdapter | `off` 或 `fixture`。缺省、空字符串或其他值都视为 `off`，不得视为 `fixture` |

提交文件中的值是 `off`。

### VisionCandidate

识别样例是一份 `CurveResult`，并多两个字段。

| 字段 | 规则 |
| --- | --- |
| source | 必须是 `vision`。本功能的样例生产者只能写这个值 |
| fallback | 必须是 `null`。样例成功不得写 `timeout` |
| evidence | 必须是 `packaged-sample`。缺省或其他值拒绝 |
| confidence | 可缺省。若存在，必须是有限数，且 `0 ≤ confidence ≤ 1`。`confidence < 0.5` 拒绝。缺省时不生成百分比 |
| requestId | 非空字符串，且等于本次唤醒冻结的编号 |
| videoId | 非空字符串，且等于当前视频 |
| time | 有限秒数，落在目标时间 ±0.2 秒 |
| frameSize | `width` 与 `height` 为正有限数，且等于当前视频源尺寸 |
| definition | 与 001 相同：`equationId` 必须有求值器；参数 `min ≤ initial ≤ max` 且 `step > 0`；`dragParameter` 是参数键；`region` 宽高为正且完全落在 `frameSize` 内；`domain` 与 `range` 的 `min < max` |

`source: "preset"` 的结果不得携带 `evidence`。001 的预制文件不增加这两个字段。

### 会话状态

不新增状态名。仍只有 `paused-ready`、`waiting`、`interactive`、`recoverable-error`。

可恢复错误仍使用：

| code | message |
| --- | --- |
| external_unavailable | 外部结果不可用，未进入交互。 |

识别拒绝时 `result` 为 `null`。不使用新的 `code`。

### 计时样本

| 名称 | 内容 |
| --- | --- |
| vision-decision | 识别路径从判定开始到进入 `interactive` 或 `recoverable-error` 的毫秒数，外加缓存状态 `hot` 或 `cold` |
| fallback-visible | 只留给判定超时到首个可见 SVG。识别路径不得写入 |

样本只含名称、毫秒数和缓存状态。不含图像、密钥或候选全文。

## 关系

- 一份 `RuntimeConfig` 决定一次唤醒读到的开关。每次 `start` 重新读取，不缓存上一次的 `visionAdapter`。
- 一个 `VisionCandidate` 只在 `visionAdapter === "fixture"` 且 `externalAttempt === "off"` 时被校验。
- 校验通过后，当前 `Session` 进入 `interactive`，`result` 指向该候选。
- 校验失败后，当前 `Session` 进入 `recoverable-error`，不读取预制结果作为替代绘制。

## 状态转移

1. `visionAdapter` 不是 `fixture`，或 `externalAttempt` 不是 `off`：不进入本模型的识别转移，沿用 001。
2. 两者分别为 `fixture` 与 `off`，且视频未暂停在目标时间：保持 `paused-ready`，返回未就绪，不挂层。
3. 候选通过第「VisionCandidate」表的全部规则：进入 `interactive`。来源文案为「识别结果」与「随演示打包的识别样例，尚未接通外部识别。」
4. 任一规则失败：进入 `recoverable-error`，消息为「外部结果不可用，未进入交互。」不绘制。
5. 退出、取消、播放或离开目标时间：回到 `paused-ready`，覆盖层移除。此后到达的同一 `requestId` 不得再打开交互。

## 不变式

- 提交配置的 `visionAdapter` 是 `off`，`externalAttempt` 是 `off`，`fallbackAfterMs` 是 1500。
- `interactive` 且 `source` 为 `vision` 时，`fallback` 为 `null`，`evidence` 为 `packaged-sample`。
- `interactive` 且 `source` 为 `preset` 时，不显示「识别结果」。
- 同一时刻只有一个会话、一个覆盖层。
