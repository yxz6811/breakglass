# Implementation Plan: 旁边提问

**Branch**: `004-figures-and-tutor` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-figures-and-tutor/spec.md`

**本次交付**: 只做规格里的用户故事 2（旁边提问）。用户故事 1（直线、圆、正弦）由另一人做。本计划只规定提问区怎样接到「当时画面上的那种图形」，不实现那些图形。

## Summary

在现有演示页右侧控制栏里加一块提问区。用户用中文问「把某个系数改成多少」或「某个横坐标上的值是多少」。提问区先把这句话收成结构化意图，再用当前画面已经在用的系数和求值函数算出结果，然后把实际采用的数写进回答，并让现有曲线重画。

数只来自本地。模型、阅读服务和任何新的网络请求都不参与算式，也不参与决定画面。先把现有抛物线做完；对方换上新图形后，同一块提问区改读当时的 `equationId`。

## Technical Context

**Language/Version**: JavaScript（浏览器页面与 Node.js 20+ 的纯函数测试），无 TypeScript、无打包步骤

**Primary Dependencies**: 无新增运行时依赖。沿用 Vanilla JS、原生 CSS、现有 SVG 绘制、`extension/src/session/session.js` 的 `setParameter`、`extension/src/curve/evaluate.js` 的 `evaluateWithParameters`、`extension/src/geometry/alignment.js` 的可见折线

**Storage**: 对话只留在页面内存。换视频或退出破壁后清空。无数据库、无账号、无本地持久化

**Testing**: `node --test` 覆盖解析、夹取、读数和「整句不改图」。演示页按 [quickstart.md](./quickstart.md) 手工验收

**Target Platform**: Chrome 当前稳定版，扩展内演示页 `extension/demo/index.html`

**Project Type**: browser extension 的演示页交互

**Performance Goals**: 一次提问在本地同步完成，不占用破壁的 1.5 秒，不发起网络请求

**Constraints**: 回答、滑块读数、曲线求值三者使用同一组已夹取、已按步长对齐的数。密钥和阅读地址不进页面。未识别的句子、未知图形、未知系数都不改图。坐标窗口外的点用真实读数说明在窗外，绘制仍走现有可见折线

**Scale/Scope**: 一块提问区，先接 `fixture.parabola`。直线、圆、正弦只预留注册项，等对方的 `equationId` 和系数名落地后再补一条注册，不在本计划里画出来

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

对照 [产品 Constitution 2.1.0](../../docs/BreakGlass-constitution.md) 与 [Spec Constitution 2.1.0](../../.specify/memory/constitution.md)。

2026-10-06 治理复核：本计划仍只交付故事 2 的本地确定性提问，不识别新图形、不发起网络请求，不改变 `CurveResult/createWake` 或 1500ms 保底。故事 1 与 005 保持独立；PR #63 不批准通用形状、预处理或粒子/分龄方案，原场景未取得验证证据时不据此标记完成。

| 门禁 | 设计前 | 设计后 | 依据 |
| --- | --- | --- | --- |
| 不抬高 P0，不加长 1.5 秒破壁 | 通过 | 通过 | 提问只在已经进入交互的覆盖层上运行，不进入 `createWake` |
| 技术路线仍是 Vanilla JS + 原生 CSS/SVG | 通过 | 通过 | 不引入聊天组件库、绘图库或打包器 |
| 不新建云端后端、数据库、账号 | 通过 | 通过 | 解析和求值都在扩展页内 |
| 密钥不进页面和仓库 | 通过 | 通过 | 本功能没有模型调用，也没有阅读地址 |
| 算式结果来自确定性本地执行 | 通过 | 通过 | 意图只描述「改哪个数、读哪个 x」；y 与夹取由现有求值和 `setParameter` 的范围完成 |
| 来源枚举、错误码、工厂名不新增 | 通过 | 通过 | 不改 `CurveResult`，不改阅读 |
| 窗口外不画成贴边直线 | 通过 | 通过 | 提问不另画路径，重画仍调用 `visibleCurvePolylines` |
| 新图形不从视频识别 | 通过 | 通过 | 提问不上传帧，不调用阅读服务 |

无需要辩护的宪法违例。

## Project Structure

### Documentation (this feature)

```text
specs/004-figures-and-tutor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── figure-snapshot.md
│   └── tutor-turn.md
└── tasks.md             # 由 /speckit-tasks 生成，本命令不创建
```

### Source Code (repository root)

```text
extension/
├── demo/
│   ├── index.html          # 控制栏底部增加提问区
│   └── demo.css
└── src/
    ├── page/main.js        # 只负责把提问区接到会话和重画
    ├── session/session.js  # 继续用 setParameter，不改语义
    ├── curve/evaluate.js   # 抛物线求值继续由这里提供
    └── tutor/
        ├── numbers.js      # 读数、按步长对齐与夹取、滑块与回答共用的格式化
        ├── figures.js      # 图形登记：叫法、求值、变化说明；现在只有抛物线
        ├── parse.js        # 一句中文 → 意图
        └── ask.js          # 纯函数：快照 + 一句中文 → 解答

