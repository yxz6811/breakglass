# 正式视频素材

仓库里的正式演示片就是 `breakglass-demo-9s.mp4`。不要再提交别的占位媒体。

演示页只播放这一个文件（相对仓库根目录）：

`extension/assets/video/breakglass-demo-9s.mp4`

片子已在仓库里。`extension/assets/presets/demo-parabola.json` 的区域按这支片子第 6 秒的画面写，对应图上的 `y = x^2 + 1`。这一帧的手工偏差见 `docs/BreakGlass-frontend-validation.md`。页面读数仍是 `measured: false`，这一帧的手工读数不能写成 2% 对齐已经通过。

文件仍不存在时，舞台上显示「选择视频」，状态句是「先选择一个视频。文件留在这台浏览器里。」不会改成加载失败。

此路径只确定扩展包内的播放源。演示页把目标时间初值设为 6 秒，供这段 9 秒片子使用；会话仍跟随输入框里的当前值。它不新增 `videoId`。
