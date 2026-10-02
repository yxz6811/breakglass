# Tasks: 识别结果适配

**Input**: Design documents from `/specs/002-vision-result-adapter/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/vision-adapter.md, quickstart.md

**Tests**: spec.md FR-014 要求固定夹具先于实现。下列测试任务必须先失败，再写实现。验收命令是 `node --test`。

**Organization**: 故事 1 是默认可演示的识别样例成功路径。故事 2 拒绝坏候选。故事 3 把识别耗时与预制回退分开。上传、感知代理和 Pyodide 不编号。

**进度**: T001–T016、T018 已完成（2026-10-02）。提交配置保持 `visionAdapter: off`。T017 的 quickstart 手工验收**未执行**：当前环境没有可控浏览器会话。修改 `extension/src/session/wake.js` 之前必须先完成 T002。两人同时开发时的写权限和样例装入方式以 [`ownership.md`](./ownership.md) 为准。


**执行记录（2026-10-02）**: 宪法修订到 1.4.0；新增 `visionAdapter`（提交值 `off`）与 `loadVisionFixture`；`validateCurveResult` 增加 `allowVision` 下的 `evidence` / `confidence` 规则；`wake.js` 在 `fixture` + `off` 时按样例自身画幅先校验、再按当前帧装订，失败一律 `external_unavailable`；`session.copyResult` 抄写 `evidence`；页面按 `evidence` 显示「识别结果」并单独记 `vision-decision`。`node --test` 182 项通过。
未执行：T017 的手工演练与 SC-002；包内样例的 `frameSize` 仍需按实际视频改写。
## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其他 `[P]` 任务并行（不同文件、不依赖未完成任务）
- **[Story]**: 用户故事阶段使用 `[US1]`、`[US2]` 或 `[US3]`
- 描述中给出具体文件路径

## Path Conventions

- 扩展代码在 `extension/`
- 纯函数测试在 `tests/`
- 不创建 `backend/`
- 不把任务写回 `specs/001-insitu-parabola/tasks.md`

## Phase 1: Setup

**Purpose**: 确认本切片不扩大扩展表面

- [x] T001 核对 `extension/manifest.json`：`permissions` 与 `host_permissions` 为空；不声明 `content_scripts`；`content_security_policy.extension_pages` 保持 `script-src 'self'; object-src 'self'`；不含 `wasm-unsafe-eval`。本功能不修改这些字段，不新增依赖，不创建 `backend/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 修订交接句子，并让校验与配置能表达识别开关。完成前不改 `extension/src/session/wake.js`

**⚠️ CRITICAL**: 用户故事必须等本阶段完成。T002 未完成时，不得放行 `source: "vision"`

