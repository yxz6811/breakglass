# BreakGlass 视觉规范（Visual Spec）

| 项 | 值 |
| --- | --- |
| 版本 | 1.0.0 |
| 日期 | 2026-10-02 |
| 状态 | 设计基线，待团队冻结 |
| 适用范围 | `extension/demo/` 演示页的全部视觉与动效；不含 P1（识别/Pyodide） |
| 依据 | `AGENTS.md` §6（视觉、响应式与可访问性）、`docs/BreakGlass-constitution.md`（§4 来源标识、§6 超时保底、§7 对齐、§10 验收）、`specs/001-insitu-parabola/spec.md`（FR-001~019、SC-001~006）、`docs/BreakGlass-frontend-execution-plan.md`（P-01~P-05、§10） |
| 配套 | 令牌与组件说明见本文；逐交互的设计理由见 [`BreakGlass-ui-design-guide.md`](./BreakGlass-ui-design-guide.md)；现状清单见 [`BreakGlass-ui-inventory.md`](./BreakGlass-ui-inventory.md)；待实现项见 [`BreakGlass-ui-todo.md`](./BreakGlass-ui-todo.md)；液态玻璃原型见 [`../prototypes/liquid-glass-toolbar/README.md`](../prototypes/liquid-glass-toolbar/README.md) |
| 边界 | **本文只定义规范，不代表已经实现。** 文中标注 `【新】` 的条目当前代码中不存在 |

## 1. 设计原则

1. **玻璃是容器，不是装饰**：模糊与高光只用来承载控件和指示焦点，不遮挡视频画面与曲线。
2. **状态永远可见**：来源（预先准备 / 超时回退）、等待、失败、取消都要有持续可见的视觉，不靠一次性提示。
3. **动效服务于状态变化**：每个动画都必须对应一次状态迁移或一次操作反馈；没有状态含义的装饰动画不加（AGENTS §6）。
4. **对齐优先于炫技**：覆盖层必须贴合视频内容区域，任何视觉手段都不能影响 2% 对齐与 ≤100ms 的回退预算。
5. **可达性不打折**：焦点可见、对比度可读、`prefers-reduced-motion` 有完整降级、禁用态必须给原因。

## 2. 设计令牌（唯一事实来源）

> 代码中现有的令牌来自 `extension/demo/demo.css`；标注 `【新】` 的需要在实现时补进 `:root`。

### 2.1 颜色

| 令牌 | 值 | 用途 | 状态 |
| --- | --- | --- | --- |
| `--bg-base` | `#05080f` | 页面底色 | 【新】 |
| `--bg-stage` | `#02070e` | 视频舞台底色（现有说明见 demo.css） | 现有 |
| `--panel` | `rgba(14, 29, 49, 0.92)` | 面板/读数底色 | 现有 |
| `--line` | `rgba(157, 190, 226, 0.22)` | 边框、分隔线 | 现有 |
| `--muted` | `#9fb4cc` | 次级文字 | 现有 |
| `--ink` | `#eef5ff` | 主文字 | 现有 |
| `--accent` | `#71ddff` | 主强调色：来源、焦点、数值、曲线描边 | 现有 |
| `--accent-strong` | `#1bb6e8` | 主按钮渐变暗端 | 现有 |
| `--warn` | `#ffd08a` | 回退/失败/素材缺失的警示（**不引入纯红**，避免破坏暗色主题一致性与色觉可辨性） | 【新】 |
| `--glass-tint-top` | `rgba(255,255,255,0.22)` | 玻璃染色（上） | 【新】 |
| `--glass-tint-mid` | `rgba(255,255,255,0.10)` | 玻璃染色（中） | 【新】 |
| `--glass-tint-low` | `rgba(255,255,255,0.06)` | 玻璃染色（下） | 【新】 |
| `--glass-edge` | `rgba(255,255,255,0.45)` | 玻璃顶部高光边 | 【新】 |
| `--glass-edge-soft` | `rgba(255,255,255,0.14)` | 玻璃内描边 | 【新】 |
| `--glass-shadow` | `rgba(3, 8, 18, 0.55)` | 玻璃外部投影 | 【新】 |

### 2.2 排版

