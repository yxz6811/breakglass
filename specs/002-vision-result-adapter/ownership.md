# 识别结果适配：前后端分工

> 状态：可并行。日期：2026-10-02。
> 对照 [`tasks.md`](./tasks.md) 的 T001–T018。规格、契约和验收见 [`spec.md`](./spec.md)、[`contracts/vision-adapter.md`](./contracts/vision-adapter.md)、[`quickstart.md`](./quickstart.md)。
> 这里的「后端」不是服务进程。它指本仓库里决定「哪一份结果可以进入交互」的规则。不新建 `backend/`，不上传单帧，不接外部识别服务。

两人从本文冻结的状态形状开工。页面不判断样例合不合法，结果规则不写演示文案。

## 1. 名词

| 叫法 | 实际含义 | 代码位置 |
| --- | --- | --- |
| 前端（页面侧） | 演示页、来源文案、焦点和手工验收 | `extension/demo/`、`extension/src/page/`、`extension/src/ui/` |
| 后端（结果规则侧） | 校验、配置字段、打包样例、唤醒是否进入交互、会话副本是否保住 `evidence` | `extension/src/curve/`、`extension/src/session/`、`extension/src/preset/`、`extension/assets/` |
| 外部识别服务 | 本次不派发 | 不在本仓库 |

## 2. 独占路径

同一时间一个路径只属于一个人。对方只读。

### 后端

- `.specify/memory/constitution.md`
- `specs/002-vision-result-adapter/plan.md`（只把 T002 完成后的门禁改成通过）
- `extension/src/curve/validate.js`
- `extension/src/session/wake.js`
- `extension/src/session/session.js`（只为保住 `evidence`）
- `extension/src/preset/load.js`
- `extension/assets/config.json`
- `extension/assets/vision/`
- `tests/vision-validate.test.js`
- `tests/vision-config.test.js`
- `tests/vision-wake.test.js`
- `tests/vision-reject.test.js`

### 前端

- `extension/demo/index.html`
- `extension/demo/demo.css`
- `extension/src/page/main.js`
- `tests/page-vision.test.js`
- `tests/vision-latency.test.js`
- `docs/BreakGlass-frontend-validation.md`
- `docs/frontend-backend-boundary.md`

### 双方都不改

- `extension/manifest.json`（前端只核对，不提交改动）
- `extension/src/telemetry/latency.js`
- `extension/src/attempt/`
- `extension/src/geometry/`
- `extension/src/curve/evaluate.js`
- `extension/src/ui/`
- `specs/001-insitu-parabola/tasks.md`
- `createWake` 的参数列表

`extension/assets/config.json` 只有后端可以提交。提交值必须是 `visionAdapter: "off"`、`externalAttempt: "off"`、`fallbackAfterMs: 1500`。前端手工演练可以在本地临时改成 `fixture`，结束时用版本管理恢复，不要把 `fixture` 留在提交里。

## 3. 交接面

工厂签名仍以 `.specify/memory/constitution.md`「交接接口」为准。本文不另定义一套工厂。

```javascript
createWake({
  session,
  config,    // 每次 start 重新读取，其中 visionAdapter 为 "off" 或 "fixture"
  preset,    // 仍是预先准备的结果，不是识别样例
  clock,
  onChange,
  attempt    // 仅测试可注入；页面不传
})
```

页面调用 `start`、`cancel`、`exit`、`onPlaybackChange`、`dispose`，只消费 `onChange` 的 `status`、`requestId`、`result`、`currentParameters`、`initialParameters`、`code`、`message`。

### 样例怎么进唤醒

识别样例不进入 `createWake` 的新参数。后端在 `extension/src/preset/load.js` 增加 `loadVisionFixture`，读取 `extension/assets/vision/fixture-parabola.json`。`extension/src/session/wake.js` 在 `visionAdapter === "fixture"` 且 `externalAttempt === "off"` 时自己调用它，再用 `validateCurveResult(candidate, { allowVision: true })`。页面不调用 `loadVisionFixture`，不读取该 JSON。

`extension/src/session/session.js` 的 `copyResult` 必须把 `evidence` 抄进 `getState().result`。缺了这一抄，页面看到的 `evidence` 会是空的。`confidence` 可以原样抄过；页面不展示它。

### 页面只认这些结果

