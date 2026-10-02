# BreakGlass 介绍页（site/）

## 这是什么

用项目自身的视觉语言（暗色 + `#71ddff` + 液态玻璃）做的**单页项目介绍**：零依赖、零构建、零第三方请求，和产品同源。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 单页内容：Hero / 问题 / 现场演示 / 功能三栏 / 技术数字 / 三步启动 / 边界 |
| `site.css` | 样式：沿用 `extension/demo/demo.css` 的令牌与玻璃材质 |
| `site.js` | 交互：顶栏滚动状态、滚动入场、内嵌演示的降级提示 |
| `../extension/demo/index.html` | **内嵌的真实演示页**（`<iframe src>`），不是复刻 |

## 本地预览

必须用 http(s) 打开（演示页的 `fetch` 读包内 JSON 在 `file://` 下会被浏览器拦）：

```bash
# 在仓库根目录起一个静态服务器，任选其一
python -m http.server 8899
npx --yes serve -l 8899 .
# 然后打开 http://127.0.0.1:8899/site/
```

## 部署

静态托管整仓（GitHub Pages / Netlify / Cloudflare Pages 均可），站点入口是 `/site/`；
演示页会从 `/extension/demo/` 直接加载 —— **不复制代码，单一事实来源**。

如果托管平台只能发布 `site/` 目录，需要把 `extension/` 一并发布（放到 `site/extension/`），
并把 `index.html` 里两处 `../extension/` 改成 `./extension/`。

## 内容口径（必须遵守）

- 演示区常驻来源标注：曲线来自**扩展包内预先准备的样例**，不是实时识别。
- 识别适配只写「已实现但**仅打包样例**」，不得暗示外部识别已接通。
- 手工验收（T017/T030/T038）与 ≤100ms 实测**未执行**，页面上如实写作「还没验」。
- 不引第三方统计脚本（与「零网络请求」冲突）；要统计请自托管并在页脚声明。
