# BreakGlass 前端验证记录

> 本文是前端自动化与手工验收的落盘记录，目标路径见 `specs/001-insitu-parabola/tasks.md` 的 T030。
> 更新日期：2026-10-03。

## 1. 自动化基线

| 命令 | 结果 |
| --- | --- |
| `node --test` | **182 项通过，0 失败，0 待办**（当前 `main`；本轮识别适配切片见 §4） |
| `node --check`（extension 与 tests 全部 JavaScript） | 通过 |
| `scripts/verify.mjs`（本地工作区工具，未进入本仓库） | 语法检查 + 全量测试通过 |

### 覆盖范围

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/validate.test.js`、`tests/evaluate.test.js`、`tests/preset-contract.test.js` | CurveResult 放行/拒绝、求值器白名单、运行配置与预制夹具契约 |
| `tests/content-rect.test.js` | `contain` 黑边计算、`object-position` 的百分比/px/关键字/数字解析、非有限尺寸防御 |
| `tests/session.test.js`、`tests/backend-edges.test.js` | 会话生命周期、目标时间门禁、参数钳制、复制结果副本、边缘情况 |
| `tests/wake-timeout.test.js` | 假时钟驱动的 1500ms 回退、迟到丢弃、取消、5 次循环 |
| `tests/wake-contract.test.js` | 交接接口形状：`createWake({ session, config, preset, clock, onChange, attempt })`、五个方法、状态字段与别名字段禁令 |
| `tests/latency.test.js`、`tests/place-in-frame.test.js` | 内存计时摘要与 P50/P95；预制区域按当前帧宽高比换算 |
| `tests/external-simulator.test.js` | `off`/`hang`/`invalid`/`late` 四模式确定性、无网络、无遗留定时器 |
| `tests/alignment.test.js` | 四画幅映射、源↔页面往返、2% 偏差比例与阈值边界、采样 |
| `tests/page-integration.test.js` | 演示页脚本顺序、控件与 `aria-live`、覆盖层定位、无远程资源、`createWake` 接线 |
| `tests/page-p2.test.js`、`tests/page-p3.test.js` | 假 DOM 驱动真实 `main.js`：等待/回退/取消/重试、窗口/全屏/方向/DPR 重算与测量输出 |

## 2. 尚未执行（不得写成已通过）

| 项 | 原因 |
| --- | --- |
| T017：扩展内演示页的浏览器手工主路径 | 当前环境没有可控浏览器会话 |
| T030：quickstart 第 2 节的 `hang`/`invalid`/无缓存/取消手工演练与 SC-003 的 P50/P95 | 同上；且需要连续多次采样 |
| T038：四画幅 + 窗口变化 + 全屏/DPR 的真机 2% 记录 | 同上。9 秒片已在仓库，但这一项要的是四种画幅和窗口变化，不是第 6 秒这一帧 |
| 正式视频与配套曲线素材 | 9 秒片已在仓库。区域按第 6 秒写。这一帧的手工读数见 §6，不能写成 2% 验收通过 |

## 3. 证据口径

- 自动化测试证明的是**状态机、校验与坐标映射**；假 DOM 测试不能替代真实浏览器的布局与事件语义。
- 9 秒片第 6 秒的一帧手工读数见 §6。它只说明这一帧，**不能**代替 T030、T038 或四画幅 2% 验收。
- 性能类结论（回退 ≤100ms）目前只有假时钟下的确定性断言，没有真实采样数据。

## 4. 识别适配切片（`specs/002-vision-result-adapter/`）

### 4.1 自动检查（2026-10-02 执行）

| 命令 | 结果 |
| --- | --- |
| `node --test` | **182 项通过，0 失败，0 待办** |
| `node --check`（extension 与 tests 全部 JavaScript） | 39 个文件通过 |

新增的测试文件：

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/vision-validate.test.js` | 没有 `allowVision` 时 vision 仍被拒；`evidence` 必须是 `packaged-sample`；识别样例的 `fallback` 必须为 `null`；可信程度缺省时可放行、存在时必须落在 0–1 且低于 0.5 拒绝；`preset` 不得夹带 `evidence` |
| `tests/vision-config.test.js` | 提交配置 `visionAdapter: off`；缺省、空串或其他值一律按 `off`；读取失败路径同样归一化，不残留 `fixture` |
| `tests/vision-wake.test.js` | `off` 走预制；`fixture` + 匹配样例进入 `interactive`，`source: vision` 与 `evidence` 一路到页面；即使没有预制结果也能成功；识别成功不人为等待 1500ms |
| `tests/vision-reject.test.js` | 九类坏样例全部进入可恢复错误（`external_unavailable` + 同一句 `message`、`result` 为 `null`、从未进入交互）；外部演练优先于识别样例；取消/退出/离开目标时间后丢弃迟到结果；`hang` 仍在 1500ms 回退到预制 |
| `tests/vision-latency.test.js` | 识别成功与识别失败各记一条 `vision-decision`；识别路径不写 `fallback-visible`；预制路径不写识别计时；样本只含名称、毫秒数与缓存状态 |
| `tests/page-vision.test.js` | 页面按 `evidence === 'packaged-sample'` 显示「识别结果」；识别来源不是警示态；不读也不显示可信程度；页面文件无远程地址、动态代码或密钥 |

