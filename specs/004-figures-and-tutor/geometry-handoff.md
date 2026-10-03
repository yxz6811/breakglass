# 四种图形交接

日期：2026-10-03。范围是 [Spec 004 故事 1](spec.md#user-story-1---更多图形一个人)，约束参见 [BreakGlass Constitution 1.6.0](../../docs/BreakGlass-constitution.md)。本次实现图形切换、调参和确定性读数接口；提问区、中文意图解析和回答 UI 尚未实现。

## 已实现与数据来源

破壁进入交互后，可以选择抛物线、直线、圆或正弦。直线、圆、正弦使用浏览器中的本地公式，界面标为「本地数学图形」，不加入视频识别白名单，不改变 `CurveResult` 或原有 1500ms 唤醒保底。抛物线继续使用本次已接受结果的定义、来源和当前系数。

| `kind` | 方程 | 可调系数 | 包内预设的初值、范围（步长均为 0.1） | 控制点调节 |
| --- | --- | --- | --- | --- |
| `parabola` | `y = a(x − h)² + k` | `a / h / k` | `a=1 [0.4,1.2]`；`h=0 [-2,2]`；`k=1 [-2,2]` | `h`，水平移动 |
| `line` | `y = mx + b` | `m / b` | `m=1 [-4,4]`；`b=1 [-2,2]` | `b`，垂直移动 |
| `circle` | `(x − h)² + (y − k)² = r²` | `h / k / r` | `h=0 [-2,2]`；`k=1 [-2,2]`；`r=1 [0.1,8]` | `r`，水平移动 |
| `sine` | `y = a sin(x − h) + k` | `a / h / k` | `a=1 [-4,4]`；`h=0 [-2,2]`；`k=1 [-2,2]` | `h`，水平移动 |

表中初值来自包内第 6 秒预设。实际接入时，必须读取当前快照的 `definition.parameters`：本地图形的 `h / k` 继承已接受抛物线的对应描述，直线 `b` 继承 `k`；抛物线的全部描述保留原值。直线 `m` 和正弦 `a` 固定为 `[-4,4]`、初值 1、步长 0.1。圆的最大半径为坐标窗口横纵跨度的较小值，最小半径及步长为 `min(0.1, 最大半径 / 10)`，初值为 `min(1, 最大半径)`；当前页面本地窗口下为 `[0.1,8]`。

正弦的角度单位是弧度，`a` 可为负数或 0。抛物线开口范围沿用接受结果，不能包含 0。

## 坐标窗口与会话行为

- 直线、圆、正弦统一使用 `x / y ∈ [-4,4]` 的本地窗口。在当前视频内容区域内按源帧比例取区域，再居中收缩到横纵数学单位等比例；圆保持圆形。本地模式用覆盖整个 `contentRect` 的不透明背景遮住视频里的旧曲线；切回抛物线后恢复原视频。本地窗口是探索用坐标板，不是视频识别或视频曲线对齐结果。
- 抛物线继续使用结果原有 `domain / range / region`。包内预设为 `x ∈ [-2.5,2.5]`、`y ∈ [0,8]`；其原窗口、曲线和视频映射保持原样。不要把本地窗口的读数范围套到抛物线上。
- 每次选择本地图形都会恢复该类型的初值，重新选择当前本地类型也会恢复。切回抛物线保留本次会话此前修改的抛物线系数。
- 「重置」只恢复当前类型的初值。退出破壁、播放或切换视频来源会清空当前图形；此时快照为 `null`，下一次破壁默认抛物线。
- 绘制与读数使用相同方程和当前系数。可见路径按窗口交点裁剪，窗外缺口分开绘制；全部在窗外时路径为空，不生成贴边的替代线，并明确提示调整系数或重置。控制点在窗外会隐藏，可继续使用滑块调节。

## 提问协作者使用的接口

入口是 `window.BreakGlass.figureSession`，实现位于 [页面会话](../../extension/src/page/main.js)，数学模型位于 [figures.js](../../extension/src/geometry/figures.js)。只有破壁后的交互态可操作。

| 方法 | 返回与约定 |
| --- | --- |
| `getState()` | 当前图形的深拷贝快照，或 `null`。含 `kind / label / parameters / definition`；修改快照不会修改画面。 |
| `select(kind)` | 成功返回 `{ ok: true, figure }`；未知类型或非交互态返回 `ok: false`。按上文选择规则更新画面。 |
| `updateParameters(updates)` | 成功返回 `{ ok: true, figure, changes }`。`changes[name]` 含 `before / after / requested / clamped`。有限数值按范围 clamp，保留步长之间的精确值，不自动吸附滑块步长。 |
| `readAt(x)` | 成功返回 `{ ok: true, x, values, visible }`，其中 `visible[i]` 对应 `values[i]` 是否在当前窗口内。非有限横坐标或不可交互时返回 `ok: false`。 |
| `reset()` | 成功返回 `{ ok: true, figure }`，只重置当前类型。 |

批量修改必须传数值对象，例如 `{ m: 1.7, b: -0.5 }`。未知系数、字符串、`NaN`、`Infinity` 或会导致求值溢出的组合会拒绝整组修改，不部分应用；失败返回 `ok: false`，当前画面保留原值。越界的有限系数属于可执行修改，返回实际 clamp 后的数值。

`select / updateParameters / reset` 在视频显示映射不可用时返回 `{ ok: false, code: 'mapping_unavailable', message }`。本次修改不应用，原图形、系数和路径保留，选择器与滑块还原到实际状态，并提示恢复显示区域后重试。提问侧应将其作为「没有改图」处理，不能先报告请求中的数已经采用。

圆在一个横坐标上可能有 0、1 或 2 个纵坐标：圆外 `values=[]`，相切时一个值，其他情况依次为上支、下支。非圆图形返回一个纵坐标。数学上有解但在显示窗口外时，值仍保留，`visible` 为 `false`；不得把它解释为仍画在边界上。

```js
const api = window.BreakGlass.figureSession;
const before = api.getState();
if (before?.kind === 'line') {
  const result = api.updateParameters({ m: 8, b: -0.5 });
  if (result.ok) {
    // 当前窗口下实际 m=4；回答使用 after / figure.parameters。
    const actualSlope = result.changes.m.after;
    const readout = api.readAt(0); // values=[-0.5], visible=[true]
  }
}
```

每次问题执行前重新读取快照，用当前 `kind` 校验系数；批量请求只调用一次 `updateParameters`。回答引用成功返回的 `figure.parameters` 和 `changes.after`，读数引用 `readAt` 的实际结果，不另用用户原话里的越界数计算。异步回答完成时重新核对当前图形和快照；图形或会话已变则丢弃旧结果。`getState() === null` 时提示先破壁，不自动恢复旧图形。这些是故事 2 的接入要求，尚无提问 UI 实现。

## 演示与验证

沿用 README 的扩展或支持 HTTP Range 的静态服务运行方式：点击「选择预设」→「显示工具栏」→定位到 6 秒→「破壁」→切换图形→修改滑块或拖控制点。滑块支持原生方向键；可见控制点获得焦点后，左/下键减一个步长，右/上键加一个步长。再验证当前图形重置、切回抛物线和退出。

- 本文核对了 Spec 故事 1、Constitution、模型、页面会话和本次增量 diff。
- `node --test`：全仓库 406/406 通过；该命令的 PATH 临时包含既有 `ffmpeg` 测试依赖。其中本次图形相关测试为模型 21 项、页面 14 项，共 35 项，覆盖公式与绘制读数一致、窗口裁剪与全窗外提示、原子修改与 clamp、映射不可用时拒绝修改、切换/重置/生命周期及原抛物线状态保留。
- `node scripts/check.mjs`：80 个 JS/MJS 文件和 148 个本地资源引用检查通过。
- 网页浏览器核对了 1280px、424px、390px 视口，以及原生 range 方向键调参和聚焦重置按钮后 Enter 重置。更新后的证据：[圆，1280px](../../docs/test-evidence/figures-2026-10-03/circle-desktop.jpg)、[正弦，390px](../../docs/test-evidence/figures-2026-10-03/sine-mobile.jpg)、[圆，424px](../../docs/test-evidence/figures-2026-10-03/circle-narrow.jpg)。
- 独立复核结论为 `ship`：故事 1 的四项问题均已修复，指定截图中刻度无遮挡、圆保持等比、正弦可辨；独立重跑相关测试 35/35 通过。该结论只覆盖上述四项和三张截图，未扩展到额外设备或 Chrome 扩展内全屏。

图形选择器和新增参数控件沿用现有面板、`--ink / --line / --accent`、原生 range 和焦点样式。本次是既有视觉系统的局部扩展，不建立新的 `PRODUCT.md` 或 `DESIGN.md`，不修复此前无关的设计漂移。Impeccable context 工具启动后无输出并已终止，检测器未运行；不声称完成该工具的检测。

本轮不代表提问故事 2、Chrome 扩展内全屏、真实视觉识别、四画幅 2% 对齐或真实性能门槛已经验收。
