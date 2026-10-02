# BreakGlass 功能与参数清单（面向按钮 UI 与交互动画设计）

> 本分支：`ui`。文档基于 `p2@77423ab` 的界面元素逐项核对；`ui` 分支的控件 id、状态名与设计令牌一致，但 `extension/src/page/main.js` 的接线实现与 `p2` 不同。

> 读取范围：`p2` 分支（提交 `f3f0c92` + 退出按钮修正），即当前最新的扩展实现。
> 依据文件：`extension/demo/index.html`、`extension/demo/demo.css`、`extension/src/page/main.js`、`extension/src/session/{session,wake}.js`、`extension/src/attempt/simulator.js`、`extension/src/telemetry/latency.js`、`extension/src/curve/{validate,evaluate}.js`、`extension/src/geometry/{content-rect,alignment}.js`、`extension/src/preset/load.js`、`extension/assets/{config.json,presets/demo-parabola.json}`、`extension/manifest.json`、`specs/001-insitu-parabola/{data-model.md,contracts/*}`。

## 1. 页面结构（UI 容器）

| 区域 | 选择器 / class | 现状 |
| --- | --- | --- |
| 顶栏 | `.app-header` | 标题 + 来源芯片 `#source-label` |
| 工作台 | `.workspace` | 两栏网格：视频列 + 310px 控制面板；`<1050px` 变单列 |
| 视频舞台 | `#video-stage`（`.video-stage`） | `position: relative; overflow: hidden; min-height: 540px`（窄屏 420px），覆盖层的定位父级 |
| 抛物线覆盖层 | `.curve-overlay`（动态 SVG） | `position: absolute; z-index: 2`，`viewBox = 0 0 contentRect.width contentRect.height` |
| 传输条 | `.transport` | 播放 / 定位 / 目标时间 / 当前时间 |
| 控制面板 | `.control-panel` | 状态文案、破壁、参数行、操作按钮、来源说明 |
| 底栏 | `.app-footer` | 快捷键说明 + 运行配置 `#runtime-note` |

## 2. 按钮与控件清单（主表）

| # | 控件 | id | 元素 | 默认态 | 可用条件 | 触发行为 | 触发后反馈 | 快捷键 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 播放 / 暂停 | `#play-toggle` | button | 可见可用，文本 `播放` | 始终 | `video.play()` / `video.pause()` | 文本切换为 `暂停`/`播放`；播放时若在目标帧外会撤下覆盖层 | — |
| 2 | 定位目标时间 | `#jump-target` | button | 可见可用 | 始终（无视频元数据时给出提示） | `video.currentTime = 目标时间`，随后 `pause()` | 无元数据时状态文案 `正式视频素材尚未提供，暂时无法定位。` | — |
| 3 | **破壁** | `#wake-button`（`.primary`） | button | 可见，**禁用** | 暂停 **且** 处于目标时间 ±0.2s **且** 预制已加载 **且** 无覆盖层 **且** 非等待中 | 开始一次唤醒（off 立即出曲线；hang/invalid/late 进入等待） | 见第 3 节状态表 | `Alt+B` |
| 4 | 取消等待 | `#cancel-button` | button | **隐藏 + 禁用** | 仅 `waiting` 状态显示并可用 | 取消本次等待 | 回到暂停；来源芯片复位；文案 `已取消等待，可以再次破壁。` | `Esc`（无覆盖层时） |
| 5 | 重试 | `#retry-button` | button | **隐藏 + 禁用** | 仅 `recoverable-error` 显示并可用 | 重新发起唤醒 | 回到等待态 | — |
| 6 | 重置 | `#reset-button` | button | 可见，**禁用** | 仅 `interactive` | `controller.reset()` + 重绘 | 曲线回到初始参数；文案 `已恢复本次结果的初始参数。` | — |
| 7 | 退出 | `#exit-button` | button | 可见，**禁用** | `interactive`、`waiting`、`recoverable-error` | 移除覆盖层 / 取消等待 / 结束会话 | 控件复位，文案回到 `已暂停在目标时间，可以再次破壁。` | `Esc`（有覆盖层时） |
| 8 | 水平位置 h | `#parameter-h` + 输出 `#parameter-h-value` | range + output | 禁用，值 `0`，输出 `—` | 仅 `interactive` | `input` → 更新拖动参数并实时重绘 | 滑块与数字（保留 1 位小数）和曲线同步 | ← / → 原生 |
| 9 | 目标时间 | `#target-time` | number | `value=12.5`、`min=0`、`step=0.1` | 始终可编辑 | 只作为破壁门禁与定位使用 | 不在目标时间时破壁按钮禁用 | ↑ / ↓ 原生 |
| 10 | 控制点 | 覆盖层内 `<circle r=10 tabindex=0>` | SVG circle | 随覆盖层出现 | 仅 `interactive` | `pointerdown/move/up` 拖动 | 实时改变拖动参数（钳制在范围内） | 可聚焦（tabindex=0） |
| 11 | 视频原生控件 | `<video controls>` | video | 始终 | 始终 | 浏览器自带播放条 | — | 空格保留给播放器（不作为破壁键） |

