# Tasks: 开播前阅读

**Input**: Design documents from `/specs/003-preplay-lesson-points/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lesson-reading.md, quickstart.md

**Tests**: 规格 FR-019 要求固定夹具先于实现。先写会失败的测试，再写实现。SC-003、SC-004、SC-005 在记录存在之前不得勾成通过。

**Organization**: 故事 1 是第一处暂停与破壁。故事 2 是「下一个」。故事 3 是退回、分计时和尚未测得的 2%。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件，且不依赖未完成任务）
- **[Story]**: 只用于用户故事阶段

## Phase 1: Setup

**Purpose**: 准备不打进扩展包的尺寸不符夹具

- [ ] T001 按 `specs/003-preplay-lesson-points/contracts/lesson-reading.md` 创建 `tests/fixtures/lesson-size-mismatch.json`：一份 `frameSize` 与假设源尺寸不同的点，以及一份 `videoId` 不符的点。不得放入 `extension/assets/`，不得包含密钥，不得把 `demo-parabola` 写成本帧的替身

---

## Phase 2: Foundational

**Purpose**: 采样时刻、存点和校验。完成前不改演示页

- [ ] T002 先写会失败的 `tests/lesson-reading.test.js`。断言时长 < 2 秒只产生 1 个采样中点；更长的片子等分后最多 8 个中点；相邻不足 1 秒的较晚中点不保留；不是从 0 逐帧递增。校验覆盖 `curve.source` 必须是 `preset`、`curve.fallback` 必须是 `null`、`curve.time` 等于点的 `time`、`curve.frameSize` 必须等于当前源尺寸。丢掉原因必须能出现「抛物线没有通过检查」「不是这一段视频」「时间无效」「落在视频外面」「和上一个点靠得太近」「超出八个点」。最多保留 8 个点，相邻 `time` 至少相隔 1 秒，`lessonLine` 非空且最长 80 字
- [ ] T003 实现 `extension/src/lesson/reading.js`，使 T002 通过。采样与取舍以 `specs/003-preplay-lesson-points/data-model.md` 为准。第一处按校验完成顺序选出；`nextPoint` 只返回 `time` 严格更大的已存点。新函数使用 JSDoc。不修改 `extension/src/session/wake.js`

**Checkpoint**: `node --test tests/lesson-reading.test.js` 可单独验收

---

## Phase 3: User Story 1 - 第一处通过就停在那一帧 (Priority: P1) 🎯 MVP

**Goal**: 片子可播放即开始稀疏阅读。第一处通过后暂停在该帧。破壁只取出已存曲线。尺寸不符不绘制，也不用预制曲线顶上。

**Independent Test**: 地址不是 `breakglass-demo-9s.mp4` 的片子上，第一处通过后 `currentTime` 落在该点 ±0.2 秒且已暂停。破壁来源文案是「这次阅读」。尺寸不符夹具不产生覆盖层，也不加载 `demo-parabola` 作为这一帧的结果。

### Tests for User Story 1

- [ ] T004 [US1] 先写会失败的 `tests/page-lesson.test.js`：可播放后阅读状态变为进行中；第一处通过后暂停时间与该点相差不超过 0.2 秒；破壁使用的 `preset` 是该点已存 `curve`，且 `createWake` 参数名仍是 `session`、`config`、`preset`、`clock`、`onChange`；T001 的尺寸不符点不调用 `createWake`

### Implementation for User Story 1

- [ ] T005 [P] [US1] 在 `extension/demo/index.html` 增加阅读状态 `#lesson-status` 和取消 `#lesson-cancel`。不预填阅读地址，不放置「识别结果」文案
- [ ] T006 [P] [US1] 在 `extension/demo/demo.css` 为 `#lesson-status` 增加与现有演示页一致的状态样式，窄屏下不挡住破壁入口
- [ ] T007 [US1] 在 `tests/helpers/fake-page.js` 登记 `#lesson-status` 与 `#lesson-cancel`
- [ ] T008 [US1] 在 `extension/src/page/main.js` 于视频时长可用时调用 T003 的采样并开始阅读。第一处通过后暂停到该 `time`。落定前禁用破壁。落定后 `dispose` 并再次 `createWake`，`preset` 只用该点已存曲线。尺寸不符只写入丢掉原因。交互文案为「这次阅读」。不修改 `extension/src/session/wake.js`，不改 `fallbackAfterMs`

**Checkpoint**: quickstart 第 1 节可以核对。不要把第 4 节记为通过

---

## Phase 4: User Story 2 - 下一个只跳已经算完的更晚一处 (Priority: P2)

**Goal**: 「下一个」只走向更晚的已存点。未就绪显示「还在读」。结束后没有更晚处则禁用并显示「没有下一处」。

**Independent Test**: 按下前和落定后的 `currentTime` 都能读到，中间破壁禁用。未就绪时 `currentTime` 不变。更早点晚到时不改变当前时间和覆盖层。

### Tests for User Story 2

- [ ] T009 [US2] 在 `tests/page-lesson.test.js` 增加断言：已存的更晚点被选中时先卸下覆盖层，落定前破壁禁用，落定后 `currentTime` 更大；无已存更晚点且仍在读时状态含「还在读」且 `currentTime` 不变；阅读结束后状态含「没有下一处」且按钮禁用；更早的迟到点不改变 `currentTime`

### Implementation for User Story 2

