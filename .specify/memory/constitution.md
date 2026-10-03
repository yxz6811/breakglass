<!--
Sync Impact Report
- Version change: 1.9.0 → 1.9.1
- Modified principles:
  - 无原则变化；仅澄清 005 实施状态以任务清单和验证记录为准
- Added sections: 无
- Removed sections: 无
- Templates status: 依赖模板在运行时读取本文件，本次未改模板
- Deferred TODOs:
  - TODO(SEAM_CODE): 已收敛。wake.js 只导出 createWake，页面改走 onChange，fail 只接受 (code, message)
  - TODO(SEAM_DOCS): 已回写。ownership.md、plan-story-2.md 附录 B、ownership-story-2.md 改为引用本节
  - TODO(FRAME_UPLOAD): 001/003 仍不允许破壁补送单帧。005 按原则 VIII 独立入口允许显式触发的当前帧；整段原视频上传仍不在范围。
  - TODO(VISION_FIXTURE): `visionAdapter` 只允许 `fixture`（随扩展打包的识别样例）；它不等于外部识别已接通，也不授权破壁时上传
  - TODO(PROXY_RUNTIME): 感知代理的语言、框架和部署形态未冻结
  - TODO(DOC_SYNC): docs/BreakGlass-constitution.md 已同步为 1.7.1；005 的系统范围以原则 VIII 为准，实施状态以任务与验证记录为据。
  - TODO(REPO_BOUNDARY): 2026-10-03 起，阅读服务源码放在 `breakglass-reader/`。不打进扩展包，密钥不入库，不部署成云端后台。扩展与演示页仍只做前端
  - TODO(RESET_EXIT): 重置是否保留交互层、退出后是否保持暂停，执行计划仍标为未确认
  - TODO(CURVE_FORM): 抛物线参数形式、初值、范围和步长必须来自最终演示素材，本文件不预设公式
  - TODO(READING_METRICS): 第一处出现耗时、破壁到覆盖层的 20 次热缓存 P95、下一个前后的 currentTime、破壁后的 contentRect 与 maxRatio ≤ 2% 都还没有记录。003 的对应验收保持未通过
-->

# BreakGlass Constitution

## Core Principles

### I. P0 由前端闭环交付

P0 的唯一交付门槛是一个可重复演示的数学抛物线场景：使用团队提供的录屏或固定机位视频，完成播放、暂停、目标帧定位、破壁入口、与视频内容对齐的 SVG 抛物线、参数调整、重置、退出，以及加载、错误、取消、超时和本地预制保底。

P0 不承诺任意视频、通用视觉识别、完整代码沙盒或纯本地识别。预制结果可以支撑演示，但必须标明数据来源。预制路径使用的 `enableLocalMock` 与 `fallbackAfterMs: 1500` 不得依赖服务端存活。

Python/Pyodide、本地 Web Worker 和真实视觉识别各自是独立 P1。每项都要有自己的开关、契约、安全预算和验收记录，不得阻塞或稀释 P0，也不得因本文件自动扩展成完整代码沙盒。

以下内容不属于当前交付范围：用户注册或登录、云端同步、历史记录数据库、点赞分享、多语言、多对象识别、C++/Java/Go 等语言支持，以及其他不直接服务核心演示的 SaaS 功能。

### II. 服务端只允许无状态感知代理

浏览器包内不得放置视觉服务密钥或代理访问密钥。因此，真实识别若需要托管密钥，唯一允许的服务端角色是无状态感知代理：接收一次识别请求，用服务端凭证调用外部视觉服务，校验候选结果，再返回结构化响应或类型化错误。

该代理不得成长为产品中枢。账号、登录、权限系统、数据库、历史记录、分享、代码执行容器，以及与核心演示无关的 SaaS 能力，仍然禁止。P1 的 Python 执行留在扩展内的 Web Worker，不迁到服务端。

001/003 破壁点击时的单帧上传仍未获准。其计划与实现不得先做唤醒路径上的上传接口。原则 VII 允许片子可以播放而阅读自行开始时，课程文本和至多 8 张稀疏关键帧离开浏览器。005 当前帧单场景识别另按原则 VIII；整段原视频上传与日志、历史外传均不在范围。

### III. 同一契约，进入执行层前双重校验