| 角色 | 规格 | 用途 |
| --- | --- | --- |
| 字体栈 | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | 全局（现有） |
| H1 | `clamp(32px, 4vw, 58px)` / `line-height 1.04` / `letter-spacing -0.04em` | 页面标题（现有） |
| H2 | 24px | 面板标题（现有） |
| 正文 | 14px / `line-height 1.6` | 说明文字 |
| 辅助 | 12–13px / `line-height 1.5` | 状态区、来源说明、页脚（现有） |
| 眉标 | 11px / `letter-spacing .18em` / 700 | `BREAKGLASS · P0 DEMO`、`INTERACTION`（现有） |
| 数值 | `font-variant-numeric: tabular-nums` | 参数值、时间、读数（现有） |
| 玻璃上的文字 | 必须叠加 `text-shadow: 0 1px 2px rgba(0,0,0,.45)` | 背景是动态模糊图，保证可读 |

### 2.3 间距与尺寸

| 项 | 值 |
| --- | --- |
| 间距基线 | 4px；序列 `4 / 8 / 12 / 16 / 20 / 24 / 28 / 36` |
| 页面容器 | `width: min(1320px, 100% - 64px)`；窄屏 `min(720px, 100% - 32px)`（现有） |
| 面板宽 | 310px（现有） |
| 按钮高 | **40px**（现有内边距 9/12 约 36px，偏小） |
| 圆形按键 | 48px（顶栏内） |
| 顶栏高 | 72px（含 12px 内边距） |
| 触控目标 | ≥ 40×40px |
| 视频舞台 | `min-height: 540px`；窄屏 420px（现有） |
| 状态区 | `min-height: 48px`（现有，防止文案切换跳动） |

### 2.4 圆角

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--radius-sm` | 9px | 按钮 |
| `--radius-chip` | 10px | 提示条、标签 |
| `--radius-card` | 14px | 读数卡片 |
| `--radius-stage` | 13px | 视频舞台（现有） |
| `--radius-panel` | 20px | 面板（现有） |
| `--radius-pill` | 999px | 顶栏、来源芯片 |

### 2.5 层级（elevation）

| 层级 | 阴影 | 用途 |
| --- | --- | --- |
| E1 | `0 4px 12px rgba(3,8,18,.35)` | tooltip、chip |
| E2 | `0 6px 14px rgba(4,10,22,.35)` | 圆形按键 |
| E3 | `0 18px 48px rgba(3,8,18,.55)` | 液态玻璃顶栏 |
| E4 | `0 20px 70px rgba(0,0,0,.25)` | 面板（现有） |

### 2.6 玻璃材质令牌

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--glass-blur-bar` | 18px | 顶栏底座模糊 |
| `--glass-blur-item` | 6px | 圆形按键（面积小，不必大半径） |
| `--glass-sat-bar` | 190% | 顶栏饱和度 |
| `--glass-sat-item` | 150% | 按键饱和度 |
| `--glass-lift` | 10px | 放大时向上抬升 |

## 3. 组件规范

### 3.1 液态玻璃顶栏（Liquid Glass Toolbar）【新】

**结构**：三层 DOM，材质与交互分离。

```html
<div class="lg-dock" data-liquid-glass>
  <div class="lg-glass" aria-hidden="true"></div>   <!-- 材质：模糊+染色+高光 -->
  <div class="lg-refract" aria-hidden="true"></div> <!-- 可选折射（渐进增强） -->
  <nav class="lg-items" aria-label="演示控制">      <!-- 真实按钮 -->
    <button class="lg-item" type="button" aria-label="播放视频">…</button>
  </nav>
</div>
```

| 属性 | 规格 |
| --- | --- |
| 位置 | `position: fixed; top: 16px; left: 50%; transform: translateX(-50%)` |
| 安全边距 | 容器下内边距 ≥ 24px，保证放大后的按键不被裁切 |
| 形状 | `border-radius: 999px`；高度 72px |
| 材质 | 四层叠加：① `backdrop-filter: blur(18px) saturate(190%)` ② 白色染色渐变 ③ `::before` 顶部镜面条带（高 54%，`mask-image` 渐隐） ④ `::after` 跟随指针的柔光（`radial-gradient` at `--lg-px`） |
| 厚度 | `inset 0 1px 0 var(--glass-edge)` + `inset 0 -1px 0 rgba(255,255,255,.22)` + `inset 0 0 0 1px var(--glass-edge-soft)` + `inset 0 -16px 28px rgba(255,255,255,.06)` |
| 投影 | E3 |
| 折射（可选） | SVG `feTurbulence → feGaussianBlur → feDisplacementMap` + `backdrop-filter: url(#lg-refract)`；`CSS.supports` 通过才启用，默认关闭 |

