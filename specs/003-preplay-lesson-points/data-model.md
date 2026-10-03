# Data Model: 开播前阅读

**Date**: 2026-10-02  
**Contract**: [contracts/lesson-reading.md](./contracts/lesson-reading.md)

## LessonReading

绑定当前片子的一次阅读。片子更换后整份作废。

| 字段 | 规则 |
| --- | --- |
| readingId | 非空字符串。外部回应必须等于这次请求的编号，否则整份作废 |
| videoId | 非空字符串。内存绑定。预先准备片子使用 `fixture-parabola`。其他片子不得使用该值，地址也不得是 `breakglass-demo-9s.mp4` |
| origin | 用户选择预设后的单点演示不使用本实体。阅读中的点为 `external` |
| duration | 有限数，单位秒，大于 0 |
| points | 已通过校验的点。按 `time` 升序，最多 8 个，相邻至少相隔 1 秒 |
| dropped | 只保留契约中的原因短语 |
| deadlineMs | 必须是 300000 |

状态：

1. `idle`：没有可播放片子，或切换视频后阅读点已清空。
2. `reading`：采样进行中。可以已有存点。取消进入 `ready`（已有存点）或 `idle`（一个都没有）。
3. `ready`：至少有一个存点，采样已结束或用户已取消。
4. `empty`：采样结束但一个合法点都没有。此时保留用户视频，清空失败结果，破壁不可用。示例只通过「选择预设」加载。

第一处从 `reading` 进入「已暂停在该点」，状态仍可保持 `reading`，直到采样结束。后台完成不得改写当前暂停点。

## BreakPoint

| 字段 | 规则 |
| --- | --- |
| id | 非空字符串，同一阅读内不重复 |
| time | 有限数，单位秒，0 ≤ time ≤ duration |
| lessonLine | 非空字符串，最长 80 字，同一阅读内不重复 |
| curve | CurveResult。`source` 必须是 `preset`，`fallback` 必须是 `null`，`time` 等于点的 `time`，`videoId` 等于阅读的 `videoId`，`frameSize` 等于当前片子的源尺寸 |

`frameSize` 不一致时丢掉整点，不绘制，不替换成 `demo-parabola`。不再有 `example` 成功态。

## NextTarget

相对当前已暂停的点：

| 状态 | 条件 | 用户可见 |
| --- | --- | --- |
| ready | 存在 `time` 更大的已存点 | 按钮可用。按下后先卸覆盖层，再定位 |
| pending | 采样未结束，且没有更大的已存点 | 「还在读」。时间不变，覆盖层不变，不计算 |
| none | 采样已结束或已取消，且没有更大的已存点 | 按钮禁用。「没有下一处」。时间不动 |

落定：`paused` 且 `|currentTime - time| ≤ 0.2 + 1e-9`。未落定前破壁禁用，不挂新层。

## CourseNote

| 字段 | 规则 |
| --- | --- |
| text | 字符串。允许空串。Unicode 码点最长 8000。超出则不放入请求 |

为空时仍采样，页面说明「这次没有课程文本」。

## 取舍顺序

1. 形状、来源、`fallback`、区域或 `frameSize` 不通过：丢掉，原因「抛物线没有通过检查」。
2. `videoId` 或 `readingId` 不一致：丢掉，原因「不是这一段视频」。
3. 时间缺失、非有限或为负：丢掉，原因「时间无效」。
4. 时间大于 `duration`：丢掉，原因「落在视频外面」。
5. 与已保留点相隔不足 1 秒：丢掉较晚的点，原因「和上一个点靠得太近」。
6. 合法点超过 8 个：按时间保留前 8 个，其余原因「超出八个点」。

## 计时记录

| 名称 | 起点 | 终点 | 通过条件 |
| --- | --- | --- | --- |
| lesson-first-point | 时长变为可用 | 第一处校验通过 | 单独保存。允许 ≤ 300000ms。缺失则 SC-004 未通过 |
| lesson-wake-visible | 破壁点击 | 覆盖层可见 | 已存结果的热状态。至少 20 次且 P95 ≤ 100。缺失则 SC-004 未通过 |

对齐记录沿用 `window.__breakglassAlignment`。`contentRect` 宽高为正且 `maxRatio` ≤ 0.02、`measured === true` 时，SC-005 才可核对。当前实现不满足，保持未通过。
