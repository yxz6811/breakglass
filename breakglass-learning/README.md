# 本机开发账号与学习记录

该模块提供真实的本机开发账号和 JSON 持久化，与无状态视觉 reader 分离。它不启动 HTTP listener；宿主只能监听 loopback，并调用：

```js
import { createLearningHandler } from './breakglass-learning/src/server.mjs';
const handleLearning = createLearningHandler({
  // 可选 dataDir：仓库外的绝对路径；省略时使用系统临时目录。
  allowedOrigins: ['http://127.0.0.1:4173', 'http://localhost:4173']
});
// await handleLearning(req, res) 为 true 时，响应已由 API 接管；否则继续静态站处理。
```

省略 dataDir 时使用系统临时目录下的 `breakglass-learning-development`。显式目录必须为仓库外绝对路径；实际目录不得通过符号链接进入仓库，数据文件不得为符号链接。单进程通过串行事务、临时文件 fsync 和原子 rename 写入 `accounts-v1.json`；损坏数据失败关闭，不覆盖旧文件。不支持多个进程共同写同一数据目录。

用户名为 3–32 个 Unicode 字母/数字或 `._-`，NFKC 正规化并转小写。密码 8–128 个 JS 字符、UTF-8 至多 512 字节且无控制字符。密码采用随机 16 字节 salt 和 scrypt（N=16384、r=8、p=1、64 字节 hash）；不保存明文。会话仅保留内存中的 opaque token 哈希，cookie 为 HttpOnly/SameSite=Strict/Path=/api；运行时重启需要重新登录，账号和学习数据保留。

所有写请求要求明确允许的 Origin；登录后的写入还要求 `X-BreakGlass-CSRF`。register/login 没有既有会话 token，采用 Origin 检查；登录错误使用同一文案并有失败次数限制。账号响应不包含密码、hash、salt 或 opaque cookie token。

## API

| 接口 | 请求/结果 |
| --- | --- |
| POST `/api/account/register`、`/login` | `{username,password}` → `{user:{id,username},csrfToken,epoch}`；register 为 201，login 为 200 |
| POST `/api/account/logout` | 空体或 `{}` → `{ok:true}`，撤销当前会话 |
| GET `/api/account/me` | 匿名 `{user:null}`；登录后 `{user,csrfToken,epoch}` |
| GET `/api/learning/records` | `{records,epoch}` |
| PUT `/api/learning/records/:id` | `{record,expectedEpoch}` → `{record,epoch}`；路径 id 与完整 record.id 一致；同值幂等、同 id 不同值为 409 |
| DELETE `/api/learning/records/:id`、`/records` | `{expectedEpoch}` → `{ok:true,epoch}`；清除关联 attempts，推进账号 epoch |
| GET `/api/learning/watch` | `{items,epoch}` |
| PUT `/api/learning/watch/:sourceId` | `{source,time,duration,expectedEpoch}` → `{item,epoch}` |
| POST `/api/learning/attempts` | `{recordId,answer,hintUsed,expectedEpoch}` → `{attempt,expectedAnswer,epoch}` |
| GET `/api/learning/attempts` | `{attempts,epoch}`；可用 `?recordId=...` 过滤 |
| GET `/api/learning/export` | `{schemaVersion:'1',user,epoch,records,watch,attempts}` |
| DELETE `/api/account/data` | `{expectedEpoch}` → `{ok:true,epoch}`；清空当前账号 records/watch/attempts，保留账号登录凭据 |

记录采用扩展共享的 `validateRecord`/`validateSource` 和 canonical 数学校验；无媒体、完整讲解、URL 或凭据字段。观看 duration 和记录 time 均最多 600 秒。用户可明确保存 `permission-pending` 文件的私人观看位置，只有经过结构验证的 source/time/duration/updatedAt；这不授予原文件的 AI 处理许可，pending 数学记录和视觉处理仍拒绝。每个账号至多 500 条记录、100 个观看来源、2000 次复练；本机至多 50 个账号，数据文件至多 8 MiB。匿名插件记录不自动导入账号。

复练只检查已有记录的直角三角形斜边或抛物线顶点。triangle answer 为有限 number，parabola answer 为 `{h,k}`。程序使用 `Math.hypot` 或快照 h/k 判定，不依赖模型：斜边容差为 max(1e-9, |答案|×1e-6)，顶点绝对容差 1e-9。attempt outcome 为 `wrong`、`correct_with_hint` 或 `correct_independent`；普通疑问/易错标记不会因此被改名为实际错题。

稳定错误包括 401 `unauthenticated/invalid_credentials`、403 `forbidden_origin/csrf_rejected/loopback_only`、409 `epoch_conflict/record_conflict`、413 `payload_too_large/storage_full`、429 `rate_limited`；损坏或不可写存储返回 503，不泄露目录。所有 API 响应 no-store。请求最多 64 KiB，注册/登录最多 2 KiB；注册与登录每 IP 最多 20 次/分钟，账号+IP 连续 5 次登录失败后 15 分钟内拒绝后续登录。

验证命令：`npm test`（本目录）或 `node --test breakglass-learning/tests/*.test.mjs`（仓库根）。这些测试验证真实本机 HTTP/账户/文件持久化，不代表正式地区发布、监护、跨境、安全审计或学习效果验收。本模块不读取模型密钥，也不提供云部署。