**圆形按键**

| 属性 | 规格 |
| --- | --- |
| 尺寸 | 48×48px，`border-radius: 50%`，间距 10px |
| 材质 | 偏心高光 `radial-gradient(120% 120% at 30% 18%, rgba(255,255,255,.42), …)` + `blur(6px)` + E2 投影 |
| 图标 | 内联 SVG 20×20，`stroke: currentColor`，`aria-hidden="true"` |
| 主操作变体 | `data-variant="primary"`：浅色底 + accent 渐变、深色图标（全局唯一，默认给「破壁」，失败态让位给「重试」） |
| 状态 | hover：`color: #fff`；active：内环 `::after` 出现；focus-visible：`outline: 2px solid var(--accent); outline-offset: 3px`；disabled：`opacity: .4` + 原因提示；hidden：`display: none !important`（`.lg-item` 设了 `display:grid` 会盖掉 UA 的 `[hidden]`） |
| 放大 | `transform-origin: center bottom`，hover/focus 时 `translate3d(0,-lift,0) scale(s)`；由 §5.3 的算法驱动 |
| Tooltip | `.lg-tip`：按钮下方 6px，E1 阴影，hover/focus 时淡入上移 120ms |
| 分隔线 | `.lg-sep`：1×26px，垂直渐变（透明→白 35%→透明） |

**顶栏内分组建议**：`[播放][定位][破壁] │ [取消/重试][重置][全屏][退出]`，来源芯片贴在容器右端（同一玻璃容器内，但**不是按钮**——它是状态）。

### 3.2 参数滑块行

| 属性 | 规格 |
| --- | --- |
| 结构 | 每个参数一行：`名称 + 数值 + 滑块`，`grid-template-columns: 1fr auto`（现有 `parameter-row`） |
| 参数 | `a`（0.4–1.2 / 0.1）、`h`（-2–2 / 0.1）、`k`（-2–2 / 0.1），**三行常驻**不折叠 |
| 视觉 | 滑块 `accent-color: var(--accent)`；数值 `--accent` + `tabular-nums`（现有）；行间距 16px |
| 状态 | 仅 `interactive` 可用；禁用时给原因；拖动中数值实时更新，松手 120ms 内高亮一次 |
| 可访问性 | `<label for>` 关联（现有）；`aria-valuetext="0.8（范围 0.4 到 1.2）"` |

### 3.3 状态区（`#state-label`）

| 属性 | 规格 |
| --- | --- |
| 语义 | `role="status" aria-live="polite"`（现有）；**错误态改用 `aria-live="assertive"`** |
| 高度 | `min-height: 48px`，任何文案切换都不得改变容器高度 |
| 色彩 | 常态 `--muted`；错误态在左侧加 4px `--warn` 竖条 |
| 动效 | 文案切换 160ms 交叉淡入；错误态 160ms 上移淡入；**禁止抖动** |

### 3.4 来源芯片（`#source-label`）

| 状态 | 视觉 |
| --- | --- |
| 等待素材 | `--muted` 文字 + `--line` 描边 |
| 预先准备的示例 | `--accent` 文字 + `rgba(113,221,255,.35)` 描边（现有） |
| 预先准备的示例 · 超时回退 | 同上 + **虚线描边** + 出现时闪一次（accent 12% → 透明，300ms） |
| 来源不可用 | `--warn` 文字 + warn 描边 |

芯片不加 `aria-live`（避免与状态区重复朗读）。

### 3.5 等待条（加载反馈）【新】

| 属性 | 规格 |
| --- | --- |
| 结构 | 左 16px 环形 spinner ｜ 中间文案 ｜ 右侧「取消等待」次按钮 |
| 位置 | 顶栏中部（若顶栏未启用，则位于控制面板状态区下方） |
| 视觉 | `--panel` 底 + `--line` 描边；spinner 为 accent 2px 圆弧，1s 旋转 |
| 进度 | **1.5 秒线性进度条**（accent 20% → 100%），与 `fallbackAfterMs` 严格对齐 |
| 语义 | `aria-busy="true"`；进入等待时焦点移到「取消等待」 |
| 降级 | `prefers-reduced-motion` 下 spinner/进度条改为静态文案 |

