# BreakGlass 前端验证记录

> 本文是前端自动化与手工验收的落盘记录，目标路径见 `specs/001-insitu-parabola/tasks.md` 的 T030。
> 更新日期：2026-10-02。

## 1. 自动化基线

| 命令 | 结果 |
| --- | --- |
| `node --test` | **182 项通过，0 失败，0 待办**（当前 `main`；本轮识别适配切片见 §4） |
| `node --check`（extension 与 tests 全部 JavaScript） | 通过 |
| `scripts/verify.mjs`（本地工作区工具，未进入本仓库） | 语法检查 + 全量测试通过 |

### 覆盖范围

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/validate.test.js`、`tests/evaluate.test.js`、`tests/preset-contract.test.js` | CurveResult 放行/拒绝、求值器白名单、运行配置与预制夹具契约 |
| `tests/content-rect.test.js` | `contain` 黑边计算、`object-position` 的百分比/px/关键字/数字解析、非有限尺寸防御 |
| `tests/session.test.js`、`tests/backend-edges.test.js` | 会话生命周期、目标时间门禁、参数钳制、复制结果副本、边缘情况 |
| `tests/wake-timeout.test.js` | 假时钟驱动的 1500ms 回退、迟到丢弃、取消、5 次循环 |
| `tests/wake-contract.test.js` | 交接接口形状：`createWake({ session, config, preset, clock, onChange, attempt })`、五个方法、状态字段与别名字段禁令 |
| `tests/latency.test.js`、`tests/place-in-frame.test.js` | 内存计时摘要与 P50/P95；预制区域按当前帧宽高比换算 |
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

## 4. 识别适配切片（`specs/002-vision-result-adapter/`）

### 4.1 自动检查（2026-10-02 执行）

| 命令 | 结果 |
| --- | --- |
| `node --test` | **182 项通过，0 失败，0 待办** |
| `node --check`（extension 与 tests 全部 JavaScript） | 39 个文件通过 |

新增的测试文件：

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/vision-validate.test.js` | 没有 `allowVision` 时 vision 仍被拒；`evidence` 必须是 `packaged-sample`；识别样例的 `fallback` 必须为 `null`；可信程度缺省时可放行、存在时必须落在 0–1 且低于 0.5 拒绝；`preset` 不得夹带 `evidence` |
| `tests/vision-config.test.js` | 提交配置 `visionAdapter: off`；缺省、空串或其他值一律按 `off`；读取失败路径同样归一化，不残留 `fixture` |
| `tests/vision-wake.test.js` | `off` 走预制；`fixture` + 匹配样例进入 `interactive`，`source: vision` 与 `evidence` 一路到页面；即使没有预制结果也能成功；识别成功不人为等待 1500ms |
| `tests/vision-reject.test.js` | 九类坏样例全部进入可恢复错误（`external_unavailable` + 同一句 `message`、`result` 为 `null`、从未进入交互）；外部演练优先于识别样例；取消/退出/离开目标时间后丢弃迟到结果；`hang` 仍在 1500ms 回退到预制 |
| `tests/vision-latency.test.js` | 识别成功与识别失败各记一条 `vision-decision`；识别路径不写 `fallback-visible`；预制路径不写识别计时；样本只含名称、毫秒数与缓存状态 |
| `tests/page-vision.test.js` | 页面按 `evidence === 'packaged-sample'` 显示「识别结果」；识别来源不是警示态；不读也不显示可信程度；页面文件无远程地址、动态代码或密钥 |

### 4.2 尚未执行（不得写成已通过）

| 项 | 原因 |
| --- | --- |
| `quickstart.md` 第 1–5 节：关闭开关连唤 10 次、打开样例离线走通、三类非法样例、`hang` 回退复核、配置改回 `off` | 当前环境没有可控浏览器会话 |
| SC-002（90 秒内完成唤醒、改参、重置、退出） | 同上 |
| 包内 9 秒片子的真实 `frameSize` 对齐 | 视频素材仍未提交。样例当前按 1920×1080 画布编写；识别路径**不做**画幅换算，演练前必须按实际尺寸改写 `extension/assets/vision/fixture-parabola.json`（README 给了 3024×1898 的换算示例） |

### 4.3 提交配置

由 `tests/vision-config.test.js` 自动断言：`visionAdapter: off`、`externalAttempt: off`、`fallbackAfterMs: 1500`。任何演练结束后必须回到这三个值。

## 5. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-02 | 首次建立验证记录：自动化基线 96 项、覆盖范围、未执行项与证据口径 |
| 2026-10-02 | 合并 `origin/main`（PR #26 `ui`、PR #27 6 秒帧适配）后重跑：基线 118 项通过；`tests/wake-contract.test.js` 改写为按 `.specify/memory/constitution.md` 1.3.0「交接接口」校验 |
| 2026-10-02 | 解决 PR #30 与 `main` 的冲突后重跑：`node --test` 137 项通过。残缺帧尺寸不再记成准备结果不可用 |
| 2026-10-02 | T001–T018 执行完毕：宪法修订到 1.4.0、识别开关与样例、同一个校验器放行识别样例、页面来源文案与识别计时接入。自动基线 **182 项通过**；quickstart 手工验收与真实画幅对齐**未执行** |