- [ ] T010 [US2] 在 `extension/demo/index.html` 增加 `#lesson-next`。可用、还在读、没有下一处三种状态的文案分别为按钮可点、「还在读」、「没有下一处」
- [ ] T011 [US2] 在 `extension/src/page/main.js` 实现这三种状态。按下已就绪的下一处时先退出当前交互层再定位。未落定（未暂停或时间差大于 0.2 秒）保持破壁禁用，不挂新层。未就绪时不调用阅读计算。后台入库不得改写当前 `currentTime` 和当前覆盖层

**Checkpoint**: quickstart 第 2 节的交互可以核对。前后时间的正式记录仍算 SC-003 未通过，直到 T015 把它们存下来

---

## Phase 5: User Story 3 - 失败退回，两段时间分开记 (Priority: P3)

**Goal**: 失败、断网或 5 分钟内没有通过点时回到 `breakglass-demo-9s.mp4`。两段耗时分开。2% 与 20 次样本未测得前，验收保持未通过。

**Independent Test**: 假的 `fetch` 失败后视频地址变为预先准备片子，前一绑定的点为空。`lesson-first-point` 与 `lesson-wake-visible` 分别存在。在样本不足 20 或 `maxRatio` 仍为 `null` 时，测试必须断言验收未通过，而不是改写成通过。

### Tests for User Story 3

- [ ] T012 [US3] 先写会失败的 `tests/lesson-ask.test.js`。请求体只有 `readingId`、`videoId`、`duration`、`courseText`、`frames`；`frames` 长度不超过 8；没有整段视频字段；`courseText` 超过 8000 字时不发送正文；截止为 300000ms；失败结果要求退回，且不调用会话 `fail`。测试不得访问网络
- [ ] T013 [P] [US3] 在 `tests/page-lesson.test.js` 增加断言：阅读失败后视频地址以 `breakglass-demo-9s.mp4` 结尾，且前一 `videoId` 的点被清空；验收片子地址等于该文件时不得开始作为阅读目标

### Implementation for User Story 3

- [ ] T014 [US3] 实现 `extension/src/lesson/ask.js`。只在当次地址非空时发送 T003 给出的采样。用调用方的 `fetch` 与时钟 `schedule(300000, handler)`。取消时中止未完成请求，保留已存点。新函数使用 JSDoc。地址不写入 `extension/assets/config.json`
- [ ] T015 [US3] 在 `extension/src/page/main.js` 把失败、断网、空地址和 5 分钟内零通过点转成退回 `../assets/video/breakglass-demo-9s.mp4`。清空失败片子的点。退回后的单点文案仍是「预先准备的示例」。用 `lesson-first-point` 与 `lesson-wake-visible` 分开 `record`，禁止写入 `fallback-visible`、`network-wait`、`vision-decision`。`lesson-wake-visible` 只在点已存好时记录
- [ ] T016 [US3] 在 `extension/src/page/main.js` 的破壁成功路径保留 `contentRect`。在已有测量能够写出有限 `maxRatio` 之前，保持 `measured: false`，并不得把 SC-005 标成通过。不把 `maxRatio: null` 当作 ≤ 0.02

**Checkpoint**: quickstart 第 3 节可以核对退回。第 4 节保持未通过，直到至少 20 次 `lesson-wake-visible` 且 `maxRatio` ≤ 0.02 被实际记下来

---

## Phase 6: Polish

- [ ] T017 [P] 更新 `docs/BreakGlass-ui-inventory.md`：自动开始、还在读、没有下一处、这次阅读、退回预先准备的片子，以及 SC-003 至 SC-005 尚未通过
- [ ] T018 [P] 更新 `README.md`：阅读在片子可播放时开始；验收片子不得使用 `breakglass-demo-9s.mp4`；失败才回到该文件
- [ ] T019 按 `specs/003-preplay-lesson-points/quickstart.md` 执行 `node --test`。第 4 节若记录仍缺，在结果里写明 SC-003、SC-004、SC-005 未通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup**: 无前置
- **Foundational**: 依赖 T001，阻塞全部故事
- **User Story 1**: 依赖 Phase 2
- **User Story 2**: 依赖故事 1 的暂停与破壁
- **User Story 3**: `ask.js` 可在 Phase 2 之后单独测试；退回接线依赖故事 1 的页面状态
- **Polish**: 依赖要交付的故事。只交付故事 1 时，说明里必须写明退回和 2% 记录还未做

### Parallel Opportunities

- T005 与 T006 可并行
- T012 与故事 1 的页面任务可并行，只要不同时改 `main.js` 的同一区域
- T017 与 T018 可并行

---

## Parallel Example: User Story 1

```bash
Task: "在 extension/demo/index.html 增加 #lesson-status 与 #lesson-cancel"
Task: "在 extension/demo/demo.css 增加阅读状态样式"
```

---

## Implementation Strategy

### MVP First

1. 完成 Phase 1 与 Phase 2
2. 完成故事 1
3. 按 quickstart 第 1 节核对
4. 此时还不能声称 20 次热缓存或 2% 已经通过

### Incremental Delivery

1. 故事 1：第一处暂停，破壁只取已存结果
2. 故事 2：「下一个」的三种状态
3. 故事 3：退回与分计时。记录未齐则验收保持未通过

---

## Notes

- 不修改 `extension/manifest.json` 的权限与 CSP
- 不修改 `extension/src/session/wake.js` 的工厂签名
- 不把阅读地址或密钥写入 `extension/assets/config.json`
- 不在尺寸不符时加载 `extension/assets/presets/demo-parabola.json` 作为该帧结果
- 不在本仓库实现外部阅读服务
- 不把空的 `maxRatio` 写成已经满足 2%
