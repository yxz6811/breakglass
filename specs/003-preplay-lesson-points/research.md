# Research: 开播前阅读

**Date**: 2026-10-02  
**Spec**: [spec.md](./spec.md)  
**Constitution**: `.specify/memory/constitution.md` 1.6.0 原则 VII

## 1. 何时开始，抽哪些帧

**Decision**: 视频元素已有可用时长时自行开始，不再要求一次单独的开始点击。采样时刻把时长等分成至多 8 段，取每段中点。相邻中点不足 1 秒时丢掉较晚的一个。时长小于 2 秒时只取中点。不从 0 秒按帧步进。取消调用后不再截取、不再发送。

**Rationale**: 团队要求一打开就开始，并且不从片头逐帧扫。等分中点可以重复验收。8 处是整段稀疏的上限，替代原先的 5 处和 60 秒。

**Alternatives considered**: 等用户点「开始阅读」。这会把第一处出现的时间交回给一次额外点击，和「一打开就开始」相反。逐帧扫描整段。画面数量和等待都超出书面决定。

## 2. 第一处与下一个

**Decision**: 存储按校验完成的先后接收点，同时按 `time` 升序索引。第一处通过后立刻 `pause` 并定位到该 `time`，即使还有更早的采样没回来。`下一个` 的目标是索引中严格大于当前点 `time` 的最小已存点。更早才完成的点只入库，不改变 `currentTime`，也不替换覆盖层。目标未就绪时不调用计算。没有更大的 `time` 且采样已结束时禁用按钮。

**Rationale**: 「第一处」按算完的顺序，「下一个」按时间往后。两者若合成一个顺序，后算完的早段会把用户拉回去。

**Alternatives considered**: 第一处改成时间最早的采样，用户要等整段最前的那一点。这会推迟第一次破壁。下一个按完成顺序跳。播放头会前后乱跳。

## 3. 落定与覆盖层

**Decision**: 开始定位时先退出当前交互层。落定条件是 `paused === true` 且 `|currentTime - point.time| ≤ 0.2 + 1e-9`。落定前破壁控件禁用，且不挂新层。落定后破壁只把该点已存的 `curve` 交给一次新的 `createWake`。未落定时的播放恢复会继续禁用破壁。

**Rationale**: 现有时间门要求暂停在目标时间。定位过程中若留着旧曲线，新帧上看到的就不是这一帧的结果。

**Alternatives considered**: 定位完成前先把新曲线画上。破壁还没点，而且尺寸可能仍未核对当前帧。

## 4. 尺寸不符与退回

**Decision**: `curve.frameSize` 必须等于当前 `videoWidth` × `videoHeight`。不等则丢掉该点，原因「抛物线没有通过检查」，不调用 `createWake`，也不把 `extension/assets/presets/demo-parabola.json` 画到这一帧。整次失败、断网，或 300000ms 内零个通过点时，把视频源换回 `../assets/video/breakglass-demo-9s.mp4`，清空失败片子的内存点。退回之后，只有这支片子自己的单点预制可以按现有路径破壁。验收片子的地址字符串不得包含 `breakglass-demo-9s.mp4`。

**Rationale**: 预制曲线的时间是第 6 秒，文件名才是 9 秒。顶到别的帧上会把来源说错。退回的是片子，不是把那条曲线借给失败的帧。

**Alternatives considered**: 尺寸不符时改画第 6 秒的预制曲线。团队明确拒绝。断网时留在用户片子上继续显示半份点。那些点没有完整阅读，不能当成这支片子的结果。

## 5. 来源文案

**Decision**: 阅读点的 `curve.source` 仍是 `preset`，`fallback` 为 `null`。页面在该点交互中显示「这次阅读」。预先准备片子的原单点路径仍显示「预先准备的示例」。两种都不得显示「识别结果」。不再使用「这是盖在这一帧上的例题」作为尺寸不符时的成功绘制。

**Rationale**: 原则 VII 不新增来源枚举。尺寸不符的点不再进入交互，例题句会把被拒绝的帧说成可以拖。

**Alternatives considered**: 新增 `lesson` 来源。要改交接接口。尺寸不符仍绘制并标为例题。和「对不上就拒」相反。

## 6. 两个耗时和 2%

**Decision**: `lesson-first-point` 从「时长变为可用」记到「第一处校验通过」。`lesson-wake-visible` 从破壁点击记到覆盖层可见，只在该点已存好时记录，目标至少 20 次、P95 ≤ 100ms。破壁后的对齐沿用 `window.__breakglassAlignment`。本切片要求 `contentRect` 有宽高，且 `maxRatio` ≤ 0.02、`measured` 为 true。当前实现把 `maxRatio` 写成 `null`、`measured` 写成 `false`。文档把 SC-003、SC-004、SC-005 保持未通过，直到这些字段被真实记下来。

**Rationale**: 几分钟的阅读和 0.1 秒的取出不能合成一个平均数。2% 只覆盖已经破壁且尺寸通过的层。

**Alternatives considered**: 用现有 `maxRatio: null` 当作不超过 2%。空值不是测量。把第一处的几分钟写进 `fallback-visible`。会破坏 P0 的 100ms 口径。

## 7. 送出与密钥

**Decision**: 仅自动开始的这一次阅读可以发送课程文本（可空，最长 8000 字）和至多 8 张采样画面。地址来自当次输入，空白则无法完成外部阅读，走退回。不增加 `host_permissions`，不修改 CSP。跨域失败视同读失败并退回。测试注入假的 `fetch`。

**Rationale**: 原则 II 和 VII 只放开这批稀疏画面。代理不在本仓库实现。

**Alternatives considered**: 把演示地址写进 `config.json`。密钥和地址会进仓库。
