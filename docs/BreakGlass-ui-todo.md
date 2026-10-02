# BreakGlass 待实现的前端 UI 与参数调节

> 本分支：`ui`。文档基于 `p2@77423ab` 的界面元素逐项核对；`ui` 分支的控件 id、状态名与设计令牌一致，但 `extension/src/page/main.js` 的接线实现与 `p2` 不同。

> 只列**尚未实现**的部分；已完成的按钮/状态/文案清单见 [`BreakGlass-ui-inventory.md`](./BreakGlass-ui-inventory.md)。
> 依据：`specs/001-insitu-parabola/spec.md`（FR-017/018、SC）、`docs/BreakGlass-frontend-execution-plan.md`（P-01~P-05、FE-06、§10 验收清单）、`docs/BreakGlass-frontend-analysis.md`（§8.2 拖动语义）、`data-model.md`（参数模型）、`AGENTS.md`（§6 动效、§7 禁用态）。
> 核对时间：2026-10-02，基线 `p2@77423ab`。

## 1. 待实现的前端 UI 功能

| # | 功能 | 依据 | 现状 | 需要做什么 | 前置 |
| --- | --- | --- | --- | --- | --- |
| 1 | **等待态加载反馈** | execution-plan §10「识别中有明确加载反馈」；P-03「加载反馈、取消入口及等待说明」 | 只有一行状态文字与取消按钮，`index.html` 无任何 loading/spinner/progress/`aria-busy` | 加载指示（spinner 或 1.5 秒进度条）与取消按钮并列；对读屏暴露 `aria-busy` | 无 |
| 2 | **`a` 参数控件** | execution-plan FE-06「参数控件和曲线联动」；`data-model.md` 每个参数都有 min/max/step | 只有 `h` 一个滑块；`main.js` 里写死 `parameters.h` | 新增一行「开口宽窄 a」滑块 + 数值显示，与曲线联动；把参数行改成可复用结构 | 无 |
| 3 | **`k` 参数控件** | 同上 | 无 | 新增「顶点高度 k」滑块 + 数值 + 联动 | 同 #2 |
| 4 | **键盘焦点可见样式** | spec FR-017「键盘用户必须能看见当前焦点」；Constitution §6；AGENTS §6 | `demo.css` 无任何 `:focus` 规则，仅靠浏览器默认焦点环；覆盖层控制点 `tabindex=0` 也无聚焦态 | 为按钮/滑块加 `:focus-visible` 样式；控制点聚焦时给出可见描边 | 无 |
| 5 | **禁用态原因说明** | AGENTS §7「禁用或不可用状态…必要时解释不可操作的原因」 | 只有 `opacity:.45` 与状态区文字 | 破壁/重置/拖动禁用时给出原因（`aria-describedby` 或 tooltip）：未暂停在目标时间 / 未进入交互 / 正在等待 | 无 |
| 6 | **失败态的动作层级** | FR-010「提供重试或退出」 | 已有「重试」「退出」，但视觉权重相同（同一个 `.panel-actions`） | 失败态把「重试」设为主操作、「退出」为次操作；来源说明给出失败原因 | 无 |
| 7 | **性能读数展示** | execution-plan §10「预制首次可见、感知等待、超时回退分别计时，报告 P50/P95」 | 数据已在 `window.__breakglassLatency`，界面无展示 | 演示页加一块只读读数区（或约定控制台取样脚本），用于 T030/T038 记录 | 无 |
| 8 | **空素材/视频错误的视觉状态** | FR-018「入口保持不可用，或说明为什么不能使用」 | 只有一行 `.asset-empty` 提示 | 空态占位视觉 + 破壁入口禁用原因；视频错误与「素材未提供」区分 | 无 |
| 9 | **交互动画与过渡** | **本仓库未强制要求**；AGENTS §6「动效服务于状态变化和操作反馈」 | 无任何过渡动画 | 状态切换过渡、曲线出现动画、按钮按压/悬停反馈、控制点 hover/active | 无 |
| 10 | **顶点/整条曲线拖动** | analysis §8.2「顶点拖动调整 h、k；是否支持整条曲线拖动单独确认」 | 控制点只改 `dragParameter`（当前为 `h`） | **先确认拖动语义**，再实现双参数或整条曲线拖动 | **待团队决策** |

## 2. 待实现的参数调节

| 参数 | 位置 | 范围 / 步长 | 现状 | 待实现 |
| --- | --- | --- | --- | --- |
| `a` | `definition.parameters.a` | 0.4 – 1.2 / 0.1 | **无 UI** | 滑块 + 数值（1 位小数）+ 曲线联动，影响开口宽窄 |
| `h` | `definition.parameters.h` | -2 – 2 / 0.1 | 已有：滑块 + 数值 + 控制点拖动 | 保持（拖动语义如调整见 #10） |
| `k` | `definition.parameters.k` | -2 – 2 / 0.1 | **无 UI** | 滑块 + 数值 + 联动，影响顶点纵向位置 |
| 拖动参数 | `definition.dragParameter` | 当前 `h` | 单参数、钳制在 `min`–`max`、非有限值被拒绝 | 若支持顶点拖动，需要同时写 `h` 与 `k`；`dragParameter` 仍是单选字段，需扩展契约或约定复合拖动 |
| 目标时间 | `#target-time` | ≥0 / 0.1，当前 12.5 | 已有数字输入 | 保持；可补「当前时间距目标 ±0.2 秒」的可视提示 |

## 3. 实现时必须守住的既有约束

- `#parameter-h` 的 `min`/`max`/`step` 必须与预制 JSON 一致（`tests/page-integration.test.js` 有静态断言）；新增控件沿用同一规则。
- 新脚本要加入 `index.html` 且保持本地脚本与依赖顺序（静态断言会检查脚本顺序、无远程资源）。
- 状态区 `#state-label` 最小高度 48px，文案切换不得引起布局跳动。
- 覆盖层必须保持绝对定位并与 `contentRect` 绑定，否则会掉到视频下方。
- 回退「判定超时 → 首个可见 SVG 帧 ≤ 100ms」的预算不能被入场动画拖慢。
- 新增控件要进入 `tests/page-integration.test.js` / `tests/page-p2.test.js` 的断言，保持 `node --test` 96 项基线不回归。