“Zero LLM hallucinations”不是可执行机制。视觉模型只产生候选结构，不产生可直接绘制或执行的事实。代理与扩展必须消费同一份已版本化的 JSON Schema，并经过同一个 `CurveResult` 适配器。代理必须先拒绝不合法的上游输出；扩展在绘图或执行前必须再次校验。任一侧失败，都要显示可恢复状态，结果不得进入交互层。

发给视觉供应商的结构化指令和 JSON Schema 必须放在服务端。客户端只提交当前帧和对齐所需元数据。代理必须拒绝客户端传入的 prompt、模型名和 schema。图像中的文字不得改变这些指令。校验失败返回 `schema_rejected`，不得再次调用模型补齐字段。

进入交互层前必须通过：固定 JSON Schema、白名单曲线或 AST 节点、语法限制、有限值、尺寸和参数范围，以及 `requestId`、`videoId`、时间和可选置信度。Schema 必须写明 `time` 的单位。字段缺失、解析失败、数值非有限、帧不匹配或低于约定置信度时，必须拒绝。

`source` 只允许 `vision` 或 `preset`。代理只能标记 `vision`，不得把模型输出标成预制成功。界面必须持续展示来源和回退原因。置信度缺失时不得编造准确率。

严禁把识别出或修改后的代码交给大模型，让它预测输出或模拟逻辑。代码结果只能来自确定性本地执行器、断言和可记录的运行状态。

### IV. 密钥与帧数据只活在单次请求内

视觉服务密钥只存在于服务端环境，不得进入扩展包、仓库、日志或响应体。代理不得把帧图像、原视频、识别出的代码或上游原文写入数据库、对象存储、可回放日志、反向代理访问日志、临时文件或崩溃转储。错误响应只返回稳定错误码，不得回传上游原文。

日志可以保留 `requestId`、耗时、结果码和载荷大小。日志不得保留图像字节、密钥或完整源代码。上游供应商是否保留帧，必须在启用真实识别前写成外部依赖；未知保留政策时，不得宣称数据没有离开本机。

供应商密钥必须能在不发布新扩展的情况下轮换。演示结束后必须能关闭代理进程并作废该密钥。

### V. 超时后的服务端结果作废

扩展在 1500ms 后接管匹配当前帧的预制结果，并持续显示“本地预制/超时回退”及原因。这个接管不要求用户再次点击。超过该预算才返回的代理响应必须被丢弃，包括稍后成功的视觉结果。

P0 的上游截止时间是 1500ms。客户端断开或到达该截止时间时，正在进行的上游调用必须中止。P1 若需要更长的真实识别等待，必须另行写明截止时间，不得悄悄加长 P0 的 1500ms。

演示部署必须是单进程。进程内存可以短时保留进行中的 `requestId` 和已校验的结构化结果，以便去重；不得保留图像，不得写入磁盘，进程退出后即消失。同一 `requestId` 处理期间不得再次调用上游视觉服务。

回退前必须先校验当前 `requestId`、视频和帧位置。真实业务失败、校验失败和无缓存不得被改写成识别成功；无可用缓存时保留错误、重试和退出入口。

### VI. 页面与结果规则只通过一份交接接口

页面和结果规则之间只有一份模块接口。工厂名、方法名、参数顺序、状态值和回调字段以「交接接口」一节为准。计划、任务、分工说明、测试和页面若再写第二套名字，视为违反本文件。

同一能力不得并存两个导出名或两个状态形状。`createWakeController`、`onOutcome`、`begin`、`isWaiting`、`reason`、`decisionAt` 不是契约，现有实现在收敛前不得再扩展。超时、迟到丢弃和能否绘制只由结果规则判定；页面只渲染这份状态，不得再维护第二套 1.5 秒、容差或错误文案表。

结果字段仍以 `specs/001-insitu-parabola/contracts/curve-result.md` 为准，运行配置仍以 `specs/001-insitu-parabola/contracts/runtime-config.md` 为准。这两份契约描述数据，不授权另建唤醒工厂。

### VII. 开播前阅读不进入破壁的 1.5 秒

2026-10-02 团队书面决定：片子可以播放时即开始阅读，稀疏抽取整段上的画面，不等用户再点一次开始，也不从片头逐帧扫描。第一处结果计算完成且通过校验后，立即停在那一帧，用户可以破壁。该决定不抬高 P0。预先准备的片子仍是 `breakglass-demo-9s.mp4` 上的单点抛物线；它只在回到这支片子时使用。

阅读与破壁分开：

