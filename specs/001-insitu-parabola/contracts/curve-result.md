# Contract: CurveResult

**Status**: 本功能的验收契约  
**Consumers**: 准备结果、结果校验、交互层  
**Non-consumers**: 感知代理。本计划不定义上传接口。

## 时间

`time` 是从视频起点计算的秒，JSON 数字，必须有限。目标时间容差默认 ±0.2 秒。比较使用秒，不使用帧序号。

## 形状

```json
{
  "requestId": "string",
  "videoId": "string",
  "time": 12.5,
  "frameSize": { "width": 1920, "height": 1080 },
  "source": "preset",
  "fallback": null,
  "definition": {
    "equationId": "fixture.parabola",
    "parameters": {
      "a": { "initial": 1, "min": 0.4, "max": 1.2, "step": 0.1 },
      "h": { "initial": 0, "min": -2, "max": 2, "step": 0.1 },
      "k": { "initial": 0, "min": -2, "max": 2, "step": 0.1 }
    },
    "dragParameter": "a",
    "domain": { "min": -10, "max": 10 },
    "range": { "min": -5, "max": 15 },
    "yAxis": "up",
    "region": { "x": 100, "y": 80, "width": 640, "height": 360 }
  }
}
```

示例数字只说明类型。正式验收数字来自团队素材。工程夹具必须在 `videoId` 或名称上标明 fixture，不能当作正式视频已经对齐。

## 允许值

| 字段 | 规则 |
| --- | --- |
| source | 只有 `preset` 或 `vision`。本功能的生产者只能写 `preset` |
| fallback | `null` 或 `timeout` |
| equationId | 必须存在对应求值器 |
| parameters | 只能包含求值器登记的系数。initial、min、max、step 和 max−min 均为有限数，且 min ≤ initial ≤ max，step > 0。`fixture.parabola` 必须且只能给出 a、h、k；a 非零，整个 a 范围保持同号且不包含 0。允许合法的小系数和小 step，不做固定小数位舍入 |
| dragParameter | 必须是 parameters 的键 |
| region | 宽高为正，且完全落在 frameSize 内 |
| domain、range | min < max，端点与 max−min 均有限 |

## 进入交互前

同时满足才可绘制：

1. JSON 形状符合上表。
2. `videoId` 等于当前视频。
3. `time` 落在当前目标容差内。
4. `frameSize` 等于当前视频源尺寸。
5. `requestId` 等于当前等待或当前会话。退出、取消、换帧之后，旧编号失效。
6. 求值器存在。所有可调参数组合在整个 domain 内均能有限求值；抛物线以各系数、x 区间端点和顶点覆盖极值。有限的越界输入钳制在范围内，NaN、Infinity 和非数值更新直接拒绝并保留上一状态。

这些规则落实 [`docs/BreakGlass-constitution.md`](../../../docs/BreakGlass-constitution.md) 的确定性结果门禁；只证明安全可绘制，不代表真实识别、语义正确或与视频对齐已经验收。

失败时不绘制曲线，并给出可重试或可退出的说明。不得把失败改写成成功，也不得把 `preset` 显示成识别成功。

## 来源文案

| source | fallback | 用户必须看到的含义 |
| --- | --- | --- |
| preset | null | 预先准备的示例 |
| preset | timeout | 因超时改用预先准备的示例，并说明原因 |
| vision | 任意 | 本功能不得出现 |

## 夹具

测试至少包含一份合法抛物线候选和一份非法候选。非法候选覆盖缺字段、非有限数值、越界 region、未知 equationId、错误 videoId。夹具不含密钥或真实个人信息。
