# 任务分工：前端 / 后端

对照 [`tasks.md`](./tasks.md)，日期 2026-10-02。

P0 不新建服务、数据库或 FastAPI。这里的「后端」指结果契约、校验规则、预制数据和请求是否能进入交互；代码仍写在 `extension/`、`tests/` 和 `specs/001-insitu-parabola/contracts/`。感知代理要等宪法里的上传决定和仓库边界修订之后才能开工，下面不派这项。

故事 1 的编号任务已完成。团队确认 MVP 可以进入 P2。故事 2 的两人分工见下文「P2 两人并行」；细节与写权限见 [`ownership-story-2.md`](./ownership-story-2.md)。故事 3 仍不派发。

## 前端

负责扩展表面、演示页、黑边、绘制和手工验收。

| 任务 | 状态 | 要写的内容 |
| --- | --- | --- |
| T001 | 已完成 | `extension/` 与 `tests/` 目录 |
| T002 | 已完成 | `extension/manifest.json` |
| T003 | 已完成 | `extension/src/background/service-worker.js` |
| T005 | 已完成 | `tests/content-rect.test.js` |
| T007 | 已完成 | `extension/src/geometry/content-rect.js` |
| T010 | 已完成 | `extension/src/preset/load.js`：读配置和预制 JSON，把校验失败显示出来，不交出可绘制结果 |
| T014 | 已完成 | `extension/demo/index.html`、`extension/demo/demo.css` |
| T015 | 已完成 | `extension/src/page/main.js`：来源始终是「预先准备的示例」；已有覆盖层时 Alt+B 不再挂第二层；点击覆盖层外部退出并保持暂停；源尺寸使用当前视频的 `videoWidth` 与 `videoHeight` |
| T016 | 已完成 | 视频缺失时的说明，`extension/assets/video/README.md` |
| T017 | 不阻塞 P2 | 正式视频仍未提供。故事 1 的夹具主路径已作为 MVP 接受，P2 用同一套夹具演练等待，不把夹具记成正式素材验收 |

故事 1 的页面与会话已经收口。P2 不再等待 T017。

## 后端

负责哪份结果可以画、哪份必须拒绝，以及预制数据是否符合契约。不写演示页，不新建 `backend/`。

| 任务 | 状态 | 要写的内容 |
| --- | --- | --- |
| T004 | 已完成 | `tests/validate.test.js`：缺字段、非法数值、越界 region、未知 `equationId`、视频不匹配、`source: "vision"` 都要拒绝 |
| T006 | 已完成 | `extension/src/curve/validate.js`。`time` 用秒，默认容差 ±0.2 秒 |
| T008 | 已完成 | `extension/src/curve/evaluate.js`。只注册夹具 `fixture.parabola`，不把某条代数式写成正式公式 |
| T009 | 已完成 | `extension/assets/config.json`：`enableLocalMock`、`fallbackAfterMs: 1500`、`externalAttempt: "off"`。不得写密钥或上传地址 |
| T011 | 已完成 | `tests/session.test.js` 覆盖 `externalAttempt` 非 `off`、单会话、播放/离开目标时间结束会话，以及原有校验规则；14 项通过 |
| T012 | 已完成 | `extension/src/session/session.js` 收紧会话入口和生命周期；非 `off` 不得进入交互，播放/离开目标时间使旧请求失效 |
| T013 | 已完成 | `extension/assets/presets/` 里的夹具 JSON |
| T018 | 已完成 | 对照 `contracts/extension-surface.md` 核对 manifest：无主机权限、无内容脚本、无远程脚本 |

T011 和 T012 已完成。前端已按会话状态收完 T015。

## P2 两人并行

日期 2026-10-02。对照 [`tasks.md`](./tasks.md) 的 T019–T030。这里的「后端」仍是结果规则，代码在 `extension/src/session/`、`extension/src/attempt/`、`extension/src/telemetry/` 和对应测试里，不新建 `backend/`。

两人从现在起可以同时开工。页面只调用 `createWake` 给出的状态，不自己判断 1.5 秒、不自己丢弃迟到结果、不自己决定能不能画。

### 后端（结果规则）

只改这些路径：

- `tests/wake-timeout.test.js`、`tests/external-simulator.test.js`
- `tests/session.test.js`、`tests/backend-edges.test.js`
- `extension/src/attempt/simulator.js`
- `extension/src/session/wake.js`、`extension/src/session/session.js`
- `extension/src/telemetry/latency.js`

| 任务 | 要交出来的东西 |
| --- | --- |
| T021、T022 | 先红的假时钟测试 |
| T023 | `hang` / `invalid` / `late` / `off` 四种确定性替身，无网络、无密钥 |
| T024 | `createWake`：冻结上下文、1500ms 看门狗、回退前重校验、取消、迟到丢弃 |
| T025 | `off` 仍立刻进入交互；非 `off` 可以等待，失败不得变成识别成功 |
| T028 的模块 | `latency.js` 的 `mark` 与 `summary`。不改 `main.js` |

### 前端（页面）

只改这些路径：

- `extension/demo/index.html`、`extension/demo/demo.css`
- `extension/src/page/main.js`
- `tests/page-integration.test.js`
- `docs/BreakGlass-frontend-validation.md`

| 任务 | 要交出来的东西 |
| --- | --- |
| T026 | 等待态「取消」、失败态「重试 / 退出」、`aria-live`、焦点可见。此任务不引入新脚本 |
| T027 | `createWake` 交齐后，把等待、取消、重试、退出和来源文案接到 `main.js`，并在「判定超时」「首个可见 SVG 帧」调用 `mark` |
| T029 的页面测试 | `tests/page-integration.test.js` |
| T030 | quickstart 第 2 节的手工记录。演练后把 `externalAttempt` 留在 `off` |

### 交接接口

模块签名只以 `.specify/memory/constitution.md` 的「交接接口」为准。这里不再另写一份。`BreakGlass.wake` 只导出 `createWake`。页面调用 `start`、`cancel`、`exit`、`onPlaybackChange`、`dispose`，并只消费 `onChange` 里的 `getState()`。页面不读取替身模块，也不自己判断 1.5 秒。

页面按 `state.status` 和 `result.fallback` 显示文案：

| 状态 | 页面显示 |
| --- | --- |
| `waiting` | 等待说明，焦点移到「取消」 |
| `interactive` 且 `fallback` 为 null | 预先准备的示例 |
| `interactive` 且 `fallback` 为 `timeout` | 预先准备的示例 · 超时回退；因等待超过 1.5 秒，改用预先准备的示例。 |
| `recoverable-error` | 使用 `state.message`，并显示「重试」「退出」 |

### 当天怎么并行

1. 后端写 T021、T022，接着实现 T023–T025 和 `latency.js`。
2. 前端同时做 T026，只动演示页的结构和样式。
3. 后端的 `node --test` 通过并交出 `createWake` 之后，前端再改 `main.js`（T027）并补 `tests/page-integration.test.js`。
4. 前端做 T030。后端在此期间不改 `extension/src/page/` 和 `extension/demo/`。

### 仍不派发

故事 3 的四种画幅，以及真实识别、单帧上传、感知代理、Pyodide、FastAPI。`extension/assets/config.json` 提交时保持 `externalAttempt` 为 `off`。

