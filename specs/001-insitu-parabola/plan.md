# Implementation Plan: 原位抛物线破壁

**Branch**: `001-insitu-parabola` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-insitu-parabola/spec.md`

## Summary

在 Chrome MV3 扩展自带的演示页上，把一段固定机位视频里的抛物线变成可拖动的原位曲线。播放、定位、绘制、调参、重置和退出是真实交互；曲线数据来自标明来源的准备结果，断网也能完成。技术路线是 Vanilla JS 与原生 CSS/SVG，不建 FastAPI，也不把真实识别列入本次验收。

## Technical Context

**Language/Version**: JavaScript（浏览器与 Node.js 20+ 的纯函数测试），无 TypeScript、无打包步骤

**Primary Dependencies**: 无运行时依赖。Chrome MV3、HTML5 video、原生 SVG。不使用 Preact、Tailwind、Pyodide、绘图库或 FastAPI

**Storage**: 扩展包内静态 JSON 与视频文件。会话只留在内存。无数据库、无账号存储

**Testing**: `node --test` 覆盖几何、校验和会话规则；扩展页按 [quickstart.md](./quickstart.md) 手工验收

**Target Platform**: Chrome 当前稳定版，未打包 MV3 扩展。已验证页面是扩展内演示页

**Project Type**: browser extension

**Performance Goals**: 主路径 90 秒内完成。外部尝试超时后，热缓存条件下从判定超时到曲线出现 P95 ≤ 100ms。该数字不含扩展打开、视频首帧和后续增强初始化

**Constraints**: 准备路径离线可用。回退等待 1500ms。对齐误差不超过视频内容区域较短边的 2%。扩展不加载远程代码。单次只有一个覆盖层。退出后视频保持暂停

**Scale/Scope**: 一条抛物线、一个已验证演示页、一套准备结果。不含代码执行、三次曲线、任意网站和第二条物理演示

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

对照 `docs/BreakGlass-constitution.md` v1.1.0（仓库前端执行基线）。`.specify/memory/constitution.md` v1.2.0 是 Spec Kit 治理记忆，其感知代理约束不属于本仓库交付范围。

| 门禁 | 结果 | 依据 |
| --- | --- | --- |
| P0 可离线演示，不依赖自建服务 | 通过 | 准备结果随扩展打包；无 FastAPI |
| 技术路线只选一条 | 通过 | Vanilla JS + 原生 CSS/SVG |
| MV3 权限、service worker 与 CSP 写入计划 | 通过 | [contracts/extension-surface.md](./contracts/extension-surface.md) |
| 不在本仓库实现感知代理 | 通过 | 无上传、无密钥、无服务进程 |
| 密钥不进入浏览器包 | 通过 | 配置与结果契约都不含密钥 |
| 结果先校验，`time` 单位写明 | 通过 | 秒；见 [contracts/curve-result.md](./contracts/curve-result.md) |
| 超时结果不作识别成功 | 通过 | 来源文案与 `fallback: timeout` |
| 准备开关显式配置 | 通过 | [contracts/runtime-config.md](./contracts/runtime-config.md) |
| P1 的 Pyodide / 真实识别不混入验收 | 通过 | 不放宽 WASM CSP，不实现上传 |
| 零侵入与三套坐标 | 通过 | 只覆盖扩展内视频；帧像素、数学坐标、页面坐标分开 |
| 固定夹具能拒绝非法结果并放行合法抛物线 | 通过 | `node --test` 与 CurveResult 夹具 |

无需要辩护的宪法违例。

## Project Structure

### Documentation (this feature)

```text
specs/001-insitu-parabola/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── curve-result.md
│   ├── runtime-config.md
│   └── extension-surface.md
└── tasks.md             # 由 /speckit-tasks 生成，本命令不创建
```

### Source Code (repository root)

```text
extension/
├── manifest.json
├── demo/
│   ├── index.html
│   └── demo.css
├── src/
│   ├── background/service-worker.js
│   ├── page/main.js
│   ├── session/session.js
│   ├── session/wake.js            # P2：冻结上下文、1500ms 看门狗、取消、迟到丢弃、createWake
│   ├── attempt/simulator.js       # P2：off / hang / invalid / late 确定性替身
│   ├── telemetry/latency.js       # P2：内存计时与 P50/P95
│   ├── geometry/content-rect.js
│   ├── geometry/alignment.js      # P3：三层坐标、偏差比例与 2% 采样
│   ├── curve/evaluate.js
│   ├── curve/validate.js
│   └── preset/load.js
└── assets/
    ├── config.json
    ├── presets/
    └── video/

tests/                        # node --test：校验、求值、几何、会话、等待、页面契约
├── validate.test.js、evaluate.test.js、preset-contract.test.js
├── content-rect.test.js、alignment.test.js
├── session.test.js、backend-edges.test.js
├── wake-timeout.test.js、wake-contract.test.js、external-simulator.test.js
├── page-integration.test.js、page-p2.test.js、page-p3.test.js
└── helpers/fake-clock.js、helpers/fake-page.js
```

**Structure Decision**: 扩展与纯函数测试分开放。几何、校验和会话不依赖 DOM，以便 `node --test`。演示页是 P0 唯一已验证页面。不建立 `backend/`。正式视频文件在团队提供前不提交占位媒体冒充验收素材。

## Post-Design Constitution Check

Phase 1 契约没有新增端点、密钥或第二种技术路线。感知代理仍未开工。上表门禁在设计之后仍然通过。

## Complexity Tracking

无宪法违例，不填写辩护表。
