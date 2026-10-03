# 自制直角三角形教学视频

这三段为 BreakGlass 几何实验原创绘制的无声教学示例，片中持续标注“自制教学示例”。没有转载外部课程、伪装真实录屏或声称 AI 已识别题目。使用题目数字载入示例条件属于明确的预制入口，真实 reader 识别应由用户另行显式触发并独立验收。

| 文件 | 题目已知条件 | 最后揭示 | 建议暂停时间 |
| --- | --- | --- | --- |
| `triangle-3-4-5.mp4` | ∠A=90°，AB=3 cm，AC=4 cm | BC=5 cm | 4 秒 |
| `triangle-5-12-13.mp4` | ∠A=90°，AB=5 cm，AC=12 cm | BC=13 cm | 4 秒 |
| `triangle-8-15-17.mp4` | ∠A=90°，AB=8 cm，AC=15 cm | BC=17 cm | 4 秒 |

每段均为 12 秒、1280×720、30 fps、H.264 / yuv420p 的 MP4，无音频。0–2 秒开场，2–8 秒为完全静止的题面，BC 留作提问；8–12 秒显示勾股计算。图形按题目比例绘制，但截图像素仍只用于位置核对，不替代题目注明的厘米边长。

素材用于 [005 单场景规格](../../../../specs/005-insitu-right-triangle/spec.md)，遵循 [BreakGlass Constitution](../../../../docs/BreakGlass-constitution.md) 对来源标记、条件校对和确定性计算的要求。三段清晰示例不代表真实视频识别已通过，也不替代独立的 10–15 份真实素材验收。

## 可重现生成

生成脚本为 [`scripts/generate-geometry-videos.py`](../../../../scripts/generate-geometry-videos.py)，使用已安装的 Pillow、FFmpeg/libx264 和 Windows 微软雅黑。脚本不下载文件或安装依赖；字体文件不会复制到仓库。可通过 `--font`、`--bold-font` 指定其他已安装的中文字体。

在仓库根目录运行（PowerShell，按本机运行时路径调整）：

```powershell
& 'C:/Users/27736/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' scripts/generate-geometry-videos.py --ffmpeg 'C:/Users/27736/AppData/Local/Temp/breakglass-005-test-tools/ffmpeg.exe'
```

脚本重建固定名称的三段 MP4，检查时长、视频流、无音频及全片解码，并将第 4 秒截图写入临时目录 `breakglass-geometry-video-evidence`。可用 `--evidence-dir` 和 `--output-dir` 显式指定输出目录。H.264 编码结果可能随 FFmpeg 版本变化；画面与时间段由脚本固定。

## 第 4 秒的源图位置

坐标以 1280×720 源帧的左上角为原点，用于核对顶点位置；不要从这些像素值推导真实边长。

| 示例 | A (x, y) | B (x, y) | C (x, y) |
| --- | --- | --- | --- |
| 3 / 4 | (292, 590) | (539.5, 590) | (292, 260) |
| 5 / 12 | (292, 590) | (429.5, 590) | (292, 260) |
| 8 / 15 | (292, 590) | (468, 590) | (292, 260) |
