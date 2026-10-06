# 007 契约 v1

来源在006契约基础上新增kind local-file；id=file-加完整文件SHA256，版本1/analysisVersion1。固定自制素材登记才把permission-pending转换为self-authored；其他本地文件允许预览。学生自行输入的通用数学条件用独立manual-notes来源，id=manual-file-SHA，标记非AI且不保存原视频内容。

## 网站/视觉

文件MP4/WebM<=64MiB、duration<=600s、width<=1920/height<=1080。完整文件只在本机读取以解码及计算指纹；没有整文件上传API。

GET /api/vision/policy?sourceId=file-SHA 返回{allowed,source?,reason,supplierConfigured,limits}。GET /api/vision/config 返回未配置/可用状态和非秘密说明，不返回API key。POST /api/vision/read及summarize沿用006严格请求/响应，服务端复核登记身份/版本、帧时间与用途，不凭请求materialMode授权。每类单在途，30s服务端/25s客户端；4MiB帧/64KiB观察/20观察/每会话32识别和8摘要/30min。不接受音频、字幕、视频文件、页面prompt或任意代理URL。来源/换源/seek/隐藏/删除停止并丢弃迟到结果。

显式开始先POST /api/vision/session {sourceId}，服务登记获准来源后返回本次opaque token。read/summarize须带x-breakglass-visual-session，token绑定来源及Origin；POST /api/vision/session/end {token}取消上游并失效。每类全局单槽、会话≤16，预算在服务端也执行；新会话不能使用旧token，停止不只是隐藏界面。

BreakGlass.webVisual.createSession({video,source,cssText,onSave,manualOnly?})返回{start,stop,destroy}；未获AI许可时为独立手工来源。onSave接收006最小记录字段，网站补id/createdAt；实际保存结果{ok:true,storage:'local'|'account'}供UI准确反馈。

## 账号与学习记录

本机开发API，不代表正式云发布。Origin仅允许配置的loopback站点，登录后写操作要求HttpOnly SameSiteStrict会话cookie和X-BreakGlass-CSRF。密码在服务端使用随机salt/scrypt，客户端不存密码/密钥，响应不返回hash或内部token。数据目录仓库外，最小JSON原子串行持久化；个人媒体/长字幕/原始请求/供应商原文不存。

| API | 形状及责任 |
| --- | --- |
| POST /api/account/register、login | {username,password}→{user:{id,username},csrfToken,epoch}，真实cookie；Origin必检、限流 |
| GET /api/account/me | {user:null}或{user,csrfToken,epoch}；不自动导入访客记录 |
| POST /api/account/logout | {ok:true}并失效会话，界面立即隔离旧身份/取消队列 |
| GET /api/learning/records | {records,epoch}；每条符合006record、仅当前账户 |
| PUT /api/learning/records/:id | {record,expectedEpoch}→{record,epoch}；路径id等于record.id，同值幂等、冲突409 |
| DELETE records/:id或records | {expectedEpoch}→{ok:true,epoch}；epoch推进并清相关attempt，迟到旧保存409 |
| GET /api/learning/watch、PUT /api/learning/watch/:sourceId | GET列表{items,epoch}，PUT{source,time,duration,expectedEpoch}→{item,epoch}；pending来源仅可保存私人观看元数据，不授权AI |
| POST /api/learning/attempts | {recordId,answer,hintUsed,expectedEpoch}→{attempt,expectedAnswer,epoch}；triangle数字、parabola{h,k}，程序判定正确/用提示/独立/错误 |
| GET /api/learning/attempts | {attempts,epoch}，可recordId过滤；只记录实际作答，不把疑问直接判错 |
| GET /api/learning/export | {schemaVersion:'1',user,epoch,records,watch,attempts}，无媒体/hash/session |
| DELETE /api/account/data | {expectedEpoch}→{ok:true,epoch}，清当前学习数据并防旧写复活，退出不等于删除 |

前端明确选中本机记录后导入目标账号；账号代次绑定每个请求，切换/退出/清除取消并拒绝旧响应。服务器独立验证身份/归属/epoch，不相信客户端隐藏项。同步失败保持可重试状态，不无限重试、自动换账号或计时器假成功。地区/未成年人/供应商/跨境正式服务条件单独验收，loopback开发服务不被称为合规已上线。

## 粒子

BreakGlass.particles.createRenderer({canvas,template,snapshot,reducedMotion?,onFallback?})→update/setView({yaw,pitch})/resetView/destroy/getState；仅parabola/right-triangle，sampleScene所有数学z=0。最多2048点，DPR<=2、画布<=1600，固定源码shader，有界生命周期，无永动RAF。不可用/上下文丢失/低性能保留同一数学SVG；模型不产生shader或执行代码。
