# 液态玻璃顶栏（Liquid Glass Toolbar）原型

> 目标：把 BreakGlass 演示页的操作控件做成**顶部一条液态玻璃长条**，上面放**圆形玻璃按键**；指针滑过时按钮**逐个平滑放大**（macOS Dock 的手感），离开后回落。
> 这是独立原型，**不进入 `extension/` 扩展包**，也不引入任何依赖或远程资源。打开 `index.html` 即可查看。

## 1. 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 演示页：动态背景 + 顶栏 + 实时读数 |
| `liquid-glass.css` | 材质与布局（分层实现，见 §2） |
| `magnify.js` | 放大内核：纯函数（衰减、采样、帧率无关平滑），可在 Node 里测 |
| `liquid-glass.js` | 控制器：指针/焦点 → 目标值 → rAF 平滑 → 写 `transform` |
| `../../tests/liquid-glass-toolbar.test.js` | 内核算法的 7 组纯函数测试 |

## 2. 材质实现方法（建议照这个顺序做）

液态玻璃不是一层 `backdrop-filter` 能做完的，它靠**四层叠加 + 一条可选折射**：

| 层 | 做法 | 作用 |
| --- | --- | --- |
| 1 底座模糊 | `backdrop-filter: blur(18px) saturate(190%)` | 玻璃的通透与颜色渗透 |
| 2 染色 | `linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.10) 46%, rgba(255,255,255,.06))` | 上亮下暗的玻璃体积感 |
| 3 顶部镜面 | `::before` 高度 54%，白色渐变 + `mask-image: linear-gradient(#000, transparent)` | 室内光源在玻璃顶边的反射条 |
| 4 跟随指针的柔光 | `::after` 用 `radial-gradient(150px 100px at var(--lg-px) 50%, …)`，由 JS 写 `--lg-px` | 证明玻璃是活的，指针在哪光就在哪 |
| 5 玻璃厚度 | `inset 0 1px 0 rgba(255,255,255,.45)` + `inset 0 -1px 0 rgba(255,255,255,.22)` + `inset 0 0 0 1px rgba(255,255,255,.14)` + 外部投影 | 上边高光、下边反光、整体轮廓，缺一条就不像玻璃 |
| 6（可选）边缘折射 | SVG `feTurbulence` → `feGaussianBlur` → `feDisplacementMap`，用 `backdrop-filter: url(#lg-refract)` | 背景在玻璃边缘产生波纹，最接近 Apple 的液态玻璃；Chrome 支持、Safari 不支持 → 由 JS 用 `CSS.supports` 检测后加 `data-refract="on"` |

圆形按键复用同一套材质，但把模糊半径降到 `blur(6px)`（面积小、不需要大半径），并用 `radial-gradient(120% 120% at 30% 18%, …)` 制造**偏心高光**，让每个圆看起来是独立的小水珠。

## 3. 动效实现方法（逐个放大的核心）

### 3.1 权重函数：余弦钟形

```
w(d) = 0.5 × (1 + cos(π · min(1, |d| / R)))
```

- `d` = 指针 x 与按钮中心 x 的距离，`R` = 影响半径（默认 132px）。
- 中心 `w=1`，到 `R` 处 `w=0`，**两端导数为 0** → 相邻按钮之间是连续过渡，滑动时不会出现台阶或跳变。
- 用线性衰减（`1 - d/R`）在 `R` 处会有折角，肉眼能看出「卡一下」，所以不推荐。

### 3.2 目标值与平滑

```
scale_i = 1 + (maxScale - 1) × w_i        // 默认 1 → 1.55
lift_i  = lift × w_i                     // 默认 0 → 10px
```

每帧只做一次**帧率无关低通**逼近目标：

```
v += (target - v) × (1 - e^(-k · dt))     // k = stiffness，默认 20 /s
```

- 指数形式保证「两个半步 = 一个整步」，掉帧时观感不变；`dt` 上限截断到 50ms 防止卡顿后跳变。
- `stiffness` 越大越跟手；> 30 会抖，< 12 会拖尾。
- 收敛阈值 `epsilon = 0.0015`，全部按钮都到位后**停止 rAF**，不空转。

### 3.3 渲染

- 只写 `transform: translate3d(0, -lift, 0) scale(s)`，配合 `transform-origin: center bottom` → 按钮从长条上「抬起来」，形似灵动岛膨胀。
- 用 `offsetLeft + offsetWidth / 2` 测量中心（布局坐标，不受 transform 影响），`ResizeObserver` 在尺寸变化后重新测量。
- 只在数值变化超过阈值时才写 style，避免无谓的样式重算。

