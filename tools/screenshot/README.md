# 截图流水线

用于在**没有 WSL2 / Docker 的机器上**生成 `docs/screenshots/` 的全套界面截图，便于文档维护与 PR 评审。

```
mock-api.mjs  ──▶  真实前端（vinext dev）  ──▶  capture.mjs（Playwright）
   :8799                  :8765                      docs/screenshots/*.png
```

## 三步

```bash
# 1) 模拟控制服务：实现 server.mjs 的读接口形状，返回固定演示数据
node tools/screenshot/mock-api.mjs

# 2) 前端指向模拟服务（NEXT_PUBLIC_WPANEL_API 是构建时注入，必须重启 dev server）
NEXT_PUBLIC_WPANEL_API=http://127.0.0.1:8799 npm run dev

# 3) 采集截图（浅色 + 深色各一套）
node tools/screenshot/capture.mjs
```

## 依赖

- `mock-api.mjs`：零依赖，Node ≥ 22。
- `capture.mjs`：需要 `playwright-core` 与一个 Chromium。可用环境变量指定：

| 变量 | 说明 |
|---|---|
| `WPANEL_PLAYWRIGHT` | `playwright-core` 所在目录（默认按 `node_modules/playwright-core` 解析） |
| `WPANEL_CHROME` | Chromium / Chrome 可执行文件路径（默认探测 `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`，再退回系统 Chrome / Edge） |
| `WPANEL_UI` | 前端地址，默认 `http://localhost:8765` |

例如：

```bash
WPANEL_PLAYWRIGHT=/path/to/playwright-core \
WPANEL_CHROME=/path/to/chrome.exe \
node tools/screenshot/capture.mjs
```

## 说明

- `mock-api.mjs` **只实现读接口**，任何写操作都返回一条「演示模式」记录，不会触碰真实环境。
- 截图渲染的是真实组件与真实 CSS，只有数据是虚构的，因此改完 UI 后重跑即可得到与线上一致的画面。
- 输出为 1440×900 视口、1.5 倍像素密度；如需调整，改 `capture.mjs` 顶部的 `VIEWPORT` 与 `deviceScaleFactor`。
