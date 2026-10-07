# 011 契约与冻结条款

日期：2026-10-07。用户已授权执行011。**状态：文末011实施契约v1的C01–C06已冻结，实施验证进行中。** 以下原提案保留供追溯，文末冻结条款优先；冻结不表示代码或验收已完成。治理及006–010的严格来源、权限、scope、epoch、响应边界和历史预算继续有效。

## C01：识别许可撤销与生命周期

主工作台拟持有单调递增的 `permissionGeneration`，独立于媒体 generation、账号 owner/epoch、面板激活和请求 token。每次请求捕获所有相关身份；reader 开关取消、许可失效、换源、换号、销毁或页面隐藏均使相关请求失效并调用取消。

曲线和几何控制器拟提供内部 `stopReader()` 钩子，只中止网络/等待中的识别与模型问答，不触发重新勾选，不覆盖视频或已确认的手工数学。返回、候选显示、本轮候选确认/派生保存和缓存提交前再次核对完整身份及当前许可；任何不匹配丢弃。重新启用产生新代次，不接收旧响应。已经确认且允许保留的数学，关闭 reader 后仍可手工保存和复练；停止识别、退出登录与素材处理授权撤销分别处理，开关取消本身不删除合法历史记录。

这不是旧 `createWake` 的新方法或新状态，不修改旧唤醒工厂；具体控制器钩子形状与停止覆盖范围在实施前冻结。网页撤销可阻止后续提交并要求上游中止，但不能声称撤回已经送到供应商的数据。

## C02：统一学习证据投影

输入仍为同一数据范围的合法 `records/attempts/annotations/flow`，复用当前 validator、数学 judge、帮助凭据及导入可信度规则。输出是只读派生视图，不落库、不把 receipt 转存为 attempt。

拟输出事件键、来源类型、recordId、exerciseId（旧题为空）、stage、时间及 correct/hintUsed/outcome；事件键按 `attempt:id` / `receipt:id` 命名空间去重，并绑定当前 scope/owner/epoch。派生学习结果为 `independent-correct/assisted-correct/wrong`，与阶段分别保留；completion 不代替对错/帮助事实。非法关联、未知原题/题型或数学/帮助字段不一致的凭据排除全部权威统计与调度。未验证历史保留原可信度与待核对显示，不参与权威掌握统计或调度，不能升级为独立正确。

- `completion` 单列，不算完整独立题，其合法错答可进入有错答记录；prediction/example/reflection/跳过没有作答事件。
- 错题记录数按 recordId 去重；活动列表按事件排序，两类指标不相加。
- 近期独立正确与辅助正确分列，延后新题保留阶段；掌握仅使用既有窄题型证据措辞。
- 调度汇总旧 attempt 与新 receipt/review 的实际证据；已有 flow 调度规则可复用，避免同一到期项重复显示。
- 纯投影不能清除帮助、修改原记录/答案、升级导入可信度或自动评分自我解释。

主概览、记录筛选、状态标签、近期活动和复练入口必须使用同一投影规则。本机访客跨标签 flow KEY 变化触发安全刷新；账号沿用服务刷新或版本通知，不把 localStorage 事件当账号同步。两者的更新时限及冲突策略在 S0 冻结，编辑中保留草稿并提示冲突；删除/换号仍走既有清理与隔离流程。

## C03：新共享识别与来源 sidecar

旧 `/read` 和 `CurveResult` 不增加字段/来源枚举。为使共享工作台获得公式、定位及来源的独立依据，拟在现有 4174 网关增加**版本化的单帧候选通道** `POST /api/vision/recognition`；8765 仅为固定路由映射。该路径目前不存在，是否采用及最终严格字段须先冻结，不能直接向旧接口附加未知字段。

拟请求为既有视觉身份字段 `schemaVersion/requestId/sourceId/videoVersion/analysisVersion/materialMode` 加 `kind:'parabola'|'right-triangle'`、原视频 `frameSize` 与一张 `{frameTime,image}`。复用 `X-BreakGlass-Visual-Session` 和登记来源核对；学生声明 materialMode 不代替服务许可。JPEG 沿用 006 单帧限制，总正文不超过 4MiB；frameSize、JPEG/原视频比例、登记尺寸/像素量与可选 ROI 映射必须一并冻结并校验，不能直接信任浏览器尺寸。现有登记项没有完整视频尺寸，若返回原位包需补可信登记元数据；否则只返回归一化候选，不附可挂载的旧曲线。

