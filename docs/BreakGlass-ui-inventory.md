# BreakGlass 功能与参数清单（面向按钮 UI 与交互动画设计）

> 2026-10-06 双入口补充：插件为主入口，网站视频导入识别新增 BG-F12/BG-U13，复用分析/互动及共享视觉令牌，具备独立文件与传输状态；以最新产品/UI规划和 Constitution 2.1.0 原则 XIII 为准。新增能力均待实施。

> 2026-10-06 新规划入口：本表继续记录既有工作台现状；插件网课热点、账号学习网站及版权/地区门禁按 [UI 规划](./BreakGlass-ui-plan-2026-10-06.md) 与 [风险方案](./BreakGlass-rights-and-risk-plan-2026-10-06.md) 独立实施。本次不把 BG-F/BG-U 规划项写成已有按钮或已通过验收。

| 项 | 值 |
| --- | --- |
| 版本 | 2.6.0 |
| 日期 | 2026-10-03 |
| 基线 | 001/003 曲线工作台与 005 当前帧几何工作台；2026-10-03 统一浅色冰面，共享视觉源 `extension/src/ui/theme.css` |
| 用途 | 按钮 UI、交互动画、参数调节控件的设计输入 |
| 配套 | 令牌与动效数值见 [`BreakGlass-visual-spec.md`](./BreakGlass-visual-spec.md)；逐交互设计理由见 [`BreakGlass-ui-design-guide.md`](./BreakGlass-ui-design-guide.md)；待实现项见 [`BreakGlass-ui-todo.md`](./BreakGlass-ui-todo.md) |
| 产品约束 | [产品 Constitution 1.7.1](./BreakGlass-constitution.md)、[Spec Constitution 1.9.1 原则 VII/VIII](../.specify/memory/constitution.md)；两个工作台的视觉基线见 Visual Spec 1.5.0 |
| 标注 | §1–6、§8–11 保留曲线工作台及历史切片记录；005 视觉与来源见 §7.1，实施/真实模型验收以其任务和验证记录为准。本轮主题同步不代表浏览器验收通过；历史未通过项保留 |
| 本轮范围 | `extension/demo/index.html` 和 `extension/demo/geometry.html`；`site/` 介绍站与根目录样稿不改 |

## 1. 页面结构（UI 容器）

| 区域 | 选择器 / class | 现状 |
| --- | --- | --- |
| **液态玻璃顶栏** | `#demo-toolbar.lg-dock[data-liquid-glass]` | 支持悬停时默认收到视口外，可点击常驻「显示工具栏」、移到顶端 10px 或用键盘焦点打开；焦点在栏内时保持展开。无悬停设备放在正常文档流内并保持可见；窄屏控件可换行 |
| 工具栏入口 | `.dock-reveal[data-dock-reveal="demo-toolbar"]` | 常驻按钮，`aria-controls` 指向顶栏，`aria-expanded` 跟随展开状态；无悬停设备因顶栏始终可见而隐藏入口 |
| 顶栏按键 | `.lg-item`（8 个圆形玻璃按键） | 48px 圆形，`transform-origin: center bottom`，指针滑过逐个放大 |
| 工作台 | `.workspace` | 两栏网格：视频列 + 310px 控制面板；`<1050px` 变单列 |
| 视频舞台 | `#video-stage`（`.video-stage`） | `position: relative; overflow: hidden; min-height: 540px`（窄屏 420px），覆盖层的定位父级 |
| 抛物线覆盖层 | `.curve-overlay`（动态 SVG） | `position: absolute; z-index: 2`，`viewBox = 0 0 contentRect.width contentRect.height` |
| 传输条 | `.transport` | 目标时间输入 + 当前时间 + **等待条 `#waiting-bar`** + 开播前阅读一行 |
| 控制面板 | `.control-panel` | 状态文案、**三个参数行**、来源说明及“问一问”本地提问侧栏 |
| 底栏 | `.app-footer` | `Alt+B 破壁 · Esc 退出 · 空格保留给播放器` + `#runtime-note` |

## 2. 按钮与控件清单（主表）

