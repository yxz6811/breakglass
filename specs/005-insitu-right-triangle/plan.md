# Implementation Plan: 当前帧直角三角形学习闭环

**Feature**: `005-insitu-right-triangle` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Status**: 部分实施。下文保留实施分工与门槛；源码和接口已按本计划落地，任务及实际结果见 [tasks.md](./tasks.md) 与 [验证记录](../../docs/BreakGlass-geometry-validation.md)，真实模型及完整产品验收待完成。

## 目标与边界

在独立几何工作台中，用户暂停视频并显式触发当前帧识别，校对一个直角三角形的标签、已知边长和单位，确认后拖动控制点或输入边长。程序保持 `∠A = 90°`、`AB > 0`、`AC > 0`，通过 `BC = Math.hypot(AB, AC)` 更新结果。用户也能用自然语言提出受支持的修改，查看由实际前后状态产生的解释，恢复原题，回答一道理解题后返回原视频时间。网页预设流程已验证；扩展内与真实模型验收仍待完成。

005 是独立 P1。001 单抛物线 P0、002 打包视觉样例、003 自动开播前阅读及 004 已有曲线切换/提问规划继续使用各自契约。004 不承担识别新图形；005 不为 004 补做三角形识别。保留原有 `CurveResult`、`createWake`、1500ms 超时保底和 003 最多 8 帧/5 分钟自动阅读行为。005 的当前帧上传只能由用户显式触发，不能复用 003 的自动开始事件作为授权。

不承诺任意视频、全元素一比一复刻、任意几何证明、自由公式编辑或化学/物理实验。首版只处理固定机位或录屏课件中的一个直角三角形；图片中的像素位置用于初始定位，题目边长由明确读数或人工输入取得，不能从示意图比例推算。

## 治理依据

本计划按 [AGENTS.md](../../AGENTS.md) 的 005 范围、[Spec Kit Constitution](../../.specify/memory/constitution.md) **2.1.0** 原则 VIII / X 和 [BreakGlass 产品约束](../../docs/BreakGlass-constitution.md) **2.1.0** 执行。005 允许在既有 `breakglass-reader/` 中增加本地无状态的识别与动作提议处理，不授权自建云端业务后台、数据库、账号系统、代码执行服务或远程可执行代码。

2026-10-06 治理复核：独立 `SceneResult` 1.0.0、识别 30s / 问答 10s 开发默认与真实预跑冻结要求继续有效。PR #63 不改变单直角三角形范围，不把批量预处理、新端点、任意形状或 L3 纳入执行。预设/手工、自制素材、真实模型、完整 MV3 和学习验证分别记证据，G1～G8 与任务中的未验收项保留；001/003 的旧接口及 1500ms / 300s 不受本次同步影响。

实施前核对上述版本和 [scene-actions.md](./contracts/scene-actions.md) 一致；若文件未同步，不以本计划覆盖上层规则。进入代码和合并阶段重新核对权限、秘密来源、上传范围、Schema、预算、旧结果拒绝以及 001～004 的行为隔离。

## 实际基线与复用位置

| 已有位置 | 可复用的实际能力 | 005 的限制 |
| --- | --- | --- |
| `extension/src/page/main.js` | 视频选择、暂停/定位、隐藏视频采帧、SVG 原位层、退出与页面清理 | 现有采帧服务于稀疏阅读；005 改为独立当前帧显式触发，不把新场景送进曲线 overlay |
| `extension/src/lesson/ask.js` | JSON 请求、请求身份核对、取消、截止处理 | 是阅读 HTTP 请求，不是现成聊天；005 使用自己的请求与预算 |
| `extension/src/lesson/reading.js` | 003 的采样及已存曲线点规则 | 不修改采样、自动阅读或下一点流程 |
| `extension/src/geometry/content-rect.js`、`alignment.js` | 源像素/内容区域/页面坐标映射；后者部分逻辑依赖曲线求值 | 005 独立 JPEG 预览使用源尺寸 SVG `viewBox` 和等比容器；播放器内叠加时可复用内容矩形，不能把抛物线采样器当三角形校验器 |
| `extension/src/session/session.js`、`wake.js` | 001 的曲线会话和唯一唤醒工厂 | 接口及状态保持原状，005 另建 `geometry-session` |
| `extension/src/curve/validate.js`、`evaluate.js` | 曲线白名单、有限参数和帧身份校验 | 不扩大 `fixture.parabola` 的含义，不为三角形修改 `CurveResult` |
| `breakglass-reader/src/server.mjs`、`settings.mjs` | 本地 HTTP、来源约束、请求上限、环境变量配置 | 005 在既有进程中增加独立路由与预算，不保存业务会话 |
| `breakglass-reader/src/model.mjs`、`read.mjs` | OpenAI 兼容图像调用、结构化候选处理、断开中止 | 现有提示仅读单抛物线和讲解句；新增几何候选与动作提示，不宣称已有对话 |
| `breakglass-reader/src/geometry.mjs`、`locate.mjs` | 抛物线锚点拟合与暗线定位 | 不是通用几何约束求解；不得直接套到三角形识别 |

