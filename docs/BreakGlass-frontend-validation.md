# BreakGlass 前端验证记录

> 本文是前端自动化与手工验收的落盘记录，目标路径见 `specs/001-insitu-parabola/tasks.md` 的 T030。
> 更新日期：2026-10-02。

## 1. 自动化基线

| 命令 | 结果 |
| --- | --- |
| `node --test` | **96 项通过，0 失败，0 待办** |
| `node --check`（extension 与 tests 全部 JavaScript） | 通过 |
| `scripts/verify.mjs`（本地工作区工具，未进入本仓库） | 语法检查 + 全量测试通过 |

### 覆盖范围

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/validate.test.js`、`tests/evaluate.test.js`、`tests/preset-contract.test.js` | CurveResult 放行/拒绝、求值器白名单、运行配置与预制夹具契约 |
| `tests/content-rect.test.js` | `contain` 黑边计算、`object-position` 的百分比/px/关键字/数字解析、非有限尺寸防御 |
| `tests/session.test.js`、`tests/backend-edges.test.js` | 会话生命周期、目标时间门禁、参数钳制、复制结果副本、边缘情况 |
| `tests/wake-timeout.test.js`、`tests/wake-contract.test.js` | 假时钟驱动的 1500ms 回退、迟到丢弃、取消、5 次循环、`createWake` 交接接口 |
| `tests/external-simulator.test.js` | `off`/`hang`/`invalid`/`late` 四模式确定性、无网络、无遗留定时器 |
| `tests/alignment.test.js` | 四画幅映射、源↔页面往返、2% 偏差比例与阈值边界、采样 |
| `tests/page-integration.test.js` | 演示页脚本顺序、控件与 `aria-live`、覆盖层定位、无远程资源、`createWake` 接线 |
| `tests/page-p2.test.js`、`tests/page-p3.test.js` | 假 DOM 驱动真实 `main.js`：等待/回退/取消/重试、窗口/全屏/方向/DPR 重算与测量输出 |

## 2. 尚未执行（不得写成已通过）

| 项 | 原因 |
| --- | --- |
| T017：扩展内演示页的浏览器手工主路径 | 当前环境没有可控浏览器会话 |
| T030：quickstart 第 2 节的 `hang`/`invalid`/无缓存/取消手工演练与 SC-003 的 P50/P95 | 同上；且需要连续多次采样 |
| T038：四画幅 + 窗口变化 + 全屏/DPR 的真机 2% 记录 | 同上；正式视频素材也未提供 |
| 正式视频与配套曲线素材 | 团队尚未提供，当前只有工程夹具 |

## 3. 证据口径

- 自动化测试证明的是**状态机、校验与坐标映射**；假 DOM 测试不能替代真实浏览器的布局与事件语义。
- 在正式视频到位前，夹具只能证明交互状态与几何逻辑，**不能**作为原位对齐的验收证据。
- 性能类结论（回退 ≤100ms）目前只有假时钟下的确定性断言，没有真实采样数据。

## 4. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-02 | 首次建立验证记录：自动化基线 96 项、覆盖范围、未执行项与证据口径 |
