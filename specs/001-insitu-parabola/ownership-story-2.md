# Story 2（P2）前后端分工与边界

> 状态：**规划稿，未实现**。日期：2026-10-02。
> 配套文件：[`plan-story-2.md`](./plan-story-2.md)（P2 实施规划）、[`ownership.md`](./ownership.md)（P0 分工）、[`spec.md`](./spec.md)（User Story 2、FR-009~012、SC-003/005/006）、[`quickstart.md`](./quickstart.md) 第 2 节、[`contracts/runtime-config.md`](./contracts/runtime-config.md)。
> 仓库级约定：`AGENTS.md` §2/§9/§11、`docs/BreakGlass-constitution.md` §1/§2/§4/§6/§8。
> 注：上游 `main` 有仓库级的 `docs/frontend-backend-boundary.md`，工作区当前没有该文件；本文件沿用其第 8 节对「后端」的定义，不复制其全文。

## 1. 名词约定（先说清楚「后端」指什么）

| 叫法 | 实际含义 | 代码位置 |
| --- | --- | --- |
| **前端（页面侧）** | 用户看得见、点得到的部分：扩展表面、演示页、视频控制、SVG overlay、参数控件、等待/取消/失败/重试状态、键盘与可访问性、手工验收记录 | `extension/demo/`、`extension/src/page/`、`extension/src/geometry/` |
| **后端（结果规则侧）** | 不是服务端工程。指「哪一份结果可以进入交互层」的确定性规则：`CurveResult` 校验、白名单求值器、运行配置、预制 JSON、会话与请求编号守卫、超时/取消/迟到判定、计时打点接口 | `extension/src/curve/`、`extension/src/session/`、`extension/src/preset/`、`extension/src/attempt/`、`extension/src/telemetry/`、`extension/assets/`、`tests/` |
| **外部后端（识别服务 / 感知代理）** | 未来可能存在的无状态识别服务。P2 **不派发、不实现、不联调**，只在第 4 节登记接缝契约与「未确认」状态 | 不在本仓库 |

沿用 `ownership.md` 与上游 `docs/frontend-backend-boundary.md` §8 的结论：本仓库是**前端项目**，「后端」任务仍然写成前端工程内的纯函数、静态资源和测试，不新建 `backend/`。

## 2. 边界结论

P2 的分工只有一条主轴：**结果规则侧决定「能不能进交互」，页面侧决定「用户看到什么、能做什么」，以及把两者的耗时记录下来。**

- P2 新增的唯一接缝是「外部尝试（external attempt）」；`hang` / `invalid` / `late` 是**前端包内的确定性替身**，用来演练等待行为，**不是后端，也不是真实识别**。
- P2 全程**不产生任何网络请求**：不请求识别服务、不上传帧、不加载远程脚本。等待是本地定时器驱动的。
- 外部识别服务在 P2 中只作为「未来可能接入的依赖」出现在契约表里，状态一律为**未确认**。

## 3. 硬边界（P2 期间不可越界）

| 禁止项 | 原因 | 依据 |
| --- | --- | --- |
| 新增 FastAPI / Express / Node HTTP 服务、Docker 容器、BFF 或「临时后端」 | 本仓库只负责前端；接口缺失不等于补建服务 | `AGENTS.md` §2.2；Constitution §2 |
| 数据库、表结构、迁移、历史记录、账号或服务端鉴权 | 不在交付范围 | Constitution §1 |
| 真实识别请求、单帧上传、模型密钥或密钥中转 | 上传决定未获准，仓库边界未修订 | `AGENTS.md` §11；上游 boundary 文档 §4/§5 |
| 把 `externalAttempt` 的非 `off` 值做成「半成品识别」（发真实请求、解析真实响应、内置地址或密钥） | 显式禁止 | `tasks.md`「Notes」末行 |
| 在浏览器代码里存放服务端密钥 | 浏览器代码与资源对用户可见 | `AGENTS.md` §11 |
| Pyodide / WASM / Worker / 任意代码执行 | 独立 P1，需单独立项与安全预算 | Constitution §5；`docs/BreakGlass-frontend-execution-plan.md` FE-11 |
| 生产配置意外开启 `enableLocalMock` 或让 `externalAttempt` 不等于 `off` | Mock 必须是显式配置，且不得冒充成功 | Constitution §6；boundary 文档 §6 |
| 用「静默 Mock 成功」掩盖失败，或把预制结果写成识别成功 | 确定性结果门禁与来源标识 | Constitution §4；boundary 文档 §6 |