| # | 控件 | id / 选择器 | 元素 | 默认态 | 可用条件 | 触发行为 | 反馈 | 快捷键 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 播放 / 暂停 | `#play-toggle`（`.lg-item`） | button | 可见可用 | 始终 | `video.play()` / `video.pause()` | `aria-label` 与 tooltip 在「播放/暂停」间切换；播放时撤下覆盖层 | — |
| 2 | 定位目标时间 | `#jump-target`（`.lg-item`） | button | 可见可用 | 始终（无元数据时提示） | `video.currentTime = 目标时间` 后 `pause()` | 无元数据时状态文案 `正式视频素材尚未提供，暂时无法定位。` | — |
| 3 | **破壁** | `#wake-button`（`.lg-item[data-variant=primary]`） | button | 可见，**禁用** | 暂停 **且** 目标时间 ±0.2s **且** 预制已加载 **且** 无覆盖层 **且** 非等待中 | 发起唤醒（`off` 立即出曲线；`hang`/`invalid`/`late` 进入等待） | 见第 3 节；成功时按钮从 primary 变 ghost | `Alt+B`（`aria-keyshortcuts`） |
| 4 | 取消等待 | `#cancel-button`（`.lg-item`） | button | **隐藏 + 禁用** | 仅 `waiting` | 取消本次等待 | 收起等待条；来源复位；`已取消等待，可以再次破壁。` | `Esc`（无覆盖层时） |
| 5 | 重试 | `#retry-button`（`.lg-item`） | button | **隐藏 + 禁用** | 仅 `recoverable-error` | 重新发起唤醒 | 变为 primary（破壁降为 ghost）；回到等待/交互 | — |
| 6 | 重置 | `#reset-button`（`.lg-item`） | button | 可见，**禁用** | 仅 `interactive` | `controller.reset()` + 重绘 | 三个滑块回到初值；`已恢复本次结果的初始参数。` | — |
| 7 | 全屏 | `#fullscreen-button`（`.lg-item`） | button | 可见可用 | 始终 | 对整页 `document.documentElement` 请求/退出全屏 | 全屏变化后重算覆盖层坐标。全屏期间 Esc 只退出全屏 | — |
| 8 | 退出 | `#exit-button`（`.lg-item`） | button | 可见，**禁用** | `interactive`、`waiting`、`recoverable-error` | 移除覆盖层 / 取消等待 / 结束会话 | 控件复位，主操作回到破壁 | `Esc`（有覆盖层时） |
| 9 | 开口宽窄 `a` | `#parameter-a` + `#parameter-a-value` | range + output | 禁用，值 `0.8`，输出 `—` | 仅 `interactive` | `input` → `session.setParameter('a', …)` + 重绘 | 按步长保留精度，与曲线同步 | ← / → 原生 |
| 10 | 水平位置 `h` | `#parameter-h` + `#parameter-h-value` | range + output | 禁用，值 `0`，输出 `—` | 仅 `interactive` | 同上（`setParameter('h', …)`） | 同上；也是**控制点拖动**写入的参数 | ← / → 原生 |
| 11 | 顶点高度 `k` | `#parameter-k` + `#parameter-k-value` | range + output | 禁用，值 `0`，输出 `—` | 仅 `interactive` | 同上（`setParameter('k', …)`） | 同上 | ← / → 原生 |
| 12 | 目标时间 | `#target-time` | number | `value=6`、`min=0`、`step=0.1` | 始终可编辑 | 破壁门禁与定位依据 | 不在目标时间时破壁禁用 | ↑ / ↓ 原生 |
| 13 | 控制点 | 覆盖层可见 `<circle r=10>`、透明 `<circle r=18>`，以及 `stroke-width=24` 的透明命中路径 | SVG | 随覆盖层出现 | 仅 `interactive` | `pointerdown/move/up` 拖动。覆盖层 `pointer-events: all`，点在层内不退出 | 写入 `dragParameter`（当前 `h`），钳制在范围内；`cursor: grab / grabbing` | 可聚焦 |
| 14 | 等待条 | `#waiting-bar` + `#waiting-progress` | div + span | **隐藏** | 仅 `waiting` | 无交互（提示 + 进度） | 1.5s 线性进度条，`--wait-ms` = `fallbackAfterMs` | — |
| 15 | 来源芯片 | `#source-label` | span | `等待素材` | 始终 | 无交互（状态） | 见第 3 节；超时回退加虚线；未知来源加警示色，识别样例用 accent 并说明样例身份 | — |
| 16 | 视频原生控件 | `<video controls>` | video | 始终 | 始终 | 浏览器自带播放条 | 空格保留给播放器（不作为破壁键）。点控制条不退出已出现的曲线 | — |
| 17 | 阅读状态 | `#lesson-status` | `p`，`role="status"` | 空 | 片子可播放且不是 9 秒片 | 无交互 | 正在读、读完了、还在读、没有下一处、已取消、暂无可用结果 | — |
| 18 | 阅读地址 | `#lesson-endpoint` | `url` 输入 | 空，占位「填上才开始看这支片子」。这次浏览里填过的值会补回输入框 | 始终可填 | 只用于当次请求和这次浏览的会话存储，不写入仓库 | 留空则不发请求，画面留在用户选的片子上，并写明还没开始看。之后填上地址会开始看 | — |
| 19 | 课程说明 | `#lesson-note` | textarea | 空 | 始终可填 | 随请求送出 | 空着会写「这次没有课程文本。」超过 8000 字不送正文 | — |
| 20 | 下一个 | `#lesson-next` | button | **禁用**，文案「下一个」 | 已停在一处，且有更晚的已存点 | 先卸下曲线，再定位到更晚的点 | 还在读时留在原地；读完且没有更晚处时禁用 | — |
| 21 | 取消阅读 | `#lesson-cancel` | button | **隐藏** | 仅正在读 | 停掉采样和请求 | 「已取消阅读。」已存的点留下，不退回 | — |
| 22 | 显示工具栏 | `.dock-reveal` | button | 悬停设备常驻可见 | 始终 | 展开顶栏并将焦点移到第一个可用按键 | `aria-expanded="true"`；离开且焦点不在栏内时收起 | Enter / 空格原生 |
| 23 | 选择预设 | `#preset-video`、`#toolbar-preset-video` | button | 可见 | 始终 | 明确加载包内 9 秒片，清空前一支视频的阅读点 | 来源保持「预先准备的示例」 | Enter / 空格原生 |
| 24 | 舞台状态提示 | `#stage-banner` | 状态区 | 无视频时隐藏 | 视频已加载 | 显示还没开始看、正在看、正在定位、可以破壁和破壁已打开 | 明确区分阅读与覆盖层 | — |
| 25 | 本地问句 | `#tutor-input` | text输入 | 禁用 | 先破壁，当前图形可交互且tutor可用 | 最长120字，提交时读取当前图形快照 | 浅色表面、44px最小高度；发送后清空问句 | 框内Esc仅清草稿 |
| 26 | 发送问句 | `#tutor-send`、`#tutor-form` | button / form | 禁用 | 与问句输入同时启用 | 浏览器内确定性求解，不发模型请求 | 回复追加到记录；不支持时保留图形 | Enter提交 |
| 27 | 问句示例 | `#tutor-examples`、`[data-tutor-example]` | button组 | 禁用 | 与问句输入同时启用 | 填入问句并聚焦输入，不自动发送 | 胶囊按钮、可换行；图形变化时更换示例 | Enter / 空格原生 |
| 28 | 提问记录 | `#tutor-log` | div | 隐藏 | 有问答条目后显示 | `role=log`、`aria-live=polite`、`tabindex=0` | 最大高220px、纵向滚动、最多20条；问与答各一条，用“你：/答：”区分 | 可聚焦滚动 |