### 3.6 覆盖层与控制点

| 属性 | 规格 |
| --- | --- |
| 覆盖层 | 绝对定位、与 `contentRect` 绑定、`viewBox = 0 0 contentRect.width contentRect.height`；不使用位移过渡 |
| 曲线 | 81 采样点，`stroke: var(--accent)`、`stroke-width: 3`、`stroke-linecap: round`、`fill: none` |
| 控制点 | 视觉 `r=10`（`fill #08111f` / `stroke #fff` / `stroke-width 3`）+ **透明 `r=18` 热区**；hover/focus `scale(1.2)`，不改几何 |
| 光标 | `cursor: grab` / 拖动中 `grabbing` |
| 聚焦 | 外发光 8px accent 30% + 描边加粗 |

### 3.7 空态与错误提示（`#asset-empty`）

| 属性 | 规格 |
| --- | --- |
| 位置 | 舞台底部内嵌条（现有 `inset: auto 20px 18px`） |
| 视觉 | `--warn` 文字 + warn 30% 描边 + `rgba(38,24,8,.9)` 底 + `border-radius: 10px`（现有） |
| 区分 | 「素材未提供」（常驻）与「视频加载失败」（事件）用不同图标与文案 |

### 3.8 通用状态

| 状态 | 规格 |
| --- | --- |
| 焦点环 | `outline: 2px solid var(--accent); outline-offset: 2px`（按键 3px）；**不得只用颜色变化表达焦点** |
| 禁用 | `opacity: .4~.45` + `cursor: not-allowed` + **必须给出原因**（`aria-describedby` 或 tooltip） |
| 提示 tooltip | 12px、`rgba(8,17,31,.82)` 底、E1 阴影、120ms 淡入 + 上移 4px |
| 加载 | 见 §3.5；禁止使用会改变布局尺寸的加载骨架 |

## 4. 状态 → 视觉映射

| 会话状态 | 顶栏 | 主操作 | 状态区 | 来源芯片 | 覆盖层 |
| --- | --- | --- | --- | --- | --- |
| `paused-ready`（未在目标时间） | 破壁置灰 + 原因提示 | — | 「请暂停在目标时间。」 | 等待素材 | 无 |
| `paused-ready`（已在目标时间） | 破壁可用（呼吸 1.6s） | 破壁 | 「已暂停在目标时间，可以再次破壁。」 | 等待素材 | 无 |
| `waiting` | 显示「取消等待」，破壁置灰 | 取消 | 「正在等待外部结果…」 | 等待素材 | 无 |
| `interactive`（`fallback: null`） | 显示「重置」「退出」 | 拖动/重置 | 「交互已出现，可拖动控制点。」 | 预先准备的示例 | 有 |
| `interactive`（`fallback: timeout`） | 同上 | 拖动/重置 | 「已改用预先准备的示例（超时回退），可拖动控制点。」 | 预先准备的示例 · 超时回退（虚线） | 有（立即绘制） |
| `recoverable-error` | 显示「重试」（primary）与「退出」 | 重试 | 原因文案 + warn 竖条 | 等待素材 | 无 |
| 取消后 | 破壁可用 | 破壁 | 「已取消等待，可以再次破壁。」 | 等待素材 | 无 |
| 视频错误 | 破壁与定位置灰 | — | 「视频无法加载，未挂载交互层。」 | 等待素材 | 无 |

## 5. 动效规范

### 5.1 时长与缓动

