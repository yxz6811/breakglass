# Implementation Plan: 识别结果适配

**Branch**: `002-vision-result-adapter` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-vision-result-adapter/spec.md`

## Summary

在现有 Chrome MV3 扩展里增加默认关闭的识别适配。打开且外部演练为 `off` 时，用扩展包内的识别样例走同一个 `CurveResult` 校验；通过后在原位交互，并持续标明这是尚未接通外部服务的打包样例。关闭时，001 的预制、等待、超时回退和来源文案保持不变。不上传单帧，不建代理，不引入 Pyodide。

## Technical Context

**Language/Version**: JavaScript（浏览器与 Node.js 20+ 的纯函数测试），无 TypeScript、无打包步骤

**Primary Dependencies**: 无新运行时依赖。复用 Chrome MV3、HTML5 video、原生 SVG，以及 001 的 `createWake`、`validateCurveResult` 和内存计时。不使用 Preact、Tailwind、Pyodide、绘图库或 FastAPI

**Storage**: 扩展包内静态 JSON。识别样例与预制结果都在包内。会话和 `vision-decision` 计时只留在内存。无数据库

**Testing**: `node --test`。先写会失败的夹具，再改实现。扩展页按 [quickstart.md](./quickstart.md) 手工验收。提交配置的 `visionAdapter` 保持 `off`

**Target Platform**: Chrome 当前稳定版，未打包 MV3 扩展。已验证页面仍是扩展内演示页

**Project Type**: browser extension

**Performance Goals**: 合法打包样例在本地校验通过后进入交互，不人为等待。识别判定耗时单独记为 `vision-decision`，不进入 `fallback-visible`。预制回退仍是判定超时到首个可见 SVG 帧，热缓存 P95 ≤ 100ms，不含本切片

**Constraints**: `fallbackAfterMs` 必须是 1500。`time` 单位为秒，容差 ±0.2 秒。`confidence` 若存在则是有限数且 0 ≤ confidence ≤ 1，低于 0.5 拒绝。扩展不加载远程代码，不加主机权限，不放宽 WASM CSP。同一时刻只有一个覆盖层

**Scale/Scope**: 一个已验证演示页、一份打包识别样例、一条抛物线。不含上传、感知代理、Pyodide、任意网站和第二种曲线

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

对照 [Spec Constitution 2.1.0](../../.specify/memory/constitution.md) 与 [产品 Constitution 2.1.0](../../docs/BreakGlass-constitution.md)。002 仍只做包内识别样例的前端适配，不继承其他切片的 reader 或上传范围。

2026-10-06 治理复核：保留 `CurveResult/createWake`、1500ms 保底、默认关闭开关及独立识别计时；PR #63 不批准真实识别、形状泛化或新增端点。下文 1.4.0 / T002 是来源门禁的历史修订依据，验收仍以本切片记录为准。

| 门禁 | 结果 | 依据 |
| --- | --- | --- |
| P0 离线演示不被本切片抬高门槛 | 通过 | 默认 `visionAdapter: off`；`externalAttempt` 仍为 `off`；1500ms 不改 |
| 技术路线只选一条 | 通过 | 沿用 Vanilla JS + 原生 CSS/SVG |
| MV3 权限、service worker 与 CSP 保持现有表面 | 通过 | 不改 `extension/manifest.json` 的空权限、无内容脚本、`script-src 'self'`；不加 `wasm-unsafe-eval` |
| 不在本仓库实现感知代理或上传 | 通过 | 无端点、无密钥、无帧离开浏览器 |
| 密钥不进入浏览器包 | 通过 | 样例与配置不含密钥、上传地址或模型名 |
| 同一校验器，`time` 单位为秒 | 通过 | 识别路径只给 `validateCurveResult` 增加 `allowVision: true` |
| 失败与超时不作识别成功 | 通过 | 拒绝走 `external_unavailable`；预制超时文案不变 |
| P1 单独开关 | 通过 | `visionAdapter` 默认 `off` |
| 零侵入与已验证页面 | 通过 | 仍只覆盖扩展内演示页视频 |
| 不另建唤醒工厂或第二套状态名 | 通过 | 仍是 `createWake`；状态仍是 `paused-ready`、`waiting`、`interactive`、`recoverable-error` |
| 交互态来源在开关打开时允许 `vision` | 通过 | `.specify/memory/constitution.md` 已修订为 **1.4.0**（T002 完成）：`visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时允许 `source: vision` + `fallback: null` + `evidence: packaged-sample`；默认 `off` 时仍只允许 `preset` |

无未解决的 NEEDS CLARIFICATION。[research.md](./research.md) 已写明修订句子。

## Project Structure

### Documentation (this feature)

```text
specs/002-vision-result-adapter/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── vision-adapter.md
├── checklists/requirements.md
└── tasks.md             # 由 /speckit-tasks 生成，本命令不创建
```

### Source Code (repository root)

```text
extension/
├── manifest.json                          # 不改权限与 CSP
├── assets/
│   ├── config.json                        # 增加 visionAdapter: off
│   └── vision/fixture-parabola.json       # 打包识别样例
├── src/
│   ├── curve/validate.js                  # allowVision 时检查 evidence 与 confidence
│   ├── preset/load.js                     # 读取 visionAdapter；按键装入样例
│   ├── session/wake.js                    # 在修订宪法之后接入样例
│   ├── page/main.js                       # 来源文案与 vision-decision
│   └── telemetry/latency.js               # 不改排除名单；调用方使用新名称
└── demo/index.html                        # 来源区域能显示识别样例说明

tests/
├── vision-validate.test.js
├── vision-wake.test.js
└── page-vision.test.js
```

**Structure Decision**: 沿用 `extension/` 与根目录 `tests/`。不建立 `backend/`。识别样例用现有本地 JSON 读取，页面脚本不新增远程地址。001 的规格目录只在治理修订需要引用时被读到，不把本功能任务写回 001。

## Post-Design Constitution Check

Phase 1 契约没有新增端点、密钥、第二种工厂或 WASM。`vision-adapter.md` 把 `evidence: "packaged-sample"` 定为进入交互的必要条件，因此界面不能把样例说成外部服务已接通。

交互态允许 `source: "vision"` 的历史门禁修订为宪法 1.4.0，已由 T002 完成；当前 2.1.0 延续包内 `packaged-sample` 约束。该修订不证明外部服务接通，也不改变 001 的预制与超时路径。

## Complexity Tracking

下表保留 1.4.0 修订前的历史理由；该治理问题已由 T002 收敛，不代表当前仍有未批准例外。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 交接接口写明 `interactive` 时 `result.source` 为 `preset` | 合法识别样例必须显示「识别结果」，不能显示成预先准备的示例 | 把样例标成 `preset` 会违反「识别与预制来源必须能区分」；不修订文件就放行 `vision` 等于另写状态。研究结论 8 给出 1.4.0 的替换句子，并禁止在修订前改唤醒成功路径 |
