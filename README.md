# BreakGlass（破壁）

BreakGlass 是一个 Chrome MV3 扩展原型：把已验证演示视频中的数学抛物线变成可调节的原位 SVG 交互层，并提供独立的当前帧直角三角形学习工作台。

当前交付基线是一个离线可演示的数学抛物线 P0 vertical slice。用户在扩展内演示页播放、暂停并定位视频，在目标时间唤醒预先准备的曲线，拖动参数、重置或退出。预制结果始终标明来源，不伪装成实时识别。

## 当前范围

- P0：单个录屏或固定机位数学抛物线场景。
- P1：真实视觉识别、Python/Pyodide 和其他扩展能力，必须单独立项和验收。
- 不包含任意网站注入、用户账号、云端同步、数据库、代码执行服务或自建后端。
- 9 秒演示片已在仓库里。预制区域按这支片子第 6 秒的画面写。这一帧的手工读数见验证记录，不能当成 2% 对齐已经通过，也不能代替四画幅验收。
- 开播前阅读在片子可播放且已填写阅读地址时自动开始。验收片子不得使用 `breakglass-demo-9s.mp4`；失败、断网、地址留空或 5 分钟内一处都没通过时，画面保留用户选中的片子并丢弃无效结果。示例片只在点击「选择预设」时加载。已有独立阅读服务源码在 `breakglass-reader/`，不进入扩展包，也不部署为云端后台；未配置服务和模型时，页面不会从画面里找出抛物线。
- 交付状态：故事 1（MVP）、故事 2（等待/超时回退/失败/取消）、故事 3（多画幅 2% 对齐）、识别适配切片（`visionAdapter` 默认关闭）和开播前阅读的页面接线已有自动化测试。独立 reader 已有源码和替身测试；四画幅的 2% 记录、真实模型阅读及真实像素呈现耗时仍待完成，见 [前端验证记录](docs/BreakGlass-frontend-validation.md)。开播前阅读的 SC-003、SC-004、SC-005 未通过。
- 005：直角三角形工作台、确定性计算、当前帧校对、受限问答、恢复和理解题已有实现。预设／手工输入与真实识别分别标注；真实模型及样本验收仍待完成，见 [几何验证记录](docs/BreakGlass-geometry-validation.md)。

## 技术路线

- Chrome MV3 未打包扩展。
- Vanilla JavaScript、原生 CSS、原生 SVG。
- 无运行时依赖、无打包器、无 Preact、无 Tailwind、无 Pyodide。
- 扩展本身没有 Node.js 运行时依赖。全仓库检查及独立 reader 需要 Node.js ≥22.9；CI 使用 Node.js 24。测试中的模型调用使用替身，不访问真实供应商。

## 目录

```text
extension/                 MV3 扩展与演示页
tests/                     Node.js 纯函数测试
breakglass-reader/         既有独立阅读服务（不打入扩展包）
scripts/check.mjs          无依赖语法与本地资源检查
.github/workflows/         自动检查配置
specs/001-insitu-parabola/ 功能规格、契约、计划和任务
docs/                      分析与项目专属说明
.specify/                  Spec Kit 工作流配置
```

## 本地运行

扩展方式：

1. 使用 Chrome 打开 `chrome://extensions`，启用开发者模式。
2. 选择“加载已解压的扩展”，选择仓库中的 `extension/` 目录。
3. 点击扩展图标打开扩展内演示页。

网页方式：在 `extension/` 目录启动支持 HTTP Range 的静态服务（例如使用 8765 端口），然后打开演示页。视频定位验收需要 Range 支持；普通不支持 Range 的服务器可能无法跳到第 6 秒。

浏览器访问 `http://127.0.0.1:8765/demo/index.html`。点击「选择预设」加载包内视频，用「显示工具栏」打开操作，定位到第 6 秒再破壁。也可以点击「选择视频」使用自己的文件。预制曲线会明确标注来源，不代表实时识别。不要直接双击 HTML 文件，浏览器会拦住页面读取预制 JSON。

