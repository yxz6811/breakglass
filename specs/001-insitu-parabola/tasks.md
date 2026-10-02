# Tasks: 原位抛物线破壁

**Input**: Design documents from `/specs/001-insitu-parabola/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**进度（2026-10-02）**: T001–T016、T018 已完成。MVP 已接受，正式视频仍未提供。故事 2 的 T019–T030 已派发，两人写权限见 [`ownership.md`](./ownership.md)。

**Tests**: 故事 1 保留已有纯函数夹具。故事 2 先写超时、取消和替身的失败测试。故事 3 的四画幅测试已登记为 T031，本轮不实现。

**Organization**: 故事 1 保持原任务。故事 2 按两人分工开工。故事 3 已编号为 T031–T039，本轮不派发实现。真实识别、单帧上传、感知代理和 Pyodide 仍不编号。

**故事 2 实现进展（2026-10-02，p2 分支）**: T021–T029 已实现并通过自动化检查：`node --test` 68 项通过（含 `tests/backend-edges.test.js`），`node --check` 通过。新增 `extension/src/attempt/simulator.js`、`extension/src/session/wake.js`、`extension/src/telemetry/latency.js`、`tests/wake-timeout.test.js`、`tests/external-simulator.test.js`、`tests/page-integration.test.js`、`tests/page-p2.test.js`、`tests/helpers/fake-clock.js`；改造 `extension/src/session/session.js`、`extension/src/page/main.js`、`extension/demo/index.html`、`extension/demo/demo.css`。T019、T020 的文档口径与 T030 的 Chrome 手工验收仍未完成。

**故事 3 实现进展（2026-10-02，p2 分支）**: T031–T037、T039 已实现并通过自动化检查：node --test 88 项通过（新增 tests/alignment.test.js、tests/page-p3.test.js、tests/helpers/fake-page.js；扩展 tests/content-rect.test.js、tests/page-integration.test.js）。新增 extension/src/geometry/alignment.js；改造 extension/src/geometry/content-rect.js（长度单位、单关键字补齐另一轴、数字型、非有限尺寸防御）与 extension/src/page/main.js（全屏/方向/DPR/ResizeObserver 重算和 window.__breakglassAlignment 只读测量）与 extension/demo/index.html。T038 的四画幅手工验收仍待执行。

**接口与文档收口（2026-10-02）**: `extension/src/session/wake.js` 增加 `createWake({ session, config, preset, now, schedule, clearTimer, onChange })`，与 `ownership.md`「交接接口」登记的形状一致（`start/cancel/exit/onPlaybackChange/dispose`，状态含 `status/code/message/result`），`main.js` 改为消费该接口；新增 `tests/wake-contract.test.js`。T019 已按「不升版」方案对齐：`spec.md` 与 `plan.md` 改为引用 `docs/BreakGlass-constitution.md` v1.1.0，并注明 `.specify` v1.2.0 的感知代理约束不属于本仓库。T020 的行为决定已写入 `contracts/runtime-config.md` 与 `data-model.md`，验证记录落在 `docs/BreakGlass-frontend-validation.md`。自动化基线为 `node --test` 96 项通过。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其他 `[P]` 任务并行（不同文件、不依赖未完成任务）
- **[Story]**: 用户故事阶段使用 `[US1]`、`[US2]` 或 `[US3]`
- 描述中给出具体文件路径

## Path Conventions

- 扩展代码在 `extension/`
- 纯函数测试在 `tests/`
- 不创建 `backend/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立 MV3 扩展骨架，不引入打包器、Preact、Tailwind 或 FastAPI