- 阅读在片子可以播放时自行开始。页面必须显示正在读，并允许取消。取消只停止尚未完成的采样；已经校验并存下的点保留。整段阅读截止为 5 分钟。第一处通过的耗时单独记录，允许落到这 5 分钟里。
- 采样最多 8 处，按时长等分后各取一处，相邻至少相隔 1 秒。短于 2 秒的片子只采 1 处。不得从 0 秒逐帧向后扫描。
- 第一处通过校验的结果，不论它是不是时间最早的一处，都把片子暂停到该帧。此后「下一个」只跳到时间更晚、且已经校验并存下的下一处。更早才算完的点不得把播放头拉回去。后台又算完一处时，不改变当前时间和当前覆盖层。
- 「下一个」在下一处已就绪时，先卸下当前覆盖层，再定位。定位落定前破壁禁用。落定指已暂停，且当前时间与该点时间相差不超过 ±0.2 秒。下一处还在读时，停在当前，显示「还在读」，时间不变，覆盖层不换，不得当场再算。没有更晚的下一处且阅读已结束时，按钮禁用，显示「没有下一处」，时间不动。
- 破壁点击只取出该帧已经存好且校验通过的结果，不得发起阅读，也不得等待模型。`fallbackAfterMs` 仍为 1500。从点击破壁到覆盖层出现，热缓存 P95 ≤ 100ms，且至少有 20 次记录。该数与第一处出现的耗时分开保存，不得合并。阅读耗时不得记入预制回退指标。这两项记录以及破壁后的 `contentRect`、`maxRatio` 目前都没有，对应验收保持未通过。
- 每个破壁点只描述一条抛物线，并且必须先通过现有 `CurveResult` 校验，再交给现有 `createWake`。换到的结果必须属于这一帧。画面尺寸不一致时拒绝该点，不得绘制，也不得用预先准备片子上的那条曲线顶上。不得生成 HTML、幻灯片、测验、语音或第二种曲线。不得新增来源枚举、错误码、工厂名或会话状态。
- 一次阅读最多保留 8 个点。`time` 单位为秒，必须落在视频时长内，相邻点至少相隔 1 秒。不合格的点必须丢掉并说明原因，不得绘制。
- 点与当前视频绑在一起。视频更换后，上一支片子的点作废。
- 来源必须诚实。阅读得到的点显示「这次阅读」，不得写成识别成功，也不得显示「识别结果」。预先准备的片子在其自身的单点演示中仍显示「预先准备的示例」。
- 通过校验并完成破壁的点，必须能读到 `contentRect`，且 `maxRatio` ≤ 0.02。尺寸或区域未通过的点不进入这道 2% 计算。该测量目前没有记录，验收保持未通过。
- 读失败、断网，或 5 分钟内一处都没有通过时，丢掉失败这支片子上的点，画面留在用户选中的那一支，不自动换回预先准备的片子。预先准备的片子只在用户点「选择预设」时播放。验收用的另一支片子，地址不得是 `breakglass-demo-9s.mp4`。
- 允许离开浏览器的只有：这次阅读所附课程文本（可空，最长 8000 字），以及至多 8 张稀疏关键帧。不得发送整段原视频，不得在破壁或「下一个」时补送当前帧，不得把文本、帧、密钥或上游原文写入日志、历史或仓库。
- 浏览器包内不得放置模型密钥或阅读地址。不新建数据库或账号，也不把阅读服务部署成云端后台。阅读服务的源码放在本仓库 `breakglass-reader/`，不打进扩展包；模型密钥只留在该目录未提交的 `.env`。

### VIII. 当前帧直角三角形学习闭环（005）

2026-10-03 用户明确解除本次工作的仅前端限制，选择“可验证的单场景闭环”，并要求规划推送至 `123456` 后开始执行。`AGENTS.md` 第 0 节、`specs/005-insitu-right-triangle/` 与本原则共同记录该范围；这项修订只表示允许实施，不表示已实现或已验收。

