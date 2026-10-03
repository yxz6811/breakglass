# Contract: 外部阅读服务

**Status**: 给扩展外的阅读服务用的契约。实现在本仓库的 `breakglass-reader/`，不打进扩展包，密钥不入库。只用替身模型把页面联调通过，见 `docs/BreakGlass-frontend-validation.md` §7。智谱 `glm-4.6v-flash` 读过一帧，方程对上了，像素锚点被丢掉。  
**Consumers**: 003 演示页通过当次填写的地址发一次 `POST /read`；2026-10-03 独立当前帧曲线增强复用该端点提交一张帧。
**Non-consumers**: 原 001/003 的缓存破壁、1.5 秒预制回退、打包识别样例。独立当前帧请求不进入该 1.5 秒预算。服务不进入扩展包，模型密钥和阅读地址不进入仓库。

003 页面请求与失败处理仍以 [lesson-reading.md](./lesson-reading.md) 和 [Spec Constitution 1.10.0 原则 VII](../../../.specify/memory/constitution.md) 为准；独立当前帧按原则 IX 与 [当前帧计划](../../../docs/BreakGlass-current-frame-plan-2026-10-03.md) 执行。产品约束同步为 [Constitution 1.8.0](../../../docs/BreakGlass-constitution.md)。点内曲线以 [001 CurveResult](../../001-insitu-parabola/contracts/curve-result.md) 为准。

## 请求

`POST /read`，`Content-Type: application/json`。003 一次请求带齐 1 到 8 张画面；独立当前帧请求恰好一张，时间为用户当前暂停时刻，不必是稀疏采样表中的时刻。不要改成流式，也不要再补发一版结果。

```json
{
  "readingId": "reading-1",
  "videoId": "local-binding-1",
  "duration": 120,
  "frameSize": { "width": 3024, "height": 1898 },
  "courseText": "",
  "frames": [
    { "time": 7.5, "image": "data:image/jpeg;base64,..." }
  ]
}
```

| 字段 | 服务必须怎样用 |
| --- | --- |
| readingId | 原样放进响应 |
| videoId | 原样放进响应。这是页面当次生成的内存编号，不要改成 `fixture-parabola` |
| duration | 秒。点的 `time` 不得大于它 |
| frameSize | 片子的源像素宽高。曲线的 `frameSize` 必须等于它，不是 JPEG 的像素 |
| courseText | 可空，最长 8000 字。只用来写短的 `lessonLine`，以及丢掉明显不属于这段课的曲线。不覆盖画面上读出的 `a`、`h`、`k` |
| frames | 1 到 8 张。每项只有 `time`（采样秒）和 `image`（宽不超过 640、质量 0.72 的 JPEG data URL） |

没有地址、或 `videoId` 为 `fixture-parabola` 时，页面不会发这封请求。`breakglass-demo-9s.mp4` 也不进入阅读。

`frameSize` 为 `null` 时无法把检测框乘回源像素。服务应返回 `"points": []`，不要猜一个尺寸。

## 从 JPEG 乘回源像素

页面截帧时按 `scale = min(1, 640 / 源宽度)` 等比缩小。服务读出 JPEG 自己的像素宽高后：

`源像素 = JPEG 像素 × frameSize.width / jpegWidth`

高度用同一个比例：`frameSize.height / jpegHeight`。宽和高的比例应当一致；不一致时不要把框拉变形，丢掉这一帧。

`region` 用乘回之后的源像素。宽高为正，并且整个矩形落在 `frameSize` 里面。`domain` 和 `range` 包住这条曲线要画出来的部分，免得页面把伸出范围的臂贴到区域边上。

## 一帧怎么取舍

每一帧单独看，不把上一帧的区域套到这一帧。

1. 画面里要有一条完整、能对上坐标轴的抛物线。只有残段、只有表格没有图、或有多条对不上时，丢掉这一帧。
2. 读出顶点式 `a`、`h`、`k`。
3. 在 JPEG 上量出曲线矩形，再乘回源像素。
4. 用下面的响应规则自检。过不了的点不要放进 `points`。

没有完整抛物线时不造一条曲线，也不许换成 `demo-parabola`。

## 响应

一次 JSON。`points` 按 `time` 从早到晚排列。页面按数组顺序收入，第一个通过的点会立刻暂停，所以最早的点要排在前面。

