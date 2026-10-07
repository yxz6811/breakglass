# BreakGlass 工作台接线修复补验

2026年10月7日，Asia/Shanghai。主会话修复几何示例定位、曲线清图通知和同源reader地址后，三项浏览器补验均通过。本轮只追加受影响的操作；[初轮集成验证](BreakGlass-workspace-integration-validation-2026-10-07.md) 的47项结果、截图与源码哈希保持原样。

验证仍使用隔离入口 `http://127.0.0.1:18767/extension/demo/index.html` 与临时测试账户，浏览器刷新后读取新代码。三个相关源码文件在操作前后SHA-256一致，见 [followup-evidence.json](test-evidence/010-workspace-integration-2026-10-07/followup-evidence.json)。

| 补验 | 实际结果 |
| --- | --- |
| 几何示例自动定位 | 仅点击“加载示例，定位题面”，媒体就绪后显示“当前4/12秒，已暂停”；条件按钮已启用，直接点击后进入人工核对表单，没有手工输入或定位4秒 |
| 曲线清图与恢复 | 打开后显示a1/h0/k1；方向键改h0.1后公式联动，重置恢复h0/k1；播放、退出、定位、隐藏面板及返回曲线均使下游公式为空、实线stage隐藏、保存表单隐藏；再次显式打开可恢复实线 |
| 同源reader控件 | 曲线地址为当前origin的`/read`，几何地址为当前origin；两者实际带readonly属性，几何“忘记地址”按钮不可见，主动reader许可仍未勾选 |

原始可见文字与DOM属性在 [followup-browser.json](test-evidence/010-workspace-integration-2026-10-07/followup-browser.json)。全部曲线状态检查仍只有1个视频。媒体已停在题面的截图见 [几何自动定位](test-evidence/010-workspace-integration-2026-10-07/followup-geometry-auto4.jpg)，清图结果见 [曲线退出后](test-evidence/010-workspace-integration-2026-10-07/followup-curve-cleared.jpg)，恢复后见 [最终实线](test-evidence/010-workspace-integration-2026-10-07/followup-final-lines.jpg)。

本轮没有修改源码、保存新学习记录、勾选reader许可或调用真实模型，也没有操作旧地址的浏览器存储。reader不读取旧地址、不自动发送及请求权限的逻辑由主会话针对性测试覆盖；本轮浏览器只核实控件、许可状态与可见结果，没有直接计数reader网络请求。主会话另报告针对性62/62、全仓库1036/1036通过，最终命令和日志以主会话交付为准。本轮补验不扩大初轮T019/T022对全屏、真人、模型、迁移上传或MV3的验收范围。
