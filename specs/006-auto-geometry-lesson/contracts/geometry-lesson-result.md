# Contract: 几何阅读结果

日期：2026-10-06。页面只消费通过本契约的点。本结果不是 `CurveResult`，也不进入 `createWake`。

## 点

```json
{
  "schemaVersion": "1.0.0",
  "id": "point-1",
  "readingId": "reading-1",
  "videoId": "local-binding-1",
  "time": 3.2,
  "frameSize": { "width": 1280, "height": 720 },
  "lessonLine": "直角边是 3 和 4。",
  "kind": "right-triangle",
  "unit": "cm",
  "placement": {
    "vertices": {
      "A": { "x": 100, "y": 80 },
      "B": { "x": 220, "y": 80 },
      "C": { "x": 100, "y": 200 }
    }
  },
  "given": {
    "rightAngleAt": "A",
    "legs": [
      { "id": "AB", "from": "A", "to": "B", "length": 3 },
      { "id": "AC", "from": "A", "to": "C", "length": 4 }
    ]
  },
  "derived": { "hypotenuse": { "id": "BC", "from": "B", "to": "C", "length": 5 } }
}
```

圆的 `given` 为 `{ "center": { "label": "O", "x": 160, "y": 120 }, "radius": 5 }`，`placement.center` 与圆心像素相同。线段的 `given` 为两端名称、像素和 `length`。

| 规则 | 拒绝条件 |
| --- | --- |
| 版本与身份 | `schemaVersion` 不是 `1.0.0`，或 readingId、videoId、time、frameSize 与当次请求不一致 |
| 时间 | 非有限、小于 0、大于时长，或不在本次送出的采样里 |
| 种类 | 不是三种白名单之一，或一帧出现第二个图形 |
| 数值 | 长度或半径不是正有限 JSON number；布尔值、null、数字字符串都不转换 |
| 单位 | 不是 `unit`、`cm`、`m`，或同一个点里出现第二种单位 |
| 直角三角形 | 直角顶点不在两条边上，两条边不共享该顶点，顶点名称重复，或 `derived.hypotenuse.length` 不等于 `Math.hypot` |
| 像素 | 坐标不在源画面内，或线段两端重合 |
| 未知字段 | 点上出现 `source`、`prompt`、`confidence`、模型原文或可执行文本 |

`derived` 只由服务和页面按 `given` 重算。两边结果不一致时丢掉该点。

## 页面会话

挂在 `BreakGlass.geometryLesson`。不新增 `createWake` 的参数，也不读取曲线会话状态。

| 状态 | 学习者能做什么 |
| --- | --- |
| 未开始 | 选择自己的视频或选择预设 |
| 等待地址 | 填写地址。画面不上传 |
| 正在读 | 看到进度和取消。第一处未到时不能破壁 |
| 已停在已存点 | 时间与该点相差不超过 0.2 秒且已暂停时可以破壁 |
| 定位中 | 不能破壁 |
| 调节中 | 改一项允许条件、重置、退出、下一个 |
| 还在读 | 「下一个」的目标尚未存好。时间与当前层不变 |
| 没有下一处 | 按钮不可用 |

破壁文案为「这次几何阅读」。选择预设后的文案为「预先准备的示例」。两种文案不能互换。

调节的工作副本与 `given` 分离。退出或「下一个」丢弃工作副本。旧请求的响应在换片、播放、地址变更、取消或代次变化后丢弃，即使时间数值相同。

## 与相邻契约的边界

| 契约 | 006 的义务 |
| --- | --- |
| `CurveResult` / `POST /read` | 不写入、不放宽抛物线字段 |
| 005 `SceneResult` / `POST /geometry/read` | 不代替显式单帧校对，不接收 006 的批量点 |
| 004 本地图形 | 直线、圆、正弦的本地公式选择器不出现在本入口 |