「前端开发服务器」「本地静态服务器」「`node --test`」不属于禁止项，但 P2 不需要它们承载任何业务接口或数据。

## 4. 职责矩阵（P2 逐项）

| # | P2 能力/验收点 | 后端（结果规则侧，本仓库内） | 前端（页面侧，本仓库内） | 外部后端（未来） |
| --- | --- | --- | --- | --- |
| 1 | AC-1 唤醒并冻结请求上下文 | `session.beginWait` 生成 `requestId`，冻结 `videoId` / `time` / `frameSize` | 只在「暂停且落在目标容差内且无覆盖层」时调用 | — |
| 2 | AC-1 1.5 秒看门狗 | `wake.js` 读取 `fallbackAfterMs` 并调度超时判定 | 显示等待态与取消入口；不得自行再判一套「是否超时」 | 若未来接入，必须在 1.5 秒内返回或明确失败 |
| 3 | AC-1 回退前重校验 | 用 `validate.js` 复核 `requestId` / `videoId` / `time±0.2s` / `frameSize`，任一不符就不产出结果 | 不做第二套匹配判断；只消费结果状态 | — |
| 4 | AC-1 超时回退结果适配 | 产出 `source: preset`、`fallback: timeout` 的 `CurveResult` | 持续显示「预先准备的示例 · 超时回退」与原因 | — |
| 5 | AC-3 无匹配预制 | 返回可恢复错误码（无可用准备结果） | 显示说明 + 「重试 / 退出」，两步内可恢复 | — |
| 6 | AC-4 外部结果非法 | 校验拒绝并转为可恢复错误 | 展示失败，不绘制、不显示成功 | 保证按契约返回候选数据；非法由前端拒绝 |
| 7 | AC-5 取消 | 作废当前 `requestId`、清理定时器与回调 | 取消入口、焦点管理、回到暂停画面 | 支持请求取消/中止语义（方式未确认） |
| 8 | AC-2 迟到结果丢弃 | 用 `requestId` + 上下文守卫丢弃迟到结果 | 不改界面（可在调试日志留痕，不得改变曲线） | 迟到结果由前端丢弃，服务端不负责 |
| 9 | AC-6 连续换帧/退出再唤醒 | 单调递增 `requestId`、单会话约束 | 清理覆盖层、监听与定时器 | — |
| 10 | AC-8 播放/离开目标时间 | 会话结束并失效旧编号 | 先移除覆盖层，再更新状态 | — |
| 11 | SC-003 0.1 秒度量 | `telemetry/latency.js` 提供打点与 P50/P95 统计（不落盘、不上传） | 在「判定超时」与「首个可见 SVG 帧」两处打点，并记录浏览器/机器/热缓存 | — |
| 12 | 文案与可访问性 | 只提供状态与原因枚举 | 全部用户可见文案、`role=status` / `aria-live`、焦点可见、Esc | — |
| 13 | 配置 | 静态 `config.json`：`enableLocalMock`、`fallbackAfterMs`、`presetKey`、`prewarmed`、`externalAttempt` | 只读消费；演练后必须把 `externalAttempt` 改回 `off` | — |

**一句话记住分工**：`time`、`frameSize`、`requestId` 是否匹配 —— 后端说了算；等待中用户看到什么、能点什么 —— 前端说了算。

## 5. 接口接缝契约（前端 ↔ 外部识别服务）：只登记，不实现

本节内容在外部接口书面确认前**不得进入实现**，也不得据此写任何请求代码。

### 5.1 前端 → 外部（建议，未确认）

| 项 | 建议值 | 状态 |
| --- | --- | --- |
| 触发时机 | 用户唤醒且 `externalAttempt` 不为 `off`（仅演练） | 未确认 |
| 请求标识 | 复用本次 `requestId` | 未确认 |
| 定位字段 | `videoId`、`time`（秒）、`frameSize` | 未确认 |
| 帧数据 | **当前不获准上传**；即使未来上传也需先修订 Constitution 与仓库边界 | 未获准 |
| 超时 | 前端 1.5 秒判定超时并回退；服务端超时语义需另行约定 | 未确认 |
| 取消 | 用户取消后前端不再接受该 `requestId` 的结果；是否需要 `AbortSignal` 由接口方确认 | 未确认 |
| 鉴权 | 由外部平台负责；浏览器代码不得存放服务端密钥 | 未确认 |

