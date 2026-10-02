# Tasks: 原位抛物线破壁

**Input**: Design documents from `/specs/001-insitu-parabola/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**进度（2026-10-02）**: 对照当前扩展实现更新。T001–T016、T018 已完成；`node --test` 14 项通过。T017 尚未做浏览器手工记录，正式视频和原位验收素材也仍未提供。这些证据齐备前不要开始故事 2。

**Tests**: 包含宪法要求的纯函数夹具。只覆盖 MVP 主路径，不写超时和四画幅测试。

**Organization**: 本次只拆用户故事 1。故事 2、故事 3 和真实识别只登记范围，不生成任务。

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

## 后续内容（本次不拆分）

下面各项仍然属于规格或宪法里的后续范围。本次没有任务编号，实现故事 1 时不要提前做。

### User Story 2 - 等待失败时仍然诚实、可恢复 (Priority: P2)

**Goal**: 外部结果超过 1.5 秒、结果非法、没有匹配准备结果，以及用户取消时，界面可恢复，且不把准备结果说成识别成功。

**Independent Test**: 分别使用 `externalAttempt` 的 `hang`、`invalid`、`late`，以及一份不匹配的准备结果。详见 quickstart.md 第 2 节。

尚未拆分的工作包括：1.5 秒后自动回退、超时文案、迟到结果丢弃、取消后旧编号失效、无准备结果时的重试和退出、连续 5 次换帧不被旧结果覆盖，以及超时到曲线出现的 0.1 秒记录。

### User Story 3 - 换画幅后曲线仍然贴住原图 (Priority: P3)

**Goal**: 同一目标帧在 16:9、4:3、竖屏和带黑边下，以及一次窗口变化后，偏差不超过内容区域较短边的 2%。

**Independent Test**: quickstart.md 第 3 节。未验证网站不被注入。

尚未拆分的工作包括：四种画幅夹具、2% 测量记录、全屏和设备像素比变化后的重算验收。

### 不在本功能任务内

真实识别、单帧上传、感知代理、FastAPI、Pyodide 和任意网站注入都没有任务。正式视频与正式抛物线定义到位之前，夹具不能记成故事 1 的最终素材验收。

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1，并挡住故事 1
- **User Story 1 (Phase 3)**: 依赖 Phase 2
- **Polish (Phase 4)**: 依赖故事 1
- **故事 2 与故事 3**: 未排期。故事 1 验收前不开始

### User Story Dependencies

- **User Story 1 (P1)**: 只依赖 Foundational。不依赖故事 2 或故事 3
- **User Story 2 (P2)**: 以后再拆。预期复用会话和准备结果，但本次不实现
- **User Story 3 (P3)**: 以后再拆。预期复用内容矩形，但本次不测四种画幅

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
- 故事 2 和故事 3 故意没有任务编号
- 夹具视频和 `fixture.parabola` 只用于工程验证
- 不要把 `externalAttempt` 的非 `off` 值做成半成品识别
