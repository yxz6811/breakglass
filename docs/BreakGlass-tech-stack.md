# BreakGlass 技术栈分析

| 项 | 值 |
| --- | --- |
| 分析对象 | 仓库 `yxz6811/breakglass`，分支 `前端计划02`（= `main` + 2 个测试提交） |
| 日期 | 2026-10-02 |
| 取证方式 | 全仓扫描：顶层清单、配置文件存在性、按目录行数统计、语法与 API 关键词检索、逐文件阅读 |
| 结论一句话 | **零依赖的 Chrome MV3 原生前端**：Vanilla JS + 原生 DOM/SVG/CSS，无打包器、无框架、无 `package.json`，测试只用 Node 内置 `node:test` |

## 1. 全景

| 层 | 选型 | 证据 |
| --- | --- | --- |
| 运行平台 | Chrome Manifest V3 未打包扩展（实际也在 Edge 上跑） | `extension/manifest.json`：`manifest_version: 3` |
| 语言 | JavaScript（ES2020+），无 TypeScript | 无 `tsconfig.json`/`jsconfig.json`；源码 14 个 `.js` / 2279 行 |
| 模块化 | UMD/IIFE + 全局命名空间 `window.BreakGlass`，Node 侧走 CommonJS | 11 个文件含 `typeof module !== 'undefined' && module.exports`；`extension/src` 内 **0 条 ESM `import`/`export`** |
| UI | 原生 DOM + 原生 SVG + 原生 CSS | `extension/demo/index.html`（127 行）、`demo.css`（278 行）；覆盖层为动态 `<svg>` |
| 媒体 | HTML5 `<video>` + 原生控件 | `extension/demo/index.html` 的 `<video controls>`；`video.videoWidth/currentTime` 读取 |
| 数据 | 扩展包内静态 JSON，经 `fetch` 读相对路径 | `extension/assets/{config.json,presets/demo-parabola.json,vision/fixture-parabola.json}` |
| 存储 | **无**（不用 `chrome.storage`/`indexedDB`/`localStorage`） | `tests/latency.test.js` 等对源码做反向断言 |
| 测试 | Node 内置 `node:test` + `node:assert/strict` | 26 个 `*.test.js`（3846 行）+ 2 个 helper；`node --test` 209 项通过 |
| 构建 | **无构建**：无打包器、无转译、无压缩 | 无 `package.json`、无锁文件、无 `node_modules`、无 vite/webpack/rollup/babel 配置 |
| 依赖 | **零运行时依赖、零第三方测试依赖** | 全仓无 `package.json`；文档中也没有任何 `npm/pnpm/yarn install` 指令 |
| CI | 无 | 无 `.github/`、无 `.gitlab-ci.yml` |
| 治理 | Spec Kit + Cursor Skills + AGENTS.md | `.specify/`（模板/6 个 bash 脚本/工作流）、`specs/001`、`specs/002`、`.cursor/skills`（10 个 SKILL.md） |

## 2. 平台与安全表面（MV3）

```json
{
  "manifest_version": 3,
  "action": { "default_title": "打开 BreakGlass 演示" },
  "background": { "service_worker": "src/background/service-worker.js", "type": "module" },
  "permissions": [],
  "host_permissions": [],
  "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
}
```

- `permissions` 与 `host_permissions` **都为空**，没有 `content_scripts`，没有 `web_accessible_resources`。
- service worker 只有 5 行，仅用 `chrome.action.onClicked` + `chrome.tabs.create` + `chrome.runtime.getURL` 打开扩展内演示页；**不请求任何网络**。
- CSP 为 `script-src 'self'`，页面脚本全部是本地 `<script defer src="../src/...">`，没有内联脚本、没有 CDN。
- 扩展目录内**没有任何 `http(s)://` 字面量**（唯一例外是 SVG 命名空间 `http://www.w3.org/2000/svg`，测试里被显式豁免）。

## 3. 语言与模块化细节

| 观察 | 结果 |
| --- | --- |
| ES 现代语法 | 5 个文件出现 `??`/`?.`/`Object.fromEntries` 等（非严格模式下也不用 polyfill） |
| 类 | 2 个：`SessionController`（会话状态机）、`LiquidGlassDock`（顶栏放大控制器） |
| 异步 | `async/await` 用于 `loadJson`、`loadPreset`、`loadVisionFixture`、`boot`、`attachPackagedVideo` |
| 模块模式 | 每个模块 `(function (root, factory) { ... })(globalThis, function (BreakGlass) { ... })`，挂到 `BreakGlass.<域>`；测试里 `require()` 同一个文件 |
| 依赖注入 | 通过 `window.BreakGlass` 命名空间逐个挂载，脚本顺序即依赖顺序（`tests/page-integration.test.js` 用静态断言锁死 10 个脚本的顺序） |

## 4. 用到的浏览器 Web API

| API | 用途 | 位置 |
| --- | --- | --- |
| `fetch` | 读取扩展包内 JSON（相对路径） | `preset/load.js` |
| `ResizeObserver` | 视频元素尺寸变化后重算覆盖层 | `page/main.js` |
| `matchMedia` | 设备像素比变化监听 `(resolution: Ndppx)` | `page/main.js` |
| `requestAnimationFrame` | 顶栏放大逐帧平滑 | `ui/liquid-glass.js` |
| `performance.now` | 页面本地时钟 | `page/main.js` |
| Pointer Events + `setPointerCapture` | 控制点拖动 | `page/main.js` |
| Fullscreen API | 「全屏」按键 | `page/main.js` |
| `getComputedStyle` | 读 `object-fit` / `object-position` 计算内容矩形 | `page/main.js` |
| 原生 SVG | 抛物线 `path` + 控制点 `circle` + 折射滤镜 | `page/main.js`、`demo/index.html` |

