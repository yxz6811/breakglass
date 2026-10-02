# BreakGlass 前端任务与执行流程

> 本文是前端任务的持续记录。任务完成、验证范围或技术方案发生变化时，必须在同一提交中更新本文。状态以仓库实际代码和可复现验证为准，不以口头进度为准。
>
> 依据：[`AGENTS.md`](../AGENTS.md)、[`docs/BreakGlass-constitution.md`](./BreakGlass-constitution.md)、[`specs/001-insitu-parabola/ownership.md`](../specs/001-insitu-parabola/ownership.md) 和 [`specs/001-insitu-parabola/tasks.md`](../specs/001-insitu-parabola/tasks.md)。

## 1. 前端负责范围

本仓库负责浏览器端和 Chrome 扩展端的可见行为、状态管理、资源组织、结果适配和前端验证：

- MV3 扩展表面：manifest、扩展页、模块化 service worker、CSP 和已验证页面生命周期。
- 演示工作台：视频播放/暂停/定位、破壁入口、来源说明、参数控件、重置、退出、取消、加载和错误状态。
- 视频几何：通过 HTML5 Video API 读取 `currentTime`、`videoWidth`、`videoHeight` 和元素显示矩形，计算黑边和 SVG 坐标映射。
- 交互会话：暂停和目标时间门禁、单会话约束、请求编号、旧结果失效、拖动钳制、重置和退出。
- 本地数据路径：读取静态 RuntimeConfig 和 `CurveResult` 预制 JSON；明确显示 `preset`、超时回退、夹具和错误来源。
- 前端适配：未来仅在外部接口契约确认后实现请求取消、超时、响应映射和错误展示，不在浏览器代码中保存服务端密钥。
- 质量交付：Node.js 纯函数测试、JavaScript 语法检查、Chrome 手工验收记录、文档和演示说明。

本仓库不负责业务后端、数据库、账号、服务端鉴权、云端 Python 容器、视觉识别代理或运维。Node.js 20+ 只用于测试，不启动业务服务。Python/Pyodide 和真实识别属于独立 P1，不能阻塞 P0。

## 2. 当前技术方案

| 层 | 采用技术 | 使用方式 | 当前边界 |
| --- | --- | --- | --- |
| 扩展运行时 | Chrome Manifest V3 | 未打包扩展，扩展内演示页，module service worker | `permissions`、`host_permissions` 和 `content_scripts` 当前为空 |
| 页面 | Vanilla JavaScript | 浏览器原生 DOM、事件和模块化职责文件 | 不引入 React、Preact 或框架迁移 |
| 样式 | 原生 CSS | `extension/demo/demo.css`，响应式布局和可见焦点 | 不引入 Tailwind 构建链 |
| 图形 | 原生 SVG | 独立 overlay 绘制和拖动控制点 | 不使用远程绘图库或远程脚本 |
| 视频 | HTML5 `<video>` API | 读取播放状态、时间、源尺寸和显示矩形 | 只验收扩展自带、已验证的固定素材 |
| 数据 | 静态 JSON + 内存会话 | `RuntimeConfig`、预制 `CurveResult`、当前交互状态 | 不使用数据库或云端同步 |
| 测试 | Node.js 20+ `node --test` | 几何、结果校验、会话生命周期和参数范围 | 不把 Node.js 当业务后端 |
| 检查 | `node --check` + Chrome 手工验收 | 语法、扩展加载、主路径和来源文案 | 未执行项目不能标为通过 |

P0 不加载 Pyodide、WASM、远程脚本或任意代码执行容器。若未来启用 P1，必须另行冻结版本、资源完整性、Worker watchdog、输入/输出/内存预算、包白名单和网络隔离。

## 3. 前端任务清单

状态值约定：`已完成` 表示代码、相关自动化检查和适用文档均已更新；`待手工验收` 表示代码已具备但还缺浏览器或正式素材证据；`未开始` 表示没有进入实现；`阻塞` 表示缺少外部输入。

| 任务 | 前端交付内容 | 主要文件 | 状态（2026-10-02） | 完成证据 |
| --- | --- | --- | --- | --- |
| T001 | 建立扩展、页面、会话、几何、曲线、预制数据和测试目录 | `extension/`、`tests/` | 已完成 | 目录存在，测试可运行 |
| T002 | 建立 MV3 manifest、CSP、扩展 action 和权限边界 | `extension/manifest.json` | 已完成 | 权限为空、无内容脚本、无远程脚本 |
| T003 | 建立不联网、不保存密钥/帧/结果的 module service worker | `extension/src/background/service-worker.js` | 已完成 | 语法检查和 manifest 核对 |
| T005 | 为 `contain` 黑边和内容矩形写纯函数夹具 | `tests/content-rect.test.js` | 已完成 | 相关测试通过 |
| T007 | 计算元素矩形、视频内容矩形和源像素到 CSS 像素比例 | `extension/src/geometry/content-rect.js` | 已完成 | 16:9/容器宽高夹具通过；正式四画幅仍待验收 |
| T010 | 读取运行配置和预制 JSON，并把校验失败转成可展示状态 | `extension/src/preset/load.js` | 已完成 | 加载路径和失败路径可测试 |
| T014 | 建立扩展内演示页、视频控制、破壁/重置/退出和来源区域 | `extension/demo/index.html`、`extension/demo/demo.css` | 已完成 | 页面结构和控件存在 |
| T015 | 收口页面会话：Alt+B、单 overlay、拖动、重置、退出、外部点按、当前视频尺寸映射 | `extension/src/page/main.js` | 已完成 | `node --check`；14 项测试通过；手工验收待记录 |
| T016 | 视频缺失或打不开时只提示，不挂夹具曲线冒充正式对齐 | `extension/assets/video/README.md`、`extension/src/page/main.js` | 已完成 | 错误状态和素材说明存在 |
| T017 | 按 quickstart 第 1 节在 Chrome 加载未打包扩展并记录主路径 | `specs/001-insitu-parabola/quickstart.md`、本文 | 阻塞：待 Chrome 手工验收 | 预检已完成；需要可控 Chrome 窗口，正式视频到位后再做原位结论 |

