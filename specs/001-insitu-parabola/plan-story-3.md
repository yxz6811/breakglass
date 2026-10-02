# Story 3（P3）实施规划：换画幅后曲线仍然贴住原图

> 状态：**规划稿，未实现**。日期：2026-10-02。
> 依据（只读引用）：`spec.md` User Story 3 / FR-014 / FR-018 / SC-004、`quickstart.md` 第 3 节、`research.md` §7、`data-model.md`（ContentRect）、`contracts/extension-surface.md`、`docs/BreakGlass-constitution.md` §7。
> 范围说明：本轮按用户指示只规划 **P2 与 P3**；**P1（用户故事 1 / MVP）不在本轮范围**，Constitution 中的 P1 增强（真实视觉识别、Pyodide/Worker）同样不涉及。P2 的细化见 [`plan-story-2.md`](./plan-story-2.md)。

## 1. 需求基线（逐条可验收）

| 编号 | 来源 | 可观察的验收行为 |
| --- | --- | --- |
| AC-1 | FR-014 / SC-004 | 同一目标帧、同一套曲线定义，在 16:9、4:3、竖屏、带黑边四种画幅下唤醒，曲线与视频内容中抛物线的偏差 ≤ 内容区域较短边的 2% |
| AC-2 | SC-004 | 交互已显示时改变一次窗口大小，重算后偏差仍 ≤ 2% |
| AC-3 | Constitution §7 | 全屏、页面缩放、设备像素比（DPR）变化后重新计算，偏差 ≤ 2% |
| AC-4 | FR-014 | 黑边不参与对齐：比较只发生在 `contentRect` 内，不得按播放器外框计算 |
| AC-5 | FR-014 | 位置以视频画面本身为准；`object-fit: contain` + `object-position` 必须参与换算 |
| AC-6 | FR-018 / FR-016 | 页面没有可访问视频或不在已验证范围时：不挂曲线、不改写页面，入口不可用或给出明确说明 |
| AC-7 | FR-013 | 播放或离开目标时间后覆盖层消失（与 P2 共用同一条清理路径） |

### 1.1 「2%」口径定义（必须先冻结，否则无法验收）

- **偏差**：在采样点上取 `|实测 SVG 点 − 期望画面点|` 的最大值，再除以 `min(contentRect.width, contentRect.height)`；阈值 `0.02`。
- **期望点**：由定义侧独立计算 —— 数学坐标 → `region` 源像素 → 乘 `scale` 得到 CSS 像素（只用 `videoWidth`/`videoHeight`、元素显示矩形、`object-fit`/`object-position`）。
- **采样点**：至少包含顶点、`domain` 两端与等距 9 点；四画幅与一次窗口变化分别记录。
- **测量条件**：记录浏览器版本、机器、DPR、是否全屏、是否热缓存；未实际运行的画幅不得写成已通过。

## 2. 现状与差距

| 现状 | 证据 | 差距 |
| --- | --- | --- |
| 纯函数映射已覆盖四类宽高比 | `tests/geometry.test.js`（16:9 / 4:3 / 竖屏 / 满幅，12 项通过） | 只有「源尺寸 → 内容矩形」，没有「画面点 ↔ 页面点」的往返断言 |
| 覆盖层未绝对定位 | `extension/demo/demo.css` 无 `.curve-overlay` 规则；`main.js` 未设 `overlay.style.position` | `.video-stage` 是 `display: grid`，追加的 `<svg>` 会成为第二个网格项落到视频下方，**视觉对齐不可能成立**（已登记为已知差距） |
| 只在 `window.resize` 重算 | `main.js:245` | 缺 `fullscreenchange`、DPR 变化、`ResizeObserver(video)`、`loadedmetadata`、`orientationchange` |
| `object-position` 解析不完整 | `content-rect.js:7-15` | 长度单位（`0px 50%`）、单关键字补齐另一轴、数字型三处未实现（3 项 TODO） |
| 源尺寸未做有限性防御 | `content-rect.js:18-20` | 非有限 `videoWidth/videoHeight` 会算出 NaN 矩形（已登记） |
| 没有 2% 测量工具与记录模板 | 无相关代码 | 无法产出 SC-004 的证据 |
| 舞台高度与视频比例无关 | `demo.css` 的 `min-height: 540px` | 需要有意识地设置元素矩形，否则无法区分「黑边」与「舞台留白」 |
| 正式视频未提供 | `extension/assets/video/README.md` | 只能用夹具验证映射与重算，**不得声称原位对齐已通过** |

## 3. 设计方案