「选择视频」使用浏览器对象地址，不上传整段文件。若填写阅读地址，片子可播放后会发送最多 8 张缩小的 JPEG 帧、源尺寸、时间及课程说明到该地址；已有 reader 按配置调用模型供应商。模型密钥只在 reader 环境中配置，不能放入前端。默认预制路径不上传帧。阅读地址留空、请求失败或 5 分钟内没有通过的点，画面保留在所选片子上，示例片只通过「选择预设」加载。阅读服务的配置见 [reader README](breakglass-reader/README.md)。

在仓库根目录运行测试：

全仓库测试还需要 `ffmpeg` 在当前命令的 PATH 中，用于既有 JPEG 解码和像素定位测试。运行 reader 时 ffmpeg 可选，缺失则使用模型锚点；测试该图像定位分支时必须提供它。CI 已显式安装这个测试依赖。

```bash
node scripts/check.mjs
node --test
```

`check.mjs` 检查语法、HTML 本地资源和静态模块引用；`node --test` 包含页面状态与 reader 模型替身测试。双 rAF 的 `*-frame-ready` 计时与 `*-dom-ready` 分开保存；前者是绘制机会估计，不能替代实际像素呈现、四画幅对齐或真实阅读验收。详见 [本轮优化与验证](docs/BreakGlass-optimization-2026-10-03.md)。

没有视频时抛物线页面提示选择视频或选择预设，不会挂上曲线。本轮网页方式的浏览器验证见验收记录，Chrome 扩展内的完整验收仍待完成；识别任意视频仍不在当前范围。

## 直角三角形工作台

打开 `http://127.0.0.1:8765/demo/geometry.html`，也可从抛物线演示页点击入口。点击“使用 3–4–5 预设”或“手工填写条件”，校对并确认后即可修改 AB 或 AC、恢复原题、回答理解题。一次只改一条直角边；BC 始终由 `Math.hypot` 计算。

提问默认使用明确标注的本地受限指令，例如“把 AB 改成 6，AC 不变，BC 是多少？”、“现在 BC 是多少”、“解释变化”、“恢复原题”。本地模式不调用 AI；复杂或不支持的要求会拒绝，保留有效场景。

使用模型时先按 [reader 配置](breakglass-reader/README.md) 启动服务，填写 `http://127.0.0.1:8787`。选择本地几何视频、暂停并点击“识别当前暂停帧”才向 `/geometry/read` 发送这一张 JPEG；候选须校对确认。“本地 reader 模型”问答调用 `/geometry/ask`，只发送已确认场景和问题。未配置模型返回明确错误，不自动改成预设。识别 30s／问答 10s 为待真实测试冻结的开发默认。

画板按题目条件重建，原帧像素只用于定位。修改后的图不代表与视频仍一比一重合；返回按钮回到同一视频的原暂停时间继续播放。完整验收与未通过项目见 [005 验收步骤](specs/005-insitu-right-triangle/quickstart.md) 和 [验证记录](docs/BreakGlass-geometry-validation.md)。

## 项目展示网站

`yanghan2026-patch-1` 分支原来的根文件 [展示网站](展示网站) 已融合品牌演示：2.2 秒 Logo 入场、自绘字标、黑白青配色，以及“观看 / 亲手验证”的抛物线对照。八节介绍、章节导航和架构详情保留。

开场先让图标在屏幕中心完成描画与破壁，再展开字标、移回首页位置，最后显现标题、说明与按钮；“重播入场”可重复这一顺序。`breakglass-apple.zip` 的背景光点、网格边缘光、滚动渐显、导航邻近反馈和演示区扫描/描画/节点微光已按区域融合。抛物线首次进入演示区自动变化一轮，可暂停/继续；手动调参和重置立即接管，离开演示区或隐藏标签页后停止，减少动态效果偏好下保持手动操作。