## 3. 状态机与界面反馈（交互动画状态表）

| 状态 | 进入条件 | `#state-label` | `#source-label` | `#source-note` | 可用控件 | 覆盖层 | 适合的动画 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 初始（配置加载中） | 页面打开 | `先选择一个视频。文件留在这台浏览器里。` | `等待素材` | `数据来源将在交互出现后显示。` | 播放 / 定位 / 全屏 | 无 | 顶栏玻璃淡入 |
| 配置加载失败 | 预制读取失败 | `配置加载失败` + 原因 | `等待素材` | 同上 | 播放 / 定位 / 全屏 | 无 | 芯片变警示色 |
| 等待素材（无视频元数据） | 未加载视频 | `先选择一个视频。文件留在这台浏览器里。` | `等待素材` | 同上 | 舞台上的「选择视频」「选择预设」 | 无 | `#asset-empty` 居中。进入页面不自动挂 9 秒片 |
| 已暂停在目标时间 | 暂停且 ±0.2s 内且有预制 | `现在点破壁。` | `等待素材` 或上次来源 | 同上 | **破壁**启用，按钮旁保持「破壁」 | 无 | 破壁按钮带 `is-next` |
| 等待中 | `externalAttempt ≠ off` 且唤醒 | `正在等待外部结果…` | `等待素材` | `正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。` | 取消 / 退出 / 全屏 | 无 | 等待条 + 1.5s 进度；焦点移到取消 |
| 超时回退交互 | 1500ms 到点且预制匹配 | `已改用预先准备的示例。拖画面上的点，或拖右边的滑块。` | `预先准备的示例 · 超时回退` | `因等待超过 1.5 秒，改用预先准备的示例。` | 三个滑块 / 拖动 / 重置 / 退出 | **有** | 立即绘制首帧 + 200ms 光晕 |
| 交互（`off` 主路径） | 唤醒即匹配 | `拖画面上的点，或拖右边的滑块。按 Esc 退出。` | `预先准备的示例` | `这是扩展包内预先准备的示例，不代表实时识别成功。` | 同上 | **有** | 同上 |
| **交互（识别样例）** | `visionAdapter: fixture` + `externalAttempt: off` + 候选合法 | `交互已出现，可拖动控制点改变水平位置。` | **`识别结果`** | **`随演示打包的识别样例，尚未接通外部识别。`** | 同上 | **有** | 同交互；**不得**显示百分比 |
| 可恢复错误 | 无匹配预制 / 外部结果非法 / 识别候选被拒 | `当前帧没有可用的准备结果，无法进入交互。` 或 `外部结果不可用，未进入交互。` | `等待素材` | `没有可用的准备结果，或外部结果不可用；可以重试或退出。` | **重试（primary） / 退出 / 全屏** | 无 | 状态区 warn 竖条 160ms 上移淡入 |
| 取消后 | 等待中点取消 | `已取消等待，可以再次破壁。` | `等待素材` | `已取消等待，迟到结果不会再打开交互层。` | 破壁 | 无 | 等待条淡出 |
| 视频错误 | `video` error | `视频无法加载，未挂载交互层。` | `等待素材` | 同上 | 播放 / 定位 | 无 | 素材提示条 |
| 正在读 | 非 9 秒片时长可用 | `正在读，第一处读好后会停在那一帧。` | `等待素材` | 同上 | 取消阅读；破壁禁用 | 无 | 舞台时间不动 |
| 正在定位 | 阅读点还没停稳 | `正在定位，停稳后才能破壁。` | `等待素材` | 同上 | 破壁禁用 | 无 | 先卸下已有曲线 |
| 这次阅读 | 阅读点已落定并破壁 | `拖画面上的点，或拖右边的滑块。按 Esc 退出。` | **`这次阅读`** | **`这一帧在阅读时已经算好。`** | 滑块 / 拖动 / 重置 / 退出 / 下一个 | **有** | 不得出现「识别结果」 |
| 还在读 | 按下「下一个」时更晚的点还没到 | 原状态句，阅读状态含「还在读」 | 不变 | 不变 | 破壁保持当前可用性 | 不变 | 不改时间，不重新计算 |
| 没有下一处 | 阅读结束且没有更晚的点 | 原状态句，阅读状态含「没有下一处」 | 不变 | 不变 | 「下一个」禁用 | 不变 | 时间不动 |
| 阅读没有结果 | 地址留空、失败、断网，或 5 分钟内零通过 | `这支片子留在画面上。` | 不换成预设片，预设破壁不可用 | 预设曲线对不上这支片子 | 继续播放用户选的片子 | 无 | 失败片子的点清空。示例片只在点「选择预设」时出现 |

覆盖层生命周期：`interactive` 时挂载 → 播放、离开目标时间、点击舞台上视频以外的区域、退出、`Esc` 都会移除。点视频或原生控制条不退出。不会叠出第二层。

## 4. 参数调节清单

### 4.1 曲线参数（预制 JSON `definition.parameters`）

