# BreakGlass（破壁）

> 010开发交付（2026-10-07）：用户指定 `extension/demo/index.html` 为统一主工作台，现已将既有视频/数学/分析/账号/学习记录与两微课、用途/帮助、新题作答、复练队列和实时实线图像接在同一页。[研究融合与竞争评估](docs/BreakGlass-evidence-learning-plan-2026-10-07.md)、[主工作台UI](docs/BreakGlass-demo-workspace-ui-plan-2026-10-07.md)、[任务清单](specs/010-evidence-guided-learning/tasks.md)记录实现顺序。两份宪法同步2.6.2实施记录；[运行说明](specs/010-evidence-guided-learning/quickstart.md)使用8765同源前门与4174唯一学习服务。真实模型、平台/地区发布、教师与学生效果独立待验；006–009旧验收保留。

> 009最新交付（2026-10-07，治理2.5.0）：本机/账户备注和原因标签修订、20片段渐进分析与私有缓存、五种新增手工数学及粒子/基础诊断、可配置登记短音轨ASR、严格发布检查与试点运行准备。功能/入口见[009规划](docs/BreakGlass-learning-completion-2026-10-07.md)，完成项见[任务](specs/009-learning-completion/tasks.md)，实际范围见[验证记录](docs/BreakGlass-validation-learning-completion-2026-10-07.md)。真实AI/ASR质量、B站许可、正式托管/地区发布和真实学生效果仍须独立证据；不会以测试替身标为通过。

> 008阶段交付（历史基线）：本机插件账号配对与记录/观看同步、短片段稀疏画面＋登记作者字幕、两模板深度复练。治理2.4.0，范围/进度见[008规划](docs/BreakGlass-connected-learning-2026-10-06.md)及[任务](specs/008-connected-learning/tasks.md)。模型留空可配置，B站处理许可、真实AI、公网跨设备和正式地区发布仍待验。


> 2026-10-06 初始文档规划（历史基线）：两份 Constitution 2.1.0 明确插件优先，同时保留网站用户视频导入识别与账号学习记录两种入口。功能、阶段与当前实现边界见 [产品规划](docs/BreakGlass-immersive-learning-plan-2026-10-06.md)，逐界面功能与状态验收见 [UI 规划](docs/BreakGlass-ui-plan-2026-10-06.md)。中国大陆及海外的素材权利、儿童数据、跨境、AI 标识与撤权删除按原则 XII 和 [风险方案](docs/BreakGlass-rights-and-risk-plan-2026-10-06.md) 执行。本次只交付文档；第三方网课注入、新网站上传工作台、账号与云端记录尚未实现，旧接口/预算/验收保持独立。

BreakGlass 是一个 Chrome MV3 扩展原型：把已验证演示视频中的数学抛物线变成可调节的原位 SVG 交互层，并提供独立的当前帧直角三角形学习工作台。

当前交付基线是一个离线可演示的数学抛物线 P0 vertical slice。用户在扩展内演示页播放、暂停并定位视频，在目标时间唤醒预先准备的曲线，拖动参数、重置或退出。预制结果始终标明来源，不伪装成实时识别。

## 当前范围

- P0：单个录屏或固定机位数学抛物线场景。
- P1：真实视觉识别、Python/Pyodide 和其他扩展能力，必须单独立项和验收。
- 初始基线没有第三方网站注入、用户账号或云端记录；006已有固定受控站注入，007新增本机开发网站/身份/学习记录，当前完成范围见下方007说明。新规划以支持网站的插件为主入口，网站保留用户视频导入识别，并承接账号/观看记录/个人错题复练；这些是待实施能力。网站首版默认在浏览器解码原文件，确认后发送获准稀疏材料；未来整文件临时模式按原则 XIII 独立冻结，不复用旧 reader。任意网站保证、永久原视频云盘和云端代码执行不在范围。
- 9 秒演示片已在仓库里。预制区域按这支片子第 6 秒的画面写。这一帧的手工读数见验证记录，不能当成 2% 对齐已经通过，也不能代替四画幅验收。
- 开播前阅读在片子可播放且已填写阅读地址时自动开始。验收片子不得使用 `breakglass-demo-9s.mp4`；失败、断网、地址留空或 5 分钟内一处都没通过时，画面保留用户选中的片子并丢弃无效结果。示例片只在点击「选择预设」时加载。已有独立阅读服务源码在 `breakglass-reader/`，不进入扩展包，也不部署为云端后台；未配置服务和模型时，页面不会从画面里找出抛物线。
- 当前帧曲线增强：自己的视频可在任意有效暂停时刻点击「破壁」。有匹配的已校验缓存时直接打开；没有时向已有本地 `/read` 发送这一帧请求识别。首版仍只支持清晰完整抛物线，30s 为待真实预跑冻结的独立开发默认，不改 300s 预读或 1500ms 唤醒。方案与未验证范围见 [当前帧曲线计划](docs/BreakGlass-current-frame-plan-2026-10-03.md)，不以入口或替身测试宣称任意视频识别已验收。
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

