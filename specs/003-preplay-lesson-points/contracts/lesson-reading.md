# Contract: LessonReading

**Status**: 本功能的验收契约  
**Consumers**: 阅读校验、演示页、「下一个」  
**Non-consumers**: 感知代理、`createWake` 的参数形状。既有阅读服务在 `breakglass-reader/`，按 Constitution 1.8.0 的独立例外维护，不打入扩展包。

点内曲线引用 [001 CurveResult](../../001-insitu-parabola/contracts/curve-result.md)。`time` 单位是秒。

## 采样

片子时长 `duration` 为大于 0 的有限秒数时开始。

- 时长 < 2：只取 `duration / 2`。
- 否则按时长等分成 n 段，n = min(8, floor(duration))，至少 1 段。每段取中点。
- 相邻中点之差 < 1 秒时，不发送较晚的那个。
- 发送的画面数量最终仍 ≤ 8。
- 不得包含整段视频字节，不得从 0 按帧递增。

## 阅读结果

```json
{
  "readingId": "lesson-run-001",
  "videoId": "local-binding",
  "origin": "external",
  "duration": 120,
  "points": [],
  "dropped": []
}
```

| 字段 | 规则 |
| --- | --- |
| readingId | 非空字符串，必须等于请求 |
| videoId | 非空字符串，必须等于当次内存绑定。不得为了通过检查改成 `fixture-parabola`，除非当前片子就是预先准备的那一支 |
| origin | 阅读点只有 `external` |
| duration | 有限数，单位秒，大于 0 |
| points | 校验后长度 0 到 8 |
| dropped | 每项只有 `reason` |

长度为 0 且阅读已结束时，不破壁，保持用户选中的片子，不自动换成示例。

## 破壁点

```json
{
  "id": "vertex",
  "time": 12.5,
  "lessonLine": "这里在讲顶点。",
  "curve": {}
}
```

| 字段 | 规则 |
| --- | --- |
| id | 非空字符串，同一阅读内不重复 |
| time | 有限数，单位秒，必须是当次真正发送的某张帧的 time，0 ≤ time ≤ duration，与已保留点至少相隔 1 秒 |
| lessonLine | 非空字符串，最长 80 字，同一阅读内不重复 |
| curve.source | 必须是 `preset` |
| curve.fallback | 必须是 `null` |
| curve.time | 必须等于点的 `time` |
| curve.videoId | 必须等于阅读的 `videoId` |
| curve.frameSize | 必须等于当前片子的源尺寸。不等则整点丢掉 |

不设 `alignment: example` 的成功绘制。尺寸或区域不通过时不进入交互。

## 丢掉一个点时的原因

| reason | 何时 |
| --- | --- |
| 抛物线没有通过检查 | 曲线形状、来源、`fallback`、区域或画面尺寸不合法 |
| 不是这一段视频 | `videoId` 或 `readingId` 不一致 |
| 时间无效 | 时间缺失、非有限或为负 |
| 落在视频外面 | 时间大于 duration |
| 和上一个点靠得太近 | 与已保留点相隔不足 1 秒 |
| 超出八个点 | 合法点按时间排序后排在第 9 个及以后 |

不得展示上游原文、课程全文或画面。不得用 `demo-parabola` 替换被丢掉的点。

## 请求

片子可播放且当次页面有地址时发送。地址不写进仓库。已有独立 reader 怎么读这些画面、怎么把 JPEG 坐标乘回源像素，见 [reading-service.md](./reading-service.md) 及 `breakglass-reader/README.md`。

| 字段 | 规则 |
| --- | --- |
| readingId | 当次生成的非空字符串 |
| videoId | 当次内存绑定 |
| duration | 有限数，单位秒，大于 0 |
| courseText | 字符串，可空，最长 8000 字。超长则不发送该字段的正文 |
| frameSize | 发起阅读时片子的源像素宽高，`{ width, height }`，都是大于 0 的有限数。不是缩小后的 JPEG 尺寸。缺了或无效时该字段为 `null`，不编一个尺寸 |
| frames | 长度 1 到 8。每项只有 `time` 与 `image`。`image` 是宽不超过 640 的 JPEG data URL |

响应的 `readingId`、`videoId`、`duration` 必须与请求一致，`origin` 为 `external`。否则整份作废。页面保留当次实际发送的帧时刻与源尺寸，再校验每处曲线；不能按当前视频时长重新推算并接纳未发送的帧。

截止为 300000ms。失败时不调用会话 `fail`。

| 情况 | 用户看到 | 片子 |
| --- | --- | --- |
| 超过 5 分钟且一处都未通过，或断网、没有地址、响应不可用 | 这支片子留在画面上。 | 源保持用户选中的片子，失败片子的点清空。不自动换成 `breakglass-demo-9s.mp4` |
| 用户取消，且已有存点 | 已取消阅读。 | 留在当前片子，已存点仍可用 |
| 用户取消，且没有存点 | 已取消阅读。 | 留在当前片子，不破壁 |
| 课程说明为空 | 这次没有课程文本。 | 保持所选片子，可继续阅读 |
| 课程说明超过 8000 字 | 请把课程说明缩短到 8000 字以内。 | 不发送超长正文 |
| 下一处未就绪 | 还在读 | 时间与覆盖层不变 |
| 没有更晚的已存点且阅读已结束 | 没有下一处 | 时间不动，按钮禁用 |
| 阅读点已进入交互 | 这次阅读 | 不得出现「识别结果」 |
| 用户选择预设后的单点演示 | 预先准备的示例 | 只在 `breakglass-demo-9s.mp4` 上 |

## 验收片子

阅读路径的片子地址不得等于或以其结尾为 `breakglass-demo-9s.mp4`。这个文件只通过「选择预设」加载；文件缺失时，预设播放不得记为成功。阅读失败不更换当前视频。

## 计时与对齐

必须能分别读到：

- 第一处出现的毫秒数。
- 点破壁到覆盖层出现的至少 20 次热状态样本，及其 P95。通过线是 P95 ≤ 100。
- 每次「下一个」按下前的 `currentTime`、落定后的 `currentTime`，以及中间破壁禁用。
- 破壁后的 `contentRect`，以及 `maxRatio` ≤ 0.02。

页面已分别记录 `lesson-wake-dom-ready` 和 `lesson-wake-frame-ready`。后者以双 requestAnimationFrame 提供一次绘制机会，不是硬件像素呈现时间戳；没有真实浏览器截图、设备和独立对齐证据时，不能凭该估计宣称验收通过。契约写明通过线，不表示已经测得。

## 不在本契约内

- 不改变 `createWake` 的参数和 `fallbackAfterMs: 1500`。
- 不定义外部服务的实现。
- 不授权破壁或「下一个」时补送画面。
- 不授权把第 6 秒的预制曲线画到尺寸不符的帧上。