| 参数 | 初始值 | 最小 | 最大 | 步长 | 能否拖动 | 数学含义 | 当前 UI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a` | 0.8 | 0.4 | 1.2 | 0.1 | 否 | 开口宽窄/方向 | `#parameter-a` 滑块 + 数字 |
| `h` | 0 | -2 | 2 | 0.1 | **是**（`dragParameter: h`） | 顶点水平位置 | `#parameter-h` 滑块 + 数字 + 控制点拖动 |
| `k` | 0 | -2 | 2 | 0.1 | 否 | 顶点垂直位置 | `#parameter-k` 滑块 + 数字 |

- 公式注册：`fixture.parabola` 求值 `a(x-h)² + k`；`requiredParameters = ['a','h','k']`，缺任一个直接拒绝（`incomplete_parameters`）。
- **两条写入通道**：滑块走 `session.setParameter(name, value)`（可改任意已声明参数）；控制点拖动走 `session.updateParameter(name, value)`（只允许 `dragParameter`，其他参数返回 `parameter_not_draggable`）。
- 两条通道都会把值钳制在 `min`–`max`，非有限值返回 `invalid_parameter_value`。
- 每个参数都有 `min ≤ initial ≤ max` 且 `step > 0` 的硬约束。

### 4.2 几何与坐标参数（`definition`）

| 参数 | 当前值 | 说明 | 影响 UI 的点 |
| --- | --- | --- | --- |
| `domain` | `{ min: -4, max: 4 }` | 数学横坐标范围 | 曲线采样区间（81 点） |
| `range` | `{ min: -4, max: 4 }` | 数学纵坐标范围 | 超出的臂在边界断开，不沿窗口边连成直线或直角 |
| `yAxis` | `up` | 纵轴方向 | y 映射方向 |
| `region` | `{ x: 480, y: 220, width: 960, height: 620 }` | 曲线在**准备画幅**中的像素矩形 | 曲线出现的「原位」区域 |
| `frameSize` | `1920 × 1080` | 预制作者画幅 | **不等于当前视频尺寸时按比例换算**（`place-in-frame.js`），不是禁用破壁 |
| `time` | `6` 秒 | 预制时间（不是页面目标时间初值） | 页面目标时间初值恒为 6 秒，会话跟随输入框 |

### 4.3 运行配置参数（静态 JSON，非用户可调）

| 参数 | 当前值 | 取值 | 对界面的影响 |
| --- | --- | --- | --- |
| `enableLocalMock` | `true` | true / false | false 时预制不可用 → 可恢复错误 |
| `fallbackAfterMs` | `1500` | 固定 1500 | 等待条与看门狗时长；不得加长 |
| `presetKey` | `demo-parabola` | 文件名 | 决定加载哪份预制 |
| `prewarmed` | `true` | true / false | false 时视为无缓存 → 可恢复错误 |
| `externalAttempt` | `off` | `off` / `hang` / `invalid` / `late` | `off` 立即出曲线；`hang` 1.5s 后回退；`invalid` 可恢复错误；`late` 先回退再丢弃迟到结果 |
| `visionAdapter` | `off`（提交值，已落地） | `off` / `fixture`；缺省或其他值都视为 `off` | `fixture` 且 `externalAttempt: off` 时用打包识别样例进入交互；**不加设置面板** |

### 4.4 其他可调项

| 项 | 位置 | 当前值 | 备注 |
| --- | --- | --- | --- |
| 目标时间 | `#target-time` | `6`（初值由 `PACKAGED_DEMO_TARGET_SECONDS` 给定） | `min=0`、`step=0.1`；容差 ±0.2 秒 |
| 播放进度 | 视频原生控件 | — | 空格不作为破壁键 |
| 拖动控制点 | 覆盖层 `circle` | — | 映射到数学坐标后写入 `h` |

## 5. 识别结果适配（002，已实现）

> 来源：`specs/002-vision-result-adapter/`（spec / plan / research / data-model / contracts / quickstart / ownership / tasks）。**T001–T018 已实现；T017 的 quickstart 手工验收未执行。**

### 5.1 开关参数

| 参数 | 取值 | 规则 |
| --- | --- | --- |
| `visionAdapter` | `off` / `fixture` | 随扩展提交的值必须是 `off`；缺省、空串或其他值都视为 `off`，**不得**当成 `fixture` |
| `externalAttempt` | 必须仍是 `off` | 不是 `off` 时忽略识别样例，继续现有等待/非法/迟到演练 |
| `fallbackAfterMs` | 必须仍是 `1500` | 不得为识别路径加长 |

**界面结论：不新增按钮，不新增设置面板。** 开关只在 `extension/assets/config.json` 里改，演练后必须改回 `off`。

### 5.2 识别候选字段（VisionCandidate）

| 字段 | 规则 | 界面影响 |
| --- | --- | --- |
| `source` | 必须是 `vision` | 决定来源芯片显示「识别结果」 |
| `fallback` | 必须是 `null` | 不出现「超时回退」 |
| `evidence` | 必须是 `packaged-sample`，缺省或其他值拒绝 | 保证界面不会把样例说成外部服务已接通 |
| `confidence` | 可缺省。存在时必须是有限数且 `0 ≤ confidence ≤ 1`；`< 0.5` 拒绝 | **无论缺省还是 ≥ 0.5 都不显示百分比**；不得编造准确率 |
| `requestId` / `videoId` / `time` / `frameSize` | 必须与本次冻结上下文一致（`time` 容差 ±0.2 秒） | 不匹配即拒绝，不绘制 |
| `definition` | 与 001 相同（`min ≤ initial ≤ max`、`step > 0`、`region` 落在 `frameSize` 内） | 参数控件范围随之变化 |

### 5.3 来源文案与芯片状态

