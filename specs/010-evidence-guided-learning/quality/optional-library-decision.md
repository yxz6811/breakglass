# T018 可选库评估与不采用决定

日期：2026-10-07（Asia/Shanghai）。源码核对基线：`e6aceb3e486bcf08ade7b0cd1939c6535a19f190`。依据：[010 计划](../plan.md)、[T018](../tasks.md)、[契约第 4 节](../contracts.md)与 Constitution 2.6.0 原则 XVII。

**本轮不引入 ts-fsrs 或 JSXGraph。** T018 允许明确决定不采用；本报告走该路径。已完成上游与发布包只读核验，没有安装依赖、执行库代码、制作对照原型或测得收益，也不修改应用、契约、治理和任务清单。机器可读证据见 [optional-libraries.json](optional-libraries.json)。

## 核验版本与来源

下列为核验时 npm `latest`，不采用 beta、动态 CDN 地址或上游 `main` 作为固定版本。

| 项目 | ts-fsrs | JSXGraph |
| --- | --- | --- |
| 固定版本 | 5.4.2 | 1.14.0 |
| npm 发布时间（UTC） | 2026-09-01 02:23:24 | 2026-10-05 09:08:59 |
| 上游 tag | `v5.4.2` | `v1.14.0` |
| tag 指向提交 | `bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d` | `d0fd56a473651ce8eba51c2b7821ab3cfb357ac3` |
| 许可 | MIT | MIT OR LGPL-3.0-or-later；如将来采用，选择 MIT 路径 |
| Node 声明 | `>=20.0.0` | `>=20.19.0` |
| 外部运行依赖声明 | 无 | 无 |