当前本机 classic visual session 在 `releasePolicy=null` 时可能没有 owner，不能声称已经具有完整账号/访客 epoch 绑定。S0 必须冻结受限会话创建模式，使新通道从创建时由服务确认 private owner/epoch；旧 owner=null 的会话不允许在请求时默默升级归属，需明确重新开始。任何浏览器提交的 scope/epoch 不替代服务授权。新 recognition 与已有 read 必须累计同一个 `session.read` 和 `slots.read`，客户端也共用 readCalls，不新建独立计数或槽位；总 32 次额度保持，合法供应商调用开始前累计，失败/超时不返还，切 kind/入口不重置，拒绝 progressive token 混用。沿用网站客户端 ≤25s 总截止/上游 ≤30s 与前门有界取消；客户端从采集开始计算，不在 POST 时重获完整 25s。旧 30s 单帧路径及 300s 预读独立保持。

拟响应包括等值身份、`status:'candidate'|'insufficient'`、有限数学候选、定位状态和 sidecar；新公开响应、客户端流读取与前门专用响应均拟 ≤64KiB，其他旧路由限额不变。只有满足旧校验时才附现有形状的曲线或几何 scene。精确字段与类型化错误清单为 S0 冻结项，不能先上线宽泛对象。新包须有明确桥接器和 `visual-session.request`/网关/前门接线；旧 current-frame 与 geometry 接收器不能直接接新包。结构候选与缺数学/位置的部分结果仍可用于可见提示，不自动保存为已确认原题。

sidecar 拟分为：

| 项目 | 含义与约束 |
| --- | --- |
| 身份 | requestId、来源/内容/分析版本、frameTime、原帧尺寸；临时绑定媒体/许可代次和 owner/epoch，不信任模型生成身份。 |
| 公式依据 | 新单帧只用可读题面；区分一般式/顶点式/无数值依据，有限系数由程序换算。登记上下文/学生输入为独立探索条件，不补截图缺失标注或升级为帧核对。模型自报依据仍是候选，需校验。 |
| 数学状态 | candidate/consistent/insufficient；consistent 只代表有限条件和程序计算自洽，不能等同于已读对原视频。 |
| 定位状态 | unknown/candidate/checked/student-calibrated；标定依据、坐标转换和歧义检查独立记录。checked 表示规定检查通过，不等于教师或留出样本验收通过。 |
| 确认 | 学生明确动作和所确认条件/版本；渲染成功不生成确认。撤销/换源后不能确认旧候选。 |
| 派生关系 | 原候选、原数学与当前探索的引用；改参数形成探索，不升级原视频对齐或识别质量。 |
| 版本 | 非秘密 profile、prompt、calibration 版本；用于重现与缓存隔离，不含密钥、Cookie 或原始响应。 |

上表是语义草案，尚不是现有 schema。临时 sidecar 只在内存保存有限结构，不留帧、音频或完整模型文本。保存仅持久化学生明确确认后必要的来源/派生关系；持久化需新增**独立 sidecar 契约**，不得修改 record v1 或向严格 flow v1 偷加字段。本机 sidecar 建议 ≤500 条/512KiB；账号 ≤500 条/账号且纳入现有整个 account store 文件 ≤8MiB 的总限额，8MiB 不是每账号配额。迁移包与导出合并限额另在 S0 冻结。删除父 record/数据时级联清除；素材授权撤销按原许可和留存边界删除或去关联，停止识别/退出登录不等于删除历史。beforeCommit 核对 owner/epoch 及对应来源留存许可。最终本机 key、账户路由的 CSRF/修订/epoch/父 record 关联、迁移/导出/删除及失败恢复形状须一并冻结；仅保存了数学且 sidecar 失败时不能声称来源已保存完整。

## C04：数学与原位定位

抛物线候选只能是严格一般式 `{form:'general',a,b,c}` 或严格顶点式 `{form:'vertex',a,h,k}`；原始系数有限，其幅度/精度上限为 S0 冻结项，b/c 不假称已有注册范围。程序负责 h=−b/(2a)、k=c−b²/(4a) 和数值稳定性检查，换算后的 a/h/k 再按已注册模板范围校验；a=0 不进入抛物线。不解析任意字符串或运行表达式。

原位定位至少区分原点、x/y 单位比例、目标对象及可见域。允许非等比例坐标；没有数值刻度且没有可读公式/登记条件，不能从形状确定精确系数。ROI/缩放/原帧/显示 `contentRect` 的转换明确、可逆且有限；墨迹匹配、模型锚点残差和置信度各自不能升级为真实位置已验证。