| 条件 | `#source-label` | `#source-note` |
| --- | --- | --- |
| `source: vision` + `evidence: packaged-sample` + `fallback: null` | **`识别结果`** | **`随演示打包的识别样例，尚未接通外部识别。`** |
| `source: preset` + `fallback: null` | `预先准备的示例` | `这是扩展包内预先准备的示例，不代表实时识别成功。` |
| `source: preset` + `fallback: timeout` | `预先准备的示例 · 超时回退` | `因等待超过 1.5 秒，改用预先准备的示例。` |
| 识别候选被拒绝 | 保持失败前的来源 | 使用 `message`：`外部结果不可用，未进入交互。` |

禁止出现「已接通」「识别成功」或任何外部服务名称。

### 5.4 计时参数

| 名称 | 内容 | 约束 |
| --- | --- | --- |
| `vision-decision` | 识别路径从判定开始到 `interactive` 或 `recoverable-error` 的毫秒数，外加 `hot` / `cold`；由 `main.js` 的 `recordVisionDecision()` 在 `wake()` 记起点、在 `applyState()` 结算 | 不得写入 `fallback-visible`；样本只含名称、毫秒数、缓存状态 |
| `fallback-visible` | 仅判定超时 → 首个可见 SVG | 识别路径不得写入 |
| 禁用名称 | `extension-open`、`video-first-frame`、`network-wait`、`p1-init` | `latency.js` 会直接拒收 |

### 5.5 实现记录：原先的冲突点如何处理

| 冲突点 | 处理 |
| --- | --- |
| 芯片警示色误判 | 已改成显式分支：`is-warn = Boolean(result) && !preset && !vision`；识别结果走 accent 态，不再按「非预制即警示」判断 |
| `evidence` 到不了页面 | `session.copyResult` 已按 `source === 'vision'` 抄写 `evidence`（有 `confidence` 时一并抄，页面不显示） |
| 失败文案唯一 | 识别被拒统一 `external_unavailable` + 「外部结果不可用，未进入交互。」，未新增错误码，也不回落预制 |
| 样例画幅 | `wake.js` 先按**样例自身画幅**用同一个校验器校验一次（否则越界 `region` 会被按帧换算钳制成合法），再按当前帧装订后复核上下文；预制路径的 `place-in-frame.js` 行为未改 |
| 宪法门禁 | `.specify/memory/constitution.md` 已修订为 **1.4.0**：默认关闭时 `interactive` 的 `result.source` 仍只能是 `preset`；`fixture` + `off` 时才允许 `source: vision` + `fallback: null` + `evidence: packaged-sample` |
| 接口统一 | `createWake` 签名、五个方法、7 个状态字段全部未变；`allowVision` 只由识别路径显式传入 |

### 5.6 实现状态与未执行项

| 项 | 状态 |
| --- | --- |
| 结果规则侧（校验、开关、样例、唤醒、会话副本） | 已实现：`extension/src/curve/validate.js`、`src/preset/load.js`、`src/session/wake.js`、`src/session/session.js`、`assets/config.json`、`assets/vision/` |
| 页面侧（来源文案、识别计时） | 已实现：`extension/src/page/main.js` 的 `isPackagedVision` / `setSource` / `recordVisionDecision` |
| 自动基线 | `node --test` **182 项通过 / 0 失败**；`node --check` 39 个文件通过 |
| 新增测试 | `tests/vision-validate.test.js`、`vision-config`、`vision-wake`、`vision-reject`、`vision-latency`、`page-vision` |
| 提交配置 | `visionAdapter: "off"`、`externalAttempt: "off"`、`fallbackAfterMs: 1500`（由 `tests/vision-config.test.js` 断言） |
| **手工验收（quickstart §1–5、SC-002）** | **未执行**：当前环境没有可控浏览器会话，不得记为通过 |
| 包内样例画幅 | 样例按 1920×1080 画布编写；识别路径**不做**画幅换算，演练前必须把 `extension/assets/vision/fixture-parabola.json` 的 `frameSize` 与 `region` 改成实际片子尺寸（README 给了 3024×1898 的换算示例） |
| 外部演练路径的错误码 | 仍会把校验器 code（如 `frame_mismatch`）透传给会话，与宪法表的三种 code 不一致；本切片只让**识别路径**收敛到 `external_unavailable` |

## 6. 手势与动画线索

| 项 | 值 |
| --- | --- |
| **顶栏放大** | 余弦钟形权重 `w(d) = 0.5(1+cos(π·min(1,|d|/R)))`；`R=132px`、`maxScale=1.55`、`lift=10px`、刚度 `20/s`、收敛阈值 `0.0015`；只写 `transform` |
| 覆盖层指针事件 | `pointerdown` / `pointermove` / `pointerup`，`setPointerCapture`，拖动中每次 move 重绘 |
| 曲线绘制 | 81 个采样点（1 `M` + 80 `L`），坐标 2 位小数 |
| 曲线样式 | 深屏 `stroke: var(--screen-accent)`（`#71ddff`）、`stroke-width: 3`、`stroke-linecap: round`、`fill: none` |
| 曲线入场 | 先绘制最终几何（首帧 ≤ 100ms），再加 `is-entering` 200ms 光晕 |
| 控制点样式 | `<circle r=10 fill=#08111f stroke=#ffffff stroke-width=3 tabindex=0>` |
| 等待时长 | 1500ms 看门狗 + 同步线性进度条 |
| 回退性能口径 | 判定超时 → 首个可见 SVG 帧 ≤ 100ms（SC-003） |
| 重算触发 | `resize`、`fullscreenchange`、`orientationchange`、DPR 变化、`ResizeObserver(video)`、`loadedmetadata` |
| 失效清理 | 播放 / 离开目标时间 → 覆盖层与定时器一起清理；`pagehide` 释放监听并卸下顶栏 |
| 拖拽/滑块钳制 | 写入前钳制在 `min`–`max` |

