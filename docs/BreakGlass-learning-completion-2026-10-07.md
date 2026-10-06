# 009 学习功能补齐与交付边界

日期：2026-10-07。治理为两份 Constitution 2.5.0；本轮按用户“完成”执行已有规划的开发任务。参照介绍站的暗色、青色、品牌 SVG 与现有控件实现，没有新增远程 UI 依赖。代码完成、替身流程、实际浏览器、真实模型、真实平台和上线分别记录。

本轮状态以 [009任务](../specs/009-learning-completion/tasks.md)、[契约](../specs/009-learning-completion/contracts.md)和[验证记录](BreakGlass-validation-learning-completion-2026-10-07.md)为准。006–008及历史P0/003/005验收继续保留。

## 产品功能与界面对齐

| 功能 / 界面 | 当前实现和入口 | 可检查结果 |
| --- | --- | --- |
| BG-F06 / BG-U10 | 疑问与易错卡片的“编辑备注 / 易错原因” | 本机或当前账号修订标题、备注、类型与原因标签；原数学条件、来源、时间和实际作答保留。409冲突保留输入，需明确重新读取。 |
| BG-F02 / BG-U03、U13 | 视频工作台“开始分段分析”、暂停、继续、清除缓存 | 当前位置片段优先；已完成片段可立即查看，未分析区保留缺口。任务最多20个30秒片段/600秒，默认每片段4个代表帧；暂停不悄悄新建任务。 |
| BG-F05/F07/F08 / BG-U05、U06、U11 | 理解复练页的手工数学、可跳过基础诊断、参数预测、提示与独立变式 | 直线、圆、正弦、相似三角形、长方体新增五种手工模板，与已有抛物线/直角三角形共七种。实际提交才产生作答凭据。 |
| BG-F05 / BG-U05、U11 | 数学主图下的粒子观察与视角重置 | 平面函数保留二维坐标；长方体按明确长宽高绘制真实三维边线。粒子与SVG共用数学状态，WebGL不可用仍可绘图和作答。 |
| BG-F12 / BG-U13 | 视频工作台“可选短音轨转写” | 仅显式选择登记素材内≤30秒范围，独立转写候选标明覆盖时间与需校对；不自动生成数学事实或完整课程摘要。 |
| BG-F09/F11 / BG-U12 | 发布配置检查与试点运行入口 | 默认本机。试点须有具体HTTPS来源、外部数据目录、运营/地区/受众/有效证据和账户审批；配置或审批不符时拒绝启动或访问。 |

学习概览使用真实零值和最近作答状态，观看位置只表示继续观看入口。七个知识节点的基础诊断与普通复练分开计数；先修关系可查看但可跳过。提示渐退和7/14/28天复练是依据现有记录的产品建议，学生可展开全部提示，不等于已证实的最佳教学策略或掌握率。

## 输入和运行限制

新五模板只接受学生手工条件，视觉模型候选仍只有抛物线和直角三角形。新题保存独立ID；参数探索不改原题，修改数学条件必须另存新题。模型不生成可执行脚本、HTML或shader。

分段沿用独立本地解码，不抢播放头；学生明确点击片段候选后才定位。与实时视觉共用单在途槽。原008片段会话4次调用保持不变，009任务独立最多20次，30分钟截止。当前实际浏览器素材仅12秒，不把600秒上限视为长课质量或耗时已验收。

私有缓存最多40条、2MiB、24小时，含来源/数学分析版本、供应商非秘密版本、字幕指纹及帧时刻/指纹。只存结构化候选，不存截图、原视频或密钥。账户缓存存仓库外；本机访客缓存仅服务内存且绑定浏览器HttpOnly随机标识。每次复用核对许可与身份，命中明确写“来自前次AI分析”。登录不迁移访客缓存；清除本机、清除账户分别执行，清除服务未确认时保留状态并暂停访客复用，用户可重试。

短音轨只由服务端素材登记选择文件路径并核对完整指纹。固定FFmpeg通过内存管道生成16kHz单声道PCM16 WAV，每次≤1MiB；关闭shell/stdin，无临时音频文件。单会话最多2次、全服务默认4次/小时，单在途、整体30秒截止。无音轨、配置空、未知素材、范围越界、取消或账户/许可变化都不会冒充成功。供应商若不遵守取消，已发送数据仍按其实际政策处理，客户端不能承诺召回已经送出的内容。

## 可配置服务

在仓库根运行 `node --env-file-if-exists=breakglass-reader/.env scripts/learning-site.mjs`，打开本机4174学习中心。`.env`中的地址、模型、密钥均可留空，预览、手工数学、笔记和实际复练仍可用；配置空的AI入口明确不可用。密钥不发对话、不入库、不交给浏览器。