### 3.1 三层坐标必须显式区分（Constitution §7）

```text
源帧像素 (frame px)   来自 videoWidth / videoHeight，用于 region
   ↓ × scale
页面 CSS 像素 (page px) 用于 SVG overlay 的 viewBox 与坐标
   ↑ 定义层给出的数学坐标 (math x, y) 通过 domain / range / yAxis 换算到 region
```

任何一层缺失都不得直接绘制；三层之间只允许通过 `geometry` 模块换算。

### 3.2 新增 `extension/src/geometry/alignment.js`（纯函数，可测）

```ts
type Rect = { left: number, top: number, width: number, height: number }

// 内容矩形内的源像素点 ↔ 页面 CSS 点（相对覆盖层原点）
sourcePointToPage(point: { x, y }, contentRect: Rect): { x, y }
pagePointToSource(point: { x, y }, contentRect: Rect): { x, y }

// 偏差比例：两点距离 / min(contentRect.width, contentRect.height)
deviationRatio(expected: { x, y }, actual: { x, y }, contentRect: Rect): number
withinTolerance(ratio: number, tolerance = 0.02): boolean

// 一次完整采样：返回最大偏差比例与逐点明细（用于记录与手工核对）
sampleAlignment(input: {
  definition, parameters, contentRect, samples?: number
}): { maxRatio: number, points: Array<{ mathX, expected, actual, ratio }> }
```

### 3.3 重算触发矩阵

| 触发 | 现状 | 计划 |
| --- | --- | --- |
| `window.resize` | 已有 | 保留 |
| `document.fullscreenchange` | 无 | 新增监听（进入/退出全屏都重算） |
| DPR 变化 | 无 | `matchMedia('(resolution: Xdppx)')` 变化监听，重新挂载监听 |
| 视频元素尺寸变化 | 无 | `ResizeObserver(video)`（窗口缩放以外的布局变化） |
| `loadedmetadata` | 只更新控件 | 元数据到位后重算一次并重绘 |
| `orientationchange` | 无 | 新增（移动端/旋转屏） |

每次重算都必须**丢弃旧 `contentRect` 再重绘**（`data-model.md`：窗口、全屏或 DPR 变化后丢弃旧值并重算），并在退出/卸载时移除全部监听。

### 3.4 测量与记录

- 演示页暴露只读测量结果：`window.__breakglassAlignment = { contentRect, ratio, at }`，用于手工核对；不联网、不落盘、生产不出现。
- 每次重算后把最大偏差比例写入调试输出（可由控制台读取），并保留最近一次记录。
- 手工验收按第 7 节模板填写，四画幅 + 一次窗口变化 + 一次全屏/DPR 变化。

## 4. 前后端分工与边界（P3）

沿用 [`ownership.md`](./ownership.md) 的既有归属：**故事 3 归前端**（只涉及内容矩形和覆盖层）。这里的「后端（结果规则侧）」只承担几何契约与阈值判定，不是服务端工程。

| 能力项 | 前端（页面侧） | 结果规则侧（本仓库内） | 外部后端 |
| --- | --- | --- | --- |
| 内容矩形与缩放比 | 读取元素矩形、`object-fit/position` | 提供 `getContentRect` 与偏差阈值契约 | 提供视频素材与目标帧 |
| 覆盖层定位 | 绝对定位、`viewBox`、重算触发、监听清理 | 保证 `scale` 与 `contentRect` 自洽 | — |
| 2% 判定 | 采样、显示、记录 | `deviationRatio` / `withinTolerance` 阈值 | — |
| 全屏 / DPR | 监听与重算 | 无 | — |
| 未验证页面 | 不注入、入口不可用并说明 | 无 | — |

硬边界：不新增服务进程或数据库；不把坐标计算放到任何远端；不为通过 2% 而修改播放器、替换视频源或注入未验证网站。

## 5. 任务拆分（建议编号 T031–T039，供 `tasks.md` 登记）