- 005 覆盖扩展页面、几何题结构、确定性解算、校对、对话动作和本地无状态 reader。运行时沿用 Vanilla JS/CSS/SVG 与既有 Node reader，不新增业务数据库、账号或云端执行服务。
- 首版只支持本地视频中一份清晰直角三角形题。规范化命名为 ∠A=90°、AB/AC 两条直角边、BC 斜边；修改一条边时保留另一边与直角。原图标签可经校对映射为规范化标签。截图可能不按比例绘制，像素距离只能定位对象，不能作为数学边长。
- 用户暂停并显式触发 005 识别后，可将这一帧缩小的 JPEG、视频标识、秒级时间、源尺寸及请求编号发送至本地 reader；界面必须说明用途和将调用已配置的模型供应商。供应商保留策略属于待验证外部依赖，不得承诺纯本地。问答发送已确认的结构化题目和用户问题，不再次上传帧或整段视频。
- 005 使用独立、版本化的 `SceneResult` 与动作契约，代理和扩展均校验。原则 III 的 `CurveResult` 与其来源枚举继续约束 001/003；005 的来源为 `vision`、`preset` 或 `manual`，校对后保留原始来源与用户修正标记。预设与手工结果不得计入自动识别通过率。
- 模型只能输出候选条件或白名单动作 `set_length`、`explain_change`、`restore_original`。首版每次只改变一条直角边；收到多个改边动作或冲突操作时整句拒绝，不部分执行。程序使用正有限同单位的 AB/AC 与 `Math.hypot` 计算 BC，计算非有限、单位冲突、缺条件或动作非法时拒绝。解释中的数值必须取自实际执行结果。用户校对并确认后保存不可变原题快照；恢复必须还原全部条件与结果。
- 005 的请求与视频、帧和场景修订号绑定。换视频、播放离开该帧、取消或退出后，旧结果不得修改题目；问答动作仅作用于其提交时的场景版本。批量修改原子执行，任一项失败全部保持原状态。
- 开发默认识别截止 30s、问答截止 10s、单次请求上限 4MiB；这些是拟采用的独立预算，需真实模型预跑后冻结并记录，不是已测性能。取消/超时必须传递至上游。失败保留原视频并提供重试、人工校对与退出；不自动用无关预设替换该题。识别等待与本地画板更新分别计时。
- 005 通过独立入口与会话实施，不替换下文的曲线交接接口，不改变 `createWake`、`CurveResult`、003 的开播前阅读或 `fallbackAfterMs: 1500`。004 的多曲线与旁边提问保持独立，其不识别新图形的要求不限制 005。
- 原帧与数学示意图并列可追溯。重建示意图按条件验收；001/003 的 2% 原位叠加测量不能代替几何关系正确性。005 验收分别记录算法与画板、预设/手工闭环、真实模型闭环及理解问题结果。长期记忆提升需独立延迟测试。

## 交接接口

本节是 001/003 曲线功能在扩展包内的唯一交接面，挂在 `BreakGlass` 上。它不描述感知代理，也不授权网络请求。005 的几何题会话按原则 VIII 与独立契约实施，不为曲线接口新增别名。修改本节名字、参数顺序或状态字段必须先修订本文件。

### 时钟

唤醒、替身和页面计时共用这一个时钟。禁止再提供 `schedule(fn, ms)` 与 `schedule(delayMs, handler)` 两套参数顺序。

```javascript
clock = {
  now(): number,
  schedule(delayMs, handler): timerId,
  clear(timerId): void
}
```

### 会话

`BreakGlass.session.SessionController` 是唯一会话。状态只有 `paused-ready`、`waiting`、`interactive`、`recoverable-error`。

```javascript
new SessionController({
  videoId, targetTime, frameSize,
  timeTolerance = 0.2,
  externalAttempt = "off"   // off | hang | invalid | late
})
```

`getState()` 与唤醒回调收到的对象是同一形状：

```javascript
{
  status,                  // 上面四个值之一
  requestId,               // string | null
  result,                  // CurveResult | null；fallback 只出现在 result.fallback
  currentParameters,       // object | null
  initialParameters,       // object | null
  code,                    // string | null；仅 recoverable-error 有值
  message                  // string | null；仅 recoverable-error 有值
}
```

页面可以调用 `canWake({ paused, currentTime })`、`updateParameter(name, value)`、`reset()` 和 `getState()`。页面不得调用 `beginWait`、`resolve` 或 `fail`，也不得读取 `pending`、`current`、`error`。

`fail` 只有一种调用：`fail(code, message)`，返回上述状态，且 `result` 为 `null`。禁止再接受 `fail({ code, message })`。

进入 `recoverable-error` 时，`code` 与 `message` 只使用下表。页面显示 `message`，不得按 `code` 再写一套文案。