### 5.2 外部 → 前端（建议，未确认）

`CurveResult` 形状沿用 `contracts/curve-result.md`：`requestId` / `videoId` / `time` / `frameSize` / `source`（`vision`）/ `fallback`（`null`）/ `definition`（参数、`domain`、`range`、`yAxis`、`region`），可选 `confidence`。

进入交互前必须同时通过：形状与白名单、有限数值与范围、`region` 落在 `frameSize` 内、`requestId` / `videoId` / `time` / `frameSize` 与冻结上下文一致。

### 5.3 错误语义分工（需接口方逐条确认）

| 失败类型 | 由谁产生 | 前端必须做什么 |
| --- | --- | --- |
| 超时（>1.5 秒） | 前端判定 | 有匹配预制则回退并显示原因；无预制则可恢复错误 |
| 结果非法/缺字段/非有限 | 前端校验判定 | 可恢复错误 + 重试/退出，不绘制 |
| 视频或时间不匹配 | 前端上下文判定 | 丢弃该结果，不改界面 |
| 无权限 / 限流 / 服务错误 | 外部服务 | 是可理解的失败说明 + 重试/退出；不得静默回退成「成功」 |
| 用户取消 | 用户 | 回到暂停，迟到结果不得打开交互层 |

### 5.4 契约状态表

| 契约项 | 状态 |
| --- | --- |
| `runtime-config.md`（`enableLocalMock`、`fallbackAfterMs`、`externalAttempt`） | 已确认，P2 直接使用 |
| `curve-result.md`（`CurveResult` 形状与允许值） | 已确认，P2 直接使用 |
| 外部识别的地址、方法、请求/响应字段、鉴权、限流、数据保留 | **未确认、未派发** |
| 单帧上传 | **未获准**，需先修订 Constitution 与仓库边界 |

## 6. 交付清单与归属（对应 `plan-story-2.md` 的 T019–T030）

| 任务 | 归属 | 交付物 | 写权限范围（建议） |
| --- | --- | --- | --- |
| T019 宪法/规格口径澄清 | 共同（前端牵头） | `docs/BreakGlass-constitution.md`、`specs/001-insitu-parabola/{spec,plan,tasks}.md` | `docs/`、`specs/` |
| T020 冻结决策与文案表 | 共同 | 本文件、`plan-story-2.md`、`contracts/runtime-config.md` | 同上 |
| T021 超时/取消用例测试（先红） | 后端（结果规则侧） | `tests/wake-timeout.test.js` | `tests/` |
| T022 替身行为测试（先红） | 后端（结果规则侧） | `tests/external-simulator.test.js` | `tests/` |
| T023 外部尝试替身 | 后端（结果规则侧） | `extension/src/attempt/simulator.js` | `extension/src/attempt/` |
| T024 唤醒协调器（看门狗/重校验/取消/迟到丢弃） | 后端（结果规则侧） | `extension/src/session/wake.js` | `extension/src/session/` |
| T025 会话护栏改造成等待语义 | 后端（结果规则侧） | `extension/src/session/session.js` | `extension/src/session/` |
| T026 等待态/取消/失败态/可访问性 | 前端（页面侧） | `extension/demo/index.html`、`extension/demo/demo.css` | `extension/demo/` |
| T027 页面接线 | 前端（页面侧） | `extension/src/page/main.js` | `extension/src/page/` |
| T028 度量打点 | 后端提供接口 + 前端接点 | `extension/src/telemetry/latency.js`、`main.js` | `extension/src/telemetry/`、`extension/src/page/` |
| T029 既有测试更新 | 前端 + 后端 | `tests/extension-surface.test.js`、`tests/page-integration.test.js`、`tests/session*.test.js` | `tests/` |
| T030 quickstart §2 手工验收与记录 | 前端 | `docs/BreakGlass-frontend-validation.md` | `docs/` |