## 3. 状态机与界面反馈（交互动画状态表）

| 状态 | 进入条件 | `#state-label` | `#source-label` | `#source-note` | 可用控件 | 覆盖层 | 适合的动画 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 初始（配置加载中） | 页面打开 | `请加载演示视频并暂停在目标时间。` → 加载后 `正式视频素材尚未提供，加载视频后可验证交互。` | `等待素材` | `数据来源将在交互出现后显示。` | 播放 / 定位 / 目标时间 | 无 | 骨架淡入 |
| 配置加载失败 | 预制读取失败 | `配置加载失败` 原因文案 | `等待素材` | 同上 | 播放 / 定位 | 无 | 顶栏芯片变警示色 |
| 等待素材（无视频元数据） | 未加载视频 | `请暂停在目标时间。` | `等待素材` | 同上 | 播放 / 定位 | 无 | `#asset-empty` 提示条淡入 |
| 已暂停在目标时间 | 暂停且 ±0.2s 内且有预制 | `已暂停在目标时间，可以再次破壁。` | `等待素材` 或上次来源 | 同上 | **破壁**启用 | 无 | 破壁按钮呼吸/高亮 |
| 等待中（P2） | `externalAttempt ≠ off` 且唤醒 | `正在等待外部结果…` | 保持 `等待素材` | `正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。` | 取消 / 退出 | 无 | 加载指示；取消按钮淡入；焦点移到取消 |
| 超时回退交互（P2） | 1500ms 到点且预制匹配 | `已改用预先准备的示例（超时回退），可拖动控制点。` | `预先准备的示例 · 超时回退` | `因等待超过 1.5 秒，改用预先准备的示例。` | 拖动 / 重置 / 退出 | **有** | 曲线描边生长（≤100ms 内首帧） |
| 交互（off 主路径） | 唤醒即匹配 | `交互已出现，可拖动控制点改变水平位置。` | `预先准备的示例` | `这是扩展包内预先准备的示例，不代表实时识别成功。` | 拖动 / 重置 / 退出 | **有** | 同上 |
| 可恢复错误（P2） | 无匹配预制 / 外部结果非法 | `当前帧没有可用的准备结果，无法进入交互。` 或 `外部结果不可用，未进入交互。` | `等待素材` | `没有可用的准备结果，或外部结果不可用；可以重试或退出。` | **重试 / 退出** | 无 | 状态区抖动或警示色 |
| 取消后 | 等待中点取消 | `已取消等待，可以再次破壁。` | `等待素材` | `已取消等待，迟到结果不会再打开交互层。` | 破壁 | 无 | 等待指示淡出 |
| 视频错误 | `video` error | `视频无法加载，未挂载交互层。` | `等待素材` | 同上 | 播放 / 定位 | 无 | 素材提示条 |

覆盖层生命周期：`interactive` 时挂载 → 播放、离开目标时间、点击覆盖层外部、退出、ESC 都会移除，且不会叠出第二层。

## 4. 参数调节清单

### 4.1 曲线参数（来自预制 JSON：`definition.parameters`）

| 参数 | 初始值 | 最小 | 最大 | 步长 | 能否拖动 | 数学含义 | 当前 UI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a` | 0.8 | 0.4 | 1.2 | 0.1 | 否（现在） | 开口宽窄/方向 | 未暴露（可扩展第二个滑块） |
| `h` | 0 | -2 | 2 | 0.1 | **是**（`dragParameter: h`） | 顶点水平位置 | `#parameter-h` 滑块 + 数字 + 控制点拖动 |
| `k` | 0 | -2 | 2 | 0.1 | 否（现在） | 顶点垂直位置 | 未暴露 |

