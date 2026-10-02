# Research: 识别结果适配

**Feature**: `002-vision-result-adapter`  
**Date**: 2026-10-02

本文件解决计划阶段的范围与治理问题。没有留下 NEEDS CLARIFICATION。

## 1. 单独立项，不续写 001 的任务号

- **Decision**: 新目录 `specs/002-vision-result-adapter/`。`specs/001-insitu-parabola/tasks.md` 保持 T001–T039，不追加识别任务。
- **Rationale**: 001 写明真实识别、上传、感知代理和 Pyodide 不编号。识别适配是产品 P1 的独立切片，有自己的开关和验收。
- **Alternatives considered**: 在 001 从 T040 续写。会把未批准的上传和已收口的预制主路径混在同一份任务清单里。

## 2. 本切片只做打包样例，不上传

- **Decision**: 识别候选只来自扩展包内 JSON。不新增上传地址、主机权限、内容脚本或远程脚本。感知代理不放进本仓库。
- **Rationale**: `.specify/memory/constitution.md` 原则 II 仍记录「单帧是否允许离开浏览器尚未确认」。`AGENTS.md` 仍规定本仓库只做前端。
- **Alternatives considered**: 先做上传接口并用空密钥占位。这会在书面允许之前把帧送出浏览器。

## 3. 开关与现有演练正交

- **Decision**: 配置新增 `visionAdapter`，只允许 `off` 或 `fixture`。缺省或其他值视为 `off`，不得视为 `fixture`。提交的 `extension/assets/config.json` 写 `"visionAdapter": "off"`。`externalAttempt` 仍只有 `off`、`hang`、`invalid`、`late`，且提交值保持 `off`。`fallbackAfterMs` 仍必须是 1500。
- **Rationale**: 用新字段表示识别适配，避免把第五种 `externalAttempt` 写进已冻结的会话构造参数。
- **Alternatives considered**: 把 `vision` 加进 `externalAttempt`。那会改 `SessionController` 的构造约定，并让超时演练和识别成功共用一个旋钮。

## 4. 两种非 off 同时出现时，演练优先

- **Decision**: 仅当 `visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时，才走识别样例。若 `externalAttempt` 不是 `off`，忽略识别样例，继续现有等待、非法、迟到或超时回退。
- **Rationale**: 故事 2 的超时演练必须还能单独验收。两套结果同时生效会产生第二层交互。
- **Alternatives considered**: 打开识别适配后禁止 `hang`。验收时就要同时改两个开关，预制回退口径容易被带偏。

## 5. 来源字段与诚实文案

- **Decision**: 识别成功时 `source` 为 `vision`，`fallback` 为 `null`，`evidence` 为 `packaged-sample`。缺少 `evidence` 或取值不是 `packaged-sample` 的 `vision` 候选必须拒绝。界面全程显示「识别结果」和「随演示打包的识别样例，尚未接通外部识别。」预制成功文案不变：「预先准备的示例」；超时回退仍是「预先准备的示例 · 超时回退」与「因等待超过 1.5 秒，改用预先准备的示例。」
- **Rationale**: `source` 只允许 `vision` 或 `preset`。打包样例若写成 `preset`，就把识别演练说成预先准备。若写成 `vision` 却不标明样例，就会把未接通的服务说成已经识别成功。
- **Alternatives considered**: 新增 `source: "fixture"`。治理文档不允许第三种来源。

## 6. 可信程度

- **Decision**: `confidence` 可选。缺省时不拒绝，界面不显示百分比。若存在，必须是有限数且 `0 ≤ confidence ≤ 1`；`confidence < 0.5` 拒绝。不把 0.5 写成模型准确率。
- **Rationale**: 原则 III 要求低于约定置信度时拒绝，且不得编造准确率。0.5 写进规格假设，实现不得另选门槛。
- **Alternatives considered**: 缺省置信度一律拒绝。打包样例就被迫编造一个数字才能演示。

## 7. 失败句不新增错误码

- **Decision**: 识别候选被拒绝时调用现有 `fail("external_unavailable", "外部结果不可用，未进入交互。")`。`result` 为 `null`。不新增 `code`，不改这句 `message`。匹配预制不得在这次失败里自动进入交互。
- **Rationale**: 交接接口规定可恢复错误只用现有三行文案。页面显示 `message`，不得按 `code` 再写一套话术。
- **Alternatives considered**: 为低置信度、缺字段、帧不匹配各写一句。那要先改治理文档的错误表，本切片不需要用户区分这三类。

## 8. 交互来源句子必须先修订

- **Decision**: 实现唤醒行为之前，先修订 `.specify/memory/constitution.md`（1.3.0 → 1.4.0）。2026-10-02 已写入 1.4.0，代码尚未改 `wake.js`。只放宽这一处：`visionAdapter` 缺省或 `off` 时，`interactive` 的 `result.source` 仍只能是 `preset`，`fallback` 仍为 `null` 或 `"timeout"`。`visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时，允许 `source` 为 `vision`、`fallback` 为 `null`、`evidence` 为 `packaged-sample`。`createWake` 的配置读取列表加入 `visionAdapter`。工厂名、方法名、参数顺序和状态名不变。`docs/BreakGlass-constitution.md` 没有写死「交互来源只能是 preset」的句子，本决策不要求升它的版本。
- **Rationale**: 交接接口现在写明交互态来源是 `preset`。不修订就让 `vision` 进入交互，属于另写一套状态。修订文本先冻结在本文件，避免实现时临时改口径。
- **Alternatives considered**: 把该句子解释成「P0 才适用」而不改文件。分析命令把这种解释视为稀释治理约束。

## 9. 技术路线与计时

- **Decision**: 继续 Vanilla JS、原生 CSS/SVG、无打包器、无 Pyodide。不放宽 CSP，不加 `wasm-unsafe-eval`。识别判定用现有内存计时，名称为 `vision-decision`。不得使用 `extension-open`、`video-first-frame`、`network-wait`、`p1-init`。不得写入 `fallback-visible`。样例在本地校验通过后立即进入交互，不人为等待 1500ms。
- **Rationale**: 宪法把 Pyodide 定为另一条 P1，并要求其初始化耗时不混入预制指标。现有 `latency.js` 会拒绝上述四个名称。
- **Alternatives considered**: 为了让取消按钮在识别路径上可见而故意延迟样例。取消已经由 001 的等待演练覆盖；本切片的成功路径保持即时。

## 10. 校验入口

- **Decision**: 仍用 `validateCurveResult`。只有识别路径传入 `allowVision: true`。`source: "vision"` 在 `allowVision` 不为 true 时继续拒绝。预制 JSON 不新增 `evidence` 或 `confidence`。
- **Rationale**: 原则 III 要求同一适配器。001 的夹具已经锁定「未允许时拒绝 vision」。
- **Alternatives considered**: 为识别样例新写一个校验函数。失败条件会和预制分叉。