归属原则与 `ownership.md` 一致：**决定「哪一次结果还能进入交互」的规则归后端（结果规则侧）；演示页上看得见的状态与文案归前端。**

## 7. 数据、安全与隐私边界

- P2 不落盘、不上传、不写 `chrome.storage` / `indexedDB`；会话与计时只在内存中。
- 计时记录只包含状态、毫秒数与缓存状态，不包含帧内容或用户输入。
- 替身模块不得包含地址、密钥、模型名或上传代码；测试需断言扩展源码中不出现网络 API 与远程地址。
- 未来若接入外部识别：鉴权与数据保留由服务端/平台负责，浏览器侧只做适配与展示，且必须先修订 Constitution、Spec、Plan、Tasks 后再立项。

## 8. 交接顺序与并行

与 `ownership.md` 的「交接顺序」同一模式：

1. 共同先完成 T019、T020（治理口径与决策冻结）。
2. 后端（结果规则侧）先交 T021 与 T022 的失败测试，再做 T023–T025。
3. 前端在 T024 接口稳定后接 T026、T027；T026 可与 T023/T024 并行（不同文件）。
4. T028 由后端提供打点接口、前端接入两个触发点。
5. 前端做 T029、T030，并把手工记录与 P50/P95 写回验证文档。
6. 页面只消费会话给出的状态，**不得在页面里另写一套「能不能画」的判断**（沿用 `ownership.md` 第 2 条交接约定）。

## 9. 合并前的边界检查（P2 版）

- [ ] 改动是否只影响浏览器端页面、扩展资源、状态、结果规则或适配层？
- [ ] 是否新增了服务进程、数据库、服务端密钥、业务 API、上传或持久化责任？**若是，停止实现并登记范围变更。**
- [ ] 是否出现了任何网络请求（识别、上传、远程脚本）？P2 的答案是「不应该有」。
- [ ] 模拟器是否仍然是**确定性替身**，没有变成半成品识别？
- [ ] 失败路径是否都留下了重试或退出，且从未显示为成功？
- [ ] 来源与回退原因是否从曲线出现到退出持续可见？
- [ ] 结果进入绘图前是否通过了 Schema、范围与当前帧匹配校验？
- [ ] 是否在 `exit` / 取消 / 换帧 / 播放 / 页面卸载时清理了定时器与迟到回调？
- [ ] 演练用的 `externalAttempt` 是否已改回 `off`，且没有被写进生产配置？
- [ ] 是否更新了受影响的 Spec/Plan/Tasks 与验证记录，并列明未验证范围？

出现「越过前端边界」的结论时，先暂停实现并登记范围变更；**不得通过新增一个「临时后端」或静默 Mock 绕过审查**（boundary 文档 §9）。

## 10. 不派发项（明确写出，避免默认开工）

| 内容 | 归属 | 原因 |
| --- | --- | --- |
| 真实视觉识别、单帧上传、感知代理 | 外部依赖，不派发 | 需先完成上传决定、Constitution 修订与独立 P1 立项 |
| FastAPI / Node / Docker 服务 | 不派发 | P2 明确不做后端 |
| Pyodide、Worker、代码执行 | 不派发 | 独立 P1 |
| 数据库、账号、历史记录、云端同步 | 不派发 | 不在交付范围 |
| 故事 3 四画幅 2% 验收 | 暂不派发 | 与 P2 无依赖，另立规划 |

## 11. 与上游的一致性说明

- 上游 `main`（提交 `2438bd19f708`）有仓库级 `docs/frontend-backend-boundary.md`；工作区当前没有该文件，本文件只覆盖 P2，并在第 1 节沿用其「后端 = 结果规则侧」的定义。
- `ownership.md` 里故事 2 的既有归属与本文件一致：超时文案、重试/退出、换帧不覆盖、0.1 秒记录归前端；1.5 秒后才允许回退、迟到丢弃、取消后旧 `requestId` 失效归后端。
- 本文件未修改任何实现代码或既有文档；`tasks.md`、`spec.md`、`constitution.md` 的修订属于 T019，需要先获得团队确认。

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-02 | 首次编写 P2（故事 2）前后端分工与边界，含名词约定、硬边界、职责矩阵、外部接口接缝契约（未确认）、交付归属、交接顺序与合并前检查 |
