# 009 独立契约 v1

## 记录修订 BG-F06 / BG-U10

原 record v1 不变。annotation 固定为 `{schemaVersion:'1',recordId,revision,title,note,kind,tags,updatedAt}`。title 1–120、note≤1000、kind仅question/pitfall、tags≤8且每项1–24字符；纯文本，不接收媒体、URL、数学、来源或作答字段。revision正安全整数，ISO毫秒时间。

网站 GET `/api/annotations`、GET `/api/annotations/:recordId` 返回当前账户 `{annotations,epoch}` 或 `{annotation:null|annotation,epoch}`；PUT后者仅接受 `{annotation:{title,note,kind,tags},expectedRevision,expectedEpoch}`，无annotation修订为0。相同内容幂等；不同内容修订不匹配409 revision_conflict，输入留在编辑器待明确重新读取。原记录不存在404；账号/epoch失效拒写。删除record或清学习数据同时清annotation。客户端另存本机sidecar，按当前原记录和epoch校验；不改v1插件导出，不自动上传访客修订。

## 渐进片段 BG-F02 / BG-U03

沿用008 context帧契约。单片段≤30秒、≤8帧，独立显式progressive任务最多20个片段/600秒、30分钟任务截止；已有context会话4次不变，不能自动新建任务绕过额度。最多600秒本地文件。当前片段优先，每个结果独立就绪；取消/暂停停止网络，未覆盖区显示未分析。缓存仅结构化候选，不存帧、原视频、密码/令牌；key含source kind/id/version/analysisVersion、模型配置非秘密指纹、字幕指纹、采样时刻和当前账户/本机scope、epoch。有效TTL≤24小时、≤40条/2MiB；每次复用核对服务policy、版本、权限与scope，删除/撤权/换号清或拒用，迟到结果不写。新来源/模型或字幕版本不命中旧缓存，命中显示前次AI分析和原稀疏局限。

## 手工数学 BG-F05/F07/F08

新增模板只允许origin manual、source manual-notes。严格数值范围、数学定义、程序判定与来源标识；已有vision candidate继续只接受parabola/right-triangle，旧CurveResult/createWake不变。新独立变式不覆写原题。固定先修知识图谱基于课程定义，诊断以实际提交为据，不从学习时长推算掌握；复习间隔与渐退提示仅为基于历史的产品建议。

| template | snapshot / 范围 | 实际判定 |
| --- | --- | --- |
| line | `{m,b}`，两者有限且绝对值≤20 | y轴截距b |
| circle | `{h,k,r}`，中心绝对值≤20、r在[0.1,20] | 面积πr² |
| sine | `{A,omega,phi,k}`，A[0.1,10]、omega[0.1,5]、phi[-2π,2π]、k绝对值≤20 | 周期2π/omega |
| similar-triangles | `{a,b,c,scale,unit}`，边[0.1,100]且严格三角不等式，scale[0.1,10]，unit仅cm/m/unit | 对应面积比scale² |
| cuboid | `{length,width,height,unit}`，边[0.1,100]，unit仅cm/m/unit | 体积length×width×height |

共享canonical `extension/src/plugin/math-learning.js`由Node/worker/受控注入/状态页/网站使用。所有数值必须有限、严格字段，单位显式。相似三角形按1e-6退化容差拒绝无效关系。二维模板粒子z=0；长方体真实8顶点/12边由条件计算，非视频重建；粒子≤2048、≤5缓冲区、DPR≤2/画布≤1600，SVG主图始终保留。知识图谱为固定七个窄题型节点，可跳过，实际诊断与普通作答分别计数；未知状态待验证。

## 音轨 BG-F12 / BG-U13

独立 POST `/api/audio/session` `{sourceId}`创建登记素材音轨能力，POST `/api/audio/transcribe` `{token,start,end}`，POST `/api/audio/session/end` `{token}`。端点只服务固定网站Origin，无客户端文件、URL、字幕文本、音频载荷或secret；server registry选唯一已登记源文件。单session≤2次、≤30秒/次、单在途，deadline≤30秒；服务端固定FFmpeg转16kHz mono PCM16 WAV≤1MiB，stdin关闭、shell关闭、输出有界，取消杀子进程和上游，不写原素材/临时片段磁盘。返回实际时间范围、供应商转写候选、未识别声画关系的局限，不自动成为题目/完整课摘要。ASR供应商地址/模型/key与FFmpeg路径为空可配置，配置空诚实失败。选择音轨功能须显式触发，视觉默认不含音轨。

## 发布准备

生产运行配置独立于默认loopback，必须严格域名/TLS代理来源/外部数据路径/地区与受众/许可和数据流审批资料。没有生产配置时默认只本机；可执行检查报告待确认项，不把布尔勾选当外部审批证据。生产支持与真实部署各有任务和实际验证。MV3默认host和activeTab不扩大；公网插件请求地址须另冻结具体origin/构建，不提供任意地址或all_urls。

manifest严格字段为 `{schemaVersion:'1',mode:'production-pilot',runtimeFingerprint,publicOrigin,dataDir,operator:{name,contact},countries,audience,expiresAt,evidence,accounts}`。文件/数据目录均仓库外绝对路径，拒符号链接/路径逸出；清单和单证据≤128KiB，证据≤64、账户1–50。publicOrigin唯一规范HTTPS根Origin；countries具体ISO国家、audience仅adults/minors。每国家/受众必须有rights/privacy/regional-release/supplier-data-flow及未成年人对应minor-guardian证据，严格hash/到期/监护引用；证据法律充分性由负责人审查，不由代码推断。非秘密runtimeFingerprint包含实际视觉/ASR地址、模型、模式、启用状态，不含密钥。

生产仅监听可信loopback代理后，严格Host、`X-Forwarded-Proto:https`和环境随机edgeSecret，Secure cookie，账户UUID/地区/受众批准；公网自助注册、guest API及公网插件配对关闭。classic和progressive任务绑定当前身份，上游前后/缓存写入复核审批；音轨创建/提取后/供应商后复核。报告只给匹配/计数/稳定错误码，不出凭据/私人路径/账户UUID/证据内容。GET `/api/deployment`仅返回mode/registrationEnabled/publicDeploymentVerified:false/pluginConnectionMode:local-only/explanation；不冒充真实公网验证。配置空生产视觉session及处理503，不建任务。

生产供应商非空baseUrl只允许HTTPS或明确localhost/127.0.0.1/[::1] HTTP，拒凭据/query/hash/反斜杠/无效和数字别名地址。CLI、runner、生产gateway均校验；生产fetch强制redirect:error，不把媒体或密钥转送到新地址。默认development与旧reader配置接口不改变。

## 访客缓存清除

POST `/api/vision/cache/clear`与`/api/vision/cache/clear-guest`只接受`{}`，必须当前允许Origin。前者清当前服务身份；后者只清浏览器HttpOnly guest标识，在登录时不会清账号缓存，旧标识作废并停止相关任务。访客ID/sessionKey不交给客户端数据模型或持久化文件。本机清除尚未得到服务确认时本地持久化pending标记，UI可明确重试，guest分段分析暂不复用。

缓存提交guard同步检查内部会话仍存在/未到期、账户已提交epoch或访客标识，另复核任务/来源/审批；不依赖下次定时清理。原子rename期间失效时，在同一串行cache队列内恢复上一份已提交快照，不返回缓存成功，也不让本次候选在重启后重新出现。内部isPrivateScopeLive/peekEpoch只返布尔/数字，不增加HTTP或客户端身份字段。
