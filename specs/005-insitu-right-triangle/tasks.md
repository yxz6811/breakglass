# Tasks: 当前帧直角三角形学习闭环

**Date**: 2026-10-03 | **Feature**: `005-insitu-right-triangle`

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[scene-actions.md](./contracts/scene-actions.md)、[quickstart.md](./quickstart.md)

**Governance**: [AGENTS.md](../../AGENTS.md) 的 005 范围、[Spec Kit Constitution 1.9.0](../../.specify/memory/constitution.md)、[BreakGlass 产品约束 1.7.0](../../docs/BreakGlass-constitution.md)。005 是独立 P1，不改变 `CurveResult`、`createWake`、001 的 1500ms 保底、003 自动开播前阅读及 004 的已有曲线范围。

**Status**: 下列 25 项全部待实施。文档生成、已有抛物线代码或替身测试不代表任务完成；只有对应检查和记录满足门槛后才能勾选。所有未存在的源码、测试和验证记录路径均为**拟新增**，`plan.md` 列明拟修改已有文件。

**Format**: `[P]` 表示在前置完成后可由不同独占文件并行；不是负责人或工期承诺。US1 手动实验，US2 当前帧识别/校对，US3 问答动作，US4 恢复/理解/返回。

## G1 — 契约与拒绝边界

- [ ] T001 对照 `contracts/scene-actions.md` 冻结 `SceneResult(kind=right-triangle,schemaVersion=1.0.0)`、`/geometry/read` 和 `/geometry/ask` 的输入/输出及动作字段；在拟新增 `tests/fixtures/geometry/` 准备 3-4-5、6-4、同单位、非法值、错帧/错revision、超限、不支持动作和冲突夹具。检查治理版本和 FR-027～029 一致，不加入全图识别或任意代码执行。（SC-003、SC-007；quickstart 契约检查）
- [ ] T002 在拟新增 `extension/src/geometry-scene/validate.js` 与 `tests/geometry-scene.test.js` 实现共享校验：身份/源尺寸/源像素点、固定直角 A、白名单单位、AB/AC 正有限、合法范围与来源标记；拒绝把供应商 BC 当答案，拒绝未知字段所携带的代码语义。导出到独立几何命名空间，不扩大曲线校验器。（FR-007～010、027～029；SC-001、SC-003）

**门槛**：T001/T002 的拒绝与放行夹具通过；契约、规格和治理一致，才能接入页面或模型。

## G2 — 确定性算法、独立会话与画板

- [ ] T003 在拟新增 `extension/src/geometry-scene/solve.js` 增加确定性长度/坐标计算，并扩展拟新增 `tests/geometry-scene.test.js`：3-4-5、AB=6/AC=4、极小/极大有限输入、计算溢出拒绝、同单位与直角保持；使用 `Math.hypot` 派生 BC，数学量和源像素定位分离。（US1，FR-007～014；SC-001）
- [ ] T004 在拟新增 `extension/src/geometry-session/session.js` 和 `tests/geometry-session.test.js` 实现独立 `geometry-session`：候选确认、不可变原题快照、当前场景、单调 `sceneRevision`、请求所有权与退出清理；改值或恢复后旧请求失效，任何拒绝不改变快照和当前 revision。（US1/US2/US4；SC-003、SC-004、SC-007）
- [ ] T005 在拟新增 `extension/src/geometry-scene/actions.js` 和 `tests/geometry-actions.test.js` 实现 `set_length`、`explain_change`、`restore_original` 的白名单处理：单次最多一条改边动作，固定另一条边；收到多条 `set_length`、不支持、越界、冲突、单位不符或非有限结果时整批拒绝；先在临时状态验证再原子提交，解释读取程序前后状态。（US1/US3，FR-015～019；SC-001、SC-002）
- [ ] T006 [P] 在拟新增 `extension/src/geometry-scene/view.js` 绘制三角形、A/B/C、直角符号、AB/AC 与派生 BC；约束控制点拖动只改变允许的长度，持续显示真实/预设/手工来源和校正标记，空候选或非法状态不显示成功结果。（US1，FR-007～014；SC-001、SC-006）
- [ ] T007 [P] 在拟新增 `extension/demo/geometry.html`、`geometry.css` 预留独立 005 面板与样式，支持带标签的数值输入、键盘修改、焦点、取消和状态提示；在拟新增 `tests/page-geometry.test.js` 验证主操作有效，窄屏和长提示不遮挡视频控制。（US1；SC-002、SC-007；quickstart 手工画板）

**门槛**：不用模型完成手工 3-4-5、6-4、拖动、非法输入拒绝及原题恢复；不以预设演示宣称真实识别通过。

## G3 — 暂停当前帧、候选校对与页面接线

