# 当前帧曲线按需识别：需求、方案与验收计划

日期：2026-10-03。状态：已授权独立增强；实现和实际测试结果另行记录，本计划不宣称真实模型或完整产品验收通过。依据 [AGENTS 第 0 节](../AGENTS.md)、[产品 Constitution 1.8.0](./BreakGlass-constitution.md) 和 [Spec Constitution 1.10.0 原则 IX](../.specify/memory/constitution.md)。

## 用户需求与边界

用户指出“曲线模式用自己的视频不能自由破壁”，随后明确目标为“任意暂停帧自动识别画面曲线”。旧页面只在 003 预读已命中的稀疏点打开结果，改目标时间不产生新识别。此次增加按需单帧流程：用户自行暂停到所需时刻，显式点击同一个「破壁」按钮；有匹配缓存就直接打开，否则识别这一帧，通过校验后进入原有交互。

“任意暂停帧”指不受预读采样点限制，不表示所有视频或曲线都能识别。首版 reader 仍只支持清晰录屏或固定机位课件中一条完整抛物线。004 的直线、圆、正弦为本地探索，005 直角三角形工作台保持独立。介绍站、原任务勾选与历史报告不在本次变更范围。

## 复用与实施位置

| 位置 | 职责 |
| --- | --- |
| `extension/src/curve/current-frame.js`（本次新增） | `BreakGlass.currentFrame` 单帧请求构造、严格响应适配、本机 URL 校验、30s 等待与取消；UMD 可供浏览器和 Node 测试使用 |
| `extension/src/page/main.js` | 同一破壁入口区分缓存打开与按需请求；采集舞台当前帧；绑定媒体代次，取消旧请求，显示等待、原因与重试；校验成功后接 `mountWake` |
| `extension/src/lesson/reading.js` | 复用既有阅读/曲线校验；不改 003 采样或「下一个」规则 |
| `extension/src/session/{session,wake}.js` | 同一 `SessionController/createWake` 通过显式 `cachedReading: true` 与 `startCached` 打开已校验缓存；参数交互不变，不创建另一套工厂 |
| `breakglass-reader/src/{server,read,model,geometry,locate,jpeg}.mjs` | 已有 `POST /read` 支持 1 到 8 帧；本次提交恰好一帧，复用供应商接线、抛物线候选和源像素映射，不新建服务 |

当前帧请求的等待状态属于页面适配层，不能提前进入 `createWake` 等待 30s。成功候选缓存后才以 `createWake({ cachedReading: true, ... })` 调用 `startCached({ paused, currentTime, frameSize })`，返回形状与 `start` 一致。规则层先校验缓存编号、视频、精确目标时间与源画幅，再装订会话；当前播放位置仍沿用 ±0.2 秒暂停门禁。该入口不缩放结果，不读取 `enableLocalMock`，不启动 1500ms 看门狗、打包识别样例或演练替身。原 `start`、会话状态、参数和 `CurveResult` 字段保持不变；页面不直接调用 `beginWait/resolve/fail`。

## 复用的请求和响应

端点为本地 `POST /read`，`Content-Type: application/json`。完整旧服务契约见 [reading-service.md](../specs/003-preplay-lesson-points/contracts/reading-service.md)，以下只收敛新增单帧调用。

请求结构示意；JPEG 字符串为占位，不是可运行的测试图片：

```json
{
  "readingId": "frame-read-1",
  "videoId": "current-video-1",
  "duration": 12,
  "frameSize": { "width": 1920, "height": 1080 },
  "courseText": "",
  "frames": [
    { "time": 4, "image": "data:image/jpeg;base64,..." }
  ]
}
```

- 这六个顶层字段必需，拒绝额外字段；不提交地址、密钥、prompt、模型名、schema 或整段视频。请求和 JPEG 均受 4MiB 上限约束。
- `readingId/videoId` 为本次内存生成的非空标识，不能把用户视频改成 `fixture-parabola`。`duration` 为正有限秒数，源宽高为正安全整数；`courseText` 可空，最多 8000 码点。
- `frames` 恰好一项 `{time,image}`；时间为本次实际暂停帧，有限且在 `[0,duration]`，允许 0 秒和终点，不要求属于 003 采样表。JPEG 宽不超过 640，保留画幅，检查 data URL、base64 与 JPEG 头；源尺寸不能写成 JPEG 的缩小尺寸。
- 单帧地址只接受本机 HTTP(S) `localhost/127.0.0.1/[::1]` 的根或 `/read`；根规范化到 `/read`。远程地址、带凭据、query、hash 或伪装主机拒绝。这个规则不改变 003 旧地址契约。

响应顶层必需 `readingId/videoId/duration/origin/points`，只额外允许 `dropped: [{reason:string}]`。编号、视频绑定和时长与请求完全一致，`origin` 必须为 `external`；`points` 必须恰好一处合法抛物线。

