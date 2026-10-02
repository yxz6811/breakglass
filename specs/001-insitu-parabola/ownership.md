# 任务分工：前端 / 后端

对照 [`tasks.md`](./tasks.md)，日期 2026-10-02。

P0 不新建服务、数据库或 FastAPI。这里的「后端」指结果契约、校验规则、预制数据和请求是否能进入交互；代码仍写在 `extension/`、`tests/` 和 `specs/001-insitu-parabola/contracts/`。感知代理要等宪法里的上传决定和仓库边界修订之后才能开工，下面不派这项。

编号任务 18 项：前端 10 项，后端 8 项。后端编号任务已经完成。还剩前端的 T015 和 T017。

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
| T015 | 未完成 | `extension/src/page/main.js`。还要改成来源始终是「预先准备的示例」；已有覆盖层时 Alt+B 不再挂第二层；点击覆盖层外部会退出并保持暂停；源尺寸用当前视频的 `videoWidth` 与 `videoHeight` |
| T016 | 已完成 | 视频缺失时的说明，`extension/assets/video/README.md` |
| T017 | 未完成 | 按 `quickstart.md` 第 1 节加载未打包扩展，记录手工结果。不做第 2、3 节 |

当前就做 T015，接着做 T017。T015 要等后端的 T012 收完再改页面里的会话调用。

## 后端

负责哪份结果可以画、哪份必须拒绝，以及预制数据是否符合契约。不写演示页，不新建 `backend/`。

| 任务 | 状态 | 要写的内容 |
| --- | --- | --- |
| T004 | 已完成 | `tests/validate.test.js`：缺字段、非法数值、越界 region、未知 `equationId`、视频不匹配、`source: "vision"` 都要拒绝 |
| T006 | 已完成 | `extension/src/curve/validate.js`。`time` 用秒，默认容差 ±0.2 秒 |
| T008 | 已完成 | `extension/src/curve/evaluate.js`。只注册夹具 `fixture.parabola`，不把某条代数式写成正式公式 |
| T009 | 已完成 | `extension/assets/config.json`：`enableLocalMock`、`fallbackAfterMs: 1500`、`externalAttempt: "off"`。不得写密钥或上传地址 |
| T011 | 已完成 | `tests/session.test.js`：非 `off` 不得进入交互；第二次唤醒替换旧会话；播放或离开目标时间后结果被清掉 |
| T012 | 已完成 | `extension/src/session/session.js`：只有 `off` 进入交互；播放或离开目标时间由会话自己结束 |
| T013 | 已完成 | `extension/assets/presets/` 里的夹具 JSON |
| T018 | 已完成 | 对照 `contracts/extension-surface.md` 核对 manifest：无主机权限、无内容脚本、无远程脚本 |

T011 和 T012 已完成。前端可以按会话状态收 T015。

## 交接顺序

1. 后端已完成 T011、T012。
2. 前端再收 T015。页面只调用会话给出的状态，不自己另判一套「能不能画」。播放或离开目标时间时调用 `onPlaybackChange`。
3. 前端做 T017，并把手工记录写回任务说明。
4. T015 和 T017 完成前，双方都不开始故事 2。

## 还没编号的后续

故事 1 验收前不要做。真要拆的时候，仍按「前端略多」派。

| 内容 | 归属 | 原因 |
| --- | --- | --- |
| 故事 2：超时文案、无准备结果时的重试和退出、连续换帧时不让旧结果留在画面上、超时到曲线出现的 0.1 秒记录 | 前端 | 都是演示页上看得见的结果 |
| 故事 2：1.5 秒后才允许改用预制结果、迟到结果丢弃、取消后旧 `requestId` 失效 | 后端 | 决定哪一次结果还能进入交互 |
| 故事 3：四种画幅、2% 测量、全屏和设备像素比变化后的重算 | 前端 | 只涉及内容矩形和覆盖层 |
| 真实识别、单帧上传、感知代理 | 暂不派 | 宪法允许的服务端只有无状态感知代理，而且现在不准在本仓库开工 |
| Pyodide、代码执行 | 暂不派 | 独立 P1，不进这次任务 |
| FastAPI 或其他业务后端 | 不派 | P0 明确不做 |