旧曲线 ≤短边 2% 的误差要求与四画幅呈现证据保持。新的歧义分差、坐标检测容差、最低图像质量和人工标定操作须用授权夹具校准并冻结；不得编造已达标数值。005 独立几何画板不套用曲线像素门槛。方程合法但位置不足时不返回可原位挂载的曲线，提供独立数学画板及文字入口。

## C05：模型能力与资源边界

服务端拟配置有限 profile：入口与模型、temperature 发送/省略/有限固定值策略、允许的 reasoning 参数、图像传输、JSON 输出模式和 profileVersion。配置校验依据具体供应商入口，不能把一家服务的限制推广给所有同名模型。未配置时无供应商请求；不支持当前 inline JPEG 时拒绝，不自动上传公网图片或静默更换模型。

曲线 `askModel`、几何 `askGeometryModel` 和复用后者的 read/context/summary 等路径使用同一兼容规则；ASR 独立。拟将现有 64KiB 上游读取上限覆盖旧曲线：真实响应流解析前计数并取消，非流测试替身也核对长度。保留各公开旧路由既有响应限额。错误记录有限 code/stage/elapsed/version，剥离完整上游内容与秘密。

缓存非秘密身份加入 profile/prompt/calibration 版本，保留来源、字幕/采样、scope/epoch、TTL/条数/容量和许可核对。老版本候选不能跨配置复用；取消/断连/删除后的迟到结果不写入。统计耗时与资源不能采集原始媒体或完整学生文字。

## C06：UI、测量与发布