- [ ] T008 [P] 在拟新增 `extension/src/geometry-scene/frame.js` 和 `tests/geometry-frame.test.js` 采集用户显式触发时的单张暂停帧；带 `requestId/videoId/frameTime/frameSize/sceneRevision`，建议 ≤640px JPEG，源像素与显示坐标按 `content-rect.js` 映射；检测采集中播放、seek、换视频或尺寸失效并拒绝，不调用 003 稀疏采样。（US2，FR-001～006、024～026；SC-003）
- [ ] T009 [P] 在拟新增 `extension/src/geometry-scene/request.js` 和 `tests/geometry-request.test.js` 接入独立 `/geometry/read`、`/geometry/ask` JSON 请求及取消/预算；客户端也检查 4MiB，识别30s/问答10s仅开发默认；错身份/错revision、超时/取消后迟到回复全部忽略，不向浏览器交付秘密。（US2/US3；SC-003、SC-006）
- [ ] T010 在拟新增 `extension/src/page/geometry.js` 和独立工作台 接入显式 005 入口、独立 view/session/request；先用明确标识的手工/预设候选验证闭环。播放、换帧或退出时取消并卸层，保留原视频，不自动替换成包内示例，不调用 `createWake` 接收三角形。（US2；SC-003、SC-007）
- [ ] T011 在拟新增 view 与独立 geometry.html 页面中实现候选校对：标签、∠A=90、AB/AC、单位和定位可检查，未知/冲突字段不能自动确认；首次确认才冻结 original 并开启交互，校正后 `originSource/editedByUser` 如实更新。（US2，FR-001～006、024～026；SC-004、SC-006）
- [ ] T012 扩展拟新增 `tests/page-geometry.test.js` 验证错视频/时间/尺寸、确认前操作、编辑后迟到结果、取消/退出/再入与监听清理；定向运行已有曲线页面及 lesson 测试，确认 001 的1500ms与003自动阅读/下一点、004范围未受005入口影响。（US2；SC-003、SC-007；quickstart 视频与校对）

**门槛**：手工或预设候选在当前帧确认、交互、拒绝及退出流程通过；当前帧采集不能冒充整段自动阅读。

## G4 — 本地 reader 与真实单帧识别

- [ ] T013 [P] 在拟新增 `breakglass-reader/src/geometry-scene.mjs`、`breakglass-reader/tests/geometry-read.test.mjs` 及已有 server/settings 增加独立 `/geometry/read`；沿用每包4MiB并在解码/上游前拒绝超限，来源允许列表、断开中止、独立并发/预算，日志不落帧/秘密/完整问题，不保存业务会话。（US2；SC-003、SC-006）
- [ ] T014 [P] 在拟新增 `breakglass-reader/src/geometry-model.mjs` 实现仅单直角三角形的结构化候选提示与供应商适配；秘密读取环境变量；候选缺边长/单位、不是目标图形或冲突时给可校对/拒绝结果，禁止按示意图比例猜已知边。用替身验证合法/非法 JSON、供应商失败、取消与超时，不执行输出。（US2；SC-004、SC-006）
- [ ] T015 按 quickstart 用已配置真实供应商做预跑，在拟新增 `docs/BreakGlass-geometry-validation.md` 记录模型、样本、设备/Chrome、网络、识别/问答耗时和失败；据证据冻结独立预算及配置。30s/10s若未验证仍写开发默认，秘密不进入文档或提交；缺模型配置时本项保持未完成。（US2/US3；SC-006）
- [ ] T016 连接真实单帧候选与校对界面，在 quickstart 冻结的真实视频样本上执行识别→校正→确认→拖动/输入→BC变化，分别记录首次识别是否正确与人工校正后的结果；无图形/错图形/模糊/超时不冒充成功，手工与预设记录另列。（US2；SC-003、SC-004、SC-006；quickstart 真实识别）

**门槛**：真实模型配置及预跑记录齐备，至少冻结样本完成链路；替身可证明边界正确，不能替代真实识别验收。

## G5 — 当前场景问答与受限动作

- [ ] T017 [P] 在拟新增 view 与独立 geometry.html 页面增加问题输入、提交中/取消/失败反馈、解释和动作结果；问题发往已确认场景，保留输入，允许取消，不为请求再上传新帧，未确认时禁用并说明原因。（US3，FR-015～019；SC-002、SC-003）
- [ ] T018 [P] 在拟新增 `breakglass-reader/src/geometry-actions.mjs` 和 `breakglass-reader/tests/geometry-ask.test.mjs` 实现 `/geometry/ask`：只接收白名单场景及本次问题，输出候选动作和解释意图；使用独立预算/中止，拒绝代码/未知动作/非法参数，模型声明的答案不成为权威值。提示与Schema放在reader，扩展不持有秘密。（US3；SC-002、SC-006）
- [ ] T019 在005 页面接线及拟新增 request/session/actions 串接自然语言动作：响应的 request/video/frame/revision 全匹配后，整批验证并提交；“把 AB 改为6”与手工改6同值且AC固定，解释显示程序实际 BC 和前后变化；恢复动作递增revision。（US3，FR-015～019；SC-002、SC-003）
- [ ] T020 在拟新增 `tests/geometry-actions.test.js`、`geometry-request.test.js`、`page-geometry.test.js` 覆盖提示诱导代码、未知动作、越界、多条 `set_length`、同时改两边、冲突批次、用户先改值、恢复/换帧后迟到回复、连续提问与断网；拒绝或失败保持原题快照/当前场景，不出现部分更新或假成功。再单独记录真实模型动作结果。（US3；SC-002、SC-003、SC-006；quickstart 问答动作）

