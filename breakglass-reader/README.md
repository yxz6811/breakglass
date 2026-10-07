# breakglass-reader

BreakGlass 演示页「开播前阅读」用的外部服务。页面把一支片子稀疏截下的至多 8 张画面发过来，服务逐张交给多模态模型读出抛物线，再回成页面能收下的点。

源码放在本仓库的 `breakglass-reader/`，不打进扩展包。密钥只留在本目录的 `.env`，该文件已忽略，不会提交。接口以 `specs/003-preplay-lesson-points/contracts/reading-service.md` 为准。

## 现在到哪一步

- 已经做完：请求校验、读 JPEG 尺寸、调 OpenAI 兼容接口、由锚点算区域、用扩展自带的 `reading.js` 自检、跨域、日志不留画面和课程正文。
- 测过的：本目录 `npm test`（模型是不联网的替身）；用一个不看图、按秒数作答的本机替身模型，把演示页、服务和破壁连起来跑过一次，记录在 `docs/BreakGlass-frontend-validation.md` §7。
- 用智谱 `glm-4.6v-flash` 读 9 秒片时，方程能读成 `y = x² + 1`，但像素锚点经常落在画面外面或互相矛盾。服务在方程成立时改为在 JPEG 里寻找和这条方程重合的细线，不再只用模型报的像素。这不代表 SC-003、SC-004、SC-005 已经通过。

## 准备

- Node 22.9 或更新（用到 `--env-file-if-exists`、`AbortSignal.any`）。没有第三方依赖，不用 `npm install`。在画面里找曲线需要本机有 `ffmpeg`；没有时仍只用模型给的锚点。
- 默认从旁边的 `extension/` 读取页面规则。目录不在仓库里的这个位置时，用 `BREAKGLASS_EXTENSION_DIR` 指向 `extension`。
- 一个能看图片的模型，以及它的 OpenAI 兼容地址和密钥。

```bash
cp .env.example .env
# 编辑 .env，填 READER_BASE_URL、READER_API_KEY、READER_MODEL
npm start
```

启动后会打印 `阅读服务：http://127.0.0.1:8787/read`。`GET /health` 只回 `{ ok, modelConfigured }`，不带密钥。

几个常见的兼容地址（型号和能不能收图片以服务商文档为准）：

| 服务商 | READER_BASE_URL | READER_MODEL 例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| 阿里云百炼（通义） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v-flash` |

只收文字的模型用不了：请求里带的是图片。

## 在演示页里用

1. 加载 BreakGlass 扩展，打开演示页。
2. 「阅读地址」填 `http://127.0.0.1:8787/read`。
3. 选一支自己的片子（不是 `breakglass-demo-9s.mp4`）。页面隐藏采样后发一次请求，第一处读好就停在那一帧，按破壁会显示「这次阅读」。
4. 一处都没读到、模型连不上或超时，页面保留用户选中的片子并清空失败阅读的点。9 秒示例只在点击「选择预设」后播放。

默认放行任意 `chrome-extension://` 页面和 `http://127.0.0.1`、`http://localhost`。想只放行自己装的那份扩展，把 `READER_ALLOW_ORIGINS` 写成 `chrome-extension://<扩展编号>`。

## 一帧怎么读

1. 读出 JPEG 宽高，和请求里的源尺寸比一下比例，对不上就丢掉。
2. 问模型一次（默认温度 0，不重试）：有没有一条有明确数值依据且能对上坐标轴的抛物线；一般式 `a/b/c` 或顶点式 `a/h/k`；至少 3 个「数学坐标 ↔ 图片像素」的锚点；曲线画出的横坐标两端；一句讲解。一般式由程序按 `h=-b/(2a)`、`k=c-b²/(4a)` 换算，不要求模型自行配方。题面数值不清或仅有无刻度外形时应拒绝，不猜成 `y=x²`，课程文字不能补截图缺失数学标注。
   公式只接受严格 general/vertex 字段和兼容旧 `{a,h,k}`。每原始及换算后系数绝对值不超过 `1e6`，`abs(a)>=1e-6`，并继续页面有限域校验；accessor、原型/未知字段、字符串、非有限值和溢出拒绝。这是候选合法性校验，不能证明模型读对题面。
3. 有本机 `ffmpeg` 时先把 JPEG 解成 RGB，在画面里寻找和方程重合的细线；成功时用实际像素得到的区域。没有 ffmpeg、解码失败或找不到线时，再用模型锚点拟合坐标映射。锚点最远偏离超过 JPEG 短边 2% 时，说明读数不一致，整帧丢掉。模型的横坐标端点仅在锚点路径使用，并须通过上述数字类型检查。这些检查不能证明模型整体看准了画面。
4. 把要画的那段曲线放进画面，算出 `domain`、`range`，区域乘回源像素。
5. 拼成点，交给扩展自己的 `validateLessonReading` 再查一遍，过了才回。