- [x] T001 按 plan.md 创建目录 `extension/demo/`、`extension/src/background/`、`extension/src/page/`、`extension/src/session/`、`extension/src/geometry/`、`extension/src/curve/`、`extension/src/preset/`、`extension/assets/presets/`、`extension/assets/video/`、`tests/`
- [x] T002 [P] 编写 `extension/manifest.json`：`manifest_version` 为 3；`permissions` 与 `host_permissions` 为空；不声明 `content_scripts`；`content_security_policy.extension_pages` 为 `script-src 'self'; object-src 'self'`；不加入 `wasm-unsafe-eval`；action 打开扩展内演示页；background 为 module service worker
- [x] T003 [P] 编写 `extension/src/background/service-worker.js`：不发起网络请求，不读写密钥、帧或曲线结果

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 主路径依赖的配置、校验和坐标。完成前不开始演示页交互

**⚠️ CRITICAL**: 用户故事 1 必须等本阶段完成

- [x] T004 [P] 先写会失败的夹具 `tests/validate.test.js`：合法 `source: "preset"` 通过；缺字段、非有限数值、region 越出 frameSize、未知 `equationId`、`videoId` 不匹配均拒绝；`source: "vision"` 拒绝；夹具不含密钥
- [x] T005 [P] 先写会失败的夹具 `tests/content-rect.test.js`：源尺寸只用 `videoWidth` 与 `videoHeight`；`object-fit: contain` 且 `object-position: 50% 50%` 时，容器更宽产生左右黑边，容器更高产生上下黑边；内容矩形不包含黑边
- [x] T006 实现 `extension/src/curve/validate.js`，使 T004 通过。`time` 单位为秒，默认容差 ±0.2 秒。参数满足 min ≤ initial ≤ max 且 step > 0。domain 与 range 满足 min < max。`dragParameter` 必须是 parameters 的键。region 宽高为正且完全落在 frameSize 内
- [x] T007 实现 `extension/src/geometry/content-rect.js`，使 T005 通过。输出元素边框、去掉黑边后的内容矩形，以及源像素到 CSS 像素的比例
- [x] T008 [P] 实现 `extension/src/curve/evaluate.js`：按 `equationId` 查找求值器；未知 id 失败；只注册标明为夹具的 `fixture.parabola`，不把某一条代数式写成正式公式
- [x] T009 [P] 编写 `extension/assets/config.json`：`enableLocalMock` 为 true，`fallbackAfterMs` 为 1500，`presetKey` 指向夹具，`prewarmed` 为 true，`externalAttempt` 为 `off`。文件中不得出现密钥或上传地址
- [x] T010 实现 `extension/src/preset/load.js`：读取 `extension/assets/config.json` 与 `presetKey` 对应的 JSON，并调用 `extension/src/curve/validate.js`。校验失败时返回可展示的失败，不返回可绘制结果

**Checkpoint**: 校验与黑边计算可由 `node --test` 覆盖。这个检查点只表示本阶段当时还没有可见交互；演示页交互从 Phase 3 开始，现已有夹具页面。

---

## Phase 3: User Story 1 - 把画面里的抛物线变成能调节的对象 (Priority: P1) 🎯 MVP

**Goal**: 在扩展内演示页上，用预先准备的夹具完成暂停、唤醒、拖动、重置和退出。来源始终显示为预先准备的示例

**Independent Test**: 配置保持 `externalAttempt: off`，断开网络，按 quickstart.md 第 1 节完成主路径。不要求 1.5 秒回退，也不要求四种画幅

### Tests for User Story 1

- [x] T011 [P] [US1] 补齐 `tests/session.test.js`：时间落在目标 ±0.2 秒才可唤醒；拖动钳制；重置后仍在交互；退出后会话消失；旧 `requestId` 不能写入；`externalAttempt` 不是 `off` 时不得进入交互；同一时刻只有一个会话；播放或离开目标时间时结束会话。共 14 项纯函数测试通过

### Implementation for User Story 1