| 点字段 | 单帧适配要求 |
| --- | --- |
| `id/time/lessonLine/curve` | 点仅含这些字段；id 非空，time 精确等于发送时刻，lessonLine 为 1 到 80 码点 |
| `curve.requestId` | 等于 `readingId + ':' + point.id`，不能来自其他请求 |
| `curve.videoId/time/frameSize` | 匹配请求视频、点时间和源宽高 |
| `curve.source/fallback` | 沿用既有 `/read` 的 `preset/null`，不新增来源枚举或写 `packaged-sample` |
| `curve.definition` | 仅合法抛物线定义、a/h/k 参数和 domain/range/region 等白名单字段；有限值、范围、源像素区域须通过现有校验 |
| `curve.confidence` | 可选，沿用现有合法门槛，不编造可信度 |

适配器严格校验后返回点的副本；无点、多点、未知结构、身份不符、错误时间、错尺寸、不支持的曲线、无效参数或越界区域均拒绝。`source: preset` 表示旧缓存绘制格式，外部请求来源由 `origin: external` 与本次请求绑定判断；界面显示“当前帧识别”，不能解释为包内预设识别了用户视频。

## 页面接线与取消

1. 先确认配置已加载、媒体可解码、已暂停、没有 seek、时长/源尺寸/时间有效。当前帧匹配已校验缓存时直接打开；否则地址合法后才请求一帧。加载或暂停本身不自动发起这一单帧请求。
2. 请求前冻结视频源、视频绑定、时间、源尺寸、request token 与媒体 epoch。直接在舞台视频上截图，避免隐藏采样视频的 seek 改变这次含义。显式当前帧操作开始后，旧预读回调不得抢走当前时间或覆盖层。
3. 请求期间提供取消与退出，并允许播放或定位等显式操作作废旧请求。非法输入先校验，不能误取消有效状态；重复点击不重复调用供应商。
4. 成功时再检查 token、epoch、视频源、实际时间、源尺寸、暂停、非 seek、无媒体错误，再交给原 `mountWake/createWake`。只比较“现在又回到同一秒”不足以接纳旧结果。
5. 原生 `play/seeking`、合法定位、换视频、地址变更、取消、退出、媒体错误及 `pagehide` 均取消对应请求并推进代次；AbortSignal 和代次门禁共同拒绝迟到结果。最终释放时清理看门狗与 handle，不能离开页面后重新挂曲线。
6. 失败、空地址、无点、超时或校验拒绝时保留当前视频，说明原因并允许显式重试。绝不用 `demo-parabola` 替换无效结果或自动换回示例片。包内示例和已有有效缓存保留各自原流程。

## 时间预算与外部依赖

| 环节 | 预算与口径 |
| --- | --- |
| 当前帧识别 | 页面等待 30s 开发默认；取消/超时传给已有 reader 与上游，真实预跑后再冻结；不写成已测耗时 |
| 003 开播前阅读 | 保持 300000ms，最多 8 张稀疏帧；点击已有缓存和「下一个」不补送帧 |
| 原曲线唤醒 | 保持 `fallbackAfterMs: 1500` 与原本地预制规则；不能用无关预设兜底用户帧 |
| 已缓存曲线绘制 | 单独记点击到 DOM/绘制机会；不得混入识别等待，也不能把双 rAF 当实际像素呈现 |

模型密钥只在已有 reader 环境，供应商指令和 Schema 在服务端，不新增依赖或后端。实际识别依赖已配置模型、可用网络和合法供应商响应；浏览器 CORS/本机网络策略、供应商数据保留政策、画面可读性仍需验证。ffmpeg 沿用 reader 已有可选像素定位路径，缺失时不能声称已测该路径。

## 验证门槛

| 层次 | 必须证明 | 不能由它推出 |
| --- | --- | --- |
| `tests/current-frame.test.js` | 单帧请求和本机 URL、严格响应/编号/时间/尺寸/字段校验、30s 超时、取消和迟到拒绝 | 真实供应商准确率或帧内容识别成功 |
| `tests/page-current-frame.test.js` 与页面 harness | 未采样的暂停时刻可显式请求；正确结果进入原交互；播放/seek/换片/取消/地址变化/卸载后旧结果无效；失败不挂示例；重复点击不多发请求 | 浏览器真实视频解码、原生媒体时序、完整 MV3 或像素性能 |
| 原 `page-lesson/page-p2/lesson-ask/lesson-reading/wake` 回归 | 原预读、缓存打开、包内示例、参数交互与 300s/1500ms 规则保持独立 | 旧未通过任务已经完成 |
| 目标浏览器操作 | 自己视频上非预读时刻的请求、暂停/定位/播放/取消/重试/换片、全屏与退出，当前时间和来源可追溯 | 未测设备、DRM、跨域 iframe 或任意网站都兼容 |
| 真实模型与独立画幅/性能记录 | 合法抛物线和无曲线/不支持样本分别验收，记录配置与响应校验；另测四画幅 2% 对齐及真实像素呈现 | 全部视频都可识别、模型无幻觉或长期学习效果提升 |

本计划不填测试数量或通过状态，不修改任何旧任务勾选与历史报告。根代理在本次实际执行后记录命令、结果、修复和未验证范围；真实模型、完整 MV3 和像素验收保持独立。