- [x] T002 [P] 将 `.specify/memory/constitution.md` 从 1.3.0 修订为 1.4.0（MINOR：不新增来源枚举，只为已有 `vision` 打开一条开关路径）。更新日期与文末变更记录。在「交接接口」中把配置读取说明改为同时读取 `visionAdapter`。把「`interactive` 时 `result.source` 为 `preset`」改为：`visionAdapter` 缺省或为 `off` 时，`interactive` 的 `result.source` 仍只能是 `preset`，`result.fallback` 为 `null` 或 `"timeout"`；仅当 `visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时，允许 `source` 为 `vision`、`fallback` 为 `null`、`evidence` 为 `packaged-sample`。其他 `visionAdapter` 值视为 `off`。不得改 `createWake` 的方法名、参数顺序或状态名，不得新增错误码。修订后把 `specs/002-vision-result-adapter/plan.md` 的对应门禁从「有条件通过」改为「通过」，并注明版本 1.4.0。不修改 `docs/BreakGlass-constitution.md`（该文件没有写死交互来源只能是 preset）
- [x] T003 [P] 先写会失败的 `tests/vision-validate.test.js`。覆盖：未传 `allowVision: true` 时 `source: "vision"` 拒绝；`allowVision: true` 且 `evidence` 为 `packaged-sample`、`fallback` 为 `null`、`confidence` 缺省时通过；`evidence` 缺失或其他值拒绝；`confidence` 缺省时通过且返回值不含编造的百分比；`confidence` 存在时必须是有限数且 `0 ≤ confidence ≤ 1`，`confidence < 0.5` 拒绝，`confidence >= 0.5` 通过；`source: "preset"` 携带 `evidence` 拒绝；缺字段、非有限数值、越界 region、未知 `equationId`、错误 `videoId` 仍拒绝。`time` 单位为秒，默认容差 ±0.2 秒。参数满足 `min ≤ initial ≤ max` 且 `step > 0`。region 宽高为正且完全落在 frameSize 内。夹具不含密钥、上传地址或模型名
- [x] T004 实现 `extension/src/curve/validate.js`，使 T003 通过。只在 `source === "vision"` 且 `context.allowVision === true` 时接受 vision，并强制 `evidence === "packaged-sample"`、`fallback === null` 与上述 confidence 规则。预制路径仍不要求 `evidence` 或 `confidence`。成功时 `value` 保留原字段，不补写 `confidence`
- [x] T005 [P] 先写会失败的 `tests/vision-config.test.js`。断言 `extension/assets/config.json` 的 `visionAdapter` 为 `off`、`externalAttempt` 为 `off`、`fallbackAfterMs` 为 1500。断言该文件不含密钥、上传地址或模型名。断言 `extension/src/preset/load.js` 把 `visionAdapter` 随配置返回；缺省或其他值按 `off` 处理，不得当成 `fixture`
- [x] T006 更新 `extension/assets/config.json` 与 `extension/src/preset/load.js`，使 T005 通过。新增字段只有 `"visionAdapter": "off"`。读取时缺省或其他值视为 `off`。不在此任务加载识别样例，不新增远程地址

**Checkpoint**: 校验器能放行标明打包样例的 vision，并拒绝缺证据、低置信度和预制夹带 evidence。提交配置仍是关闭。唤醒成功路径尚未改动。

---

## Phase 3: User Story 1 - 用识别样例在原位看到可调节的抛物线 (Priority: P1) 🎯 MVP

**Goal**: `visionAdapter: fixture` 且 `externalAttempt: off` 时，合法打包样例进入原位交互，并全程显示识别样例文案。开关关闭时仍只显示预先准备的示例

**Independent Test**: `extension/assets/config.json` 临时设为 `visionAdapter: fixture`、`externalAttempt: off`，断开网络，按 quickstart.md 第 2 节完成唤醒、拖动、重置和退出。默认配置下的第 1 节仍只显示「预先准备的示例」

### Tests for User Story 1

- [x] T007 [P] [US1] 先写会失败的 `tests/vision-wake.test.js`。注入假时钟，不使用真实 `setTimeout`。覆盖：`visionAdapter` 为 `off` 时立即进入预制交互，`source` 为 `preset`，`fallback` 为 `null`，不出现 vision；`visionAdapter` 为 `fixture`、`externalAttempt` 为 `off`、样例匹配当前 `requestId`、`videoId`、`time` ±0.2 秒和 `frameSize` 时进入 `interactive`，`source` 为 `vision`，`fallback` 为 `null`，`evidence` 为 `packaged-sample`；参数仍满足 `min ≤ initial ≤ max` 且 `step > 0`。调用形状保持 `createWake({ session, config, preset, clock, onChange, attempt })`，页面状态只有 `status/requestId/result/currentParameters/initialParameters/code/message`
- [x] T008 [P] [US1] 编写 `extension/assets/vision/fixture-parabola.json` 与 `extension/assets/vision/README.md`。JSON 的 `source` 为 `vision`，`fallback` 为 `null`，`evidence` 为 `packaged-sample`，`videoId` 含 `fixture`，`equationId` 为 `fixture.parabola`。参数满足 `min ≤ initial ≤ max` 且 `step > 0`，region 宽高为正且完全落在 frameSize 内。不写 `confidence`，JSON 内不写注释。README 写明这不是正式网课素材，也不代表外部识别已接通。文件不含密钥、上传地址或模型名
- [x] T009 [P] [US1] 先写会失败的 `tests/page-vision.test.js`。用 Node 读取 `extension/demo/index.html` 与 `extension/src/page/main.js`，断言存在 `#source-label`，且脚本在 `evidence === "packaged-sample"` 时能呈现「识别结果」和「随演示打包的识别样例，尚未接通外部识别。」。断言这两个文件不出现 `fetch` 的远程地址、`XMLHttpRequest`、`WebSocket`、密钥或模型名。默认 `visionAdapter: off` 的来源分支仍包含「预先准备的示例」

### Implementation for User Story 1