- [x] T012 [US1] 收紧 `extension/src/session/session.js`，使 T011 通过。`off` 主路径进入交互；其他 `externalAttempt` 明确拒绝；同一时刻只有一个会话；播放、离开目标时间或时间无效时会话结束并使旧请求失效
- [x] T013 [P] [US1] 编写 `extension/assets/presets/` 中的夹具 JSON：`source` 为 `preset`，`fallback` 为 null，`time` 为秒，`videoId` 含 `fixture`。参数满足 min ≤ initial ≤ max 且 step > 0，region 落在 frameSize 内。文案标明这不是正式网课素材
- [x] T014 [P] [US1] 编写 `extension/demo/index.html` 与 `extension/demo/demo.css`：一个 `object-fit: contain`、`object-position: 50% 50%` 的 video；播放、暂停、定位、破壁、重置、退出和来源区域。不把空格设为破壁键
- [x] T015 [US1] 收紧 `extension/src/page/main.js`：暂停且时间匹配时按钮和 Alt+B 能唤醒；已有覆盖层时不重复挂层；来源持续显示「预先准备的示例」；点击舞台中覆盖层外部退出并保持暂停；SVG 绘制和拖动使用当前视频的 `videoWidth` 与 `videoHeight`；窗口变化时重算内容矩形
- [x] T016 [US1] 在 `extension/assets/video/README.md` 写明正式视频文件尚未提供。`extension/src/page/main.js` 在视频缺失或打不开时只显示说明，不挂覆盖层，不用夹具曲线冒充已经对齐的真实画面

**Checkpoint**: 夹具主路径已经能离线跑通。T011、T012、T015 已收口；正式视频、原位素材和 T017 浏览器手工记录完成前，故事 1 仍不算最终验收通过。不要继续实现故事 2

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: 只验收已拆分的 MVP

- [ ] T017 按 `specs/001-insitu-parabola/quickstart.md` 第 1 节加载未打包扩展并记录结果。不执行该文件第 2 节和第 3 节。manifest、入口和脚本预检已通过；Chrome 手工点击因当前环境无可控窗口、正式视频未提供而阻塞
- [x] T018 [P] 对照 `specs/001-insitu-parabola/contracts/extension-surface.md` 检查 `extension/manifest.json`，确认没有主机权限、内容脚本和远程脚本。2026-10-02 核对通过：权限与主机权限为空，未声明 `content_scripts`，扩展页 CSP 为 `script-src 'self'; object-src 'self'`

---

## Phase 5: User Story 2 - 等待失败时仍然诚实、可恢复 (Priority: P2)

**Goal**: 外部结果超过 1.5 秒、结果非法、没有匹配准备结果，以及用户取消时，界面可恢复，且不把准备结果说成识别成功。

**Independent Test**: 配置分别使用 `externalAttempt` 的 `hang`、`invalid`、`late`，以及一份不匹配的准备结果。断开网络，按 quickstart.md 第 2 节验收。不要求真实识别，也不要求四种画幅。

**开工**: MVP 已接受，P2 可以开工。两人写权限见 [`ownership.md`](./ownership.md) 的「P2 两人并行」。T019 只同步宪法版本文字，不挡住 T021 之后的代码。正式视频仍未提供，P2 用现有夹具验收。

分工见 [`ownership-story-2.md`](./ownership-story-2.md)。「后端」指本仓库内的结果规则，代码仍在 `extension/` 与 `tests/`。不新建 `backend/`，不发网络请求。

### 决策与契约（阻塞后续实现）