| 令牌 | 值 |
| --- | --- |
| `--motion-fast` | 80ms（按压） |
| `--motion-base` | 120ms（tooltip、控制点、图标交叉淡入） |
| `--motion-state` | 160ms（状态文案、来源芯片、错误出现） |
| `--motion-enter` | 200ms（曲线出现强调） |
| `--motion-wait` | 1500ms linear（等待进度，与 `fallbackAfterMs` 对齐） |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` |

### 5.2 逐交互动效

| 交互 | 动效 |
| --- | --- |
| 破壁按下 | `scale .99` 80ms → 曲线入场 |
| 曲线出现 | **立即绘制最终几何**（保证 ≤100ms），随后 200ms 只做透明度/光晕强调（不做 dash 生长） |
| 来源芯片切换 | 160ms 交叉淡入，不做位移 |
| 等待进度条 | 1500ms linear，到点触发回退 |
| 取消/退出 | 覆盖层 120ms 淡出 + `scale 1 → .98`，**不做位移** |
| 重置 | 数值先闪 accent 再归位 160ms；曲线缓动回初值 |
| 控制点 | hover/focus 120ms `scale 1.2`；松手 120ms 回弹 |
| 圆形按键放大 | 见 §5.3 |

### 5.3 顶栏放大算法（Dock 式）

```
权重：w(d) = 0.5 × (1 + cos(π · min(1, |d| / R)))
目标：scale = 1 + (maxScale − 1) × w        lift = L × w
平滑：v += (target − v) × (1 − e^(−k · dt))  （dt 上限 50ms）
```

| 参数 | 默认 | 建议区间 | 说明 |
| --- | --- | --- | --- |
| `R` 影响半径 | 132px | 100–160 | 同时带动约 2–3 个按键 |
| `maxScale` | 1.55 | 1.4–1.7 | 超过 1.7 显得晃 |
| `L` 抬升 | 10px | 6–14 | 浮起感 |
| `k` 刚度 | 20/s | 14–26 | 跟手 ↔ 顺滑 |
| `epsilon` | 0.0015 | 0.001–0.003 | 收敛后停 rAF |

要点：余弦钟形**两端导数为 0**，保证相邻按键连续过渡、滑动无台阶；指数平滑**帧率无关**，快甩不抖。

### 5.4 降级规则

`prefers-reduced-motion: reduce` 时：
1. 关闭顶栏放大（按键保持 1×，只保留 hover 颜色与焦点环）；
2. 等待 spinner/进度条改为静态文案；
3. 关闭背景浮动动画；
4. 状态切换直接替换文案，不做淡入。

### 5.5 性能预算

| 约束 | 值 |
| --- | --- |
| 回退首帧 | 判定超时 → 首个可见 SVG 帧 ≤ 100ms（SC-003），动画不得推迟首帧 |
| 可动画属性 | 只允许 `transform` / `opacity` / `filter`（后者限小面积） |
| 模糊层数量 | 顶栏 1 + 按键 N 个（`blur(6px)`）；折射层默认关闭 |
| rAF | 收敛即停；指针静止时零开销 |
| `will-change` | 只给 `.lg-item` |

## 6. 融入项目的方式（描述，不实现）

### 6.1 演示页最终布局

```text
┌──────────────────────────── 液态玻璃顶栏（fixed, top 16px） ────────────────────────────┐
│  ● 播放   ● 定位   ● 破壁  │  ● 取消/重试   ● 重置   ● 全屏   ● 退出        [来源芯片]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
   ┌────────────────────────────────┐   ┌──────────────────────────┐
   │                                │   │ 抛物线参数               │
   │      video + SVG overlay       │   │  a  [====o=====] 0.8     │
   │      （覆盖层贴合内容矩形）      │   │  h  [==o=======] 0.0     │
   │                                │   │  k  [=====o====] 0.0     │
   └────────────────────────────────┘   │ 来源与原因说明            │
   [播放 / 定位 / 目标时间 12.5s]         └──────────────────────────┘
   页脚：Esc 退出 · 空格留给播放器 · 运行配置
```

### 6.2 既有控件 → 顶栏迁移表

| 现有控件 | 迁移后 | 必须保留的 id |
| --- | --- | --- |
| `#play-toggle` | 顶栏圆形按键（纯图标 + tooltip） | ✅ 保留 |
| `#jump-target` | 顶栏圆形按键 | ✅ 保留 |
| `#wake-button` | 顶栏圆形按键（primary） | ✅ 保留 |
| `#cancel-button` | 顶栏圆形按键（仅 `waiting` 显示） | ✅ 保留 |
| `#retry-button` | 顶栏圆形按键（仅错误态显示，升为 primary） | ✅ 保留 |
| `#reset-button` | 顶栏圆形按键（仅 `interactive`） | ✅ 保留 |
| `#exit-button` | 顶栏圆形按键 | ✅ 保留 |
| `#target-time` | 保留在传输条（数字输入不适合做成圆形按键） | ✅ 保留 |
| `#parameter-h` | 保留在右栏参数面板（滑块不适合放进圆形按键） | ✅ 保留 |
| `#source-label` | 移到顶栏右端（非按钮） | ✅ 保留 |
| `#state-label` | 保留在右栏面板 | ✅ 保留 |

