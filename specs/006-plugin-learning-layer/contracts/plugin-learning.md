# 006 契约 v1：视觉候选、滚动摘要与本机记录

治理：Constitution 2.2.0；只规范本切片，不改变旧CurveResult/SceneResult/createWake/reader接口。

## 来源与候选

插件来源 `{kind:'visual-session'|'creator-layer'|'manual-notes',id,version,analysisVersion:'1',materialMode:'self-authored'|'licensed'|'permission-pending',title?}`。version为视频内容版本，不以标题为身份；pending元数据可显示，但不能采集/上传/保存对应材料。实际处理依据来自已登记的开发素材或生产权利/平台验证，materialMode请求字段只是防错元数据，不是认证或生产许可。

视觉结果 `{schemaVersion:'1',template:'parabola'|'right-triangle',snapshot,area:null|{x,y,width,height},title,explanation,pitfallHint}`。area是当前裁剪图像归一化0..1，不含裁剪/时间校验时不得贴原画面。parabola snapshot `{a,h,k}`有限且a非零；right-triangle `{AB,AC,unit:'unit'|'cm'|'m'}`正有限、派生BC有限。只接受纯JSON/固定字段/文本上限，不执行生成内容。

热点 `{id,start,end,area,title,explanation,template,snapshot,sourceLabel,origin:'vision'|'manual'|'author'}`；start/end由客户端绑定已采画面秒数与短有效期，end≤duration，不由模型决定。视觉候选须人工核对后互动，人工校正不抹去AI原来源。

## POST /learning/read

请求 `{schemaVersion:'1',requestId,sourceId,videoVersion,analysisVersion:'1',materialMode,frameTime,image}`；image为640宽内JPEG data URL，4MiB请求上限，实际JPEG尺寸/编码校验；不接受视频/字幕/账号凭证。

响应绑定相同身份：`{schemaVersion:'1',requestId,sourceId,videoVersion,analysisVersion,frameTime,status:'candidate'|'unsupported'|'needs_review',result:候选|null,code?}`。一个请求一次视觉调用，无自动重试；候选结构失败不报成功。预算服务端30s开发默认，MV3客户端25s截止先行取消，超过真实浏览器worker生命周期不能假设仍稳定。

## POST /learning/summarize

请求同上身份/materialMode，改为`observations:[{frameTime,title,explanation,pitfallHint,template}]`，不带image/frameTime顶层。64KiB请求、最多20条短观察，仅已校验合法视觉输入。

响应`{schemaVersion:'1',requestId,sourceId,videoVersion,analysisVersion,status:'summary',summary,keyPoints,pitfalls,observedTimes}`；summary≤2000字，数组各≤8短项。observedTimes由程序从请求生成，客户端严格等值核对；不是模型生成的“已看整课”依据。每路最多一个在途请求，服务端各1槽、总2槽；忙429，非法400/413/415，未配置503，模型失败/超时按路由错误契约返回。不打印帧/完整观察/供应商原文/秘密，不持久化学习会话。

## 本机记录

`{id,kind:'question'|'pitfall',source,time,title,note,template,snapshot,origin,sourceLabel,createdAt}`。只有明确学生动作保存；后台生成“常见误区”不等于实际错题。id/UTC createdAt由后台生成，source必须匹配会话固定素材和版本，文本及数学复验。不存原视频/截图/解释全文/音频/URL凭证。当前100条本机上限，无账号或云同步。

storage local保存`{schemaVersion:1,epoch,records}`；保存串行核对会话epoch，清除增加epoch使旧写回拒绝，并按tab/documentId与旧令牌通知对应可见会话停止，重复静止画面也清空私有观察；会话令牌放trusted session存储。停止、hidden/换源/seek/撤权取消识别/总结并清理私有观察；已开启任务的迟到结果按来源/请求/epoch拒绝。未来真实账号、整文件和合法音频是独立契约。
