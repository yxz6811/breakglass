# 010 实施计划

状态：2026-10-07拟定，代码任务未开始。遵守Constitution2.6.0原则XVII；本次治理/文档修订不启用新Origin、host、路由或依赖。主demo范围已写入宪法，后续实施前冻结具体字段/路由/Origin/限额与契约，不重复要求用户授权已明确的入口选择。

## 1. 主入口整合方案

推荐8765同源前门，既有4174学习gateway是唯一账号、分析与插件配对进程。拟新增 `scripts/demo-workspace.mjs` 负责受限静态资源和固定 `/api/*` 反代；转发保留浏览器Origin/Cookie/CSRF/Set-Cookie，4174明确登记8765来源，不能伪装成4174 Origin。主页面真正挂载功能，不嵌跨源学习站。

原因：当前account-client用相对/api与same-origin凭据，8765纯静态站没有API；4174 CSP拒绝iframe；localhost与127.0.0.1跨site会影响Strict cookie。另起账号handler会拆内存会话，单放宽CORS或cookie不是整合方案。

8765前门不得任意代理URL或reader地址；保持Host校验、取消中止上游、请求体/响应界限、HTTP Range、缓存和安全头。只转发现有获准API，旧reader无状态接口另有独立固定目标适配，严禁学习cookie/密码/CSRF送到reader。生产模式不得从本机前门隐式开启。

reader各客户端现有URL构造规则并不一致，有绝对地址和根路径处理；不能假设填入`/reader`前缀就保留命名空间。T001/T004须逐个核对`/read`、几何read/ask和阅读客户端实际请求，冻结同源映射并测试不逃出固定目标。旧路径、时间预算、取消与来源规则逐项回归。

保留4174扩展host及配对地址，不默认新增插件8765 host。真实平台插件仍按原受控范围。实施启动时先核对8765实际占用进程及用户会话，提供有界重启说明，不能批量结束服务。

## 2. 代码位置与职责

| 位置 | 实施内容 |
| --- | --- |
| `extension/demo/index.html`、`demo.css` | 主壳、页内导航、曲线/几何/学习面板、状态/来源与局部样式 |
| `extension/src/page/main.js`、`geometry.js` | 容器化显式挂载/清理、active-pane快捷键、确认后数学交接，保留旧入口兼容 |
| `learning-site/app.js` | 从自动IIFE提取可挂载控制器，注入容器/当前媒体/来源适配；保留原学习站启动 |
| `account-client.js`、`records.js`、`annotations.js`、`annotation-editor.js` | 复用原鉴权/数据，统一复习与迁移语义，不造第二套账号 |
| `pedagogy.js`、`math-workbench.js`、`extension/src/plugin/math-learning.js` | 七模板提示/解释、两微课例题与新exercise、错因分支、队列与窄题型证据 |
| `import.js`、`visual-session.js`、`context.js`、`progressive.js`、`audio.js` | 接当前主舞台及代次；登记许可、覆盖、停止、背压原限额保留 |
| `scripts/learning-site.mjs`、`breakglass-learning/src/server.mjs` | 明确前门Origin、既有鉴权/校验、必要新学习sidecar；正文契约冻结后才修改 |

主demo与learning静态ID没有重复，但demo与geometry有重复`lg-refract/source-label/local-video`；两个演示页都监听全局快捷键。不得复制整页同时自动运行，应限定查询容器及活动场景。学习站全局CSS不能污染主壳。

## 3. 按依赖推进

S0先完成T001–T003契约/内容/基线；S1完成T004–T009同源与主页面接线；S2完成T010–T014提示与两微课；S3完成T015–T018错因/调度；S4通过T020真实模型；S5执行T021真实学习评价。T019/T022/T023覆盖相关阶段的验证/安全回归/记录，外部条件未知时不能勾选T020/T021/T023中的外部验收。

模型留空时继续S1–S3；FSRS/JSXGraph原型为可选T018，不成为基础学习闭环的阻塞。不存在承诺全部学科、任意平台、未知供应商速度的任务。

## 4. 检查方式

重点测试媒体/身份代次、删除epoch/备注revision、原题不可变、提示/例题阶段、混练过滤/排序、注入时间重放、未知Origin/目标拒绝及代理取消。浏览器实际走主路径、旧曲线/几何页、4174账号与MV3配对，检查窄屏、键盘、全屏、减动效和WebGL降级。只对新变化运行相关回归，失败或共享契约变化时再扩大。

模型替身覆盖错误/取消/配置空，真实模型在独立获准样本运行，记录模型、环境、分母、覆盖和失败。学生评价另有研究协议，不使用技术测试替身证明学习收益。所有既有未通过项保留原编号与状态。