## 7. 共享视觉令牌（`extension/src/ui/theme.css`；完整定义见 [BreakGlass-visual-spec.md](./BreakGlass-visual-spec.md) 1.5.0 §2）

两个工作台先加载共享主题，再加载各自的 `demo.css` / `geometry.css`。共享文件维护基础视觉；页面文件保留布局、工具栏与场景图形差异。下面记录本轮确认的统一基线，测试与浏览器验收另记，不把历史自动检查作为本轮通过证据。

| 令牌 / 样式 | 值 |
| --- | --- |
| 页面 / 冰面 | `#F7FAFC` / `#EEF4F8` / `#C8DCE6` |
| `--panel` | `linear-gradient(150deg, rgba(255,255,255,.94), rgba(200,220,230,.82))`；冰面阴影和内高光 |
| `--line` | `rgba(90,116,138,.3)` |
| `--ink` / `--muted` / `--accent` | `#14232F` / `#4E6474` / `#0B6F91` |
| 主按钮 | 深青蓝渐变 `#0B6F91 → #1755BD`，白字 |
| `--warn` | `#8A5A00`；配文字原因 |
| 深屏 | 底色 `#0E1720`；`--screen-ink #eef5ff` / `--screen-muted #9fb4cc` / `--screen-accent #71ddff` |
| 玻璃 | 浅色 `--glass-tint-top/mid/low`、白色 `--glass-edge/edge-soft`、冰面 `--glass-shadow`；blur 18px/6px 保留 |
| 字体 / 标题 | 共享 Inter/system sans；正文16px，控件14px；H1 `clamp(32px,4vw,58px)` / 1.12，H2 24px；数值 tabular-nums |
| 动效 | `--motion-fast 80ms`、`--motion-base 120ms`、`--motion-state 160ms`、`--motion-enter 200ms`、`--ease-out cubic-bezier(.2,.8,.2,1)` |
| 圆角 | 按钮/表单9px、卡片14px、舞台13px、面板20px、来源胶囊999px |
| 控件尺寸 | 普通按钮、input（含 URL）、select、textarea 最小高44px；dock桌面48px、1050px及以下44px |
| 焦点 | 所有按钮、链接、表单及可聚焦控件共享2px描边、offset3px；深屏控制点用深屏强调描边 |
| 禁用态 | `opacity: .45` + `cursor: not-allowed` + 原因；既有业务禁用条件不变 |
| 布局 | 桌面左右32px/移动16px；各页任务布局及响应式结构保留，dock按键桌面48px/窄屏44px |
| 状态区 | `#state-label` 最小高度 48px |

### 7.1 005 当前帧几何工作台

| 区域或状态 | 视觉与边界 |
| --- | --- |
| 主题与布局 | 外围 `.panel`、按钮、表单、标题和 `.source-chip` 复用共享冰面；原帧和数学画板使用深屏；原帧/画板及学习区布局保持独立，不套用曲线面板310px宽 |
| 识别候选 | 保留“真实识别候选 · 待校对”，`sceneRevision: 0` 不能实验或问答；结构通过不是题意正确 |
| 预设 / 手工 | 分别保留“预设演示”“手工条件”与待校对/已确认状态；这两条路径未调用模型，不写识别成功 |
| 用户校正 / 修改 | `source: manual`、`originSource` 保留首次来源、`editedByUser: true`；显示原始来源及“已校对 / 已修改” |
| 确认 / 恢复 | “已确认”表示用户核对，不表示模型验收；恢复首次确认快照，不能恢复未经核对的模型候选 |
| 失败 / 等待 | 明确说明原因并保留视频、校对、重试或退出；不支持、超时、模型未配置、迟到结果不能显示成功，不静默改成预设；不继承001/003的1.5秒保底 |
| 验证状态 | [005 tasks](../specs/005-insitu-right-triangle/tasks.md) 与 [几何验证记录](./BreakGlass-geometry-validation.md) 是实施/验收依据；真实模型未配置项保留，主题同步不自动通过浏览器验收 |

### 7.2 曲线工作台本地提问侧栏

沿用主分支 `426c41a`（PR #54）的业务实现，本轮只使 `.tutor__log` 和 `.tutor__form input` 服从共享冰面主题；解析、计算、写入逻辑保持上游行为。侧栏位于控制面板内，记录区与输入使用浅色表面及深色文字，不套用视频深屏配色。业务契约见 [004 一次提问](../specs/004-figures-and-tutor/contracts/tutor-turn.md)。

先破壁后可问；示例只填写，不自动发出；输入框Esc只清草稿。记录限高220px、最多20条（问/答各一条），纯文本呈现并保留“你：”“答：”及可聚焦log语义。新破壁会话或图形切换清空记录、更换示例。求解来自当前图形快照，不发送模型请求，不作为005真实模型验收证据。

## 8. 文案总表

