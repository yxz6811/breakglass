# 010 拟定契约与冻结清单

日期2026-10-07；治理依据Constitution2.6.0原则XVII。状态：**设计约束，具体契约尚未冻结，不是现有API文档**。T001须在实现前将字段、Origin/路径、上限、错误码、版本/迁移与治理逐项核对冻结。复用008/009账户与学习契约，旧`/read`、`CurveResult`、`createWake`不增字段。

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