**门槛**：手工与自然语言修改结果一致；失败和非法动作均原子保持；真实模型问答和替身安全验证分别有证据。

## G6 — 恢复、理解验证、返回与交付

- [ ] T021 在拟新增 view/session 与 `tests/page-geometry.test.js` 增加一道基于当前确认题目的理解题，答案及容差由本地确定性程序产生；记录对错、反馈和重试，不以点击/拖动次数作为理解通过，说明只验证本次回答。（US4，FR-020～023；SC-005）
- [ ] T022 串接“恢复原题”和“继续视频”：恢复首次确认快照且revision递增；继续视频回到进入005时的暂停时间，按用户操作继续播放；退出清理层/监听/请求，原播放器可用。验证已恢复/未恢复及问题未答对时的合理返回行为。（US4；SC-003、SC-004、SC-005）
- [ ] T023 在确定版本Chrome手工验证完整“暂停→识别/校对→修改→问答→恢复→理解题→返回”流程；覆盖键盘/焦点/ESC、长标签、非正输入、错误重试及16:9/4:3/竖屏/黑边和窗口变化，记录未测试设备，不宣称全平台兼容。（US1～US4；SC-001～007；quickstart 完整闭环）
- [ ] T024 在拟新增验证记录中分别记录真实截图对齐、识别等待、模型对话、已存场景修改到可见呈现等指标，注明起止事件、缓存/浏览器/机器及样本；双rAF不当实际像素时刻，不混入001的1500ms/100ms或003计时，不以单次表现宣称长期学习收益。（SC-005、SC-006、SC-007）
- [ ] T025 对实际存在的新增测试先运行定向 `node --test <文件>`，再运行 `node scripts/check.mjs` 和仓库现有全量检查，处理本切片回归；更新 README/quickstart/拟新增验证记录的真实执行结果、预设/手工/真实模型区分和未通过事项。只有G1～G6及SC-001～007的适用证据齐备才标记005完成。（SC-001～007）

**门槛**：理解题、恢复和返回原视频通过；001～004回归无本切片引入的变化；真实模型及像素证据不足的项目如实保持未通过。

## 依赖、并行与验收映射

主线：T001 → T002 → T003/T004/T005 → G2画板 → G3视频校对 → G4真实识别 → G5问答 → G6学习与交付。T005依赖T003/T004；T010依赖T006/T008/T009；T011依赖T010；T016依赖T011/T013/T014/T015；T019依赖T005/T009/T017/T018；T021/T022依赖稳定会话与页面；T025依赖拟交付项完成。

- T006/T007、T008/T009、T013/T014、T017/T018可在契约冻结后按独占文件并行，集成者串行处理geometry.js和server/settings的合入。
- T015的真实预跑必须已提供模型配置；缺少配置不阻断可独立验证的算法、手工画板和请求边界，但G4/G5真实验收仍未通过。
- 未指定负责人、日期或预计工时；进入实施时按工作区实际状态分配，不把[P]视为同时编辑同一文件的许可。

| 验收项 | 主要任务 | 必须保留的证据 |
| --- | --- | --- |
| SC-001 确定性数学 | T002、T003、T005、T006、T023 | 3-4-5、6-4、非法/溢出拒绝、直角保持 |
| SC-002 手工与自然语言一致 | T005、T007、T017～020 | 同一初始场景下数值/几何一致、解释来自实际状态 |
| SC-003 帧身份/旧结果拒绝 | T001、T004、T008～010、T012、T019、T020、T022 | 错视频/时间/尺寸/revision、取消后迟到不覆盖 |
| SC-004 确认与恢复 | T004、T011、T014、T016、T022 | 候选确认前不可交互、原题快照与递增revision |
| SC-005 学习与返回 | T021～024 | 理解题对错/重试、原视频时间及清理 |
| SC-006 数据来源分开验收 | T006、T009、T013～016、T018、T020、T024、T025 | 手工/预设/替身与真实模型分列，预算冻结记录 |
| SC-007 范围及既有链路隔离 | T001、T004、T010、T012、T023～025 | CurveResult/createWake/1500ms/003阅读及004范围回归 |

本任务文件本身不证明任何代码或验收完成；本轮创建文档时全部复选框保持未勾选。