- [x] T019 [US2] 对齐宪法版本口径，不改扩展实现。核对 `.specify/memory/constitution.md`（Version 1.2.0）、`docs/BreakGlass-constitution.md`（版本 1.1.0）和 `specs/001-insitu-parabola/spec.md` 对「产品宪法 v1.2.0」的假设。按 Governance：修订 `docs/BreakGlass-constitution.md` 时必须递增版本、日期和变更记录；若不升版，就更正 `specs/001-insitu-parabola/spec.md` 与 `specs/001-insitu-parabola/plan.md` 的版本假设。本仓库仍只做前端，不新增感知代理、上传、FastAPI 或 `backend/`。不要改 T019–T030 的编号
- [x] T020 [US2] 把下列决定写入 `specs/001-insitu-parabola/plan-story-2.md`、`specs/001-insitu-parabola/contracts/runtime-config.md` 和 `specs/001-insitu-parabola/data-model.md`。D1：`invalid` 进入可恢复错误并提供重试与退出，即使有匹配预制也不得显示为识别成功；只有 `hang` 在预制匹配时于 1500ms 自动回退。D2：`prewarmed: false`、预制缺失或与当前帧不匹配时进入可恢复错误，不绘制曲线。D3：等待态提供「取消」并支持 Esc；状态区使用 `role="status"` 与 `aria-live="polite"`；进入等待时焦点移到取消。D4：沿用现有 `extension/src/session/session.js` 的 `session_active` 与单会话，不整文件覆盖上游；非 `off` 从「直接拒绝」改为可等待，`off` 仍立即进入交互。D5：SC-003 只统计判定超时到首个可见 SVG 帧，本机热缓存，每场景至少 20 次，报告 P50 与 P95，并记录浏览器版本、机器和热缓存。文案：`fallback` 为 null 时显示「预先准备的示例」；`fallback` 为 `timeout` 时持续显示「预先准备的示例 · 超时回退」以及「因等待超过 1.5 秒，改用预先准备的示例。」。数据模型补上 `fallbackReason`、`frozenContext`（`requestId`、`videoId`、`time`、`frameSize`）和失效 `requestId` 集合。`time` 单位为秒，默认容差 ±0.2 秒；`fallbackAfterMs` 必须是 1500

### Tests for User Story 2

- [x] T021 [P] [US2] 在 T020 的决定下，先写会失败的 `tests/wake-timeout.test.js`（注入假时钟，不用真实 `setTimeout` 等待）。覆盖：`off` 立即进入交互且 `source` 为 `preset`、`fallback` 为 null；`hang` 在 1500ms 前保持等待且不绘制；到达 `fallbackAfterMs`（必须是 1500）后无需再次点击即进入交互，`source` 为 `preset`、`fallback` 为 `timeout`；回退前 `requestId`、`videoId`、`time` ±0.2 秒、`frameSize` 任一不符就不产出可绘制结果；迟到结果不改变已回退曲线；`prewarmed: false`、预制缺失或帧不匹配时为可恢复错误且无曲线；`invalid` 即使有匹配预制也不得进入成功绘制；取消后该 `requestId` 作废且定时器被清理，之后的结果不能打开交互；连续 5 次退出再唤醒和换帧再唤醒只留下当前视频与当前时间匹配的结果；播放或离开目标时间会结束会话并清理定时器；同一时刻只有一个会话；`requestId` 单调递增；`source: "vision"` 不得进入交互。参数仍满足 min ≤ initial ≤ max 且 step > 0，region 宽高为正且完全落在 frameSize 内。至少 18 项，夹具不含密钥
- [x] T022 [P] [US2] 在 T020 的决定下，先写会失败的 `tests/external-simulator.test.js`。`off` 立即给出预制；`hang` 在取消或超时前不返回结果；`invalid` 在 1500ms 内返回非法候选；`late` 在 1500ms 之后才返回候选；同一输入结果确定；取消、退出后不得残留定时器。读取 `extension/src/attempt/simulator.js` 的源码，断言不出现 `fetch`、`XMLHttpRequest`、`WebSocket`、远程地址、密钥或模型名

### Implementation for User Story 2