- 公式注册：`fixture.parabola` 求值 `a(x-h)² + k`；`requiredParameters = ['a','h','k']`，缺任一个校验直接拒绝（`incomplete_parameters`）。
- 参数钳制发生在会话层：超范围写回 `min`/`max`；非有限值返回 `invalid_parameter_value`。
- 每个参数都有 `min ≤ initial ≤ max` 且 `step > 0` 的硬约束。

### 4.2 几何与坐标参数（`definition`）

| 参数 | 当前值 | 说明 | 影响 UI 的点 |
| --- | --- | --- | --- |
| `domain` | `{ min: -4, max: 4 }` | 数学横坐标范围 | 决定曲线采样区间（81 点） |
| `range` | `{ min: -4, max: 4 }` | 数学纵坐标范围 | 超出范围的曲线由 SVG 视口裁掉 |
| `yAxis` | `up` | 纵轴方向 | 决定 y 映射方向 |
| `region` | `{ x: 480, y: 220, width: 960, height: 620 }` | 曲线在源帧像素中的矩形 | 曲线出现的“原位”区域 |
| `frameSize` | `1920 × 1080` | 源帧尺寸 | 与视频实际尺寸不一致时禁用破壁 |
| `time` | `12.5` 秒 | 目标时间 | 门禁容差 ±0.2 秒 |

### 4.3 运行配置参数（静态 JSON，非用户可调；`externalAttempt` 用于演练）

| 参数 | 当前值 | 取值 | 对界面的影响 |
| --- | --- | --- | --- |
| `enableLocalMock` | `true` | true / false | false 时预制不可用 → 可恢复错误 |
| `fallbackAfterMs` | `1500` | 固定 1500 | 等待态持续时长 |
| `presetKey` | `demo-parabola` | 文件名 | 决定加载哪份预制 |
| `prewarmed` | `true` | true / false | false 时视为无缓存 → 可恢复错误 |
| `externalAttempt` | `off` | `off` / `hang` / `invalid` / `late` | `off` 立即出曲线；`hang` 等 1.5 秒后回退；`invalid` 进入可恢复错误；`late` 先回退再丢弃迟到结果 |

### 4.4 其他可调项

| 项 | 位置 | 当前值 | 备注 |
| --- | --- | --- | --- |
| 目标时间 | `#target-time` | 12.5 | `min=0`、`step=0.1`，由预制 `time` 回填 |
| 播放进度 | 视频原生控件 | — | 空格不作为破壁键 |
| 拖动控制点 | 覆盖层 `circle` | — | 映射到数学坐标后写入 `h` |

## 5. 手势与动画线索

| 项 | 值 |
| --- | --- |
| 覆盖层指针事件 | `pointerdown` / `pointermove` / `pointerup`，`setPointerCapture`，拖动中每次 move 重绘 |
| 曲线绘制 | 81 个采样点（1 个 `M` + 80 个 `L`），坐标保留 2 位小数 |
| 曲线样式 | `stroke: #71ddff`、`stroke-width: 3`、`stroke-linecap: round`、`fill: none` |
| 控制点样式 | `<circle r=10 fill=#08111f stroke=#ffffff stroke-width=3 tabindex=0>` |
| 等待时长 | 1500ms 看门狗（`fallbackAfterMs`） |
| 回退性能口径 | 判定超时 → 首个可见 SVG 帧 ≤ 100ms（SC-003） |
| 重算触发 | `resize`、`fullscreenchange`、`orientationchange`、DPR 变化、`ResizeObserver(video)`、`loadedmetadata` |
| 失效清理 | 播放 / 离开目标时间 → 覆盖层与定时器一起清理；`pagehide` 释放全部监听 |
| 拖拽钳制 | 参数写入前钳制在 `min`–`max` |

## 6. 视觉令牌（来自 `demo.css`；规范定义见 [BreakGlass-visual-spec.md](./BreakGlass-visual-spec.md) §2）

| 令牌 / 样式 | 值 |
| --- | --- |
| `--panel` | `rgba(14, 29, 49, 0.92)` |
| `--line` | `rgba(157, 190, 226, 0.22)` |
| `--muted` | `#9fb4cc` |
| `--accent` | `#71ddff` |
| `--accent-strong` | `#1bb6e8` |
| 背景 | `#08111f` + 径向渐变 `#17314d → #08111f` |
| 按钮 | 圆角 9px、内边距 9px 12px、边框 `--line`、hover 边框变 `--accent` |
| 主按钮 `.primary` | `linear-gradient(135deg, #1bb6e8, #2879ff)`、全宽、`font-weight: 700` |
| 禁用态 | `opacity: 0.45; cursor: not-allowed` |
| 圆角 | 面板 20px、舞台 13px、提示 10px、芯片 999px |
| 布局断点 | `max-width: 1050px` 单列，舞台高度 540px → 420px |
| 状态区 | `#state-label` 最小高度 48px（避免文案变化时跳动） |

