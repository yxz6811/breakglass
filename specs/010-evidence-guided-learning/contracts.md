# 010 实施契约 v1

日期2026-10-07；用户已明确开始按规划写代码，并追加主工作台实时可互动粒子函数。以下v1具体实现契约在编码前冻结；接口是否已可用仍以任务/验证为准。复用008/009账户与学习契约，旧`/read`、`CurveResult`、`createWake`不增字段。治理2.6.2的实施记录承接原则XVII。

第1–4节保留最初的设计约束；具体已冻结的字段、挂载接口和限额以第5–6节及对应实现测试为准。未采用的可选库不构成运行时依赖。

## 1. 本机前门

- 主地址限定用户指定的`http://localhost:8765/extension/demo/index.html`；如支持127.0.0.1别名，逐个列明，不用通配端口。原4174gateway为唯一私有学习服务；8765固定反代现有/api，不重写Origin伪装授权。
- 既有HttpOnly/SameSite=Strict/Path=/api和CSRF保留。Cookie不通过JS/postMessage/localStorage读取或传给reader；token不在DOM和URL显示。
- 允许路径/方法、正文上限、上游截止、取消/断连、状态码及Set-Cookie传递、安全头和资源Range分别冻结；拒绝客户端自选上游、未知Host/Origin和路径穿越。
- 不开放frame-ancestors、远程iframe或生产host来绕过接线。4174扩展桥权限和120秒配对保持；前门失败明确“服务未连接”，本地可预览，不伪造身份。

旧reader拟定兼容映射如下，T001须按客户端实际URL规则验证后冻结；不接受任何客户端自选上游：

| 前门固定路径 | 固定上游 | 保留的独立预算 |
| --- | --- | --- |
| `POST /read` | `http://127.0.0.1:8787/read` | 003整体预读300秒；当前单帧30秒开发默认；旧唤醒1500ms仍独立 |
| `POST /geometry/read` | `http://127.0.0.1:8787/geometry/read` | 几何单帧30秒 |
| `POST /geometry/ask` | `http://127.0.0.1:8787/geometry/ask` | 几何问答10秒 |

账户/API代理截止不能统一套到reader；保留各客户端取消与整轮预读控制。旧reader分支剥离Cookie、Authorization和所有学习身份/CSRF请求头，只转发已冻结数学/帧请求字段；不转发reader返回的cookie。静态白名单必须包含demo实际依赖的`extension/assets/config.json`、preset JSON、JS/CSS与包内素材，禁止对整个仓库开放.env/数据目录。

## 2. 媒体/场景适配

内部适配拟包含：当前HTMLVideoElement引用、完整来源ID/版本与素材许可结果、媒体generation、确认后的数学snapshot/来源及原时间。DOM引用和临时帧不序列化；不得用文件名或标题作身份，手工来源不得冒充视频候选。

mount/unmount/active-pane明确资源所有者；换视频/账号、删除epoch、停止/隐藏使旧结果失效。同一当前媒体只由一个观看跟踪器写记录。每条保存由用户触发并按既有数据校验；选择历史记录不自动切换/seek正在看的视频。

## 3. 学习状态、题目与帮助

拟用独立学习阶段区分prediction/example/completion/practice/reflection，现有attempt只保留实际提交的合法题目答案。新表征/适用条件问题采用独立exercise sidecar，必须冻结题型、版本、确定性judge、数字容差、与原record关系及字段上限；不扩大视觉枚举。

查看任意会泄露该题关键步骤/答案的帮助形成辅助凭据，包含作用题目与代次。隐藏控件、切页和重开题不能清除同次帮助已使用事实；下一次新题独立生成上下文。完整示范、补步骤、预测、笔记、跳过不被当独立完整题正确。

自我解释保存为未评分学生笔记；错因候选可待确认/确认/修改，服务端annotation revision/epoch保护继续适用。反馈规则与新题均有限审校、程序判定；不能执行模型脚本或自由HTML。

当前自我解释记录仍使用普通question类型，不能靠它自动排除混练。需冻结独立的学习用途标识及旧数据分类策略；该标识使用新sidecar，不修改原record。旧记录用途不明时按待分类展示，不能只用可编辑标题或来源文案推定它是可作答题。

## 4. 调度、证据、数据迁移

冻结records.nextReview与historyPlan的统一证据窗口、错答/辅助/独立优先级、时间单位、时区、可修改/跳过语义。初始策略沿用可解释1/3/7/14/28天建议，再做对照；不是研究最优值。队列区分可作答题/解释笔记，基础练习/到期/主动/易混有明确选择理由，不能静默新增attempt。

可选FSRS独立用于概念回忆；冻结again/hard/good/easy的实际回忆评分、日志/算法版本/时间、迁移和回退。禁止直接将数学hintUsed/correct或FSRS保持率转换为全面掌握度。

