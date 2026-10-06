# 007 学习管理网站与粒子验证

日期2026-10-06；受测代码基于`1ff95c1232e8b7a9145a0ac69c870c679ac1d350`加本轮007与共享模块改动，最终提交见指定规划分支历史。治理2.3.0，任务[W001–W008](../specs/007-learning-site-and-particles/tasks.md)为本机开发范围完成；不代表正式发布或真实模型/平台/学习效果验收。

| 验证 | 实际结果 / 限制 |
| --- | --- |
| 全仓库回归 | Node24.21.0，`node --test --test-reporter=tap`：768/768通过；失败/跳过/取消0；旧视频测试仅在工具PATH加入FFmpeg7.1 |
| 静态工程检查 | `node scripts/check.mjs`：163个JS/MJS语法、282个本地引用及内联脚本通过；无应用新增运行时依赖 |
| 账号与持久化 | 15个真实HTTP/磁盘测试：随机salt/scrypt、opaque HttpOnly/SameSite cookie、Origin/CSRF、限流、归属、同值幂等/冲突、epoch删除、原子持久化与重启登录；pending私人watch用途分离及并发注册通过 |
| 网站HTTP | 8项测试：静态白名单、敏感文件/恶意Host拒绝、实际视频Range、指纹门禁、会话Origin/来源/时间绑定、模型空503、单槽/预算、停止/断开中止、超载413 |
| 网站状态 | 17项导入/记录/client测试：完整指纹/解码预算/换源清理、最小结构、审核JSON/作者来源、pending watch、guest/account相同数学判定、真实作答分类、外部身份变化/迟到/超时/删除代次隔离 |
| 持续会话 | 7项运行实际session/loop/契约的VM测试：开启中停止/销毁也中止begin、迟到token回收、read/summary旧回复隔离、手工无采集、32次及30分钟截止 |
| 粒子数学 | 9项数学/固定WebGL测试：共面z=0、3–4–5、抛物线域、共用比例、参数/视角分离、画布/DPR上限、隐藏/销毁/上下文失败及SVG降级 |
| 实际网站浏览器 | Edge154.0.4258.37、Windows10.0.26200，headless真实浏览器；10个完整流程、13截图、无pageerror。真实文件解码/SHA/JPEG→本机HTTP→明确模型替身→校对/保存；真实UI注册/导入/账号隔离、三种作答与跳过、watch匹配、导出/删除通过 |
| 网站视觉与交互 | 实际1440/360px页面无横向溢出；学习层flow置于import-workbench内容容器，真实checkbox可点击、暗色背景rgb(16,23,27)。旋转yaw20/pitch12使canvas截图改变而数学SVG不变；截图已查看。不是手机硬件或四画幅2%验收 |
| 实际MV3回归 | 真实Edge action/activeTab/worker注入，3read/3summary均明确替身；插件粒子键盘操作/SVG保留、JSON导出、保存/清除/可见静止会话撤销和不支持页不上传通过；760/360px仍保持独立面板 |
| 模型留空 | 实际网站read返回503，供应商调用0、无假热点；不回退预设冒充识别。模型可以继续通过服务端环境配置 |

网站首轮实测发现flow面板挂到body后被固定左栏遮挡，已增加内容容器并修正全屏退出恢复；真实点击复验通过。只读审查发现begin请求未受stop取消，已纳入控制器并补迟到回收测试。账号客户端也修复外部身份改变、删除期间旧响应和数学判定差异，避免跨范围写回或错误学习状态。

证据见[目录](test-evidence/learning-site-2026-10-06/README.md)、[网站结果](test-evidence/learning-site-2026-10-06/site-evidence.json)、[MV3结果](test-evidence/learning-site-2026-10-06/mv3-evidence.json)及[测试汇总](test-evidence/learning-site-2026-10-06/test-summary.json)。截图、JSON与账号均为合成测试数据；不进入学生学习数据。

## 复验与待完成

浏览器脚本[verify-learning-site.mjs](../scripts/verify-learning-site.mjs)与[verify-learning-mv3.mjs](../scripts/verify-learning-mv3.mjs)使用工具环境Playwright，可用`BREAKGLASS_TEST_PLAYWRIGHT_MODULE`及`BREAKGLASS_TEST_BROWSER_EXECUTABLE`指定本机模块和浏览器。传仓库外输出目录，网站脚本独占4174并创建临时账户数据，MV3脚本独占4173/8787。脚本模型是显式进程内替身，不读取真实用户模型密钥；脚本结束释放浏览器与服务。应用本地启动方法见[README](../README.md)。

真实模型质量/延迟/费用/长课覆盖、获准B站与其他平台采集、正式地区/监护/跨境/线上身份和跨设备自动同步、真实学习效果、音频/字幕/整文件组合均未通过。当前账号服务只供loopback开发；旧003/005及P0历史未通过项保持独立。插件与网站现为显式JSON迁移，不把手动导入写成自动同步。
