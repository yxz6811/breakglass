# BreakGlass（破壁）

BreakGlass 是一个 Chrome MV3 扩展原型：把已验证演示视频中的数学抛物线变成可调节的原位 SVG 交互层。

当前交付基线是一个离线可演示的数学抛物线 P0 vertical slice。用户在扩展内演示页播放、暂停并定位视频，在目标时间唤醒预先准备的曲线，拖动参数、重置或退出。预制结果始终标明来源，不伪装成实时识别。

## 当前范围

- P0：单个录屏或固定机位数学抛物线场景。
- P1：真实视觉识别、Python/Pyodide 和其他扩展能力，必须单独立项和验收。
- 不包含任意网站注入、用户账号、云端同步、数据库、代码执行服务或自建后端。
- 9 秒演示片已在仓库里。预制区域按这支片子第 6 秒的画面写。这一帧的手工读数见验证记录，不能当成 2% 对齐已经通过，也不能代替四画幅验收。
- 开播前阅读在片子可播放时自动开始。验收片子不得使用 `breakglass-demo-9s.mp4`；失败、断网、地址留空或 5 分钟内一处都没通过，才回到这个文件。阅读服务不在本仓库。没有它时，页面不会从画面里找出抛物线。
- 交付状态：故事 1（MVP）、故事 2（等待/超时回退/失败/取消）、故事 3（多画幅 2% 对齐）、识别适配切片（`visionAdapter` 默认关闭）和开播前阅读的页面接线已有自动化测试。真实画幅的 2% 记录、阅读服务和浏览器手工验收仍待完成，见 [前端验证记录](docs/BreakGlass-frontend-validation.md)。开播前阅读的 SC-003、SC-004、SC-005 未通过。

## 技术路线

- Chrome MV3 未打包扩展。
- Vanilla JavaScript、原生 CSS、原生 SVG。
- 无运行时依赖、无打包器、无 Preact、无 Tailwind、无 Pyodide。
- Node.js 20+ 仅用于 `node --test` 纯函数测试，不作为业务后端。

## 目录

```text
extension/                 MV3 扩展与演示页
tests/                     Node.js 纯函数测试
specs/001-insitu-parabola/ 功能规格、契约、计划和任务
docs/                      分析与项目专属说明
.specify/                  Spec Kit 工作流配置
```

## 本地运行

扩展方式：

1. 使用 Chrome 打开 `chrome://extensions`，启用开发者模式。
2. 选择“加载已解压的扩展”，选择仓库中的 `extension/` 目录。
3. 点击扩展图标打开扩展内演示页。

网页方式：在 `extension/` 目录启动任意静态服务，然后打开演示页。例如：

```bash
cd extension
python3 -m http.server 8765
```

浏览器访问 `http://127.0.0.1:8765/demo/index.html`。进入页面不会自动播放 9 秒片：点「选择预设」才加载包内示例，或点「选择视频」选自己的文件。自己的文件只留在这台浏览器里。预设片暂停在 6 秒附近再破壁。曲线是预先准备的示例，不会识别画面内容。不要直接双击 HTML 文件，浏览器会拦住页面读取预制 JSON。

选了别的视频、并且时长可用时，阅读会自动开始。验收这支片子时不要用 `breakglass-demo-9s.mp4`。「阅读地址」留空、请求失败或 5 分钟内没有通过的点，画面留在这支片子上，不会换回示例片。示例片只在点「选择预设」时播放。

在仓库根目录运行测试：

```bash
node --test
```

没有视频时页面提示选择视频或选择预设，不会挂上曲线。P0 主路径的 Chrome 确认见验收记录；识别任意视频仍不在当前范围。

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
- [视觉规范](docs/BreakGlass-visual-spec.md)
- [UI 设计建议](docs/BreakGlass-ui-design-guide.md)
- [UI 现状清单](docs/BreakGlass-ui-inventory.md)
- [UI 待实现清单](docs/BreakGlass-ui-todo.md)