## 7. 文案总表（可直接抄进 UI 交付稿）

| 位置 | 状态 | 文案 |
| --- | --- | --- |
| `#source-label` | 无结果 | `等待素材` |
| `#source-label` | preset | `预先准备的示例` |
| `#source-label` | 超时回退 | `预先准备的示例 · 超时回退` |
| `#source-label` | 非 preset | `来源不可用` |
| `#source-note` | 无结果 | `数据来源将在交互出现后显示。` |
| `#source-note` | preset | `这是扩展包内预先准备的示例，不代表实时识别成功。` |
| `#source-note` | 超时回退 | `因等待超过 1.5 秒，改用预先准备的示例。` |
| `#source-note` | 等待中 | `正在等待外部结果；超过 1.5 秒会自动改用预先准备的示例，可随时取消。` |
| `#source-note` | 失败 | `没有可用的准备结果，或外部结果不可用；可以重试或退出。` |
| `#source-note` | 取消 | `已取消等待，迟到结果不会再打开交互层。` |
| `#state-label` | 等待 | `正在等待外部结果…` |
| `#state-label` | 回退成功 | `已改用预先准备的示例（超时回退），可拖动控制点。` |
| `#state-label` | 交互 | `交互已出现，可拖动控制点改变水平位置。` |
| `#state-label` | 无预制 | `当前帧没有可用的准备结果，无法进入交互。` |
| `#state-label` | 外部非法 | `外部结果不可用，未进入交互。` |
| `#state-label` | 门禁不满足 | `请先暂停在目标时间。` / `请暂停在目标时间。` |
| `#state-label` | 视频错误 | `视频无法加载，未挂载交互层。` |
| `#runtime-note` | 就绪 | `配置：off · 本地预制已预热 · 回退 1500ms` |
| `#asset-empty` | 常驻提示 | `正式视频素材尚未提供。当前只能验证扩展骨架与夹具逻辑。` |
| 覆盖层 | aria-label | `可拖动的预先准备抛物线` |

## 8. 只读调试输出（联调 / 动画验收用）

| 全局对象 | 内容 |
| --- | --- |
| `window.__breakglassAlignment` | `{ contentRect, scale, samples, maxRatio, tolerance, withinTolerance, at }`，`pagehide` 后为 `null` |
| `window.__breakglassLatency.summary()` | 各计时名（如 `fallback-visible`）的 `count / p50 / p95 / max` |
| `window.__breakglassLatency.snapshot()` | 原始毫秒数组 |

## 9. 设计时需要注意的点

1. **状态区高度固定**：`#state-label` 已设 48px 最小高度，新设计请保留，避免文案切换时布局跳动。
2. **焦点管理**：进入等待时焦点自动移到取消按钮，进入可恢复错误时移到重试按钮；状态区为 `role=status` + `aria-live=polite`。
3. **覆盖层定位**：目前靠内联 `position: absolute` + `z-index: 2` 实现（`.video-stage` 是 `display: grid`）。如果改用 CSS 类，必须在 CSS 里补 `position: absolute`，否则 SVG 会成为第二个网格项掉到视频下方。
4. **等待态目前只有文案**，没有加载指示与进度动画——这是最值得补的动画点（1500ms 的等待窗口）。
5. **回退动画预算**：从判定超时到首个可见 SVG 帧只有 100ms，曲线出现动画不要引入超过该预算的延迟。
6. **禁用态不能只靠颜色**：现有禁用用 `opacity: .45`，建议同时给 `aria-disabled` 或文案提示原因。
7. **空格不作为破壁键**，`Alt+B` 与 `Esc` 已在页面底部标注。

## 10. 本轮阅读中发现并已修正的差异

| 问题 | 规格要求 | 修正 |
| --- | --- | --- |
| 等待态与可恢复错误态下「退出」按钮不可用 | FR-010 要求失败时提供「重试或退出」，SC-005 要求两步内回到可暂停画面 | 两种状态下 `#exit-button` 现在可用（`main.js` 两处），并加了 `tests/page-p2.test.js` 断言 |

## 11. 未实现 / 不在本次范围

`a`、`k` 两个参数的控件；真实视觉识别与上传；Pyodide/Worker；任意网站注入；正式演示视频与四画幅真机验收。
