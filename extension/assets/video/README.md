# 视频素材与来源

曲线工作台的正式演示片仍是 `breakglass-demo-9s.mp4`。005几何工作台另使用下面三段自制教学示例；新增素材应有明确用途和来源，不提交无关占位媒体。

曲线页的包内预设只使用这个文件（相对仓库根目录）：

`extension/assets/video/breakglass-demo-9s.mp4`

片子已在仓库里。`extension/assets/presets/demo-parabola.json` 的区域按这支片子第 6 秒的画面写，对应图上的 `y = x^2 + 1`。这一帧的手工偏差见 `docs/BreakGlass-frontend-validation.md`。页面读数仍是 `measured: false`，这一帧的手工读数不能写成 2% 对齐已经通过。

进入演示页不会自动挂上这支片子。舞台空态有「选择预设」，点了才播放它；旁边仍是「选择视频」。文件仍不存在时，状态句是「先选择一个视频。文件留在这台浏览器里。」点了预设却找不到文件，才说预先准备的片子没有加载出来。

此路径只确定扩展包内的播放源。演示页把目标时间初值设为 6 秒，供这段 9 秒片子使用；会话仍跟随输入框里的当前值。它不新增 `videoId`。

## 005自制几何教学示例

本次外部开放许可视频检索连接失败，未取得已核验的第三方视频；采用项目自制教学素材替代，不描述为转载或找到的外部视频。每段目标为12秒、1280×720、H.264、无声MP4，题面与对应预设共同使用cm。具体生成方法、题面及实际媒体元数据见 [几何素材说明](geometry/README.md) 和 [生成脚本](../../../scripts/generate-geometry-videos.py)；目标参数本身不是验收结果。

| 文件（相对仓库根目录） | 题面条件 | 本地计算的初始BC |
| --- | --- | --- |
| `extension/assets/video/geometry/triangle-3-4-5.mp4` | ∠A=90°、AB=3 cm、AC=4 cm | 5 cm |
| `extension/assets/video/geometry/triangle-5-12-13.mp4` | ∠A=90°、AB=5 cm、AC=12 cm | 13 cm |
| `extension/assets/video/geometry/triangle-8-15-17.mp4` | ∠A=90°、AB=8 cm、AC=15 cm | 17 cm |

三段只服务005直角三角形的教学和预设验收，不加入003自动阅读或替换曲线9秒演示片。几何页由用户选择并点击加载；媒体就绪后暂停定位第4秒，不自动播放、capture或识别。当前对应示例暂停、非seeking且`2 ≤ currentTime < 8`时，用户才可载入对应预设条件，候选保持`source=preset`、`originSource=preset`、`editedByUser=false`、`unit=cm`、`vertices=null`并须人工确认。说明中的源图顶点不会自动写入候选；资源文件名或已知题目数据不能当作模型识别结果。

选择本地文件后恢复通用3–4–5的`unit=unit`预设入口；换视频取消旧请求、清理旧场景，迟到回复不能污染新视频。真实识别仍由独立reader入口显式发送当前一张帧，与载入自制样例条件分别记录。步骤见 [005 quickstart §9](../../../specs/005-insitu-right-triangle/quickstart.md#9-2026-10-03-自制几何示例视频增补)，结果见 [本次功能对齐记录](../../../docs/BreakGlass-geometry-parity-2026-10-03.md)。
