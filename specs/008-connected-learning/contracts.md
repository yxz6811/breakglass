# 008独立契约 v1

## 配对与账号记录

网站cookie+CSRF：POST `/api/account/plugin-pairing` `{}` → `{code,expiresAt,user}`，code为22字符base64url、120秒、一次性；DELETE同路径`{}`撤销该账户全部码与插件令牌。插件POST `/api/plugin/connect` `{code,clientOrigin}`→`{token,user,epoch,expiresAt}`。clientOrigin为`chrome-extension://[a-p]{32}`。令牌绑定父网站会话，最长不超过父会话8小时；密码、cookie、CSRF不得交给插件。

插件其余请求使用`Authorization: Bearer …`、`X-BreakGlass-Client-Origin`，credentials omit；如果请求有Origin必须与该扩展origin相等，HTTP网页origin拒绝。GET `/api/plugin/me`；POST `/api/plugin/disconnect` `{}`；GET `/api/plugin/records`→`{records,epoch}`；PUT `/api/plugin/records/:id` `{record,expectedEpoch}`；GET `/api/plugin/watch`；PUT `/api/plugin/watch/:sourceId` `{source,time,duration,expectedEpoch}`。记录/观看结构复用007严格契约，秒为单位。相同id内容幂等，冲突409；旧epoch409后停止队列，不自动重试到新epoch。无作答同步端点。

队列本机持久包含最小record/accountId/epoch及retryRequired布尔控制位；≤100条，失败/worker恢复后新save和watch不偷偷重发，明确retry先校验/me。import只处理勾选ID，不顺带重试其他队列。请求响应≤2MiB/500条，单通道10秒；expiresAt为Unix毫秒。插件本机消息增加plugin:watch-begin{lessonId}和plugin:watch{token,time}，watch token绑定受控tab/source/duration及配对user/epoch/revision；明确学习层后的实际播放触发，不依赖模型成功，15秒/暂停保存，隐藏/关闭/换源/清除失效，换号后须再播放。

## 网站短片段

复用网站视觉session token，新POST `/api/vision/context`。请求为006身份字段`schemaVersion:'1',requestId,sourceId,videoVersion,analysisVersion,materialMode`加`frames:[{frameTime,image}]`与`contextSourceId`（登记的subtitle-SHA256或null）。1–8张640宽以内JPEG、总请求≤4MiB、严格递增秒、≤600秒、跨度≤30秒。浏览器不得提交cues/文本/URL；gateway依登记字幕指纹及时间窗选择最多12条/6000字，作为内部独立reader输入`cues`。字幕不是音轨识别。

响应保留相同身份，`status:'context',contextSourceId,observedTimes,coverage:{start,end,frameCount,inputTypes},limitations,summary,keyPoints,pitfalls,objects:[{frameTime,result}]`。objects仅输入帧时间和已有严格视觉候选，仍需条件确认。coverage由程序生成，不信任模型宣称。最多4次/session，与实时read共享单in-flight识别槽。上游30秒，客户端≤25秒；取消、换源、隐藏、换账户清理暂存和隐藏视频资源。

## 复练

提示与预测不产生正式作答。变式沿用record v1，单独id、manual-notes来源、origin manual、明确程序生成标记；答案复用007确定性judge与attempt契约。旧record不可被变式覆写。自我解释可由学生明确保存为疑问笔记，不自动打分或计为独立正确。