顶部导航与左侧章节导航在 Logo 开始上移时才出现，各个章节入口依次弹性渐显，相邻入口错峰 45ms。章节正文入场只播放一次：返回已看过的位置直接显示，首次进入未看过的内容才播放浮现。

Safari 使用媒体查询新旧监听接口的能力检测；旧环境的导航位移回退到 `transform`。系统启用“减少动态效果”时，页面直接呈现完成状态并保留手动调参。GitHub 分支/源码页面不是网站运行入口；手机观看需打开已发布的 HTTP(S) 网页地址，文件预览不能代表浏览器动效效果。

入场和重播期间锁定页面滚动，Logo 描画结束后继续等待上移、文字及导航渐显完成，再恢复滚轮、触摸、键盘和章节跳转；保留浏览器缩放。直接打开其他章节的有效锚点时跳过首页入场，避免改变原来的阅读位置。切后台、离开页面或开启减少动态偏好都会释放锁定。

展示页使用 CSP 脚本哈希白名单、禁止不需要的网络连接/内嵌页面/插件/表单提交，并采用 `no-referrer`。架构文案以文本节点和明确的强调元素渲染，不解析内容中的 HTML。动态样式为保留 SVG 与动效仍允许内联样式；这些基础防护只覆盖展示页，不代表扩展演示、外部接口或服务器安全审计。修改后需重新构建，同步脚本哈希。

- [展示网站.html](展示网站.html) 是同内容的标准网页入口；下载后可直接用浏览器打开品牌与曲线示意。
- 根 `index.html` 是 GitHub Pages 首页，和两个展示入口内联同样的样式、脚本和 SVG，无需 CDN 或远程接口。页面中的视频破壁入口仍需在完整仓库的 HTTP 静态服务下使用。
- 维护源文件位于 `site/showcase.html`、`site/showcase*.css/js` 和 `site/assets/breakglass-brand/`；修改后运行 `node scripts/build-showcase.mjs` 同步根入口，再执行 `node scripts/check.mjs`。

展示页的曲线来自本地数学函数，并明确标记预制来源；视觉识别与 Python/Pyodide 仍按 [Constitution](docs/BreakGlass-constitution.md) 的 P1 边界记录为规划，网页动效不代表产品链路验收。

## 文档入口

- [项目约定](AGENTS.md)
- [前后端职责边界](docs/frontend-backend-boundary.md)
- [前端任务与执行流程](docs/frontend-task-tracker.md)
- [BreakGlass Constitution](docs/BreakGlass-constitution.md)
- [OpenMAIC 学习笔记](docs/BreakGlass-openmaic-learning.md)
- [最新功能规格](specs/001-insitu-parabola/spec.md)
- [实施计划](specs/001-insitu-parabola/plan.md)
- [任务清单](specs/001-insitu-parabola/tasks.md)
- [快速验收](specs/001-insitu-parabola/quickstart.md)
- [开播前阅读](specs/003-preplay-lesson-points/spec.md)
- [更多图形与旁边提问（004 规格）](specs/004-figures-and-tutor/spec.md)
- [四种图形与提问接口交接（故事 1）](specs/004-figures-and-tutor/geometry-handoff.md)
- [当前帧直角三角形学习闭环（005）](specs/005-insitu-right-triangle/spec.md)
- [005 实施计划](specs/005-insitu-right-triangle/plan.md)
- [005 任务清单](specs/005-insitu-right-triangle/tasks.md)
- [005 场景与动作契约](specs/005-insitu-right-triangle/contracts/scene-actions.md)
- [005 验收步骤](specs/005-insitu-right-triangle/quickstart.md)
- [视觉规范](docs/BreakGlass-visual-spec.md)
- [工作台视觉对齐与验证（2026-10-03）](docs/BreakGlass-ui-alignment-2026-10-03.md)
- [UI 设计建议](docs/BreakGlass-ui-design-guide.md)
- [UI 现状清单](docs/BreakGlass-ui-inventory.md)
- [UI 待实现清单](docs/BreakGlass-ui-todo.md)