| code | message |
| --- | --- |
| `preset_unavailable` | 当前帧没有可用的准备结果，无法进入交互。 |
| `preset_disabled` | 本地预制未启用，无法进入交互。 |
| `external_unavailable` | 外部结果不可用，未进入交互。 |

`start` 在尚未暂停到目标时间时返回 `{ ok: false, code: "not_ready", message: "请先暂停在目标时间。" }`，会话保持 `paused-ready`，不进入 `recoverable-error`。

### 唤醒

唯一工厂是 `BreakGlass.wake.createWake`。页面、测试和计划都调用它。

```javascript
createWake({
  session,    // SessionController
  config,     // 每次判定重新读取 enableLocalMock、fallbackAfterMs、prewarmed、externalAttempt、visionAdapter
  preset,     // 已装入的预制结果；没有则为 null。不得改成 resolvePreset 回调
  clock,
  onChange,   // (state) => void，state 与 getState() 同形
  attempt     // 仅测试可注入 { start, abort }；页面不得传入，也不得引用 attempt 模块
})
```

返回的方法只有：

```javascript
start({ paused, currentTime, frameSize })
  // => { ok, code?, message?, requestId? }
cancel()                 // => state，回到 paused-ready
exit()                   // => state，回到 paused-ready
onPlaybackChange({ paused, currentTime })  // => state
dispose()                // 清理定时器；等待、交互或可恢复错误中则结束会话
```

`onChange` 在状态变化时发出。`visionAdapter` 缺省或为 `"off"` 时，`interactive` 的 `result.source` 只能是 `preset`，`result.fallback` 为 `null` 或 `"timeout"`；仅当 `visionAdapter` 为 `"fixture"` 且 `externalAttempt` 为 `"off"` 时，允许 `result.source` 为 `"vision"`、`result.fallback` 为 `null`，并且必须携带 `result.evidence === "packaged-sample"`。其他 `visionAdapter` 取值一律视为 `"off"`。回调不得另带 `fallback`、`reason`、`elapsedMs`、`decisionAt` 或 `discarded`。是否等待只看 `status === "waiting"`。

`externalAttempt === "off"` 时，匹配的预制结果立即进入 `interactive`。`hang` 与 `late` 在 `fallbackAfterMs`（必须为 1500）到期后才可以回退。`invalid` 不得画成成功。取消、退出、播放或离开目标时间之后，迟到结果不得再改变状态。

### 替身与计时

`BreakGlass.attempt.createAttempt` 只供唤醒协调器或测试使用。

```javascript
createAttempt({ mode, clock, lateAfterMs, preset })
  // mode: "off" | "hang" | "invalid" | "late"
  // start(ctx) => Promise<{ ctx, candidate } | null>；hang 不结束
  // abort()
```

`BreakGlass.latency.createLatencyLog` 只在内存中保存状态、毫秒数和缓存状态。

```javascript
createLatencyLog({ clock, limit = 200, cache = "hot" })
mark(name)                         // => number | null
measure(from, to, cache?)          // => number | null
record(name, ms, cache?)           // => number | null
summary()  // { [name]: { count, p50, p95, max, cache } }
           // cache 为 "hot" | "cold" | "mixed"
snapshot()
reset()
```

`cache` 只允许 `hot` 或 `cold`。`extension-open`、`video-first-frame`、`network-wait`、`p1-init` 必须拒绝。不得写磁盘、`chrome.storage`、网络或帧内容。回退耗时由页面在「判定超时」和「首个可见 SVG 帧」调用 `mark` 或 `record`，不从唤醒状态里读取时间戳。

## 后端约束

以下规则仅在原则 II 的上传决定已经记录、并且真实识别被单独立项后适用。