基线已存在源代码和替身测试，不等于真实模型识别、像素对齐、问答效果或学习效果已经通过。005 任务从未完成状态开始，仅按本轮实际验证证据更新。

## 技术方案

沿用 Vanilla JavaScript、原生 CSS/SVG、现有 Node.js reader 和 `node:test`；扩展不增加打包器、运行时依赖、主机权限、content script 或 CSP 放宽。建议在现有 reader 中复用已冻结运行配置；本切片不另引入服务端框架。

### 独立结果与会话

`SceneResult.kind = "right-triangle"`、`schemaVersion = "1.0.0"`，具体字段、单位白名单、坐标规则、错误码及 HTTP 形状见 [scene-actions.md](./contracts/scene-actions.md)。它不兼容 `CurveResult`，也不通过 `createWake` 的回调发布。新增的 `BreakGlass.geometryScene` 负责校验/计算/动作，`BreakGlass.geometrySession` 负责当前帧、确认后的原题快照、当前状态及请求所有权。

`AB`、`AC` 必须是同一白名单单位下的正有限数；对输入和计算结果再次检查有限性。`BC` 是本地派生量，供应商输出的 BC 不能成为权威答案。每次手动或对话操作只修改一条直角边，另一条边固定；同时修改两边的要求须拒绝并引导用户分步操作。渲染比例与数学长度分离，改变长度时只在约定的三角形模型内重建顶点并保持直角；不随意拖成任意三角形。允许范围来自已校验场景配置，不在模型回复中任意扩大。

候选在用户确认之前不进入可交互数学状态。首次确认冻结 `original` 快照；后续更改和恢复都增加 `sceneRevision`，恢复长度和几何原题不把修订号倒退。手工输入、预设和真实视觉来源持续可见，并记录 `originSource` 和 `editedByUser`。

### 请求与动作

`POST /geometry/read` 仅发送暂停当前帧的单张 JPEG 及必要元数据。开发建议保持宽度不超过 640px、JPEG 0.72；它是采帧建议，不是识别质量已验证结论。几何端点采用每包 **4MiB** 输入上限，在解码和上游调用前拒绝超限；既有 `/read` 的 10MiB 上限保持不变。不发送整段视频，不附带无关历史。

`POST /geometry/ask` 发送当前已确认、已校验的场景和本次问题，不另传视频帧。模型只能提议白名单动作 `set_length`、`explain_change`、`restore_original`，不能返回可执行 JavaScript、任意 SVG/HTML、函数调用代码或权威答案。同一回复最多一条 `set_length`；收到多条改边动作时整批拒绝，不拆成部分更新。动作先进入临时状态，校验全部参数、范围、单位及约束，再一次提交；任何不支持动作、越界、冲突或非法结果都整批拒绝，当前场景和原题快照保持不变。解释使用程序算出的修改前后状态，不能照搬模型声明的 BC。

请求和动作响应均绑定 `requestId`、`videoId`、`frameTime`（秒）以及 `sceneRevision`。切换视频、移动时间、修改长度、重新确认、恢复、取消或退出都使旧请求失效；迟到回复不覆盖新场景。页面保存交互状态，reader 无状态处理一次请求。

### 秘密、预算与失败

供应商地址、模型和秘密由 reader 环境变量提供，扩展包和请求体不含模型密钥。识别 **30s**、对话 **10s** 仍为开发默认独立预算，需真实模型预跑后记录供应商、模型、设备、网络、样本和结果，再冻结验收设置；不是实测时延，也不是 001 的 1500ms 或 003 的 5 分钟口径。

取消、客户端断开或预算耗尽时中止上游，不自动重试具有修改意义的提议，不静默回退成预设成功。非法候选、无图形、模型不可达、超时、预算不足分别给出契约规定的可恢复反馈，保留原视频和已确认场景。服务端只短时持有当前请求，日志不写帧、秘密或完整问题；预设/手工演示须由用户主动选择并明确标识。