视觉沿用 `READER_BASE_URL`、`READER_API_KEY`、`READER_MODEL`。可选音轨独立使用 `BREAKGLASS_ASR_BASE_URL`、`BREAKGLASS_ASR_API_KEY`、`BREAKGLASS_ASR_MODEL`、`BREAKGLASS_FFMPEG_PATH`（本机绝对可执行文件路径），`BREAKGLASS_ASR_HOURLY_CALLS`可在1–16配置，默认4。

ASR按兼容的 multipart `POST /audio/transcriptions` 接口发送 `file`、`model`、`response_format=json`，读取有界纯文本 `text`。协议依据[官方转写接口文档](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)。兼容供应商须另测协议、地区和真实数据流，接口替身不证明真实语音准确率。

## 发布准备和实际发布

`scripts/learning-release.mjs`检查仓库外绝对路径的manifest、证据文件和数据目录。可先复制[空审批示例](../specs/009-learning-completion/release.example.json)到仓库外；示例缺审批资料和账户，必定不能直接上线。清单规定具体国家、成年人/未成年人、运营主体、有效期、证据文件SHA256及获准账户UUID/地区/年龄段。未成年人须对应有效监护资料。证据内容的法律充分性、年龄核验与运营责任必须由负责人实际审查，程序只检查结构、覆盖、完整性、失效和绑定，不能代替该审查。

manifest的 `runtimeFingerprint` 绑定实际视觉/ASR的非秘密地址、模型、模式与启用状态；密钥轮换不改变指纹，换供应商或模型需重新审批。生产供应商地址只允许HTTPS或明确loopback HTTP，拒URL凭据/查询/片段，供应商请求拒绝重定向。部署操作员可在加载实际环境后计算该非秘密值：

```powershell
node --env-file-if-exists=breakglass-reader/.env --input-type=module -e "import {supplierRuntimeFingerprint} from './scripts/learning-release.mjs'; import {loadSettings} from './breakglass-reader/src/settings.mjs'; import {loadAudioSettings} from './scripts/learning-audio.mjs'; console.log(supplierRuntimeFingerprint(loadSettings(process.env),loadAudioSettings(process.env)));"
```

设置 `BREAKGLASS_RELEASE_MANIFEST`（外部manifest绝对路径）、`BREAKGLASS_EDGE_SECRET`（独立随机代理密钥≥32字符，只在服务器/代理环境），运行：

```powershell
node --env-file-if-exists=breakglass-reader/.env scripts/learning-release.mjs
node --env-file-if-exists=breakglass-reader/.env scripts/learning-production.mjs
```

检查失败退出码2，不监听。成功后默认仅监听127.0.0.1:4175，`BREAKGLASS_PRODUCTION_PORT`可指定。需要操作员部署真实TLS反向代理：精确public Host、`X-Forwarded-Proto: https`和服务端匹配的`X-BreakGlass-Edge-Secret`，代理应覆盖这些客户端同名头，后端端口不公网开放。程序会严格核对这些条件。

这是最多50个获准账户的单实例试点准备，不是已部署的云服务。账户先在受控本机管理阶段创建，运营方审核其UUID/地区/受众并纳入外部清单；试点关闭公网自助注册、guest AI和公网插件配对，不提供无审批的批量开户。生产Cookie为Secure，所有数据API核对审批；classic/progressive任务和音轨在处理、缓存写入及返回前复核，资料过期、改变或撤销则拒绝旧结果。视觉配置空不创建生产分析任务。

插件仍沿用固定本机4174权限和受控教学页。若要公网插件与多设备使用，另冻结唯一HTTPS请求地址、扩展host权限、身份/配对和平台支持，再验收发行版本；当前生产配置不会自动把本机插件改成任意域名客户端。

## 仍需独立完成的验收

| 项目 | 下一步与所需依据 | 当前状态 |
| --- | --- | --- |
| 真实视觉/ASR | 配置选定供应商，使用获准真实教学素材测准确、遗漏、纠错、延迟、成本、取消和数据政策 | 模型可留空；只完成显式替身协议和实际媒体处理验证 |
| B站及其他网课 | 确认处理许可/平台条款/获取方式，再测真实播放器、画幅、全屏、导航和撤权 | B站授权待确认，未注入、捕获或上传其视频 |
| 正式托管/地区发布 | 实际域名、TLS、数据存储/备份删除、地区/监护/供应商数据流审批和运维验证 | 已有阻断检查与运行入口，未进行公网部署 |
| 学习理解和长期复练 | 获准学生试用，记录独立新题、关键条件解释、延后复练与样本局限 | 未实施学生实验，不能宣称提升成绩已证实 |
| 旧P0/003/005 | 按各自任务完成真实模型、四画幅/2%像素和20次P95等未通过项 | 独立保留，不以009测试覆盖历史验收 |
| 完整文件云处理 | 如继续选择该可选方式，独立冻结上传、隔离解码、生命周期和数据流 | 未实现；网站本地视频与短音轨不依赖它 |