- 代理是独立的无状态进程，演示部署必须是单进程。它不拥有用户、会话、迁移或后台队列。进程内存只短时保留进行中的 `requestId` 和已校验结构化结果。本仓库在 `AGENTS.md` 仍限定前端职责时，不得把该进程的实现放进本仓库。
- 客户端只提交当前帧和对齐所需元数据。请求体上限为 4MiB；超出必须返回 `invalid_input`，不得截断后继续调用上游。结构化指令和 Schema 只存在于服务端。
- 响应必须是约定的 JSON，而不是 HTML 或未文档化的文本。失败使用稳定错误码：`invalid_input`、`unsupported_scene`、`schema_rejected`、`provider_error`、`timeout`、`budget_exhausted`。
- 在 P0 范围内，代理只接受数学曲线场景。代码场景必须先有独立的 P1 开关和契约；即使返回代码候选，也不得在服务端执行。未列入白名单的曲线和其他对象返回 `unsupported_scene`。
- 健康检查不得调用视觉供应商，也不得接受帧数据。
- 非本地环境必须使用明确的来源允许列表。该列表不是身份认证，不得对任意来源开放帧上传。扩展包内不得放置代理访问密钥。
- 并发、频率和上游调用预算必须写在运行配置中。预算用尽时返回 `budget_exhausted`，不得继续调用上游，也不得在超时后自动重试。
- P0 上游调用必须在 1500ms 或客户端断开时中止。P1 的更长截止时间必须单独记录。
- 代理必须用固定夹具证明非法输出会被拒绝、合法抛物线候选会被放行。夹具不得包含真实密钥。
- 代理的语言和框架不是本文件的不变量。选定后必须锁定版本、密钥来源和本地运行方式，并保持可被另一实现替换，只要 Schema 与错误码不变。

## 前端基线与质量门禁

本节收录已批准的扩展与前端规则。本文件不表示这些能力已经实现。

### 技术路线

- 交付形态是 Chrome MV3 扩展加浏览器前端。P1 可以使用本地 WASM。扩展侧不得新增代码执行容器、数据库或服务端鉴权；服务端角色只受原则 II 约束。
- 技术路线只能选一条并写入执行计划：Vanilla JS + 原生 CSS/SVG，或 Preact + 固定构建工具（可含 Tailwind）。不得把 Vanilla JS、Preact 和 Tailwind 同时写成无条件技术不变量。没有既有工程约束时，P0 默认采用 Vanilla JS + 原生 CSS/SVG。
- P0 优先使用原生 SVG 绘制。P1 如引入 Pyodide 或绘图库，必须锁定精确版本、资源来源、完整性校验和离线资源策略。`Pyodide v0.25+` 或未锁定版本的 Function-Plot 不能作为可复现依赖声明。
- MV3 manifest 权限、content script、service worker、Worker/WASM 路径和 CSP 约束必须记录在执行计划中。扩展不得加载远程可执行代码。

### 零侵入与支持边界

- 视频控制、当前时间和源尺寸读取只能使用标准 HTML5 Video API，包括 `currentTime`、`videoWidth`、`videoHeight`、播放/暂停事件和元素实际显示矩形。扩展注入、生命周期和消息通信可以使用 MV3 content script、service worker 和标准消息 API。
- 首版只承诺已验证的域名和页面结构：页面中存在可访问的目标 `<video>`，扩展可以在其上方挂载独立透明 overlay。跨域 iframe、权限不足的 iframe、Shadow DOM、DRM、无法访问的媒体和未验证播放器不纳入验收。标准 DOM 不能绕过同源限制。
- 只在 `<video>` 上方挂载独立 SVG/overlay。不得改写播放器控制条、拦截广告或 DRM、替换媒体源，或进行会破坏原网页的 DOM 变更。按下 ESC 或退出后，必须移除 overlay、监听器和消息通道，播放器立即回到原网页状态。

### P1 Pyodide 与 Worker 安全

本节仅在 P1 开关启用时适用：

- 每次执行使用可重建的 Web Worker。超时、取消、异常或页面卸载时强制 `terminate`，并显示对应状态。不得让旧 Worker 继续占用页面。
- 默认安全预算为：单次执行 watchdog 2s、输入 ≤ 256KiB、输出 ≤ 64KiB、内存目标 ≤ 128MiB。浏览器不能保证跨平台的硬内存隔离。若运行时无法测量内存，必须记录该限制，并在超时、OOM 或异常时 terminate。未冻结或未验证这些预算前，P1 不得宣称可执行任意 Python。
- 禁止网络访问、动态安装包和未列入白名单的包或模块。只加载随扩展打包或经过完整性校验的固定资源。
- Pyodide、WASM、Python 包和绘图库的首次加载、Worker 初始化和缓存命中分别计时，不得混入 P0 预制交互指标。

### 本地预制

每一个交互节点都必须读取静态 JSON 配置中的 `enableLocalMock`。配置至少包含 `enableLocalMock`、`fallbackAfterMs: 1500`、预制结果键和是否已预热的标记。预制 JSON 必须符合统一 `CurveResult` 契约，并与视频标识、目标时间、帧尺寸、图形区域和参数范围匹配。