- [x] T010 [US1] 在 T002、T004、T007、T008 之后修改 `extension/src/session/wake.js`、`extension/src/preset/load.js` 和 `extension/src/session/session.js`。`load.js` 新增 `loadVisionFixture`，读取 `extension/assets/vision/fixture-parabola.json`。`wake.js` 在 `visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时自己调用它，再用 `validateCurveResult(..., { allowVision: true })` 检查；通过则进入 `interactive`。`createWake` 不新增参数，`preset` 仍是预先准备的结果。`session.js` 的 `copyResult` 必须把 `evidence` 抄进 `getState().result`。`visionAdapter` 为 `off`、缺省或其他值时保持现有预制路径。保留单会话、拖动钳制、重置、退出，以及播放或离开目标时间时结束会话。不把样例等待 1500ms，不发起网络请求
- [x] T011 [US1] 在 T009 与 T010 之后修改 `extension/src/page/main.js` 与 `extension/demo/index.html`。`#source-label` 在 `source === "vision"` 且 `evidence === "packaged-sample"` 时显示「识别结果」；说明区显示「随演示打包的识别样例，尚未接通外部识别。」。无论 `confidence` 缺省还是大于等于 0.5，都不显示百分比。预制与超时文案保持「预先准备的示例」「预先准备的示例 · 超时回退」「因等待超过 1.5 秒，改用预先准备的示例。」。不把空格设为破壁键

**Checkpoint**: 关闭开关时与 001 的预制主路径一致。打开开关且样例合法时，离线可见识别样例曲线。坏候选尚未在本阶段验收。

---

## Phase 4: User Story 2 - 不合格的识别候选不会变成成功 (Priority: P2)

**Goal**: 缺证据、低置信度、帧不匹配和非法形状都进入可恢复错误。匹配预制不得被画成识别成功。非 `off` 的外部演练优先于识别样例

**Independent Test**: `visionAdapter: fixture` 且 `externalAttempt: off` 时，分别使用无 `evidence`、`confidence` 为 0.49、错误 `videoId` 的候选。三次都不绘制。再把 `externalAttempt` 设为 `hang`，确认走 1500ms 预制回退而不是识别样例

### Tests for User Story 2

