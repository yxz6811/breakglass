# BreakGlass 仓库详细测试报告

日期：2026-10-03，Asia/Shanghai。修复后测试对象：`123456` 的源码提交 [`42c33fd78e2ca4824faed0d1e3194879673876dc`](https://github.com/yxz6811/breakglass/commit/42c33fd78e2ca4824faed0d1e3194879673876dc)。修复前基线为 [`08e84da67e7d2315c0045c54abcb18e300d19838`](https://github.com/yxz6811/breakglass/commit/08e84da67e7d2315c0045c54abcb18e300d19838)，两轮证据分别保存。

仓库审查发现的 **1 个几何页生命周期缺陷和 2 类文档漂移已修复**。新增 5 项正式回归在旧实现上失败、修复后通过；定向测试 **47/47**、修复后全仓库 **626/626** 通过，失败、取消、跳过和待办均为 0。122 个 JS/MJS 文件、216 处本地引用及内联脚本检查通过。修复前的隔离构建、三段几何视频完整解码和受测网页流程也保留证据。真实浏览器 BFCache 命中未验证，自动化通过不能解读为完整产品验收通过。

报告依据 [项目约定](../AGENTS.md)、[产品 Constitution 1.7.1](BreakGlass-constitution.md) 与 [Spec Constitution 1.9.1](../.specify/memory/constitution.md)。修改仅涉及几何页生命周期、相关回归测试、3 份规格文档和本报告入口；介绍站及其生成入口未改。旧报告保留自己的提交和运行结果。

## 1. 检查范围与环境

| 项目 | 本次实际记录 |
| --- | --- |
| 工作目录 | `D:\前端\breakglass-geometry-plan` |
| 本地分支 / 远端目标 | `codex/right-triangle-plan` / `origin/123456` |
| 修复前基线 | `08e84da67e7d2315c0045c54abcb18e300d19838`；最初检查前工作树干净，与远端 `123456` 一致 |
| 修复后源码 | `42c33fd78e2ca4824faed0d1e3194879673876dc`；全量重跑时仅报告、README 入口和证据尚未提交，产品及测试源码已提交 |
| 查询时的主分支 | `7e04c30fe4ff19745f4e3a811a5b1967282668ad`；未合入本轮 `123456` 测试对象 |
| 系统 / Node | Windows NT 10.0.26200，PowerShell；Node v24.21.0 |
| 测试工具 | Node 内置 test runner；63 个测试文件，其中根 `tests/` 56 个、reader 7 个 |
| FFmpeg | 已有 7.1 essentials；只加入测试进程 PATH，未安装依赖或修改系统 PATH |
| 浏览器 | Codex In-app Browser；本次未可靠取得内核版本，不能替代确定版本 Chrome 的 MV3 验收 |
| 页面与视口 | HTTP 网页；1280×720、390×844，属于桌面浏览器视口模拟 |
| 识别 / 提问来源 | 预设、手工和本地确定性指令；自动化中的供应商使用替身，未调用真实模型 |

原始环境和文件清单见 [运行上下文](test-evidence/repository-audit-2026-10-03/run-context.json)、[仓库清单](test-evidence/repository-audit-2026-10-03/repository-inventory.json)；清单中的 README 哈希属于更新报告入口前的快照。修复后环境见 [上下文](test-evidence/repository-audit-2026-10-03/post-fix/run-context.json)。预览复用既有 8765 扩展静态服务和 8776 仓库根服务，未新增或停止服务进程，见 [预览上下文](test-evidence/repository-audit-2026-10-03/preview-context.json)。

## 2. 仓库实现与测试对应关系

当前采用 Vanilla JS、原生 CSS/SVG，扩展没有运行时依赖。独立 `breakglass-reader/` 使用 Node 内置 HTTP 与原生 fetch；模型密钥属于本地服务环境，不进入扩展包。仓库没有 Pyodide、代码执行沙盒或通用网站注入实现。

| 模块 | 阅读到的实际行为 | 对应代码 / 代表测试 |
| --- | --- | --- |
| MV3 入口 | 扩展图标打开包内曲线演示；权限和 host permissions 为空，无 content script | [manifest](../extension/manifest.json)、[service worker](../extension/src/background/service-worker.js)、[page-integration](../tests/page-integration.test.js) |
| 曲线契约与会话 | 校验视频、请求、秒级时间、帧尺寸、有限参数；管理等待、交互、重置、退出和迟到结果 | [curve/validate](../extension/src/curve/validate.js)、[session](../extension/src/session/session.js)、[validate 测试](../tests/validate.test.js)、[session 测试](../tests/session.test.js) |
| 唤醒和保底 | 默认使用匹配的预制结果；1500ms 保底、取消和无缓存错误；`hang/invalid/late` 是演练替身 | [wake](../extension/src/session/wake.js)、[config](../extension/assets/config.json)、[wake-timeout](../tests/wake-timeout.test.js)、[wake-contract](../tests/wake-contract.test.js) |
| 视觉夹具 | `visionAdapter: fixture` 读取包内 JSON，标记 `packaged-sample`；默认关闭 | [视觉素材说明](../extension/assets/vision/README.md)、[vision-wake](../tests/vision-wake.test.js)、[vision-reject](../tests/vision-reject.test.js) |
| 坐标与计时 | 区分源像素、数学坐标和页面坐标；处理内容矩形、黑边和窗口变化；DOM 与双 rAF 计时分开 | [content-rect](../extension/src/geometry/content-rect.js)、[alignment](../extension/src/geometry/alignment.js)、[坐标测试](../tests/content-rect.test.js)、[latency](../tests/latency.test.js) |
| 003 开播前阅读 | 最多 8 张稀疏 JPEG 和课程文字；5 分钟预算、通过点缓存、下一点及失败保留用户视频 | [page/main](../extension/src/page/main.js)、[lesson/ask](../extension/src/lesson/ask.js)、[page-lesson](../tests/page-lesson.test.js)、[lesson-reading](../tests/lesson-reading.test.js) |
| 004 图形与本地导师 | 抛物线、直线、圆、正弦；规则解析修改参数、查询数值并使用实际计算结果回答，不调用 AI | [geometry/figures](../extension/src/geometry/figures.js)、[tutor/ask](../extension/src/tutor/ask.js)、[figures](../tests/figures.test.js)、[tutor-ask](../tests/tutor-ask.test.js) |
| 005 几何工作台 | 当前帧保存、条件校对与确认、单边修改、`Math.hypot` 求 BC、原题快照、恢复、理解题和返回视频 | [page/geometry](../extension/src/page/geometry.js)、[geometry-session](../extension/src/geometry-session/session.js)、[page-geometry](../tests/page-geometry.test.js)、[geometry-parity](../tests/geometry-parity.test.js) |
| reader HTTP 与模型边界 | `/read`、`/geometry/read`、`/geometry/ask`；来源、载荷、字段、坐标映射、独立截止、取消和动作白名单 | [reader/server](../breakglass-reader/src/server.mjs)、[geometry-scene](../breakglass-reader/src/geometry-scene.mjs)、[geometry-actions](../breakglass-reader/src/geometry-actions.mjs)、[server 测试](../breakglass-reader/tests/server.test.mjs)、[geometry-read](../breakglass-reader/tests/geometry-read.test.mjs)、[geometry-ask](../breakglass-reader/tests/geometry-ask.test.mjs) |
| 介绍站与展示入口 | 原有 site 页面；独立 showcase 入场、滚动锁、架构弹窗、本地曲线示意及 CSP 哈希；根三入口由脚本生成 | [site](../site/index.html)、[showcase](../site/showcase.html)、[构建脚本](../scripts/build-showcase.mjs)、[site-ui](../tests/site-ui.test.js)、[showcase-security](../tests/showcase-security.test.js)、[showcase-scroll-lock](../tests/showcase-scroll-lock.test.js) |

页面用例运行真实页面脚本，但 DOM、视频、布局、时钟和请求通常由 [fake-page](../tests/helpers/fake-page.js) 或 [fake-geometry-page](../tests/helpers/fake-geometry-page.js) 提供。部分阅读测试直接提供帧，不能证明浏览器真实抽帧或模型理解。reader 测试含实际本机 HTTP 和 FFmpeg JPEG 解码，但上游模型是替身。静态权限和无障碍断言不能替代真实扩展、读屏或视觉检查。

## 3. 修复前基线运行结果

| 检查 | 北京时间 | 实际结果 | 进程耗时 / 证据 |
| --- | --- | --- | --- |
| 全仓库 Node 测试 | 18:34:51—18:34:57 | 621 通过；0 失败 / 取消 / 跳过 / todo；1 suite；退出 0 | 6.291 秒；[TAP 日志](test-evidence/repository-audit-2026-10-03/node-test.log)、[元数据](test-evidence/repository-audit-2026-10-03/node-test.json) |
| 语法和本地引用 | 18:34:51—18:35:04 | 122 个 JS/MJS、216 处本地引用及内联脚本通过；退出 0 | 12.861 秒；[日志](test-evidence/repository-audit-2026-10-03/static-check.log)、[元数据](test-evidence/repository-audit-2026-10-03/static-check.json) |
| showcase 隔离构建 | 18:39:30—18:39:31 | 退出 0；三个生成入口彼此逐字节相同；与工作区 HTML 换行归一后相同 | 1.005 秒；[构建证据](test-evidence/repository-audit-2026-10-03/showcase-build.json)、[stdout](test-evidence/repository-audit-2026-10-03/showcase-build.stdout.log) |
| 几何视频解码 | 18:39:33—18:39:35 | 三片格式符合说明，逐片严格完整解码退出 0，各 360 帧 / 12 秒 | [媒体元数据、命令和 SHA256](test-evidence/repository-audit-2026-10-03/geometry-media.json) |
| HTTP 文件身份 | 18:39:32 记录 | 扩展两页和两份页面 JS、根 index 与 site/index，共 6/6 与工作区字节一致 | [SHA256 记录](test-evidence/repository-audit-2026-10-03/http-source-sha256.json) |
| 视频 Range | 18:36:49 | `bytes=0-1` 返回 206、`Content-Range: bytes 0-1/151733`、2 字节 | [响应记录](test-evidence/repository-audit-2026-10-03/http-range.json) |
| 定向生命周期诊断 | 18:38:43—18:38:44 | **缺陷复现**；命令退出 0 表示复现脚本的诊断断言成立 | [脚本](test-evidence/repository-audit-2026-10-03/bfcache-reproduction.cjs)、[输出](test-evidence/repository-audit-2026-10-03/bfcache-reproduction.log)、[元数据](test-evidence/repository-audit-2026-10-03/bfcache-reproduction.json) |

TAP 自身总耗时为 6072.7358 ms；表中进程耗时含启动和日志收集。它们都不是用户操作、像素呈现或模型延迟指标。TAP 顶层计划为 `1..617`，含子测试后的 runner 汇总为 `# tests 621`，统计采用汇总值。生命周期诊断单独记录，贡献正式通过数为 0。

静态脚本不检查 CSS 渲染、Markdown 链接、Python 或媒体解码；README 的本地链接另经文件存在检查。隔离构建只在 TEMP 副本运行，没有重写介绍站。生成文件各 157334 字节，Windows 工作区各 157352 字节，18 处 LF/CRLF 差异造成 18 字节差；换行归一 SHA256 全一致。不能将此结果写成工作区逐字节可复现。

三段视频均为本项目自制无声教学示例，12 秒、1280×720、30fps、H.264 High、yuv420p。由于本机没有 ffprobe，本次没有执行 ffprobe；元信息使用已有 FFmpeg 输入头输出，完整解码另用严格错误检查，原始 stdout/stderr 均保留。未运行视频生成脚本或覆盖素材。

### 3.1 修复后重跑

| 检查 | 北京时间 | 实际结果 | 进程耗时 / 证据 |
| --- | --- | --- | --- |
| 几何定向回归 | 18:59:53—18:59:54 | 47/47 通过；退出 0；含新增 5 项缓存生命周期回归 | 1.484 秒；[日志](test-evidence/repository-audit-2026-10-03/post-fix/geometry-regression-after.log)、[元数据](test-evidence/repository-audit-2026-10-03/post-fix/geometry-regression-after.json) |
| 全仓库 Node 测试 | 19:00:24—19:00:35 | 626/626 通过；0 失败 / 取消 / 跳过 / todo；退出 0 | 11.253 秒；[TAP](test-evidence/repository-audit-2026-10-03/post-fix/node-test.log)、[元数据](test-evidence/repository-audit-2026-10-03/post-fix/node-test.json) |
| 语法和本地引用 | 19:00:24—19:00:43 | 122 个 JS/MJS、216 处本地引用及内联脚本通过；退出 0 | 19.354 秒；[日志](test-evidence/repository-audit-2026-10-03/post-fix/static-check.log)、[元数据](test-evidence/repository-audit-2026-10-03/post-fix/static-check.json) |

定向绿色结果在源码提交前取得，元数据保存了几何源码及测试文件 SHA256；全量结果绑定源码提交 `42c33fd`。修复后 TAP 顶层计划 `1..622`，含子测试汇总为 `# tests 626`，runner 耗时 10842.4899 ms。定向 47 项是全量中的子集，不能与 626 相加。旧缺陷诊断退出 0 和新增用例的修复前失败属于定位证据，不计入绿色结果。修复前正式回归未单独记录精确起止时间，见 [元数据](test-evidence/repository-audit-2026-10-03/post-fix/before.json)，不补造时间。

构建和媒体文件未修改，隔离构建及严格解码沿用第 3 节的实际结果，没有将它们描述为修复后再次执行。修复后 HTTP 文件身份另外核验，见 [SHA256 记录](test-evidence/repository-audit-2026-10-03/post-fix/http-source-sha256.json)。

## 4. 浏览器实际操作

本轮网页检查为北京时间 18:37—18:46，使用新建测试页，未清空用户已有页面状态。原始观察见 [browser-checks.json](test-evidence/repository-audit-2026-10-03/browser-checks.json)，以下分组均有实际操作记录。

| 流程 | 实际操作和结果 | 观察编号 |
| --- | --- | --- |
| 几何加载与确认门禁 | 初始无视频，播放/截帧/识别禁用；加载 3–4–5 后暂停第 4 秒且不自动产生候选；未勾核对拒绝确认，核对后 BC=5cm | G01—G03 |
| 改边、非法值与恢复 | AB 3→6，AC 保持 4，BC=7.211；AB=0 被拒绝，保留有效结果；恢复 3/4/5 并清除字段错误 | G04—G06 |
| 草稿、提问和理解题 | 示例只填草稿；显式提交才执行；回答取画板计算结果；理解题正确显示 AC 和直角不变 | G06—G07 |
| 定位与 reader 错误 | 100 秒超时长被拒绝，视频仍第 4 秒；18999 闭端口连接失败保留条件及视频，重试可用；忘记地址后为空 | G08—G10 |
| 题面时间和换场景 | 定位第 9 秒清空旧场景，2≤t<8 的对应预设入口禁用；5–12–13 与 8–15–17 显式校对后分别 BC=13/17cm | G10—G12 |
| 几何键盘和返回 | 390px 下滑块 ArrowRight 将 AB 8→8.14，AC=15，BC=17.066；问题框 Esc 只清草稿；返回后观察到从第 4 秒继续播放 | G13—G15 |
| 曲线演示 | 选择预设→定位第 6 秒→破壁，来源写明预先准备；导师改 k=−1；切圆并改 r=2；直线/正弦可切换；恢复 a=1/h=0/k=1；退出移除交互层 | C01—C08 |
| 曲线窄屏 | 独立 390×844 测试页完成破壁，ArrowRight 将 a=1→1.1，参数与公式同步 | C09 |
| showcase 架构弹窗 | 展开详情，Tab/Shift+Tab 保持弹窗范围；Esc 关闭动画完成后 `aria-hidden=true`，焦点返回原入口 | S01—S02 |
| showcase 参数和 site 导航 | 键盘改 a=0.26，手动接管；恢复 a=0.65；site 封面进入 education 内容页，预制来源说明保留 | S03—S06 |

返回视频曾单次观察到 `currentTime=4.002` 并正在播放，不据此声称完成 ≤0.1 秒 seek 偏差或任何 P95 验收。几何原生 range 使用 `step=any`；本次箭头造成 0.14 变化，不应描述为固定 0.1 步长。SVG 手柄的步长是另一条独立路径，本次未重跑拖动及指针捕获。

| 受测页面 / 视口 | `clientWidth / scrollWidth` | 本次证据 |
| --- | --- | --- |
| 曲线 1280×720 | 1265 / 1265 | [桌面截图](test-evidence/repository-audit-2026-10-03/curve-desktop.jpg) |
| 曲线 390×844 | 375 / 375 | [窄屏截图](test-evidence/repository-audit-2026-10-03/curve-mobile.jpg) |
| 几何 390×844 | 375 / 375 | [窄屏截图](test-evidence/repository-audit-2026-10-03/geometry-mobile.jpg) |
| showcase 1280×720 / 390×844 | 1270 / 1270；381 / 381 | [桌面截图](test-evidence/repository-audit-2026-10-03/showcase-desktop.jpg)、[窄屏截图](test-evidence/repository-audit-2026-10-03/showcase-mobile.jpg) |
| site education 1280×720 / 390×844 | 1265 / 1265；375 / 375 | [窄屏截图](test-evidence/repository-audit-2026-10-03/site-education-mobile.jpg) |

这些宽度证明受测状态无页面级水平溢出，不证明所有内容、全部设备或像素对齐合格。几何桌面闭环另见 [截图](test-evidence/repository-audit-2026-10-03/geometry-desktop.jpg)。本次工具返回的页面控制台 warn/error 列表为空，见 [控制台记录](test-evidence/repository-audit-2026-10-03/browser-console.json)；这不等于完整网络审计，reader 连接失败通过可见页面反馈验证。

修复后于 18:57—18:58 追加几何网页检查：重新加载 3–4–5 示例并确认，AB=6、AC=4 时 BC=7.211；恢复后显式提交“把 AB 改成 8”，画板及回答均为 BC=8.944，原题快照仍为 3/4/5。见 [修复后观察](test-evidence/repository-audit-2026-10-03/post-fix/browser-checks.json)、[截图](test-evidence/repository-audit-2026-10-03/post-fix/geometry-smoke.jpg) 与 [控制台](test-evidence/repository-audit-2026-10-03/post-fix/browser-console.json)。实际点击曲线链接再后退时，几何页重新初始化，视频与场景为空，浏览器保留表单草稿；未取得原生 `persisted=true` 证据，因此这次导航不能作为缓存恢复验收通过。

## 5. 发现的问题

### F01 几何页的往返缓存生命周期缺陷

状态：**已修复，控制器回归通过；真实浏览器缓存命中仍未验证**。原优先级 P2；旧实现缓存返回后会永久失去核心操作。

旧基线的 `pagehide` 无条件调用 `dispose()`，永久销毁场景和监听、撤销本地视频 blob URL，没有区分 `event.persisted`。`persisted` 用于指示页面的缓存加载状态，参见 [MDN 定义](https://developer.mozilla.org/en-US/docs/Web/API/PageTransitionEvent/persisted)。

修复前定向脚本载入本地视频替身并确认条件，再派发缓存 hide/show；实际场景为空，AB 表单和预设监听从各 1 个变为 0，视频 URL 被撤销。原始触发与限制保留在 [历史复现说明](test-evidence/repository-audit-2026-10-03/bfcache-reproduction.md)。新增正式回归在旧实现上 42 通过、5 失败，修复后 47 全部通过，见 [修复前日志](test-evidence/repository-audit-2026-10-03/post-fix/geometry-regression-before.log) 与 [修复后日志](test-evidence/repository-audit-2026-10-03/post-fix/geometry-regression-after.log)。

现在 [挂起与恢复](../extension/src/page/geometry.js#L752) 保留场景、原题、未提交草稿、监听和本地 URL；取消在途 read/ask，退休播放、返回和全屏回调，恢复时只刷新控件和校验帧绑定，不自动重试、截帧或播放。[最终离开](../extension/src/page/geometry.js#L769) 仍释放资源。新增 [回归测试](../tests/geometry-parity.test.js#L757) 覆盖重复缓存往返、confirmed/review 草稿、迟到请求、旧浏览器 Promise 不影响新操作以及最终销毁。真实缓存资格、媒体恢复、全屏副作用和离开时的拖动手势仍需确定版本 Chrome 验证；假事件和替身 Promise 不代表这些已通过。

### F02 运行环境说明存在漂移

状态：**已修复**，原优先级 P3。[001 quickstart](../specs/001-insitu-parabola/quickstart.md#L8) 和 [004 quickstart](../specs/004-figures-and-tutor/quickstart.md#L8) 已从 Node 20 统一为 ≥22.9、CI 使用 Node 24，并补充全仓库测试的 FFmpeg/PATH 依赖，明确扩展页面本身无需 FFmpeg。本次实际执行环境为 Node 24.21.0，未据此声称验证所有最低版本。

### F03 开播前阅读的旧任务描述与现行规则冲突

状态：**已修复**，原优先级 P3。[003 tasks 的 Independent Test](../specs/003-preplay-lesson-points/tasks.md#L79) 和 [T013](../specs/003-preplay-lesson-points/tasks.md#L84) 已去掉失败后自动换示例片的旧描述，改为保留用户视频、清理无效结果及旧视频绑定、保留当前视频已通过校验的点；预设仅显式选择。任务勾选、20 样本和 2% 验收门槛未改变。

旧几何验证文档中“最新全仓库重跑”的 556 项属于历史基线；本次的新记录是此报告和独立证据目录。004 的 spec 仍为 Draft，且没有 tasks.md，本报告不推断其任务完成比例。

## 6. 完整验收仍需的证据

| 项目 | 本次结论与后续条件 |
| --- | --- |
| 真实模型识别 / 问答 | 未配置真实供应商；缺 005 的 10～15 份素材、候选正确率、校正和动作记录；预设视频不能计入识别成功率 |
| Chrome MV3 | 未安装并验收确定版本 Chrome 扩展；网页流程不能覆盖扩展 CSP、生命周期或本地 reader 的浏览器访问限制 |
| 四画幅与像素误差 | 坐标算法和固定 JPEG 定位测试通过；16:9、4:3、竖屏、黑边及窗口/全屏/DPR 变化的真实量化对齐仍未完成 |
| 像素呈现和预算 | 未新增真实呈现 P50/P95、至少 20 次热缓存 P95≤100ms、返回 seek 偏差或真实模型预算；双 rAF 只能表示绘制机会 |
| 浏览器完整边缘流程 | 本次未重跑原生全屏/Esc、SVG 拖动与指针捕获、真实 BFCache 往返、全部站点路由和故障状态 |
| 真实设备 / 辅助技术 | 未使用物理手机、触屏、Safari、屏幕阅读器或完整可访问性审计；视口模拟不能代表这些通过 |
| 学习效果与 P1 | 理解题只验证当前回答；长期记忆仍需延迟测试。Pyodide、任意代码运行与通用视觉能力未实现或未独立验收 |

[005 原任务](../specs/005-insitu-right-triangle/tasks.md) 仍为 **19/25**；T015、T016、T020、T023、T024、T025 未完成。G7 的 12/12、G8 的 3/3 只关闭新增通用控件和示例素材范围。003 的 SC-003～SC-005，以及 [前端记录](BreakGlass-frontend-validation.md) 和 [几何记录](BreakGlass-geometry-validation.md) 中的未通过门槛保持原状态。

## 7. 复现命令与远程检查

在仓库根目录运行，ffmpeg 必须可用。这里的工具路径是本次已有目录，其他机器应使用自己的已安装路径。

```powershell
$env:PATH = 'C:\Users\27736\AppData\Local\Temp\breakglass-005-test-tools;' + $env:PATH
node --test --test-reporter=tap
node scripts/check.mjs
node --test tests/geometry-parity.test.js tests/page-geometry.test.js
```

第三条是全量的定向子集，便于复核生命周期修复。`bfcache-reproduction.cjs` 仅用于历史 `08e84da` 缺陷定位，它断言旧缺陷存在，不能在修复后作为绿色测试。构建命令 `node scripts/build-showcase.mjs` 会重写根展示入口，本次在 [构建证据](test-evidence/repository-audit-2026-10-03/showcase-build.json) 记载的 TEMP 副本执行。逐视频 FFmpeg 命令及退出码见 [媒体证据](test-evidence/repository-audit-2026-10-03/geometry-media.json)。

北京时间 18:36:50 查询源码基线 `08e84da` 的 GitHub 检查，[PR 检查](https://github.com/yxz6811/breakglass/actions/runs/37115881101/job/111182491816) 与 [push 检查](https://github.com/yxz6811/breakglass/actions/runs/37115878099/job/111182483714) 均为 `completed / success`，分别于 18:17:26、18:17:15 完成。[查询 JSON](test-evidence/repository-audit-2026-10-03/source-ci.json) 保存历史提交身份和时间。

修复提交 `42c33fd` 的 [GitHub 检查](https://github.com/yxz6811/breakglass/actions/runs/37118287209/job/111189231850) 于 19:01:39 完成，19:04:12 查询为 `completed / success`，见 [修复后 CI JSON](test-evidence/repository-audit-2026-10-03/post-fix/source-ci.json)。该结果对应修复源码提交；报告及证据的后续文档提交不据此声称其 CI 已完成。

F01—F03 的代码与文档修复已推送到 `123456` 的 `42c33fd`。后续按 [001 quickstart](../specs/001-insitu-parabola/quickstart.md)、[003 quickstart](../specs/003-preplay-lesson-points/quickstart.md) 和 [005 quickstart](../specs/005-insitu-right-triangle/quickstart.md) 补第 6 节的独立验收证据。本次没有扩大产品范围或修改 Constitution。
