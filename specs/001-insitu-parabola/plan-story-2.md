# Story 2（P2）实施规划：等待失败时仍然诚实、可恢复

> 状态：**规划稿，未实现**。日期：2026-10-02。
> 依据（只读引用，未修改）：`specs/001-insitu-parabola/spec.md`（User Story 2、FR-009~012、SC-003/005/006）、`quickstart.md` 第 2 节、`data-model.md` 状态机、`contracts/runtime-config.md`、`contracts/curve-result.md`、`docs/BreakGlass-constitution.md` 第 4/6/8 节。
> 上游对照：<https://github.com/yxz6811/breakglass/blob/main/specs/001-insitu-parabola/tasks.md>（分支 `main`，提交 `2438bd19f708`）第 84–94、116、121 行。

本规划只回答「做什么、按什么顺序做、怎么证明做完」，不含实现代码。按 `tasks.md` 现有约定，故事 2 故意没有任务编号；下文的 T019–T030 是**建议编号**，只有在治理门禁（见第 5 节）解除后才写回 `tasks.md`。

## 1. 需求基线（逐条可验收）

| 编号 | 来源 | 可观察的验收行为 |
| --- | --- | --- |
| AC-1 | FR-009 / SC-003 / quickstart §2 | `externalAttempt: hang` 且存在匹配的热缓存预制时：到达 1.5 秒**无需再次点击**即出现预制曲线；来源持续显示「预先准备的示例 · 超时回退」及原因；从判定超时到首个可见 SVG 帧 ≤ 0.1 秒 |
| AC-2 | FR-009 / 契约 late 行 | 超时回退之后才到达的外部结果**不得改变曲线**（迟到一律丢弃） |
| AC-3 | FR-010 / SC-005 | 没有匹配的可用预制（`prewarmed: false`、预制缺失或与当前帧不匹配）时：显示可理解的失败说明，两步内可「重试」或「退出」，界面不得显示曲线为成功 |
| AC-4 | FR-010 / 契约 invalid 行 | `externalAttempt: invalid`：非法外部结果按失败处理；即使存在匹配预制，也不得把它呈现为识别成功 |
| AC-5 | FR-011 / SC-005 | 等待中取消：回到暂停画面，等待提示消失；随后到达的结果不再打开交互层 |
| AC-6 | FR-012 / SC-006 | 连续 5 次「退出→再唤醒」或「换帧→再唤醒」：只有与当前视频、当前时间匹配的结果留在画面上 |
| AC-7 | FR-008 / Constitution §4 | 交互全程持续显示来源；`source` 只允许 `preset`，本交付不产生 `vision`；预制结果不得伪装成识别成功 |
| AC-8 | FR-013 | 等待或交互中视频播放、离开目标时间：定时器与覆盖层一起清理，不留残余 |

SC-003 的度量口径（必须写进记录）：只统计**判定超时 → 首个可见 SVG 帧**；不含打开扩展页、视频首帧解码、任何 P1 初始化与网络等待。

## 2. 现状与差距

| 现状 | 证据 | 差距 |
| --- | --- | --- |
| `fallbackAfterMs: 1500` 只是静态声明 | `extension/assets/config.json:3`；`grep fallbackAfterMs extension/src` 无命中 | 没有任何代码读取它，1.5 秒回退不存在 |
| `enableLocalMock` 只在启动时读一次 | `extension/src/preset/load.js:17` | Constitution §6 要求「每一个交互节点都读取」，需要每次唤醒重新判定 |
| 非 `off` 外部尝试被直接阻断 | `extension/src/session/session.js:50-58`（`external_attempt_unavailable` → `recoverable-error`） | 这是 P0 的临时护栏；P2 要把它变成可演练的 `hang`/`invalid`/`late` 行为 |
| 唤醒是同步的，没有等待态 | `extension/src/page/main.js:183-207`（`beginWait` 后立刻 `resolve` 预制结果） | 缺少 waiting 状态、看门狗、取消、重试 |
| 超时文案已经写好但没有入口 | `main.js:53-65`（`预先准备的示例 · 超时回退`、`因等待超过 1.5 秒…`） | 文案可复用，缺的是把 `fallback: 'timeout'` 真正产生出来 |
| 页面只有 播放 / 定位 / 破壁 / 重置 / 退出 | `extension/demo/index.html:32-55` | 缺「取消」「重试」以及在等待与失败态下的可见反馈 |
| 无任何计时/度量代码 | `grep setTimeout|requestAnimationFrame|performance\.` 在 `extension/` 无命中 | SC-003 的 0.1 秒没有证据来源 |
| 会话守卫已具备 requestId/videoId/time/frameSize 校验 | `extension/src/curve/validate.js:86-97`、`session.js:60-70` | 可直接复用为「回退前重校验」，不需要新写一套 |