## 本轮新增与修改位置

以下源码、测试与记录已在本轮新增；文件存在不代表真实模型和完整产品验收通过，完成状态按任务清单与验证记录判断：

```text
extension/src/geometry-scene/validate.js   # SceneResult 与候选校验
extension/src/geometry-scene/solve.js      # 直角三角形确定性计算与几何更新
extension/src/geometry-scene/actions.js    # 白名单动作与原子提交准备
extension/src/geometry-scene/frame.js      # 单帧采集与源/显示坐标交接
extension/src/geometry-scene/request.js    # geometry/read、geometry/ask 及独立预算
extension/src/geometry-scene/view.js       # SVG 三角形、标签、控制点及状态反馈
extension/src/geometry-session/session.js # 独立 geometry-session、快照与修订号
extension/demo/geometry.html              # 独立 005 工作台入口
extension/demo/geometry.css               # 沿用已有视觉令牌
extension/src/page/geometry.js            # 视频、校对、画板、提问与理解题接线
breakglass-reader/src/geometry-scene.mjs   # 单帧识别请求边界与候选处理
breakglass-reader/src/geometry-model.mjs   # 几何结构化提示与供应商适配
breakglass-reader/src/geometry-actions.mjs # 场景/问题输入与受限动作提议
tests/geometry-scene.test.js
tests/geometry-session.test.js
tests/geometry-actions.test.js
tests/geometry-frame.test.js
tests/geometry-request.test.js
tests/page-geometry.test.js
breakglass-reader/tests/geometry-read.test.mjs
breakglass-reader/tests/geometry-ask.test.mjs
tests/fixtures/geometry/                  # 有效、非法、冲突与迟到夹具
docs/BreakGlass-geometry-validation.md    # 实际运行记录与未通过项目
```

**修改已有文件**：`extension/demo/index.html` 增加工作台链接。005 在独立 `geometry.html` 内完成视频、条件、画板与继续视频，返回该工作台原暂停时间。`breakglass-reader/src/server.mjs`、`settings.mjs` 增加独立路由/设置；reader 的 `.env.example`、README 与根 README 说明配置和实际状态。两个既有静态回归测试允许明确的本机地址示例，并继续拒绝远程运行时代码与非本机请求地址。现有 `main.js`、曲线契约、曲线会话和 003 阅读语义保持完整。

## 分阶段实施与完成门槛

| 阶段 | 工作 | 完成门槛 | 规格/验收映射 |
| --- | --- | --- | --- |
| G1 契约 | Schema、动作、单位、范围、身份、输入上限和失败语义 | 有效/拒绝夹具可被同一契约解释；上下层治理一致；新旧契约隔离 | FR-027～029；SC-003、SC-007 |
| G2 算法/画板 | 本地 3-4-5、长度变更、拖动、原题快照与原子动作 | 手工输入与拖动保持直角；`AB=6,AC=4` 时 `BC=Math.hypot(6,4)`；拒绝 NaN/Infinity/非正值且无部分更新 | US1，FR-007～014；SC-001、SC-002 |
| G3 视频/校对 | 显式暂停当前帧采集、候选编辑/确认、绑定失效与退出 | 不触发 003 阅读；错误帧/尺寸/修订号不挂层；人工确认前不声称题目有效；退出回到原视频 | US2，FR-001～006、024～026；SC-003、SC-004、SC-007 |
| G4 真实识别 | 本地 reader、供应商结构化候选、安全边界与预跑预算 | 至少用 quickstart 冻结的真实片段完成识别、校正、确认；记录成功/失败及预算；替身结果单独标记 | US2；SC-004、SC-006 |
| G5 问答 | 当前场景+问题、白名单动作、解释与旧响应拒绝 | “把 AB 改为 6”与手工修改结果一致，AC保持原值；多条改边或任一非法/越界/冲突提议整批拒绝；解释引用实际状态 | US3，FR-015～019；SC-002、SC-003 |
| G6 学习验证 | 恢复原题、确定性理解题、继续视频及回归 | 恢复准确且 revision 递增；理解题记录对错/重试，不以按钮点击证明学会；返回原暂停时间；旧场景无残留 | US4，FR-020～023；SC-004、SC-005、SC-007 |

