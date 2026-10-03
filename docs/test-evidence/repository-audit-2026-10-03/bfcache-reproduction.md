# 几何工作台 BFCache 生命周期定向复现

> 历史基线记录：以下结果来自 `08e84da`，诊断脚本断言的是旧缺陷存在。随后已修复并新增正式回归；当前结果见 [仓库测试报告](../../BreakGlass-repository-test-report-2026-10-03.md) 和 [修复后证据](post-fix/)。不要在修复后的源码上把本诊断脚本当作通过测试使用。原始日志与元数据保留不变。

这是缺陷复现证据，不是通过验收记录。它不计入本轮既有的 621 项通过数，也没有修改产品源码或 `tests/`。

## 实际命令与环境

在仓库根目录运行：

```powershell
node docs/test-evidence/repository-audit-2026-10-03/bfcache-reproduction.cjs
```

- 源码：`08e84da67e7d2315c0045c54abcb18e300d19838`。
- Node：`v24.21.0`；Windows：`win32 / 10.0.26200`。
- 脚本起止（UTC）：`2026-10-03T10:38:43.958Z` ～ `2026-10-03T10:38:44.014Z`；本地时区为 Asia/Shanghai。
- 实际退出码：`0`。脚本断言的是“缺陷能够复现”，不能将退出码 0 解读为 BFCache 功能通过。
- 完整脚本：[bfcache-reproduction.cjs](bfcache-reproduction.cjs)；完整输出：[bfcache-reproduction.log](bfcache-reproduction.log)；命令、外部起止时间与退出码：[bfcache-reproduction.json](bfcache-reproduction.json)。

## 触发与 expected / actual

1. 调用仓库现有 `createGeometryHarness()`，载入本地视频替身并确认预设，得到 `phase=confirmed`。
2. 派发 `pagehide({persisted:true})`，模拟浏览器将页面保存在往返缓存中。
3. 派发 `pageshow({persisted:true})`，模拟恢复该缓存页面。
4. 点击预设按钮，检查是否仍能进入校对流程。

| 项目 | expected | actual |
| --- | --- | --- |
| 恢复后控制器 | 仍可用，或由 pageshow 完成明确重建 | 永久 disposed，没有重建 |
| 点击预设后场景 | `review` | `empty` |
| AB 表单 submit 监听 | 1 | 0 |
| 预设按钮 click 监听 | 1 | 0 |
| 缓存页面使用的本地视频 URL | 返回前保留，或恢复时重新建立 | `blob:local-test-1` 已 revoke，DOM 的视频 src 仍指向该 URL |

## 源码定位与测试缺口

- [旧基线 geometry.js:749](https://github.com/yxz6811/breakglass/blob/08e84da67e7d2315c0045c54abcb18e300d19838/extension/src/page/geometry.js#L749)：`dispose()` 永久设置 disposed、移除页面业务监听、销毁 session/view/Dock 并 revoke 本地视频 URL。
- [旧基线 geometry.js:757](https://github.com/yxz6811/breakglass/blob/08e84da67e7d2315c0045c54abcb18e300d19838/extension/src/page/geometry.js#L757)：`listen(window, 'pagehide', dispose)` 不检查 `event.persisted`，也没有对应的 pageshow 恢复处理。
- [旧基线 geometry-parity.test.js:757](https://github.com/yxz6811/breakglass/blob/08e84da67e7d2315c0045c54abcb18e300d19838/tests/geometry-parity.test.js#L757)：当时的用例检查最终 dispose 后的迟到播放/全屏 Promise，未覆盖 persisted 往返。
- 对照 [showcase-demo.js:104](../../../site/showcase-demo.js#L104) 和 [showcase-motion.js:376](../../../site/showcase-motion.js#L376)：介绍站相应控制器已有 persisted 分支；这仅用于说明实现差别，没有修改介绍站。

本次只读审查依据 [项目规范](../../../AGENTS.md) 和 [BreakGlass Constitution](../../BreakGlass-constitution.md) 对完整交互、资源释放与如实记录验证范围的要求。

## 范围限制

复现运行的是现有 fake DOM、媒体、URL 和请求边界；没有驱动浏览器导航，也没有证明具体浏览器会为此页面启用 BFCache。实际浏览器的页面可缓存资格、原生 persisted 事件、返回画面与本地 blob 行为仍需验证。可优先在真实 Chrome 中载入本地视频并确认条件，跳到曲线页后用浏览器后退，确认 pageshow 的 persisted 值，再尝试预设、改边和视频操作。

该次历史诊断不修复源码、不新增正式测试。后续已按用户要求区分 persisted 暂停与最终离开释放，并补正式生命周期回归；当前修复与测试结果以开头链接的仓库报告为准。