- [x] T023 [P] [US2] 实现 `extension/src/attempt/simulator.js`，使 T022 通过。`externalAttempt` 只实现 `off`、`hang`、`invalid`、`late` 四种确定性替身：不联网、不读密钥、定时器可清理。不得把非 `off` 做成真实识别请求、响应解析或内置地址
- [x] T024 [US2] 实现 `extension/src/session/wake.js`，使 T021 通过。每次唤醒重新读取 `enableLocalMock`、`fallbackAfterMs`（必须是 1500）、`prewarmed` 和 `externalAttempt`。冻结 `requestId`、`videoId`、`time`（秒）和 `frameSize`；调度看门狗；回退前调用 `extension/src/curve/validate.js` 复核，任一不符就不产出结果。取消作废当前 `requestId` 并清理定时器。迟到结果只丢弃，不改会话状态。超时回退写 `source: "preset"`、`fallback: "timeout"`。回退路径同步完成，不得等待网络或重新读取文件。`enableLocalMock` 不为 true 时，不得把超时写成预制成功
- [x] T025 [US2] 改造 `extension/src/session/session.js`：去掉 `beginWait` 与 `resolve` 里对非 `off` 一律返回 `external_attempt_disabled` 的临时拒绝，改为可进入 `waiting`。`externalAttempt: "off"` 仍立即接受匹配预制并进入 `interactive`。保留单会话、`requestId` 守卫、拖动钳制（停在参数 min 与 max 内）、重置、退出，以及播放或离开目标时间时结束会话。同步修改 `tests/session.test.js` 中「非 off 即被阻断」的断言：非 `off` 可以等待，但不得进入识别成功，校验失败时不得进入 `interactive`。`off` 主路径的既有断言保持通过
- [x] T026 [P] [US2] 在 `extension/demo/index.html` 与 `extension/demo/demo.css` 增加等待态「取消」、失败态「重试」和「退出」。状态区保持 `role="status"` 并加上 `aria-live="polite"`；进入等待时把焦点移到取消按钮；焦点样式可见。文案使用 T020 冻结的两句来源说明。不把空格设为破壁键，不在页面里另写一套超时判断
- [x] T027 [US2] 在 `extension/src/page/main.js` 接上 `extension/src/session/wake.js` 的 `createWake`。只在视频暂停、时间落在目标 ±0.2 秒、且当前无覆盖层时调用 `start`。页面只消费 `onChange` 的状态：显示等待、取消、失败、重试和退出；超时后持续显示「预先准备的示例 · 超时回退」和「因等待超过 1.5 秒，改用预先准备的示例。」。在判定超时和首个可见 SVG 帧调用 `extension/src/telemetry/latency.js` 的 `mark`。退出、取消、换帧、播放、离开目标时间或页面卸载时调用 `dispose` 并清理覆盖层；播放或离开目标时间时先移除覆盖层。`extension/assets/config.json` 保持 `externalAttempt` 为 `off`
- [x] T028 [US2] 只新增 `extension/src/telemetry/latency.js`，不改 `extension/src/page/main.js`。提供 `mark` 与 `summary`（P50、P95、缓存状态）。记录只留在内存，只含状态、毫秒数和缓存状态。不落盘、不上传、不写 `chrome.storage` 或 `indexedDB`。计时不含打开扩展、视频首帧、网络等待和 P1 初始化
- [x] T029 [US2] 补齐 `tests/page-integration.test.js`，并用 `node --test` 确认全部通过。该测试用 Node 读取 `extension/demo/index.html` 与 `extension/src/page/main.js`，断言存在取消、重试、退出和 `aria-live`，来源文案包含「预先准备的示例」与超时原因，且页面脚本不出现 `fetch`、`XMLHttpRequest`、`WebSocket` 或远程地址。保持 `tests/preset-contract.test.js` 对 `fallbackAfterMs` 为 1500、`externalAttempt` 为 `off` 的断言。若 `tests/backend-edges.test.js` 因等待语义失败，改成「非 off 可以等待，但失败不得变成成功」。不要新增 `scripts/verify.mjs`、jsdom 或打包器；交互行为仍由 `tests/wake-timeout.test.js` 覆盖
- [ ] T030 [US2] 按 `specs/001-insitu-parabola/quickstart.md` 第 2 节做手工验收，并把结果写入 `docs/BreakGlass-frontend-validation.md`。分别演练 `hang`、`invalid`、无匹配预制、取消，以及连续 5 次退出再唤醒或换帧再唤醒。记录 P50、P95、浏览器版本、机器、热缓存、事件起点和终点。演练后把 `extension/assets/config.json` 的 `externalAttempt` 改回 `off`。未实际运行的项目不要写成已通过。不执行 quickstart.md 第 3 节