同一账号复用原4174服务数据；8765与4174浏览器localStorage不同，访客迁移仅显式导出/审核/导入。冻结包大小/条数、来源/record/annotation/attempt关联、去重、损坏与部分拒绝。历史作答不可盲信客户端字段；未经验证的导入证据不更新学习状态。换号/删除阻断旧队列与所有派生写入，派生数据也随所依赖记录清理。

迁移按完整origin区分localhost/127.0.0.1与端口。网站导出包的导入器是新任务；不能把当前仅接受插件记录的`parsePluginPackage`当成已支持attempt/annotation/watch全量迁移。新sidecar用途必须版本化、严格校验并能随record删除。

重算导入答案只能确认数学对错，不能证明该答案曾实际提交或是否独立完成。仅能与当前账号服务原始attempt核对的记录继续作为原证据；其他导入历史另标“用户提供、未验证”，不更新独立表现/复习调度，待新实际作答形成新证据。不得为迁移伪造过去提交事件。

不因本次整合新增原视频/截图持久化；临时帧仍限当前请求。真实模型/素材/部署/学生研究的许可与验收分别引用独立证据。

## 5. 冻结的主工作台/前门契约

- 开发前门连接≤64、请求头≤8KiB/32项，头与正文上传10秒、keepalive5秒；并发静态16/API16/reader4，总36，超额429。测试工厂可注入固定目标的HTTP传输及测试来源，生产CLI不开放上游覆盖。
- 前门监听127.0.0.1:8765，仅接受Host `localhost:8765` / `127.0.0.1:8765`；Origin精确为对应http来源。GET/HEAD可无Origin，写操作须精确Origin；现有账号登录态写入由4174复核CSRF。开发4174允许这两项Origin，生产发布仍只接受原唯一HTTPS来源。固定上游4174/8787，禁止CLI/env/客户端选择其他地址；`NODE_ENV=production`拒绝前门启动。
- API只有现有已列明网站路由/方法及本节learning-flow新路由；不转发`/api/plugin`或未知端点。每次API前转发前用固定`/api/deployment`核对local-development（5秒/4KiB），否则503 `service_not_connected`或403 `development_only`，不另起学习服务。API账户/配置10秒、视觉/音轨30秒；JSON响应≤8MiB，音轨≤64KiB。登录注册正文2KiB、账户64KiB；视觉session/end/clear1KiB、progressive2KiB、read/context4MiB、summary64KiB，audio1KiB。具体路由名单存前门代码并经测试。
- 仅转发原始Origin、Cookie、Content-Type、CSRF与既有必要视觉会话头；Set-Cookie只允许既有固定学习/访客cookie，无Domain且路径限定/api。未知代理头、跳转目标和供应商头不转发。取消、断连、超时中止上游；固定reader仅转JSON/Origin，剥离全部学习凭据及Set-Cookie。reader/read正文10MiB/运输300秒（单帧客户端30秒、wake1500ms保持），geometry/read4MiB/30秒、ask4MiB/10秒；响应2MiB。reader字段按既有schema校验，不新增字段。
- GET查询仅现有`vision/policy?sourceId=安全ID`与`learning/attempts?recordId=安全ID`；其余具体既有客户端必要query逐项在代码白名单列明。安全ID沿用≤128及现有非URL标识规则。静态只明确登记demo/几何/学习站依赖、品牌与fixture；单文件64MiB、GET/HEAD和单Range，错误Range416，编码穿越/越界symlink/秘密配置拒绝。
- `BreakGlass.learningApp.mount(container,{video,isActive,onMediaChange,onViewChange})`是唯一文件/视频URL/来源/观看所有者，返回`setActive/snapshot/chooseFile/loadSample/openSnapshot/saveSnapshot/stop/destroy`。曲线/几何可挂载控制器只借用此video；通过`onSelectFile/onSelectSample`请求媒体所有者，通过`onScene`报告已校验snapshot。旧单页自启动兼容。对共享媒体的旧reader预读默认不自动启用，只有当前登记policy允许且学生明确启用才调用；新主流程仍是gateway显式持续视觉。
- 共享媒体选中、许可结果、source ID/version及generation由owner发出；换源/账号/模式失效旧图形。实时粒子只接收白名单函数/模板和严格有限参数，调用原确定性数学与粒子渲染，不执行生成脚本/HTML/shader。函数仍在二维平面，空间视角不改变数学；参数、2D、公式、粒子同步，2D与低性能/减少动效可用。
- 共享挂载须提供`options.document`为`mountContext`生成的scoped document，容器本身不自动隔离旧ID查询。学习owner还提供`switchView`及学习context；曲线/几何/手工数学的`onScene`传递`{template,snapshot,origin,confirmed,sourceId,sourceVersion}`，退化条件可附`degeneracy`，清场景传null。DOM和原视频不序列化。主工作台旧reader地址固定当前同源，不持久化或接受直连覆盖。
- 旧包内曲线预设原视频3024×1898、≤10秒，坐标依原尺寸。仅完整SHA-256为`10cdba752936a87778e5c82635ef0afbef2ff4071080251cf272ce8810a911f1`且精确尺寸匹配时，统一媒体owner保留该受控素材本地解码；外部文件仍64MiB/600秒/1920×1080，名称/checkbox不能豁免。这不改变帧采样、AI权限、上下文/音轨及旧reader预算。