tests/
├── tutor-numbers.test.js
├── tutor-parse.test.js
├── tutor-ask.test.js
└── page-tutor.test.js
```

**Structure Decision**: 提问的判断和算数放在 `extension/src/tutor/`，页面只提交当前快照并应用返回的系数。这样 `node --test` 不打开浏览器也能锁住「回答里的数就是画面上的数」。滑块标签也改用 `numbers.js` 的同一个格式化，回答和滑块不会各写一套。直线、圆、正弦若要被问到，在 `extension/src/tutor/figures.js` 增加一条登记；绘制、滑块和裁剪仍留在对方的图形工作里。

**接缝（待图形同学确认）**: 当前图形从 `session.getState().result.definition` 与 `currentParameters` 读出，写入走 `setParameter`。若对方把图形另存，只改 `ask.js` 的 `snapshotFrom` 和页面里的写入函数。

## 制作顺序

1. **先写纯函数和测试。** 用 `extension/assets/presets/demo-parabola.json` 的系数范围做夹具。覆盖改一个系数、改两个系数、越界夹取、读一个横坐标、窗口外、整句无法执行。此阶段不改页面。
2. **再接页面。** 在右侧控制栏现有滑块下面加提问区。送出时读取当前 `definition` 和 `currentParameters`，调用 `ask`。只有解答标明改了图时，才对每个实际采用的系数调用现有 `setParameter`，然后调用现有 `drawCurve`。
3. **补上会话边界。** 还没破壁、已退出、换了视频时，提问区不可送出或送出后明确说明没改。焦点在输入框时，Esc 不退出破壁。
4. **留下图形接缝。** `ask` 按 `equationId` 找登记。现在只登记 `fixture.parabola`。没登记的图形返回「当前图形不能这样问」，系数保持原样。
5. **按 quickstart 做手工验收。** 确认预设 9 秒抛物线的暂停、破壁、拖动、重置、退出仍可用，提问没有网络请求。

## 边界

- 本次做提问区、中文意图、抛物线登记、把结果写回现有会话并重画。
- 同一句里可以先改系数再问读数，例如「如果开口是 0.5，x 等于 1 时 y 是多少」。读数用改完之后的系数。
- 还认出「k 是多少」这类读系数当前值的问法，以及「把顶点移到 (1, -1)」「向下平移 1」「k 增加 0.5」。
- 直线、圆、正弦的公式、滑块、切换控件和裁剪由图形的人做。提问侧不在 `evaluate.js` 里添加这些公式。
- 对方的系数名以他们落地的 `parameters` 键为准。提问侧只在登记表里写中文别名。名字不一致时改登记表，不改套用流程。
- 「如果某个值是多少」会真的把画面改成那个数，用来让人看见变化。不做改完再自动还原的预览。
- 问句对不上当前图形的系数或读数时，画面保持原样，回答说明没有改。
- 对话不跨视频保留，不上传问题文本，不保存账号。
- 阅读、破壁超时、`CurveResult` 来源和开播前抽帧都不改。

## Complexity Tracking

无宪法违例，不填写。