### 3.4 可调参数

| 参数 | 建议区间 | 默认 | 说明 |
| --- | --- | --- | --- |
| `radius` 影响半径 | 100 – 160px | 132 | 决定同时被带动几个按钮（约 2–3 个）|
| `maxScale` 最大放大 | 1.4 – 1.7 | 1.55 | 超过 1.7 会显得晃 |
| `lift` 抬升 | 6 – 14px | 10 | Dock 的浮起感 |
| `stiffness` 刚度 | 14 – 26 /s | 20 | 跟手 ↔ 顺滑 |
| `epsilon` 收敛阈值 | 0.001 – 0.003 | 0.0015 | 动画停止判据 |

构造时可以覆盖：`new LiquidGlassDock(el, { radius: 150, maxScale: 1.6 })`。

## 4. 集成到 BreakGlass 演示页（重要）

1. **必须保留既有 id**：`#wake-button`、`#cancel-button`、`#retry-button`、`#reset-button`、`#exit-button`（还有 `#play-toggle`、`#jump-target`）。`tests/page-integration.test.js` 会检查这些 id 与脚本顺序，改名会让测试失败。
2. 把 `.lg-dock` 的标记放进 `demo/index.html`，样式并入 `demo/demo.css`，脚本加在 `main.js` 之前；`magnify.js` / `liquid-glass.js` 属于本地脚本，仍满足 CSP `script-src 'self'`。
3. 顶栏建议 `position: fixed; top: 16px`，并给容器留 **≥24px 的下内边距**，否则放大后的按钮会被裁切。
4. 状态映射：

| BreakGlass 状态 | 顶栏表现 |
| --- | --- |
| `paused-ready` | 「破壁」为 primary 且可点，其余置灰 |
| `waiting` | 显示「取消等待」按钮，破壁置灰；玻璃条内加 1.5 秒进度条（见设计指南 §5） |
| `interactive` | 显示「重置」「退出」；参数滑块仍留在面板（圆形按钮放不下滑块） |
| `recoverable-error` | 「重试」升为 primary，同时显示「退出」 |

5. 来源芯片 `#source-label` 可以并进长条右端（同一个玻璃容器内），但**不要**放进圆形按钮里——它是状态不是操作。
6. `Alt+B` / `Esc` 快捷键不变；按钮的 `aria-keyshortcuts` 保留。

## 5. 性能与降级

| 风险 | 处理 |
| --- | --- |
| `backdrop-filter` 成本高（1 条 + N 个圆 = N+1 个模糊层） | 圆只用 `blur(6px)`；长条 18px；低端设备可去掉圆的模糊，仅留渐变+内阴影 |
| 折射滤镜最贵 | 默认关闭，`data-refract="on"` 才开；`data-refract="off"` 强制关闭 |
| 常驻 rAF | 收敛即停；指针静止时零开销 |
| 触屏没有 hover | 建议 `pointerdown` 时放大被按下的按钮（本原型未启用） |
| `will-change` 过多 | 只给 `.lg-item` |
| 动效敏感用户 | `prefers-reduced-motion: reduce` 时**关闭放大**，只保留颜色/焦点反馈 |

## 6. 可访问性

- 按键是真实 `<button>`，图标 `aria-hidden`，名称走 `aria-label` + 视觉 tooltip。
- 玻璃层与折射层 `aria-hidden="true"`，不参与读屏。
- `:focus-visible` 显示 2px accent 焦点环 + 3px offset；**键盘聚焦时同样放大**（焦点被当作指针中心）。
- 文字对比度：背景是动态模糊图，文字用 `#eef5ff` + 深色描边/内阴影保证可读。

## 7. 验收清单

- [ ] 指针从左到右滑过，按键**依次**放大，切换过程中相邻按钮高度差连续、无台阶。
- [ ] 指针离开后约 300ms 内全部回到 1x，无残留抬升。
- [ ] 快速甩动指针不抖动（帧率无关平滑生效）。
- [ ] Tab 聚焦时该按键放大且显示焦点环；`Esc`/`Alt+B` 行为不变。
- [ ] 禁用 JS 时顶栏仍可见可用（只是没有放大）。
- [ ] `prefers-reduced-motion` 下无放大动画。
- [ ] 关闭折射后中端设备稳定 55fps 以上。