## 6. 冻结的学习sidecar/服务契约

纯模块`learning-site/learning-flow.js` UMD/CommonJS，无DOM/网络/新增依赖：

- purpose严格字段`{schemaVersion:'1',recordId,purpose,revision,updatedAt}`，purpose只practice/reflection/unclassified；revision正整数，updatedAt标准UTC ISO。无sidecar旧记录为unclassified，只学生明确选择才分类。
- exercise严格字段`{schemaVersion:'1',id,recordId,lessonId,kind,stage,index,createdAt}`。lessonId只parabola-translation/triangle-conditions，stage只completion/practice/delayed，index整数1–20；kind是模块定义的有限内容枚举。题干/答案只从原数学与这些字段计算，客户端不提交题干/标准答案。新题是独立ID，原record/旧attempt不变。
- context严格字段`{id,exerciseId,generation,hintsShown,answerShown,exampleShown}`；hintsShown整数0–3，其余帮助是boolean且单调累计，同exercise重开不清零。服务持久化帮助context，客户端提交不能用false覆盖已使用帮助。
- exercise receipt严格字段`{schemaVersion:'1',id,exerciseId,recordId,answer,hintUsed,correct,outcome,createdAt}`；服务重算答案、创建ID/时间与帮助结果。completion单独列示，不计完整独立题；prediction/example/reflection/跳过不提交receipt。有限错因候选须学生确认，复练分支只接受模块已登记的confirmedCause，否则通用练习。
- 每exercise只接收一次提交；提交后context锁定，拒绝再次作答或新增help。结果解析可直接查看，不改该题历史帮助事实；重练生成新exercise。
- 统一调度由合法数学历史得到wrong1天、辅助3天、连续独立7/14/28天；UTC毫秒+稳定ID排序重放。记录建议只按该record，题型参考不得混入其他题的答案。queue只practice且数学合法；due/manual/foundation/interleaved有限模式，可改日期或跳过，不生成attempt/掌握率。本轮不引入FSRS/JSXGraph，保留可选采用的独立评估理由。
- 账户状态可选新增`flow:{schemaVersion:'1',purposes,exercises,contexts,receipts,reviews}`；旧账户缺字段等价空状态。各purpose/review≤500，exercise/context/receipt各≤2000，总状态仍受8MiB与仓库外目录约束；删除record清依赖，clear/data-delete清全部flow，账号epoch/父会话和beforeCommit再校验。
- review严格字段`{recordId,reviewAt,skippedUntil,revision,updatedAt}`；日期为UTC ISO或null，允许用户改日/暂跳，默认规则不被改写。rev/epoch冲突409保留输入；记录不存在404，超额413，schema错误400，未登录401，未授权来源/CSRF403，迟到能力409/401沿用既有语义。

| 新网站API | 请求（全部写入还带expectedEpoch） | 返回/约束 |
| --- | --- | --- |
| GET `/api/learning/flow` | 无正文 | 当前epoch及flow；不返回其他账号 |
| PUT `/api/learning/flow/purposes/:recordId` | purpose、expectedRevision | 服务purpose修订与epoch，0为新建；旧record不可变 |
| POST `/api/learning/flow/exercises` | recordId、kind、stage、index | 服务从原record生成exercise/context和epoch；lessonId由模板确定 |
| POST `/api/learning/flow/exercises/:id/help` | type hint/answer/example，hint时level1–3 | 服务单调更新context与epoch |
| POST `/api/learning/flow/exercises/:id/attempts` | answer | 服务重算receipt，包含服务上下文的hintUsed |
| PUT `/api/learning/flow/reviews/:recordId` | reviewAt、skippedUntil、expectedRevision | review修订与epoch，不生成作答 |

本机访客flow持久化≤2MiB，账户总状态沿用8MiB；使用独立`breakglass.website.learning-flow.v1`，绑定records的epoch/真实存在ID，与记录删除清依赖。网站访客迁移包≤2MiB/100record/500attempt、100annotation/watch，显式预览与选择；历史attempt/flow receipt只标导入历史，不写权威attempt或调度。源origin按完整scheme/host/port校验，字段与数学双校验。账号复用原服务事件，不通过导入重建过去事件。

后续视觉决定（2026-10-07，2.6.2）：用户将粒子改为连续实线。实时参数/公式/二维图与空间线框同步，函数仍在二维数学平面，几何按已注册边连接，保留相机与回退；内部particle模块名仅用于兼容，不改变数学/来源/账号/模型/预算与外部验收边界。
