# Contract: 几何自动阅读服务

日期：2026-10-06。这是建议契约，实施前按本文件编码；它还不是已经存在的接口。

既有 `POST /read`、`POST /geometry/read`、`POST /geometry/ask` 的路径、字段和字节上限不变。

## 请求

`POST /geometry/lesson`，`Content-Type: application/json`。一次带齐 1 到 8 张画面。不改成流式，也不补发第二份结果。

```json
{
  "schemaVersion": "1.0.0",
  "readingId": "reading-1",
  "videoId": "local-binding-1",
  "duration": 42.5,
  "frameSize": { "width": 1280, "height": 720 },
  "courseText": "",
  "frames": [
    { "time": 3.2, "image": "data:image/jpeg;base64,..." }
  ]
}
```

| 字段 | 规则 |
| --- | --- |
| schemaVersion | 只能是 `1.0.0` |
| readingId / videoId | 非空字符串。`videoId` 不得为 `fixture-parabola` |
| duration | 秒，有限且大于 0 |
| frameSize | 源像素。宽高为正整数 |
| courseText | 可省略或空字符串。按码点超过 8000 则整请求拒绝，不调用模型 |
| frames | 1 到 8 项。`time` 为秒，落在时长内，相邻至少 1 秒 |
| image | 单张 JPEG data URL。服务读出的宽度不超过 640，宽高比与 `frameSize` 一致，高度允许 1 像素取整差 |

未知字段拒绝，尤其是 `model`、`prompt`、`schema`、`apiKey`、`messages`。页面不得提交这些字段。

整包含 JSON 与 base64 超过 10MiB 时返回 413，不调用模型。此上限不改变 `/geometry/read` 的 4MiB。

## 响应

模型看过画面后，没有一处可接受时仍返回 200，`points` 为空。

```json
{
  "schemaVersion": "1.0.0",
  "readingId": "reading-1",
  "videoId": "local-binding-1",
  "duration": 42.5,
  "origin": "external",
  "points": [],
  "dropped": [{ "time": 3.2, "reason": "unsupported" }]
}
```

`origin` 只能是 `external`。顶层身份和时长必须与请求一致，否则页面整份作废并保留用户视频。

`points[]` 的形状见 [geometry-lesson-result.md](./geometry-lesson-result.md)。服务在返回前填好 `derived`。模型输出里的斜边、额外字段和自然语言解释不得出现在响应中。

`dropped[].reason` 只用这些代码：`unsupported`、`ambiguous`、`incomplete`、`unit_mismatch`、`not_finite`、`frame_size`、`image_invalid`、`model_unreadable`。页面可以不展示代码，但日志只记代码。

## 状态

| 情况 | 状态 |
| --- | --- |
| 形状不对、未知字段、课程说明超长、演示夹具 videoId | 400 |
| 来源不在名单 | 403 |
| 不是 JSON | 415 |
| 超过 10MiB | 413 |
| 没配模型 | 503 |
| 每一帧都连不上模型、被拒或整次超时 | 502 |
| 模型有回答，包括一处都没收下 | 200 |

整次预算 300000ms。客户端断开或预算到达时中止尚未完成的上游调用，不再领下一帧。模型明确回答该帧不受支持时，不把该帧再交给池里的下一个模型。429 或 503 可以在剩余预算内换模型，换到的结果仍须通过同一套字段检查。

## 日志

一行 JSON：`readingId`、帧数、点数、各 `reason` 计数、耗时。不记录 data URL、课程正文、密钥或模型原文。

## 模型候选

模型只看到一张 JPEG 和该图的像素尺寸。指令固定在 reader 内，要求只返回一个 JSON 对象：

- 没有唯一的完整图形：`{"supported":false}`
- 两个都完整：`{"supported":false,"reason":"ambiguous"}`
- 直角三角形：直角顶点、两条直角边的名称和长度、单位、三个顶点的 JPEG 像素
- 圆：圆心名称、圆心 JPEG 像素、半径、单位
- 线段：两端名称、两端 JPEG 像素、长度、单位

禁止要求模型测量像素距离、猜测 3-4-5、输出斜边或输出第二图形。服务把 JPEG 像素按比例映射回 `frameSize`，映射失败则该帧 `frame_size`。