UI-A45–53 见[优化方案](../../docs/BreakGlass-recognition-optimization-plan-2026-10-07.md#5-学习记录和-ui-对齐)。继续八个面板与统一视频 owner、既有视觉令牌、键盘、文字等价入口、减动效和 2D 回退。保存处显示实际 scope，与当前顶栏身份分别有明确含义。

性能比较绑定相同素材/尺寸/源码/配置与负载，列全部样本数、P50/P95/超时/429、事件循环、RSS和实际费用。去重前的廉价签名必须经小符号变化测试；只有测出收益才采用，不能增加采样/上传额度。有限调度/worker/启动并行化均待数据决定，不提前新增依赖或多服务。

拟发布清单包含提交、资源哈希与非秘密运行识别配置版本、支持入口和实际验证范围；不包含账号、密钥或私有媒体。本机 8765 工作台和静态展示不同能力分别标注；同一发布包不靠临时源文件修改适配供应商。公开托管、平台/地区与未成年人发布仍须原有独立证据。

## 011实施契约v1

2026-10-07：用户在规划推送后要求“可以执行任务”，随后要求多个会话共同分工。先冻结C01/C02，其他条款须在对应编码前补齐；旧接口和预算保持。

### C01 冻结：取消接口

- 主workspace持有单调permissionGeneration；curve/geometry mount增内部options.getPermissionGeneration()，未传时独立页代次为0。每次模型操作捕获媒体代次、owner/epoch、permissionGeneration及请求token，返回再次检查canRead/isActive和所有身份。
- 两页面控制器返回内部stopReader()，取消当前帧/预读/几何识别及模型问答，失效请求token，不修改createWake公开接口、不重新勾选、不清掉已确认手工数学。workspace在开关关闭、许可失效、换源/换号、隐藏、销毁时推进代次并调用；新开关代次不能接纳旧响应。
- 尚未确认的旧AI候选不可继续确认/派生保存；已经确认且合法保留的数学允许reader关闭后的手工保存。停止、退出登录、授权撤回和删除分别遵循原规则。
- 初始化/销毁以generation和AbortController守卫，所有工作台自有监听可清理；局部失败释放已创建控制器/媒体/请求，不重复挂载。生命周期修复无需引入并行依赖加载或新框架。

### C02 冻结：证据与范围

- 新增learning-site/learning-evidence.js纯投影模块，不落库、不改attempt/receipt/record/flow字段。attempt:id和receipt:id分命名空间；唯一合法父record、exercise、context与receipt组且原数学/帮助判定一致才有权威证据。重复/矛盾组整体排除；导入未验证历史不参与权威掌握/调度，保留待核对展示。
- stage与correct/hintUsed/outcome分别保留，outcome沿用既有合法值。completion保留真实对错/帮助，可显示近期和错题，但不计完整独立题、掌握状态或间隔调度。practice/delayed及合法旧attempt参与现有窄题型状态；错题记录按recordId去重，近期按事件排序。同名旧/新ID不得冲突或重复制造连续答对。
- 概览、记录/实际错题、近期和队列共用投影规则；调度沿用原1/3/7/14/28天产品规则。仅显式purpose=practice参与复练，笔记/观看/预测/例题/跳过不生成作答。纯投影禁止清帮助、改原题或提升导入可信度。
- app内部公开context.getSaveTarget()返回{scope:'local'|'account',label,owner,epoch,canSave}，并通过options.onScopeChange(target)在有效范围/身份变化时通知workspace。label为纯文本本机访客或具体账号；owner为现有learningOwner()值；保存按钮附近常驻显示该真实范围，canSave=false时不可冒充已保存。getter、callback不新增服务路由。
- 本机records/annotations/flow storage事件同步刷新；同owner且父记录/题目仍存在时不清未提交答案、解释、备注、错因/复习日期草稿，更新权威帮助与提交锁，冲突文字提示。父记录删除或owner/epoch变化才清旧草稿。账号沿用可见活动页面10秒服务刷新与generation/epoch/序号守卫；storage不是账号同步。后台/隐藏期间不承诺实时刷新，恢复后刷新。
- 新投影模块由主会话加入HTML/前门白名单和workspace依赖；两协作会话只修改分配的实现文件，主会话整合与验证。

### C04 冻结：有限公式

- 新内部normaliseEquation只接受严格general{form,a,b,c}、vertex{form,a,h,k}及旧模型兼容{a,h,k}。不接受字符串数值、accessor、原型/未知字段、非有限值；每原始系数绝对值≤1e6，abs(a)≥1e-6。换算后a/h/k绝对值≤1e6，注册曲线的有限域校验继续执行；先检测除法/平方/减法溢出。a=0拒绝，不假称新抛物线识别支持直线。
- 模型可读一般式时直接给a/b/c，程序换算h/k。旧输出a/h/k兼容，外部CurveResult形状不变。题面不清、无数值依据或多对象不明确必须拒绝/降级；课程文本/字幕不能填补截图缺失数学标注。
- 原位校验细则由C03新通道冻结，不将旧墨迹72%或锚点自洽升级为位置真实正确。旧路径保持兼容，新的可信定位只在新通道使用。

### C05 冻结：模型与上游读取

- 服务端新增有限profileVersion='recognition-profile-v1'；READER_TEMPERATURE_POLICY仅fixed/omit（默认fixed），READER_TEMPERATURE严格有限0..2（默认0）；READER_REASONING_EFFORT可留空或none/minimal/low/medium/high/xhigh/max；READER_IMAGE_TRANSPORT仅inline/public-url（默认inline）。未知配置拒绝，不解析任意JSON头/参数或自动换模型。jsonMode继续现有布尔配置，ASR独立。
- inline JPEG只在inline策略下发送；public-url策略遇到当前data URL明确unsupported，不自动托管或公开图片。具体模型允许值由部署者按入口文档配置；这组有限配置不是自动兼容任意模型的证明。
- 同一profile构建器覆盖askModel与askGeometryModel及复用后者的read/context/summary。默认保持既有temperature=0；omit不发送temperature，fixed只发送已校验值，reasoning未配置不发送。
- 两入口共用真实响应流≤64KiB读取和abort race；累计超限即cancel且不解析，迟到不回传，非流测试替身也验证字节数。错误类型不含完整上游内容；原public路由错误/字段兼容。profile非秘密身份导出供网关cache/providerVersion使用，含温度/输出/传输/推理及profileVersion，不含密钥。
- 模型预算不变，无自动重试。空基础配置无供应商请求；本轮不凭替身测试宣称真实模型通过。

### C03 冻结：受限单帧与来源记录

- 新POST /api/vision/recognition，严格请求{schemaVersion:'011.1',requestId,sourceId,videoVersion,analysisVersion,materialMode,kind,frameTime,frameSize,image}；kind仅parabola/right-triangle。1张≤640宽JPEG，原帧尺寸必须与自制登记元数据一致且JPEG比例一致，正文≤4MiB，秒在登记duration内；不接收ROI、字幕/文本、URL或凭证字段。首轮仅全帧，裁剪留待独立版本。
- /api/vision/session新增可选capability:'recognition-v1'，原{sourceId}兼容。新能力创建时由privateOwner服务绑定账号/访客，owner=null旧会话不接受新通道；新capability会话的原read与recognition共用session.read/slots.read、32次额度和客户端readCalls，切kind/入口不重置。新请求不接受progressive token。采集起客户端25s总截止，上游30s；失败/超时不返还已开始的调用额度。显式prepare只创建会话，不采集/启动loop，start仍需主动连续启用。
- 原会话结束、账号/epoch变化、失效/隐藏/换源中止新请求；返回前检查来源登记仍有效、session身份和private owner。新响应、客户端读流与前门专用响应≤64KiB，固定路由/方法；旧接收器不接新包。
- 响应严格{schemaVersion:'011.1',requestId,sourceId,videoVersion,analysisVersion,kind,frameTime,frameSize,jpegSize,status,candidate,evidence,limitations}。status仅candidate/insufficient/unsupported；candidate为null或{template,snapshot}，snapshot复用现有有限数学校验。evidence严格{formulaBasis,mathStatus,placementStatus,map,calibrationBasis,profileVersion,promptVersion,calibrationVersion}；formulaBasis仅visible-equation/visible-lengths/none，mathStatus仅candidate/consistent/insufficient，placementStatus仅unknown/checked，calibrationBasis仅none/authored-reference，map为null或有限{ox,oy,sx,sy}且sx/sy正。limitations为≤8个有限代码，不含模型全文。
- 首轮模型只从题面提取有限一般式/顶点式或明确A直角及AB/AC与单位，不从外形猜数值、不用字幕补题面。无依据/多对象不明确返回insufficient/unsupported。模型的basis声明仍是候选，consistent仅是程序数学自洽，学生确认后才进入保存/探索。
- 普通素材定位默认unknown。自动checked只允许版本/时间绑定的自制登记标定参考和独立像素检查共同通过；sx/sy分别检查，归一化参考点/可见曲线误差≤短边2%，竞争对象/低清晰度拒绝原位。墨迹拟合与模型自报锚点不得直接checked。独立画板始终可用；人工输入正比例和合法原点只标student-calibrated，不升级为自动checked。005几何维持独立画板，无新增原位顶点能力。
- 浏览器新增recognition-contracts/provenance/recognition-workbench有限模块。app.context.getVisualSession()/prepareRecognitionSession()复用同一webVisual控制器；该控制器新增prepare()/recognize({kind,frameSize},signal)，不启动连续loop。workbench由workspace显式mount，停止/销毁/活动/许可代次守卫；确认/保存处展示来源、数学与位置状态，学生可改有限条件、用2D独立画板，保存后复用原实线工作台。
- 必要provenance为独立schemaVersion:'011.1'的学生确认来源sidecar，按recordId关联，不塞旧record/flow。保存元数据为{recordId,requestId,sourceId,videoVersion,analysisVersion,frameTime,frameSize,template,originalSnapshot,placementStatus,map,profileVersion,promptVersion,calibrationVersion,confirmation:'student',attribution:'student-confirmed-candidate'}；placementStatus在持久层仅unknown/student-calibrated，map按前者为null、后者有限合法，不把客户端声明当服务证明的模型正确或自动像素证据。record必须与来源/版本/时间/template关联，原数学仍独立。
- 本机存储KEY='breakglass.website.provenance.v1'，≤500条/512KiB，绑定recordsStore epoch；账户新增GET /api/learning/provenance及PUT /api/learning/provenance/:recordId，请求{metadata,expectedRevision,expectedEpoch}，响应{provenance,epoch}；服务生成revision/updatedAt，CSRF/账号/epoch/beforeCommit核对、原parent存在且关联合法，修订冲突409、同内容幂等。账户provenance可选字段，旧文件等价空数组，≤500条/账号并纳入整个account store文件8MiB上限。
- 删除父record、清records或data-delete级联provenance；本机epoch变化清除/拒绝旧sidecar。开关停止/退出登录不删除合法历史。导出含独立provenance；旧迁移包不自动接受新字段，新版迁移严格审核/同来源关联/去重/总限额后单独启用，首轮只导出不新增迁移能力，旧流程兼容。

### C06 冻结：测量与交付

- 分阶段测量/版本清单仅有限非秘密字段；采样先低成本检查或worker/并行加载只有对照收益和小符号召回不退化时才采用，未采用亦如实记录测量决定，不新增依赖。
- 自制夹具、有限公式与坐标、取消/投影/有界流、新通道HTTP/保存/删除与UI-A45–53分别验证。当前版本真实模型、四画幅实际呈现/MV3、教师/学生与正式发布均独立；没有条件的任务不勾。
