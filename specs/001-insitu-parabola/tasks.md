# Tasks: 原位抛物线破壁

**Input**: Design documents from `/specs/001-insitu-parabola/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**进度（2026-10-02）**: 对照当前扩展实现更新。T001–T016、T018 已完成；`node --test` 14 项通过。T017 尚未做浏览器手工记录，正式视频和原位验收素材也仍未提供。这些证据齐备前不要开始故事 2。

**补充（2026-10-02）**: 按用户决定补登故事 2（P2，T019–T030）与故事 3（P3，T031–T039）的任务。**登记不等于开工**：实现仍受 T017 与正式素材验收门禁约束，详见下文 Phase 5/6 的治理说明。

**故事 2 实现进展（2026-10-02）**: 按用户明确要求「完成 P2 前端部分」，T021–T029 已在 `p2` 分支实现；`node --test` 54 项通过，`node --check` 20 个 JavaScript 文件通过。T030 的 Chrome 手工验收仍待执行。T019、T020 的治理口径尚未确认。

**Tests**: 包含宪法要求的纯函数夹具。Phase 1–4（故事 1）只覆盖 MVP 主路径，不写超时和四画幅测试；故事 2、故事 3 的测试在 Phase 5/6 各自拆分。

**Organization**: Phase 1–4 只拆用户故事 1（已完成）。2026-10-02 补登故事 2、故事 3 的任务（Phase 5/6）；真实识别、单帧上传、感知代理、Pyodide 仍只登记范围，不生成任务。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与同阶段其他 `[P]` 任务并行（不同文件、不依赖未完成任务）
- **[Story]**: 仅用户故事阶段使用 `[US1]`
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

## 后续阶段：故事 2 与故事 3（已登记任务，未开始实现）

> **治理门禁**：本节任务已完成规划登记（编号、依赖、验收与测试口径），但**不得先于 T017 的浏览器手工记录与正式素材验收开始实现**。若要在 T017 之前实现，必须按 Constitution §9 记录例外（原因、影响、责任人、有效期限、恢复条件、是否阻塞 P0）。登记本身不等于开工。
>
> 详细规划：故事 2 见 [`plan-story-2.md`](./plan-story-2.md)（含文案表、接口签名草案、既有测试影响清单、data-model 增量）与 [`ownership-story-2.md`](./ownership-story-2.md)（前后端分工与边界）；故事 3 见 [`plan-story-3.md`](./plan-story-3.md)。

---

## Phase 5: User Story 2 - 等待失败时仍然诚实、可恢复 (Priority: P2)

**Goal**: 外部结果超过 1.5 秒、结果非法、没有匹配准备结果，以及用户取消时，界面可恢复，且不把准备结果说成识别成功。

**Independent Test**: 分别使用 `externalAttempt` 的 `hang`、`invalid`、`late`，以及一份不匹配的准备结果。详见 quickstart.md 第 2 节。

### 治理与决策前置

- [ ] T019 [US2] 按 Constitution §9 处理版本与口径冲突：修订 Constitution（如确认升到 v1.2.0）或更正 `spec.md` 的版本假设；澄清本节与「只覆盖 MVP 主路径」的措辞；同步 `plan.md`、`data-model.md`
- [ ] T020 [US2] 冻结 D1–D5 决策与全部用户可见文案（等待/超时回退/失败/取消/迟到），写入 `plan-story-2.md` 附录 A 与 `contracts/runtime-config.md`

### Tests for User Story 2

- [x] T021 [P] [US2] 先写会失败的 `tests/wake-timeout.test.js`：假时钟驱动 1500ms 回退、判定超时→首个可见帧 ≤0.1 秒、迟到丢弃、无匹配预制、取消、连续 5 次换帧/退出再唤醒、`requestId`/`videoId`/`time`/`frameSize` 守卫、定时器清理
- [x] T022 [P] [US2] 先写会失败的 `tests/external-simulator.test.js`：`off`/`hang`/`invalid`/`late` 四模式确定性、无网络调用、无遗留定时器

### Implementation for User Story 2

- [x] T023 [US2] 实现 `extension/src/attempt/simulator.js`，使 T022 通过。不得发真实请求、不得内置地址或密钥
- [x] T024 [US2] 实现 `extension/src/session/wake.js`，使 T021 通过：冻结请求上下文、1500ms 看门狗、回退前重校验、取消、迟到丢弃、状态与原因输出
- [x] T025 [US2] 收口 `extension/src/session/session.js`：移除 P0 的「非 off 即拒绝」临时护栏，改为等待语义；`off` 主路径行为保持不变
- [x] T026 [P] [US2] 演示页增加等待态（取消）、失败态（重试/退出）、`aria-live` 状态区与焦点管理：`extension/demo/index.html`、`extension/demo/demo.css`
- [x] T027 [US2] `extension/src/page/main.js` 接线：等待流程、看门狗、取消/重试、迟到丢弃、旧帧不覆盖、来源与原因持续显示
- [x] T028 [US2] 实现 `extension/src/telemetry/latency.js` 并接入「回退显现」打点（内存统计，不落盘、不上传）

### Verification for User Story 2

- [x] T029 [US2] 更新既有测试以覆盖新状态与控件（`tests/session.test.js`、`tests/session-lifecycle.test.js`、`tests/extension-surface.test.js`、`tests/page-integration.test.js`），清单见 `plan-story-2.md` 附录 C
- [ ] T030 [US2] 按 quickstart 第 2 节手工验收 `hang`/`invalid`/无匹配预制/取消/5 次循环，记录 SC-003 的 P50/P95、浏览器、机器与热缓存状态

**Checkpoint**: `externalAttempt: off` 的主路径与今天完全一致；任何失败路径都不产生曲线、不显示为成功、都留下重试或退出。

**实现记录（2026-10-02）**: T021–T029 已完成，证据为 `node --test` 54 项通过（新增 `tests/wake-timeout.test.js`、`tests/external-simulator.test.js`、`tests/page-p2.test.js`、`tests/extension-surface-p2.test.js`，并更新 `tests/session.test.js`）。新增模块：`extension/src/attempt/simulator.js`、`extension/src/session/wake.js`、`extension/src/telemetry/latency.js`；改动：`extension/src/session/session.js`（新增 `fail()`、去掉「非 off 即拒绝」的临时护栏）、`extension/src/page/main.js`、`extension/demo/index.html`、`extension/demo/demo.css`。

> **例外记录（Constitution §9）**：本次在 T017 完成前开始了故事 2 的实现。
> - 原因：用户 2026-10-02 明确要求完成 P2 前端部分。
> - 影响：故事 2 的代码与测试先于 T017 的浏览器手工记录和正式素材验收进入 `p2`；治理结论（T019/T020）仍未确认。
> - 责任人：前端（本仓库）。
> - 有效期限：仅限 `p2` 分支的故事 2 实现。
> - 恢复条件：T017 完成并记录后，本例外自动失效；T030 仍需按 quickstart 第 2 节补做手工验收。
> - 是否阻塞 P0：不阻塞。`externalAttempt: off` 的主路径行为与改动前一致，由 `tests/page-p2.test.js` 与 `tests/session.test.js` 覆盖。

---

## Phase 6: User Story 3 - 换画幅后曲线仍然贴住原图 (Priority: P3)

**Goal**: 同一目标帧在 16:9、4:3、竖屏和带黑边下，以及一次窗口变化后，偏差不超过内容区域较短边的 2%。

**Independent Test**: quickstart.md 第 3 节。未验证网站不被注入。

**2% 口径**：偏差 = 采样点上 `|实测 SVG 点 − 期望画面点|` 的最大值 ÷ `min(contentRect.width, contentRect.height)`；只比较 `contentRect` 内部，黑边不参与。采样含顶点、`domain` 两端与等距 9 点。

### Tests for User Story 3

- [ ] T031 [P] [US3] 先写会失败的 `tests/alignment.test.js`：四画幅往返一致性、偏差比例、2% 边界（恰好通过 / 略超拒绝）、采样点有限性

### Implementation for User Story 3

- [ ] T032 [US3] 完善 `extension/src/geometry/content-rect.js`：`object-position` 长度单位、单关键字补齐另一轴、数字型解析；非有限 `videoWidth`/`videoHeight` 防御
- [ ] T033 [US3] 实现 `extension/src/geometry/alignment.js`：`sourcePointToPage`、`pagePointToSource`、`deviationRatio`、`withinTolerance`、`sampleAlignment`（API 见 `plan-story-3.md` §3.2）
- [ ] T034 [US3] 覆盖层定位收口：`position: absolute` 或等价的 CSS 规则，使 SVG 与 `contentRect` 绑定（**2% 对齐的前置**）
- [ ] T035 [US3] 补齐重算触发：`fullscreenchange`、DPR 变化、`ResizeObserver(video)`、`loadedmetadata`、`orientationchange`，并在退出时清理监听

### Verification for User Story 3

- [ ] T036 [P] [US3] 四画幅夹具与 2% 测量输出（演示页只读 `window.__breakglassAlignment`，不联网、不落盘）
- [ ] T037 [US3] 更新 `tests/extension-surface.test.js`、`tests/page-integration.test.js`、`tests/geometry.test.js` 覆盖定位、监听与几何完善项
- [ ] T038 [US3] 按 quickstart 第 3 节手工验收并记录四画幅 + 窗口变化 + 全屏/DPR 的最大偏差比例（模板见 `plan-story-3.md` §7）
- [ ] T039 [US3] FR-018 边界核对：不在未验证页面注入，入口不可用时有明确说明；`extension/manifest.json` 无主机权限与内容脚本

**Checkpoint**: 覆盖层在四种画幅下贴合内容区域；窗口/全屏/DPR 变化后自动重算；2% 记录可复现，且未把夹具证据写成正式视频验收。

---

### 不在本功能任务内

真实识别、单帧上传、感知代理、FastAPI、Pyodide 和任意网站注入都没有任务。正式视频与正式抛物线定义到位之前，夹具不能记成故事 1 的最终素材验收。

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1，并挡住故事 1
- **User Story 1 (Phase 3)**: 依赖 Phase 2
- **Polish (Phase 4)**: 依赖故事 1
- **故事 2 (Phase 5) 与故事 3 (Phase 6)**: 任务已登记（T019–T039），但依赖 T017 的浏览器手工记录与正式素材验收；在此之前不开始实现

### User Story Dependencies

- **User Story 1 (P1)**: 只依赖 Foundational。不依赖故事 2 或故事 3
- **User Story 2 (P2)**: 已拆分（T019–T030）。复用会话与准备结果；T021/T022 先于 T023–T027，T029 在实现之后
- **User Story 3 (P3)**: 已拆分（T031–T039）。复用内容矩形；T031 先于 T032/T033；T034（覆盖层定位）是 2% 对齐的前置，必须先于 T036/T038

### Within User Story 1

- T004 与 T005 先于对应实现，并应先失败
- T011 先于 T012
- T006、T007、T009 完成后再做 T010
- T012、T013、T014 完成后再做 T015
- T016 与 T015 同一文件的收尾放在 T015 之后
- T011 与 T012 已完成
- T015 已完成
- T017 放在 T015 之后

### Parallel Opportunities

- T002 与 T003 可并行
- T004 与 T005 可并行
- T008 与 T009 可并行
- T013 与 T014 可并行
- T018 可与 T017 的记录整理并行，但 T017 的手工点击不能提前

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

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 与 Phase 2 已完成
2. 保持 T011、T012、T015 的实现与契约一致
3. **停下来验收** quickstart.md 第 1 节（T017）
4. 故事 2、故事 3 等下一轮再拆任务

### Incremental Delivery

1. Setup 与 Foundational 先让 `node --test` 能运行
2. 故事 1 提供可离线演示的 MVP
3. 之后再分别增加超时回退和多画幅，每次只加一个故事

---

## Notes

- 前后端分工见 [ownership.md](./ownership.md)。编号任务前端 10 项、后端 8 项
- `[P]` 表示不同文件且不依赖未完成任务
- 故事 2、故事 3 已于 2026-10-02 登记任务编号（T019–T039），但仍受 T017 门禁约束，登记不等于开工
- 夹具视频和 `fixture.parabola` 只用于工程验证
- 不要把 `externalAttempt` 的非 `off` 值做成半成品识别

## 变更记录

| 日期 | 变更 | 验证 |
| --- | --- | --- |
| 2026-10-02 | 补登故事 2（P2，T019–T030）与故事 3（P3，T031–T039）的任务、依赖与验收口径；同步进度、Tests、Organization、Dependencies、Notes 的措辞 | 文档审查；`plan-story-2.md`、`plan-story-3.md`、`ownership-story-2.md` 已创建 |
