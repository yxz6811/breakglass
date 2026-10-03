# BreakGlass 工作台视觉对齐与验证

日期：2026-10-03。

本轮将曲线与当前帧几何两个产品工作台统一为浅色冰面，沿用现有页面和任务流程。依据为 [BreakGlass Constitution 1.7.1](BreakGlass-constitution.md) 与 [视觉规范 1.5.0](BreakGlass-visual-spec.md)；005 的来源、候选确认和实验条件继续遵守 [场景与动作契约](../specs/005-insitu-right-triangle/contracts/scene-actions.md)。

## 实际改动

| 范围 | 本轮结果 |
| --- | --- |
| 共享主题 | 两个工作台先加载本地 `extension/src/ui/theme.css`，再加载各自页面 CSS。颜色、文字、按钮、表单、面板、来源胶囊、焦点及基础动效共用令牌 |
| 浅色冰面 | 页面底色 `#F7FAFC`，冰面 `#EEF4F8/#C8DCE6`，主文字 `#14232F`、辅助文字 `#4E6474`、强调 `#0B6F91`、警示 `#8A5A00`；面板沿用冰面渐变与阴影 |
| 深屏内容 | 视频、原帧占位与独立数学画板保留 `#0E1720`；文字和图形使用独立 screen 令牌，修复深屏文字、控制点及 hover 的对比度 |
| 导航与排版 | 两页增加一致的工作台导航与当前页标记；统一字体栈、标题、12px 眉标和数值排版，保留各自场景布局 |
| 控件 | 普通按钮及文本、数值、URL 输入、select、textarea 最小高44px；URL与textarea不再残留旧暗色表面。主按钮为深青蓝渐变与白字 |
| Dock | 圆形按键桌面48px、1050px及以下44px；合并旧Dock重复材质规则，保留已有工具栏入口、放大与减少动效行为 |
| 焦点 | 统一2px可见焦点环；修复深屏控制点焦点样式，键盘改边后焦点保持在原控制点 |
| 既有原型 | 液态玻璃工具栏原型本来就使用 `demo.css`；本轮接入共享主题并修复其文字对比度，保留原型用途 |

介绍站 `site/` 和根目录“展示网站”未改动。本轮主题修改未改变业务逻辑、接口、数学计算、计时预算与扩展权限。视觉提交后主分支合入 `426c41a`，本分支集成其已有的本地曲线提问模块；侧栏记录区与输入沿用共享浅色表面，视频面板保持内容高度。主题统一没有把预设或手工条件改成真实识别，也没有让未确认候选进入实验或问答。

## 自动检查

本轮在仓库根目录实际执行：

```bash
node --test
node --test tests/page-integration.test.js tests/page-a11y.test.js tests/acceptance-supplement.test.js tests/page-geometry.test.js
node --test tests/page-integration.test.js tests/page-tutor.test.js tests/page-tutor-edges.test.js tests/tutor-sidebar-edges.test.js tests/page-a11y.test.js tests/acceptance-supplement.test.js
node scripts/check.mjs
```

| 检查 | 实际结果 |
| --- | --- |
| 全仓库测试 | 合入最新main后556/556通过；合入前462/462通过 |
| 定向页面与工具栏测试 | 合入前4个文件42/42；合入后6个页面与侧栏文件74/74通过 |
| 语法及资源检查 | 合入后109个JS/MJS脚本、179处本地引用和内联脚本检查通过 |

自动测试覆盖共享样式引用和既有页面行为；这些结果不证明真实模型效果、MV3安装流程或显示设备上的像素呈现耗时。

## 浏览器检查

使用Codex内置浏览器（IAB）访问本地静态网页。窗口/视口设置后读取目标测试标签的DOM尺寸，确认实际生效；以下为桌面浏览器引擎及其视口模拟，不是真实手机测试。

| 视口 | DOM可用宽度 | 实际观察 |
| --- | --- | --- |
| 1280×720 | 1265px | 两个工作台均无横向溢出；桌面任务区可读 |
| 1920×1080 | 1905px | 两页实际读取到高度1080px，`scrollWidth = clientWidth`；宽屏无横向溢出 |
| 390×844 | 布局读取时375px | 两页单列，`scrollWidth = clientWidth`；导航与核心场景流程可用 |
| 768×1024 | 753px | 两页均无横向溢出 |

| 操作 | 实际观察 |
| --- | --- |
| 桌面曲线工作台 | 显式选择预设、定位6秒、破壁成功；圆与抛物线切换成功，来源继续标明预设 |
| 合入的曲线提问侧栏 | 先破壁才可输入；“把顶点高度改成 -1”同步改变k滑块、公式与图形；“x 等于 1 时 y 是多少”按当前曲线回答y=0，记录保持浅色可读 |
| 桌面几何工作台 | 3–4–5预设经确认建立画板；本地受限提问将AB改为6、AC保持4，BC显示7.211 |
| 非法边长 | AB=0被拒绝，保留此前有效场景与计算结果 |
| 键盘改边 | 箭头操作使AB从6变为6.1，再回到6；焦点保持在原控制点 |
| 理解题 | 选择正确条件后显示本次回答正确；不据此宣称长期记忆提升 |
| 390px窄屏 | 曲线与几何核心流程均走通；两工作台之间的导航切换成功。合入侧栏后复查提问与记录，默认抛物线在x=1时回答y=2，页面无横向溢出 |
| 工具栏原型 | Tab焦点可见，聚焦按键的放大反馈正常 |

几何提问使用页面明确标注的本地受限指令，不调用AI；上述预设、交互结果及截图不计作真实视频识别成功。

## 截图证据

- [曲线工作台桌面](test-evidence/ui-alignment-2026-10-03/curve-desktop.png)
- [合入后的曲线提问侧栏](test-evidence/ui-alignment-2026-10-03/curve-tutor-desktop.png)
- [几何工作台桌面](test-evidence/ui-alignment-2026-10-03/geometry-desktop.png)
- [曲线键盘焦点](test-evidence/ui-alignment-2026-10-03/curve-keyboard-focus.png)
- [几何键盘焦点](test-evidence/ui-alignment-2026-10-03/geometry-keyboard-focus.png)
- [液态玻璃工具栏原型](test-evidence/ui-alignment-2026-10-03/toolbar-prototype.png)
- [曲线工作台390px视口](test-evidence/ui-alignment-2026-10-03/curve-mobile.png)
- [几何工作台390px视口](test-evidence/ui-alignment-2026-10-03/geometry-mobile.png)
- [几何工作台768px视口初始布局](test-evidence/ui-alignment-2026-10-03/geometry-tablet.png)

## 本轮未验收范围

- 真实手机、物理触屏与真实设备兼容性。
- Chrome加载MV3扩展后的完整安装、启动与操作流程。
- 真实模型识别、模型问答及真实几何视频样本成功率。
- 四画幅的量化对齐、窗口/全屏变化后的实际像素对齐，以及实际像素呈现耗时。

本轮网页视觉与流程检查不能替代历史T030/T038，也不改变 [前端验证记录](BreakGlass-frontend-validation.md) 和 [几何验证记录](BreakGlass-geometry-validation.md) 中尚未通过的独立验收项目。