| ID | 任务 | 主要文件 | 依赖 | 完成证据 |
| --- | --- | --- | --- | --- |
| T031 [P] [US3] | 先写会失败的 `tests/alignment.test.js`：四画幅往返、采样点、2% 阈值边界 | `tests/alignment.test.js` | T020 | 先红后绿 |
| T032 [US3] | 完善 `content-rect.js`：长度单位、单关键字补齐另一轴、数字型、非有限尺寸防御 | `extension/src/geometry/content-rect.js` | T031 | 既有几何测试保持通过 |
| T033 [US3] | 实现 `alignment.js`（3.2 的 API） | `extension/src/geometry/alignment.js` | T031 | `node --test` 通过 |
| T034 [US3] | 覆盖层定位收口：绝对定位 + 与 `contentRect` 绑定 | `extension/demo/demo.css`、`extension/src/page/main.js` | T027 或独立 | 手工确认覆盖层贴合画面 |
| T035 [US3] | 补齐重算触发（3.3 矩阵）并清理监听 | `extension/src/page/main.js` | T034 | 集成测试 + 手工记录 |
| T036 [P] [US3] | 四画幅夹具与 2% 测量输出 | `tests/`、`extension/src/page/main.js` | T033 | 记录模板可填 |
| T037 [US3] | 更新既有测试（`extension-surface`、`page-integration`）覆盖新监听与定位 | `tests/` | T035 | `node scripts/verify.mjs` 0 失败 |
| T038 [US3] | 按 `quickstart.md` 第 3 节手工验收并记录 2% | `docs/BreakGlass-frontend-validation.md` | T037 | 含画幅/DPR/浏览器/机器 |
| T039 [US3] | FR-018 边界核对：不在未验证页面注入，入口不可用有说明 | `extension/manifest.json`、`extension/src/page/main.js` | T037 | 静态契约测试通过 |

并行机会：T031 可与 P2 的 T021/T022 并行；T036 与 T033 在 API 冻结后可并行；T034 与 T035 同一文件，必须串行。

## 6. 测试计划

| 文件 | 动作 | 覆盖 |
| --- | --- | --- |
| `tests/alignment.test.js` | 新增 | 四画幅往返一致性、偏差比例计算、2% 边界（恰好 2% 通过 / 略超拒绝）、采样点数量与有限性 |
| `tests/geometry.test.js` | 改动 | 把 3 项 TODO 转为正式断言（长度单位、单关键字、数字型）与 NaN 防御 |
| `tests/page-integration.test.js` | 改动 | 全屏/DPR/resize 触发重算；监听在退出后清理；覆盖层绝对定位 |
| `tests/extension-surface.test.js` | 改动 | `.curve-overlay` 定位规则存在；未验证页面不注入 |
| 手工 | quickstart §3 | 四画幅 + 窗口变化 + 全屏/DPR，记录最大偏差比例 |

## 7. 手工验收记录模板

| 画幅 | 元素矩形 | contentRect | scale | 采样点 | 最大偏差(px) | 短边(px) | 比例 | ≤2% | 浏览器/DPR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16:9 | | | | | | | | | |
| 4:3 | | | | | | | | | |
| 竖屏 | | | | | | | | | |
| 带黑边 | | | | | | | | | |
| 窗口变化后 | | | | | | | | | |
| 全屏 / DPR 变化后 | | | | | | | | | |

## 8. 完成定义（Definition of Done）

- [ ] AC-1 ~ AC-7 均有自动化或手工证据，记录含时间、环境、DPR 与热缓存状态。
- [ ] 覆盖层在四种画幅下都贴合 `contentRect`（T034 前置缺陷必须修复，否则本故事无法成立）。
- [ ] 窗口变化、全屏、DPR 变化后自动重算，退出后无残留监听。
- [ ] `node scripts/verify.mjs` 0 失败。
- [ ] P1 与 Constitution 的 P1 增强范围未被扩张，未新增后端、网络请求或注入。
- [ ] `data-model.md`、`tasks.md`、验证记录同步更新。

## 9. 风险与前置

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 覆盖层未绝对定位（P0 已知缺陷） | 2% 对齐无法成立，手工验收必然失败 | T034 作为本故事的第一前置，先修再测 |
| 正式视频与目标帧素材缺失 | 只能验证映射与重算，不能给出原位结论 | 记录为夹具证据，不写成验收通过 |
| DPR / 全屏下的取整误差 | 可能逼近 2% | 采样包含顶点与两端；记录实际像素值而非只写比例 |
| 舞台 `min-height` 与视频比例解耦 | 无法区分黑边与舞台留白 | 手工验收时显式设置元素矩形并记录 |

## 10. 明确不做

真实视觉识别与上传、Pyodide/Worker（Constitution P1）；任意网站注入、跨域 iframe、Shadow DOM、DRM 播放器（`contracts/extension-surface.md` 明确不做）；多对象识别与第二个演示场景。

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-02 | 首次编写 Story 3（P3）实施规划：2% 口径、现状差距、三层坐标、alignment 模块 API、重算触发矩阵、分工与边界、T031–T039 任务、测试与手工记录模板 |