| 位置 | 状态 | 文案 |
| --- | --- | --- |
| `#tutor-hint` | 未破壁 / 不可用 | `先破壁，再问这条曲线。` |
| `#tutor-hint` | 可提问 | `用平常的话问：改一个系数，或问某个 x 上的 y。回答里的数就是画面上的数。` |
| `.tutor__who` | 用户 / 回复 | `你：` / `答：` |
| `#source-label` | 无结果 | `等待素材` |
| `#source-label` | preset | `预先准备的示例` |
| `#source-label` | 超时回退 | `预先准备的示例 · 超时回退` |
| `#source-label` | 未知来源（非 preset、非已校验 vision） | `来源不可用` |
| `#source-label` | 识别样例（`source: vision` + `evidence: packaged-sample`） | `识别结果` |
| `#source-label` | 开播前阅读的点 | `这次阅读` |
| `#source-note` | 无结果 | `数据来源将在交互出现后显示。` |
| `#source-note` | preset | `这是扩展包内预先准备的示例，不代表实时识别成功。` |
| `#source-note` | 超时回退 | `因等待超过 1.5 秒，改用预先准备的示例。` |
| `#source-note` | 识别样例 | `随演示打包的识别样例，尚未接通外部识别。` |
| `#source-note` | 开播前阅读的点 | `这一帧在阅读时已经算好。` |
| `#source-note` | 等待中 | `正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。` |
| `#source-note` | 失败 | `没有可用的准备结果，或外部结果不可用；可以重试或退出。` |
| `#source-note` | 取消 | `已取消等待，迟到结果不会再打开交互层。` |
| `#state-label` | 等待 | `正在等待外部结果…` |
| `#state-label` | 回退成功 | `已改用预先准备的示例（超时回退），可拖动控制点。` |
| `#state-label` | 交互 | `拖画面上的点，或拖右边的滑块。按 Esc 退出。` |
| `#state-label` | 无预制 | `当前帧没有可用的准备结果，无法进入交互。` |
| `#state-label` | 外部非法 / 识别被拒 | `外部结果不可用，未进入交互。` |
| `#state-label` | 还没有画面 | `先选择一个视频。文件留在这台浏览器里。` |
| `#state-label` | 还没停在示例秒数 | `点定位，停在第 N 秒。` |
| `#state-label` | 可以破壁 | `现在点破壁。` |
| `#state-label` | 门禁不满足（还没有画面尺寸） | `请先暂停在目标时间。` |
| `#state-label` | 视频标识对不上 | `这段视频和准备结果不是同一份。` |
| `#state-label` | 视频错误 | `视频无法加载，未挂载交互层。` |
| `#waiting-bar` | 等待中 | `正在等待外部结果…` |
| `#runtime-note` | 就绪，默认隐藏 | `配置：off · 本地预制已预热 · 回退 1500ms` |
| `#asset-empty` | 没有视频 | 舞台上的「选择视频」和「选择预设」。自己的文件留在这台浏览器里；预设是包内 9 秒片，要点了才加载 |
| `#stage-banner` | 有片子之后 | 盖在画面左上角，分开写「AI 正在看这段画面」「还没开始看」「可以破壁」「正在破壁」「破壁已打开」。有片子时顶栏保持展开 |
| `#target-time-readout` | 曲线出现前 | `停在第 6 秒` |
| `#target-time-field` | 曲线出现后 | 才显示可编辑的目标时间 |
| `#local-video` | 选择本地视频 | 文件只留在浏览器里，换成 `blob:` 地址；不发送到服务器 |
| `#lesson-status` | 正在读 | `正在读这段视频。` 或 `正在读，已存好 N 处。` |
| `#lesson-status` | 课程说明为空 | `这次没有课程文本。` |
| `#lesson-status` | 课程说明超过 8000 字 | `请把课程说明缩短到 8000 字以内。` |
| `#lesson-status` | 读完 | `读完了，共 N 处。` |
| `#lesson-status` | 下一处未就绪 | `下一处还在读。` |
| `#lesson-status` | 没有更晚的点 | `没有下一处。` |
| `#lesson-status` | 取消 | `已取消阅读。` |
| `#lesson-status` | 阅读没有结果 | `这支片子留在画面上。` 超时前缀是「这次没读完。」其他失败前缀是「外部阅读没有返回可用结果。」 |
| `#lesson-status` | 退回的片子也没加载出来 | `预先准备的片子没有加载出来。` |
| 覆盖层 | aria-label | `可拖动的抛物线结果`（002 起改为中性表述） |
| 顶栏 tooltip | 各按键 | `播放` / `定位目标时间` / `破壁 Alt+B` / `取消等待` / `重试` / `重置` / `全屏` / `退出 Esc` |

## 9. 只读调试输出

| 全局对象 | 内容 |
| --- | --- |
| `window.__breakglassAlignment` | `{ contentRect, scale, samples, maxRatio, tolerance, withinTolerance, measured, at }`。页面读数 `measured` 为 `false`，`maxRatio` 与 `withinTolerance` 为 `null`，不是相对画面的 2% 结论。`pagehide` 或退出后为 `null` |
| `window.__breakglassLatency.summary()` | `*-dom-ready` 表示 SVG 路径在 JavaScript 中准备完成；`*-frame-ready` 表示第二次 `requestAnimationFrame`，期间有一次绘制机会。分别记录 `fallback`、`lesson-wake`、`preset-wake`，另有 `vision-decision`、`lesson-first-point`；返回 `count / p50 / p95 / max`，不能将 DOM 准备时间记作首个可见像素时间 |
| `window.__breakglassLatency.measurement()` | 区分 DOM 准备与双 rAF 的绘制机会；`pixelPresentationVerified: false`。双 rAF 不保证 GPU 已提交或显示器已呈现，真实像素验收仍需浏览器与设备证据 |
| `window.__breakglassLesson` | `binding`、`points`、`dropped`、`jumps`、`acceptance`。`acceptance()` 使用 `lesson-wake-frame-ready` 样本，并注明像素呈现需要浏览器证据；样本不足 20 次或对齐未实测时 `passed: false`。该字段不能单独证明真实像素呈现验收已通过 |
| `window.__breakglassWakeMounts` | `createWake` 的次数。尺寸不符的点不得让它增加 |
| `window.__breakglassLatency.snapshot()` | 原始毫秒数组 |
| `window.BreakGlassUI.magnify` / `LiquidGlassDock` | 顶栏放大内核与控制器（`extension/src/ui/`） |