## 学习管理网站（007）

按介绍站 showcase 的暗色品牌视觉实现 `learning-site/`：当前账号概览、观看位置、疑问与个人易错记录、备注/错因修订、实际作答复练、七种结构数学模板与实线空间视角、知识关系诊断、数据导出/删除及本地视频工作台。账号由独立本机开发服务真实保存；008已支持显式配对的未来插件记录/观看同步，旧记录仍需审核选择，JSON导入保留。尚未发布公网跨设备服务。当前治理为2.6.2，007–009分别记录阶段任务和外部待验收项。

在仓库根目录启动：

```powershell
node --env-file-if-exists=breakglass-reader/.env scripts/learning-site.mjs
```

打开 [本机学习管理中心](http://localhost:4174/learning-site/index.html)。模型地址、名称和密钥可以留空，之后只在服务端环境配置；留空时可预览、手工探索、保存和复练，AI明确显示未配置。原文件不上传；仅匹配完整指纹的自制登记素材可显式分析稀疏画面。其他文件可保存私人观看位置并探索学生自己的通用数学条件。账户数据默认在操作系统临时目录的 `breakglass-learning-development`，可通过 `BREAKGLASS_LEARNING_DATA_DIR` 指定仓库外目录；密码使用随机salt/scrypt，会话重启后须重新登录。此服务只用于本机开发，正式地区、监护、跨境和平台发布另行验收。

[管理网站UI规划](docs/BreakGlass-learning-management-ui-2026-10-06.md) · [学习服务说明](breakglass-learning/README.md) · [007契约](specs/007-learning-site-and-particles/contracts/learning-site.md)

## 本地运行

本轮主工作台从仓库根目录启动，分别在两个终端运行：

```powershell
node scripts/learning-site.mjs
```

```powershell
node scripts/demo-workspace.mjs
```

打开 [统一工作台](http://localhost:8765/extension/demo/index.html)。8765是有界同源前门，4174是唯一学习服务；已有进程时先核对端口，不能重复启动。模型留空时可使用预设、手工数学、实线互动、账号、记录与复练。完整配置、来源许可和操作路径见 [010运行说明](specs/010-evidence-guided-learning/quickstart.md)。

“选择视频”只在浏览器本地解码，不上传原文件。AI分析只对完整指纹已登记的素材显式启用；持续视觉、片段、渐进和可选登记音轨各自保留限额。旧reader使用固定同源映射和独立8787进程；共享视频不会因填地址或载入就自动预读，需当前许可允许并明确开启。B站处理许可待确认，真实模型效果仍单独验收。

旧扩展内入口仍可用：Chrome开发者模式加载`extension/`，点击扩展图标。扩展内或远程静态demo保持原独立场景；同页账户工作台只在上述本机前门挂载。旧独立页的实际路径、reader用法和历史验收分别见 [001](specs/001-insitu-parabola/quickstart.md)、[003](specs/003-preplay-lesson-points/quickstart.md)及 [005](specs/005-insitu-right-triangle/quickstart.md)，不能把旧纯静态`/demo/`地址当作新8765入口。

在仓库根目录运行测试：

全仓库测试还需要 `ffmpeg` 在当前命令的 PATH 中，用于既有 JPEG 解码和像素定位测试。运行 reader 时 ffmpeg 可选，缺失则使用模型锚点；测试该图像定位分支时必须提供它。CI 已显式安装这个测试依赖。

```bash
node scripts/check.mjs
node --test
```

`check.mjs` 检查语法、HTML 本地资源和静态模块引用；`node --test` 包含页面状态与 reader 模型替身测试。双 rAF 的 `*-frame-ready` 计时与 `*-dom-ready` 分开保存；前者是绘制机会估计，不能替代实际像素呈现、四画幅对齐或真实阅读验收。详见 [本轮优化与验证](docs/BreakGlass-optimization-2026-10-03.md)。

没有视频时抛物线页面提示选择视频或选择预设，不会挂上曲线。既有网页方式的浏览器验证见验收记录，Chrome 扩展内的完整验收仍待完成；当前帧增强允许选择任意暂停时刻请求抛物线，识别任意视频或任意曲线的成功承诺仍不在范围。

## 直角三角形工作台

在 [统一工作台](http://localhost:8765/extension/demo/index.html) 选择“几何实验”；旧独立页面位于`extension/demo/geometry.html`。点击“使用 3–4–5 预设”或“手工填写条件”，校对并确认后即可修改 AB 或 AC、恢复原题、回答理解题。一次只改一条直角边；BC 始终由 `Math.hypot` 计算。

提问默认使用明确标注的本地受限指令，例如“把 AB 改成 6，AC 不变，BC 是多少？”、“现在 BC 是多少”、“解释变化”、“恢复原题”。本地模式不调用 AI；复杂或不支持的要求会拒绝，保留有效场景。

使用旧reader模型时按 [reader 配置](breakglass-reader/README.md) 启动8787服务；主工作台采用同源固定reader映射，当前素材许可允许并显式启用后才调用。旧独立几何页可填写`http://127.0.0.1:8787`。选择本地几何视频、暂停并点击“识别当前暂停帧”才向 `/geometry/read` 发送这一张 JPEG；候选须校对确认。“本地 reader 模型”问答调用 `/geometry/ask`，只发送已确认场景和问题。未配置模型返回明确错误，不自动改成预设。识别 30s／问答 10s 为待真实测试冻结的开发默认。

画板按题目条件重建，原帧像素只用于定位。修改后的图不代表与视频仍一比一重合；返回按钮回到同一视频的原暂停时间继续播放。完整验收与未通过项目见 [005 验收步骤](specs/005-insitu-right-triangle/quickstart.md) 和 [验证记录](docs/BreakGlass-geometry-validation.md)。

本次增补为几何工作台补齐12组通用能力：工具栏/快捷键/全屏、定位与阶段提示、识别和问答重试取消、独立reader地址会话记忆、单边滑块、示例草稿与有限记录、视频/新帧门禁及焦点反馈。实施和本次结果见 [功能对齐矩阵与验证记录](docs/BreakGlass-geometry-parity-2026-10-03.md)，新增功能已完成实现及受测网页验证。Alt+B只在本机暂停保存帧，识别仍需点击；地址记忆和示例不自动上传。005原任务的19/25及真实模型、完整扩展/像素验收保持独立，不能把新增控件或旧测试报告当作本次通过。

几何工作台另增三段自制教学示例：3–4–5、5–12–13、8–15–17，题面与对应预设均使用cm，经检查均为12秒、1280×720、H.264无声MP4。外部开放许可视频检索本次连接失败，因此采用自制素材，未声称找到了外部视频。“加载示例”定位第4秒并保持暂停，不自动播放、捕获或识别；仅在当前对应示例已暂停且第2秒至第8秒之前的题面上，才可显式“载入对应示例条件”，随后仍需校对确认，来源为预设。选择自己的文件后恢复通用3–4–5的单位长度预设，真实reader识别仍须单独点击。文件与来源见 [视频素材说明](extension/assets/video/README.md)，本次操作步骤见 [005 quickstart §9](specs/005-insitu-right-triangle/quickstart.md#9-2026-10-03-自制几何示例视频增补)。

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

展示页的曲线来自本地数学函数，并明确标记预制来源。展示页不接入视觉识别或 Python/Pyodide；相关能力按 [Constitution](docs/BreakGlass-constitution.md) 的 P1 边界独立实施和验收，网页动效不代表产品链路验收。

## 文档入口

- [插件沉浸学习产品规划（2026-10-06）](docs/BreakGlass-immersive-learning-plan-2026-10-06.md)
- [插件与学习网站 UI 规划（2026-10-06）](docs/BreakGlass-ui-plan-2026-10-06.md)
- [素材权利、版权与地区风险方案（2026-10-06）](docs/BreakGlass-rights-and-risk-plan-2026-10-06.md)
- [项目约定](AGENTS.md)
- [前后端职责边界](docs/frontend-backend-boundary.md)
- [前端任务与执行流程](docs/frontend-task-tracker.md)
- [BreakGlass Constitution](docs/BreakGlass-constitution.md)
- [Spec Constitution（治理源）](.specify/memory/constitution.md)
- [后续发展策略与技术改造方案（候选方向与准入）](docs/BREAKGLASS-next-strategy.md)
- [OpenMAIC 学习笔记](docs/BreakGlass-openmaic-learning.md)
- [最新功能规格](specs/001-insitu-parabola/spec.md)
- [实施计划](specs/001-insitu-parabola/plan.md)
- [任务清单](specs/001-insitu-parabola/tasks.md)
- [快速验收](specs/001-insitu-parabola/quickstart.md)
- [开播前阅读](specs/003-preplay-lesson-points/spec.md)
- [当前帧曲线按需识别：需求、契约与验收计划（2026-10-03）](docs/BreakGlass-current-frame-plan-2026-10-03.md)
- [更多图形与旁边提问（004 规格）](specs/004-figures-and-tutor/spec.md)
- [四种图形与提问接口交接（故事 1）](specs/004-figures-and-tutor/geometry-handoff.md)
- [当前帧直角三角形学习闭环（005）](specs/005-insitu-right-triangle/spec.md)
- [005 实施计划](specs/005-insitu-right-triangle/plan.md)
- [005 任务清单](specs/005-insitu-right-triangle/tasks.md)
- [005 场景与动作契约](specs/005-insitu-right-triangle/contracts/scene-actions.md)
- [005 验收步骤](specs/005-insitu-right-triangle/quickstart.md)
- [几何工作台功能对齐矩阵与验证（2026-10-03）](docs/BreakGlass-geometry-parity-2026-10-03.md)
- [视觉规范](docs/BreakGlass-visual-spec.md)
- [工作台视觉对齐与验证（2026-10-03）](docs/BreakGlass-ui-alignment-2026-10-03.md)
- [仓库详细测试报告（2026-10-03，626 项及修复记录）](docs/BreakGlass-repository-test-report-2026-10-03.md)
- [历史全仓库测试报告（2026-10-03，556 项）](docs/BreakGlass-test-report-2026-10-03.md)
- [UI 设计建议](docs/BreakGlass-ui-design-guide.md)
- [UI 现状清单](docs/BreakGlass-ui-inventory.md)
- [UI 待实现清单](docs/BreakGlass-ui-todo.md)

## 006 持续视觉首切片（2026-10-06）

已按用户要求开始实现插件持续视觉识别和后台滚动总结，治理2.2.0；实际状态见 [006任务](specs/006-plugin-learning-layer/tasks.md) / [验证记录](docs/BreakGlass-continuous-vision-validation-2026-10-06.md)。主路不依赖作者层或平台业务API；B站处理许可待确认，当前仅受控自制素材试验。问题及解决办法、视觉与视频读取的组合增强见 [持续视觉规划](docs/BreakGlass-continuous-vision-plan-2026-10-06.md)。

开发：从仓库根运行 `node scripts/learning-lab.mjs`，加载 `extension/` 为解压MV3扩展；配置本机 `breakglass-reader/.env` 后启动reader。打开 `http://localhost:4173/learning-lab/lesson.html`、等视频就绪，点击插件图标，再显式开始持续识别。单帧/摘要使用新 `/learning/read` / `/learning/summarize`；密钥仅在reader。新UI仅本机访客记录，无真实账号/跨设备/完整音频/整课保证；网站文件入口和粒子另阶段验证。没有模型配置会诚实显示失败。


## 网站与插件账号连接（007/008）

从仓库根运行 `node --env-file-if-exists=breakglass-reader/.env scripts/learning-site.mjs`，打开 `http://localhost:4174/learning-site/index.html`。数据默认在仓库外临时开发目录，可用`BREAKGLASS_LEARNING_DATA_DIR`指定仓库外绝对目录。账户密码经scrypt保存，cookie会话和插件配对只供本机开发；服务重启后重新登录/配对。

在网站账户设置登录并生成一次码，打开扩展的插件记录页进行配对，按需开启未来同步；旧本机记录另行勾选导入。断网记录先留本机，在插件页面明确重试；网站撤销/退出/切号和删除epoch会阻断旧连接。清除本机不会删除账户内容。

视频工作台可显式选择≤30秒片段，默认抽4帧，并按登记选择作者字幕；没有音轨或整文件上传。候选需校对，已存条件可预测、逐级提示、独立变式与真实作答。模型未配置仍可预览、手工探索、观看记录和复练。

可选模型实测工具为 `scripts/evaluate-learning-model.mjs`，默认不调用供应商；将来配置后显式加`--run-model`并指定仓库外`--output`路径。当前not-run不代表真实AI通过。实际集成脚本`verify-connected-learning.mjs`模型是明确替身，独占4173/4174/8787并使用临时测试账户。

后续视觉决定（2026-10-07，2.6.2）：用户将粒子改为连续实线。实时参数/公式/二维图与空间线框同步，函数仍在二维数学平面，几何按已注册边连接，保留相机与回退；内部particle模块名仅用于兼容，不改变数学/来源/账号/模型/预算与外部验收边界。