### 4.2 尚未执行（不得写成已通过）

| 项 | 原因 |
| --- | --- |
| `quickstart.md` 第 1–5 节：关闭开关连唤 10 次、打开样例离线走通、三类非法样例、`hang` 回退复核、配置改回 `off` | 当前环境没有可控浏览器会话 |
| SC-002（90 秒内完成唤醒、改参、重置、退出） | 同上 |
| 包内 9 秒片子的识别样例画幅 | 演示片已在仓库，预制区域已按 3024×1898 第 6 秒改写。识别样例 `extension/assets/vision/fixture-parabola.json` 这次没有改；识别路径不做画幅换算 |

### 4.3 提交配置

由 `tests/vision-config.test.js` 自动断言：`visionAdapter: off`、`externalAttempt: off`、`fallbackAfterMs: 1500`。任何演练结束后必须回到这三个值。

## 5. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-02 | 首次建立验证记录：自动化基线 96 项、覆盖范围、未执行项与证据口径 |
| 2026-10-02 | 合并 `origin/main`（PR #26 `ui`、PR #27 6 秒帧适配）后重跑：基线 118 项通过；`tests/wake-contract.test.js` 改写为按 `.specify/memory/constitution.md` 1.3.0「交接接口」校验 |
| 2026-10-02 | 解决 PR #30 与 `main` 的冲突后重跑：`node --test` 137 项通过。残缺帧尺寸不再记成准备结果不可用 |
| 2026-10-02 | T001–T018 执行完毕：宪法修订到 1.4.0、识别开关与样例、同一个校验器放行识别样例、页面来源文案与识别计时接入。自动基线 **182 项通过**；quickstart 手工验收与真实画幅对齐**未执行** |
| 2026-10-03 | 9 秒片进入仓库。预制区域改成 3024×1898 第 6 秒的 `y = x^2 + 1`。`node --test` **264 项通过，0 失败**。第 6 秒一帧手工最大偏差比例 0.000914，见 §6。T030、T038 与开播前阅读 SC-003 至 SC-005 仍未通过。`publishAlignment` 仍是 `measured: false`、`maxRatio: null` |

## 6. 9 秒片第 6 秒的一帧手工读数（2026-10-03）

片子是 `extension/assets/video/breakglass-demo-9s.mp4`：H.264，3024×1898，时长 9.383 秒。第 6.0 秒画面是「顶点式二次函数的图象」。表格和蓝色实线是 `y = x^2 + 1`。预制初值 `a = 1`、`h = 0`、`k = 1`，`domain` 为 -2.5 到 2.5，`range` 为 0 到 8，`region` 为 `{ x: 629, y: 561, width: 538, height: 866 }`。

下面用 `alignment.deviationRatio`。期望点是静帧上的读数，实际点是 `mathPointToSource`。较短边用整帧高度 1898。比例等于页面上「距离 ÷ 内容区较短边」，因为两边同时乘显示比例。

| 点 | 画面像素 | 预制映射 | 距离（源像素） | deviationRatio |
| --- | --- | --- | --- | --- |
| 左侧，x = -2，y = 5 | (684.5, 886.1) | (682.80, 885.75) | 1.74 | 0.000914 |
| 顶点，x = 0，y = 1 | (897.7, 1320.2) | (898.00, 1318.75) | 1.48 | 0.000780 |
| 右侧，x = 2，y = 5 | (1113.7, 886.5) | (1113.20, 885.75) | 0.90 | 0.000475 |
| 区域中心 | 五点拟合窗口中心 (898.54, 994.31) | (898, 994) | 0.62 | 0.000327 |

这一帧四个点的最大比例是 **0.000914**。左右两点和顶点是表格红点的中心。区域中心是 domain / range 窗口中心相对取整后矩形中心的偏差。

浏览器里打开演示页，片子自己播出来，空状态「选择视频」已隐藏。暂停在 6.0 秒后破壁：覆盖层压在蓝色实线上，控制点在顶点，来源是「预先准备的示例」。当时 `window.__breakglassAlignment` 为 `measured: false`、`maxRatio: null`、`withinTolerance: null`。内容区约 690×433，显示比例约 0.228，和上面的源像素比例一致。

这次核对用了能响应 `Range` 的本地服务。原来停在 8765 的 `python -m http.server` 对 `Range` 仍回 200，媒体元素的 `seekable` 是 `[0, 0]`，定位停在 0 秒。扩展页自己的 `chrome-extension://` 地址不受这个静态服务限制。

这只是第 6 秒这一帧的手工读数。不勾 T030、T038，也不把开播前阅读的 SC-003、SC-004、SC-005 写成通过。
