# Implementation Plan: 开播前阅读

**Branch**: `003-preplay-lesson-points` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-preplay-lesson-points/spec.md`

**Note**: 本命令只更新设计。不改 `extension/src` 的行为。SC-003、SC-004、SC-005 在记录出现之前保持未通过。

## Summary

片子可以播放时自行开始稀疏阅读，最多 8 处，整段截止 5 分钟。第一处 `CurveResult` 通过后暂停在该帧。破壁和「下一个」只取出已经存好的点。定位未落定前破壁禁用。尺寸不符的点丢掉，不用 `breakglass-demo-9s.mp4` 上的预制曲线顶上。读失败、断网或 5 分钟内无一处通过时，回到这支预先准备的片子。点击破壁到覆盖层出现仍要求热缓存至少 20 次、P95 ≤ 100ms，并与第一处耗时分开。破壁后的 `contentRect` 与 `maxRatio` ≤ 0.02 尚无记录。

## Technical Context

**Language/Version**: JavaScript（浏览器与 Node.js 20+ 的纯函数测试），无 TypeScript、无打包步骤

**Primary Dependencies**: 无新运行时依赖。复用 Chrome MV3、HTML5 video、原生 SVG，以及 001 的 `createWake`、`validateCurveResult`、`contentRect` 和内存计时。不使用 Preact、Tailwind、Pyodide 或新的服务端框架

**Storage**: 阅读中的点、课程文本、画面和地址只留在当次页面内存。`extension/assets/config.json` 不写地址或密钥。无数据库，不写 `chrome.storage`

**Testing**: `node --test`。先写会失败的夹具，再改实现。演示页按 [quickstart.md](./quickstart.md) 手工核对。计时与 2% 记录未齐时，quickstart 对应步骤保持未通过

**Target Platform**: Chrome 当前稳定版。未打包 MV3 扩展内的演示页，以及同一页经由本地静态服务打开的网页。已验证页面仍是 `extension/demo/index.html`

**Project Type**: browser extension

**Performance Goals**: 两个数分开。`lesson-first-point` 记录从片子可播放到第一处校验通过，允许直到 300000ms。`lesson-wake-visible` 记录从破壁点击到覆盖层出现，仅在结果已存好的热状态下取样，至少 20 次，P95 ≤ 100ms。两者都不得写入 `fallback-visible`。`fallbackAfterMs` 仍是 1500

**Constraints**: 采样最多 8 处，相邻至少 1 秒，短于 2 秒只采 1 处。课程文本最长 8000 字。不得发送整段视频。`result.source` 仍只允许现有枚举。尺寸不符不得替换成 `presetKey: demo-parabola` 的曲线。扩展不加载远程代码，不加主机权限，不放宽 CSP

**Scale/Scope**: 一个已验证演示页、一支预先准备片子 `../assets/video/breakglass-demo-9s.mp4`、另一支地址不同的验收片子、一条抛物线。不含幻灯片、测验、语音、感知代理和 Pyodide

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

对照 `.specify/memory/constitution.md` 1.6.0 与 `docs/BreakGlass-constitution.md` 1.4.0。本仓库仍只做前端。

| 门禁 | 结果 | 依据 |
| --- | --- | --- |
| P0 离线演示不被本切片抬高门槛 | 通过 | 预先准备片子上的单点演示保留；失败才回到该片子 |
| 技术路线只选一条 | 通过 | 沿用 Vanilla JS + 原生 CSS/SVG |
| MV3 权限与 CSP 保持现有表面 | 通过 | 不改 `extension/manifest.json` |
| 不在本仓库实现阅读服务或感知代理 | 通过 | 地址只来自当次页面 |
| 密钥不进入浏览器包 | 通过 | 配置与仓库不含密钥或地址 |
| 阅读不进入 1.5 秒和 100ms | 通过 | `lesson-first-point` 与 `lesson-wake-visible` 分开；后者尚无 20 次记录，验收未通过 |
| 破壁只取已存结果 | 通过 | 点击和「下一个」未就绪时都不发起计算 |
| 尺寸不符不用预制曲线顶上 | 通过 | `frameSize` 不一致则丢掉该点，不把 `demo-parabola` 画到这一帧 |
| 不新增来源、错误码、工厂或会话状态 | 通过 | `curve.source` 保持 `preset`；页面文案用「这次阅读」 |
| 另一支片子不是 9 秒文件 | 通过 | 验收地址不得等于 `breakglass-demo-9s.mp4` |
| 2% 对齐 | 未通过 | `publishAlignment` 现写 `maxRatio: null`、`measured: false`。设计要求补记，但本命令不把缺记录写成已通过 |
| 零侵入 | 通过 | 仍只覆盖演示页视频，不改播放器控件 |
| 不另建唤醒工厂 | 通过 | 换点时 `dispose` 后再次 `createWake` |

无未解决的 NEEDS CLARIFICATION。2% 与 20 次样本是已知缺口，不是待选方案。

## Project Structure

### Documentation (this feature)

```text
specs/003-preplay-lesson-points/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/lesson-reading.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
extension/
├── manifest.json                          # 不改权限与 CSP
├── assets/config.json                     # 不增加地址或密钥
├── assets/video/breakglass-demo-9s.mp4    # 只作失败退回的片子，可仍缺失
├── src/
│   ├── lesson/reading.js                  # 采样时刻、校验、存点、下一个
│   ├── lesson/ask.js                      # 稀疏画面请求；测试注入 fetch
│   ├── page/main.js                       # 自动开始、暂停、下一个、退回
│   └── session/wake.js                    # 不改工厂签名
└── demo/
    ├── index.html                         # 「下一个」、正在读、没有下一处
    └── demo.css

tests/
├── fixtures/lesson-size-mismatch.json
├── lesson-reading.test.js
├── lesson-ask.test.js
└── page-lesson.test.js
```

**Structure Decision**: 沿用 `extension/` 与根目录 `tests/`。不建立 `backend/`。不把第二支验收片子打进仓库地址说明以外的密钥配置。001 的 `demo-parabola` 只在退回后的那支片子上作为它自己的单点结果。

## Post-Design Constitution Check

Phase 1 没有新增工厂、错误码或 WASM。尺寸不符的点在进入 `createWake` 之前丢掉。[lesson-reading.md](./contracts/lesson-reading.md) 把退回片子限定为 `breakglass-demo-9s.mp4`，并禁止该曲线替换其他帧。

`lesson-wake-visible` 的 20 次与 `maxRatio` 被 quickstart 标成未通过。实现任务不得在记录写出之前把 SC-003、SC-004、SC-005 勾成完成。

## Complexity Tracking

无未批准的宪法例外。原则 VII 已修订为 1.6.0。2% 与 20 次样本的缺口记在 TODO(READING_METRICS)，不构成另开一条例外。