## 3. 设计方案

### 3.1 状态机（在 `data-model.md` 的基础上补齐）

```text
paused-ready
  --wake--> waiting                 冻结 {requestId, videoId, time, frameSize}

waiting
  --预制匹配 且 externalAttempt=off--> interactive        source=preset, fallback=null
  --看门狗 1500ms 且预制匹配--> interactive                source=preset, fallback=timeout
  --看门狗 1500ms 且无匹配预制--> recoverable-error        原因：无可用准备结果
  --外部结果非法--> recoverable-error                      原因：外部结果不可用
  --用户取消 / Esc--> paused-ready                        该 requestId 立即作废
  --播放 / 离开目标时间--> paused-ready                    定时器必须一并清理

interactive
  --拖动 / 重置--> interactive
  --退出 / Esc / 点击外部--> paused-ready
  --播放 / 离开目标时间--> paused-ready                    先移除覆盖层
```

补充字段（写入 `data-model.md`）：`fallbackReason`（超时回退原因，交互期间持续可见）、`frozenContext`（本次唤醒冻结的视频/时间/尺寸）、失效的 `requestId` 集合。

### 3.2 模块划分（建议新增/改动）

| 文件 | 动作 | 职责 | 写权限归属 |
| --- | --- | --- | --- |
| `extension/src/attempt/simulator.js` | 新增 | `externalAttempt` 四模式的确定性替身：`off` 立即返回预制、`hang` 永不返回、`invalid` 在 1.5 秒内返回非法候选、`late` 在 1.5 秒后返回候选。不联网、不读密钥、定时器可清理 | 测试/结果规则 |
| `extension/src/session/wake.js` | 新增 | 唤醒协调器：冻结请求上下文、启动/清理 1500ms 看门狗、回退前重校验（requestId/videoId/time±0.2s/frameSize）、取消、迟到丢弃、输出状态与原因 | 会话 |
| `extension/src/session/session.js` | 改动 | 去掉 P0 的「非 off 即拒绝」临时护栏，改为只管单会话、requestId 守卫、解析校验；`off` 主路径行为保持不变 | 会话 |
| `extension/src/telemetry/latency.js` | 新增 | 内存打点与统计：`mark/measure`、P50/P95、缓存状态；不落盘、不上传 | 度量 |
| `extension/demo/index.html`、`extension/demo/demo.css` | 改动 | 等待态「取消」、失败态「重试 / 退出」、`aria-live` 状态区、焦点可见 | 页面 |
| `extension/src/page/main.js` | 改动 | 接线：等待流程、看门狗、取消/重试、迟到结果丢弃、旧帧不覆盖、来源与原因持续显示 | 页面 |
| `extension/assets/config.json` | 不改（保持 `externalAttempt: off`） | 演练时临时改值，验收后必须改回 | 配置 |
| `specs/001-insitu-parabola/data-model.md` | 改动 | 补 3.1 的状态与字段 | 文档 |

### 3.3 时序（评审用伪代码）

```text
wake():
  守卫：paused 且处于目标时间 且 已加载预制 且 当前无覆盖层
  ctx = freeze(requestId = 新编号, videoId, time = video.currentTime, frameSize)
  session.beginWait(ctx) -> waiting
  显示等待态（含取消入口）
  timer = schedule(fallbackAfterMs = 1500, onTimeout)
  if config.externalAttempt != off:
      simulator.start(ctx).then(onExternal)      // 只在仍等待同一个 ctx 时处理

onTimeout():
  t0 = now()
  candidate = rebind(prewarmedPreset, ctx)       // 重新校验 videoId / time / frameSize
  if candidate 合法 且 仍等待同一个 ctx:
      session.resolve({...candidate, fallback: timeout})   // 同步，不等待
      render()                                            // 同步绘制 SVG
      t1 = now(); record(回退显现, t1 - t0)                 // SC-003 口径
      显示超时回退来源与原因
  else:
      session.fail(无可用准备结果) -> recoverable-error
      显示失败说明 + 重试 / 退出

onExternal(candidate):
  if 不再等待同一个 ctx: 丢弃（只记日志，不改界面）
  if candidate 非法: session.fail(外部结果不可用) -> recoverable-error
  else: 交给同一 validate + requestId 守卫；本交付没有 vision 生产者，默认拒绝

cancel(): 清理 timer；session.cancel()；隐藏等待态；回到暂停
exit():   清理 timer；中止外部尝试；session.exit()；移除覆盖层
```

### 3.4 硬约束（来自 Constitution 与契约，实现时必须满足）