滑块初值保留模型给出的数值精度。`a` 的可调范围保持原来的正负号，步长按系数量级缩小；例如 `a = 0.0001` 使用 `0.00001` 步长，初值不会被舍入成零。范围两端都与初值相隔整数步，避免原生滑块把不在步栅格上的读数自动吸附成另一数值。

页面取消、换片或断开连接后，服务会把取消信号传给正在进行的模型请求，终止尚未完成的本机 JPEG 解码，停止领取后续帧，也不向已经关闭的连接写响应。限流等待中取消同样不再问下一次。阅读预算截止同样会终止解码。实际模型是否已经停止计算取决于模型服务是否配合取消；本地服务不把失败帧重新排队。

## 失败时回什么

| 情况 | 状态 |
| --- | --- |
| 请求形状不对、或是演示夹具 | 400 |
| 来源不在名单里 | 403 |
| 不是 `application/json` | 415 |
| 请求超过 10 MB | 413 |
| 没配模型 | 503 |
| 每一帧都连不上模型、被拒或超时 | 502 |
| 其余（包括一处都没读到） | 200，`points` 可能是空的 |

`dropped` 里是每一帧丢掉的原因代码，方便排查；页面不读它。

## 日志与数据

服务不存东西。每次阅读打一行 JSON：`readingId`、帧数、点数、各原因的计数、耗时。不打印 data URL、课程正文和密钥。

## 测试

```bash
npm test
```

用的是不联网的模型替身和 `tests/helpers/fixtures/` 里一张 640×402 的截帧（来自 `breakglass-demo-9s.mp4` 第 6.451 秒）。

回归测试覆盖严格数值类型、小系数保留、主动取消、上传期间断开，以及不配合取消的迟到模型响应。这些测试不代表真实模型识别或四种画幅的 2% 对齐验收已经通过；产品边界仍遵守 [`docs/BreakGlass-constitution.md`](../docs/BreakGlass-constitution.md)。

JPEG 取消测试使用受控子进程替身。真实 RGB 解码及像素定位用例需要本机 `ffmpeg`；没有该依赖时只能验证锚点路径，不能宣称像素定位用例通过。

## 011 reader能力配置与响应读取

服务端 `recognition-profile-v1` 同时用于旧曲线、几何及复用几何入口的学习read/context/summary。`.env.example` 列出有限选项：`READER_TEMPERATURE_POLICY=fixed|omit`、`READER_TEMPERATURE` 严格0～2（默认0）、可选有限 `READER_REASONING_EFFORT` 与 `READER_IMAGE_TRANSPORT=inline|public-url`。默认仍发送temperature=0；omit不发送它，未配置reasoning不发送。未知值拒绝，基础地址/密钥/模型留空不调用供应商，不重试、不自动挑选其他模型。

能力配置须依据具体供应商入口核对。当前画面以inline JPEG data URL发送；public-url策略收到它会在调用前明确拒绝，不自动托管或公开画面。这些选项不证明任意同名模型兼容。JSON mode只控制请求输出选项，仍须严格数学和身份校验。非秘密profile identity用于网关缓存版本，密钥不进入该identity；ASR配置独立。

两模型入口共用64KiB上游响应限制：真实字节流在JSON解析前累计，超限即取消；仅提供json的测试替身也检查UTF-8长度。abort race结束不配合取消的等待，迟到响应不解析为成功。旧曲线保留容忍代码块的内容解析，几何/学习保留纯JSON严格解析；旧公开错误code/envelope和各时间预算保持。配置/传输失败只返回安全原因，错误不暴露完整供应商内容。

相关测试：`node --test breakglass-reader/tests/equation-normalise.test.mjs breakglass-reader/tests/model-profile.test.mjs breakglass-reader/tests/provider-payload.test.mjs`（从仓库根执行）。使用自制系数、Web可读流和不联网替身，不等于真实模型、无刻度拒绝质量、像素标定或四画幅2%验收通过。011新共享识别通道、可信定位和sidecar由独立模块实施，此处不宣称已经完成。

## 005 当前帧直角三角形（独立接口）

已增加 `POST /geometry/read` 与 `POST /geometry/ask`，使用同一进程、来源白名单和模型环境配置；既有 `/read` 的请求、抛物线响应与 10 MiB 上限保持不变。契约见 [005 scene-actions](../specs/005-insitu-right-triangle/contracts/scene-actions.md)。这些接口已经过本地替身模型和 HTTP 管线测试，**尚未使用真实模型验证当前几何帧**；不能称为任意视频识别。

| 接口 | 接收 | 返回与边界 |
| --- | --- | --- |
| `/geometry/read` | `schemaVersion: 1.0.0`、`requestId`、`videoId`、`frameTime` 秒、源 `frameSize`、单张 JPEG `image` | 一个 A 为直角、AB/AC 明确数值和同单位的候选。模型坐标须为 JPEG 像素，服务映射回源像素并通过浏览器同一套 SceneResult 校验；BC 不接受上游权威值，不从截图比例猜边长 |
| `/geometry/ask` | `schemaVersion`、独立 `actionRequestId`、完整已确认 `scene`（`sceneRevision >= 1`）、1～2000 码点 `text` | `set_length` / `explain_change` / `restore_original` 白名单与固定场景 context；每批至多改一条直角边。单位冲突、双边修改、改斜边、未知动作或派生溢出拒绝，模型解释文本和答案数字不返回为计算依据 |

