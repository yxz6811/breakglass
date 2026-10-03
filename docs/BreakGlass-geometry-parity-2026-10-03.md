# BreakGlass 几何工作台功能对齐矩阵与验证记录

日期：2026-10-03。状态：通用功能对齐与三段自制教学示例已实现；本轮自动化和网页验收通过，独立真实模型/MV3门槛保留。

本次将曲线工作台已有的通用操作补到005几何工作台，依据 [产品Constitution 1.7.1](BreakGlass-constitution.md)、[005增补规格](../specs/005-insitu-right-triangle/spec.md)、[计划G7/G8](../specs/005-insitu-right-triangle/plan.md) 与 [增补任务](../specs/005-insitu-right-triangle/tasks.md)。业务结果继续遵守 [SceneResult/动作1.0.0契约](../specs/005-insitu-right-triangle/contracts/scene-actions.md)。G7为12/12、G8为3/3，本轮证据如下；原005仍为部分完成，原T001～T025保持19/25。

## 对齐矩阵

| 编号 / 规格 / 任务 | 对应曲线能力 | 几何对齐目标与限制 | 本次状态 / 证据 |
| --- | --- | --- | --- |
| PAR-01 / FR-030 / T026 | Dock、常驻工具栏入口 | 005操作、来源、禁用原因与窄屏可达性；不接入createWake | 已实现；桌面/600/390px网页及监听释放回归 |
| PAR-02 / FR-031 / T027 | 快捷键与输入保护 | Alt+B只暂停保存本机帧；识别仍需点击。Esc优先全屏、问题草稿/请求、编辑保护、取消/退出 | 已实现；键盘上下文回归与网页草稿Esc；全屏原生Esc限制见下 |
| PAR-03 / FR-032 / T028 | 全屏 | 标准全屏与失败反馈，只改变显示，不改帧身份或数学条件 | 已实现；网页按钮切换，拒绝/释放后Promise测试；MV3未测 |
| PAR-04 / FR-033 / T029 | 定位、当前时间、舞台提示 | 有限非负且不超时长的秒数；seek完成后才捕获，不自动识别；区分当前/原题时间 | 已实现；合法/非法定位、pending play、seeked返回回归；真实本地片4秒操作 |
| PAR-05 / FR-034 / T030 | 请求忙碌、取消、重试 | 新requestId；同帧识别失败保留确认条件，成功candidate才换review；新捕获失效旧场景 | 已实现；替身成功/失败/取消/迟到回归；网页连接失败保留BC=5 |
| PAR-06 / FR-035 / T031 | 提问状态与恢复 | 已确认场景、新actionRequestId/revision；取消/编辑后旧回复不执行，不新增帧 | 已实现；重试新身份、原问句、编辑拒绝回归；网页重试可点击 |
| PAR-07 / FR-036 / T032 | 阅读地址会话记忆 | 独立键`breakglass.geometryReader`只存验证后的本机origin；忘记、不自动上传、存储失败可手填 | 已实现；origin/credentials/存储异常回归；网页路径参数剥离与忘记 |
| PAR-08 / FR-037 / T033 | 参数滑块 | 每次只改AB或AC；UI范围按original/current，数值输入契约不变，BC确定性派生 | 已实现；原子极值、确认门禁、一致入口回归；网页ArrowRight同步 |
| PAR-09 / FR-038 / T034 | 问句示例 | 只填草稿并聚焦，不自动发/执行；保留local/model模式与005动作范围 | 已实现；三样本草稿不执行回归；网页显式提交后计算 |
| PAR-10 / FR-039 / T035 | 有限提问记录 | 最多40条消息、textContent、模式/revision；手改保留历史，换场景/退出清空，不持久化 | 已实现；40条/XSS文本/清空取消迟到回归；网页revision记录 |
| PAR-11 / FR-040 / T036 | 视频输入与结果归属 | MIME/解码门禁；无效文件不替换视频；新capture清理旧状态，不读其他帧 | 已实现；MIME拒绝、尺寸/seek门禁、新帧失效回归 |
| PAR-12 / FR-041 / T037 | 操作反馈与焦点 | 键盘、错误字段、取消/重试/恢复/退出及窄屏长内容；共享冰面/深屏主题 | 已实现；恢复清除aria-invalid、焦点及迟到回归；无水平溢出网页记录 |

滑块每边`min=max(Number.MIN_VALUE,min(original,current)/4)`、`max=min(Number.MAX_VALUE,max(original,current)*2)`、`step=any`。这些只是UI范围；数值输入仍按契约正有限与derivedFinite检查。`Math.hypot`、单边原子动作、首次确认快照、source/originSource/editedByUser、4MiB和30s/10s开发默认不变。

