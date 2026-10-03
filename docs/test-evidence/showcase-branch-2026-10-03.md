# yanghan2026-patch-1 展示网站融合验证

日期：2026-10-03。基于分支提交 `e46bed00291c262effa7982dc3f67f2701f36191` 的原根文件“展示网站”。

遵循 [BreakGlass Constitution 1.6.0](../BreakGlass-constitution.md)。本次仅为品牌与网站前端整合，不代表真实视觉识别、代码执行或产品 P0 验收。

- `node scripts/build-showcase.mjs`：通过。原文件与 `展示网站.html` 内容相同，均 122342 字节；CSS、两段 JS、Logo 和字标均内联，脚本经 `vm.Script` 检查。
- `node scripts/check.mjs`：通过。80 个 JS/MJS、174 个本地引用及内联脚本。
- `git diff --check`：通过；Git 提示工作区 LF 后续可能转换为 CRLF，没有空白错误。
- 独立入口浏览器检查：外部样式、脚本、图片标签数为 0；Logo 默认 2.2 秒，880ms 时间拖动时裂缝按顺序显露，完成节点为 `(148,146)`。
- 参数检查：`a=1.40` 时节点 `y=39.00`；恢复按钮回到 `.65`，蓝线与静止参考路径一致。
- 布局：1280×720 与390×844无横向溢出；导航 SVG 分别为32px、29px，字标由内联 SVG 呈现。浏览器未报告 error/warn。
- 八节与章节入口保留；架构弹窗的焦点约束沿用已验证的融合源码。

减少动态效果分支已实现，本次未切换 OS 偏好；未声明其他浏览器或真实识别接口验收。

## 压缩包效果融合与居中入场

2026-10-03 后续更新。依据用户提供的 `breakglass-apple.zip` 效果与居中入场要求，继续遵循 [BreakGlass Constitution 1.6.0](../BreakGlass-constitution.md)。只移植前端呈现，P1 控制台示意改为明确的未接入提示。

| 来源效果 | 融合位置与调整 |
| --- | --- |
| 上升光点、背景光、网格、进度光 | 全站背景与顶部；青色低对比光点、预渲染贴图、限制 DPR/数量，隐藏页面停帧 |
| 错峰浮现 | 每个章节的元素独立触发一次，默认无 JS 可读；避免长手机章节无法触发 |
| Hero 纵深 | 桌面仅 Logo 区域最多 24px 位移，文字和操作不随滚动淡出 |
| 邻近导航、悬停反馈 | 保留现有 LineSidebar；稳定、手机隐藏或后台时停止帧调度，支持实时减少动态偏好 |
| 演示区扫描、光点、曲线自动变化 | 静止参考与可调抛物线对照；首次六秒一轮，提供暂停/继续，手动编辑后不自动接回 |
| 架构卡片展开 | 保留 FLIP 与已有焦点、背景 inert、Escape 返回行为 |

Logo 入场：初始独立图标位于视口中心，字标出现时形成居中组合；2.2 秒结束后用 720ms 移回首页布局，下方内容随后渐显。隐藏标签页或缓存返回时保证最终 Logo 完整、正文不会一直锁定。重播可重复居中入场。

验证记录：