- 回退前必须先校验当前 `requestId`、视频与帧位置；任一不符就**不画曲线**（Constitution §6）。
- `source` 只允许 `preset`；超时回退用 `fallback: timeout`；界面持续显示来源与原因，不得静默成功。
- 失败不得改写成成功；无可用缓存时保留「错误 + 重试 + 退出」入口。
- 生产配置保持 `externalAttempt: off`；模拟器只在演示/测试路径生效；不得让生产构建意外开启。
- `exit`、`cancel`、换帧、播放、页面卸载都要清理定时器和迟到回调，不留 pending timer。
- 0.1 秒只统计「判定超时 → 首个可见 SVG 帧」，回退路径必须同步完成，不得 `await` 网络或重新读取文件。
- 不引入任何网络请求、上传、后端或 P1 依赖。

### 3.5 需要团队先确认的 5 个决策

| 编号 | 决策点 | 建议 | 影响 |
| --- | --- | --- | --- |
| D1 | `externalAttempt: invalid` 走「可恢复错误 + 重试/退出」还是「失败后允许一键改用预制」 | 前者：不静默替换，只有 `hang` 才自动回退 | 直接决定 AC-4 的界面与 FR-010 的语义 |
| D2 | 无匹配预制 + `hang` 时是否也要求两步内可恢复 | 是：落到 `recoverable-error`，提供重试/退出 | 决定 SC-005 的覆盖范围 |
| D3 | 取消入口形态 | 等待态显示「取消」按钮 + 支持 Esc；状态区用 `role=status` + `aria-live=polite`，出现等待态时把焦点移到取消按钮 | 决定 T026 的可访问性实现 |
| D4 | 是否先同步上游 `session.js`（`session_active` / `external_attempt_disabled`）再开工 | 建议先同步，减少后续分叉；同步时需同时更新 3 个既有测试文件 | 决定 T025 是「对齐」还是「跳过」 |
| D5 | SC-003 采样方法 | 本机热缓存、每个场景 ≥20 次、报告 P50/P95、记录浏览器版本与机器 | 决定验收记录的可比性 |

## 4. 任务拆分（建议编号，供治理门禁解除后登记）

### Phase A：决策与治理（阻塞前置）

| ID | 任务 | 主要文件 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| T019 | 按 Constitution §9 处理版本冲突：修订 Constitution（若确认升到 v1.2.0）或更正 `spec.md` 的版本假设；同步 `plan.md`/`tasks.md` | `docs/BreakGlass-constitution.md`、`specs/001-insitu-parabola/{spec,plan,tasks}.md` | 团队确认 | 版本号、日期、变更记录一致 |
| T020 | 冻结 D1–D5 五个决策与全部用户可见文案表（等待/超时回退/失败/取消） | 本文件、`contracts/runtime-config.md` | T019 | 决策与文案写入文档并评审通过 |

### Phase B：纯函数与状态机（测试先行）

| ID | 任务 | 主要文件 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| T021 [P] | 先写会失败的 `tests/wake-timeout.test.js`（假时钟）：AC-1~AC-8 全覆盖，含迟到丢弃与 5 次循环 | `tests/wake-timeout.test.js` | T020 | 测试先红后绿；≥18 项 |
| T022 [P] | 先写会失败的 `tests/external-simulator.test.js`：四模式确定性、无网络、无泄漏定时器 | `tests/external-simulator.test.js` | T020 | 测试先红后绿 |
| T023 | 实现 `extension/src/attempt/simulator.js` 使 T022 通过 | `extension/src/attempt/simulator.js` | T022 | `node --test` 通过 |
| T024 | 实现 `extension/src/session/wake.js` 使 T021 通过（冻结上下文、看门狗、回退重校验、取消、迟到丢弃） | `extension/src/session/wake.js` | T021 | `node --test` 通过 |
| T025 | 按 D4 同步或改造 `extension/src/session/session.js`，移除 P0 临时护栏并保持 `off` 主路径不变 | `extension/src/session/session.js` | T024 | 既有 P0 测试全部保持通过 |

### Phase C：页面接线与度量

| ID | 任务 | 主要文件 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| T026 | 演示页增加等待态（取消）、失败态（重试/退出）、`aria-live` 状态区与焦点管理 | `extension/demo/index.html`、`extension/demo/demo.css` | T020 | 静态契约测试通过；键盘路径可用 |
| T027 | `main.js` 接线：等待流程、看门狗、取消/重试、迟到丢弃、旧帧不覆盖、来源与原因持续显示 | `extension/src/page/main.js` | T024、T026 | `tests/page-integration.test.js` 通过 |
| T028 | 实现 `extension/src/telemetry/latency.js` 并接入「回退显现」打点 | `extension/src/telemetry/latency.js`、`main.js` | T027 | 打点可在测试中断言（不联网、不落盘） |

