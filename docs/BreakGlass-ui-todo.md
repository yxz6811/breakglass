# BreakGlass 待实现的前端 UI 与参数调节

> 只列**尚未实现**的部分。已完成的功能、按钮、状态与参数清单见 [`BreakGlass-ui-inventory.md`](./BreakGlass-ui-inventory.md)；令牌与动效数值见 [`BreakGlass-visual-spec.md`](./BreakGlass-visual-spec.md)。
> 依据：`specs/001-insitu-parabola/spec.md`（FR-002/010/017/018）、`docs/BreakGlass-frontend-execution-plan.md`（P-01~P-05、FE-06、§10）、`AGENTS.md` §6/§7。
> 核对时间：2026-10-02，基线 `前端计划02`（含识别结果适配 002 与可访问性补齐）；自动化基线 189 项通过。

## 1. 待实现的前端 UI 功能

| # | 功能 | 依据 | 现状 | 需要做什么 | 前置 |
| --- | --- | --- | --- | --- | --- |
| 1 | **顶点 / 整条曲线拖动** | analysis §8.2「顶点拖动调整 h、k；是否支持整条曲线拖动单独确认」 | 控制点只改 `dragParameter`（当前 `h`） | 先确认拖动语义，再实现双参数（`h` + `k`）或整条曲线拖动 | **待团队决策** |
| 2 | **性能读数展示** | execution-plan §10「分别计时，报告 P50/P95」 | 数据已在 `window.__breakglassLatency`（`fallback-visible` 与 `vision-decision`），界面无展示 | 加一块只读读数区或约定取样脚本，供 T030/T038 记录 | 无 |
| 3 | **空素材与视频错误的区分** | FR-018「入口保持不可用，或说明为什么不能使用」 | 只有一行 `.asset-empty` 文案，两种情况共用 | 区分「素材未提供」与「视频加载失败」，并给破壁入口禁用原因 | 无 |
| 4 | **目标时间对齐提示** | FR-002 门禁 ±0.2 秒 | 只体现在破壁按钮可用性上 | 补「当前时间距目标 ±0.2 秒」的可视提示 | 无 |

## 2. 待实现的参数调节

| 参数 | 现状 | 待实现 |
| --- | --- | --- |
| 拖动参数 `dragParameter` | 单参数（`h`）、钳制在 `min`–`max`、拒绝非有限值 | 若支持顶点拖动，需要同时写 `h` 与 `k`；`dragParameter` 仍是单选字段，需扩展契约或约定复合拖动（见 §1 #1） |

其余参数均已实现：`a` / `h` / `k` 三个滑块（走 `session.setParameter`）、目标时间（初值 6、±0.2 秒门禁）、运行配置六个字段（含 `visionAdapter`）、识别候选字段（`evidence` / `confidence`）与识别计时 `vision-decision`。明细见 [`BreakGlass-ui-inventory.md`](./BreakGlass-ui-inventory.md) §4、§5。

## 3. 实现时必须守住的既有约束

- 既有 id 必须保留（`#play-toggle`、`#jump-target`、`#wake-button`、`#cancel-button`、`#retry-button`、`#reset-button`、`#fullscreen-button`、`#exit-button`、`#parameter-*`、`#source-label`、`#state-label`、`#target-time`）；`tests/page-integration.test.js` 有静态断言。
- `#parameter-a/h/k` 的 `min`/`max`/`step` 必须与预制 JSON 一致（同一静态断言）。
- 新脚本要加入 `index.html` 并保持本地脚本与依赖顺序；页面不得出现远程地址、动态代码或密钥。
- 状态区 `#state-label` 最小高度 48px，文案切换不得引起布局跳动；错误态用 `aria-live="assertive"`，其余保持 `polite`。
- 覆盖层必须保持绝对定位并与 `contentRect` 绑定；控制点的**第一个** `<circle>` 必须是可见控制点（拖动逻辑依赖它），热区圆放在后面。
- 回退「判定超时 → 首个可见 SVG 帧 ≤ 100ms」的预算不能被入场动画拖慢。
- 新增控件要补进 `tests/page-integration.test.js` / `tests/page-p2.test.js` / `tests/page-a11y.test.js`，保持 189 项基线不回归。

## 4. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 2.0.0 | 2026-10-02 | 可访问性与渲染细节落地后重写：移除已完成的 10 项（等待条、`a`/`k` 滑块、焦点可见、禁用原因、`aria-valuetext`、控制点热区、错误态 `assertive`、失败动作层级、动效与过渡、液态玻璃顶栏迁移），只保留 4 项待实现 + 1 项待决策；约束补上错误播报与控制点顺序 |
| 1.0.0 | 2026-10-02 | 首次汇总待实现的 UI 功能与参数调节 |