- `node scripts/build-showcase.mjs`：通过，两个根入口同为 145280 字节，三段 CSS/四段 JS/SVG 全内联。
- `node scripts/check.mjs`：83 个 JS/MJS、177 个本地引用及内联脚本通过。
- `node --test tests/showcase-demo.test.js`：7/7 通过；真实脚本在隔离 VM 中验证自动播放结束、暂停继续、手动接管、重置、离屏、隐藏页和实时减少动态偏好。该测试不代表实际设备性能。
- 本地 in-app browser，1280×720：首帧约 200ms，图标中心 `(640,360)`；下方内容 `visibility:hidden`、`opacity:0` 且 inert。结束后内容可见、inert 移除。
- 同一浏览器，390×844：首帧约 100ms，图标中心约 `(195,422)`；文案隐藏。结束后文案显示，无横向溢出，侧栏隐藏。
- 手机“重播入场”再次验证图标中心约 `(195,422)`、下方文案隐藏。手机演示区键盘调整至 `.25`，节点 `y=194.25`，反馈为手动控制，无横向溢出。
- 曲线键盘参数 `a=1.40` 对应节点 `y=39.00`；重置回 `.65` 后节点 `y=140.25`，蓝线与参考线数据相同；播放、暂停按钮状态与文本反馈可用。
- 章节元素显现；架构详情打开后焦点位于关闭按钮、main inert，Escape 关闭并返回触发卡片。

减少动态偏好的取消与手动操作通过模拟环境覆盖；未切换 OS 设置，未验证跨浏览器兼容或真实视觉识别/Pyodide 接口，也不报告未经测量的性能评分。

## 导航与 Logo 上移同步

依据用户后续确认：顶部导航与左侧章节导航在 Logo 开始上移时才显现；章节浮现仍只播放一次，返回已看过的内容直接显示。沿用 [Constitution](../BreakGlass-constitution.md) 的前端演示范围。

- Logo 描画期间，两处导航保持 `visibility:hidden` 与 inert；Logo 2.2 秒完成、开始 720ms 上移的同一状态切换中开放导航。
- 顶部导航容器 520ms 淡入并归位；其中章节链接与左侧章节链接各自以 620ms 弹性渐显，相邻链接错峰 45ms，左侧八项总错峰 315ms。左侧逐项位置 `-18px → +3px → -1px → 0`，顶部逐项纵向位置 `-10px → +2px → -0.5px → 0`。使用独立 translate 属性保留鼠标邻近 transform；侧栏条目动画结束后重新量取坐标。
- 正文维持原来的延后浮现顺序；减少动态偏好直接呈现，重播仍复现完整时序。导航保留既有 inert 状态；恢复重播焦点时不覆盖用户已经移到外部的焦点。
- `node scripts/build-showcase.mjs`：两个根入口均为 148393 字节，内容相同、资源内联。
- `node --test tests/showcase-demo.test.js tests/showcase-reveal.test.js`：16/16 通过，新增首次进入、返回、独立未读元素、键盘、减少动态偏好与缓存恢复的揭示回归检查。
- `node scripts/check.mjs`：84 个 JS/MJS、177 个本地引用及内联脚本通过；`git diff --check` 通过。
- 1600×900 本地浏览器抽帧：逻辑时间 373ms 与 1589ms，两处导航隐藏；2200ms 时 `.intro-entering` 移除，Logo 上移、导航与侧栏开始显现。左侧延迟依次为 0–315ms，顶部为 0–225ms；稳定后所有链接 opacity 为 1、translate 为 0。Tab 从“痛点”进入“方案”后，离开焦点的链接仍保持可见。
- 390×844 本地浏览器：导航最终可见、侧栏按既有布局隐藏，无横向溢出。未切换 OS 减少动态设置；该偏好仍由脚本测试与样式检查覆盖。

当前章节采用单次揭示；图表自动播放也保留手动接管与不自动重播的规则。

## Safari 兼容与网页发布入口

用户反馈苹果端全部动画未显示，随后说明入口是 GitHub 分支。2026-10-03 GitHub 公共仓库 API 返回 `has_pages:false`；分支源码页不是运行展示网站的地址，不能据此判定苹果设备动画故障。用户已明确授权发布 GitHub Pages。

依据 [Constitution](../BreakGlass-constitution.md)，本轮只修改静态前端展示：

