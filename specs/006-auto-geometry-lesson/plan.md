# Implementation Plan: 几何实验自动阅读

**Branch**: `yxz`（未新建功能分支；规格目录 `006-auto-geometry-lesson`） | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-auto-geometry-lesson/spec.md`

**Status**: 替身实现已落地。T018 的真实模型、热缓存 20 次、四类画幅和 Chrome 扩展内完整加载仍未验收。

## Summary

做一个与曲线演示并列的几何阅读入口。学习者选择自己的视频并填好阅读地址后，片子可播放即稀疏抽取最多 8 帧，交给既有本地 reader 的新阅读接口。每一帧只收下一个条件写清的直角三角形、圆或线段。第一处通过后暂停，破壁只取出已存结果，在暂停画面上调节一项允许条件。斜边由程序计算。失败留在学习者的片子上。

这条路径不修改 `POST /read`、`POST /geometry/read`、`CurveResult`、`createWake` 或 005 工作台。

## Technical Context

**Language/Version**: 浏览器侧沿用现有 Vanilla JavaScript；reader 沿用 Node.js ≥ 22.9，无新运行时依赖。

**Primary Dependencies**: 现有 `breakglass-reader` 的 OpenAI 兼容视觉调用、JPEG 尺寸检查和来源白名单。不新增 npm 包、打包器或绘图库。

**Storage**: 无。阅读结果只留在当次页面内存。reader 不落盘。

**Testing**: 现有 `node --test`。实施时先写会失败的页面、结果和 reader 替身测试。本计划不执行这些测试，也不把替身通过写成真实模型验收。

**Target Platform**: 现有演示页与 Chrome MV3 扩展所加载的同一套静态页面。不新增主机权限、content script 或远程脚本。

**Performance Goals**: 整段阅读截止 300000ms。破壁只取已存结果，等待上限仍是 1500ms，且不修改曲线演示的 `fallbackAfterMs`。已存结果从点击到几何层出现的热状态目标为至少 20 次、P95 ≤ 100ms；该记录目前没有，SC-005 保持未通过。

**Constraints**: 一帧一个图形；像素不算长度；密钥只在 reader 环境；单次离开浏览器的只有可空课程说明和最多 8 张宽不超过 640 的 JPEG；请求体上限 10MiB，与 `/read` 相同，不放宽 `/geometry/read` 的 4MiB。

**Scale/Scope**: 一个新演示入口、一条新阅读契约、一套独立会话。不覆盖提问、理解题、一般三角形、矩形或抛物线。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

依据 Spec Constitution 2.2.0 原则 XIV 与产品 Constitution 2.2.0。原则 X 是策略准入，不是本功能。

| 门禁 | 结果 |
| --- | --- |
| 不抬高抛物线 P0，不加长 1500ms | 通过。006 使用自己的会话，不进入 `createWake`。 |
| 不把多对象识别放进交付 | 通过。一帧多于一个完整白名单图形时整帧丢掉。 |
| 服务端只是无状态感知代理 | 通过。只扩展既有 `breakglass-reader/`，无数据库、账号和云端执行。 |
| 模型只产候选，数学在程序内 | 通过。斜边用 `Math.hypot`。模型给出的斜边不能成为答案。 |
| Schema 与模型指令留在 reader | 通过。页面不能提交 prompt、模型名或 schema。 |
| 密钥不进浏览器、仓库和日志 | 通过。沿用 reader 环境变量。 |
| 失败不伪装成预设成功 | 通过。空地址、失败和超时保留用户视频。 |
| 不改原则 VII / VIII / IX 的触发与契约 | 通过。新接口、新页面、新会话。 |
| 原则 XIV 已写入治理文件 | 通过。2026-10-06 合并后记入 Spec Constitution 2.2.0、产品 Constitution 2.2.0 和 `AGENTS.md` 第 0 节。 |

Phase 0 前无未记录的例外。设计后的复核见文末。

## Project Structure

### Documentation (this feature)

```text
specs/006-auto-geometry-lesson/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── geometry-lesson-result.md
│   └── geometry-lesson-service.md
├── checklists/requirements.md
└── spec.md
```

`tasks.md` 不在本次规划内。

### Source Code (repository root)

```text
extension/demo/geometry-lesson.html          # 新入口；曲线演示与 005 几何实验的链接保留
extension/demo/geometry-lesson.css           # 沿用现有演示视觉，不另起一套主题
extension/src/geometry-lesson/reading.js     # 采样复用、点校验、第一处与下一个
extension/src/geometry-lesson/solve.js       # 斜边、圆半径和线段长度的确定性更新
extension/src/geometry-lesson/session.js     # 独立会话、帧代次和调节
extension/src/geometry-lesson/view.js        # 暂停画面上的 SVG 层
extension/src/page/geometry-lesson.js        # 选片、自动阅读、破壁、下一个
extension/src/lesson/reading.js              # 只读复用 sampleTimes；不改 003 行为
extension/src/session/wake.js                # 不修改
extension/demo/geometry.html                 # 005 工作台不修改
extension/src/page/main.js                   # 曲线演示不修改
breakglass-reader/src/server.mjs             # 注册新路由；不改 /read 与 /geometry/read 的上限
breakglass-reader/src/geometry-lesson.mjs    # 批量请求校验与逐帧收下
breakglass-reader/src/geometry-lesson-model.mjs
tests/geometry-lesson-reading.test.js
tests/geometry-lesson-page.test.js
breakglass-reader/tests/geometry-lesson.test.mjs
```

**Structure Decision**: 沿用 `extension/` 与 `breakglass-reader/`。006 的页面和会话与曲线演示、005 工作台分开，避免两套阅读共用一个状态。采样时刻的纯函数继续用 `BreakGlass.lesson.sampleTimes`，校验和存储用新的几何点，不把几何点送进 `validateLessonReading`。

## Complexity Tracking

无宪法例外需要登记。新路由是原则 XIV 写明的既有 reader 扩展，不是第二套识别服务。

## 设计后的宪法复核

Phase 1 契约仍满足上表：结果不进入 `CurveResult`；破壁不调用 `createWake`；`/geometry/read` 保持单帧、显式触发和 4MiB；`/read` 仍只收抛物线。热缓存 20 次与真实模型正确率在 quickstart 中保持未通过，不把计划写成验收。

若白名单要扩大，先修订原则 XIV 的宪法版本，再改规格、契约和任务。