### Phase D：验收

| ID | 任务 | 主要文件 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| T029 | 更新既有测试以覆盖新状态与控件（`extension-surface`、`page-integration`、`session`、`session-lifecycle`） | `tests/` | T025、T027 | `node scripts/verify.mjs` 0 失败 |
| T030 | 按 quickstart 第 2 节手工验收 `hang`/`invalid`/无匹配预制/取消/5 次循环；记录 SC-003 的 P50/P95、浏览器、机器、热缓存 | `docs/BreakGlass-frontend-validation.md`、任务跟踪文档 | T029 | 记录含时间、事件起止与实测值 |

并行机会：T021 与 T022 可并行；T023 与 T024 在接口冻结后可并行；T026 与 T024 可并行（不同文件）。

## 5. 治理与冲突（实现前必须处理）

1. **宪法版本冲突**：`spec.md`（第 130 行）假设「产品宪法 v1.2.0 覆盖全部验收场景」，但仓库内 `docs/BreakGlass-constitution.md` 仍是 **v1.1.0**，且其 §1/§6 已经把「超时、取消、本地预制保底」写进 P0。按 Constitution §9，必须先修订宪法并递增版本，或更正 `spec.md`，不能让低层文档静默覆盖。
2. **tasks.md 与宪法的口径冲突**：`tasks.md:9` 写「只覆盖 MVP 主路径，不写超时和四画幅测试」，与本规划 AC-1~AC-5 冲突；`tasks.md:11,116,180` 又写「故事 2 故意没有任务编号」。需要 T019 一并澄清。
3. **T017 门禁**：`tasks.md:7` 明确「T017 未完成、正式视频未提供前不要开始故事 2」。本文件**只做规划，不改任何实现**；若要在 T017 之前实现，必须按 Constitution §9 记录例外（原因、影响、责任人、有效期限、恢复条件、是否阻塞 P0）。
4. **本轮未修改** `tasks.md`、`spec.md`、`plan.md`、`constitution.md`，避免在未确认前形成隐含例外。
5. **上游分叉**：工作区的 `extension/src/session/session.js` 与 `extension/src/page/main.js` 落后上游 `2438bd19f708`，实现前先按 D4 决定基线，避免 P2 建在两个版本不同的实现上。

## 6. 测试计划

| 文件 | 动作 | 覆盖 |
| --- | --- | --- |
| `tests/wake-timeout.test.js` | 新增 | 假时钟：1.5 秒整点回退、回退→首帧耗时口径、迟到丢弃、无匹配预制、取消、5 次循环、requestId/video/time/frameSize 守卫、定时器清理 |
| `tests/external-simulator.test.js` | 新增 | `off`/`hang`/`invalid`/`late` 行为表、确定性、无网络调用、无遗留定时器 |
| `tests/session.test.js`、`tests/session-lifecycle.test.js` | 改动 | 把「非 off 即被阻断」改为「非 off 可以等待，但绝不成为识别成功」；保留单会话、钳制、重置、退出、旧编号失效 |
| `tests/extension-surface.test.js` | 改动 | 新控件存在且可访问、文案包含来源与原因、配置默认 `off`、无远程资源 |
| `tests/page-integration.test.js` | 改动 | 假时钟驱动：等待态 → 超时回退 → 取消 → 失败重试 → 5 次循环；覆盖层与定时器清理 |
| `node scripts/verify.mjs` | 复用 | P0 主路径与既有 104 项必须保持 0 失败 |

测试原则：先红后绿；用注入的假时钟，不用真实 `setTimeout` 等待；断言「界面状态 + 会话状态 + 是否绘制」三者一致，而不是只断言内部字段。

## 7. P2 完成定义（Definition of Done）

- [ ] AC-1 ~ AC-8 全部有自动化或手工证据，且证据里写明时间、环境与热缓存状态。
- [ ] `externalAttempt: off` 的 P0 主路径行为与今天完全一致（既有测试不回归）。
- [ ] 任何失败路径都不产生曲线、不显示为成功、都留下重试或退出。
- [ ] 无匹配预制、取消、无视频三种情况都能在两步内回到可继续的暂停画面。
- [ ] `node scripts/verify.mjs` 0 失败；新增测试先红后绿的过程记录在案。
- [ ] SC-003 有 P50/P95 记录，口径写明不含网络与首帧。
- [ ] `tasks.md`、`data-model.md`、`contracts/runtime-config.md`、验证记录同步更新。
- [ ] 未引入后端、网络请求、上传、Pyodide 或任意网站注入。

## 8. 明确不做（超出 P2）

真实视觉识别与其接口、单帧上传、感知代理、Pyodide/Worker、任何后端或数据库、故事 3 的四画幅 2% 验收、任意网站注入。