- 新增轻量监听适配器，支持现代 `MediaQueryList.addEventListener` 与旧式 `addListener`，显式释放监听，不依赖浏览器对 `AbortSignal` 事件选项的支持。Logo、章节效果、演示区和侧栏均使用同一适配器。
- 不支持独立 `translate` 时，导航弹性位移回退到 `transform`，结束后释放给既有鼠标邻近反馈。补充 `100vh` 与 `overflow:hidden` 作为新式布局属性的回退。
- 保留系统减少动态偏好、单次正文揭示和手动曲线接管；未绕过用户设置或添加真实识别能力。
- 构建生成同内容的 `展示网站`、`展示网站.html`、根 `index.html`，每份 149693 字节，三段样式、五段脚本和 SVG 内联。`.nojekyll` 用于直接发布静态文件。
- `node --test tests/showcase-demo.test.js tests/showcase-reveal.test.js`：20/20 通过，新增仅有旧式媒体监听、缺少 AbortController 的实际控制器启动、实时偏好变化和释放测试。
- `node scripts/check.mjs`：85 个 JS/MJS、178 处本地引用及内联脚本通过（新增根入口后的引用数以发布验证补充记录为准）。本地 in-app browser 重载后 Logo 时间推进至 683ms，导航处于 pending，五个脚本均已内联，开场正常启动。

