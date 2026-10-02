# Contract: Vision Adapter

**Status**: 本功能的验收契约  
**Consumers**: 配置读取、结果校验、唤醒、演示页来源区  
**Non-consumers**: 感知代理、上传接口、Pyodide。本契约不定义网络请求。

结果的公共字段仍以 `specs/001-insitu-parabola/contracts/curve-result.md` 为准。运行配置的已有字段仍以 `specs/001-insitu-parabola/contracts/runtime-config.md` 为准。唤醒工厂仍以 `.specify/memory/constitution.md` 的「交接接口」为准。本文件只增加识别适配。

## 配置增量

```json
{
  "enableLocalMock": true,
  "fallbackAfterMs": 1500,
  "presetKey": "demo-parabola",
  "prewarmed": true,
  "externalAttempt": "off",
  "visionAdapter": "off"
}
```

| 字段 | 规则 |
| --- | --- |
| visionAdapter | `off` 或 `fixture`。缺省或其他值视为 `off` |
| fallbackAfterMs | 必须仍是 1500。不得为识别样例加长 |
| externalAttempt | 提交值必须是 `off`。不是 `off` 时，本适配不得进入识别交互 |

配置不得出现密钥、上传地址或模型名。

## 样例形状

打包文件是一份曲线结果，`videoId` 必须含 `fixture`。示例数字只说明类型。

```json
{
  "requestId": "string",
  "videoId": "fixture-video",
  "time": 12.5,
  "frameSize": { "width": 1920, "height": 1080 },
  "source": "vision",
  "fallback": null,
  "evidence": "packaged-sample",
  "definition": {
    "equationId": "fixture.parabola",
    "parameters": {
      "a": { "initial": 1, "min": 0.4, "max": 1.2, "step": 0.1 }
    },
    "dragParameter": "a",
    "domain": { "min": -10, "max": 10 },
    "range": { "min": -5, "max": 15 },
    "yAxis": "up",
    "region": { "x": 100, "y": 80, "width": 640, "height": 360 }
  }
}
```

`confidence` 可以不出现。若出现，必须满足 `0 ≤ confidence ≤ 1`。`confidence < 0.5` 时整份样例拒绝。

## 进入交互

同时满足才可绘制：

1. 本次读取的 `visionAdapter` 是 `fixture`。
2. 本次读取的 `externalAttempt` 是 `off`。
3. `.specify/memory/constitution.md` 已允许该组合下的 `source: "vision"`。修订完成前，实现不得放行。
4. `validateCurveResult(candidate, { allowVision: true })` 通过。
5. `evidence` 是 `packaged-sample`，`fallback` 是 `null`。
6. `videoId`、`time`（±0.2 秒）、`frameSize`、`requestId` 与当前冻结上下文一致。

失败时 `fail("external_unavailable", "外部结果不可用，未进入交互。")`，`result` 为 `null`。不得改用预制结果绘制。

## 来源文案

| 条件 | 用户必须看到 |
| --- | --- |
| source `vision`，evidence `packaged-sample`，fallback `null` | 「识别结果」以及「随演示打包的识别样例，尚未接通外部识别。」 |
| source `preset`，fallback `null` | 「预先准备的示例」 |
| source `preset`，fallback `timeout` | 「预先准备的示例 · 超时回退」以及「因等待超过 1.5 秒，改用预先准备的示例。」 |
| 识别候选被拒绝 | 「外部结果不可用，未进入交互。」 |

`confidence` 缺省时不显示百分比。不得出现「已接通」「识别成功」或外部服务名称。

## 计时

识别路径记录 `vision-decision`。不得记录到 `fallback-visible`，也不得使用 `extension-open`、`video-first-frame`、`network-wait`、`p1-init`。

## 夹具

至少包含：

- 一份合法样例：`source` 为 `vision`，`evidence` 为 `packaged-sample`，`fallback` 为 `null`，`confidence` 缺省或 ≥ 0.5，区域落在 `frameSize` 内。
- 一份非法样例：覆盖缺 `evidence`、`confidence` 低于 0.5、非有限数、越界 `region`、错误 `videoId` 中的至少一项。

夹具不含密钥、上传地址、模型名或真实个人信息。