`enableLocalMock` 是明确的构建或运行配置，不得在生产构建中意外开启。P0 的时间目标是：在冻结设备和热缓存条件下，超时事件到首个可见 SVG 帧的 P95 ≤ 100ms。该指标不含网络、扩展注入、视频首帧解码或 Pyodide 初始化。

### 几何映射

坐标实现必须区分原始帧像素、数学坐标和页面显示坐标：

1. 使用 `video.videoWidth` 和 `video.videoHeight` 作为源尺寸。
2. 使用视频元素实际显示矩形，结合 `object-fit`、`object-position` 和视频内容区域计算 letterbox/pillarbox 后的映射。
3. 固定 SVG `viewBox` 原点、缩放比例和坐标方向，并在窗口变化、全屏、页面缩放和设备像素比变化后重新计算。

验收至少覆盖 16:9、4:3、竖屏和带黑边样例，并按冻结的像素误差阈值检查叠加位置。首版支持范围锁定为录屏或固定机位课件。不支持手持晃动、强透视或动态实拍，也不要求前端自动判断视频是否符合该范围。抛物线的具体公式、初值、范围和步长以最终演示素材为准，未确认前不得写成已冻结数学定义。

### 性能口径

所有性能数据必须记录事件起点、终点、缓存状态、浏览器和测试机器，并报告 P50/P95。至少分别记录：

- 预制交互首次可见：用户触发预制路径到首个 SVG 帧绘制。
- 感知等待：请求发出到真实结果、错误或超时。
- 回退显现：超时事件到缓存 SVG 首帧。
- Pyodide 首次初始化和缓存初始化。

“200ms 冷启动”不得作为未定义的总指标。若保留该目标，必须明确只适用于热缓存预制路径，并在执行计划中写出设备、浏览器、网络和统计口径。

### P0 验收证据

- 目标视频可重复播放、暂停和定位。破壁入口只在合理状态可用。
- 预制曲线、参数、拖动、重置和退出可重复执行，来源始终可见。
- SVG 在四类宽高比和窗口变化后保持与视频内容区域对齐。键盘焦点和 ESC 路径可用。
- 加载、资源失败、识别失败、超时、取消和无缓存都有可操作反馈。旧请求不能覆盖新帧。
- 超时回退使用匹配的本地 JSON，且不冒充真实识别。结果按本节性能口径记录。

P1 只有在开关、契约、安全预算、精确依赖版本和测试证据齐备后才可标记完成。其余内容写为实验或外部依赖，不得声称已实现。

Spec、Plan、Tasks 和代码审查必须能指出：当前能力属于 P0 预制、P1 真实识别，还是尚未批准的上传。未确认的字段必须标为建议，不得写成已有接口。

## Governance

本文件是 BreakGlass 已定产品约束的单一治理源，也是 Spec Kit 的治理源。优先级为：本文件 > 已确认的需求和接口契约 > Plan 与 Tasks > 实现偏好。根目录 `AGENTS.md` 继续规定本仓库的前端工程做法；产品范围与本文件冲突时，以本文件为准。

`docs/BreakGlass-constitution.md` 1.7.1 已指向本文件。既有服务端角色以原则 II 为准，开播前阅读以原则 VII 为准，005 的系统范围以原则 VIII 与 `AGENTS.md` 第 0 节为准。阅读服务源码可以放在 `breakglass-reader/`，不打进扩展包。005 可扩展该本地无状态 reader，其独立接口与预算必须有契约和验证。

005 的实施与验收状态以 [任务清单](../../specs/005-insitu-right-triangle/tasks.md) 和 [几何验证记录](../../docs/BreakGlass-geometry-validation.md) 为准。治理文本批准范围，不能替代真实模型与完整产品证据；部分实施不得标记为完整验收通过。

用户的最新明确决定可以启动修订，但不能形成未写入本文件的例外。发现任务、需求、计划或代码违反本文件时，必须在进入实现或合并前标记，并说明影响。需求与本文件冲突时，先修订并递增版本号，再回写 Plan 与 Tasks。低层文档不得静默覆盖本文件。

修订本文件必须更新版本、日期和变更记录，并同步受影响的需求分析与执行计划。MAJOR 用于删除或重定义不可协商的原则。MINOR 用于新增原则或实质扩大约束。PATCH 用于澄清和不改变含义的文字修正。