版本与分发字段来自 [ts-fsrs npm 主源](https://registry.npmjs.org/ts-fsrs/5.4.2)、[JSXGraph npm 主源](https://registry.npmjs.org/jsxgraph/1.14.0)；入口与许可对照固定提交的 [ts-fsrs manifest](https://github.com/open-spaced-repetition/ts-fsrs/blob/bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d/packages/fsrs/package.json)、[JSXGraph manifest](https://github.com/jsxgraph/jsxgraph/blob/d0fd56a473651ce8eba51c2b7821ab3cfb357ac3/package.json)。

ts-fsrs 的 npm 元数据没有 `gitHead`；其 [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/ts-fsrs@5.4.2) 中源码提交与上游 tag 一致。JSXGraph 的 `gitHead` 与 tag 一致。两份 tarball 的 SHA-512 均与 npm `integrity` 一致；本轮只解码 provenance，未做签名信任链验证。MIT 分发要求保留版权与许可声明，具体文本为 [ts-fsrs LICENSE](https://github.com/open-spaced-repetition/ts-fsrs/blob/bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d/LICENSE)、[JSXGraph LICENSE.MIT](https://github.com/jsxgraph/jsxgraph/blob/d0fd56a473651ce8eba51c2b7821ab3cfb357ac3/LICENSE.MIT)。

## 体积口径

在 Node `v24.21.0` 中读取官方 tarball 到内存、解压并统计文件字节，再用 `gzipSync` level 9 压缩单文件。原始分发包和文件摘要保存在 JSON；没有写入或运行下载代码。单位均为 bytes。

| 分发内容 | 原始字节 | 本机 gzip level 9 字节 |
| --- | ---: | ---: |
| ts-fsrs `dist/index.mjs` | 61,245 | 13,468 |
| ts-fsrs `dist/index.cjs` | 62,470 | 13,663 |
| ts-fsrs `dist/index.umd.js` | 72,009 | 14,826 |
| JSXGraph `distrib/jsxgraphcore.js` | 993,978 | 258,582 |
| JSXGraph `distrib/jsxgraphcore.mjs` | 1,025,449 | 258,486 |
| JSXGraph `distrib/jsxgraph.css` | 4,822 | 1,628 |

[ts-fsrs tarball](https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz) 为 150,324 bytes，包内 13 个文件、解压总量 706,415 bytes；[JSXGraph tarball](https://registry.npmjs.org/jsxgraph/-/jsxgraph-1.14.0.tgz) 为 19,165,637 bytes，包内 546 个文件、解压总量 74,837,998 bytes。**包总量不是浏览器加载量；gzip 值不是实测 HTTP 传输量。** JSXGraph 的 `src/index.js` 本身虽只有 9,146 bytes，但包含多项模块导入，不能将它当成整库成本。压缩、解析时间、内存、冷启动、树摇后大小与运行兼容性均未测。

## 浏览器与 CJS 适用性

ts-fsrs 明确提供 ESM `import → dist/index.mjs`、CJS `require → dist/index.cjs` 和 UMD 构建。浏览器如需使用可本地打包固定 ESM/UMD 产物；裸包名导入仍需模块解析配置。现有服务的 Node 下限 `>=22.9` 满足其版本声明，但这不等于本项目接入已验证。其 API 使用回忆评级、卡片状态、时间与复习日志；可配置 fuzz，因此确定重放还需冻结时间、参数及随机策略。[官方 manifest](https://github.com/open-spaced-repetition/ts-fsrs/blob/bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d/packages/fsrs/package.json)、[固定版使用说明](https://github.com/open-spaced-repetition/ts-fsrs/blob/bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d/packages/fsrs/README.md)。

JSXGraph 面向浏览器交互几何，提供 SVG/canvas 渲染及拖点等能力；发布包含经典脚本、`.mjs` 与 CSS。其 `main` 指向 `distrib/jsxgraphcore.js`，但 `exports.default` 指向使用 ESM import 的 `src/index.js`，没有独立 `require` 映射。现代解析器会关注 `exports`，不能仅凭 `main` 认定 `require('jsxgraph')` 一定落到经典脚本；需按固定 Node 与 DOM 环境另验。010 调度服务没有引入浏览器绘图库的需求。[官方说明](https://github.com/jsxgraph/jsxgraph/blob/d0fd56a473651ce8eba51c2b7821ab3cfb357ac3/README.md)、[manifest](https://github.com/jsxgraph/jsxgraph/blob/d0fd56a473651ce8eba51c2b7821ab3cfb357ac3/package.json)、[ESM 源码入口](https://github.com/jsxgraph/jsxgraph/blob/d0fd56a473651ce8eba51c2b7821ab3cfb357ac3/src/index.js)。

## 与现有实现比较及决定

| 候选 | 可能补充的能力 | 当前事实与不采用理由 | 本轮回退 |
| --- | --- | --- | --- |
| ts-fsrs | 概念回忆卡的状态与复习日志、基于回忆评级的间隔 | 当前数学 attempt 只有对错/辅助证据，不等价于 Again/Hard/Good/Easy 四级实际回忆评分；尚无独立概念卡契约、数据或对照结果。现在映射会制造未经验证的学习含义 | 继续使用并由 T015 统一可解释规则建议；错答 1 天、辅助正确 3 天、独立正确序列 7/14/28 天；允许修改/跳过 |
| JSXGraph | 约束拖点、交点及多对象联动 | 两微课已有数学 snapshot、程序 judge 和原生 SVG；当前没有必须依赖通用构造引擎的缺口或测得收益。新增约 994 KB 核心脚本还需验证容器生命周期、坐标同步、键盘、触屏与资源释放 | 保留原生 SVG、参数控件和程序判定；低性能或粒子失败仍使用 2D 主图 |

基线证据位置：[单记录规则 `nextReview`](../../../learning-site/records.js)、[同模板规则 `historyPlan` 与 `sceneSVG`](../../../extension/src/plugin/math-learning.js)、[基础 SVG 与粒子降级](../../../learning-site/math-workbench.js)。在 `e6aceb3` 基线，两处规则证据窗口不同；010 的 T015 实施及最终状态由主实现会话另行验证，本报告不代验或覆盖其新状态。SVG 与可选库都不能替代数学 judge；调度估计不能作为数学掌握百分比。上述“可能能力”是工程用途判断，收益为**未测**。

## 将来重新评估的门槛

1. FSRS：先冻结独立概念回忆卡、四级实际回忆评分、算法/参数版本、时间与随机策略、复习日志、账号 epoch/删除及迁移语义。不得从旧数学对错或看提示历史伪造 FSRS 日志。事前定义样本与对照指标，比较规则调度和 FSRS 的回忆表现/负担；真实授权试用前不宣称学习收益。
2. JSXGraph：先指出一条经审校微课中原生 SVG 无法合理承担的具体交互；隔离、本地固定版本、按需加载，数学 snapshot 和 judge 仍为唯一答案依据。事前沿用 T003 体验阈值，比较完成耗时、操作错误、键盘/触屏可达性、冷启动与资源释放，收益明确后才评审接入。
3. 任一接入都先补齐许可/包内第三方声明、产物摘要和相关契约，再记录验证。失败时关闭该模块：图形恢复 SVG；调度依据合法数学作答继续生成原规则建议。独立概念卡如需退回规则，另冻结其评分映射；不将两类证据混写，不伪造历史 attempt。

本决定只关闭本轮可选依赖评估，不代表 T015、浏览器整合、真实模型、平台许可、地区发布或学生学习效果已验收。