不移植003自动阅读或下一点、001的1.5秒超时自动预设、004四图形/曲线x→y语义；不上传整段视频，不增加模型密钥、接口、权限、云端存储或介绍站改动。

## 本次执行环境

| 项目 | 本次记录 |
| --- | --- |
| 源码提交 / 分支 | 基于`8face5ebbf0fca16ffe076b8e0471ff380d0f2d4`的本次工作区；`codex/right-triangle-plan`，提交目标`origin/123456`。测试之后仅补文档/证据，不修改产品源码 |
| 日期 / 时区 / 起止时间 | 2026-10-03，Asia/Shanghai；全量18:03:59–18:04:14，静态18:03:59–18:04:20；UTC原时间保留于JSON |
| 系统 / Node / FFmpeg | Windows NT 10.0.26200，Node v24.21.0，现有FFmpeg 7.1 essentials/libx264；无依赖安装 |
| 浏览器版本 / 页面来源 / 设备或视口 | Codex IAB；本轮未可靠取得内核版本。`http://127.0.0.1:8765/demo/{geometry,index}.html`；实际DOM验证1280×720、600×900、390×844，均为网页视口模拟 |
| 视频与时间 / 帧尺寸 / 来源模式 | 初始8秒合成测试片640×480在4秒；新增三段自制教学片均12秒、1280×720在4秒；手工/预设、本地指令、HTTP替身分开验收 |
| reader及模型使用方式 | Node用可控HTTP替身；网页用未监听的本机端口18999验证连接失败与重试，没有调用真实供应商。无配置页与本地指令不请求模型 |

## 自动检查

| 检查 | 实际命令 | 退出码 / 数量 / 耗时 | 日志或限制 |
| --- | --- | --- | --- |
| 本次定向检查 | `node --test --test-reporter=tap tests/page-geometry.test.js tests/geometry-parity.test.js` | 0；42/42，通过，0失败/跳过；进程6.673s，TAP6.278s | [日志](test-evidence/geometry-parity-2026-10-03/geometry-directed.log)、[时间/退出码](test-evidence/geometry-parity-2026-10-03/geometry-directed.json) |
| 语法与资源 | `node scripts/check.mjs` | 0；111个JS/MJS、184个本地引用及内联脚本通过；进程20.913s | [日志](test-evidence/geometry-parity-2026-10-03/static-check.log)、[时间/退出码](test-evidence/geometry-parity-2026-10-03/static-check.json) |
| 全仓库回归 | `node --test --test-reporter=tap` | 0；585/585，通过，0失败/取消/跳过/todo；进程14.199s，TAP13.854s | [日志](test-evidence/geometry-parity-2026-10-03/node-test.log)、[时间/退出码](test-evidence/geometry-parity-2026-10-03/node-test.json) |

这里不复制 [此前556项测试报告](BreakGlass-test-report-2026-10-03.md) 的数字。旧测试和 [视觉对齐记录](BreakGlass-ui-alignment-2026-10-03.md) 保留各自日期、源码及证据范围，不作为本次结果。

测试使用现有FFmpeg目录加入当前进程PATH，以执行仓库原有的JPEG固定帧解析测试；未修改系统环境。相较原556项，新增29项几何对齐/示例流程回归，原13项页面测试继续通过。静态检查不是构建器；本仓库没有新增构建命令。

## 操作与浏览器验收