### 6.3 与状态机的接线点

- 顶栏只消费 `createWake` 给出的 `state.status`（`paused-ready / waiting / interactive / recoverable-error`），**不自己判断超时、不自己丢弃迟到结果**（`ownership.md` 交接原则）。
- `state.status === 'waiting'` → 显示取消按键与等待条；`'recoverable-error'` → 重试升为 primary；`'interactive'` → 显示重置。
- 来源文案与 `state.result.fallback` 严格对应（§3.4）。
- 快捷键不变：`Alt+B` 破壁、`Esc` 退出/取消；按钮挂 `aria-keyshortcuts`。

### 6.4 与既有测试的兼容要求

1. 所有 id 必须保留（`tests/page-integration.test.js` 的静态断言）。
2. `demo/index.html` 的本地脚本顺序保持不变；`magnify.js` / `liquid-glass.js` 作为本地脚本追加，仍满足 CSP `script-src 'self'`。
3. 状态区必须保留 `role="status"` 与 `aria-live`。
4. 不引入远程资源、不引入打包器与新依赖。
5. 顶栏改动后必须补静态断言（按键存在、`aria-label` 非空、脚本本地）。

### 6.5 响应式

| 断点 | 行为 |
| --- | --- |
| ≥ 1050px | 行列两栏：视频 + 310px 参数面板；顶栏单行 |
| < 1050px | 单列；顶栏按键缩到 44px、间距 8px；来源芯片换行到第二行或收进 tooltip |
| < 720px | 顶栏可横向滚动（保持不换行），参数面板全宽 |

## 7. 验收清单（视觉与动效）

**材质**
- [ ] 顶栏在纯色背景与花哨背景上都可辨识，且不遮挡视频内容。
- [ ] 玻璃四层齐全：模糊、染色、顶部镜面、跟随指针柔光。
- [ ] 关闭折射层时外观仍完整。

**状态可见性**
- [ ] 来源在曲线出现到退出期间持续可见；超时回退与正常预制视觉可区分。
- [ ] 等待态有加载反馈与取消入口。
- [ ] 错误态有原因、重试（主）与退出（次）。

**动效**
- [ ] 顶栏按键随指针逐个放大、相邻连续无台阶，离开后平滑回落。
- [ ] 曲线首个可见帧 ≤100ms；入场强调不改变几何。
- [ ] 状态文案切换不引起布局跳动。
- [ ] `prefers-reduced-motion` 下全部动效按 §5.4 降级。

**可访问性与性能**
- [ ] 所有交互元素可 Tab 到达、焦点环可见。
- [ ] 禁用态有原因说明。
- [ ] 关键文字在玻璃上对比度可读。
- [ ] 关闭折射后中端设备稳定 55fps 以上。

## 8. 与上层文档的关系

| 文档 | 需要同步的内容 |
| --- | --- |
| `docs/BreakGlass-frontend-execution-plan.md` | §2「高保真视觉实现」从「等待设计输入」改为「已有视觉规范，见本文」；§3.1 P-01~P-05 的视觉对应本文 §4 |
| `AGENTS.md` §6 | 本文是其原则的具体化，无需修订 |
| `docs/BreakGlass-constitution.md` | 本文不新增交付范围；来源标识、超时保底、对齐与性能口径与 §4/§6/§7/§8 一致 |
| `specs/001-insitu-parabola/spec.md` | **若要动效进入验收**，需按 Constitution §9 修订 spec，新增 SC（例如「等待态必须有加载反馈」），否则动效保持增强项定位 |

## 9. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.0.0 | 2026-10-02 | 首次建立视觉规范：设计原则、设计令牌（颜色/排版/间距/圆角/层级/玻璃）、组件规范（液态玻璃顶栏、参数滑块、状态区、来源芯片、等待条、覆盖层、空态、通用状态）、状态→视觉映射、动效规范（时长/缓动/逐交互/Dock 算法/降级/性能）、融入项目方式、验收清单 |