## 10. 设计时需要注意的点

1. **状态区高度固定**：`#state-label` 最小高度 48px，新设计请保留。
2. **焦点与播报**：进入等待焦点移到取消，进入可恢复错误焦点移到重试；`role=status` 默认 `aria-live="polite"`，**错误态由 `setStatus(…, 'error')` 切到 `assertive`**（已实现）。
3. **覆盖层定位**：靠内联 `position: absolute` + `z-index: 2`（`.video-stage` 是 `display: grid`）。若改用 CSS 类，必须在 CSS 里补 `position: absolute`。
4. **等待条已实现**：spinner + 与 `fallbackAfterMs` 绑定的线性进度；`prefers-reduced-motion` 下退化为静态。
5. **回退动画预算**：判定超时到首个可见 SVG 帧只有 100ms，入场动画不得推迟首帧。
6. **禁用态原因**（已实现）：`#wake-button` / `#reset-button` 通过 `aria-describedby` 关联视觉隐藏的 `#wake-reason` / `#reset-reason`；按钮可用时原因清空。
7. **识别结果必须与预制可区分**（已实现）：「识别结果」是 accent 态而不是警示态，且不显示可信程度百分比。
8. **空格不作为破壁键**，`Alt+B` 与 `Esc` 在底栏标注。

## 11. 未实现 / 不在范围

| 项 | 状态 |
| --- | --- |
| 识别结果适配（002） | 已实现（T001–T018）；**T017 手工验收未执行** |
| 早期002范围之外的真实识别请求、单帧上传、感知代理、Pyodide | 原002记录为“不派发”；当前003/005已有独立本地reader与接口例外，真实模型效果仍须单独验收；Pyodide不由本轮视觉工作派发 |
| 顶点拖动同时改 `h` 与 `k` | 待决策（analysis §8.2） |
| 性能读数展示、空素材与视频错误的区分、目标时间对齐提示 | 待实现（见 [`BreakGlass-ui-todo.md`](./BreakGlass-ui-todo.md)） |
| 四画幅真机验收（T030/T038） | 未执行；仓库已附带 9 秒示例视频，附带素材不代表对齐验收已通过 |
| 开播前阅读的页面接线（003） | 已实现：有地址时自动开始、还在读、没有下一处、这次阅读、失败保留用户视频、显式选择预设。阅读服务源码位于 `breakglass-reader/`，按 Spec Constitution 1.9.1 原则VII的独立例外不打进扩展包、不部署为云端后台；模型调用需服务配置，真实识别仍待联调 |
| 003 的 SC-003、SC-004、SC-005 | **未通过**。没有设备上至少 20 次破壁样本，`measured` 仍是 `false`，`maxRatio` 仍是 `null` |

## 12. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 2.6.0 | 2026-10-03 | 同步 Visual Spec 1.5.0：index/geometry共享 `theme.css` 浅色冰面、深屏令牌、控件/面板/焦点规格；补005候选与来源规则，纠正旧暗色数值及“非preset即警示”的摘要。同轮沿用主分支426c41a本地提问，补控件、记录区和操作说明；dock统一桌面48px/窄屏44px。介绍站和根样稿不在范围；保留历史检查、未验收及真实模型未配置事实 |
| 2.5.0 | 2026-10-03 | 合入 `main@632969a`：显式选择预设、阅读失败保留用户视频、舞台状态提示和阅读地址记忆；保留工具栏入口并同步 Constitution 1.8.0 与参数精度说明 |
| 2.4.0 | 2026-10-03 | 增加常驻工具栏入口、无悬停设备与窄屏可达性说明；同步阅读服务已在仓库及既有例外边界；区分 DOM 准备与双 rAF 绘制机会，明确真实像素呈现和四画幅对齐仍需独立验收 |
| 2.3.0 | 2026-10-03 | 补上开播前阅读一行：自动开始、还在读、没有下一处、这次阅读、退回预先准备的片子。写明 SC-003 至 SC-005 未通过，阅读服务不在本仓库。点原生控制条不退出曲线；配置失败不再挂上包内片子；页面隐藏时卸下顶栏 |
| 2.2.0 | 2026-10-02 | 可访问性补齐：错误态 `aria-live` 切 `assertive`；破壁/重置的禁用原因走 `aria-describedby` + `sr-only` 节点；三个滑块补 `aria-valuetext`（取值 + 范围）；控制点加透明 `r=18` 热区与 `grab/grabbing` 光标；顺带修掉「等待与可恢复错误时退出按钮仍禁用」的真实缺陷（替身此前未模拟 HTML 初始 `disabled`，属假通过） |
| 2.1.0 | 2026-10-02 | 对齐 `前端计划02@4239d35`：识别结果适配（002）已实现——`visionAdapter` 开关落地并保持 `off`、来源芯片新增「识别结果」为 accent 态、说明区新增「尚未接通外部识别」、识别路径单独记 `vision-decision`、覆盖层 aria-label 改为中性表述；§5 由「规划」改为「已实现」并补实现记录、实现状态与未执行项 |
| 2.0.0 | 2026-10-02 | 同步到 `main@0c1cafb`：顶栏改为 8 个圆形玻璃按键 + 来源芯片、三个参数滑块（新增 `setParameter` 通道）、等待条、全屏按钮、目标时间初值 6 秒、预制画幅按比例换算；新增 §5「P1 规划：识别结果适配」的新增参数、来源文案、计时名、冲突点与门禁；文案表、令牌表与调试输出同步 |
| 1.0.0 | 2026-10-02 | 首次汇总按钮、控件、状态、文案与参数清单 |
