# Tasks: 几何实验自动阅读

**Input**: Design documents from `/specs/006-auto-geometry-lesson/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 计划与 quickstart 要求替身测试先于实现。真实模型和热缓存 20 次不在本轮勾成通过。

**Organization**: 按用户故事分阶段。US1 自动阅读并破壁，US2 下一个，US3 失败留片与预设。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与本阶段其他不同文件并行
- **[Story]**: US1 / US2 / US3

## Phase 1: Setup

**Purpose**: 新入口与旧页面并存，不改曲线演示和 005 的脚本顺序。

- [x] T001 在 `extension/demo/index.html` 与 `extension/demo/geometry.html` 的工作台导航增加「几何阅读」，指向 `extension/demo/geometry-lesson.html`，保留「曲线演示」和「几何实验」。
- [x] T002 新增 `extension/demo/geometry-lesson.html` 与 `extension/demo/geometry-lesson.css`：自己的视频、阅读地址、取消、破壁、下一个、重置、退出和来源文案的空页面。不内联脚本，不放密钥。

---

## Phase 2: Foundational

**Purpose**: 三种图形的校验、斜边计算和本机地址。用户故事都依赖这一层。

- [x] T003 在 `extension/src/geometry-lesson/reading.js` 与 `tests/geometry-lesson-reading.test.js` 实现采样复用、点校验和第一处收下：`schemaVersion` 只能是 `1.0.0`；`kind` 只能是 `right-triangle`、`circle`、`segment`；单位只能是 `unit`、`cm`、`m`；长度和半径必须是正有限 JSON number；像素必须落在 `frameSize` 内；相邻不足 1 秒丢掉较晚的点；最多 8 个点；斜边必须等于 `Math.hypot`。未知字段、`fixture-parabola`、尺寸不符和用像素距离充当边长都拒绝。
- [x] T004 [P] 在 `extension/src/geometry-lesson/solve.js` 实现一次只改一项：直角三角形改一条直角边并重算斜边，圆只改半径，线段只改长度。零、负数、非有限数或第二项修改时保持原值。
- [x] T005 [P] 在 `extension/src/geometry-lesson/request.js` 组装 `POST /geometry/lesson` 的本机地址。只允许 `localhost`、`127.0.0.1`、`[::1]`，拒绝远程主机、用户名和密码。请求体不含 prompt、模型名和密钥。超过 8000 字的课程说明不送出。

**Checkpoint**: 纯函数测试能拒绝和放行，尚未接页面。

---

## Phase 3: User Story 1 - 自己的片子开播后自动读出一处并破壁 (Priority: P1)

**Goal**: 自己的视频可播放且地址已填时自动阅读。第一处通过后暂停。破壁取出已存图形并调节一项。

**Independent Test**: 替身返回直角边 3 和 4。暂停后破壁显示「这次几何阅读」，斜边为 5。把一条边改为 6、另一条保持 4，斜边为 `Math.hypot(6, 4)`。仅仅暂停不发请求。

- [x] T006 [P] [US1] 在 `breakglass-reader/src/geometry-lesson-model.mjs` 固定几何阅读指令：一帧一个直角三角形、圆或线段；明确没有图形或两个都完整时不再换模型冒充成功。
- [x] T007 [US1] 在 `breakglass-reader/src/geometry-lesson.mjs`、`breakglass-reader/src/server.mjs` 与 `breakglass-reader/tests/geometry-lesson.test.mjs` 增加 `POST /geometry/lesson`。整包 10MiB，不改变 `/read` 与 `/geometry/read` 的 4MiB。身份、时长和 `origin: external` 必须回显。JPEG 像素映射回源尺寸。模型自报的斜边不进入响应。未配置模型返回 503。全部连不上返回 502。
- [x] T008 [P] [US1] 在 `extension/src/geometry-lesson/session.js` 保存当次阅读、第一处、调节副本和代次。换片、播放或地址变更后旧响应不得进入调节。
- [x] T009 [P] [US1] 在 `extension/src/geometry-lesson/view.js` 按源像素把当前图形画进暂停画面。调节后的图形可以离开原来的笔画。
- [x] T010 [US1] 在 `extension/src/page/geometry-lesson.js` 与 `tests/geometry-lesson-page.test.js` 接上自动阅读和破壁：可播放后才发送，最多 8 帧，破壁不再请求。来源文案是「这次几何阅读」。

**Checkpoint**: 不依赖「下一个」和预设，US1 可以单独演示。

---

## Phase 4: User Story 2 - 下一个只跳已经算完的更晚一处 (Priority: P2)

**Goal**: 「下一个」只走向更晚的已存点。定位中不能破壁。还在读或没有下一处时时间不动。

**Independent Test**: 两处已存点时，按下后当前层先卸下，时间变为更晚的一处；落定前破壁不可用。没有更晚处时按钮不可用，时间不变。

- [x] T011 [US2] 在 `extension/src/geometry-lesson/session.js` 与 `extension/src/page/geometry-lesson.js` 实现「下一个」「还在读」「没有下一处」。定位落定指已暂停且时间差不超过 0.2 秒。
- [x] T012 [US2] 在 `tests/geometry-lesson-page.test.js` 覆盖跳转、定位中禁用破壁，以及更早点后到时不把播放头拉回。

**Checkpoint**: US1 的破壁结果不会被「下一个」的半路状态换掉。

---

## Phase 5: User Story 3 - 失败留在自己的片子上 (Priority: P3)

**Goal**: 失败、断网、空地址或超时后片子还在，失败结果清空。预设只在主动选择后出现。

**Independent Test**: 请求失败后视频地址不变，破壁不可用。点击「选择预设」后文案是「预先准备的示例」，并且没有阅读请求。

- [x] T013 [US3] 在 `extension/src/page/geometry-lesson.js` 处理空地址、失败、超时和取消：保留自己的片子，不装入预设视频。
- [x] T014 [US3] 在 `extension/src/page/geometry-lesson.js` 增加「选择预设」。只使用包内直角三角形示例和写明的 3、4 条件，不调用模型。
- [x] T015 [US3] 在 `tests/geometry-lesson-page.test.js` 断言失败后的视频地址、空结果，以及预设路径的来源文案和零次阅读请求。

**Checkpoint**: 自动阅读失败不会被预设冒充。

---

## Phase 6: Polish

**Purpose**: 回归与未完成验收保持分开。

- [x] T016 [P] 在 `breakglass-reader/README.md` 写明 `/geometry/lesson` 的边界，并注明替身测试不等于真实模型验收。
- [x] T017 运行 `tests/geometry-lesson-reading.test.js`、`tests/geometry-lesson-page.test.js`、`breakglass-reader/tests/geometry-lesson.test.mjs`，以及 `tests/page-lesson.test.js`、`tests/page-geometry.test.js`、`tests/current-frame.test.js` 和 `node scripts/check.mjs`。
- [ ] T018 真实模型正确率、热缓存破壁至少 20 次且较慢一档不超过 0.1 秒、四类画幅摆放和 Chrome 扩展内完整加载仍无记录。这些项保持未完成，不把本轮测试写成 SC-005 已通过。

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 无前置。
- Phase 2 依赖 Phase 1 的页面文件名稳定。
- US1 依赖 Phase 2。
- US2 依赖 US1 的已存点。
- US3 依赖 US1 的阅读状态，不依赖 US2。
- Phase 6 在要交付的故事完成之后。

### User Story Dependencies

- **US1**: Phase 2 之后即可开始。
- **US2**: 使用 US1 已经存下的点，但「没有下一处」可单独断言。
- **US3**: 可在 US1 的失败分支上单独测试，不必先做跳转。

### Parallel Opportunities

- T004 与 T005 相对 T003 使用不同文件，可在校验函数签名稳定后并行。
- T006、T008、T009 使用不同文件，可在契约稳定后并行。
- T016 只改说明，可与测试收尾并行。

### Parallel Example: User Story 1

```bash
# 契约稳定后可同时改这些不同文件：
# breakglass-reader/src/geometry-lesson-model.mjs
# extension/src/geometry-lesson/session.js
# extension/src/geometry-lesson/view.js
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1 与 Phase 2。
2. 完成 US1 的阅读、暂停和破壁。
3. 停下来用替身确认斜边是 5，再改一条边。

### Incremental Delivery

1. US1 能破壁后再做「下一个」。
2. 失败留片和预设放在最后，避免失败被示例盖住。
3. T018 保持未勾选，直到另有真实记录。

---

## Notes

- 不修改 `CurveResult`、`createWake`、`POST /read` 和 `POST /geometry/read` 的既有契约。
- 像素只用于摆放。长度来自标记，斜边来自 `Math.hypot`。
- 真实模型、20 次热缓存和扩展内完整加载见 T018，本轮不声称已经通过。
