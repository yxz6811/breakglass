# BreakGlass 测试报告

2026-10-03，Asia/Shanghai。

本次重新运行仓库现有检查：**556 项测试全部通过，失败、取消、跳过和待办均为 0**；**109 个 JS/MJS 文件、179 处本地引用及内联脚本检查通过**。两个命令的退出码均为 0，未发现本次自动检查范围内的失败。

检查对象是 `123456` 对应的源码提交 [`6c8cfefb92a06d22216f5709650f3e28fdbbc973`](https://github.com/yxz6811/breakglass/commit/6c8cfefb92a06d22216f5709650f3e28fdbbc973)。本次只新增测试证据和报告入口，没有修改产品代码或介绍站。自动测试通过不代表真实模型、完整 Chrome 扩展流程或全部产品验收已经通过。

## 环境与复现

| 项目 | 实际环境 |
| --- | --- |
| 工作目录 | `D:\前端\breakglass-geometry-plan` |
| 本地分支／跟踪分支 | `codex/right-triangle-plan`／`origin/123456` |
| 检查前工作树 | 干净，无未提交修改 |
| 系统 | Windows NT 10.0.26200.0，PowerShell |
| Node.js | v24.21.0 |
| FFmpeg | 7.1 essentials，来自已有临时测试工具目录 |
| 测试框架 | Node.js 自带 test runner；全仓库自动发现测试 |
| 模型调用 | 测试替身，不调用真实模型供应商 |

仓库根目录实际执行以下命令。FFmpeg 只加入本次测试进程的 PATH，用于已有 JPEG 解码和定位测试，没有修改系统 PATH 或提交二进制。

```powershell
$env:PATH = 'C:\Users\27736\AppData\Local\Temp\breakglass-005-test-tools;' + $env:PATH
node --test --test-reporter=tap
node scripts/check.mjs
```

两个检查独立并行执行。`--test-reporter=tap` 只改变日志格式；测试范围与 CI 的 `node --test` 一致。换用其他机器时，先使已有 `ffmpeg` 命令可用，再在仓库根目录执行。运行配置与证据口径遵循 [BreakGlass Constitution 1.7.1](BreakGlass-constitution.md) 和 [Spec Kit Constitution 1.9.1](../.specify/memory/constitution.md)。

## 本次执行结果

| 检查 | 北京时间 | 实际结果 | 进程耗时 | 证据 |
| --- | --- | --- | --- | --- |
| 全仓库测试 | 16:54:59—16:55:05 | 556 通过；失败／取消／跳过／待办均为 0；1 个 suite；退出码 0 | 6.607 秒 | [完整 TAP 日志](test-evidence/test-report-2026-10-03/node-test.log)、[执行元数据](test-evidence/test-report-2026-10-03/node-test.json) |
| 语法与资源 | 16:54:59—16:55:11 | 109 个 JS/MJS、179 处本地引用、内联脚本通过；退出码 0 | 12.015 秒 | [完整检查日志](test-evidence/test-report-2026-10-03/static-check.log)、[执行元数据](test-evidence/test-report-2026-10-03/static-check.json) |

测试框架自身报告的总耗时为 6428.8509 ms；表中的进程耗时包含启动与日志收集。两者都不是用户操作延迟或产品性能验收数据。检查对象及环境另见 [运行上下文](test-evidence/test-report-2026-10-03/run-context.json)。未新增依赖、测试用例或产品修复。

## 覆盖与证据边界

| 覆盖组 | 代表文件 | 本次验证内容 |
| --- | --- | --- |
| 曲线契约与计算 | [validate](../tests/validate.test.js)、[evaluate](../tests/evaluate.test.js)、[session](../tests/session.test.js)、[figures](../tests/figures.test.js) | 数据放行与拒绝、确定性求值、参数边界、会话和已有图形 |
| 唤醒与恢复 | [wake-timeout](../tests/wake-timeout.test.js)、[wake-contract](../tests/wake-contract.test.js)、[vision-reject](../tests/vision-reject.test.js) | 假时钟下的 1500ms 保底、取消、迟到结果丢弃、非法识别结果拒绝 |
| 坐标与媒体 | [content-rect](../tests/content-rect.test.js)、[alignment](../tests/alignment.test.js)、[JPEG](../breakglass-reader/tests/jpeg.test.mjs)、[locate](../breakglass-reader/tests/locate.test.mjs) | 黑边与坐标换算、映射阈值、JPEG 解码、固定帧定位；不等于四画幅浏览器验收 |
| 开播前阅读 | [lesson-reading](../tests/lesson-reading.test.js)、[page-lesson](../tests/page-lesson.test.js)、[reader read](../breakglass-reader/tests/read.test.mjs) | 抽帧与结果归属、取消、失败保留原视频、请求与响应契约 |
| 图形与本地提问 | [tutor-ask](../tests/tutor-ask.test.js)、[tutor-sidebar-edges](../tests/tutor-sidebar-edges.test.js)、[page-tutor-edges](../tests/page-tutor-edges.test.js) | 受限指令、数值与歧义、图形参数同步、侧栏状态和迟到回答 |
| 当前帧几何闭环 | [geometry-actions](../tests/geometry-actions.test.js)、[geometry-request](../tests/geometry-request.test.js)、[page-geometry](../tests/page-geometry.test.js)、[geometry read](../breakglass-reader/tests/geometry-read.test.mjs)、[geometry ask](../breakglass-reader/tests/geometry-ask.test.mjs) | 候选确认、单帧身份、修订与取消、原子动作、确定性 BC、恢复与理解题 |
| 页面与扩展约束 | [page-integration](../tests/page-integration.test.js)、[page-a11y](../tests/page-a11y.test.js)、[acceptance-supplement](../tests/acceptance-supplement.test.js)、[p0-page-audit](../tests/p0-page-audit.test.js) | 样式与资源接线、无障碍属性、状态反馈、包内资源和权限约束 |
| 介绍站既有回归 | [site-ui](../tests/site-ui.test.js)、[site-background](../tests/site-background.test.js) | 现有导航及背景等回归断言；本次未改介绍站 |
| reader HTTP | [server](../breakglass-reader/tests/server.test.mjs)、[geometry read](../breakglass-reader/tests/geometry-read.test.mjs)、[geometry ask](../breakglass-reader/tests/geometry-ask.test.mjs) | 实际本机 HTTP 路由、大小限制、来源与 PNA 响应头、错误及断开取消；模型端使用替身 |

页面行为测试通过 fake DOM 驱动真实页面脚本，视频、canvas、时钟或请求边界按用例使用替身。reader 用例包含实际本机 HTTP 和 FFmpeg 解码，但模型回答仍来自替身。本地曲线导师和本地几何指令解析是确定性功能，不能记作 AI 识别或模型问答成功。

`locate.test.mjs` 本次确实验证固定 JPEG 帧的定位及手量点偏差小于 2%。这只覆盖一个固定帧；其他坐标测试验证数学映射，不能替代真实视频四种画幅、窗口／全屏变化后的浏览器量化对齐。静态无障碍断言也不能证明实际读屏、视觉对比度或全部键盘体验。

## 浏览器与 CI 记录

本次没有重跑浏览器手工流程。此前的 [工作台视觉对齐记录](BreakGlass-ui-alignment-2026-10-03.md) 已保存 1280×720、1920×1080、390×844、768×1024 的网页检查及截图，包含曲线提问、几何改边、非法输入、键盘焦点与理解题。该记录属于上一轮检查，桌面浏览器的视口模拟不等于真实移动设备。

本次查询测试对象提交的 GitHub 检查：已有 [push 检查](https://github.com/yxz6811/breakglass/actions/runs/37110088973/job/111166127323) 和 [PR 检查](https://github.com/yxz6811/breakglass/actions/runs/37110091899/job/111166136109) 均为 `completed / success`，分别在北京时间 16:33:40 和 16:33:49 完成；[查询记录](test-evidence/test-report-2026-10-03/source-ci.json) 保留提交身份与结果。它们是该源码提交已有的远程结果，本次重新运行的是上表中的本地检查。CI 使用 Ubuntu、Node.js 24、FFmpeg，执行现有 [工作流](../.github/workflows/test.yml)；不据此声称已经验证所有系统和浏览器。

## 尚未通过的验收

| 项目 | 当前状态 |
| --- | --- |
| 真实模型识别及问答 | 本次未配置或调用供应商，没有新增真实识别成功率、人工校正率或模型等待预算数据 |
| Chrome MV3 完整流程 | 本次未在确定版本 Chrome 中安装并验收扩展；网页与 Node 测试不代替该流程 |
| 四画幅及像素对齐 | 固定帧及数学映射测试通过，真实四画幅、窗口／全屏变化后的量化记录仍待完成 |
| 性能与返回时间 | 未测实际像素呈现 P50/P95、热缓存至少 20 次的 P95 ≤100ms，以及返回视频 seek 完成后的 ≤0.1 秒偏差 |
| 真实设备与辅助技术 | 未新增物理触屏、真实手机、屏幕阅读器或全平台兼容性验证 |
| 学习效果 | 理解题行为测试通过，不证明长期记忆或学习效果提升 |

已有 [前端验证记录](BreakGlass-frontend-validation.md) 与 [几何验证记录](BreakGlass-geometry-validation.md) 中的 T030/T038、003 的 SC-003 至 SC-005，以及 005 真实模型和完整产品验收状态保持原有结论。后续验收应按 [001 快速验收](../specs/001-insitu-parabola/quickstart.md) 和 [005 验收步骤](../specs/005-insitu-right-triangle/quickstart.md) 补充相应证据；556 项通过不能用于勾选这些尚缺证据的任务。
