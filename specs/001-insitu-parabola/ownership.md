# 任务分工：前端 / 后端

对照 [`tasks.md`](./tasks.md)，日期 2026-10-02。

P0 不新建服务、数据库或 FastAPI。这里的「后端」指结果契约、校验规则、预制数据和请求是否能进入交互；代码仍写在 `extension/`、`tests/` 和 `specs/001-insitu-parabola/contracts/`。感知代理要等宪法里的上传决定和仓库边界修订之后才能开工，下面不派这项。

编号任务 18 项：前端 10 项，后端 8 项。当前只剩 T017 的浏览器手工记录和正式演示素材验收；故事 2、故事 3 仍未派发。

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
| T017 | 未完成 | 按 `quickstart.md` 第 1 节加载未打包扩展，记录手工结果。不做第 2、3 节 |

当前只做 T017 的浏览器手工记录。T011、T012、T015 已收完；故事 1 的最终验收仍依赖正式视频和目标帧素材。

## 后端

负责哪份结果可以画、哪份必须拒绝，以及预制数据是否符合契约。不写演示页，不新建 `backend/`。

| 任务 | 状态 | 要写的内容 |
| --- | --- | --- |
| T004 | 已完成 | `tests/validate.test.js`：缺字段、非法数值、越界 region、未知 `equationId`、视频不匹配、`source: "vision"` 都要拒绝 |
| T006 | 已完成 | `extension/src/curve/validate.js`。`time` 用秒，默认容差 ±0.2 秒 |
| T008 | 已完成 | `extension/src/curve/evaluate.js`。只注册夹具 `fixture.parabola`，不把某条代数式写成正式公式 |
| T009 | 已完成 | `extension/assets/config.json`：`enableLocalMock`、`fallbackAfterMs: 1500`、`externalAttempt: "off"`。不得写密钥或上传地址 |
| T011 | 已完成 | `tests/session.test.js` 覆盖 `externalAttempt` 非 `off`、单会话、播放/离开目标时间结束会话，以及原有校验规则 |
| T012 | 已完成 | `extension/src/session/session.js` 收紧会话入口和生命周期；非 `off` 不得进入交互，播放/离开目标时间使旧请求失效 |
| T013 | 已完成 | `extension/assets/presets/` 里的夹具 JSON |
| T018 | 已完成 | 对照 `contracts/extension-surface.md` 核对 manifest：无主机权限、无内容脚本、无远程脚本 |

T011、T012、T015 已完成。前端接下来只做 T017。

## 交接顺序

1. 后端已完成 T011、T012。非 `off` 在进入等待前就被拒绝，进行中的会话不会被第二次唤醒替换。
2. 前端已完成 T015。页面调用会话状态，播放或离开目标时间时走 `onPlaybackChange`。
3. 前端做 T017，并把手工记录写回任务说明。
4. T017 和正式视频到位前，双方都不开始故事 2。

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