### CSS 特性（`demo.css` 278 行）

自定义属性（令牌）、Grid/Flex、`backdrop-filter`（毛玻璃）、`mask-image`、`clip-path`、`@keyframes`、`@media (prefers-reduced-motion: reduce)`、`:focus-visible`、SVG `feTurbulence`/`feDisplacementMap`（液态玻璃折射）。**没有预处理器，没有 CSS 框架。**

## 5. 测试体系（本仓库最“重”的工程部分）

| 项 | 内容 |
| --- | --- |
| 运行器 | `node --test`（Node 20+ 内置），无 jest/vitest/mocha |
| 断言 | `node:assert/strict` |
| 规模 | 26 个测试文件 / 3846 行；**209 项全部通过** |
| 假时钟 | `tests/helpers/fake-clock.js`：虚拟毫秒表，`schedule/clear/advance/pending`，用于驱动 1500ms 看门狗 |
| 假 DOM | `tests/helpers/fake-page.js`：自己实现 element/document/window/getComputedStyle/fetch 替身，并用 `vm.runInThisContext` 加载真实 `main.js` |
| 静态断言 | 读源码/HTML/CSS 字符串做契约断言（脚本顺序、id、aria、无远程地址、无密钥） |
| 覆盖类型 | 校验器、求值器、几何、会话、唤醒、替身、计时、页面行为、可访问性、逐行验收 |
| 未使用 | 没有 jsdom、没有 Playwright/Puppeteer、没有真实浏览器或截图测试 |

## 6. 治理与协作工具链

| 工具 | 说明 |
| --- | --- |
| Spec Kit | `.specify/`：`templates/`（spec/plan/tasks/checklist/constitution）、`scripts/bash/`（6 个 bash 脚本，需 bash 环境）、`workflows/`、`memory/constitution.md`（当前 1.4.0，本仓库的「交接接口」事实来源） |
| 规格目录 | `specs/001-insitu-parabola`（P0 抛物线）、`specs/002-vision-result-adapter`（P1 识别适配），共 23 个 md / 1508 行 |
| 前端文档 | `docs/` 12 个 md / 1301 行（Constitution、执行计划、视觉规范、UI 清单、验证记录等） |
| Cursor Skills | `.cursor/skills/` 10 个 `SKILL.md` / 1917 行（agent 工作流说明，属工具链不入运行包） |
| Agent 约定 | `AGENTS.md`（前端职责边界、验证要求、BreakGlass 产品约束） |
| 原型 | `prototypes/liquid-glass-toolbar/`：独立 HTML/CSS/JS 原型，直接引用扩展内正式实现 |

## 7. 明确**没有**使用（多数有反向断言）

| 类别 | 结论 |
| --- | --- |
| 前端框架 | 无 React / Vue / Preact / Svelte；无组件库、无 Tailwind |
| 类型系统 | 无 TypeScript / Flow / JSDoc 类型检查器（只有注释里的 `@param`） |
| 构建工具 | 无 vite / webpack / rollup / parcel / babel / PostCSS |
| 包管理 | 无 npm/pnpm/yarn，无锁文件、无 `node_modules` |
| 代码质量工具 | 无 ESLint / Prettier / EditorConfig |
| CI/CD | 无 GitHub Actions、无流水线 |
| 后端 | 无服务进程、无数据库、无账号体系、无上传接口 |
| 网络 | 运行时零请求（`fetch` 只读扩展包内相对路径） |
| P1 能力 | 无 Pyodide / WASM / Web Worker / 真实视觉识别（宪法列为独立 P1，未派发） |
| 注入 | 无 content script、无任意网站注入 |

## 8. 版本与兼容性

| 项 | 值 |
| --- | --- |
| 扩展版本 | `manifest.json` 里 `version: 0.1.0` |
| 目标浏览器 | Chrome 当前稳定版（开发与手工验收实际用 Edge 154） |
| Node | 20+（仅用于测试与规范脚本）；本机实际用 DSH 自带运行时 |
| bash | 仅 Spec Kit 脚本需要（Windows 下走 Git Bash） |
| 无 esbuild/压缩 | 交付物即源码，扩展目录可直接「加载已解压的扩展程序」 |

## 9. 结论与影响

**优点**

- **可审计性极高**：没有依赖树、没有供应链风险，`script-src 'self'` 下连内联脚本都没有。
- **测试与实现同语言同运行器**：`node --test` 一条命令即可全量验证（209 项），不需要装任何东西。
- **状态机与几何逻辑是纯函数**，因此能用假时钟 + 假 DOM 做到确定性验证（1500ms 看门狗、2% 对齐都能精确断言）。
- 交付即源码，演示现场不依赖构建产物，出错可逐行定位。

**代价与风险**

- 没有类型系统与 linter：契约靠**静态断言 + 文档**维持（`tests/page-integration.test.js` 承担了「接口锁」的角色）。
- 假 DOM 不等价于真实浏览器：布局、事件语义、真实渲染仍需手工验收（T017/T030/T038 至今未执行）。
- 模块靠全局命名空间 + 脚本顺序，新增文件必须同步 `index.html` 与静态断言，人肉维护成本随规模上升。
- 无 CI：`node --test` 靠人记得跑。

## 10. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.0.0 | 2026-10-02 | 首次分析：平台、语言与模块化、UI 与样式、数据、测试、工具链、未使用清单、版本与影响 |
