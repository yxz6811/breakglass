# Implementation Plan: 持续视觉首切片

**Date**: 2026-10-06 | **Spec**: [spec.md](spec.md) | **Governance**: Constitution 2.2.0 原则 XIV。

沿用原生JavaScript/IIFE、MV3、CSS/Shadow DOM、SVG、Node本地无状态reader和node:test，无新增应用运行时依赖/数据库/生产部署。开发浏览器测试依赖留在工具环境，不打入扩展包。

| 模块 | 责任/真实数据流 |
| --- | --- |
| manifest / background/service-worker | 显式action注入仅受控页；固定loopback请求桥、逐来源会话/额度/取消、trusted storage；B站许可pending打开扩展自己的状态页 |
| plugin/registry / contracts | 固定开发素材映射；来源/版本、候选、数学snapshot、短结构记录双校验；页面自报许可不可放行 |
| plugin/session / live-loop | 可见video实际JPEG与量化变化指纹；最新帧背压；来源/时间/epoch；结构观察窗口及独立摘要；失败停止，无自动重试 |
| plugin/overlay | Shadow UI热点/list、AI与校对来源、确定性函数/三角形、记录callback、识别状态和摘要覆盖；正常分析不改播放头 |
| plugin/record-store / plugin/status | 单调记录epoch/串行写入/清除；本机真实保存及快照查看，无账号登录模拟 |
| reader/learning / learning-summary | 严格JSON/图片/观察校验、单模型调用、每路单并发、预算/断开取消；不持久化画面、内容或身份记录 |
| learning-lab / scripts/learning-lab | 只提供受控自制视频与静态页面，验证插件在网站实际视频上的流程；不提供预制分析替代视觉输入 |

数学继续复用curve/evaluate与geometry-scene的validate/solve/actions，不修改CurveResult、createWake/startCached或旧reader接口。默认当前video可读帧先行；跨域/iframe/保护画面失败明确提示；截图/共享是后续获准适配，并非任意站点fallback。

识别/摘要各最多1个在途请求，总上限2；首条候选给局部摘要，再新增3条语义观察更新。最多20观察/32候选的私有内存；未保存记录不跨会话。视觉新调用不借用003至多8帧/300s或P01500ms预算。

实施顺序：冻结规范与契约 → 候选/数学和循环控制 → 单帧/摘要服务 → UI/来源/记录 → MV3接线 → 安全/生命周期/回归 → 真实模型和获准平台/地区预跑。每项对应BG-VR01–14、F/U与证据。任务见 [tasks.md](tasks.md)。

外部依赖：视觉服务密钥/模型能力/供应商处理地区未配置；B站素材/平台许可待确认；真实账号/网站文件/粒子/学习效果独立后续任务。这些依赖不阻断受控自制素材、契约和替身验证，但不能被列为已通过。