- [x] T012 [P] [US2] 先写会失败的 `tests/vision-reject.test.js`。覆盖：`evidence` 不是 `packaged-sample`、`confidence < 0.5`、`confidence` 非有限、region 越界、`videoId` 或 `time` 超出 ±0.2 秒或 `frameSize` 不一致时，状态为 `recoverable-error`，`code` 为 `external_unavailable`，`message` 为「外部结果不可用，未进入交互。」，`result` 为 `null`，且不进入 `interactive`。当前存在匹配预制时也不得绘制该预制。`visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `hang`、`invalid` 或 `late` 时，不得进入 `source: "vision"`。取消、退出或离开目标时间后，旧 `requestId` 不得打开交互。`fallbackAfterMs` 仍是 1500

### Implementation for User Story 2

- [x] T013 [US2] 在 T010 与 T012 之后收紧 `extension/src/session/wake.js`，使 T012 通过。识别校验失败时只调用 `fail("external_unavailable", "外部结果不可用，未进入交互。")`。不得在该失败上调用预制接受。`externalAttempt` 不是 `off` 时忽略识别样例，沿用现有等待、非法、迟到和超时回退。不新增 `code` 或 `message`

**Checkpoint**: 坏样例可重试或退出，0 次被画成识别成功。`hang` 仍在 1500ms 后显示预制超时回退。

---

## Phase 5: User Story 3 - 识别耗时不混进预制回退 (Priority: P3)

**Goal**: 识别路径只记录 `vision-decision`。预制回退仍只记录 `fallback-visible`。演练后配置回到 `off`

**Independent Test**: 一次识别成功和一次识别失败都产生 `vision-decision`，且 `summary()` 里没有把该毫秒数写入 `fallback-visible`。`visionAdapter: off` 加 `externalAttempt: hang` 时仍只走预制回退计时

### Tests for User Story 3

- [x] T014 [P] [US3] 先写会失败的 `tests/vision-latency.test.js`。识别路径从判定开始到 `interactive` 或 `recoverable-error` 调用 `extension/src/telemetry/latency.js` 的 `record("vision-decision", ms)` 或等价的 `mark` 组合。断言不调用 `extension-open`、`video-first-frame`、`network-wait`、`p1-init`。断言识别成功或失败的样本不出现在 `fallback-visible`。记录只含名称、毫秒数和 `hot` 或 `cold`。`visionAdapter: off` 且超时回退时，`fallback-visible` 行为与现有 `extension/src/page/main.js` 一致

### Implementation for User Story 3

- [x] T015 [US3] 在 T011 与 T014 之后修改 `extension/src/page/main.js`，使 T014 通过。只在识别路径实际运行时记录 `vision-decision`。识别成功不得同时写入 `fallback-visible`。不改 `extension/src/telemetry/latency.js` 的排除名单，不落盘，不写 `chrome.storage` 或 `indexedDB`

**Checkpoint**: 两组成对耗时可以分开读取。默认配置不再显示「识别结果」。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 边界说明与手工验收记录。未运行的步骤不得写成通过

- [x] T016 [P] 在 `docs/frontend-backend-boundary.md` 标明：本切片的 `source: "vision"` 只表示 `evidence: "packaged-sample"` 的打包样例，不表示外部接口已返回，也不表示单帧已离开浏览器。真实上传仍是未批准的外部依赖
- [ ] T017 按 `specs/002-vision-result-adapter/quickstart.md` 第 1 至第 5 节做手工验收，把实际操作与结果写入 `docs/BreakGlass-frontend-validation.md`。记录浏览器、是否断网，以及配置已恢复为 `visionAdapter: off`、`externalAttempt: off`、`fallbackAfterMs: 1500`。未点击的步骤保持未通过
- [x] T018 运行 `node --test`。若 `tests/preset-contract.test.js`、`tests/page-integration.test.js` 或 `tests/wake-contract.test.js` 因新增字段失败，只修正断言，使默认配置仍要求 `visionAdapter` 为 `off`、`externalAttempt` 为 `off`、`fallbackAfterMs` 为 1500。不放宽 001 已有的预制、超时和来源断言

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1。T002 挡住所有会放行 vision 的唤醒改动
- **User Story 1 (Phase 3)**: 依赖 Phase 2
- **User Story 2 (Phase 4)**: 依赖故事 1 的 `createWake` 识别入口
- **User Story 3 (Phase 5)**: 依赖故事 1 的页面来源分支。可在故事 2 的失败路径完成后补失败样本，但测试文件独立
- **Polish (Phase 6)**: 依赖要验收的故事。T016 可在契约冻结后先行

### User Story Dependencies

- **User Story 1 (P1)**: 只依赖 Foundational。不依赖故事 2 或故事 3
- **User Story 2 (P2)**: 依赖故事 1 已经把合法样例送入 `wake.js`。拒绝路径可单独用 `tests/vision-reject.test.js` 验收
- **User Story 3 (P3)**: 依赖故事 1 的页面接线。不依赖故事 2 的全部拒绝种类；至少需要一次成功结算才能记下 `vision-decision`

### Within User Story 1

- T003 先于 T004
- T005 先于 T006
- T002、T003、T005 可并行
- T007、T008、T009 可在 Phase 2 完成后并行
- T010 先于 T011
- T002 先于 T010

### Within User Story 2

- T012 先于 T013
- T013 与 T010 同改 `extension/src/session/wake.js`，必须在 T010 之后

### Within User Story 3

- T014 先于 T015
- T015 与 T011 同改 `extension/src/page/main.js`，必须在 T011 之后

### Parallel Opportunities

- T002、T003、T005 可并行
- T007、T008、T009 可并行
- T012 可与 T014 并行（不同测试文件），但 T013 与 T015 分别等待各自的实现前置
- T016 可与 T018 的断言整理并行；T017 的手工点击不能提前

---

## Parallel Example: User Story 1

```bash
# Phase 2 可同时写：
# tests/vision-validate.test.js
# tests/vision-config.test.js
# .specify/memory/constitution.md

# Phase 2 完成后可同时准备：
# tests/vision-wake.test.js
# tests/page-vision.test.js
# extension/assets/vision/fixture-parabola.json
```

---

## Parallel Example: User Story 2 与 User Story 3

```bash
# 故事 1 的 wake.js 与 main.js 接线完成后，两份失败测试可同时写：
# tests/vision-reject.test.js
# tests/vision-latency.test.js
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 T001–T006。T002 未合并前停止在校验与配置，不改唤醒成功路径
2. 完成 T007–T011
3. **停下来验收** quickstart.md 第 1 节和第 2 节
4. 再做故事 2 的拒绝路径
5. 最后分开计时，并按第 5 节把配置改回 `off`

### Incremental Delivery

1. Foundational 让非法 vision 仍被拒绝，合法样例只在测试里通过校验
2. 故事 1 提供可离线演示的识别样例
3. 故事 2 保证坏候选不会变成成功
4. 故事 3 保证耗时不混入 `fallback-visible`

---

## Notes

- `[P]` 表示不同文件且不依赖未完成任务
- 夹具视频和 `fixture.parabola` 只用于工程验证
- 不要把 `visionAdapter: fixture` 做成上传或真实识别请求
- 不要新增 `createWakeController`、`onOutcome` 或新的 `fail` 错误码
- 验收命令是 `node --test`。本功能不新增打包器
