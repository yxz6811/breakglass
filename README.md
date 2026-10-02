# BreakGlass（破壁）

BreakGlass 是一个 Chrome MV3 扩展原型：把已验证演示视频中的数学抛物线变成可调节的原位 SVG 交互层。

当前交付基线是一个离线可演示的数学抛物线 P0 vertical slice。用户在扩展内演示页播放、暂停并定位视频，在目标时间唤醒预先准备的曲线，拖动参数、重置或退出。预制结果始终标明来源，不伪装成实时识别。

## 当前范围

- P0：单个录屏或固定机位数学抛物线场景。
- P1：真实视觉识别、Python/Pyodide 和其他扩展能力，必须单独立项和验收。
- 不包含任意网站注入、用户账号、云端同步、数据库、代码执行服务或自建后端。
- 正式视频和曲线素材尚未提交时，工程夹具只能用于验证状态和几何逻辑，不能作为真实视频验收证据。

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

1. 使用 Chrome 打开 `chrome://extensions`，启用开发者模式。
2. 选择“加载已解压的扩展”，选择仓库中的 `extension/` 目录。
3. 点击扩展图标打开扩展内演示页。
4. 在仓库根目录运行测试：

```bash
node --test
```

正式视频、目标时间、抛物线定义和配套预制结果到位前，演示页会明确提示素材缺失，不会用夹具曲线冒充已完成的原位对齐。

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
