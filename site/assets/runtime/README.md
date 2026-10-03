# 架构章节真实运行截图

2026-10-03，通过仓库 `extension/demo/index.html` 的实际浏览器交互截图。无图像生成、伪造检测框或识别数据。展示范围遵循 [BreakGlass 产品约束](../../../docs/BreakGlass-constitution.md)（从仓库根目录查看：`docs/BreakGlass-constitution.md`）。

| 资产 | 操作与画面 | 网站对应位置 |
| --- | --- | --- |
| `01-user-trigger.jpg` | 选择包内预设，显示工具栏，定位到第 6 秒；尚未破壁 | 用户触发 |
| `02-geometry-frame.jpg` | 同一暂停帧的视频内容区裁切 | 内容几何探测层 |
| `03-preset-result.jpg` | 点击破壁，曲线与本地预制来源说明出现 | 多模态感知层：当前结果来源 |
| `04-in-situ-overlay.jpg` | 破壁后的视频舞台裁切，SVG 曲线及控制点可见 | 原位图层挂载层 |
| `05-function-branch.jpg` | 键盘调节开口参数 a，从 1.0 到 0.6 | 双分支业务分流：已实现的函数分支 |

截图不代表真实视觉识别、Python/Pyodide 运行或第三方平台适配已经实现，也不是 2% 对齐验收证据。图片用于说明当前 P0 演示，P1 能力在卡片详情中明确标注。

展示页沿用现有黑色背景、青色强调、12px 卡片圆角和点击展开交互。缩略图只用于导航，大图保持完整比例。`scripts/build-showcase.mjs` 将五张图片内联到三个独立入口，保持资源自包含和原有安全策略。