| `status` | `result` 条件 | `#source-label` | `#source-note` | 其他 |
| --- | --- | --- | --- | --- |
| `interactive` | `source` 为 `preset`，`fallback` 为 `null` | 预先准备的示例 | 保持现有预制说明 | 与现在一致 |
| `interactive` | `source` 为 `preset`，`fallback` 为 `timeout` | 预先准备的示例 · 超时回退 | 因等待超过 1.5 秒，改用预先准备的示例。 | 不记入 `vision-decision` |
| `interactive` | `source` 为 `vision`，`fallback` 为 `null`，`evidence` 为 `packaged-sample` | 识别结果 | 随演示打包的识别样例，尚未接通外部识别。 | 记录 `vision-decision` |
| `recoverable-error` | `result` 为 `null`，`code` 为 `external_unavailable` | 保持失败前的来源或「来源不可用」 | 使用 `message`，原文是「外部结果不可用，未进入交互。」 | 显示已有的「重试」「退出」 |

`confidence` 无论缺省还是大于等于 0.5，页面都不显示百分比。

识别耗时由页面在自己调用 `start` 时记下起点，在收到上表最后两行之一时调用现有 `record("vision-decision", ms)` 或 `mark`。仅当本次配置是 `visionAdapter: "fixture"` 且 `externalAttempt: "off"`。不要写入 `fallback-visible`，不要改 `latency.js`。

## 4. 任务归属

| 任务 | 谁写 | 独占文件 |
| --- | --- | --- |
| T001 核对 manifest | 前端核对，不提交改动 | 无 |
| T002 宪法 1.4.0 | 后端，先于 `wake.js` | `.specify/memory/constitution.md`、`plan.md` 的那一行门禁 |
| T003、T004 校验 | 后端 | `tests/vision-validate.test.js`、`extension/src/curve/validate.js` |
| T005、T006 配置 | 后端 | `tests/vision-config.test.js`、`extension/assets/config.json`、`extension/src/preset/load.js` 的开关读取 |
| T007、T008、T010 样例成功 | 后端 | `tests/vision-wake.test.js`、`extension/assets/vision/fixture-parabola.json`、`extension/assets/vision/README.md`、`wake.js`、`load.js` 的 `loadVisionFixture`、`session.js` 的 `copyResult` |
| T009、T011 来源文案 | 前端 | `tests/page-vision.test.js`、`extension/src/page/main.js`、`extension/demo/index.html` |
| T012、T013 拒绝 | 后端 | `tests/vision-reject.test.js`、`wake.js` |
| T014、T015 计时 | 前端 | `tests/vision-latency.test.js`、`main.js` 的打点 |
| T016 边界说明 | 前端 | `docs/frontend-backend-boundary.md` |
| T017 手工验收 | 前端 | `docs/BreakGlass-frontend-validation.md` |
| T018 全量测试 | 合并前由前端跑 `node --test` | 只在自己的测试因新字段失败时改断言；不放宽 001 的预制断言 |

T008 的说明写在 `extension/assets/vision/README.md`：这是夹具，不是正式网课素材，也不代表外部识别已接通。不要往 JSON 里写注释。

## 5. 当天怎么并行

1. 后端先提交 T002。在此之前可以写 T003 和 T005，不要改 `wake.js` 的成功路径。
2. 前端同时写 T009 和演示页文案分支，按第 3 节的表消费 `result`。此阶段不改 `wake.js`、`validate.js`、`load.js`、`session.js`。
3. 后端完成 T004、T006、T008、T010 后，用 `node --test tests/vision-validate.test.js tests/vision-config.test.js tests/vision-wake.test.js` 自检，并告知页面：`getState().result.evidence` 在成功时为 `packaged-sample`。
4. 前端再把 T011 接到真实状态上，并写 T014、T015。后端接着做 T012、T013，仍不进 `extension/src/page/` 和 `extension/demo/`。
5. 前端做 quickstart。第 1 节在开关关闭时连续唤醒 10 次，10 次都只显示「预先准备的示例」。第 5 节确认配置已恢复为 `off`。
6. 前端跑 T018。后端不改页面文件。

## 6. 合并前核对

- 提交里的 `visionAdapter` 仍是 `off`。
- `createWake` 的参数没有新增。
- 页面脚本没有远程地址、上传或模型名。
- 识别失败时 `message` 仍是「外部结果不可用，未进入交互。」，匹配预制没有被画成识别成功。
- `evidence` 能从 `getState().result` 读到，不只存在于校验器的返回值里。
- `vision-decision` 与 `fallback-visible` 分开。
- 未实际点击的手工步骤没有写成通过。

## 7. 这次仍不派发

真实识别请求、单帧上传、感知代理、Pyodide、FastAPI，以及 001 里尚未补记的 T030、T038。