**Checkpoint**: `externalAttempt: off` 的故事 1 主路径与今天一致。`hang` 在 1.5 秒后自动显示匹配预制和超时原因；`invalid`、无匹配预制和取消都可恢复，且从不显示为识别成功。没有网络请求。

---

## Phase 6: User Story 3 - 换画幅后曲线仍然贴住原图 (Priority: P3)

**Goal**: 同一目标帧在 16:9、4:3、竖屏和带黑边下，以及一次窗口变化后，偏差不超过内容区域较短边的 2%。

**Independent Test**: quickstart.md 第 3 节。未验证网站不被注入。

**2% 口径**：偏差 = 采样点上 `|实测 SVG 点 − 期望画面点|` 的最大值 ÷ `min(contentRect.width, contentRect.height)`；只比较 `contentRect` 内部，黑边不参与。采样含顶点、`domain` 两端与等距 9 点。

### Tests for User Story 3

- [x] T031 [P] [US3] 先写会失败的 `tests/alignment.test.js`：四画幅往返一致性、偏差比例、2% 边界（恰好通过 / 略超拒绝）、采样点有限性

### Implementation for User Story 3

- [x] T032 [US3] 完善 `extension/src/geometry/content-rect.js`：`object-position` 长度单位、单关键字补齐另一轴、数字型解析；非有限 `videoWidth`/`videoHeight` 防御
- [x] T033 [US3] 实现 `extension/src/geometry/alignment.js`：`sourcePointToPage`、`pagePointToSource`、`deviationRatio`、`withinTolerance`、`sampleAlignment`（API 见 `plan-story-3.md` §3.2）
- [x] T034 [US3] 覆盖层定位收口：`position: absolute` 或等价的 CSS 规则，使 SVG 与 `contentRect` 绑定（**2% 对齐的前置**）
- [x] T035 [US3] 补齐重算触发：`fullscreenchange`、DPR 变化、`ResizeObserver(video)`、`loadedmetadata`、`orientationchange`，并在退出时清理监听

### Verification for User Story 3

- [x] T036 [P] [US3] 四画幅夹具与 2% 测量输出（演示页只读 `window.__breakglassAlignment`，不联网、不落盘）
- [x] T037 [US3] 更新 `tests/extension-surface.test.js`、`tests/page-integration.test.js`、`tests/geometry.test.js` 覆盖定位、监听与几何完善项
- [ ] T038 [US3] 按 quickstart 第 3 节手工验收并记录四画幅 + 窗口变化 + 全屏/DPR 的最大偏差比例（模板见 `plan-story-3.md` §7）
- [x] T039 [US3] FR-018 边界核对：不在未验证页面注入，入口不可用时有明确说明；`extension/manifest.json` 无主机权限与内容脚本

**Checkpoint**: 覆盖层在四种画幅下贴合内容区域；窗口/全屏/DPR 变化后自动重算；2% 记录可复现，且未把夹具证据写成正式视频验收。

---

### 不在本功能任务内

真实识别、单帧上传、感知代理、FastAPI、Pyodide 和任意网站注入都没有任务。正式视频与正式抛物线定义到位之前，夹具不能记成故事 1 的最终素材验收。

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1，并挡住故事 1
- **User Story 1 (Phase 3)**: 依赖 Phase 2
- **Polish (Phase 4)**: 依赖故事 1。正式视频仍未提供；这不挡住故事 2 的夹具实现
- **User Story 2 (Phase 5)**: 依赖故事 1 的会话、校验和预制结果。后端与前端按 `ownership.md` 的独占路径同时开始
- **User Story 3 (Phase 6)**: 任务已登记（T031–T039）。本轮两人做故事 2，不开始故事 3

### User Story Dependencies