`/geometry/read` 的输入 JPEG 宽度不得超过 640；画幅须与源尺寸一致，允许 JPEG 高度取整 1 像素。请求严格拒绝未知字段，尤其是浏览器送入的模型、prompt、Schema、密钥和伪造来源。结构合法只产生“待校对”候选，用户确认后才能提问。手动场景可以不声明截图顶点，但身份、两条边、单位和修订号仍需合法。

两条几何接口各自最多 **4 MiB**（包含 JSON/base64），超过上限回 413 且不调用模型；与 `/read` 的 10 MiB 区分。默认识别截止 30000ms、问答截止 10000ms，可用 `READER_GEOMETRY_READ_BUDGET_MS` / `READER_GEOMETRY_ASK_BUDGET_MS` 设置 1000～120000 的十进制整数，无效值回默认。这是开发预算，待真实素材测试冻结，不代表实测识别延迟。模型响应另外限制为 64 KiB。

每次识别/提问最多一次上游调用，不自动重试。客户端断开、预算截止使上游信号中止；不配合取消的迟到回复也不会重新产出成功结果。未配置模型回 503、模型传输或结构错误回 502、预算耗尽回 504；不支持帧/不清楚条件分别回 `unsupported` / `needs_review`，问答歧义回 `needs_clarification`，不伪装为已执行。几何日志只记操作类别、状态代码和耗时，不记录 JPEG、问题全文或密钥。

同样在本目录执行以下现有 Node 测试命令即可只核对几何与旧路由回归，不需要安装依赖或 ffmpeg：

```bash
node --test tests/geometry-read.test.mjs tests/geometry-ask.test.mjs tests/server.test.mjs
```

当前测试使用本机 HTTP 服务和不联网的模型替身，覆盖坐标映射、严格字段/数值、4 MiB、取消/迟到、独立截止、来源/PNA、未配置模型和 `/read` 回归。真实候选正确率、10～15 份素材、浏览器校对及学习闭环按 [005 quickstart](../specs/005-insitu-right-triangle/quickstart.md) 另记；本服务不保存原题快照或判定用户已理解。

## 006 持续视觉与画面摘要（2026-10-06）

复用本机无状态reader，新增`POST /learning/read`（单帧JPEG、最多640px宽/4MiB）与`POST /learning/summarize`（最多20条短结构观察/64KiB）。每类最多一个请求，单次模型调用、不自动重试；服务端开发截止各30s，扩展客户端25s。新预算与旧`/read`/003/005分开。

继续使用本目录`.env.example`所示的供应商设置；未配置返回503，不伪装识别成功。模型密钥仅在reader，画面/观察内容不写日志或学习记录。006仅受控自制素材可启用，B站处理授权待确认。当前没有音频、字幕或整视频文件理解；后台摘要只覆盖所列画面观察。接口见[006契约](../specs/006-plugin-learning-layer/contracts/plugin-learning.md)，范围及实际替身/MV3/真实模型状态见[验证记录](../docs/BreakGlass-continuous-vision-validation-2026-10-06.md)。

## 几何自动阅读（原则 XVIII，`POST /geometry/lesson`）

已增加 `POST /geometry/lesson`，仍是本进程、本机回环和同一套模型环境。它不复用 `POST /read` 的抛物线结果，也不复用 `POST /geometry/read` 的单帧直角三角形，也不复用上面的 `/learning/read`。契约见 [geometry-lesson-service](../specs/006-auto-geometry-lesson/contracts/geometry-lesson-service.md)。这条规格目录名里的 006 与插件持续视觉的 `specs/006-plugin-learning-layer/` 不是同一切片。

| 项目 | 边界 |
| --- | --- |
| 请求 | `schemaVersion: 1.0.0`、`readingId`、`videoId`、时长、源 `frameSize`、1～8 张间隔至少 1 秒的 JPEG。可选 `courseText` 最多 8000 字 |
| 图形 | 一帧只接受一个直角三角形、圆或线段。长度来自画面标记，斜边由服务按 `Math.hypot` 计算。模型自报的斜边、像素比例和 3-4-5 填空都不进入结果 |
| 体积与失败 | 整包 10 MiB，与 `/read` 相同。`/geometry/read` 和 `/geometry/ask` 仍是 4 MiB。未配置模型回 503。送去模型的帧全部连不上回 502。空的合格结果回 200，并在 `dropped` 里写明原因 |
| 身份 | 响应回显 `readingId`、`videoId`、`duration`，并带 `origin: external`。`fixture-parabola` 直接拒绝 |

下面的命令只跑替身。通过不代表真实模型、热缓存 20 次或任意视频已经验收：

```bash
node --test tests/geometry-lesson.test.mjs
```