每阶段按 [quickstart.md](./quickstart.md) 对应步骤记录通过、失败或未执行及原因。G2/G3 的预设或手工验证可先完成，但不计作 G4 真实识别；G5 的替身动作也不计作真实模型问答验收。理解题只验证本次回答，不能宣称长期记忆或教育效果已经证明。

## 依赖与并行分工

G1 完成后，数学/会话/动作、SVG 视图、单帧请求、本地 reader 可按独占文件并行；负责人和工期尚未指定，不把以下工作流写成已分配承诺。

| 工作流 | 可独立负责的文件 | 前置 | 集成交付 |
| --- | --- | --- | --- |
| 数学与状态 | `validate.js`、`solve.js`、`actions.js`、独立 session 和相关纯函数测试（本轮新增） | G1 契约冻结 | G2、G5 原子提交与修订拒绝 |
| 视图与校对 | `view.js`（本轮新增）、geometry.html/CSS、独立页面测试 | G1；交互联调依赖数学状态 | G2/G3 控件、焦点与候选确认 |
| 帧与请求 | `frame.js`、`request.js` 和相关测试（本轮新增） | G1 | G3 单帧绑定，G4/G5 独立预算 |
| Reader | 三个 geometry reader 模块与测试（本轮新增）、现有 server/settings | G1；真实预跑依赖已配置模型 | G4 候选、G5 动作提议 |
| 集成与证据 | `page/geometry.js`、quickstart、验证记录 | 各模块检查通过 | G3～G6、001～004 回归 |

同一个 `page/geometry.js` 或 `server.mjs` 由一个集成者串行修改；不让多个并行任务覆盖同一区域。整体主线为 G1 → G2 → G3 → G4 → G5 → G6；reader 与请求模块可提前开发，真实识别必须在校对链路和预算预跑就绪后验收。外部模型配置未提供时，继续完成独立本地任务，G4/G5 真实验收保持未通过。

## 验证策略与交付

先运行各新增模块的定向 `node --test <实际文件>`，再执行既有 `node scripts/check.mjs` 和受影响页面/reader 回归；全部交付前运行仓库现有全量检查，前提是工具依赖已满足，并记录实际命令。自动化测试使用替身供应商，不声称访问真实模型。数学、事务拒绝、帧身份和迟到响应测试验证可观察结果，避免用与实现相同的代码作为答案。

浏览器验收覆盖确定的 Chrome 版本、四类内容画幅及窗口变化、长标签/错误提示、键盘输入/拖动替代/可见焦点/ESC、候选确认、恢复和返回视频。对齐基于真实截图测量，双 rAF 仅为绘制机会估计；真实识别和对话耗时分别记录，不能挤入 P0 性能指标。

本轮已实现可独立交付的源码与接口，并执行自动化和网页预设验收。在验证记录中保留未通过项、模型/预算冻结情况、预设/手工与真实识别的分别结论。完成标准仍是 G1～G6 适用门槛及 SC-001～007 的证据齐备；真实模型与完整浏览器证据不足时，005 保持部分完成。

## G7：2026-10-03 通用工作台能力对齐增补

按 [产品Constitution 1.7.1](../../docs/BreakGlass-constitution.md) 和spec的FR-030～041/PAR-01～12补齐通用操作，不修订产品范围或SceneResult 1.0.0，不将003自动阅读/下一点、001超时自动预设或004四图形执行器移入005。原G1～G6和T001～T025的未通过项保留；本次结果填写 [几何功能对齐记录](../../docs/BreakGlass-geometry-parity-2026-10-03.md)。

| 模块 | 本次实现职责 | 保持的边界 |
| --- | --- | --- |
| `geometry.html` / `geometry.css` | Dock与入口、全屏、时间/阶段提示、重试取消、地址记忆/忘记、滑块、示例及记录 | 复用本地共享theme和已有Dock能力；场景布局、来源与确认仍明确，介绍站不动 |
| `page/geometry.js` | 新控件事件、忙碌状态、快捷键保护、焦点及资源清理；连接已有capture/request/session/actions | 标准Video API；定位校验及seek完成后才能捕获，播放/seek/newcapture取消旧请求与场景；不新增自动帧上传 |
| UI状态与存储 | 地址仅保存验证后的origin到`breakglass.geometryReader`；有限消息、草稿、slider范围在页面层 | 禁止credentials；忘记只清几何地址。最多40消息、textContent、标revision、不持久化；手动改边保留历史，换场景/退出清空 |
| 现有数学与HTTP接口 | 新改边入口继续调用既有原子动作；新重试通过既有`/geometry/read`与`/geometry/ask`请求封装 | 不改003 `/read`；无新端点、Schema、提示或密钥；单边修改、Math.hypot、身份/revision校验不变 |
| 实际页面测试与验收 | 覆盖12组能力及已有关键回归，按新增quickstart记录 | 定向测试采用仓库真实文件；替身、网页、MV3与真实模型分别记录，不复制旧556项为本次结果 |

