# breakglass-reader

BreakGlass 演示页「开播前阅读」用的外部服务。页面把一支片子稀疏截下的至多 8 张画面发过来，服务逐张交给多模态模型读出抛物线，再回成页面能收下的点。

源码放在本仓库的 `breakglass-reader/`，不打进扩展包。密钥只留在本目录的 `.env`，该文件已忽略，不会提交。接口以 `specs/003-preplay-lesson-points/contracts/reading-service.md` 为准。

## 现在到哪一步

- 已经做完：请求校验、读 JPEG 尺寸、调 OpenAI 兼容接口、由锚点算区域、用扩展自带的 `reading.js` 自检、跨域、日志不留画面和课程正文。
- 测过的：本目录 `npm test`（模型是不联网的替身）；用一个不看图、按秒数作答的本机替身模型，把演示页、服务和破壁连起来跑过一次，记录在 `docs/BreakGlass-frontend-validation.md` §7。
- 用智谱 `glm-4.6v-flash` 读过 9 秒片的一帧：方程读成 `y = x² + 1`，像素锚点对不上画面，这一帧被丢掉。这不代表 SC-003、SC-004、SC-005 或 2% 对齐已经通过。

## 准备

- Node 22.9 或更新（用到 `--env-file-if-exists`、`AbortSignal.any`）。没有第三方依赖，不用 `npm install`。
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
4. 一处都没读到、模型连不上或超时，页面按自己的规则换回 9 秒片。

默认放行任意 `chrome-extension://` 页面和 `http://127.0.0.1`、`http://localhost`。想只放行自己装的那份扩展，把 `READER_ALLOW_ORIGINS` 写成 `chrome-extension://<扩展编号>`。

## 一帧怎么读

1. 读出 JPEG 宽高，和请求里的源尺寸比一下比例，对不上就丢掉。
2. 问模型一次（温度 0，不重试）：有没有一条能对上坐标轴的抛物线；顶点式 `a`、`h`、`k`；至少 3 个「数学坐标 ↔ 图片像素」的锚点；曲线画出的横坐标两端；一句讲解。
3. 用锚点拟合出坐标映射。最远的锚点偏离超过 JPEG 短边 2% 时，说明模型前后读数不一致，整帧丢掉。这只能挡掉自相矛盾的回答，挡不住模型整体看错。
4. 把要画的那段曲线放进画面，算出 `domain`、`range`，区域乘回源像素。
5. 拼成点，交给扩展自己的 `validateLessonReading` 再查一遍，过了才回。

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