### 协作但不归前端任务表的结果规则

`T004`、`T006`、`T008`、`T009`、`T011`、`T012`、`T013` 和 `T018` 在 `ownership.md` 中归为结果规则一侧。它们的实现仍位于 `extension/`、`tests/` 或契约目录，但职责是决定结果能否进入交互，而不是建立服务端。前端页面必须消费这些规则提供的状态，不得在页面里另写一套“是否可画”的判断。

当前这组规则已经覆盖确定性校验、夹具求值器、预制配置、会话防重和播放/换帧失效；真实识别、单帧上传和感知代理仍未派发。

## 4. 标准执行流程

每个前端任务按以下顺序推进，除非任务本身不适用：

1. **读约定和范围**：先读 `AGENTS.md`、Constitution、对应 `spec.md`、`plan.md`、`tasks.md` 和契约；确认任务属于 P0、P1 还是外部依赖。
2. **确认输入**：确定目标页面、视频/帧素材、数据字段、失败状态和验收口径。缺少接口或素材时记录为依赖，不在本仓库补后端。
3. **拆到文件和状态**：写明要改的页面、组件/模块、静态 JSON、测试和文档；区分用户输入、当前会话和预制结果。
4. **先做可验证的底层规则**：优先完成几何、校验、会话和数据加载等纯函数或契约，再接页面事件和 SVG。
5. **接入页面交互**：完成加载、正常、空数据、失败、取消、禁用、成功和退出状态；视频播放、换帧或退出时清理旧 overlay 和监听。
6. **运行自动检查**：至少按任务需要运行 `node --test`、`node --check` 和 `git diff --check`；新失败必须修复或记录原因。
7. **执行手工验收**：按 quickstart 的适用场景在目标 Chrome 和目标视口操作。没有正式视频时只能记录夹具状态，不能写成原位验收通过。
8. **更新交付记录**：在本文更新任务状态、日期、改动文件、验证命令、结果和剩余依赖，同时同步 `tasks.md` 或相关契约。
9. **提交并关联 PR**：提交信息说明任务结果；PR 描述列出实际验证和未验证范围。文档更新必须与代码在同一提交或同一 PR 中。

故事 1 的 T017、正式视频和目标帧验收完成前，不开始 `tasks.md` 中未编号的故事 2 超时回退或故事 3 四画幅验收。

## 5. 完成一项后的文档更新规则

以后每完成一个前端任务，必须更新本文对应行，并补充以下内容：

- 状态从 `未开始`/`进行中`/`待手工验收` 改为实际状态。
- 更新完成日期和实际修改文件。
- 写出实际执行的命令或操作，以及通过、失败或未执行结果。
- 区分自动化夹具、正式素材和浏览器手工验收；夹具不能代替正式视频证据。
- 更新剩余依赖、阻塞项和下一项任务；若任务改变了顺序，同步 `tasks.md` 和 `ownership.md`。
- 若新增接口、服务、权限、依赖或 P1 能力，先更新契约和 Constitution 合规记录，不得只改状态表。

推荐在本文末尾追加一条变更记录：`日期｜任务｜变更｜验证｜剩余事项｜提交/PR`。没有验证证据的任务不得标为“已完成”。

## 6. 当前交付状态

- P0 扩展脚手架、扩展内演示页、预制结果、会话规则和前端边界文档已提交。
- 自动化检查：`node --test` 14 项通过；`node --check extension/src/page/main.js` 和 `node --check extension/src/session/session.js` 通过。
- T017 的 Chrome 手工记录、正式演示视频、目标时间、曲线定义和四画幅原位误差证据仍待补齐。
- 故事 2、故事 3、真实识别、单帧上传、Pyodide 和后端服务不属于当前已完成范围。

### T017 预检记录

已完成的确定性预检：

- `extension/manifest.json` 可解析，`manifest_version` 为 3。
- `permissions`、`host_permissions` 为空，未声明 `content_scripts`。
- 扩展页 CSP 为 `script-src 'self'; object-src 'self'`，演示页入口、service worker 和本地脚本均存在。
- `node --test` 14 项通过；`node --check extension/src/page/main.js` 和 `node --check extension/src/session/session.js` 通过。

尚不能记录为手工通过的部分：当前执行环境没有可控 Chrome 窗口，仓库也没有正式视频、目标时间和匹配曲线素材。T017 的下一步是加载 `extension/` 未打包扩展，打开扩展内演示页，确认缺失素材提示和主路径控件，再用正式素材完成 quickstart 第 1 节；在此之前不宣称故事 1 原位验收通过。

## 变更记录

| 日期 | 任务/范围 | 变更 | 验证 | 提交/PR |
| --- | --- | --- | --- | --- |
| 2026-10-02 | 文档初始化 | 建立前端职责、技术路线、任务表、执行流程和逐项更新规则 | 文档审查；`node --test` 14 项通过 | PR #6 |
| 2026-10-02 | T017 | 完成 manifest/入口/脚本确定性预检，记录 Chrome 窗口和正式素材阻塞 | 自动检查通过；手工验收未执行 | PR #7 |