slider按每条边的首次确认值original和当前值current重算显示范围：`min=max(Number.MIN_VALUE,min(original,current)/4)`，`max=min(Number.MAX_VALUE,max(original,current)*2)`，`step=any`。范围属于UI，不写入SceneResult，不限制数值输入的契约允许值；每次滑块事件仍通过set_length及derivedFinite门禁，不能钳制后宣称用户所要求的值已执行。

重试由用户主动触发：识别重新检查暂停帧并生成新requestId；问答仅提交当前已确认SceneResult及文字，生成新actionRequestId。忙碌反馈、取消及失败原因不可隐藏。取消/人工编辑/恢复/播放/seek/新帧/退出都需要撤销相应所有权，旧响应不得修改模型或新增成功记录。返回视频继续回到首次有效场景的保存时间；无效时间或文件不替换当前有效视频。

Alt+B仅本地暂停与保存新帧，明确不上传；只有点击识别才发单帧。新保存帧清理旧场景，与同帧重做识别分开：同帧识别失败保留已确认有效条件，合法candidate通过身份检查后才换review，并须重新确认。Esc遵循全屏优先、问题草稿/请求、编辑控件保护、非编辑区取消或退出的顺序。

本次验证先覆盖本地预设/手工及本地指令，再用明确标注的失败/迟到替身检查请求边界；真实模型预算30s/10s、4MiB上限、密钥/日志规则沿用契约。本次自动与浏览器记录初始待填，不能据通用控件完成而勾选原真实模型或像素门槛。

## G8：2026-10-03 自制几何示例视频增补

按 [产品Constitution 1.7.1](../../docs/BreakGlass-constitution.md) 和FR-042～044增加三段与题目对应的包内教学示例。本次外部素材检索因连接失败未完成，使用项目自制视频替代，明确来源；无新产品范围、接口、场景字段或自动识别权限。原T001～T025的19/25及G7结果分别保留。

| 模块 | 增补实现 | 验证要求 |
| --- | --- | --- |
| [生成脚本](../../scripts/generate-geometry-videos.py)、[几何素材说明](../../extension/assets/video/geometry/README.md) | 生成3–4–5、5–12–13、8–15–17教学MP4，目标12s、1280×720、H.264、无声；题面与预设使用cm，保留自制来源和生成说明 | 检查实际媒体时长、尺寸、编码及无音轨，核对A/AB/AC与题面数值；生成命令以实际脚本为准，不编造已执行结果 |
| `geometry.html` / `page/geometry.js` | 示例select和显式加载；媒体就绪后定位4秒且保持暂停；当前对应示例的题面区间才开放预设条件 | 加载不播放、不capture、不请求reader；校验当前样例身份、暂停、`2 ≤ time < 8`及非seeking，进入review后仍需确认 |
| 现有frame/request/session | 切媒体时取消旧请求、失效旧场景；示例条件复用现有preset候选 | `vertices=null`，不从预先知道的资源条件伪造vision；用户选本地文件恢复通用3–4–5预设，旧回复与媒体promise不得覆盖新状态 |
| 文档及测试 | 素材说明、quickstart §9、T038～T040和本次结果 | 分别记录素材元数据、页面加载/时间/候选来源及失败/迟到检查，真实模型仍需独立证据 |

三个资源为`extension/assets/video/geometry/triangle-{3-4-5,5-12-13,8-15-17}.mp4`。预设场景条件只在用户点击对应入口后读入现有SceneResult 1.0.0，`unit=cm`、`vertices=null`；素材说明中的源图顶点不自动填入候选。不将媒体标识、时间窗或已知AB/AC当作模型识别输出；BC始终由Math.hypot派生。独立或本地文件的普通3–4–5预设仍为`unit=unit`。读取视频的成功与读取题目的成功分别表述。结果写入 [本次功能对齐记录](../../docs/BreakGlass-geometry-parity-2026-10-03.md)，本轮实现和受测检查已完成，实际结果及限制见该记录。