```json
{
  "readingId": "reading-1",
  "videoId": "local-binding-1",
  "origin": "external",
  "duration": 120,
  "points": []
}
```

顶层 `readingId`、`videoId`、`duration` 必须与请求一致，`origin` 必须是 `external`。任一不符，页面把整份作废并保留用户选中的视频，不自动换成 9 秒片。

每个点：

| 字段 | 规则 |
| --- | --- |
| id | 非空字符串，同一次阅读内不重复 |
| time | 有限秒数，等于该帧的采样时间，0 ≤ time ≤ duration。相邻保留点至少隔 1 秒 |
| lessonLine | 1 到 80 个码点，同一次不重复。只写这一帧在讲什么。不回传课程全文，也不回传画面 |
| curve.source | `preset` |
| curve.fallback | `null` |
| curve.time | 等于点的 `time` |
| curve.videoId | 等于阅读的 `videoId` |
| curve.requestId | reader 按 `readingId + ':' + point.id` 生成；独立当前帧适配必须检查这项绑定 |
| curve.definition.equationId | `fixture.parabola`，并给出有限的 `a`、`h`、`k` |
| curve.frameSize | 等于请求的源尺寸 |
| curve.definition.region | 源像素矩形，落在 `frameSize` 内 |

整次一处都没有时返回 `"points": []`。页面保留用户选中的视频，并清空这次失败阅读的无效点；不自动换回 `breakglass-demo-9s.mp4`，该示例只由用户显式选择。独立当前帧请求无点时显示本帧不可识别，不用演示预设补齐。

## 时限与失败

003 预读的 5 分钟是页面截止，不是把破壁等待从 1500ms 加长。独立当前帧页面等待采用 30s 开发默认，需真实预跑冻结；它不改变 003 的 300000ms、服务已有配置或原 `createWake` 的 1500ms。页面取消或超时时中止请求，reader 传递断开信号至上游。服务应在这一次 `POST` 里返回；超时、断网、非 2xx 都由页面显示失败并保留所选视频，不必再推一版补救结果。

## 独立当前帧适配门禁（2026-10-03）

本节只约束新增单帧调用，不改 003 的多点采样、保留和「下一个」语义。

- 请求只能含 `readingId/videoId/duration/frameSize/courseText/frames`；恰好一项 `{time,image}`，时间有限且在 `[0,duration]`，源宽高为正安全整数，课程说明不超过 8000 码点。单帧 JPEG 和整个请求均检查 4MiB 上限；未知字段、无效 JPEG 或密钥字段不进入请求。
- 单帧地址只接受本机 HTTP(S) `localhost`、`127.0.0.1` 或 `[::1]`，路径为根或 `/read`；凭据、query、hash、伪装主机和远程地址拒绝。根地址规范化为 `/read`。此规则不回写 003 的旧地址行为。
- 响应必需字段为 `readingId/videoId/duration/origin/points`，只额外允许 `dropped: [{reason:string}]`。顶层身份、时长与请求完全一致，`origin` 为 `external`；`points` 必须恰好一个合法点。
- 点只含 `id/time/lessonLine/curve`；点的时间精确等于这次发送时刻，`id` 非空，`lessonLine` 为 1 到 80 码点。曲线 `requestId` 必须等于 `readingId + ':' + point.id`，视频、时间、源尺寸匹配；来源保持 `preset`、`fallback` 为 `null`。定义字段与参数白名单、有限值、范围和区域须再通过现有曲线与阅读校验；可选 confidence 沿用已有合法门槛。
- 适配器返回校验点的副本。页面另以请求 token、媒体代次、视频源、当前时间、源尺寸及暂停/非定位状态拒绝迟到结果；校验通过才缓存并交给既有 `createWake`。界面标明“当前帧识别”，不能写成包内样例成功。

## 部署约束

服务无状态。不存视频、不存画面、不写账号。日志里不留 data URL 和课程正文。模型密钥只留在服务进程的环境里，不出现在响应里，也不进入本仓库。

演示页从 `chrome-extension://` 或本地页面请求这个地址，服务要对该来源返回允许的跨域头。扩展不新增 `host_permissions`，不放宽 CSP。地址只来自当次页面的「阅读地址」输入。

本契约不表示 SC-003、SC-004、SC-005、当前帧真实模型或 2% 对齐已经通过。那些记录要等真实服务和真实画幅测完再写。