- **User Story 1 (P1)**: 只依赖 Foundational。不依赖故事 2 或故事 3
- **User Story 2 (P2)**: 复用 `extension/src/session/session.js`、`extension/src/curve/validate.js` 和预制 JSON。可单独用 `hang`、`invalid`、`late` 和无匹配预制验收
- **User Story 3 (P3)**: 已登记（T031–T039）。复用内容矩形；T031 先于 T032/T033；T034（覆盖层定位）先于 T036/T038。本轮不实现

### Within User Story 1

- T004 与 T005 先于对应实现，并应先失败
- T011 先于 T012
- T006、T007、T009 完成后再做 T010
- T012、T013、T014 完成后再做 T015
- T016 与 T015 同一文件的收尾放在 T015 之后
- T011 与 T012 已完成
- T015 已完成
- T017 放在 T015 之后
### Within User Story 2

- T019 先于 T020
- T021 与 T022 先于对应实现，并应先失败
- T022 完成后再做 T023
- T021 完成后再做 T024；T024 调用替身时放在 T023 之后
- T024 完成后再做 T025
- T020 完成后再做 T026；T026 可与 T023、T024 并行
- T024 与 T026 完成后再做 T027
- T028 只新增 `extension/src/telemetry/latency.js`，可与 T024 之后、T027 之前完成
- T027 在 `createWake` 可用后修改 `extension/src/page/main.js`，并调用 `mark`
- T025 与 T027 完成后再做 T029
- T029 完成后再做 T030

### Parallel Opportunities

- T002 与 T003 可并行
- T004 与 T005 可并行
- T008 与 T009 可并行
- T013 与 T014 可并行
- T018 可与 T017 的记录整理并行，但 T017 的手工点击不能提前
- T021 与 T022 可并行
- T023 与 T026 可并行
- T026 可与 T024 并行（演示页与 `extension/src/session/wake.js` 不是同一文件）
---

## Parallel Example: User Story 1

```bash
# 夹具测试可同时写：
# tests/validate.test.js
# tests/content-rect.test.js

# 故事 1 中可同时准备：
# extension/assets/presets/ 夹具 JSON
# extension/demo/index.html 与 extension/demo/demo.css
```

---

## Parallel Example: User Story 2

```bash
# T020 完成后可同时写失败测试：
# tests/wake-timeout.test.js
# tests/external-simulator.test.js

# 接口冻结后可同时进行：
# extension/src/attempt/simulator.js
# extension/demo/index.html 与 extension/demo/demo.css
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 与 Phase 2 已完成
2. 保持 T011、T012、T015 的实现与契约一致
3. **停下来验收** quickstart.md 第 1 节（T017）
4. 故事 2 按两人独占路径开工：后端交 `createWake`，前端先做演示页，再接 `main.js`
5. 故事 3 已登记为 T031–T039，本轮两人只做故事 2

### Incremental Delivery

1. Setup 与 Foundational 先让 `node --test` 能运行
2. 故事 1 提供可离线演示的 MVP
3. 故事 2 只增加等待、超时回退、取消和失败恢复
4. 故事 3 再增加多画幅。每次只加一个故事

---

## Notes

- 故事 1 分工见 [ownership.md](./ownership.md)：编号任务前端 10 项、后端 8 项
- 故事 2 两人分工见 [ownership.md](./ownership.md) 的「P2 两人并行」，写权限见 [ownership-story-2.md](./ownership-story-2.md)
- `[P]` 表示不同文件且不依赖未完成任务
- 故事 3 已编号为 T031–T039，本轮不派发实现
- 夹具视频和 `fixture.parabola` 只用于工程验证
- 不要把 `externalAttempt` 的非 `off` 值做成半成品识别
- 验收命令是 `node --test`。当前仓库没有 `scripts/verify.mjs`

## 变更记录

| 日期 | 变更 | 验证 |
| --- | --- | --- |
| 2026-10-02 | 从 main 接上故事 3（T031–T039）。故事 2 保留两人独占路径，并按 MVP 已接受开始实现 | 冲突已消掉；任务编号 T001–T039 各出现一次 |
