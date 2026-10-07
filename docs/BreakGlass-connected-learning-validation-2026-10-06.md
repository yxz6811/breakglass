# 008 账号连通、上下文与复练验证

日期2026-10-06；受测代码基于`489b8e28c4037da047186f5872c4024e2b8c586e`加008改动，最终提交以指定规划分支历史为准。治理2.4.0，本机开发范围见[008任务](../specs/008-connected-learning/tasks.md)与[UI/风险对齐](BreakGlass-connected-learning-2026-10-06.md)。

| 验证 | 实际结果 / 适用范围 |
| --- | --- |
| 全仓库Node | 867/867通过，失败/取消/跳过0；比007新增99项。Node24.21.0，旧视频测试仅工具PATH加入FFmpeg7.1；运行时未加依赖 |
| 静态检查 | `node scripts/check.mjs`：182个JS/MJS语法、300个本地资源引用及内联脚本通过 |
| 账号服务 | 29个真实HTTP/FS测试（原15＋新14）：一次码/期限/重放、扩展origin/父会话/最小scope、撤销/退出/换号/重启、账号隔离、同值幂等、删除epoch、提交前权限复验及原子快照清理 |
| 插件同步 | 新29项：worker sender/token隔离、先本机、旧记录import、离线/10秒/队列上限/失败位、单通道、同ID冲突、退出/换号/清除/删除epoch、独立watch及可见/来源/播放生命周期 |
| 片段上下文 | 新37项：新schema/多帧时间/数学候选、JPEG/字幕预算、VTT/SRT/字幕空隙、独立decoder清理、pending/空配置、实际HTTP指纹/服务派生cue/4次额度/单槽/实际abort、UI代次与异步候选取消 |
| 教学模块 | 新8项：两模板真实数学预测、3层提示、20变式序号、独立record/source/追溯、不改旧条件、极端参数拒绝、学生解释未评分 |
| 客户端补充 | 新2项：同账号外部删除epoch清理迟到写回；prepared context进入原数学确认层且不重复采集，停止清空 |
| 可选模型工具 | 新9项，包括真实CLI未配置exit2/0外呼、实际FFmpeg本地2/4/8秒640×360并校验、明确transport注入及最小指标/输出路径。当前not-run/unconfigured，不是模型验收 |
| 实际008浏览器 | Windows/Edge154.0.4258.37，真实MV3 action/activeTab/worker、账号HTTP/本地视频解码；13项检查、9截图、pageerror0。供应商全部明确进程内替身：4read/4summary/1context |
| 实际片段 | 2/4/6/8秒四JPEG＋2条服务派生作者cue；原播放器4秒不变；注明无音轨/无整文件；候选定位/确认/保存，取消清除prepared overlay |
| 实际学习/记录 | 网站生成码→插件UI配对→未来保存确认、旧guest勾选、断网先本机与明确retry、watch→同账号；删除epoch阻止旧队列而local保留，网站撤销真实worker失效；两模板变式实际提交独立正确，提示题记录为用提示，解释不产生attempt |
| 实际空配置 | 网站context明确503/0外呼/0假候选；真实reader未配置时插件read失败仍能以独立token保存实际观看位置 |
| 视觉与回归 | 1440px/390px新复练截图已查看、无页面横向溢出；网站原10完整流程回归通过，旧MV3回归另附。不是手机硬件、四画幅2%或真实学生效果验收 |

审查修复了离线关闭同步、替换配对失败清旧身份、队列异常不伪称queued、同ID冲突、同账号外部删除epoch、字幕空隙纯帧、取消后seek/CSS候选迟到、旧定位超时状态与监听清理。测试脚本也改用实际语义入口和明确checkbox范围，避免新字幕控件带来的歧义。

证据见[目录说明](test-evidence/connected-learning-2026-10-06/README.md)、[实际浏览器结果](test-evidence/connected-learning-2026-10-06/connected-evidence.json)、[汇总](test-evidence/connected-learning-2026-10-06/test-summary.json)。账号/笔记为合成内容，凭据、token、媒体JPEG及模型原文不入证据。

## 复验与待完成

枚举`tests`、`breakglass-reader/tests`、`breakglass-learning/tests`所有`.test.js/.test.mjs`后传给`node --test --test-reporter=tap`；不要把目录名当测试脚本。`node scripts/check.mjs`为独立工程检查。[实际集成脚本](../scripts/verify-connected-learning.mjs)需要本机Playwright/Edge，可用`BREAKGLASS_TEST_PLAYWRIGHT_MODULE`和`BREAKGLASS_TEST_BROWSER_EXECUTABLE`指定；传仓库外输出目录，独占4173/4174/8787，结束释放浏览器/服务。脚本明确使用替身、不读取用户.env。

[模型验收工具](../scripts/evaluate-learning-model.mjs)默认不运行供应商；当前输出not-run。用户将来配置本机.env后可显式`--run-model --output 仓库外绝对报告路径`，得到局部人工标注对比和延迟，不代表全平台/长课/学生效果。

仍待：真实模型质量/耗时/费用/长课，B站许可和真实平台采集，公众身份/跨设备部署，地区/儿童监护/跨境/权利/撤权，音轨/ASR/整视频临时云处理，更多数学模板和真实学生长期学习效果。旧003/005/P0未通过项不因008勾选通过。