本轮没有苹果真机，兼容分支由隔离脚本测试覆盖；不能声称已完成 Safari 真机验收。历史 WebKit API 差异见 [MediaQueryList 修复](https://bugs.webkit.org/show_bug.cgi?id=203288)、[Safari 14.1 个别变换属性](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)。

发布尝试：账号 `2292576833` 具有 push 权限，但 admin 与 maintain 均为 false。创建 Pages API 返回 HTTP 404，网站没有被该操作发布。已请仓库所有者选择 `yanghan2026-patch-1`、`/(root)` 启用；不得把分支推送当作网页上线。

## 入场滚动锁定与基础防护

本轮依照 [Constitution](../BreakGlass-constitution.md) 保持静态前端范围。

- 入场及重播时固定 body、保留原滚动坐标和滚动条占位，拦截滚轮/单指触摸/翻页键及同页锚点；输入控件与浏览器缩放保持可用。
- Logo 结束后再等待 960ms，覆盖 720ms 上移、920ms 文字和最长 935ms 导航渐显，然后清理监听、恢复原样式及坐标。后台、离页、减少动态偏好立即释放；有效非首页锚点跳过首页入场，保留阅读位置。
- CSP 使用六段内联脚本的 SHA-256 白名单，构建时按 HTML 换行规则归一化；禁止脚本事件属性、eval、不需要的连接/内嵌页面/插件/表单/Worker/媒体加载。保留必要的内联样式，加入 `no-referrer`，移除架构文案 HTML 插入路径。
- 没有在 meta 中声称提供 `frame-ancestors`、HSTS、X-Frame-Options 或 nosniff；这些响应头由托管平台配置，本轮未实施。CSP 范围是展示文档，不影响跳转后的独立视频演示文档。规则依据 [CSP 规范](https://www.w3.org/TR/CSP3/) 与 [HTML 换行预处理](https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream)。
- `node --test tests/showcase-demo.test.js tests/showcase-reveal.test.js tests/showcase-scroll-lock.test.js tests/showcase-security.test.js`：36/36 通过，包含事件释放、位置/样式恢复、编辑/缩放保留、原演示行为、六段脚本授权与修改脚本拒绝、跨换行构建一致性。
- `node scripts/build-showcase.mjs`：三个入口各 156170 字节，六段内联脚本；`node scripts/check.mjs`：88 个 JS/MJS、179 处本地引用及内联脚本通过；`git diff --check` 通过。
- 本地浏览器：半速重播逻辑时间 350ms，PageDown 后 scrollY 仍为 0，body 为 fixed、状态 locked；结束后 body 为 static、状态 unlocked，PageDown 可滚至 729.6px。
- 临时测试副本添加了未授权脚本和 `onerror`：两项执行标记均未出现，正常入场逻辑时间推进至 567ms。该探测页仅用于本地验证，不发布。
- 直接打开 `#p5`：入场为完成状态、没有滚动锁定、保留该章节位置；曲线键盘调整至 0.66、状态为 manual。架构“用户触发”详情可打开，文案内容与强调格式保留。

未进行服务器、账号权限或苹果真机渗透测试；本轮不作全站安全保证。

## 真实运行截图与双向重复渐显

用户最新要求覆盖此前的“只播放一次”：上下滚动再次进入已看过的内容，也播放弹性渐显。范围仍遵循 [Constitution](../BreakGlass-constitution.md)。

- 通过 `extension/demo/index.html` 实际运行包内视频，选择预设、显示工具栏、定位第 6 秒、破壁、键盘调节 a 从 1.0 到 0.6，取得五张 JPEG。架构卡片与详情模板使用这些截图，保留点击展开、焦点恢复及现有品牌样式。资产操作与对应关系见 [截图说明](../../site/assets/runtime/README.md)。
- 第三层展示当前预制结果的来源提示，第五层展示已实现的 SVG 函数分支；文案明确真实视觉识别、CodeMirror、Python/Pyodide 尚未接入。实际快捷键改为 Alt+B，不使用概念图冒充运行截图。
- 构建仅允许五个指定 JPEG 路径并检查文件标记，重复引用复用读取、内联为 data 图片。原六脚本 CSP 哈希与资源限制保留；三个根入口相同，各 1842641 字节。
- 持续观察正文元素：完全离开视口后重置，重新进入时按上下入口从 ±22px 弹性渐显，时长 640ms 并保留逐项延迟。局部可见或保留键盘焦点的内容不会突然隐藏。减少动态偏好、旧式媒体监听、无 IntersectionObserver 回退及离页释放保留。
- `node --test tests/showcase-demo.test.js tests/showcase-reveal.test.js tests/showcase-scroll-lock.test.js tests/showcase-security.test.js`：39/39 通过，含双向重复、焦点、长内容、过期回调与原有滚动锁、安全回归。
- `node scripts/build-showcase.mjs` 通过；`node scripts/check.mjs`：88 个 JS/MJS、189 个本地引用及内联脚本通过；`git diff --check` 通过。
- 本地浏览器桌面 1280×800：五列截图均加载，五个资源为内联 JPEG，无横向溢出。滚动离开标题后 `is-revealed` 移除，返回重新加入；向上返回保留 -22px 入场方向，向下返回为 +22px，捕捉到 opacity=0.568967、transition-duration=0.64s 的中间态。
- 窄屏 390×844：单列卡片和全部截图加载，无横向溢出；第三层详情大图保持完整比例，说明可见、关闭按钮有焦点，Escape 关闭可用。没有苹果真机，本轮不声称完成 Safari 真机验收。

图表自动演示仍沿用手动接管规则；本次重复的是章节内容入场。GitHub Pages 仍需仓库所有者启用，分支推送不代表托管网站已上线。

## 顶部 GitHub 入口

依据 [Constitution](../BreakGlass-constitution.md)，仅增加展示页导航入口。在“亲手试试”左侧提供 GitHub 图标和文字，原生链接直接跳转 `https://github.com/yxz6811/breakglass`，保持无来源信息的导航策略，不引入脚本或第三方资源。

- 保留整个导航栏与 Logo 的入场时序；900px 以下操作区靠右，380px 以下只保留 GitHub 图标，并保留可访问名称与 44px 点击区域。
- 浏览器检查 1280×800 与 320×844：入口可见，链接地址正确，窄屏无横向溢出且不覆盖 Logo 或原按钮。
- `node scripts/build-showcase.mjs`：三个根入口字节一致，各 1844257 字节；`node scripts/check.mjs`：88 个 JS/MJS、189 个本地引用通过；七项安全回归测试与 `git diff --check` 通过。
