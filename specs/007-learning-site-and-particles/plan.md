# 007 实施计划

继续原生JS/IIFE、Node内置http/crypto/fs、Shadow DOM、现有数学模块和SVG；粒子采用原生WebGL，无新应用运行时依赖。

| 模块 | 责任 |
| --- | --- |
| learning-site | 独立网站、文件解码/完整指纹、真实访客记录、账号界面、列表/恢复/复练；不上传原文件 |
| learning-site/visual-session | 共用loop/候选契约/overlay，网站当前帧与摘要生命周期，获准来源/帧绑定 |
| scripts/learning-site | loopback静态服务、固定素材指纹策略、已有reader纯函数桥接、取消/载荷/预算，调用独立账号handler |
| breakglass-learning | 本机开发身份/学习持久化服务，与reader隔离；cookie/密码hash/CSRF/归属/幂等/删除epoch |
| plugin/particle-renderer及overlay | 同一数学状态的粒子视角、固定shader、有界资源与SVG降级；插件/网站共用 |
| tests及浏览器证据 | Node拒绝/归属/取消/数学、网站实际文件/账号、插件粒子回归；不替代真实AI/平台/法务/学习证据 |

先冻结契约，分模块实施，集成受控自制素材与显式模型替身验证，记录实际结果后提交原指定规划分支。模型配置按用户决定留空。生产发布条件、完整文件临时模式及声画上下文增强不在本轮启用。
