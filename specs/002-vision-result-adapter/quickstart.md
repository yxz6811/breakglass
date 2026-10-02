# Quickstart: 识别结果适配

**Date**: 2026-10-02  
**Spec**: [spec.md](./spec.md)  
**Contract**: [contracts/vision-adapter.md](./contracts/vision-adapter.md)

本指南只验证识别适配。不上传画面，不启动代理，不加载 Pyodide。演练结束必须把配置改回关闭。

## 0. 自动检查

在仓库根目录执行：

```bash
node --test
```

期望：全部通过。若只想看本功能，执行：

```bash
node --test tests/vision-validate.test.js tests/vision-wake.test.js tests/page-vision.test.js
```

提交的 `extension/assets/config.json` 在演练前应为 `visionAdapter: off`、`externalAttempt: off`、`fallbackAfterMs: 1500`。

## 1. 默认关闭

1. Chrome 打开 `chrome://extensions`，加载未打包的 `extension/`。
2. 打开扩展内演示页，暂停在目标时间，唤醒。
3. 连续唤醒 10 次。期望：10 次来源都是「预先准备的示例」，页面不出现「识别结果」。断网时仍能完成拖动、重置和退出。

未实际点击时，不要把本节写成已通过。

## 2. 打开打包样例

1. 把 `extension/assets/config.json` 的 `visionAdapter` 改为 `fixture`。保持 `externalAttempt` 为 `off`。
2. 重新加载扩展和演示页。确认样例的 `videoId`、`time`、`frameSize` 与当前夹具视频一致；正式视频未提供时，这只证明样例路径。
3. 暂停在目标时间并唤醒。
4. 期望：曲线出现；全程可见「识别结果」和「随演示打包的识别样例，尚未接通外部识别。」；可拖动一个参数、重置并退出；退出后视频仍暂停。
5. 开发者工具网络面板不出现远程地址。

## 3. 拒绝非法样例

临时把样例改成下列之一，每种改完都重新唤醒，然后恢复原样例：

- 删掉 `evidence`
- 把 `confidence` 写成 `0.49`
- 把 `videoId` 改成与当前视频不同

期望：不绘制曲线；可见「外部结果不可用，未进入交互。」；可以重试或退出；匹配的预制曲线不会自动出现。

## 4. 确认预制回退未被改写

1. 把 `visionAdapter` 改回 `off`，把 `externalAttempt` 改为 `hang`。
2. 唤醒并等待 1.5 秒。
3. 期望：出现预制曲线，来源含超时回退，而不是「识别结果」。等待上限仍是 1.5 秒。

## 5. 收尾

把 `extension/assets/config.json` 恢复为：

- `visionAdapter`: `off`
- `externalAttempt`: `off`
- `fallbackAfterMs`: `1500`

再次确认默认唤醒只显示「预先准备的示例」。不要把未跑的手工步骤记为通过。