按 [quickstart §8](../specs/005-insitu-right-triangle/quickstart.md#8-2026-10-03-通用工作台能力对齐增补)及§9执行。自动化替身覆盖与真实浏览器操作分别列出；以下截图均已保存并核对。

| 检查组 | 条件与实际操作 | 结果 | 证据 / 未测限制 |
| --- | --- | --- | --- |
| Dock、快捷键、全屏、焦点 | 网页展开Dock/恢复；问题框Esc只清草稿，保留条件；全屏按钮标签进入/退出切换 | 网页操作通过；全屏显示值保留由回归验证 | IAB自动发送Esc没有可靠触发原生全屏退出，不记为浏览器原生Esc通过；Node覆盖全屏优先及拒绝反馈。MV3未测 |
| 定位、时间/阶段、新capture | 本地8秒片定位4秒并保存；内置12秒片显式加载后自动暂停4秒，载入前尚无场景 | 当前/原题时间显示正确，未自动识别；节点回归覆盖非法时间与seek门禁 | [桌面题面与画板](test-evidence/geometry-parity-2026-10-03/geometry-videos-desktop.png) |
| 同帧重识别、取消/重试/失败/迟到 | 3/4确认后在同一4秒帧连接闭端口，失败后仍BC=5，重试入口启用 | 网页失败保持条件通过；合法candidate需重新确认及各种迟到由可控替身验证 | 没有真实供应商视觉识别结论 |
| origin记忆/忘记/存储失败/MIME门禁 | 填本机地址带path/query/fragment，blur保存，刷新只回origin；忘记只清地址 | 网页通过；credentials/非本机/存储异常/MIME拒绝由回归覆盖 | 地址不含凭据；未用真实用户视频做非法MIME浏览器上传 |
| 单边slider/数值/指令一致与极值拒绝 | 3/4改AB6→BC7.211；5/12提问AB10→BC15.62cm；手机ArrowRight从AB6→6.1125，AC仍4、BC7.305 | 网页range与input完全相同；原值/恢复/极值与原子拒绝回归通过 | 原生step=any滑块箭头为范围的步进，不能声称固定0.1；SVG手柄箭头仍0.1 |
| 草稿、40消息、revision历史与场景清理 | 示例只填写，提交才执行；手改后旧问答仍带旧revision；换片清历史 | 网页通过；40消息/XSS纯文本/换场景及迟到清理回归通过 | 未持久化问答；输入框保留用户草稿不代表在新场景已执行 |
| 问答忙碌/取消/重试与旧动作拒绝 | 模型模式闭端口失败，“重试刚才的问题”实际enabled且点击创建新尝试；AB非法0恢复后错误文本空、aria-invalid移除 | 网页通过；清空历史取消pending、编辑/revision变化拒绝旧动作回归通过 | 连接失败为预期网络错误，没有把它标为模型成功 |
| 001～004与005原闭环回归 | 全585项；曲线页共享Dock在390px展开，client=scroll=375；几何最新页面1280px client=scroll=1265、600px=585、390px=375 | 对应自动化通过、受测视口无水平溢出 | [曲线窄屏](test-evidence/geometry-parity-2026-10-03/curve-mobile.png)、[几何新增视频窄屏](test-evidence/geometry-parity-2026-10-03/geometry-videos-mobile.png)。介绍站和根目录展示网站未修改 |

## 三段对应内容的视频

外部素材检索的搜索工具、Commons网页/API及媒体域连接失败，无法核验来源/许可，因此交付本项目自制的无声教学示例，没有下载或声称发现第三方课程。素材说明及复现方法见 [geometry视频README](../extension/assets/video/geometry/README.md)、[生成脚本](../scripts/generate-geometry-videos.py)。本轮使用应用捆绑Python/Pillow 12.3.0和现有FFmpeg，无新增运行时依赖；生成脚本ast.parse语法检查通过。实际生成命令：

```powershell
& 'C:/Users/27736/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' scripts/generate-geometry-videos.py --ffmpeg 'C:/Users/27736/AppData/Local/Temp/breakglass-005-test-tools/ffmpeg.exe'
```

| 示例（AB / AC / BC） | 实际文件字节 | 第4秒题面证据 | 页面结果 |
| --- | ---: | --- | --- |
| 3 / 4 / 5 cm | 151733 | [题面](test-evidence/geometry-parity-2026-10-03/triangle-3-4-5-4s.png) | 网页加载4秒→校对cm→确认5→AB改6得到7.211；回归覆盖恢复及4秒返回 |
| 5 / 12 / 13 cm | 153561 | [题面](test-evidence/geometry-parity-2026-10-03/triangle-5-12-13-4s.png) | 网页确认13→AB改10得到15.62→恢复13；回归覆盖4秒返回 |
| 8 / 15 / 17 cm | 154560 | [题面](test-evidence/geometry-parity-2026-10-03/triangle-8-15-17-4s.png) | 网页确认17；回归覆盖AB示例16、恢复17及4秒返回 |

三片均12.00s、1280×720、30fps、H.264 High/yuv420p、无音频；逐片FFmpeg探测及完整解码退出码均0，[元数据与SHA256](test-evidence/geometry-parity-2026-10-03/media.json)保留实际输出。2≤t<8题面固定、BC为问号；8秒起展示勾股计算。页面初始无自动挂视频，只有点击加载后定位；选菜单不加载不会改变正在播放的素材/题目。载入对应预设候选仍为source/originSource=preset、vertices=null，确认后才交互；切换视频或自己的本地文件会拒绝旧请求，普通本地文件预设仍为单位长度。解码失败回归还验证：即使保留上一帧尺寸/readyState，仍清场景、取消旧问答、禁用截帧/对应条件入口，迟到动作拒绝，重新加载后恢复。

## 保留的独立验收门槛

本次增补不改变 [005原验证记录](BreakGlass-geometry-validation.md) 与 [前端验证记录](BreakGlass-frontend-validation.md) 的未通过结论。真实模型及真实视频样本、Chrome MV3完整流程、物理手机/触屏、四画幅量化定位和实际像素计时仍需对应证据；理解题只说明本次作答，不证明长期学习效果。替身、预设、手工、网页视口模拟分别记录；空表和单次截图不视为通过。