每次 Spec、Plan、Tasks 和代码审查都要检查：P0 能否离线演示、技术路线是否只选一条、MV3 权限与 CSP 是否写入计划、服务端任务是否越出感知代理、密钥是否可能进入浏览器、Schema 与结构化指令是否在服务端、`time` 单位是否写明、上游调用是否在截止时间中止、调用预算用尽后是否停止、固定夹具是否覆盖拒绝与放行、超时结果是否会被当成成功、P1 是否单独开关、页面与结果规则是否调用同一份交接接口、开播前阅读是否加长了 1500ms 或把一段视频的阅读结果套到另一段视频上。计划或测试里出现第二套工厂名、回调名或状态字段时，必须先改回本节，再继续实现。例外必须记录原因、影响、责任人、有效期限、恢复条件，以及是否阻塞 P0。没有记录的例外不算批准。

本文件不授权在 `AGENTS.md` 修订前再新建别的后端，也不把未实现的 P1 视为已经完成。`breakglass-reader/` 是原则 VII 允许的那一份阅读服务源码。

**Version**: 1.9.1 | **Ratified**: 2026-10-02 | **Last Amended**: 2026-10-03

## 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.0.0 | 2026-10-02 | 首次批准。确立 P0 前端闭环，并把服务端限制为尚未获准开工的无状态感知代理。 |
| 1.1.0 | 2026-10-02 | 写入原先只在前端基线中批准的技术路线、零侵入、Pyodide 预算、预制配置、几何映射、性能口径和 P0 验收证据。 |
| 1.2.0 | 2026-10-02 | 补齐感知代理的可执行约束：服务端持有指令与 Schema、单进程去重、上游中止、调用预算、密钥轮换，以及拒绝/放行夹具。 |
| 1.4.0 | 2026-10-02 | MINOR：只为已经存在的 `vision` 来源开一条受开关约束的进入路径。`visionAdapter` 缺省或 `off` 时 `interactive` 的 `result.source` 仍只能是 `preset`；`visionAdapter` 为 `fixture` 且 `externalAttempt` 为 `off` 时允许 `source` 为 `vision`、`fallback` 为 `null`、`evidence` 为 `packaged-sample`。不新增来源枚举、不新增错误码、不改 `createWake` 的方法名与参数顺序、不改状态名。 |
| 1.5.0 | 2026-10-02 | MINOR：新增原则 VII。开播前阅读列出 1 到 5 个抛物线破壁点，截止 60 秒，不抬高 P0，不加长 1500ms，不新增来源、错误码、工厂或会话状态。只允许用户主动开始的那一次送出课程文本和至多 5 张关键帧。 |
| 1.6.0 | 2026-10-02 | MINOR：修订原则 VII。片子可播放即稀疏阅读，最多 8 处、截止 5 分钟。第一处通过即停在该帧；破壁和「下一个」只使用已存结果。尺寸不符不得用预制曲线顶上。读失败或断网回到 `breakglass-demo-9s.mp4`。热缓存 20 次 P95、`contentRect` 与 `maxRatio` 尚无记录，验收保持未通过。 |
| 1.7.0 | 2026-10-03 | MINOR：阅读服务源码改放在本仓库 `breakglass-reader/`。不打进扩展包，密钥只留在未提交的 `.env`，不部署成云端后台。 |
| 1.8.0 | 2026-10-03 | MINOR：原则 VII。阅读失败、断网、地址为空或 5 分钟内没有通过点时，不再把画面换回 `breakglass-demo-9s.mp4`。用户选中的片子留下，失败片子上的点丢掉。示例片只在点「选择预设」时播放。 |
| 1.9.0 | 2026-10-03 | MINOR：新增原则 VIII，按用户最新范围记录 005 当前帧直角三角形学习闭环。允许本地 reader 的独立单帧识别与受限问答，补充校对、确定性解算、来源、帧/修订号绑定和独立预算；同步 AGENTS、前端基线、需求分析和执行计划。保留 001/003/004 与既有交接面；规划不等于实现。 |
| 1.3.0 | 2026-10-02 | 冻结页面与结果规则的唯一交接接口：一个时钟、一个会话状态、一个 `createWake`，以及替身和内存计时的调用形状。禁止并行的唤醒工厂和别名字段。 |
| 1.9.1 | 2026-10-03 | PATCH：澄清 005 的实施状态以任务清单与验证记录为准，同步产品 Constitution 1.7.1 和受影响文档。未改变范围、原则或准入门槛；真实模型及完整产品证据不足时仍保持部分完成。 |
