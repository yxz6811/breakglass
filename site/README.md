# BreakGlass 介绍站（site/）

**六个页面**：第 1 页是留空的封面，第 2–6 页是五个纯文字板块。

| 页 | 文件 | 内容 |
| --- | --- | --- |
| 01 | `index.html` | **留空封面**：只有背景，无文字无导航 |
| 02 | `modules/education.html` | 当下教育方式：视频成了主要载体，但画面里的图形是死的 |
| 03 | `modules/intent.html` | 项目初衷：不打断观看、就在原位、只做一件小事、零侵入、诚实标注 |
| 04 | `modules/change.html` | 改变了什么：讲解流程、操作手感、学习方式的变化 |
| 05 | `modules/abilities.html` | 能做什么：八件当场能做出来的事 |
| 06 | `modules/demo.html` | 现场演示：内嵌真实演示页 + 四步上手 |

## 交互

- **滚轮逐页推进**：页内先逐段滚动，走到本页最后一段再滚就翻到下一页；向上滚到头回到上一页。
- **翻页弹性渐显**：翻到新的一段时，标题与正文用 Web Animations API 做弹性入场（栅格里的子元素依次错峰）。
- **封面留空**：第 1 页只有背景，滚一下即进入第 2 页；也可用 ↑/↓、PageUp/PageDown、空格。
- 底部支持 `Esc` 回到封面。

## 背景：three.js 渲染的 ASCII 涟漪

- 实现：`background-gl.js` + `asSimi` shader —— 片元里算「单元 → 强度 → 字形」，字形取自运行时生成的图集纹理；涟漪与环境场全在 GPU 计算。
- 指针移动/按下会从指针位置扩散环形波；静止时保留一层缓慢流动的字符底纹。
- three.js **本地内置**在 `vendor/`（`three.module.min.js` + `three.core.min.js`，MIT），**不引 CDN**，全站不发起第三方请求。
- 降级：没有 WebGL 或模块加载失败时，`site.js` 会退回 `ascii-ripple.js`（canvas 2D 版，同一套视觉参数）。
- 文章页把画布压到 `opacity: 0.32` 当纹理，封面保持原强度。
- 尊重 `prefers-reduced-motion`：只渲染静态一帧，不做动画。

## 关于 `npx shadcn@latest add ascii-ripple-tw`

这条命令在当前环境无法执行，原因有两条，都已核实：

1. 本机没有 npm / npx（只有 Node 运行时），shadcn CLI 起不来。
2. `ascii-ripple` 属于 **ReactBits Pro** 组件：公开仓库里只有预览图（`public/assets/pro/components/ascii-ripple.webp`），`public/r/` 下没有它的 registry 条目，registry 需要 Pro 授权。免费侧只有 `RippleGrid`、`LetterGlitch`、`DotGrid`、`RippleDistortion`。

因此这里的涟漪是按同一视觉效果、用本站技术栈（three.js + shader）自行实现的。若拿到 Pro 授权并要求使用官方 React 版本，需要另建 React + Tailwind 工程，与本站「零依赖、零构建」的约定冲突。

## 性能与动效（实测调过）

背景是慢动效，按 **30fps** 出图就够，也避免掉帧：

- **限帧**：`FRAME_INTERVAL_MS = 1000/30`，阈值留 4ms 余量 —— 不留余量会因为 rAF 量化误差退化成每三帧一次（实测 23fps），留余量后稳定 29–31fps。
- **DPR 上限 1.5**：高分屏下片元数减半；检测到软件光栅化（SwiftShader / llvmpipe）时再乘 0.5。
- **不用 `preserveDrawingBuffer`**：关掉后省去每帧一次整屏拷贝。
- 涟漪上限 4 条；页面隐藏时停掉 rAF，回到前台再恢复。
- 实测（1440×900，AMD Radeon / ANGLE D3D11）：**29–31fps**，主线程 rAF 61fps（未被背景拖住）。

文字入场实测曲线（滚轮翻到下一页时，目标分段的透明度）：

| 时间 | +0.18s | +0.32s | +0.60s | +0.90s | +1.40s |
| --- | --- | --- | --- | --- | --- |
| opacity | 0.31 | 0.59 | 0.87 | 0.97 | 1.00 |

初版用的是 `cubic-bezier(0.16, 1.42, 0.32, 1)`，前 25% 就冲到约 90%，看起来「一闪就完」；现在换成 `cubic-bezier(0.3, 0.72, 0.28, 1.02)`，整段约 1.4–1.5 秒收尾。

## 本地预览

必须用 http(s) 打开（ES module 与 `fetch` 在 `file://` 下会被拦）：

```bash
python -m http.server 8899     # 或 npx --yes serve -l 8899 .
# 打开 http://127.0.0.1:8899/site/
```

## 内容口径

- 演示区的曲线来自扩展包内**预先准备的样例**，页面一直标注来源，不写成识别结果。
- 识别适配标注为「默认关闭」，不暗示外部识别已接通。
- 手工验收与 ≤100ms 实测尚未执行，页面上如实写作「仍在进行中」。
